import { clamp, MS_PER_MINUTE } from './units';

/** Evenly stepped time series (carbon intensity, price, renewable share...). */
export interface StepSeries {
  readonly startMs: number;
  readonly stepMinutes: number;
  readonly values: readonly number[];
}

export function makeSeries(startMs: number, stepMinutes: number, values: readonly number[]): StepSeries {
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0) {
    throw new RangeError(`stepMinutes must be a positive integer, got ${stepMinutes}`);
  }
  return Object.freeze({ startMs, stepMinutes, values: Object.freeze([...values]) });
}

export const seriesStepMs = (series: StepSeries): number => series.stepMinutes * MS_PER_MINUTE;
export const seriesEndMs = (series: StepSeries): number =>
  series.startMs + series.values.length * seriesStepMs(series);

export function seriesIndexAt(series: StepSeries, ms: number): number {
  return Math.floor((ms - series.startMs) / seriesStepMs(series));
}

/** Value of the step containing `ms`, or undefined outside the series. */
export function valueAt(series: StepSeries, ms: number): number | undefined {
  const index = seriesIndexAt(series, ms);
  return index >= 0 && index < series.values.length ? series.values[index] : undefined;
}

/** Value of the step containing `ms`, holding the first/last value outside the series. */
export function valueAtClamped(series: StepSeries, ms: number): number {
  if (series.values.length === 0) throw new RangeError('cannot sample an empty series');
  const index = clamp(seriesIndexAt(series, ms), 0, series.values.length - 1);
  return series.values[index] as number;
}

/** Sample `count` steps of `stepMinutes` from `startMs`, reading each step at its midpoint. */
export function sampleSeries(series: StepSeries, startMs: number, stepMinutes: number, count: number): number[] {
  const stepMs = stepMinutes * MS_PER_MINUTE;
  return Array.from({ length: count }, (_, index) => valueAtClamped(series, startMs + index * stepMs + stepMs / 2));
}
