import {
  ManualClock,
  type Charger,
  type ChargingSession,
  type ScheduleProblem,
  type ScheduleResult,
  type Scheduler,
  type Site,
} from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { EventBus } from '../events';
import type { ForecastService } from '../forecast/service';
import { nullLogger } from '../logger';
import { createMemoryRepositories } from '../repo/memory';
import type { Repositories } from '../repo/types';
import { SessionService } from '../sessions/service';
import type { DemandMeter } from './demandMeter';
import type { DispatchService } from './dispatcher';
import { OptimiserLoop } from './loop';

/**
 * How often the loop looks again when nothing is prompting it.
 *
 * The ordinary cadence assumes the plan in force is still the right one, which holds while every
 * deadline is being met and stops holding the moment one is not. A driver who is short is exactly
 * the case where the answer is expected to change, and the things that would rescue them -- a car
 * finishing early and freeing its share, a flexibility window ending -- arrive between solves.
 */

const nowMs = Date.parse('2026-09-12T08:00:00Z');
const HOUR = 3_600_000;

const site: Site = {
  id: 'site-gandhinagar-secretariat',
  name: 'Gandhinagar Secretariat Car Park',
  timezone: 'Asia/Kolkata',
  country: 'IN',
  lat: 23.2156,
  lng: 72.6369,
  regionCode: 'GJ',
  gridConnectionKw: 120,
  demandChargePerKwMonth: 385,
  currency: 'INR',
  defaultMode: 'greenest',
  baseLoadKw: Array<number>(24).fill(40),
};

const charger: Charger = {
  id: 'GN-01',
  siteId: site.id,
  ocppIdentity: 'GN-01',
  label: 'Bay 1',
  maxPowerKw: 22,
  minPowerKw: 1.4,
  connectorCount: 1,
  online: true,
  lastSeenMs: nowMs,
  vendor: null,
  model: null,
  uncontrolled: false,
};

const session: ChargingSession = {
  id: 'session-1',
  siteId: site.id,
  chargerId: charger.id,
  connectorId: 1,
  driverId: 'drv-harsh',
  vehicleId: 'veh-harsh',
  idTag: 'TAG-HARSH',
  transactionId: 1,
  source: 'app',
  status: 'active',
  mode: 'greenest',
  pluggedInMs: nowMs,
  deadlineMs: nowMs + 8 * HOUR,
  deadlineIsDefault: false,
  unpluggedMs: null,
  energyNeededKwh: 20,
  energyDeliveredKwh: 0,
  maxPowerKw: 7.2,
  meterStartWh: 0,
  lastMeterWh: 0,
  currentPowerKw: 0,
  limitKw: null,
  deadlineRisk: false,
  createdMs: nowMs,
  updatedMs: nowMs,
};

/** A scheduler that reports whatever shortfalls the test asks it to. */
function schedulerReporting(shortfallFor: () => readonly string[]): Scheduler {
  return {
    name: 'stub',
    async solve(problem: ScheduleProblem): Promise<ScheduleResult> {
      const short = shortfallFor();
      return {
        status: short.length > 0 ? 'shortfall' : 'complete',
        solver: 'lp',
        allocationsKw: Object.fromEntries(
          problem.sessions.map((need) => [need.sessionId, Array<number>(problem.grid.slots).fill(0)]),
        ),
        siteLoadKw: Array<number>(problem.grid.slots).fill(0),
        shortfalls: short.map((sessionId) => ({ sessionId, shortfallKwh: 5 })),
        totals: { energyKwh: 0, cost: 0, co2Kg: 0, peakKw: 0, objective: 0 },
        solveMs: 1,
      };
    },
  };
}

async function harness(shortfallFor: () => readonly string[]) {
  const repos: Repositories = createMemoryRepositories();
  await repos.sites.save(site);
  await repos.chargers.save(charger);
  await repos.sessions.save(session);

  const clock = new ManualClock(nowMs);
  const bus = new EventBus(nullLogger());
  const logger = nullLogger();
  const flat = Array<number>(96).fill(300);

  const forecast = {
    signals: async () => ({
      carbonGPerKwh: flat,
      pricePerKwh: Array<number>(96).fill(5),
      renewableShare: Array<number>(96).fill(0.4),
      snapshot: null,
    }),
  } as unknown as ForecastService;

  const dispatched: number[] = [];
  const dispatcher = { apply: async () => dispatched.push(1) } as unknown as DispatchService;
  const demand = { peakKw: 0, capFor: () => null } as unknown as DemandMeter;

  const loop = new OptimiserLoop({
    repos,
    bus,
    clock,
    logger,
    scheduler: schedulerReporting(shortfallFor),
    forecast,
    dispatcher,
    sessions: new SessionService({ repos, bus, clock, logger }),
    demand,
    config: loadConfig({ OPTIMISER: 'on', SCHEDULER: 'lp', RESOLVE_INTERVAL_MIN: '5' }),
    siteId: site.id,
  });
  return { loop, repos, clock };
}

describe('re-planning while a driver is short', () => {
  it('reports nobody at risk when every deadline is reachable', async () => {
    const { loop } = await harness(() => []);
    await loop.solve('test');
    expect(loop.driversAtRisk).toBe(0);
  });

  it('counts the drivers a plan could not satisfy', async () => {
    const { loop } = await harness(() => ['session-1']);
    await loop.solve('test');
    expect(loop.driversAtRisk).toBe(1);
  });

  it('marks the session itself, so the driver is told and not only the operator', async () => {
    const { loop, repos } = await harness(() => ['session-1']);
    await loop.solve('test');
    expect((await repos.sessions.get('session-1'))?.deadlineRisk).toBe(true);
  });

  it('clears the risk once a later plan can reach the deadline again', async () => {
    let short: readonly string[] = ['session-1'];
    const { loop, repos } = await harness(() => short);
    await loop.solve('first');
    expect(loop.driversAtRisk).toBe(1);

    short = [];
    await loop.solve('second');
    expect(loop.driversAtRisk).toBe(0);
    expect((await repos.sessions.get('session-1'))?.deadlineRisk).toBe(false);
  });

  it('does not keep counting a driver who has unplugged', async () => {
    // The shortfall names a session no longer in the plan. Leaving it in the tally would hold the
    // loop at the faster cadence for the rest of the day over a car that has driven away.
    const { loop, repos } = await harness(() => ['someone-else-entirely']);
    await loop.solve('test');
    expect(loop.driversAtRisk).toBe(0);
    expect((await repos.sessions.get('session-1'))?.deadlineRisk).toBe(false);
  });
});
