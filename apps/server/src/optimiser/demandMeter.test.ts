import { ManualClock, type ChargingSession, type MeterReading, type Site } from '@cleangrid/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../events';
import { DemandMeter } from './demandMeter';

const startMs = Date.parse('2026-09-12T10:00:00Z');

const site: Site = {
  id: 'site',
  name: 'Test',
  timezone: 'UTC',
  lat: 51.5,
  lng: -0.12,
  regionCode: 'C',
  gridConnectionKw: 65,
  demandChargePerKwMonth: 12,
  currency: 'GBP',
  defaultMode: 'balanced',
  baseLoadKw: Array<number>(24).fill(10),
};

const session = (id: string, deliveredKwh: number, updatedMs: number): ChargingSession =>
  ({ id, siteId: 'site', energyDeliveredKwh: deliveredKwh, updatedMs, unpluggedMs: null }) as ChargingSession;

const reading = {} as MeterReading;

describe('DemandMeter', () => {
  let bus: EventBus;
  let clock: ManualClock;
  let meter: DemandMeter;

  beforeEach(() => {
    bus = new EventBus();
    clock = new ManualClock(startMs);
    meter = new DemandMeter({ bus, clock, site, slotMinutes: 15 });
    meter.start();
  });

  const report = (id: string, deliveredKwh: number, tsMs: number): void => {
    clock.set(tsMs);
    bus.emit('meter.updated', { session: session(id, deliveredKwh, tsMs), reading });
  };

  it('reports the building load when nothing is charging', () => {
    clock.set(startMs + 20 * 60_000);
    expect(meter.peakKw).toBe(10);
  });

  it('averages charging over the metering interval, not the instant', () => {
    report('a', 0, startMs);
    // 2.5 kWh in a quarter hour is 10 kW, on top of 10 kW of building load.
    report('a', 2.5, startMs + 15 * 60_000);
    clock.set(startMs + 30 * 60_000);
    expect(meter.peakKw).toBeCloseTo(20, 6);
  });

  it('spreads energy drawn across a boundary over both intervals', () => {
    report('a', 0, startMs + 10 * 60_000);
    // 4 kWh over ten minutes that straddles the boundary: half falls in each interval.
    report('a', 4, startMs + 20 * 60_000);
    clock.set(startMs + 40 * 60_000);
    // 2 kWh in each of two quarter-hour intervals is 8 kW of charging plus 10 kW of base.
    expect(meter.peakKw).toBeCloseTo(18, 6);
  });

  it('adds up every car in the same interval', () => {
    report('a', 0, startMs);
    report('b', 0, startMs);
    report('a', 2.5, startMs + 15 * 60_000);
    report('b', 1.25, startMs + 15 * 60_000);
    clock.set(startMs + 30 * 60_000);
    expect(meter.peakKw).toBeCloseTo(10 + 10 + 5, 6);
  });

  it('ignores an interval that has not finished yet', () => {
    report('a', 0, startMs);
    report('a', 10, startMs + 5 * 60_000);
    // Still inside the first interval: it cannot be scored until it ends.
    expect(meter.peakKw).toBe(10);
  });

  it('stops counting after the meter stops moving', () => {
    report('a', 0, startMs);
    report('a', 2.5, startMs + 15 * 60_000);
    clock.set(startMs + 60 * 60_000);
    const peak = meter.peakKw;
    clock.set(startMs + 120 * 60_000);
    expect(meter.peakKw).toBe(peak);
  });
});
