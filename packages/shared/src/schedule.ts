import type { ModeWeights } from './modes';
import type { SlotGrid } from './slotGrid';

/** Contract between the optimiser loop and any scheduling engine (greedy, LP). */

export const SOLVER_NAMES = ['lp', 'greedy'] as const;
export type SolverName = (typeof SOLVER_NAMES)[number];

/** complete: every session gets its energy by its deadline. shortfall: some cannot, and say by how much. */
export const SCHEDULE_STATUSES = ['complete', 'shortfall'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export interface SessionNeed {
  readonly sessionId: string;
  /** Energy still to deliver, kWh. */
  readonly energyKwh: number;
  /** Lower of charger rating and vehicle limit, kW. */
  readonly maxPowerKw: number;
  /** Lowest non-zero power the charger can hold (about 1.4 kW for 6 A single phase). */
  readonly minPowerKw?: number;
  /** Hours the vehicle is plugged in during each slot, 0 outside its window. Length = grid.slots. */
  readonly availableHours: readonly number[];
  readonly weights: ModeWeights;
}

export interface SiteLimits {
  readonly gridConnectionKw: number;
  /** Non-EV building load per slot, kW. */
  readonly baseLoadKw: readonly number[];
  /** Optional tighter cap on total site draw per slot (grid flex events), kW. */
  readonly capKw?: readonly number[];
  /** Peak already metered this billing period; planning below it saves nothing. */
  readonly existingPeakKw?: number;
  /** Site-level weight on peak demand (demand charges are a site cost, not a driver's). */
  readonly peakWeight: number;
}

export interface GridSignals {
  readonly carbonGPerKwh: readonly number[];
  readonly pricePerKwh: readonly number[];
}

export interface ScheduleProblem {
  readonly grid: SlotGrid;
  readonly sessions: readonly SessionNeed[];
  readonly site: SiteLimits;
  readonly signals: GridSignals;
}

export interface Shortfall {
  readonly sessionId: string;
  readonly shortfallKwh: number;
}

export interface ScheduleTotals {
  readonly energyKwh: number;
  readonly cost: number;
  readonly co2Kg: number;
  readonly peakKw: number;
  /** Normalised objective, computed the same way for every solver so plans are comparable. */
  readonly objective: number;
}

export interface ScheduleResult {
  readonly status: ScheduleStatus;
  readonly solver: SolverName;
  /** Power per session per slot, kW. */
  readonly allocationsKw: Readonly<Record<string, readonly number[]>>;
  /** Base load plus all charging, per slot, kW. */
  readonly siteLoadKw: readonly number[];
  readonly shortfalls: readonly Shortfall[];
  readonly totals: ScheduleTotals;
  readonly solveMs: number;
  /** Set when the primary solver failed and a fallback produced this plan. */
  readonly fallbackReason?: string;
}

export interface Scheduler {
  readonly name: string;
  solve(problem: ScheduleProblem): Promise<ScheduleResult>;
}
