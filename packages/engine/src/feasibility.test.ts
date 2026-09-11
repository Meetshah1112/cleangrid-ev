import { describe, expect, it } from 'vitest';
import { checkDeadline, maxDeliverableKwh } from './feasibility';

const at = (iso: string): number => Date.parse(iso);

describe('checkDeadline', () => {
  it('accepts a deadline that is exactly reachable at full power', () => {
    const check = checkDeadline({
      startMs: at('2026-09-12T08:00:00Z'),
      deadlineMs: at('2026-09-12T10:00:00Z'),
      energyKwh: 22,
      maxPowerKw: 11,
    });
    expect(check.feasible).toBe(true);
    expect(check.earliestFinishMs).toBe(at('2026-09-12T10:00:00Z'));
    expect(check.slackHours).toBeCloseTo(0, 9);
    expect(check.maxDeliverableKwh).toBeCloseTo(22, 9);
  });

  it('rejects 60 kWh in one hour and offers the earliest reachable time', () => {
    const check = checkDeadline({
      startMs: at('2026-09-12T08:00:00Z'),
      deadlineMs: at('2026-09-12T09:00:00Z'),
      energyKwh: 60,
      maxPowerKw: 11,
    });
    expect(check.feasible).toBe(false);
    expect(check.maxDeliverableKwh).toBeCloseTo(11, 9);
    // 60 / 11 h = 5 h 27.27 min, rounded up to the minute.
    expect(check.earliestFinishMs).toBe(at('2026-09-12T13:28:00Z'));
    expect(check.slackHours).toBeLessThan(0);
  });

  it('treats a deadline before the start as zero available time', () => {
    const check = checkDeadline({
      startMs: at('2026-09-12T08:00:00Z'),
      deadlineMs: at('2026-09-12T07:00:00Z'),
      energyKwh: 5,
      maxPowerKw: 7,
    });
    expect(check.feasible).toBe(false);
    expect(check.maxDeliverableKwh).toBe(0);
  });

  it('is always feasible when nothing is needed', () => {
    const startMs = at('2026-09-12T08:00:00Z');
    const check = checkDeadline({ startMs, deadlineMs: startMs, energyKwh: 0, maxPowerKw: 7 });
    expect(check.feasible).toBe(true);
    expect(check.earliestFinishMs).toBe(startMs);
  });

  it('rejects nonsensical input', () => {
    const base = { startMs: 0, deadlineMs: 3_600_000, energyKwh: 5, maxPowerKw: 7 };
    expect(() => checkDeadline({ ...base, maxPowerKw: 0 })).toThrow(RangeError);
    expect(() => checkDeadline({ ...base, energyKwh: -1 })).toThrow(RangeError);
    expect(() => checkDeadline({ ...base, deadlineMs: Number.NaN })).toThrow(RangeError);
  });
});

describe('maxDeliverableKwh', () => {
  it('multiplies power by plugged-in hours', () => {
    expect(maxDeliverableKwh({ maxPowerKw: 7, availableHours: [0.25, 0.25, 0.1, 0] })).toBeCloseTo(4.2, 9);
  });
});
