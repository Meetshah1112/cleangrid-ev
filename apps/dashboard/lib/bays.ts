import { clockTime, countdown } from './format';
import type { Charger, Forecast, Session } from './types';

/**
 * What each charger is doing, and why, in the words an operator would use.
 *
 * The scene and the site plan both show bays, and they must agree, so the reading happens once
 * here. A bay is never just "idle": a car that is plugged in and not drawing power is either
 * waiting for a cleaner window the plan has already picked, or being held back for cost or for the
 * site's connection, and those are different things to tell a person who is watching.
 */

export type BayState = 'charging' | 'clean' | 'waiting' | 'charged' | 'urgent' | 'free' | 'offline';

export interface Bay {
  readonly charger: Charger;
  readonly session: Session | null;
  readonly state: BayState;
  /** The number painted on the bay. */
  readonly number: string;
  /** One sentence on why the bay is in this state. */
  readonly why: string;
  readonly remainingKwh: number;
  /** When the car could finish if it charged flat out from now. */
  readonly earliestFinishMs: number | null;
}

const URGENT_WITHIN_MS = 2 * 3_600_000;

export const BAY_STATE_LABEL: Record<BayState, string> = {
  charging: 'Charging',
  clean: 'Clean window',
  waiting: 'Waiting',
  charged: 'Charged',
  urgent: 'Urgent',
  free: 'Free',
  offline: 'Offline',
};

export function bayNumber(label: string): string {
  const digits = label.match(/\d+/);
  return digits ? String(Number(digits[0])) : label.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

export function readBays(
  chargers: readonly Charger[],
  sessions: readonly Session[],
  forecast: Forecast | null,
  nowMs: number,
  timezone: string,
): Bay[] {
  const live = new Map(
    sessions
      .filter((session) => session.status === 'active' || session.status === 'pending')
      .map((session) => [session.chargerId, session]),
  );
  const window = forecast?.greenWindow ?? null;

  return [...chargers]
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    .map((charger) => {
      const session = live.get(charger.id) ?? null;
      const remainingKwh = session ? Math.max(0, session.energyNeededKwh - session.energyDeliveredKwh) : 0;
      const rateKw = session ? Math.max(0.1, Math.min(session.maxPowerKw, charger.maxPowerKw)) : 0;
      const earliestFinishMs = session && nowMs > 0 ? nowMs + (remainingKwh / rateKw) * 3_600_000 : null;
      const base = { charger, session, number: bayNumber(charger.label), remainingKwh, earliestFinishMs };

      if (!charger.online) return { ...base, state: 'offline' as const, why: 'Not connected to CleanGrid. It cannot be scheduled until it reports in.' };
      if (!session) return { ...base, state: 'free' as const, why: 'No car on this bay.' };

      const deadline = clockTime(session.deadlineMs, timezone);

      // A car that already has what it asked for is not holding for anything; it is done, and
      // calling it "waiting" would count it among the flexible load the site does not have.
      if (remainingKwh <= 0.05) {
        return { ...base, state: 'charged' as const, why: `Has the ${session.energyNeededKwh.toFixed(1)} kWh it asked for. Free to leave any time before ${deadline}.` };
      }

      const dueSoon = nowMs > 0 && session.deadlineMs - nowMs < URGENT_WITHIN_MS && remainingKwh > 0.05;

      if (session.deadlineRisk) {
        const finish = earliestFinishMs ? clockTime(earliestFinishMs, timezone) : 'unknown';
        return {
          ...base,
          state: 'urgent' as const,
          why: `Cannot reach ${remainingKwh.toFixed(1)} kWh by ${deadline}. Earliest finish at full power is ${finish}.`,
        };
      }
      if (dueSoon) {
        return {
          ...base,
          state: 'urgent' as const,
          why: `Due in ${countdown(session.deadlineMs, nowMs)} with ${remainingKwh.toFixed(1)} kWh to go, so it charges ahead of flexible cars.`,
        };
      }
      if (session.currentPowerKw > 0.05) {
        const limit = session.limitKw === null ? '' : ` of a ${session.limitKw.toFixed(1)} kW limit`;
        return {
          ...base,
          state: 'charging' as const,
          why: `Drawing ${session.currentPowerKw.toFixed(1)} kW${limit}. This hour is inside its plan.`,
        };
      }
      if (window && window.startMs > nowMs && window.startMs < session.deadlineMs) {
        return {
          ...base,
          state: 'clean' as const,
          why: `Holding for the clean window at ${clockTime(window.startMs, timezone)}. Still finishes before ${deadline}.`,
        };
      }
      return {
        ...base,
        state: 'waiting' as const,
        why: `Holding for a cheaper or cleaner hour, or for room under the connection. Finishes before ${deadline}.`,
      };
    });
}

/** Charging, holding and free: the three keys the legend always shows, plus any that apply. */
export function bayCounts(bays: readonly Bay[]) {
  return {
    charging: bays.filter((bay) => bay.state === 'charging').length,
    holding: bays.filter((bay) => bay.state === 'clean' || bay.state === 'waiting').length,
    charged: bays.filter((bay) => bay.state === 'charged').length,
    urgent: bays.filter((bay) => bay.state === 'urgent').length,
    free: bays.filter((bay) => bay.state === 'free').length,
    offline: bays.filter((bay) => bay.state === 'offline').length,
  };
}
