import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MESSAGE_TYPE,
  OcppCallError,
  OcppFramingError,
  OcppRpc,
  parseFrame,
  serialiseCall,
  serialiseError,
  serialiseResult,
  type Payload,
} from './rpc';

describe('parseFrame', () => {
  it('parses CALL, CALLRESULT and CALLERROR', () => {
    expect(parseFrame('[2,"id-1","Heartbeat",{}]')).toEqual({ kind: 'call', id: 'id-1', action: 'Heartbeat', payload: {} });
    expect(parseFrame('[3,"id-1",{"currentTime":"now"}]')).toEqual({
      kind: 'result',
      id: 'id-1',
      payload: { currentTime: 'now' },
    });
    expect(parseFrame('[4,"id-1","NotSupported","nope",{"why":1}]')).toEqual({
      kind: 'error',
      id: 'id-1',
      errorCode: 'NotSupported',
      description: 'nope',
      details: { why: 1 },
    });
  });

  it.each([
    ['not JSON', 'definitely not json'],
    ['not an array', '{"messageTypeId":2}'],
    ['too short', '[2,"id-1"]'],
    ['unknown message type', '[9,"id-1","Heartbeat",{}]'],
    ['missing action', '[2,"id-1",{},{}]'],
    ['payload that is an array', '[3,"id-1",[1,2]]'],
    ['empty unique id', '[3,"",{}]'],
    ['over-long unique id', `[3,"${'x'.repeat(37)}",{}]`],
  ])('rejects a frame that is %s', (_label, raw) => {
    expect(() => parseFrame(raw)).toThrow(OcppFramingError);
  });

  it('round-trips what it serialises', () => {
    expect(parseFrame(serialiseCall('a', 'Authorize', { idTag: 'TAG' }))).toMatchObject({ action: 'Authorize' });
    expect(parseFrame(serialiseResult('a', { ok: true }))).toMatchObject({ payload: { ok: true } });
    expect(parseFrame(serialiseError('a', 'InternalError', 'boom'))).toMatchObject({ errorCode: 'InternalError' });
  });
});

interface Harness {
  readonly rpc: OcppRpc;
  readonly sent: string[];
  readonly frames: () => unknown[][];
}

function harness(handler: (action: string, payload: Payload) => Payload | Promise<Payload> = () => ({})): Harness {
  const sent: string[] = [];
  let counter = 0;
  const rpc = new OcppRpc((data) => sent.push(data), handler, {
    generateId: () => `id-${(counter += 1)}`,
    callTimeoutMs: 5_000,
  });
  return { rpc, sent, frames: () => sent.map((raw) => JSON.parse(raw) as unknown[]) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OcppRpc outgoing calls', () => {
  it('resolves with the payload of the matching CALLRESULT', async () => {
    const { rpc, sent } = harness();
    const pending = rpc.call<{ interval: number }>('BootNotification', { chargePointModel: 'Sim' });
    expect(JSON.parse(sent[0] as string)).toEqual([
      MESSAGE_TYPE.CALL,
      'id-1',
      'BootNotification',
      { chargePointModel: 'Sim' },
    ]);
    await rpc.receive(serialiseResult('id-1', { interval: 300 }));
    await expect(pending).resolves.toEqual({ interval: 300 });
  });

  it('rejects with the error code of a CALLERROR', async () => {
    const { rpc } = harness();
    const pending = rpc.call('SetChargingProfile', {});
    await rpc.receive(serialiseError('id-1', 'NotSupported', 'no profiles here'));
    await expect(pending).rejects.toMatchObject({ errorCode: 'NotSupported' });
  });

  it('sends one call at a time and starts the next when the first settles', async () => {
    const { rpc, sent } = harness();
    const first = rpc.call('Heartbeat');
    const second = rpc.call('Authorize', { idTag: 'TAG' });
    expect(sent).toHaveLength(1);
    await rpc.receive(serialiseResult('id-1', {}));
    await first;
    expect(sent).toHaveLength(2);
    await rpc.receive(serialiseResult('id-2', {}));
    await expect(second).resolves.toEqual({});
  });

  it('times out a call that is never answered, then unblocks the queue', async () => {
    vi.useFakeTimers();
    const { rpc, sent } = harness();
    const first = rpc.call('SetChargingProfile', {});
    const second = rpc.call('Heartbeat');
    const failure = expect(first).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5_001);
    await failure;
    expect(sent).toHaveLength(2);
    await rpc.receive(serialiseResult('id-2', {}));
    await expect(second).resolves.toEqual({});
  });

  it('rejects pending and queued calls when the connection closes', async () => {
    const { rpc } = harness();
    const first = rpc.call('Heartbeat');
    const queued = rpc.call('Reset', { type: 'Soft' });
    rpc.close('charger disconnected');
    await expect(first).rejects.toThrow(/charger disconnected/);
    await expect(queued).rejects.toThrow(/charger disconnected/);
    await expect(rpc.call('Heartbeat')).rejects.toBeInstanceOf(OcppCallError);
  });
});

describe('OcppRpc incoming calls', () => {
  it('answers a handled call with a CALLRESULT', async () => {
    const { rpc, frames } = harness((action) => ({ echoed: action }));
    await rpc.receive(serialiseCall('peer-1', 'Heartbeat', {}));
    expect(frames()[0]).toEqual([MESSAGE_TYPE.CALL_RESULT, 'peer-1', { echoed: 'Heartbeat' }]);
  });

  it('turns a thrown handler into a CALLERROR, keeping an OCPP error code', async () => {
    const { rpc, frames } = harness(() => {
      throw new OcppCallError('NotImplemented', 'unknown action');
    });
    await rpc.receive(serialiseCall('peer-1', 'Mystery', {}));
    expect(frames()[0]).toEqual([MESSAGE_TYPE.CALL_ERROR, 'peer-1', 'NotImplemented', 'unknown action', {}]);

    const plain = harness(() => {
      throw new Error('database on fire');
    });
    await plain.rpc.receive(serialiseCall('peer-2', 'Authorize', {}));
    expect(plain.frames()[0]?.[2]).toBe('InternalError');
  });

  it('warns instead of throwing on malformed frames and stray replies', async () => {
    const warnings: string[] = [];
    const rpc = new OcppRpc(
      () => undefined,
      () => ({}),
      { onWarning: (message) => warnings.push(message) },
    );
    await rpc.receive('garbage');
    await rpc.receive(serialiseResult('never-sent', {}));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/malformed/);
    expect(warnings[1]).toMatch(/unknown call id/);
  });

  it('keeps answering incoming calls while its own call is in flight', async () => {
    const { rpc, frames } = harness(() => ({ ok: true }));
    const pending = rpc.call('Reset', { type: 'Hard' });
    await rpc.receive(serialiseCall('peer-1', 'StatusNotification', { connectorId: 1 }));
    expect(frames()).toHaveLength(2);
    await rpc.receive(serialiseResult('id-1', { status: 'Accepted' }));
    await expect(pending).resolves.toEqual({ status: 'Accepted' });
    expect(rpc.pendingCount).toBe(0);
  });
});
