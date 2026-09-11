import { floorToStep } from './time';
import { MS_PER_HOUR, MS_PER_MINUTE } from './units';

export const DEFAULT_SLOT_MINUTES = 15;
export const DEFAULT_HORIZON_HOURS = 24;
/** Overlaps shorter than this are ignored so the solver never sees near-zero coefficients. */
export const MIN_WINDOW_MS = MS_PER_MINUTE;

/**
 * The planning window: `slots` consecutive slots of `slotMinutes` starting at `startMs`.
 * `nowMs` lies inside slot 0, so slot 0 is partial and `slotHours[0]` is the time left in it.
 */
export interface SlotGrid {
  readonly startMs: number;
  readonly nowMs: number;
  readonly slotMinutes: number;
  readonly slots: number;
  readonly slotHours: readonly number[];
}

export interface SlotGridOptions {
  readonly nowMs: number;
  readonly slotMinutes?: number;
  readonly horizonHours?: number;
}

export function createSlotGrid(options: SlotGridOptions): SlotGrid {
  const { nowMs, slotMinutes = DEFAULT_SLOT_MINUTES, horizonHours = DEFAULT_HORIZON_HOURS } = options;
  if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be a finite epoch time');
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
    throw new RangeError(`slotMinutes must be a positive integer, got ${slotMinutes}`);
  }
  if (!Number.isFinite(horizonHours) || horizonHours <= 0) {
    throw new RangeError(`horizonHours must be positive, got ${horizonHours}`);
  }
  const slots = Math.max(1, Math.round((horizonHours * 60) / slotMinutes));
  const stepMs = slotMinutes * MS_PER_MINUTE;
  const startMs = floorToStep(nowMs, slotMinutes);
  const slotHours = Array.from({ length: slots }, (_, index) =>
    index === 0 ? (startMs + stepMs - nowMs) / MS_PER_HOUR : stepMs / MS_PER_HOUR,
  );
  return Object.freeze({ startMs, nowMs, slotMinutes, slots, slotHours: Object.freeze(slotHours) });
}

export const slotStepMs = (grid: SlotGrid): number => grid.slotMinutes * MS_PER_MINUTE;
export const slotStartMs = (grid: SlotGrid, index: number): number => grid.startMs + index * slotStepMs(grid);
export const slotEndMs = (grid: SlotGrid, index: number): number => slotStartMs(grid, index + 1);
export const gridEndMs = (grid: SlotGrid): number => slotStartMs(grid, grid.slots);

/** Slot index containing `ms`; may fall outside [0, slots). */
export function slotIndexAt(grid: SlotGrid, ms: number): number {
  return Math.floor((ms - grid.startMs) / slotStepMs(grid));
}

/**
 * Hours of the interval [fromMs, toMs) that fall inside each slot, never counting time before now.
 * This is how a session's plugged-in window becomes solver input: partial slots at arrival and
 * at the deadline get partial hours, so no charging is planned outside the window.
 */
export function windowHours(grid: SlotGrid, fromMs: number, toMs: number): number[] {
  const from = Math.max(fromMs, grid.nowMs);
  return Array.from({ length: grid.slots }, (_, index) => {
    const overlapMs = Math.min(toMs, slotEndMs(grid, index)) - Math.max(from, slotStartMs(grid, index));
    return overlapMs >= MIN_WINDOW_MS ? overlapMs / MS_PER_HOUR : 0;
  });
}

/** First and one-past-last slot with non-zero hours, or null for an empty window. */
export function activeRange(hours: readonly number[]): { readonly first: number; readonly end: number } | null {
  const first = hours.findIndex((value) => value > 0);
  if (first < 0) return null;
  let end = hours.length;
  while (end > first && !((hours[end - 1] ?? 0) > 0)) end -= 1;
  return { first, end };
}
