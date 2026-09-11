import { describe, expect, it } from 'vitest';
import {
  ceilToStep,
  daysBetweenLocalDates,
  floorToStep,
  formatLocalTime,
  isValidTimeZone,
  localDateOf,
  localHourOfDay,
  shiftLocalDate,
  shiftLocalDateTime,
  timeZoneOffsetMs,
  zonedTimeToUtc,
} from './time';

const at = (iso: string): number => Date.parse(iso);

describe('zonedTimeToUtc', () => {
  it('converts British Summer Time wall-clock to UTC', () => {
    expect(zonedTimeToUtc('2026-09-12T08:00', 'Europe/London')).toBe(at('2026-09-12T07:00:00Z'));
  });

  it('converts GMT wall-clock to UTC', () => {
    expect(zonedTimeToUtc('2026-12-01T08:00', 'Europe/London')).toBe(at('2026-12-01T08:00:00Z'));
  });

  it('handles half-hour offsets', () => {
    expect(zonedTimeToUtc('2026-09-12T08:00', 'Asia/Kolkata')).toBe(at('2026-09-12T02:30:00Z'));
  });

  it('accepts seconds', () => {
    expect(zonedTimeToUtc('2026-09-12T08:00:30', 'UTC')).toBe(at('2026-09-12T08:00:30Z'));
  });

  it('rejects malformed input', () => {
    expect(() => zonedTimeToUtc('12/09/2026 08:00', 'UTC')).toThrow(RangeError);
  });
});

describe('local wall clock', () => {
  it('reports hour of day, HH:MM, local date and offset', () => {
    const ms = at('2026-09-12T07:30:00Z');
    expect(localHourOfDay(ms, 'Europe/London')).toBe(8.5);
    expect(formatLocalTime(ms, 'Europe/London')).toBe('08:30');
    expect(localDateOf(at('2026-09-12T23:30:00Z'), 'Europe/London')).toBe('2026-09-13');
    expect(timeZoneOffsetMs(ms, 'Europe/London')).toBe(3_600_000);
  });

  it('reports midnight as hour 0, not 24', () => {
    expect(localHourOfDay(at('2026-09-12T23:00:00Z'), 'Europe/London')).toBe(0);
  });

  it('validates time zone names', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('date shifting', () => {
  it('crosses month and year boundaries', () => {
    expect(shiftLocalDateTime('2026-09-30T23:15', 1)).toBe('2026-10-01T23:15');
    expect(shiftLocalDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftLocalDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('counts whole days between dates', () => {
    expect(daysBetweenLocalDates('2026-09-12', '2026-10-02')).toBe(20);
    expect(daysBetweenLocalDates('2026-09-12', '2026-09-12')).toBe(0);
  });

  it('rejects malformed dates', () => {
    expect(() => shiftLocalDate('2026/09/12', 1)).toThrow(RangeError);
    expect(() => shiftLocalDateTime('2026-09-12', 1)).toThrow(RangeError);
  });
});

describe('step rounding', () => {
  it('floors and ceils to the step', () => {
    const ms = at('2026-09-12T10:07:00Z');
    expect(floorToStep(ms, 15)).toBe(at('2026-09-12T10:00:00Z'));
    expect(ceilToStep(ms, 15)).toBe(at('2026-09-12T10:15:00Z'));
  });
});
