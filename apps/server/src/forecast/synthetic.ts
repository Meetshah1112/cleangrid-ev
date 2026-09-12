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
  /**
   * How this grid's variable renewable output splits between sun and wind, by installed capacity.
   * Weather means different things to different grids: an overcast morning barely moves a
   * wind-led system and takes most of the output off a solar-led one. The two add to 1.
   */
  readonly mix: { readonly solar: number; readonly wind: number };
  /**
   * The share of generation from renewables that run whatever the sky is doing: hydro, biomass,
   * waste. Weather scales the rest and leaves this alone, which matters most at night — a windless
   * midnight is not a grid with no renewables on it, it is a grid running on its firm ones.
   */
  readonly firmShare: number;
  /**
   * The Electricity Maps zone covering this grid, where one exists. Their free tier is granted per
   * zone rather than by coordinate, so a site has to ask for its zone by name to be answered.
   */
  readonly mapsZone?: string;
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
  mix: { solar: 0.25, wind: 0.75 },
  // Hydro and biomass, a small and steady slice of the British system.
  firmShare: 0.06,
  mapsZone: 'GB',
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
  mix: { solar: 0.62, wind: 0.38 },
  // Karnataka carries real hydro capacity on the Sharavathi and Kali, so its floor is higher.
  firmShare: 0.1,
  mapsZone: 'IN-SO',
};


/**
 * Gujarat. Worth its own curve rather than sharing India's: the state carries one of the country's
 * largest solar and wind fleets, so its midday dip is far deeper than a national average, and its
 * commercial tariff is time-of-day banded with a surcharge through the two demand peaks and a
 * rebate overnight. Prices are the shape of a GERC HT commercial tariff, in rupees.
 */
const IN_GJ: GridProfile = {
  carbon: [
    [0, 655],
    [3, 635],
    [6, 605],
    [9, 470],
    [12, 330],
    [15, 405],
    [18, 725],
    [21, 700],
  ],
  price: [
    [0, 4.2],
    [3, 4.2],
    [6, 4.9],
    [9, 6.7],
    [12, 5.2],
    [15, 5.2],
    [18, 6.7],
    [21, 6.2],
  ],
  renewable: [
    [0, 0.18],
    [3, 0.2],
    [6, 0.23],
    [9, 0.43],
    [12, 0.62],
    [15, 0.5],
    [18, 0.13],
    [21, 0.16],
  ],
  mix: { solar: 0.55, wind: 0.45 },
  // Gujarat has almost no hydro; what is firm here is biomass and waste, and there is little of it.
  firmShare: 0.04,
  // Gujarat is dispatched as part of the Western region, which is the granularity published.
  mapsZone: 'IN-WE',
};

const PROFILES: Record<string, GridProfile> = { GB, IN, 'IN-GJ': IN_GJ };

/**
 * The profile for a grid, most specific first: a state or region where we model one, then the
 * country, then Great Britain for anywhere not modelled yet. Grids are regional things — Gujarat
 * and Karnataka sit in the same country and do not look alike.
 */
export function gridProfileFor(country: string, regionCode?: string): GridProfile {
  const nation = country.toUpperCase();
  const region = regionCode?.toUpperCase();
  if (region) {
    const regional = PROFILES[`${nation}-${region}`];
    if (regional) return regional;
  }
  return PROFILES[nation] ?? GB;
}

/**
 * The Electricity Maps zone for a grid, and only where we actually model that grid.
 *
 * Deliberately not read off the profile `gridProfileFor` returns, because that one falls back to
 * Great Britain for anywhere unmodelled. Borrowing a curve shape from Britain is a stated
 * approximation; borrowing Britain's *zone* would fetch Britain's real carbon intensity and serve
 * it as another country's, which is not an approximation but a wrong number wearing a source name.
 */
export function mapsZoneFor(country: string, regionCode?: string): string | undefined {
  const nation = country.toUpperCase();
  const region = regionCode?.toUpperCase();
  const exact = (region && PROFILES[`${nation}-${region}`]) || PROFILES[nation];
  return exact?.mapsZone;
}

/**
 * What to call the grid a site sits on, in the words used to label a forecast. "IN" would be a
 * half-truth for a Gujarat site: the numbers come from a Gujarat curve, and the label should say
 * so rather than implying one national average.
 */
export function gridNameFor(country: string, regionCode?: string): string {
  const nation = country.toUpperCase();
  const region = regionCode?.toUpperCase();
  return region && PROFILES[`${nation}-${region}`] ? `${nation}-${region}` : nation;
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
  const profile = gridProfileFor(site.country, site.regionCode);
  const series = (curve: Curve) =>
    makeSeries(startMs, stepMinutes, syntheticValues(curve, startMs, stepMinutes, count, site.timezone));
  return {
    generatedMs: startMs,
    carbon: series(profile.carbon),
    price: series(profile.price),
    renewable: series(profile.renewable),
    actualCarbon: null,
    sources: { carbon: 'synthetic', price: 'synthetic', renewable: 'synthetic' },
    notes: [`modelled daily profile for ${gridNameFor(site.country, site.regionCode)}, no external data`],
  };
}
