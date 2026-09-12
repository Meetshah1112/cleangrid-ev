import { ManualClock } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { EventBus } from '../events';
import { nullLogger } from '../logger';
import { createMemoryRepositories } from '../repo/memory';
import { buildApp } from './app';
import type { ApiContext } from './context';

/**
 * Which methods a browser is allowed to send.
 *
 * This was left to a default, and the default answered a PATCH preflight with "GET,HEAD,POST". So
 * every PATCH from a browser was refused before it was sent, and the one place in the console that
 * needed one -- an operator changing a driver's mode or giving them more time -- could not be
 * built. The note in the table said to use the API instead, which was true and was a symptom.
 *
 * Nothing failed loudly. The route existed, the server was correct, and the refusal happened in
 * the browser before the request left it. So the test does not check a list against another list:
 * it walks the routes the server actually registered and requires the preflight to permit every
 * verb among them. A route added with a new verb fails this until CORS is told about it.
 */

async function app() {
  const repos = createMemoryRepositories();
  const clock = new ManualClock(Date.parse('2026-09-12T08:00:00Z'));
  const ctx = {
    config: loadConfig({ DEV_AUTH: '1' }),
    repos,
    bus: new EventBus(nullLogger()),
    clock,
    logger: nullLogger(),
    sessions: {} as ApiContext['sessions'],
    gateway: { onlineCount: () => 0 } as unknown as ApiContext['gateway'],
    forecast: {} as ApiContext['forecast'],
    reports: {} as ApiContext['reports'],
    runtimes: new Map(),
    defaultSiteId: 'site-test',
  } satisfies ApiContext;
  return buildApp(ctx);
}

/** Every verb the server has a route for, as Fastify itself reports them. */
function registeredMethods(printed: string): Set<string> {
  const found = new Set<string>();
  for (const match of printed.matchAll(/\b(GET|POST|PATCH|PUT|DELETE)\b/g)) found.add(match[0]);
  return found;
}

describe('cross-origin requests', () => {
  it('permits every verb the server actually routes', async () => {
    const server = await app();
    const methods = registeredMethods(server.printRoutes({ commonPrefix: false }));
    expect(methods.size, 'no routes found to check').toBeGreaterThan(0);

    for (const method of methods) {
      const preflight = await server.inject({
        method: 'OPTIONS',
        url: '/sessions/any-id',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type',
        },
      });
      const allowed = String(preflight.headers['access-control-allow-methods'] ?? '');
      expect(allowed, `a browser cannot send ${method}`).toContain(method);
    }
    await server.close();
  });

  it('permits the headers the clients identify themselves with', async () => {
    // Without these the dev-auth headers are stripped and every call arrives anonymous.
    const server = await app();
    const preflight = await server.inject({
      method: 'OPTIONS',
      url: '/sessions/any-id',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'content-type,x-dev-role,x-dev-user',
      },
    });
    const allowed = String(preflight.headers['access-control-allow-headers'] ?? '').toLowerCase();
    for (const header of ['content-type', 'x-dev-role', 'x-dev-user', 'authorization']) {
      expect(allowed, `${header} would be stripped`).toContain(header);
    }
    await server.close();
  });
});
