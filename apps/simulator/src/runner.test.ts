import { describe, expect, it } from 'vitest';
import type { ResolvedArrival } from './depsRunner';
import { departedBy } from './runner';

const HOUR = 3_600_000;
const DAY_START = Date.parse('2026-09-13T00:00:00Z');

function arrival(id: string, arriveHour: number, departHour: number): ResolvedArrival {
  return {
    id,
    arriveMs: DAY_START + arriveHour * HOUR,
    departMs: DAY_START + departHour * HOUR,
    deadlineMs: DAY_START + departHour * HOUR,
  } as ResolvedArrival;
}

describe('starting part way through the day', () => {
  const day = [arrival('commuter', 8, 17), arrival('lunch', 12, 13), arrival('resident', 19, 31)];

  it('skips only the cars whose stay is already over', () => {
    expect(departedBy(day, DAY_START + 14 * HOUR)).toEqual(['lunch']);
  });

  it('still brings in a car that is parked right now, even though it arrived before the start', () => {
    expect(departedBy(day, DAY_START + 9 * HOUR)).not.toContain('commuter');
  });

  it('skips nothing at the start of the day', () => {
    expect(departedBy(day, DAY_START + 6 * HOUR)).toEqual([]);
  });
});
