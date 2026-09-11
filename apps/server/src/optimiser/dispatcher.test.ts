import { createSlotGrid, type ChargingSession } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { buildChargingProfile, buildDispatch } from './dispatcher';

const grid = createSlotGrid({ nowMs: Date.parse('2026-09-12T10:00:00Z') });

const session = (over: Partial<ChargingSession> = {}): ChargingSession => ({
  id: 's1',
  siteId: 'site',
  chargerId: 'CP-01',
  connectorId: 1,
  driverId: 'drv',
  vehicleId: 'veh',
  idTag: 'TAG',
  transactionId: 1001,
  source: 'app',
  status: 'active',
  mode: 'balanced',
  pluggedInMs: grid.nowMs,
  deadlineMs: grid.nowMs + 8 * 3_600_000,
  deadlineIsDefault: false,
  unpluggedMs: null,
  energyNeededKwh: 20,
  energyDeliveredKwh: 0,
  maxPowerKw: 11,
  meterStartWh: 0,
  lastMeterWh: 0,
  currentPowerKw: 0,
  limitKw: null,
  deadlineRisk: false,
  createdMs: grid.nowMs,
  updatedMs: grid.nowMs,
  ...over,
});

const base = {
  grid,
  minPowerKw: () => 1.4,
  maxPowerKw: () => 22,
  lookaheadPeriods: 3,
  hysteresisW: 250,
};

describe('buildDispatch', () => {
  it('turns the next slots of the plan into watt periods', () => {
    const decision = buildDispatch({
      ...base,
      sessions: [session()],
      allocationsKw: { s1: [7.4, 7.4, 3, 0] },
      lastSentW: new Map(),
    });
    expect(decision.send).toHaveLength(1);
    expect(decision.send[0]?.limitW).toBe(7400);
    // Repeated limits collapse into one period, as a charger expects.
    expect(decision.send[0]?.periods).toEqual([
      { startPeriodS: 0, limitW: 7400 },
      { startPeriodS: 1800, limitW: 3000 },
    ]);
  });

  it('asks for nothing rather than a trickle the charger cannot hold', () => {
    const decision = buildDispatch({
      ...base,
      sessions: [session()],
      allocationsKw: { s1: [0.9, 1.4, 2] },
      lastSentW: new Map(),
    });
    expect(decision.send[0]?.periods[0]).toEqual({ startPeriodS: 0, limitW: 0 });
  });

  it('never asks for more than the charger or the car can take', () => {
    const decision = buildDispatch({
      ...base,
      maxPowerKw: () => 7.4,
      sessions: [session({ maxPowerKw: 6.6 })],
      allocationsKw: { s1: [11, 11, 11] },
      lastSentW: new Map(),
    });
    expect(decision.send[0]?.limitW).toBe(6600);
  });

  it('keeps quiet when the setpoint has barely moved', () => {
    const lastSentW = new Map([['s1', [7400, 7400, 3000]]]);
    const unchanged = buildDispatch({
      ...base,
      sessions: [session()],
      allocationsKw: { s1: [7.5, 7.35, 3.1] },
      lastSentW,
    });
    expect(unchanged.send).toHaveLength(0);
    expect(unchanged.unchanged).toEqual(['s1']);

    const moved = buildDispatch({
      ...base,
      sessions: [session()],
      allocationsKw: { s1: [7.4, 7.4, 0] },
      lastSentW,
    });
    expect(moved.send).toHaveLength(1);
  });

  it('ignores sessions that are not charging', () => {
    const decision = buildDispatch({
      ...base,
      sessions: [session({ status: 'pending', transactionId: null }), session({ id: 's2', status: 'complete' })],
      allocationsKw: { s1: [7, 7, 7], s2: [7, 7, 7] },
      lastSentW: new Map(),
    });
    expect(decision.send).toHaveLength(0);
  });

  it('sends zeros for a session the plan gives no power', () => {
    const decision = buildDispatch({
      ...base,
      sessions: [session()],
      allocationsKw: {},
      lastSentW: new Map(),
    });
    expect(decision.send[0]?.periods).toEqual([{ startPeriodS: 0, limitW: 0 }]);
  });
});

describe('buildChargingProfile', () => {
  it('anchors the schedule to the start of the current slot', () => {
    const decision = buildDispatch({
      ...base,
      sessions: [session()],
      allocationsKw: { s1: [7.4, 0, 0] },
      lastSentW: new Map(),
    });
    const profile = buildChargingProfile(decision.send[0]!, grid, 7, 3);
    expect(profile.chargingProfileId).toBe(7);
    expect(profile.transactionId).toBe(1001);
    expect(profile.chargingProfilePurpose).toBe('TxProfile');
    expect(profile.stackLevel).toBe(1);
    expect(profile.chargingSchedule.chargingRateUnit).toBe('W');
    expect(profile.chargingSchedule.startSchedule).toBe('2026-09-12T10:00:00.000Z');
    expect(profile.chargingSchedule.duration).toBe(2700);
  });
});
