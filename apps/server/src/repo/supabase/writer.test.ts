import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';
import { nullLogger } from '../../logger';
import type { Row } from './rows';
import { MirrorWriter } from './writer';

/** Records every upsert the writer issues, so a test can assert on batching and ordering. */
interface Call {
  table: string;
  onConflict: string;
  rows: Row[];
}

function fakeClient(fail: (table: string, attempt: number) => string | null = () => null): {
  client: SupabaseClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const attempts = new Map<string, number>();
  const client = {
    from(table: string) {
      return {
        async upsert(rows: Row[], options: { onConflict: string }) {
          calls.push({ table, onConflict: options.onConflict, rows });
          const attempt = attempts.get(table) ?? 0;
          attempts.set(table, attempt + 1);
          const message = fail(table, attempt);
          return message === null ? { error: null } : { error: { message } };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const session = (id: string, power: number): Row => ({ id, current_power_kw: power });

describe('MirrorWriter', () => {
  test('collapses repeated writes to one row per key, keeping the last', async () => {
    // Arrange
    const { client, calls } = fakeClient();
    const writer = new MirrorWriter(client, nullLogger());

    // Act
    writer.enqueue('sessions', session('s1', 1), 'id');
    writer.enqueue('sessions', session('s1', 7), 'id');
    writer.enqueue('sessions', session('s2', 3), 'id');
    await writer.flush();

    // Assert
    expect(calls).toHaveLength(1);
    expect(calls[0]?.rows).toEqual([session('s1', 7), session('s2', 3)]);
    expect(writer.stats()).toMatchObject({ written: 2, failed: 0, queued: 0 });
  });

  test('writes parents before children whatever order they arrived in', async () => {
    // Arrange
    const { client, calls } = fakeClient();
    const writer = new MirrorWriter(client, nullLogger());

    // Act: a meter reading enqueued before the session it belongs to.
    writer.enqueue('meter_readings', { session_id: 's1', recorded_at: 't1' }, 'session_id,recorded_at');
    writer.enqueue('sessions', session('s1', 4), 'id');
    writer.enqueue('chargers', { id: 'CP-01' }, 'id');
    await writer.flush();

    // Assert
    expect(calls.map((call) => call.table)).toEqual(['chargers', 'sessions', 'meter_readings']);
  });

  test('does not let a row enqueued mid-flush overtake its parent', async () => {
    // Arrange: the client enqueues a new session and its connector while `sessions` is being
    // written. Before snapshotting, the connector was picked up later in the same pass and reached
    // Postgres first.
    const calls: Call[] = [];
    let injected = false;
    const client = {
      from(table: string) {
        return {
          async upsert(rows: Row[], options: { onConflict: string }) {
            calls.push({ table, onConflict: options.onConflict, rows });
            if (table === 'sessions' && !injected) {
              injected = true;
              writer.enqueue('sessions', session('late', 9), 'id');
              writer.enqueue('connectors', { charger_id: 'CP-02', connector_id: 1 }, 'charger_id,connector_id');
            }
            return { error: null };
          },
        };
      },
    } as unknown as SupabaseClient;
    const writer = new MirrorWriter(client, nullLogger());

    // Act
    writer.enqueue('sessions', session('first', 1), 'id');
    await writer.flush();

    // Assert: the late connector waits for the pass that carries the late session.
    const order = calls.map((call) => call.table);
    expect(order).toEqual(['sessions', 'sessions', 'connectors']);
    expect(calls[1]?.rows).toEqual([session('late', 9)]);
  });

  test('holds a batch whose parent has not landed yet, then writes it', async () => {
    // Arrange: fail the first connectors write with a foreign key error, succeed afterwards.
    let connectorCalls = 0;
    const { client, calls } = fakeClient((table) => {
      if (table !== 'connectors') return null;
      connectorCalls += 1;
      // Both the first attempt and its immediate retry fail.
      return connectorCalls <= 2 ? 'violates foreign key constraint "connectors_session_fkey"' : null;
    });
    const writer = new MirrorWriter(client, nullLogger());

    // Act
    writer.enqueue('connectors', { charger_id: 'CP-01', connector_id: 1 }, 'charger_id,connector_id');
    await writer.flush();

    // Assert: deferred to a later pass rather than counted as lost.
    expect(calls.filter((call) => call.table === 'connectors')).toHaveLength(3);
    expect(writer.stats()).toMatchObject({ written: 1, failed: 0, degraded: false, queued: 0 });
  });

  test('splits a large queue into batches', async () => {
    // Arrange
    const { client, calls } = fakeClient();
    const writer = new MirrorWriter(client, nullLogger(), { maxBatch: 2 });

    // Act
    for (let index = 0; index < 5; index += 1) writer.enqueue('sessions', session(`s${index}`, index), 'id');
    await writer.flush();

    // Assert
    expect(calls.map((call) => call.rows.length)).toEqual([2, 2, 1]);
    expect(writer.stats().written).toBe(5);
  });

  test('retries once, then records the failure and moves on', async () => {
    // Arrange: fail the first attempt only.
    const { client, calls } = fakeClient((table, attempt) => (attempt === 0 ? `${table} exploded` : null));
    const writer = new MirrorWriter(client, nullLogger());

    // Act
    writer.enqueue('sessions', session('s1', 1), 'id');
    await writer.flush();

    // Assert
    expect(calls).toHaveLength(2);
    expect(writer.stats()).toMatchObject({ written: 1, failed: 0, degraded: false });
  });

  test('gives up after the retry and stays degraded rather than blocking', async () => {
    // Arrange
    const { client } = fakeClient((table) => `${table} still broken`);
    const writer = new MirrorWriter(client, nullLogger());

    // Act
    writer.enqueue('sessions', session('s1', 1), 'id');
    await writer.flush();

    // Assert
    expect(writer.stats()).toMatchObject({ written: 0, failed: 1, degraded: true });
    expect(writer.stats().lastError).toContain('sessions');
  });

  test('sheds writes instead of growing without bound', async () => {
    // Arrange
    const { client } = fakeClient();
    const writer = new MirrorWriter(client, nullLogger(), { maxQueue: 2 });

    // Act
    for (let index = 0; index < 5; index += 1) writer.enqueue('sessions', session(`s${index}`, index), 'id');

    // Assert
    expect(writer.stats().dropped).toBe(3);
    await writer.flush();
    expect(writer.stats()).toMatchObject({ written: 2, degraded: true });
  });

  test('stops accepting writes once closed', async () => {
    // Arrange
    const { client, calls } = fakeClient();
    const writer = new MirrorWriter(client, nullLogger());
    writer.enqueue('sessions', session('s1', 1), 'id');

    // Act
    await writer.stop();
    writer.enqueue('sessions', session('s2', 2), 'id');
    await writer.flush();

    // Assert: the queued row was drained by stop, the later one was never accepted.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.rows).toEqual([session('s1', 1)]);
  });
});
