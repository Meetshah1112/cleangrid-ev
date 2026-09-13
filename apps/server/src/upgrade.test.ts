import { accessCodeFor } from '@cleangrid/shared';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AccessCodeBook } from './api/auth';
import { loadConfig } from './config';
import { createMemoryRepositories } from './repo/memory';
import { chargerCredentials, routeUpgrade } from './upgrade';

/**
 * Chargers and console sockets arrive as raw HTTP upgrades, outside Fastify and its auth hook, so
 * the checks for a public deployment live here: a charger must present the charger key the way OCPP
 * 1.6 security profile 1 describes, and a console socket must carry the code of an account allowed
 * to watch that site.
 */

const SECRET = 'harbour-lantern-secret-0042';
const KEY = 'charger-key-0123456789';

function fakeSocket() {
  const written: string[] = [];
  let destroyed = false;
  const socket = {
    write: (chunk: string) => {
      written.push(chunk);
      return true;
    },
    destroy: () => {
      destroyed = true;
    },
  } as unknown as Duplex;
  return { socket, written, isDestroyed: () => destroyed };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

async function harness(env: Record<string, string>) {
  const repos = createMemoryRepositories();
  const base = { idTag: null, defaultMode: 'balanced' as const, defaultDwellHours: 8, defaultEnergyKwh: 20 };
  await repos.profiles.save({ ...base, id: 'ops-network', role: 'operator', displayName: 'Network Operations', siteId: null });
  await repos.profiles.save({ ...base, id: 'ops-b', role: 'operator', displayName: 'Site B', siteId: 'site-b' });
  await repos.profiles.save({ ...base, id: 'drv-harsh', role: 'driver', displayName: 'Harsh Patel', siteId: 'site-a' });
  const config = loadConfig({ DEV_AUTH: '0', ...env });
  const running = new Set(['site-a', 'site-b']);
  const chargers: string[] = [];
  const consoles: string[] = [];
  const listener = routeUpgrade({
    config,
    codes: config.ACCESS_CODE_SECRET ? new AccessCodeBook(config.ACCESS_CODE_SECRET, repos, (siteId) => running.has(siteId)) : null,
    gateway: { handleUpgrade: (_request, _socket, _head, identity) => void chargers.push(identity) },
    channel: { handleUpgrade: (_request, _socket, _head, siteId) => void consoles.push(siteId) },
  });
  const upgrade = async (url: string, headers: Record<string, string> = {}) => {
    const fake = fakeSocket();
    listener({ url, headers } as IncomingMessage, fake.socket, Buffer.alloc(0));
    await settle();
    return fake;
  };
  return { upgrade, chargers, consoles };
}

const deployed = { ACCESS_CODE_SECRET: SECRET, OCPP_AUTH_KEY: KEY };
const socketFor = (siteId: string, accountId: string) => `/ws/sites/${siteId}?code=${encodeURIComponent(accessCodeFor(SECRET, accountId))}`;

describe('websocket upgrades', () => {
  it('lets a charger in with its identity and the charger key', async () => {
    const { upgrade, chargers } = await harness(deployed);
    const result = await upgrade('/ocpp/CP-GNR-01', { authorization: chargerCredentials('CP-GNR-01', KEY) });
    expect(chargers).toEqual(['CP-GNR-01']);
    expect(result.isDestroyed()).toBe(false);
  });

  it("turns away a charger with no key, the wrong key, or another charger's identity", async () => {
    const { upgrade, chargers } = await harness(deployed);
    const missing = await upgrade('/ocpp/CP-GNR-01');
    const wrong = await upgrade('/ocpp/CP-GNR-01', { authorization: chargerCredentials('CP-GNR-01', 'not-the-key-at-all') });
    const borrowed = await upgrade('/ocpp/CP-GNR-01', { authorization: chargerCredentials('CP-GNR-02', KEY) });
    expect(chargers).toEqual([]);
    for (const result of [missing, wrong, borrowed]) {
      expect(result.written.join('')).toMatch(/^HTTP\/1\.1 401/);
      expect(result.isDestroyed()).toBe(true);
    }
  });

  it('lets any charger in when no key is configured, as on a laptop', async () => {
    const { upgrade, chargers } = await harness({ DEV_AUTH: '1' });
    await upgrade('/ocpp/CP-GNR-01');
    expect(chargers).toEqual(['CP-GNR-01']);
  });

  it("opens a console socket only for an operator allowed at that site", async () => {
    const { upgrade, consoles } = await harness(deployed);
    const none = await upgrade('/ws/sites/site-a');
    const driver = await upgrade(socketFor('site-a', 'drv-harsh'));
    const otherSite = await upgrade(socketFor('site-a', 'ops-b'));
    const network = await upgrade(socketFor('site-a', 'ops-network'));
    const own = await upgrade(socketFor('site-b', 'ops-b'));
    for (const refused of [none, driver, otherSite]) expect(refused.written.join('')).toMatch(/^HTTP\/1\.1 (401|403)/);
    expect(network.isDestroyed()).toBe(false);
    expect(own.isDestroyed()).toBe(false);
    expect(consoles).toEqual(['site-a', 'site-b']);
  });

  it('closes a malformed address instead of throwing, which would take the whole server down', async () => {
    const { upgrade, chargers, consoles } = await harness(deployed);
    const charger = await upgrade('/ocpp/%E0%A4%A', { authorization: chargerCredentials('x', KEY) });
    const socket = await upgrade(`/ws/sites/%zz?code=${accessCodeFor(SECRET, 'ops-network')}`);
    expect(charger.isDestroyed()).toBe(true);
    expect(socket.isDestroyed()).toBe(true);
    expect(chargers).toEqual([]);
    expect(consoles).toEqual([]);
  });

  it('closes any other upgrade', async () => {
    const { upgrade } = await harness(deployed);
    expect((await upgrade('/somewhere-else')).isDestroyed()).toBe(true);
  });

  it('refuses to start a public demo that leaves the chargers open to anyone', () => {
    expect(() => loadConfig({ DEV_AUTH: '0', ACCESS_CODE_SECRET: SECRET })).toThrow(/OCPP_AUTH_KEY/);
    expect(() => loadConfig({ DEV_AUTH: '0', ...deployed, OCPP_AUTH_KEY: 'short' })).toThrow(/OCPP_AUTH_KEY/);
  });
});
