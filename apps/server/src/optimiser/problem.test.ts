import { createSlotGrid, type Charger, type ChargingSession, type FlexEvent, type Site } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { baseLoadForGrid, buildProblem, capsForGrid } from './problem';

/** 10:00 UTC is 11:00 in London, so the local-hour lookup has to shift. */
const nowMs = Date.parse('2026-09-12T10:00:00Z');
const grid = createSlotGrid({ nowMs });

const site: Site = {
  id: 'site',
  name: 'Test',
  timezone: 'Europe/London',
  lat: 51.5,
  lng: -0.12,
  regionCode: 'C',
  gridConnectionKw: 65,
  demandChargePerKwMonth: 12,
  currency: 'GBP',
  defaultMode: 'balanced',
  baseLoadKw: Array.from({ length: 24 }, (_, hour) => hour),
};

const charger = (over: Partial<Charger> = {}): Charger => ({
  id: 'CP-01',
  siteId: 'site',
  ocppIdentity: 'CP-01',
  label: 'Bay 1',
  maxPowerKw: 22,
  minPowerKw: 1.4,
  connectorCount: 1,
  online: true,
  lastSeenMs: nowMs,
  vendor: null,
  model: null,
  uncontrolled: false,
  ...over,
});

const session = (over: Partial<ChargingSession> = {}): ChargingSession => ({
  id: 's1',
  siteId: 'site',
  chargerId: 'CP-01',
  connectorId: 1,
  driverId: 'drv',
  vehicleId: 'veh',
  idTag: 'TAG',
  transactionId: 1,
  source: 'app',
  status: 'active',
  mode: 'greenest',
  pluggedInMs: nowMs - 3_600_000,
  deadlineMs: nowMs + 6 * 3_600_000,
  deadlineIsDefault: false,
  unpluggedMs: null,
  energyNeededKwh: 30,
  energyDeliveredKwh: 10,
  maxPowerKw: 11,
  meterStartWh: 0,
  lastMeterWh: 10_000,
  currentPowerKw: 7,
  limitKw: 7,
  deadlineRisk: false,
  createdMs: nowMs,
  updatedMs: nowMs,
  ...over,
});

const build = (sessions: ChargingSession[], chargers: Charger[], flexEvents: FlexEvent[] = []) =>
  buildProblem({
    site,
    grid,
    sessions,
    chargers: new Map(chargers.map((entry) => [entry.id, entry])),
    carbonGPerKwh: Array<number>(grid.slots).fill(300),
    pricePerKwh: Array<number>(grid.slots).fill(0.2),
    flexEvents,
  });

describe('baseLoadForGrid', () => {
  it('reads the building profile in the site time zone, not UTC', () => {
    const base = baseLoadForGrid(site, grid);
    expect(base[0]).toBe(11);
    expect(base[4]).toBe(12);
  });
});

describe('capsForGrid', () => {
  it('is the grid connection until a flex event tightens it', () => {
    const flex: FlexEvent = {
      id: 'f1',
      siteId: 'site',
      requestedBy: 'grid',
      startsMs: nowMs + 3_600_000,
      endsMs: nowMs + 2 * 3_600_000,
      capKw: 30,
      reason: null,
      status: 'accepted',
      createdMs: nowMs,
      respondedMs: nowMs,
    };
    const caps = capsForGrid(site, grid, [flex]);
    expect(caps[0]).toBe(65);
    expect(caps[4]).toBe(30);
    expect(caps[8]).toBe(65);
  });

  it('ignores requests the operator has not accepted', () => {
    const declined: FlexEvent = {
      id: 'f2',
      siteId: 'site',
      requestedBy: 'grid',
      startsMs: nowMs,
      endsMs: nowMs + 3_600_000,
      capKw: 10,
      reason: null,
      status: 'declined',
      createdMs: nowMs,
      respondedMs: nowMs,
    };
    expect(capsForGrid(site, grid, [declined])[0]).toBe(65);
  });
});

describe('buildProblem', () => {
  it('asks only for the energy still owed, over the remaining window', () => {
    const { problem } = build([session()], [charger()]);
    const need = problem.sessions[0];
    expect(need?.energyKwh).toBe(20);
    expect(need?.maxPowerKw).toBe(11);
    // Charging cannot start before now even though the car plugged in an hour ago.
    expect(need?.availableHours[0]).toBe(0.25);
    expect(need?.availableHours.reduce((total, hours) => total + hours, 0)).toBeCloseTo(6, 6);
  });

  it('leaves out a session whose charger is offline, and says why', () => {
    const { problem, skipped } = build([session()], [charger({ online: false })]);
    expect(problem.sessions).toHaveLength(0);
    expect(skipped).toEqual([{ sessionId: 's1', reason: 'charger_offline' }]);
  });

  it('plans around a charger that will not obey by treating it as building load', () => {
    const { problem, skipped } = build([session()], [charger({ uncontrolled: true })]);
    expect(problem.sessions).toHaveLength(0);
    expect(skipped[0]?.reason).toBe('charger_uncontrolled');
    // 20 kWh at 11 kW fills the first seven slots as extra fixed load and nothing later.
    expect(problem.site.baseLoadKw[0]).toBeCloseTo(11 + 11, 6);
    // Slot 7 is 11:45 UTC, so 12:00 local building load plus the last 3 kW of the car.
    expect(problem.site.baseLoadKw[7]).toBeCloseTo(12 + 3, 6);
    // Slot 20 is 15:00 UTC, which is 16:00 in London, so only the building load remains.
    expect(problem.site.baseLoadKw[20]).toBeCloseTo(16, 6);
  });

  it('charges flat out when the deadline has already passed', () => {
    const overdueSession = session({ deadlineMs: nowMs - 60_000 });
    const { problem, overdue } = build([overdueSession], [charger()]);
    expect(overdue).toEqual(['s1']);
    const hours = problem.sessions[0]?.availableHours ?? [];
    // 20 kWh at 11 kW is 1.82 h, so about seven and a half slots are opened up.
    expect(hours.reduce((total, value) => total + value, 0)).toBeCloseTo(20 / 11, 2);
  });

  it('does not open a window for a session that is already full', () => {
    const { problem } = build([session({ energyDeliveredKwh: 30 })], [charger()]);
    expect(problem.sessions[0]?.energyKwh).toBe(0);
  });

  it('takes the peak weight from the site default mode', () => {
    const { problem } = build([session()], [charger()]);
    expect(problem.site.peakWeight).toBe(0.3);
    expect(problem.site.gridConnectionKw).toBe(65);
  });
});
