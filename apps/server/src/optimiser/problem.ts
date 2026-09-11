import {
  MODE_WEIGHTS,
  MS_PER_HOUR,
  localHourOfDay,
  slotStartMs,
  slotEndMs,
  windowHours,
  type Charger,
  type ChargingSession,
  type FlexEvent,
  type ScheduleProblem,
  type SessionNeed,
  type Site,
  type SlotGrid,
} from '@cleangrid/shared';

/** Turns live state into the solver's input. Everything here is pure, so it is easy to test. */

export interface BuildProblemInput {
  readonly site: Site;
  readonly grid: SlotGrid;
  readonly sessions: readonly ChargingSession[];
  readonly chargers: ReadonlyMap<string, Charger>;
  readonly carbonGPerKwh: readonly number[];
  readonly pricePerKwh: readonly number[];
  readonly flexEvents?: readonly FlexEvent[];
  readonly existingPeakKw?: number;
}

export interface BuiltProblem {
  readonly problem: ScheduleProblem;
  /** Sessions left out of the solve, with the reason, so nothing disappears silently. */
  readonly skipped: readonly { readonly sessionId: string; readonly reason: string }[];
  /** Sessions whose deadline has already passed; they are charged as fast as possible. */
  readonly overdue: readonly string[];
}

const REMAINING_EPSILON_KWH = 0.01;

/** Building load for each slot, read from the site's hourly profile in local time. */
export function baseLoadForGrid(site: Site, grid: SlotGrid): number[] {
  return Array.from({ length: grid.slots }, (_, slot) => {
    const midpointMs = (slotStartMs(grid, slot) + slotEndMs(grid, slot)) / 2;
    const hour = Math.floor(localHourOfDay(midpointMs, site.timezone));
    return site.baseLoadKw[hour] ?? 0;
  });
}

/** Per-slot ceiling on total site draw: the grid connection, tightened by accepted flex events. */
export function capsForGrid(site: Site, grid: SlotGrid, flexEvents: readonly FlexEvent[] = []): number[] {
  const honoured = flexEvents.filter((event) => event.status === 'accepted' || event.status === 'active');
  return Array.from({ length: grid.slots }, (_, slot) => {
    const startMs = slotStartMs(grid, slot);
    const endMs = slotEndMs(grid, slot);
    return honoured.reduce(
      (cap, event) => (event.startsMs < endMs && event.endsMs > startMs ? Math.min(cap, event.capKw) : cap),
      site.gridConnectionKw,
    );
  });
}

export function buildProblem(input: BuildProblemInput): BuiltProblem {
  const { site, grid, sessions, chargers } = input;
  const nowMs = grid.nowMs;
  const skipped: { sessionId: string; reason: string }[] = [];
  const overdue: string[] = [];
  const baseLoadKw = baseLoadForGrid(site, grid);
  const needs: SessionNeed[] = [];

  for (const session of sessions) {
    const charger = chargers.get(session.chargerId);
    if (!charger) {
      skipped.push({ sessionId: session.id, reason: 'charger_unknown' });
      continue;
    }
    if (!charger.online) {
      skipped.push({ sessionId: session.id, reason: 'charger_offline' });
      continue;
    }
    const remainingKwh = Math.max(0, session.energyNeededKwh - session.energyDeliveredKwh);
    const maxPowerKw = Math.min(session.maxPowerKw, charger.maxPowerKw);

    if (charger.uncontrolled) {
      // The charger ignores profiles, so it is modelled as fixed load rather than a decision.
      addUncontrolledLoad(baseLoadKw, grid, session, remainingKwh, maxPowerKw);
      skipped.push({ sessionId: session.id, reason: 'charger_uncontrolled' });
      continue;
    }

    const startMs = Math.max(nowMs, session.pluggedInMs);
    let endMs = session.deadlineMs;
    if (remainingKwh > REMAINING_EPSILON_KWH && endMs <= nowMs) {
      // Deadline already missed: charge flat out from now and report the risk.
      endMs = nowMs + (remainingKwh / maxPowerKw) * MS_PER_HOUR;
      overdue.push(session.id);
    }

    needs.push({
      sessionId: session.id,
      energyKwh: remainingKwh,
      maxPowerKw,
      minPowerKw: charger.minPowerKw,
      availableHours: windowHours(grid, startMs, endMs),
      weights: MODE_WEIGHTS[session.mode],
    });
  }

  return {
    problem: {
      grid,
      sessions: needs,
      site: {
        gridConnectionKw: site.gridConnectionKw,
        baseLoadKw,
        capKw: capsForGrid(site, grid, input.flexEvents ?? []),
        ...(input.existingPeakKw === undefined ? {} : { existingPeakKw: input.existingPeakKw }),
        peakWeight: MODE_WEIGHTS[site.defaultMode].peak,
      },
      signals: { carbonGPerKwh: input.carbonGPerKwh, pricePerKwh: input.pricePerKwh },
    },
    skipped,
    overdue,
  };
}

function addUncontrolledLoad(
  baseLoadKw: number[],
  grid: SlotGrid,
  session: ChargingSession,
  remainingKwh: number,
  maxPowerKw: number,
): void {
  if (remainingKwh <= REMAINING_EPSILON_KWH) return;
  const hours = windowHours(grid, Math.max(grid.nowMs, session.pluggedInMs), session.deadlineMs);
  let left = remainingKwh;
  for (let slot = 0; slot < grid.slots && left > 0; slot += 1) {
    const slotHours = hours[slot] ?? 0;
    if (slotHours <= 0) continue;
    const kwh = Math.min(left, maxPowerKw * slotHours);
    baseLoadKw[slot] = (baseLoadKw[slot] ?? 0) + kwh / slotHours;
    left -= kwh;
  }
}
