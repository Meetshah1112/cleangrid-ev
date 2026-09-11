import type { StepSeries } from './series';

/** What the forecast service hands the optimiser: aligned series plus provenance. */
export interface ForecastSnapshot {
  readonly generatedMs: number;
  /** Grid carbon intensity, gCO2/kWh. */
  readonly carbon: StepSeries;
  /** Import price, currency units per kWh. */
  readonly price: StepSeries;
  /** Share of generation from renewables, 0..1. */
  readonly renewable: StepSeries;
  /** Measured intensity where available (used for verified reports). */
  readonly actualCarbon: StepSeries | null;
  readonly sources: {
    readonly carbon: string;
    readonly price: string;
    readonly renewable: string;
  };
  /** Human-readable notes, e.g. which source fell back and why. */
  readonly notes: readonly string[];
}

export interface GreenWindow {
  readonly startMs: number;
  readonly endMs: number;
  readonly avgCarbonGPerKwh: number;
  readonly avgRenewableShare: number;
}
