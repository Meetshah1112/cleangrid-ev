import { describe, expect, it } from 'vitest';
import { activeRange, createSlotGrid, gridEndMs, slotIndexAt, slotStartMs, windowHours } from './slotGrid';

const at = (iso: string): number => Date.parse(iso);

describe('createSlotGrid', () => {
  it('aligns slot 0 to the slot boundary and makes it partial', () => {
    const grid = createSlotGrid({ nowMs: at('2026-09-12T10:07:00Z') });
    expect(grid.startMs).toBe(at('2026-09-12T10:00:00Z'));
    expect(grid.slots).toBe(96);
    expect(grid.slotHours[0]).toBeCloseTo(8 / 60, 12);
    expect(grid.slotHours[1]).toBe(0.25);
    expect(gridEndMs(grid)).toBe(at('2026-09-13T10:00:00Z'));
  });

  it('gives a full first slot when now is exactly on a boundary', () => {
    const grid = createSlotGrid({ nowMs: at('2026-09-12T10:30:00Z'), slotMinutes: 30, horizonHours: 12 });
    expect(grid.slots).toBe(24);
    expect(grid.slotHours[0]).toBe(0.5);
  });

  it('rejects invalid slot length, horizon and time', () => {
    expect(() => createSlotGrid({ nowMs: 0, slotMinutes: 0 })).toThrow(RangeError);
    expect(() => createSlotGrid({ nowMs: 0, slotMinutes: 7.5 })).toThrow(RangeError);
    expect(() => createSlotGrid({ nowMs: 0, horizonHours: -1 })).toThrow(RangeError);
    expect(() => createSlotGrid({ nowMs: Number.NaN })).toThrow(RangeError);
  });

  it('returns a frozen grid', () => {
    const grid = createSlotGrid({ nowMs: 0 });
    expect(Object.isFrozen(grid)).toBe(true);
    expect(Object.isFrozen(grid.slotHours)).toBe(true);
  });
});

describe('slot indexing', () => {
  const grid = createSlotGrid({ nowMs: at('2026-09-12T10:07:00Z') });

  it('maps instants to slot indexes', () => {
    expect(slotIndexAt(grid, at('2026-09-12T10:14:59Z'))).toBe(0);
    expect(slotIndexAt(grid, at('2026-09-12T10:15:00Z'))).toBe(1);
    expect(slotIndexAt(grid, at('2026-09-12T09:59:00Z'))).toBe(-1);
    expect(slotStartMs(grid, 4)).toBe(at('2026-09-12T11:00:00Z'));
  });
});

describe('windowHours', () => {
  const grid = createSlotGrid({ nowMs: at('2026-09-12T10:07:00Z') });

  it('never counts time before now', () => {
    const hours = windowHours(grid, at('2026-09-12T09:00:00Z'), at('2026-09-12T12:00:00Z'));
    expect(hours[0]).toBeCloseTo(8 / 60, 12);
    expect(hours.slice(1, 8)).toEqual(Array(7).fill(0.25));
    expect(hours[8]).toBe(0);
  });

  it('credits partial slots at arrival and at the deadline', () => {
    const hours = windowHours(grid, at('2026-09-12T11:05:00Z'), at('2026-09-12T12:07:00Z'));
    expect(hours[3]).toBe(0);
    expect(hours[4]).toBeCloseTo(10 / 60, 12);
    expect(hours[8]).toBeCloseTo(7 / 60, 12);
    expect(hours[9]).toBe(0);
    expect(hours.reduce((a, b) => a + b, 0)).toBeCloseTo(62 / 60, 12);
  });

  it('drops slivers shorter than a minute', () => {
    const hours = windowHours(grid, at('2026-09-12T11:14:30Z'), at('2026-09-12T11:30:00Z'));
    expect(hours[4]).toBe(0);
    expect(hours[5]).toBe(0.25);
  });

  it('is empty for a window that has already ended', () => {
    const hours = windowHours(grid, at('2026-09-12T08:00:00Z'), at('2026-09-12T09:00:00Z'));
    expect(activeRange(hours)).toBeNull();
  });

  it('clips windows at the horizon', () => {
    const hours = windowHours(grid, at('2026-09-12T10:07:00Z'), at('2026-09-14T00:00:00Z'));
    expect(hours).toHaveLength(96);
    expect(hours[95]).toBe(0.25);
  });
});

describe('activeRange', () => {
  it('finds the first and one-past-last non-zero slot', () => {
    expect(activeRange([0, 0, 0.25, 0.25, 0.1, 0])).toEqual({ first: 2, end: 5 });
  });
});
