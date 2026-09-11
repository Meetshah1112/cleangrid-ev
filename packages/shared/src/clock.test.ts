import { describe, expect, it } from 'vitest';
import { ManualClock, SimClock, SystemClock, realDelayMs } from './clock';

describe('SimClock', () => {
  it('runs simulated time at the configured scale', () => {
    let real = 1_000;
    const clock = new SimClock({ startMs: 0, scale: 60, realNow: () => real });
    real += 1_000;
    expect(clock.now()).toBe(60_000);
  });

  it('changes speed without jumping', () => {
    let real = 0;
    const clock = new SimClock({ startMs: 0, scale: 10, realNow: () => real });
    real = 1_000;
    clock.setScale(100);
    expect(clock.now()).toBe(10_000);
    real = 2_000;
    expect(clock.now()).toBe(110_000);
    expect(clock.scale).toBe(100);
    expect(clock.snapshot()).toEqual({ nowMs: 110_000, scale: 100 });
  });

  it('jumps to an instant and keeps running from there', () => {
    let real = 0;
    const clock = new SimClock({ startMs: 0, scale: 2, realNow: () => real });
    clock.jumpTo(5_000);
    real = 500;
    expect(clock.now()).toBe(6_000);
    expect(() => clock.jumpTo(Number.NaN)).toThrow(RangeError);
  });

  it('rejects zero, negative and non-finite scales', () => {
    expect(() => new SimClock({ startMs: 0, scale: 0 })).toThrow(RangeError);
    expect(() => new SimClock({ startMs: 0, scale: -1 })).toThrow(RangeError);
    expect(() => new SimClock({ startMs: 0, scale: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('converts simulated waits into real waits', () => {
    const clock = new SimClock({ startMs: 0, scale: 60, realNow: () => 0 });
    expect(realDelayMs(clock, 60_000)).toBe(1_000);
    expect(realDelayMs(clock, -5)).toBe(0);
  });
});

describe('ManualClock and SystemClock', () => {
  it('advances only when told to', () => {
    const clock = new ManualClock(100);
    clock.advance(50);
    expect(clock.now()).toBe(150);
    clock.set(10);
    expect(clock.now()).toBe(10);
  });

  it('follows wall time', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    expect(now).toBeGreaterThanOrEqual(before);
  });
});
