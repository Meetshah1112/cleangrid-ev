import { MS_PER_MINUTE, localHourOfDay, makeSeries, type ForecastSnapshot, type Site } from '@cleangrid/shared';

/**
 * A deterministic stand-in for live grid data. Used offline, in tests, and as the last fallback
 * when every external source fails mid-demo.
 *
 * The profile is per country, because a grid is a national thing. Great Britain is wind-led and
 * prices in pounds; Karnataka is coal-led with a large midday solar surplus and prices in rupees,
 * about thirty times the numeric value. Serving one curve to both would put a UK tariff on an
 * Indian bill — the numbers would read as pounds wearing a rupee sign.
 *
 * Only the shape of a curve steers the optimiser: cost and carbon are normalised by their window
 * means before they reach the objective, so these values decide what is reported and shown, not
 * which slot is chosen. Getting them right is a question of not lying to the operator.
 */

type Curve = readonly (readonly [hour: number, value: number])[];

export interface GridProfile {
  /** gCO2/kWh through the day. */
  readonly carbon: Curve;
  /** Site currency per kWh. */
  readonly price: Curve;
  /** Share of generation from renewables, 0..1. */
  readonly renewable: Curve;
}

/** Great Britain: wind-heavy overnight, solar at midday, gas through the evening peak. */
const GB: GridProfile = {
  carbon: [
    [0, 230],
    [3, 195],
    [6, 300],
    [9, 420],
    [12, 190],
    [15, 210],
    [18, 690],
    [21, 420],
  ],
  // Shaped like an Octopus Agile day, £/kWh.
  price: [
    [0, 0.09],
    [3, 0.08],
    [6, 0.14],
    [9, 0.22],
    [12, 0.16],
    [15, 0.18],
    [18, 0.42],
    [21, 0.24],
  ],
  renewable: [
    [0, 0.46],
    [3, 0.52],
    [6, 0.38],
    [9, 0.3],
    [12, 0.72],
    [15, 0.66],
    [18, 0.18],
    [21, 0.36],
  ],
};

/**
 * India (Karnataka): a coal-led grid near 700 gCO2/kWh that dips hard at midday as solar comes on,
 * and a time-of-day commercial tariff in rupees with an evening surcharge and a night rebate.
 */
const IN: GridProfile = {
  carbon: [
    [0, 715],
    [3, 700],
    [6, 675],
    [9, 590],
    [12, 470],
    [15, 515],
    [18, 790],
    [21, 760],
  ],
  // ₹/kWh, commercial time-of-day: cheap overnight, surcharged 18:00-22:00.
  price: [
    [0, 7.0],
    [3, 6.5],
    [6, 8.0],
    [9, 9.2],
    [12, 7.6],
    [15, 8.1],
    [18, 12.4],
    [21, 10.2],
  ],
  renewable: [
    [0, 0.22],
    [3, 0.25],
    [6, 0.2],
    [9, 0.35],
    [12, 0.54],
    [15, 0.45],
    [18, 0.11],
    [21, 0.15],
  ],
};

const PROFILES: Record<string, GridProfile> = { GB, IN };

/** The profile for a country, falling back to Great Britain for anywhere not modelled yet. */
export function gridProfileFor(country: string): GridProfile {
  return PROFILES[country.toUpperCase()] ?? GB;
}

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
  const profile = gridProfileFor(site.country);
  const series = (curve: Curve) =>
    makeSeries(startMs, stepMinutes, syntheticValues(curve, startMs, stepMinutes, count, site.timezone));
  return {
    generatedMs: startMs,
    carbon: series(profile.carbon),
    price: series(profile.price),
    renewable: series(profile.renewable),
    actualCarbon: null,
    sources: { carbon: 'synthetic', price: 'synthetic', renewable: 'synthetic' },
    notes: [`synthetic daily profile for ${site.country}, no external data`],
  };
}
