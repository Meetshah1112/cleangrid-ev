/**
 * Time source shared by server and simulator. A simulated clock lets a whole day of charging
 * play out in minutes during a demo while every component still agrees on "now".
 */
export interface Clock {
  now(): number;
  /** Simulated milliseconds per real millisecond (1 = real time). */
  readonly scale: number;
}

export interface ClockSnapshot {
  readonly nowMs: number;
  readonly scale: number;
}

export const MAX_TIME_SCALE = 10_000;

function assertScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0 || scale > MAX_TIME_SCALE) {
    throw new RangeError(`time scale must be in (0, ${MAX_TIME_SCALE}], got ${scale}`);
  }
}

export class SystemClock implements Clock {
  readonly scale = 1;
  now(): number {
    return Date.now();
  }
}

export class SimClock implements Clock {
  private anchorSimMs: number;
  private anchorRealMs: number;
  private currentScale: number;
  private readonly realNow: () => number;

  constructor(options: { readonly startMs: number; readonly scale: number; readonly realNow?: () => number }) {
    assertScale(options.scale);
    this.realNow = options.realNow ?? Date.now;
    this.anchorSimMs = options.startMs;
    this.anchorRealMs = this.realNow();
    this.currentScale = options.scale;
  }

  get scale(): number {
    return this.currentScale;
  }

  now(): number {
    return Math.round(this.anchorSimMs + (this.realNow() - this.anchorRealMs) * this.currentScale);
  }

  /** Change speed without a jump in simulated time. */
  setScale(scale: number): void {
    assertScale(scale);
    this.anchorSimMs = this.now();
    this.anchorRealMs = this.realNow();
    this.currentScale = scale;
  }

  jumpTo(ms: number): void {
    if (!Number.isFinite(ms)) throw new RangeError('jumpTo needs a finite epoch time');
    this.anchorSimMs = ms;
    this.anchorRealMs = this.realNow();
  }

  snapshot(): ClockSnapshot {
    return { nowMs: this.now(), scale: this.currentScale };
  }
}

/** Deterministic clock for tests. */
export class ManualClock implements Clock {
  readonly scale = 1;
  private current: number;

  constructor(startMs: number) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(ms: number): void {
    this.current = ms;
  }
}

/** Real milliseconds to wait until simulated instant `targetMs` (never negative). */
export function realDelayMs(clock: Clock, targetMs: number): number {
  return Math.max(0, (targetMs - clock.now()) / clock.scale);
}
