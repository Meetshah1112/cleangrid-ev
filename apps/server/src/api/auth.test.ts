import { ManualClock, accessCodeFor } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { EventBus } from '../events';
import { nullLogger } from '../logger';
import { createMemoryRepositories } from '../repo/memory';
import { buildApp } from './app';
import { AccessGuard } from './auth';
import type { ApiContext, SiteRuntime } from './context';

/**
 * The deployed demo has no sign-up and no password: every seeded account has its own access code,
 * and the code alone decides who is signing in. Nobody is shown a list of accounts to pick from, so
 * a code given to one driver opens that driver's car and nothing else.
 *
 * What the account may do comes from its stored profile, never from anything the client says about
 * itself, so a driver's code cannot be promoted to operator by sending a different header.
 */

const SECRET = 'harbour-lantern-secret-0042';
const OCPP_AUTH_KEY = 'charger-key-0123456789';
const code = (accountId: string): string => accessCodeFor(SECRET, accountId);

const profile = (id: string, role: 'driver' | 'operator' | 'grid_operator', displayName: string, siteId: string | null) => ({
  id,
  role,
  displayName,
  siteId,
  idTag: role === 'driver' ? `TAG-${id}` : null,
  defaultMode: 'greenest' as const,
  defaultDwellHours: 8,
  defaultEnergyKwh: 20,
});

async function app(env: Record<string, string> = { ACCESS_CODE_SECRET: SECRET, OCPP_AUTH_KEY }) {
  const repos = createMemoryRepositories();
  await repos.profiles.save(profile('drv-harsh', 'driver', 'Harsh Patel', 'site-test'));
  // Left in the database by a scenario this server no longer runs.
  await repos.profiles.save(profile('drv-retired', 'driver', 'Arjun Menon', 'site-closed'));
  await repos.profiles.save(profile('ops-network', 'operator', 'Network Operations', null));
  const ctx = {
    config: loadConfig({ DEV_AUTH: '0', ...env }),
    repos,
    bus: new EventBus(nullLogger()),
    clock: new ManualClock(Date.parse('2026-09-12T08:00:00Z')),
    logger: nullLogger(),
    sessions: {} as ApiContext['sessions'],
    gateway: { onlineCount: () => 0 } as unknown as ApiContext['gateway'],
    forecast: {} as ApiContext['forecast'],
    reports: {} as ApiContext['reports'],
    runtimes: new Map([['site-test', {} as SiteRuntime]]),
    defaultSiteId: 'site-test',
  } satisfies ApiContext;
  return buildApp(ctx);
}

describe('access codes', () => {
  it('refuses a request without a code', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/me', headers: { 'x-dev-user': 'drv-harsh' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('access_code_required');
    await server.close();
  });

  it('refuses a code that belongs to nobody', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/me', headers: { 'x-access-code': 'ABCD-EFGH-JKMN' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('access_code_rejected');
    await server.close();
  });

  it('signs in as the account the code belongs to, whoever the request claims to be', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-access-code': code('drv-harsh'), 'x-dev-user': 'ops-network', 'x-dev-role': 'operator' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: 'drv-harsh', role: 'driver', displayName: 'Harsh Patel', siteId: 'site-test' });
    await server.close();
  });

  it('accepts a code typed in lower case, with spaces for dashes', async () => {
    const server = await app();
    const typed = code('ops-network').toLowerCase().replace(/-/g, ' ');
    const response = await server.inject({ method: 'GET', url: '/me', headers: { 'x-access-code': typed } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBe('ops-network');
    await server.close();
  });

  it('refuses the code of an account at a site this server is not running', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/me', headers: { 'x-access-code': code('drv-retired') } });
    expect(response.statusCode).toBe(401);
    await server.close();
  });

  it('lists no accounts to anyone', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/demo/accounts', headers: { 'x-access-code': code('ops-network') } });
    expect(response.statusCode).toBe(404);
    await server.close();
  });

  it('keeps the health check open, so the host can tell the server is up', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).not.toBe(401);
    await server.close();
  });

  it('slows down someone guessing codes', async () => {
    const server = await app();
    let last = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await server.inject({
        method: 'GET',
        url: '/me',
        headers: { 'x-access-code': `GUESS-${attempt}` },
        remoteAddress: '203.0.113.9',
      });
      last = response.statusCode;
    }
    expect(last).toBe(429);
    // The limit is per address: a visitor elsewhere with a real code is unaffected.
    const other = await server.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-access-code': code('drv-harsh') },
      remoteAddress: '198.51.100.4',
    });
    expect(other.statusCode).toBe(200);
    await server.close();
  });

  it("never locks out the server's own machine, where the simulator and a USB-connected phone share one address", async () => {
    const server = await app();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await server.inject({ method: 'GET', url: '/me', headers: { 'x-access-code': `STALE-${attempt}` }, remoteAddress: '127.0.0.1' });
    }
    for (const remoteAddress of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await server.inject({ method: 'GET', url: '/me', headers: { 'x-access-code': `STALE-${attempt}` }, remoteAddress });
      }
      const simulator = await server.inject({ method: 'GET', url: '/me', headers: { 'x-access-code': code('drv-harsh') }, remoteAddress });
      expect(simulator.statusCode).toBe(200);
    }
    await server.close();
  });

  it('behind a proxy, counts guesses against the address the proxy saw, not one the client wrote', async () => {
    const server = await app({ ACCESS_CODE_SECRET: SECRET, OCPP_AUTH_KEY, TRUST_PROXY: '1' });
    let last = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await server.inject({
        method: 'GET',
        url: '/me',
        // The guesser invents a new address each time; the proxy appends the real one after it.
        headers: { 'x-access-code': `GUESS-${attempt}`, 'x-forwarded-for': `192.0.2.${attempt}, 203.0.113.9` },
        remoteAddress: '10.0.0.1',
      });
      last = response.statusCode;
    }
    expect(last).toBe(429);
    await server.close();
  });

  it('forgets old guesses rather than remembering every address forever', () => {
    let nowMs = 0;
    const guard = new AccessGuard(() => nowMs);
    for (let index = 0; index < 50_000; index += 1) {
      nowMs += 1;
      guard.recordFailure(`address-${index}`);
    }
    expect(guard.trackedAddresses).toBeLessThanOrEqual(10_000);
    // The newest guesser is still being counted.
    for (let attempt = 0; attempt < 25; attempt += 1) guard.recordFailure('address-49999');
    expect(() => guard.assertAllowed('address-49999')).toThrow(/too many/);
  });

  it('keeps the shared clock out of visitors\' hands, since every visitor shares it', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/admin/clock',
      headers: { 'x-access-code': code('ops-network') },
      payload: { scale: 500 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('clock_locked');
    await server.close();
  });

  it('refuses a proxy setting that is not a hop count', () => {
    expect(() => loadConfig({ DEV_AUTH: '0', ACCESS_CODE_SECRET: SECRET, OCPP_AUTH_KEY, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('refuses to start with no way to authenticate at all', () => {
    expect(() => loadConfig({ DEV_AUTH: '0' })).toThrow(/ACCESS_CODE_SECRET|SUPABASE_JWT_SECRET/);
  });

  it('refuses a secret short enough to guess the codes from', () => {
    expect(() => loadConfig({ DEV_AUTH: '0', ACCESS_CODE_SECRET: 'short', OCPP_AUTH_KEY })).toThrow(/ACCESS_CODE_SECRET/);
  });
});
