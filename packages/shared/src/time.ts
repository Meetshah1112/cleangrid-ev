import { MS_PER_DAY, MS_PER_MINUTE } from './units';

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function floorToStep(ms: number, stepMinutes: number): number {
  const step = stepMinutes * MS_PER_MINUTE;
  return Math.floor(ms / step) * step;
}

export function ceilToStep(ms: number, stepMinutes: number): number {
  const step = stepMinutes * MS_PER_MINUTE;
  return Math.ceil(ms / step) * step;
}

export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, created);
  return created;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of instant `ms` as seen in `timeZone`. */
export function wallClockAt(ms: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/** Offset of `timeZone` from UTC at instant `ms`, in ms (BST is +3_600_000). */
export function timeZoneOffsetMs(ms: number, timeZone: string): number {
  const wall = wallClockAt(ms, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

function parseLocalDateTime(local: string): number[] {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) throw new RangeError(`Invalid local date-time "${local}", expected YYYY-MM-DDTHH:MM`);
  return match.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
}

/** Interpret "YYYY-MM-DDTHH:MM[:SS]" as wall-clock time in `timeZone` and return UTC epoch ms. */
export function zonedTimeToUtc(local: string, timeZone: string): number {
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = parseLocalDateTime(local);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = wallAsUtc - timeZoneOffsetMs(wallAsUtc, timeZone);
  return wallAsUtc - timeZoneOffsetMs(guess, timeZone);
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Fractional local hour of day (08:30 is 8.5). */
export function localHourOfDay(ms: number, timeZone: string): number {
  const wall = wallClockAt(ms, timeZone);
  return wall.hour + wall.minute / 60 + wall.second / 3600;
}

/** "HH:MM" in `timeZone`. */
export function formatLocalTime(ms: number, timeZone: string): string {
  const wall = wallClockAt(ms, timeZone);
  return `${pad2(wall.hour)}:${pad2(wall.minute)}`;
}

/** "YYYY-MM-DD" in `timeZone`. */
export function localDateOf(ms: number, timeZone: string): string {
  const wall = wallClockAt(ms, timeZone);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

function formatUtcDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function localDateToUtcMidnight(date: string): number {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new RangeError(`Invalid local date "${date}", expected YYYY-MM-DD`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function shiftLocalDate(date: string, days: number): string {
  return formatUtcDate(localDateToUtcMidnight(date) + days * MS_PER_DAY);
}

/** Shift the date part of a local date-time by whole days, keeping the wall-clock time. */
export function shiftLocalDateTime(local: string, days: number): string {
  parseLocalDateTime(local);
  const [datePart = '', timePart = ''] = local.split('T');
  return `${shiftLocalDate(datePart, days)}T${timePart}`;
}

export function daysBetweenLocalDates(from: string, to: string): number {
  return Math.round((localDateToUtcMidnight(to) - localDateToUtcMidnight(from)) / MS_PER_DAY);
}
