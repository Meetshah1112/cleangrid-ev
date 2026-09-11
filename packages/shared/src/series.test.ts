import { describe, expect, it } from 'vitest';
import { makeSeries, sampleSeries, seriesEndMs, valueAt, valueAtClamped } from './series';

const start = Date.parse('2026-09-12T00:00:00Z');
const minutes = (n: number): number => n * 60_000;

describe('StepSeries', () => {
  const series = makeSeries(start, 30, [100, 200, 300]);

  it('reads the step containing an instant', () => {
    expect(valueAt(series, start + minutes(45))).toBe(200);
    expect(valueAt(series, start - 1)).toBeUndefined();
    expect(valueAt(series, seriesEndMs(series))).toBeUndefined();
  });

  it('holds the edge values when clamped', () => {
    expect(valueAtClamped(series, start - minutes(60))).toBe(100);
    expect(valueAtClamped(series, start + minutes(600))).toBe(300);
  });

  it('resamples a 30-minute series onto 15-minute steps', () => {
    expect(sampleSeries(series, start, 15, 6)).toEqual([100, 100, 200, 200, 300, 300]);
  });

  it('copies and freezes its values', () => {
    const source = [1, 2];
    const frozen = makeSeries(start, 15, source);
    source[0] = 99;
    expect(frozen.values[0]).toBe(1);
    expect(Object.isFrozen(frozen.values)).toBe(true);
  });

  it('rejects invalid steps and empty sampling', () => {
    expect(() => makeSeries(start, 0, [1])).toThrow(RangeError);
    expect(() => valueAtClamped(makeSeries(start, 15, []), start)).toThrow(RangeError);
  });
});
