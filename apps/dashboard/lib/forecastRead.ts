import { clockTime } from './format';
import type { Forecast, Session } from './types';

/**
 * Reading a forecast the way an operator would, in sentences that stay true to the numbers.
 *
 * The design gives three moments a day has: solar lifting the grid, an evening price peak, wind
 * returning overnight. Not every grid has all three. Gujarat's nights are calm and run on firm
 * power, so "wind returns" would be a sentence written for Britain and shown to someone in
 * Gandhinagar. Each moment is found in the data, and its copy is chosen by what the data shows.
 */

export interface Sample {
  readonly index: number;
  readonly ms: number;
  readonly renewable: number;
  readonly carbon: number;
  readonly price: number;
}

export function sampleAt(forecast: Forecast, index: number): Sample {
  const i = Math.max(0, Math.min(forecast.carbonGPerKwh.length - 1, index));
  return {
    index: i,
    ms: forecast.startMs + i * forecast.stepMinutes * 60_000,
    renewable: forecast.renewableShare[i] ?? 0,
    carbon: forecast.carbonGPerKwh[i] ?? 0,
    price: forecast.pricePerKwh[i] ?? 0,
  };
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const quantile = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
};

/** One line on what a moment means for flexible charging. */
export function recommendation(forecast: Forecast, index: number): string {
  const sample = sampleAt(forecast, index);
  const window = forecast.greenWindow;
  if (window && sample.ms >= window.startMs && sample.ms < window.endMs) return 'Inside the best window. Flexible cars charge here.';
  if (sample.carbon >= quantile(forecast.carbonGPerKwh, 0.75)) return 'Among the dirtiest hours. Only cars that must finish charge now.';
  if (sample.carbon <= quantile(forecast.carbonGPerKwh, 0.25)) return 'A clean hour. Good for any car that can use it.';
  return 'An ordinary hour. The plan uses it if a car needs the time.';
}

export function hourIndex(forecast: Forecast, ms: number): number {
  return Math.round((ms - forecast.startMs) / (forecast.stepMinutes * 60_000));
}

export interface Moment {
  readonly key: 'solar' | 'price' | 'night';
  readonly title: string;
  readonly copy: string;
  readonly ms: number;
  readonly time: string;
  readonly icon: 'sun' | 'bolt' | 'wind' | 'moon';
}

export function momentsOf(forecast: Forecast, timezone: string): Moment[] {
  const samples = forecast.carbonGPerKwh.map((_, index) => sampleAt(forecast, index));
  const hourOf = (ms: number): number => Number(clockTime(ms, timezone).slice(0, 2));
  const priceMedian = median(forecast.pricePerKwh);
  const shareMedian = median(forecast.renewableShare);

  const daylight = samples.filter((sample) => {
    const hour = hourOf(sample.ms);
    return hour >= 8 && hour <= 16;
  });
  const sunniest = (daylight.length > 0 ? daylight : samples).reduce((best, sample) => (sample.renewable > best.renewable ? sample : best));
  const priciest = samples.reduce((best, sample) => (sample.price > best.price ? sample : best));

  const night = samples.filter((sample) => {
    const hour = hourOf(sample.ms);
    return hour >= 22 || hour <= 4;
  });
  const evening = samples.filter((sample) => {
    const hour = hourOf(sample.ms);
    return hour >= 18 && hour <= 21;
  });
  const average = (list: readonly Sample[]): number => (list.length === 0 ? 0 : list.reduce((sum, sample) => sum + sample.renewable, 0) / list.length);
  const windBack = night.length > 0 && average(night) > average(evening) + 0.04;
  const nightStart = night.find((sample) => hourOf(sample.ms) === 0) ?? night[0] ?? samples[samples.length - 1]!;

  return [
    {
      key: 'solar',
      title: 'Solar lift',
      copy:
        sunniest.price <= priceMedian
          ? 'Rising solar generation from late morning brings cleaner, cheaper power.'
          : 'Rising solar generation from late morning brings cleaner power, though prices stay above the day’s middle.',
      ms: sunniest.ms,
      time: clockTime(sunniest.ms, timezone),
      icon: 'sun',
    },
    {
      key: 'price',
      title: priciest.renewable < shareMedian ? 'Evening price peak' : 'Price peak',
      copy:
        priciest.renewable < shareMedian
          ? 'Demand rises in the early evening, pushing prices higher and reducing the renewable share.'
          : 'Prices reach their highest here, while the renewable share holds. Cost-sensitive cars wait it out.',
      ms: priciest.ms,
      time: clockTime(priciest.ms, timezone),
      icon: 'bolt',
    },
    windBack
      ? {
          key: 'night',
          title: 'Wind returns overnight',
          copy: 'Stronger wind generation later in the night brings cleaner power back to the grid.',
          ms: nightStart.ms,
          time: `From ${clockTime(nightStart.ms, timezone)}`,
          icon: 'wind',
        }
      : {
          key: 'night',
          title: 'A still night on firm power',
          copy: 'Little wind is forecast tonight, so the overnight grid stays on firm generation. Cheap, but not clean.',
          ms: nightStart.ms,
          time: `From ${clockTime(nightStart.ms, timezone)}`,
          icon: 'moon',
        },
  ];
}

/** The hour it costs the grid most to draw from, by carbon. */
export function worstHour(forecast: Forecast): Sample {
  const samples = forecast.carbonGPerKwh.map((_, index) => sampleAt(forecast, index));
  return samples.reduce((worst, sample) => (sample.carbon > worst.carbon ? sample : worst));
}

/**
 * Cars that could safely move into a window: still needing energy, not already at risk, and not
 * due to leave before the window closes.
 */
export function flexibleInto(window: { startMs: number; endMs: number }, sessions: readonly Session[]): Session[] {
  return sessions.filter(
    (session) =>
      session.status === 'active' &&
      !session.deadlineRisk &&
      session.energyNeededKwh - session.energyDeliveredKwh > 0.05 &&
      session.deadlineMs >= window.endMs,
  );
}

/** A source that is a model rather than a measurement says so, next to its name. */
export const isModelled = (source: string): boolean => /model|synthetic|tariff for|derived/i.test(source);
