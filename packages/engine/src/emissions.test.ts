import { makeSeries, type MeterReading } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import {
  MeterDataError,
  baselineIntervals,
  buildSessionReport,
  greenScore,
  intervalsFromReadings,
  summarise,
  totalKwh,
  weightedSum,
} from './emissions';

const start = Date.parse('2026-09-12T08:00:00Z');
const minutes = (n: number): number => start + n * 60_000;

/** Four hours at 15-minute steps: clean first hour, dirty second, clean again. */
const carbon = makeSeries(start, 60, [100, 800, 200, 200]);
const price = makeSeries(start, 60, [0.1, 0.5, 0.2, 0.2]);
const renewable = makeSeries(start, 60, [0.8, 0.1, 0.6, 0.6]);
const signals = { carbon, price, renewable };

const reading = (tsMs: number, energyWh: number): MeterReading => ({
  sessionId: 's1',
  tsMs,
  energyWh,
  powerW: 0,
  soc: null,
});

describe('intervalsFromReadings', () => {
  it('turns register readings into intervals of energy', () => {
    const intervals = intervalsFromReadings([reading(minutes(0), 1000), reading(minutes(30), 4000), reading(minutes(60), 7000)]);
    expect(intervals).toHaveLength(2);
    expect(totalKwh(intervals)).toBeCloseTo(6, 9);
  });

  it('ignores readings where nothing was drawn and sorts out-of-order readings', () => {
    const intervals = intervalsFromReadings([reading(minutes(30), 4000), reading(minutes(0), 4000), reading(minutes(60), 5000)]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.kwh).toBeCloseTo(1, 9);
  });

  it('refuses to guess when the register goes backwards', () => {
    expect(() => intervalsFromReadings([reading(minutes(0), 5000), reading(minutes(30), 1000)])).toThrow(MeterDataError);
  });
});

describe('weightedSum', () => {
  it('splits an interval across step boundaries in proportion to time', () => {
    // 4 kWh drawn evenly from 08:30 to 09:30: half in the 100 g hour, half in the 800 g hour.
    const grams = weightedSum([{ fromMs: minutes(30), toMs: minutes(90), kwh: 4 }], carbon);
    expect(grams).toBeCloseTo(2 * 100 + 2 * 800, 6);
  });

  it('holds the edge values for energy drawn outside the series', () => {
    expect(weightedSum([{ fromMs: start - 3_600_000, toMs: start - 1_800_000, kwh: 1 }], carbon)).toBeCloseTo(100, 6);
  });

  it('handles an instantaneous reading', () => {
    expect(weightedSum([{ fromMs: minutes(70), toMs: minutes(70), kwh: 2 }], carbon)).toBeCloseTo(1600, 6);
  });
});

describe('summarise', () => {
  it('reports energy, cost, CO2 and renewable share together', () => {
    const facts = summarise([{ fromMs: minutes(0), toMs: minutes(60), kwh: 10 }], signals);
    expect(facts.energyKwh).toBe(10);
    expect(facts.cost).toBeCloseTo(1, 9);
    expect(facts.co2Kg).toBeCloseTo(1, 9);
    expect(facts.renewableShare).toBeCloseTo(0.8, 9);
    expect(facts.avgCarbonGPerKwh).toBeCloseTo(100, 9);
  });

  it('is all zeros when no energy flowed', () => {
    expect(summarise([], signals).energyKwh).toBe(0);
  });
});

describe('baselineIntervals', () => {
  it('draws full power from the moment of plug-in', () => {
    const [interval] = baselineIntervals({ pluggedInMs: start, energyKwh: 11, maxPowerKw: 11 });
    expect(interval?.fromMs).toBe(start);
    expect(interval?.toMs).toBe(minutes(60));
    expect(interval?.kwh).toBe(11);
  });

  it('is empty when nothing was needed', () => {
    expect(baselineIntervals({ pluggedInMs: start, energyKwh: 0, maxPowerKw: 11 })).toEqual([]);
  });
});

describe('greenScore', () => {
  const windowStartMs = start;
  const windowEndMs = minutes(240);

  it('scores the cleanest choice 100 and the dirtiest 0', () => {
    expect(greenScore({ windowStartMs, windowEndMs, achievedCarbonGPerKwh: 100, carbon }).score).toBe(100);
    expect(greenScore({ windowStartMs, windowEndMs, achievedCarbonGPerKwh: 800, carbon }).score).toBe(0);
  });

  it('scores the middle of the available range around the middle', () => {
    const score = greenScore({ windowStartMs, windowEndMs, achievedCarbonGPerKwh: 450, carbon });
    expect(score.score).toBe(50);
    expect(score.minCarbonGPerKwh).toBe(100);
    expect(score.maxCarbonGPerKwh).toBe(800);
  });

  it('gives full marks when the window offered no choice', () => {
    const flat = makeSeries(start, 60, [300, 300, 300]);
    expect(greenScore({ windowStartMs, windowEndMs, achievedCarbonGPerKwh: 300, carbon: flat }).score).toBe(100);
  });
});

describe('buildSessionReport', () => {
  const base = {
    sessionId: 's1',
    pluggedInMs: start,
    unpluggedMs: minutes(240),
    maxPowerKw: 10,
    signals,
    carbonBasis: 'actual' as const,
    computedMs: minutes(240),
  };

  it('measures what happened and compares it with a dumb charger', () => {
    // 10 kWh drawn in the third hour (200 g/kWh) instead of at once from plug-in (100 g/kWh).
    const report = buildSessionReport({
      ...base,
      readings: [reading(minutes(120), 0), reading(minutes(180), 10_000)],
    });
    expect(report.verified).toBe(true);
    expect(report.energyKwh).toBe(10);
    expect(report.co2Kg).toBeCloseTo(2, 6);
    expect(report.baselineCo2Kg).toBeCloseTo(1, 6);
    expect(report.avoidedCo2Kg).toBeCloseTo(-1, 6);
  });

  it('credits a session that moved off the dirty hour', () => {
    // Plugged in at the start of the 800 g hour but charged during the 200 g hour instead.
    const report = buildSessionReport({
      ...base,
      pluggedInMs: minutes(60),
      readings: [reading(minutes(120), 0), reading(minutes(180), 10_000)],
    });
    expect(report.baselineCo2Kg).toBeCloseTo(8, 6);
    expect(report.co2Kg).toBeCloseTo(2, 6);
    expect(report.avoidedCo2Kg).toBeCloseTo(6, 6);
    expect(report.costSaved).toBeCloseTo(3, 6);
    expect(report.greenScore).toBeGreaterThan(80);
  });

  it('falls back to the planned energy and says it is not verified', () => {
    const report = buildSessionReport({ ...base, readings: [], plannedKwh: 5 });
    expect(report.verified).toBe(false);
    expect(report.energyKwh).toBe(5);
    expect(report.avoidedCo2Kg).toBe(0);
  });

  it('reports zeros for a session that drew nothing', () => {
    const report = buildSessionReport({ ...base, readings: [reading(minutes(0), 1000), reading(minutes(60), 1000)] });
    expect(report.energyKwh).toBe(0);
    expect(report.avoidedCo2Kg).toBe(0);
    expect(report.verified).toBe(false);
  });
});
