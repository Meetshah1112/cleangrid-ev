import {
  makeSeries,
  ManualClock,
  type ChargingSession,
  type MeterReading,
  type Site,
  type StepSeries,
} from '@cleangrid/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../events';
import type { ForecastService } from '../forecast/service';
import { nullLogger } from '../logger';
import { createMemoryRepositories } from '../repo/memory';
import type { Repositories } from '../repo/types';
import { ReportService } from './service';

/**
 * The service that produces every number the product says out loud: what a charge cost, what it
 * emitted, and what it would have emitted with no plan behind it. It had no tests.
 *
 * The arithmetic itself lives in the engine and is covered there. What is covered here is the part
 * that decides which numbers go in: the window, the meter readings, the carbon series they are
 * weighed against, and whether the result may call itself verified. Those are the judgements that
 * turn a correct calculation into a true claim, and they are the ones that would embarrass us.
 */

const nowMs = Date.parse('2026-09-12T12:00:00Z');
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

const session = (over: Partial<ChargingSession> = {}): ChargingSession => ({
  id: 'session-1',
  siteId: site.id,
  chargerId: 'GN-01',
  connectorId: 1,
  driverId: 'drv-harsh',
  vehicleId: 'veh-harsh',
  idTag: 'TAG-HARSH',
  transactionId: 1,
  source: 'app',
  status: 'complete',
  mode: 'greenest',
  pluggedInMs: nowMs - 4 * HOUR,
  deadlineMs: nowMs,
  deadlineIsDefault: false,
  unpluggedMs: nowMs,
  energyNeededKwh: 20,
  energyDeliveredKwh: 20,
  maxPowerKw: 7.2,
  meterStartWh: 0,
  lastMeterWh: 20_000,
  currentPowerKw: 0,
  limitKw: null,
  deadlineRisk: false,
  createdMs: nowMs - 4 * HOUR,
  updatedMs: nowMs,
  ...over,
});

/**
 * A four-hour window that is filthy for the first two hours and clean for the last two. A plan
 * that waited should come out at about the clean end; one that charged on plug-in at the dirty end.
 */
function twoHalves(fromMs: number, dirty: number, clean: number): StepSeries {
  const steps = 16 + 8; // four hours at fifteen minutes, plus slack either side
  return makeSeries(
    fromMs,
    15,
    Array.from({ length: steps }, (_, index) => (index < 8 ? dirty : clean)),
  );
}

interface Harness {
  repos: Repositories;
  reports: ReportService;
  bus: EventBus;
  clock: ManualClock;
}

function harness(signals?: Partial<{ carbon: StepSeries; basis: 'actual' | 'forecast' }>): Harness {
  const repos = createMemoryRepositories();
  const clock = new ManualClock(nowMs);
  const bus = new EventBus(nullLogger());
  const from = nowMs - 4 * HOUR;

  const forecast = {
    historicalSignals: async () => ({
      carbon: signals?.carbon ?? twoHalves(from, 700, 300),
      price: makeSeries(from, 15, Array<number>(24).fill(5)),
      renewable: makeSeries(from, 15, Array<number>(24).fill(0.4)),
      basis: signals?.basis ?? ('forecast' as const),
    }),
  } as unknown as ForecastService;

  const reports = new ReportService({ repos, bus, clock, logger: nullLogger(), forecast });
  return { repos, reports, bus, clock };
}

/**
 * Meter readings for a charge that happened entirely in the given window.
 *
 * `fromWh` continues a register rather than restarting it, because a register that falls is not a
 * charge that resumed -- the engine rejects it outright, and rightly.
 */
const readingsOver = (
  sessionId: string,
  fromMs: number,
  toMs: number,
  kwh: number,
  { every = 15, fromWh = 0 }: { every?: number; fromWh?: number } = {},
): MeterReading[] => {
  const steps = Math.max(1, Math.round((toMs - fromMs) / (every * 60_000)));
  return Array.from({ length: steps + 1 }, (_, index) => ({
    sessionId,
    tsMs: fromMs + index * every * 60_000,
    energyWh: fromWh + Math.round((kwh * 1000 * index) / steps),
    powerW: index === steps ? 0 : Math.round((kwh * 1000) / (steps * (every / 60))),
    soc: null,
  }));
};

describe('ReportService.buildFor', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('returns nothing for a session whose site it cannot find', async () => {
    const report = await h.reports.buildFor(session({ siteId: 'site-that-went-away' }));
    expect(report).toBeNull();
  });

  it('reports the energy the meter recorded, not the energy that was asked for', async () => {
    await h.repos.sites.save(site);
    const s = session({ energyNeededKwh: 20, energyDeliveredKwh: 20 });
    for (const reading of readingsOver(s.id, s.pluggedInMs, nowMs, 17.5)) await h.repos.meters.append(reading);

    const report = await h.reports.buildFor(s);
    // The driver asked for 20 and the meter says 17.5. A report is a record of what happened.
    expect(report?.energyKwh).toBeCloseTo(17.5, 1);
  });

  it('credits a charge that waited for the clean half against one that did not', async () => {
    await h.repos.sites.save(site);
    const from = nowMs - 4 * HOUR;

    const waited = session({ id: 'waited' });
    for (const r of readingsOver('waited', from + 2 * HOUR, nowMs, 10)) await h.repos.meters.append(r);
    const waitedReport = await h.reports.buildFor(waited);

    const h2 = harness();
    await h2.repos.sites.save(site);
    const rushed = session({ id: 'rushed' });
    for (const r of readingsOver('rushed', from, from + 2 * HOUR, 10)) await h2.repos.meters.append(r);
    const rushedReport = await h2.reports.buildFor(rushed);

    expect(waitedReport?.avgCarbonGPerKwh).toBeLessThan(rushedReport?.avgCarbonGPerKwh as number);
    // The counterfactual is the same for both: full power from the moment the cable went in.
    expect(waitedReport?.avoidedCo2Kg).toBeGreaterThan(rushedReport?.avoidedCo2Kg as number);
  });

  it('scores a charge that took the cleanest hours available above one that took the dirtiest', async () => {
    await h.repos.sites.save(site);
    const from = nowMs - 4 * HOUR;
    for (const r of readingsOver('session-1', from + 2 * HOUR, nowMs, 10)) await h.repos.meters.append(r);
    const clean = await h.reports.buildFor(session());
    expect(clean?.greenScore).toBeGreaterThan(50);
    expect(clean?.windowMinCarbonGPerKwh).toBeLessThan(clean?.windowMaxCarbonGPerKwh as number);
  });

  it('says a report rests on a forecast when that is what it rests on', async () => {
    await h.repos.sites.save(site);
    for (const r of readingsOver('session-1', nowMs - 2 * HOUR, nowMs, 8)) await h.repos.meters.append(r);
    const report = await h.reports.buildFor(session());
    expect(report?.carbonBasis).toBe('forecast');
  });

  it('says a report rests on settled data when it does', async () => {
    const measured = harness({ basis: 'actual' });
    await measured.repos.sites.save(site);
    for (const r of readingsOver('session-1', nowMs - 2 * HOUR, nowMs, 8)) await measured.repos.meters.append(r);
    const report = await measured.reports.buildFor(session());
    expect(report?.carbonBasis).toBe('actual');
  });

  it('stores the report and announces it, so the driver app and the console both learn of it', async () => {
    await h.repos.sites.save(site);
    for (const r of readingsOver('session-1', nowMs - 2 * HOUR, nowMs, 8)) await h.repos.meters.append(r);

    const heard: string[] = [];
    h.bus.on('report.ready', ({ report }) => heard.push(report.sessionId));

    const report = await h.reports.buildFor(session());
    expect(heard).toEqual(['session-1']);
    expect(await h.repos.reports.get('session-1')).toEqual(report);
  });

  it('uses the clock rather than the wall when the session is still open', async () => {
    await h.repos.sites.save(site);
    for (const r of readingsOver('session-1', nowMs - 2 * HOUR, nowMs, 8)) await h.repos.meters.append(r);
    const report = await h.reports.buildFor(session({ status: 'active', unpluggedMs: null }));
    expect(report?.computedMs).toBe(nowMs);
  });
});

describe('ReportService.provisionalFor', () => {
  it('rebuilds a running session every time, since it is still changing', async () => {
    const h = harness();
    await h.repos.sites.save(site);
    const live = session({ status: 'active', unpluggedMs: null });
    for (const r of readingsOver(live.id, nowMs - 2 * HOUR, nowMs, 6)) await h.repos.meters.append(r);

    const first = await h.reports.provisionalFor(live);
    // The car kept charging: the register carries on from 6 kWh rather than starting again.
    for (const r of readingsOver(live.id, nowMs, nowMs + HOUR, 6, { fromWh: 6_000 })) {
      await h.repos.meters.append(r);
    }
    h.clock.set(nowMs + HOUR);
    const second = await h.reports.provisionalFor(live);

    expect(second?.energyKwh).toBeGreaterThan(first?.energyKwh as number);
  });

  it('returns the stored report for a finished session rather than recomputing it', async () => {
    const h = harness();
    await h.repos.sites.save(site);
    const done = session();
    for (const r of readingsOver(done.id, nowMs - 2 * HOUR, nowMs, 9)) await h.repos.meters.append(r);
    const built = await h.reports.buildFor(done);

    // A finished session's report is a settled fact. Recomputing it later, against a forecast that
    // has since been revised, would quietly change a number a driver was already shown.
    const again = await h.reports.provisionalFor(done);
    expect(again).toEqual(built);
  });
});

describe('ReportService.siteImpact', () => {
  it('is all zeroes for a site that has done nothing, rather than dividing by none', async () => {
    const h = harness();
    await h.repos.sites.save(site);
    const impact = await h.reports.siteImpact(site, nowMs - 24 * HOUR, nowMs + HOUR);
    expect(impact.sessions).toBe(0);
    expect(impact.avgGreenScore).toBe(0);
    expect(Number.isNaN(impact.avgRenewableShare)).toBe(false);
  });

  it('adds up the sessions inside the period and leaves out the ones outside it', async () => {
    const h = harness();
    await h.repos.sites.save(site);

    for (const [id, pluggedInMs] of [
      ['inside-1', nowMs - 3 * HOUR],
      ['inside-2', nowMs - 2 * HOUR],
      ['long-ago', nowMs - 40 * HOUR],
    ] as const) {
      const s = session({ id, pluggedInMs, createdMs: pluggedInMs });
      await h.repos.sessions.save(s);
      for (const r of readingsOver(id, pluggedInMs, pluggedInMs + HOUR, 6)) await h.repos.meters.append(r);
      await h.reports.buildFor(s);
    }

    const impact = await h.reports.siteImpact(site, nowMs - 24 * HOUR, nowMs + HOUR);
    expect(impact.sessions).toBe(2);
    expect(impact.energyKwh).toBeGreaterThan(0);
  });

  it('counts only sessions it could measure, since impact it did not measure is not impact', async () => {
    const h = harness();
    await h.repos.sites.save(site);

    const measured = session({ id: 'measured', pluggedInMs: nowMs - 2 * HOUR });
    await h.repos.sessions.save(measured);
    for (const r of readingsOver('measured', nowMs - 2 * HOUR, nowMs, 8)) await h.repos.meters.append(r);
    await h.reports.buildFor(measured);

    // Plugged in during the period, but abandoned before anything was recorded for it.
    await h.repos.sessions.save(session({ id: 'abandoned', status: 'aborted', pluggedInMs: nowMs - HOUR }));

    const impact = await h.reports.siteImpact(site, nowMs - 24 * HOUR, nowMs + HOUR);
    expect(impact.sessions).toBe(1);
  });
});
