import { clockTime, countdown, modeLabel } from './format';
import type { Plan, Session } from './types';

/**
 * Reading one car's part of the plan in words.
 *
 * The plan says how many kilowatts each car gets in each block. What an operator wants is the
 * reason: is this car charging now because this is a good hour, because it has no slack left, or
 * is it holding for something better, and when does that start. Everything here is worked out from
 * the plan the optimiser actually solved, not from what the mode is supposed to do.
 */

export type PlanStance = 'charged' | 'risk' | 'prioritised' | 'charging' | 'holding' | 'unplanned';

export interface PlanReading {
  readonly stance: PlanStance;
  readonly headline: string;
  readonly why: string;
  readonly nextBlockMs: number | null;
  readonly plannedKwh: number;
}

const THRESHOLD_KW = 0.01;

export function slotAt(plan: Plan, ms: number): number {
  return Math.floor((ms - plan.grid.startMs) / (plan.grid.slotMinutes * 60_000));
}

/** How much of the time left before the deadline the car needs at full power, 0 to 1 and beyond. */
export function tightness(session: Session, nowMs: number): number {
  const remaining = Math.max(0, session.energyNeededKwh - session.energyDeliveredKwh);
  const hoursLeft = Math.max(0.01, (session.deadlineMs - nowMs) / 3_600_000);
  return remaining / Math.max(0.1, session.maxPowerKw) / hoursLeft;
}

export function readPlan(session: Session, plan: Plan | null, nowMs: number, timezone: string): PlanReading {
  const remaining = Math.max(0, session.energyNeededKwh - session.energyDeliveredKwh);
  const deadline = clockTime(session.deadlineMs, timezone);
  const row = plan?.allocationsKw[session.id] ?? [];
  const slotHours = (plan?.grid.slotMinutes ?? 15) / 60;
  const plannedKwh = row.reduce((total, kw) => total + kw * slotHours, 0);

  if (remaining <= 0.05) {
    return {
      stance: 'charged',
      headline: 'Charged, ready to leave',
      why: `It has the ${session.energyNeededKwh.toFixed(1)} kWh it asked for and draws nothing more before ${deadline}.`,
      nextBlockMs: null,
      plannedKwh,
    };
  }

  if (!plan || nowMs <= 0) {
    return { stance: 'unplanned', headline: 'Waiting for the next solve', why: 'No plan covers this car yet.', nextBlockMs: null, plannedKwh };
  }

  const now = Math.max(0, slotAt(plan, nowMs));
  const drawingNow = (row[now] ?? 0) > THRESHOLD_KW;
  const nextSlot = row.findIndex((kw, slot) => slot > now && kw > THRESHOLD_KW);
  const nextBlockMs = drawingNow ? null : nextSlot >= 0 ? plan.grid.startMs + nextSlot * plan.grid.slotMinutes * 60_000 : null;
  const shortfall = plan.shortfalls.find((entry) => entry.sessionId === session.id);

  if (session.deadlineRisk || (shortfall && shortfall.shortfallKwh > 0.05)) {
    const earliest = nowMs + (remaining / Math.max(0.1, session.maxPowerKw)) * 3_600_000;
    return {
      stance: 'risk',
      headline: 'Deadline at risk',
      why:
        earliest > session.deadlineMs
          ? `Even at full power it cannot finish before ${clockTime(earliest, timezone)}, after its ${deadline} deadline. More time is the only fix.`
          : `It could finish by ${clockTime(earliest, timezone)} on its own, but the site has no room for that power yet. The plan re-solves every minute.`,
      nextBlockMs,
      plannedKwh,
    };
  }

  const tight = tightness(session, nowMs);
  if (drawingNow && tight >= 0.8) {
    return {
      stance: 'prioritised',
      headline: `Prioritised, charging at ${(row[now] ?? 0).toFixed(1)} kW`,
      why: `It needs ${Math.round(tight * 100)}% of the ${countdown(session.deadlineMs, nowMs)} left to finish at full power, so it charges ahead of flexible cars.`,
      nextBlockMs,
      plannedKwh,
    };
  }

  if (drawingNow) {
    return {
      stance: 'charging',
      headline: `Charging at ${(row[now] ?? 0).toFixed(1)} kW`,
      why: `${comparison(plan, now, session.deadlineMs, session.mode)} ${modeLabel[session.mode] ?? session.mode} is what the driver asked for.`,
      nextBlockMs,
      plannedKwh,
    };
  }

  if (nextBlockMs !== null) {
    const nextIndex = slotAt(plan, nextBlockMs);
    const nowCarbon = plan.carbonGPerKwh[now] ?? 0;
    const thenCarbon = plan.carbonGPerKwh[nextIndex] ?? 0;
    const nowPrice = plan.pricePerKwh[now] ?? 0;
    const thenPrice = plan.pricePerKwh[nextIndex] ?? 0;
    const cleaner = nowCarbon > 0 ? Math.round((1 - thenCarbon / nowCarbon) * 100) : 0;
    const cheaper = nowPrice > 0 ? Math.round((1 - thenPrice / nowPrice) * 100) : 0;
    const reason =
      cleaner >= 5 && cheaper >= 5
        ? `That hour is ${cleaner}% cleaner and ${cheaper}% cheaper than now.`
        : cleaner >= 5
          ? `That hour is ${cleaner}% cleaner than now.`
          : cheaper >= 5
            ? `That hour is ${cheaper}% cheaper than now.`
            : 'Other cars need the connection first.';
    return {
      stance: 'holding',
      headline: `Holding until ${clockTime(nextBlockMs, timezone)}`,
      why: `${reason} It still finishes before ${deadline}.`,
      nextBlockMs,
      plannedKwh,
    };
  }

  return {
    stance: 'unplanned',
    headline: 'Nothing planned yet',
    why: 'The last plan gives this car no power. The next solve will pick it up.',
    nextBlockMs: null,
    plannedKwh,
  };
}

/** Why this block, measured against the rest of the car's own parked window. */
function comparison(plan: Plan, now: number, deadlineMs: number, mode: string): string {
  const end = Math.min(plan.carbonGPerKwh.length, Math.max(now + 1, slotAt(plan, deadlineMs)));
  const carbon = plan.carbonGPerKwh.slice(now, end);
  const price = plan.pricePerKwh.slice(now, end);
  const rank = (series: number[], value: number): number =>
    series.length <= 1 ? 0 : series.filter((entry) => entry < value).length / (series.length - 1);
  if (mode === 'fastest') return 'It asked to finish as soon as it can.';
  const carbonRank = rank(carbon, plan.carbonGPerKwh[now] ?? 0);
  const priceRank = rank(price, plan.pricePerKwh[now] ?? 0);
  if (mode === 'greenest' && carbonRank <= 0.34) return 'This is among the cleanest hours before it leaves.';
  if (mode === 'cheapest' && priceRank <= 0.34) return 'This is among the cheapest hours before it leaves.';
  if (carbonRank <= 0.34 && priceRank <= 0.34) return 'This hour is both clean and cheap for its window.';
  if (carbonRank <= 0.34) return 'This is among the cleanest hours before it leaves.';
  if (priceRank <= 0.34) return 'This is among the cheapest hours before it leaves.';
  return 'Later hours are no better once every car has its share of the connection.';
}
