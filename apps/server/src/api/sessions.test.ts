import { ManualClock, type Charger, type ChargingSession, type UserProfile, type Vehicle } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { EventBus } from '../events';
import { nullLogger } from '../logger';
import { createMemoryRepositories } from '../repo/memory';
import { SessionService } from '../sessions/service';
import { buildApp } from './app';
import type { ApiContext, SiteRuntime } from './context';

/**
 * Starting a session from the app.
 *
 * A driver pressed start, the charger accepted, and the app then said nothing was plugged in: the
 * current session was looked for among the driver's ten latest by plug-in time, and a demo that had
 * run on a sped-up clock had left sessions dated days ahead, so today's never made the ten. Pressing
 * start again found the bay taken, by their own session.
 */

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-12T08:00:00Z');

const bay = (id: string): Charger => ({
  id,
  siteId: 'site-a',
  ocppIdentity: id,
  label: id,
  maxPowerKw: 22,
  minPowerKw: 1.4,
  connectorCount: 1,
  online: true,
  lastSeenMs: NOW,
  vendor: null,
  model: null,
  uncontrolled: false,
});

const driver = (id: string): UserProfile => ({
  id,
  role: 'driver',
  displayName: id,
  siteId: 'site-a',
  idTag: `TAG-${id}`,
  defaultMode: 'greenest',
  defaultDwellHours: 8,
  defaultEnergyKwh: 20,
});

const finishedAt = (id: string, driverId: string, pluggedInMs: number): ChargingSession => ({
  id,
  siteId: 'site-a',
  chargerId: 'GN-02',
  connectorId: 1,
  driverId,
  vehicleId: null,
  idTag: `TAG-${driverId}`,
  transactionId: null,
  source: 'app',
  status: 'complete',
  mode: 'greenest',
  pluggedInMs,
  deadlineMs: pluggedInMs + 8 * HOUR,
  deadlineIsDefault: false,
  unpluggedMs: pluggedInMs + 8 * HOUR,
  energyNeededKwh: 20,
  energyDeliveredKwh: 20,
  maxPowerKw: 7.2,
  meterStartWh: 0,
  lastMeterWh: 20_000,
  currentPowerKw: 0,
  limitKw: null,
  deadlineRisk: false,
  createdMs: pluggedInMs,
  updatedMs: pluggedInMs,
});

async function app() {
  const repos = createMemoryRepositories();
  const clock = new ManualClock(NOW);
  const bus = new EventBus(nullLogger());
  const logger = nullLogger();
  for (const id of ['GN-01', 'GN-02']) await repos.chargers.save(bay(id));
  for (const id of ['drv-harsh', 'drv-rhea']) await repos.profiles.save(driver(id));
  const vehicle: Vehicle = { id: 'veh-harsh', driverId: 'drv-harsh', label: 'Nexon', batteryKwh: 45, maxChargeKw: 7.2 };
  await repos.vehicles.save(vehicle);

  const runtime = { site: { id: 'site-a' }, loop: { request: () => undefined, latestPlan: null } } as unknown as SiteRuntime;
  const ctx = {
    config: loadConfig({ DEV_AUTH: '1' }),
    repos,
    bus,
    clock,
    logger,
    sessions: new SessionService({ repos, bus, clock, logger }),
    gateway: { onlineCount: () => 2, remoteStart: async () => ({ status: 'Accepted' }) } as unknown as ApiContext['gateway'],
    forecast: {} as ApiContext['forecast'],
    reports: {} as ApiContext['reports'],
    runtimes: new Map([['site-a', runtime]]),
    defaultSiteId: 'site-a',
  } satisfies ApiContext;
  return { server: await buildApp(ctx), repos };
}

const as = (driverId: string) => ({ 'x-dev-role': 'driver', 'x-dev-user': driverId });

const start = (chargerId: string) => ({
  chargerId,
  energyKwh: 20,
  deadlineAt: new Date(NOW + 8 * HOUR).toISOString(),
  mode: 'greenest',
});

describe('starting a session from the app', () => {
  it('shows the session just started as current, whatever dates older sessions carry', async () => {
    const { server, repos } = await app();
    // Twelve finished sessions dated after today, left by a demo run on a sped-up clock.
    for (let day = 1; day <= 12; day += 1) await repos.sessions.save(finishedAt(`old-${day}`, 'drv-harsh', NOW + day * 24 * HOUR));

    const started = await server.inject({ method: 'POST', url: '/sessions', headers: as('drv-harsh'), payload: start('GN-01') });
    expect(started.statusCode).toBe(201);

    const current = await server.inject({ method: 'GET', url: '/sessions/current', headers: as('drv-harsh') });
    expect(current.json().data?.session.id).toBe(started.json().data.id);
    await server.close();
  });

  it('refuses a second session while the driver already has one open, and says where', async () => {
    const { server } = await app();
    await server.inject({ method: 'POST', url: '/sessions', headers: as('drv-harsh'), payload: start('GN-01') });

    const second = await server.inject({ method: 'POST', url: '/sessions', headers: as('drv-harsh'), payload: start('GN-02') });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('session_open');
    expect(second.json().error.message).toContain('GN-01');
    await server.close();
  });

  it('refuses a bay another driver is already using', async () => {
    const { server } = await app();
    await server.inject({ method: 'POST', url: '/sessions', headers: as('drv-rhea'), payload: start('GN-01') });

    const taken = await server.inject({ method: 'POST', url: '/sessions', headers: as('drv-harsh'), payload: start('GN-01') });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('bay_in_use');
    await server.close();
  });
});
