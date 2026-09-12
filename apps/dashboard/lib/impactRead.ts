import { localHour } from '../components/scene/sky';
import type { Session, SessionReport } from './types';

/**
 * Impact, read the same way the server totals it.
 *
 * A period holds the sessions that plugged in during it, completed or ended early, which is how the
 * site's report endpoint counts them, so the ledger and the headline totals always agree.
 */

export type RangeKey = 'today' | 'week' | 'month';

export const RANGE_LABEL: Record<RangeKey, string> = { today: 'Today', week: '7 days', month: '30 days' };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function rangeOf(key: RangeKey, nowMs: number, timezone: string): { fromMs: number; toMs: number } {
  // The server's own default reaches an hour past now, so a session plugged in this minute counts.
  const toMs = nowMs + HOUR;
  if (key === 'today') return { fromMs: nowMs - Math.round(localHour(nowMs, timezone) * 60) * 60_000, toMs };
  return { fromMs: nowMs - (key === 'week' ? 7 : 30) * DAY, toMs };
}

export type DeadlineOutcome = 'kept' | 'missed' | 'left-early' | 'ended';

/**
 * Whether the driver got what they asked for by the time they asked for it.
 *
 * A car that left before its own deadline was not let down by the plan, and a session that ended
 * abnormally says nothing about the schedule either way, so neither is counted as kept or missed.
 */
export function deadlineOutcome(session: Session): DeadlineOutcome {
  if (session.status === 'aborted') return 'ended';
  const short = session.energyNeededKwh - session.energyDeliveredKwh > 0.25;
  if (!short) return 'kept';
  const leftMs = session.unpluggedMs ?? session.deadlineMs;
  return leftMs < session.deadlineMs - 5 * 60_000 ? 'left-early' : 'missed';
}

export interface Totals {
  readonly sessions: number;
  readonly verified: number;
  readonly energyKwh: number;
  readonly co2Kg: number;
  readonly baselineCo2Kg: number;
  readonly avoidedCo2Kg: number;
  readonly cost: number;
  readonly baselineCost: number;
  readonly costSaved: number;
}

export function totalsOf(reports: readonly SessionReport[]): Totals {
  const sum = (pick: (report: SessionReport) => number): number => reports.reduce((total, report) => total + pick(report), 0);
  return {
    sessions: reports.length,
    verified: reports.filter((report) => report.verified).length,
    energyKwh: sum((report) => report.energyKwh),
    co2Kg: sum((report) => report.co2Kg),
    baselineCo2Kg: sum((report) => report.baselineCo2Kg),
    avoidedCo2Kg: sum((report) => report.avoidedCo2Kg),
    cost: sum((report) => report.cost),
    baselineCost: sum((report) => report.baselineCost),
    costSaved: sum((report) => report.costSaved),
  };
}

/** Carbon against the baseline as a signed percentage, unrounded: positive is less carbon, negative is more. */
export function carbonCut(co2Kg: number, baselineCo2Kg: number): number | null {
  return baselineCo2Kg > 0 ? (1 - co2Kg / baselineCo2Kg) * 100 : null;
}

/**
 * "16% less carbon", "4% more carbon", "under 1% less carbon": never a minus sign in front of
 * "less", and never "the same" for a difference that is merely small, since a real saving shown
 * beside it would then contradict the words.
 */
export function cutPhrase(cut: number | null): string {
  if (cut === null) return 'no baseline yet';
  if (Math.abs(cut) < 0.005) return 'the same carbon as the baseline';
  const direction = cut > 0 ? 'less' : 'more';
  return Math.abs(cut) < 0.5 ? `under 1% ${direction} carbon` : `${Math.round(Math.abs(cut))}% ${direction} carbon`;
}

/** Where the baseline would have put its energy across the day: full power from the minute each car plugged in. */
export function baselineByHour(sessions: readonly Session[], timezone: string): number[] {
  const hours = Array<number>(24).fill(0);
  for (const session of sessions) {
    let left = session.energyDeliveredKwh;
    let ms = session.pluggedInMs;
    const rate = Math.max(0.1, session.maxPowerKw);
    while (left > 0.001) {
      const minuteLeft = 60 - Math.floor(localHour(ms, timezone) * 60) % 60;
      const stepH = Math.min(minuteLeft / 60, left / rate);
      const hour = Math.floor(localHour(ms, timezone)) % 24;
      hours[hour] = (hours[hour] ?? 0) + rate * stepH;
      left -= rate * stepH;
      ms += stepH * HOUR;
    }
  }
  return hours;
}
