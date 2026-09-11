import { MS_PER_MINUTE, localHourOfDay, makeSeries, type ForecastSnapshot, type Site } from '@cleangrid/shared';

/**
 * A deterministic stand-in for live grid data: clean and cheap overnight and at midday, dirty and
 * expensive through the evening peak. Used offline, in tests, and as the last fallback when every
 * external source fails mid-demo.
 */

type Curve = readonly (readonly [hour: number, value: number])[];

/** gCO2/kWh: midday solar near 190, evening peak near 690. */
const CARBON: Curve = [
  [0, 230],
  [3, 195],
  [6, 300],
  [9, 420],
  [12, 190],
  [15, 210],
  [18, 690],
  [21, 420],
];

/** Currency per kWh, shaped like a UK agile tariff. */
const PRICE: Curve = [
  [0, 0.09],
  [3, 0.08],
  [6, 0.14],
  [9, 0.22],
  [12, 0.16],
  [15, 0.18],
  [18, 0.42],
  [21, 0.24],
];

/** Share of generation from renewables, 0..1. */
const RENEWABLE: Curve = [
  [0, 0.46],
  [3, 0.52],
  [6, 0.38],
  [9, 0.3],
  [12, 0.72],
  [15, 0.66],
  [18, 0.18],
  [21, 0.36],
];

/** Piecewise linear around the clock, so midnight joins back up with hour 23. */
export function interpolateDaily(curve: Curve, hour: number): number {
  const wrapped = ((hour % 24) + 24) % 24;
  const points = [...curve].sort((a, b) => a[0] - b[0]);
  const first = points[0] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];

  let before = last;
  let after = first;
  let beforeHour = last[0] - 24;
  let afterHour = first[0];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index] as readonly [number, number];
    if (point[0] <= wrapped) {
      before = point;
      beforeHour = point[0];
      const next = points[index + 1] ?? first;
      after = next;
      afterHour = next === first ? first[0] + 24 : next[0];
    }
  }
  const span = afterHour - beforeHour;
  if (span <= 0) return before[1];
  const ratio = (wrapped - beforeHour) / span;
  return before[1] + (after[1] - before[1]) * ratio;
}

export function syntheticValues(
  curve: Curve,
  startMs: number,
  stepMinutes: number,
  count: number,
  timezone: string,
): number[] {
  const stepMs = stepMinutes * MS_PER_MINUTE;
  return Array.from({ length: count }, (_, index) =>
    interpolateDaily(curve, localHourOfDay(startMs + index * stepMs + stepMs / 2, timezone)),
  );
}

export function syntheticForecast(site: Site, startMs: number, hours: number, stepMinutes = 15): ForecastSnapshot {
  const count = Math.ceil((hours * 60) / stepMinutes);
  const series = (curve: Curve) => makeSeries(startMs, stepMinutes, syntheticValues(curve, startMs, stepMinutes, count, site.timezone));
  return {
    generatedMs: startMs,
    carbon: series(CARBON),
    price: series(PRICE),
    renewable: series(RENEWABLE),
    actualCarbon: null,
    sources: { carbon: 'synthetic', price: 'synthetic', renewable: 'synthetic' },
    notes: ['synthetic daily profile, no external data'],
  };
}
