import { describe, expect, it } from 'vitest';
import { parseScenario, rebaseScenario, resolveArrivals, ScenarioError, scenarioStartMs } from './scenario';

const arrival = {
  id: 'a1',
  chargerId: 'c1',
  driverId: 'd1',
  vehicleId: 'v1',
  arriveAt: '2026-09-12T08:00',
  departAt: '2026-09-12T17:30',
  deadlineAt: '2026-09-12T17:00',
  energyKwh: 20,
  startSoc: 0.3,
};

const base = {
  name: 'test',
  day: '2026-09-12',
  simStart: '2026-09-12T06:00',
  site: {
    id: 'site-1',
    name: 'Test Site',
    timezone: 'Europe/London',
    lat: 51.5,
    lng: -0.12,
    regionCode: 'C',
    gridConnectionKw: 50,
    demandChargePerKwMonth: 10,
    currency: 'GBP',
    defaultMode: 'balanced',
    baseLoadKw: Array(24).fill(5),
  },
  chargers: [{ id: 'c1', ocppIdentity: 'CG-01', label: 'Bay 1', maxPowerKw: 22, minPowerKw: 1.4 }],
  drivers: [{ id: 'd1', displayName: 'Driver One', idTag: 'TAG1' }],
  vehicles: [{ id: 'v1', driverId: 'd1', label: 'Car', batteryKwh: 60, maxChargeKw: 11 }],
  arrivals: [arrival],
};

const withArrival = (patch: Record<string, unknown>) => ({ ...base, arrivals: [{ ...arrival, ...patch }] });

describe('parseScenario', () => {
  it('parses a valid scenario and applies defaults', () => {
    const scenario = parseScenario(base);
    expect(scenario.chargers[0]?.connectors).toBe(1);
    expect(scenario.arrivals[0]?.via).toBe('app');
    expect(scenario.arrivals[0]?.mode).toBe('balanced');
    expect(scenario.drivers[0]?.defaultDwellHours).toBe(8);
    expect(scenario.staff).toEqual([]);
  });

  it('rejects references to unknown chargers with the offending path', () => {
    expect(() => parseScenario(withArrival({ chargerId: 'nope' }))).toThrow(/arrivals\.0\.chargerId: unknown charger nope/);
  });

  it('rejects a vehicle that belongs to another driver', () => {
    const scenario = {
      ...base,
      drivers: [...base.drivers, { id: 'd2', displayName: 'Driver Two', idTag: 'TAG2' }],
      vehicles: [...base.vehicles, { id: 'v2', driverId: 'd2', label: 'Other', batteryKwh: 40, maxChargeKw: 7 }],
    };
    expect(() => parseScenario({ ...scenario, arrivals: [{ ...arrival, vehicleId: 'v2' }] })).toThrow(
      /belongs to another driver/,
    );
  });

  it('rejects departures before arrival and deadlines before arrival', () => {
    expect(() => parseScenario(withArrival({ departAt: '2026-09-12T07:00' }))).toThrow(/departAt must be after/);
    expect(() => parseScenario(withArrival({ deadlineAt: '2026-09-12T08:00' }))).toThrow(/deadlineAt must be after/);
  });

  it('rejects duplicate idTags and unknown time zones', () => {
    const dupTags = { ...base, drivers: [...base.drivers, { id: 'd2', displayName: 'Two', idTag: 'TAG1' }] };
    expect(() => parseScenario(dupTags)).toThrow(/duplicate idTag TAG1/);
    expect(() => parseScenario({ ...base, site: { ...base.site, timezone: 'Mars/Base' } })).toThrow(ScenarioError);
  });

  it('rejects malformed local times', () => {
    expect(() => parseScenario(withArrival({ arriveAt: '08:00' }))).toThrow(/YYYY-MM-DDTHH:MM/);
  });
});

describe('scenario time handling', () => {
  const scenario = parseScenario(base);

  it('resolves site-local times to UTC', () => {
    const [resolved] = resolveArrivals(scenario);
    expect(resolved?.arriveMs).toBe(Date.parse('2026-09-12T07:00:00Z'));
    expect(resolved?.deadlineMs).toBe(Date.parse('2026-09-12T16:00:00Z'));
    expect(scenarioStartMs(scenario)).toBe(Date.parse('2026-09-12T05:00:00Z'));
  });

  it('rebases every time onto another day', () => {
    const moved = rebaseScenario(scenario, '2026-10-01');
    expect(moved.day).toBe('2026-10-01');
    expect(moved.simStart).toBe('2026-10-01T06:00');
    expect(moved.arrivals[0]?.deadlineAt).toBe('2026-10-01T17:00');
    expect(scenario.arrivals[0]?.deadlineAt).toBe('2026-09-12T17:00');
    expect(rebaseScenario(scenario, scenario.day)).toBe(scenario);
  });
});
