import {
  MS_PER_HOUR,
  clamp,
  gToKg,
  round,
  seriesStepMs,
  whToKwh,
  type MeterReading,
  type SessionReport,
  type StepSeries,
} from '@cleangrid/shared';

/**
 * What the session actually cost the planet and the driver, measured rather than assumed.
 *
 * Energy comes from meter readings, not from the plan. Emissions come from the grid intensity at
 * the moment each kWh was drawn. The counterfactual is a dumb charger: the same energy at full
 * power from the moment the cable went in, which is what would have happened without us.
 */

export class MeterDataError extends Error {
  override readonly name = 'MeterDataError';
}

export interface EnergyInterval {
  readonly fromMs: number;
  readonly toMs: number;
  readonly kwh: number;
}

/** Consecutive register readings become intervals of constant power. */
export function intervalsFromReadings(readings: readonly MeterReading[]): EnergyInterval[] {
  const ordered = [...readings].sort((a, b) => a.tsMs - b.tsMs);
  const intervals: EnergyInterval[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1] as MeterReading;
    const current = ordered[index] as MeterReading;
    const deltaWh = current.energyWh - previous.energyWh;
    if (deltaWh < 0) {
      throw new MeterDataError(
        `meter register fell from ${previous.energyWh} Wh to ${current.energyWh} Wh; readings cannot be trusted`,
      );
    }
    if (deltaWh === 0) continue;
    intervals.push({ fromMs: previous.tsMs, toMs: current.tsMs, kwh: whToKwh(deltaWh) });
  }
  return intervals;
}

export const totalKwh = (intervals: readonly EnergyInterval[]): number =>
  intervals.reduce((total, interval) => total + interval.kwh, 0);

/**
 * Weight each kWh by the series value at the time it was drawn, splitting an interval that
 * straddles a step boundary in proportion to the time spent in each step.
 */
export function weightedSum(intervals: readonly EnergyInterval[], series: StepSeries): number {
  const stepMs = seriesStepMs(series);
  const lastIndex = series.values.length - 1;
  if (lastIndex < 0) throw new MeterDataError('cannot weight energy against an empty series');
  const valueAtIndex = (index: number): number => series.values[clamp(index, 0, lastIndex)] as number;

  let total = 0;
  for (const interval of intervals) {
    const durationMs = interval.toMs - interval.fromMs;
    if (durationMs <= 0) {
      total += interval.kwh * valueAtIndex(Math.floor((interval.fromMs - series.startMs) / stepMs));
      continue;
    }
    const firstIndex = Math.floor((interval.fromMs - series.startMs) / stepMs);
    const lastStep = Math.floor((interval.toMs - 1 - series.startMs) / stepMs);
    for (let index = firstIndex; index <= lastStep; index += 1) {
      const stepStartMs = series.startMs + index * stepMs;
      const overlapMs = Math.min(interval.toMs, stepStartMs + stepMs) - Math.max(interval.fromMs, stepStartMs);
      if (overlapMs <= 0) continue;
      total += interval.kwh * (overlapMs / durationMs) * valueAtIndex(index);
    }
  }
  return total;
}

export interface EnergyFacts {
  readonly energyKwh: number;
  readonly cost: number;
  readonly co2Kg: number;
  readonly renewableShare: number;
  readonly avgCarbonGPerKwh: number;
}

export interface SignalSeries {
  readonly carbon: StepSeries;
  readonly price: StepSeries;
  readonly renewable: StepSeries;
}

export function summarise(intervals: readonly EnergyInterval[], signals: SignalSeries): EnergyFacts {
  const energyKwh = totalKwh(intervals);
  if (energyKwh <= 0) {
    return { energyKwh: 0, cost: 0, co2Kg: 0, renewableShare: 0, avgCarbonGPerKwh: 0 };
  }
  const carbonG = weightedSum(intervals, signals.carbon);
  return {
    energyKwh,
    cost: weightedSum(intervals, signals.price),
    co2Kg: gToKg(carbonG),
    renewableShare: weightedSum(intervals, signals.renewable) / energyKwh,
    avgCarbonGPerKwh: carbonG / energyKwh,
  };
}

export interface BaselineInput {
  readonly pluggedInMs: number;
  readonly energyKwh: number;
  readonly maxPowerKw: number;
}

/** The dumb charger: full power from plug-in until the same energy has been delivered. */
export function baselineIntervals(input: BaselineInput): EnergyInterval[] {
  if (input.energyKwh <= 0) return [];
  if (input.maxPowerKw <= 0) throw new MeterDataError('a baseline needs a positive charging power');
  const durationMs = (input.energyKwh / input.maxPowerKw) * MS_PER_HOUR;
  return [{ fromMs: input.pluggedInMs, toMs: input.pluggedInMs + durationMs, kwh: input.energyKwh }];
}

export interface GreenScoreInput {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly achievedCarbonGPerKwh: number;
  readonly carbon: StepSeries;
}

export interface GreenScore {
  readonly score: number;
  readonly minCarbonGPerKwh: number;
  readonly maxCarbonGPerKwh: number;
}

/**
 * Where the session landed inside the range of grid intensities its parked window offered.
 * 100 means it used the cleanest power available to it, 0 the dirtiest. A driver whose window
 * offered no choice at all scores 100: they cannot do better than what was on offer.
 */
export function greenScore(input: GreenScoreInput): GreenScore {
  const stepMs = seriesStepMs(input.carbon);
  const lastIndex = input.carbon.values.length - 1;
  const firstStep = clamp(Math.floor((input.windowStartMs - input.carbon.startMs) / stepMs), 0, lastIndex);
  const lastStep = clamp(Math.floor((input.windowEndMs - 1 - input.carbon.startMs) / stepMs), 0, lastIndex);
  const window = input.carbon.values.slice(firstStep, lastStep + 1);
  const values = window.length > 0 ? window : [input.achievedCarbonGPerKwh];

  const minCarbonGPerKwh = Math.min(...values);
  const maxCarbonGPerKwh = Math.max(...values);
  const spread = maxCarbonGPerKwh - minCarbonGPerKwh;
  const score = spread < 1 ? 100 : 100 * ((maxCarbonGPerKwh - input.achievedCarbonGPerKwh) / spread);
  return {
    score: Math.round(clamp(score, 0, 100)),
    minCarbonGPerKwh: round(minCarbonGPerKwh, 1),
    maxCarbonGPerKwh: round(maxCarbonGPerKwh, 1),
  };
}

export interface BuildReportInput {
  readonly sessionId: string;
  readonly readings: readonly MeterReading[];
  readonly pluggedInMs: number;
  readonly unpluggedMs: number;
  readonly maxPowerKw: number;
  readonly signals: SignalSeries;
  /** "actual" when the carbon series is measured rather than forecast. */
  readonly carbonBasis: 'actual' | 'forecast';
  /** Used only when there are no meter readings, and then the report is marked unverified. */
  readonly plannedKwh?: number;
  readonly computedMs: number;
}

export function buildSessionReport(input: BuildReportInput): SessionReport {
  const measured = intervalsFromReadings(input.readings);
  const verified = measured.length > 0;
  const intervals = verified
    ? measured
    : baselineIntervals({
        pluggedInMs: input.pluggedInMs,
        energyKwh: input.plannedKwh ?? 0,
        maxPowerKw: input.maxPowerKw,
      });

  const actual = summarise(intervals, input.signals);
  const baseline = summarise(
    baselineIntervals({ pluggedInMs: input.pluggedInMs, energyKwh: actual.energyKwh, maxPowerKw: input.maxPowerKw }),
    input.signals,
  );
  const score = greenScore({
    windowStartMs: input.pluggedInMs,
    windowEndMs: input.unpluggedMs,
    achievedCarbonGPerKwh: actual.avgCarbonGPerKwh,
    carbon: input.signals.carbon,
  });

  return {
    sessionId: input.sessionId,
    energyKwh: round(actual.energyKwh, 3),
    cost: round(actual.cost, 4),
    co2Kg: round(actual.co2Kg, 4),
    renewableShare: round(actual.renewableShare, 4),
    avgCarbonGPerKwh: round(actual.avgCarbonGPerKwh, 1),
    baselineCost: round(baseline.cost, 4),
    baselineCo2Kg: round(baseline.co2Kg, 4),
    avoidedCo2Kg: round(baseline.co2Kg - actual.co2Kg, 4),
    costSaved: round(baseline.cost - actual.cost, 4),
    greenScore: score.score,
    windowMinCarbonGPerKwh: score.minCarbonGPerKwh,
    windowMaxCarbonGPerKwh: score.maxCarbonGPerKwh,
    verified,
    carbonBasis: input.carbonBasis,
    computedMs: input.computedMs,
  };
}
