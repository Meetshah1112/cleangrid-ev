export const CHARGING_MODES = ['cheapest', 'greenest', 'fastest', 'balanced'] as const;
export type ChargingMode = (typeof CHARGING_MODES)[number];

/**
 * Dimensionless objective weights. Energy terms are normalised by their window mean, so a weight
 * of 1 on cost means "one unit per kWh at the average price". `speed` is always a little above 0
 * outside fastest mode: among equally good slots, earlier is safer.
 */
export interface ModeWeights {
  readonly cost: number;
  readonly co2: number;
  readonly peak: number;
  readonly speed: number;
}

export const MODE_WEIGHTS: Readonly<Record<ChargingMode, ModeWeights>> = Object.freeze({
  cheapest: Object.freeze({ cost: 1, co2: 0.1, peak: 0.3, speed: 0.01 }),
  greenest: Object.freeze({ cost: 0.1, co2: 1, peak: 0.1, speed: 0.01 }),
  fastest: Object.freeze({ cost: 0, co2: 0, peak: 0, speed: 1 }),
  balanced: Object.freeze({ cost: 0.5, co2: 0.5, peak: 0.3, speed: 0.01 }),
});

export const MODE_DESCRIPTIONS: Readonly<Record<ChargingMode, string>> = Object.freeze({
  cheapest: 'Lowest bill: charge when power is cheapest.',
  greenest: 'Lowest emissions: charge when the grid is cleanest.',
  fastest: 'Full power now, finished as early as possible.',
  balanced: 'Half cost, half carbon, and gentle on the site peak.',
});

export function isChargingMode(value: unknown): value is ChargingMode {
  return typeof value === 'string' && (CHARGING_MODES as readonly string[]).includes(value);
}
