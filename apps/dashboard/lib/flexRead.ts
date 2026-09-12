import type { Demand, FlexEvent, Plan, Session } from './types';

/**
 * Grid flexibility in the terms a person uses.
 *
 * The server stores a request as requested, accepted, declined or cancelled. Whether an accepted
 * request is waiting to start, in force, or over is a matter of the clock, so it is worked out here
 * rather than stored, and every screen that shows a request agrees on it.
 */

export type FlexStage = 'requested' | 'accepted' | 'active' | 'completed' | 'declined' | 'cancelled';

export function stageOf(event: FlexEvent, nowMs: number): FlexStage {
  if (event.status === 'declined' || event.status === 'cancelled') return event.status;
  if (event.status === 'completed') return 'completed';
  if (event.status === 'requested') return nowMs >= event.endsMs ? 'completed' : 'requested';
  if (nowMs >= event.endsMs) return 'completed';
  if (nowMs >= event.startsMs) return 'active';
  return 'accepted';
}

export const STAGE_LABEL: Record<FlexStage, string> = {
  requested: 'waiting for the site',
  accepted: 'accepted',
  active: 'in force',
  completed: 'completed',
  declined: 'declined',
  cancelled: 'withdrawn',
};

/**
 * What the site was drawing when the request was made. The console writes that figure into the
 * request's reason when it sends one; a request from elsewhere may not carry it, and then the
 * connection is the honest reference.
 */
export function drawnWhenAsked(event: FlexEvent, connectionKw: number): number {
  const match = event.reason?.match(/below the (\d+(?:\.\d+)?) kW/);
  return match ? Number(match[1]) : connectionKw;
}

export interface RequestPreview {
  readonly fromKw: number;
  readonly capKw: number;
  /** What the request asks the site to give back, measured from what it draws now. */
  readonly askedKw: number;
  /** What the site can actually give back: charging above the cap, never the building's own load. */
  readonly releasedKw: number;
  /** The building's own load in the window, when that alone is above the cap. */
  readonly baseAboveCapKw: number | null;
  /** Cars drawing power now, whose charging the request would reshape. */
  readonly affected: number;
  /** Cars that cannot give up the window without missing their deadline. */
  readonly mustCharge: readonly Session[];
  /** Cars the cap would leave short, on this estimate. */
  readonly atRisk: number;
}

/**
 * What a reduction would do, before it is sent.
 *
 * An estimate from each car's remaining energy, top power and deadline, not a solve: a car must
 * keep charging through the window if the hours it has outside the window at full power cannot
 * cover what it still needs. If those cars' minimum draw plus the building's load does not fit
 * under the cap, they are counted as at risk. The optimiser's own answer replaces this the moment
 * the request is accepted.
 */
export function previewRequest(input: {
  readonly sessions: readonly Session[];
  readonly plan: Plan | null;
  readonly drawKw: number;
  readonly connectionKw: number;
  readonly baseKw: number;
  readonly reductionPct: number;
  readonly hours: number;
  readonly nowMs: number;
}): RequestPreview {
  const fromKw = input.drawKw > 0.5 ? input.drawKw : input.connectionKw;
  const capKw = Math.round(fromKw * (1 - input.reductionPct / 100) * 10) / 10;
  const startsMs = input.nowMs + 60_000;
  const endsMs = startsMs + input.hours * 3_600_000;
  const inWindow = input.plan ? planWindow(input.plan, startsMs, endsMs) : null;
  const plannedPeakKw = inWindow ? inWindow.peakKw : input.drawKw;
  const basePeakKw = inWindow ? inWindow.basePeakKw : input.baseKw;
  const active = input.sessions.filter((session) => session.status === 'active');

  let minimumKw = 0;
  const mustCharge = active.filter((session) => {
    const remaining = Math.max(0, session.energyNeededKwh - session.energyDeliveredKwh);
    if (remaining <= 0.05) return false;
    const overlapH = Math.max(0, Math.min(endsMs, session.deadlineMs) - Math.max(startsMs, input.nowMs)) / 3_600_000;
    const outsideH = Math.max(0, (session.deadlineMs - input.nowMs) / 3_600_000 - overlapH);
    const shortKwh = remaining - session.maxPowerKw * outsideH;
    if (shortKwh <= 0.05 || overlapH <= 0) return false;
    minimumKw += Math.min(session.maxPowerKw, shortKwh / overlapH);
    return true;
  });

  return {
    fromKw,
    capKw,
    askedKw: Math.max(0, fromKw - capKw),
    releasedKw: Math.max(0, plannedPeakKw - Math.max(capKw, basePeakKw)),
    baseAboveCapKw: basePeakKw > capKw + 0.05 ? basePeakKw : null,
    affected: active.filter((session) => session.currentPowerKw > 0.05).length,
    mustCharge,
    atRisk: basePeakKw + minimumKw > capKw + 0.05 ? mustCharge.length : 0,
  };
}

/** The plan's total and base-load peaks over a stretch of time. */
function planWindow(plan: Plan, startsMs: number, endsMs: number): { peakKw: number; basePeakKw: number } | null {
  const slotMs = plan.grid.slotMinutes * 60_000;
  const from = Math.max(0, Math.floor((startsMs - plan.grid.startMs) / slotMs));
  const to = Math.min(plan.grid.slots, Math.ceil((endsMs - plan.grid.startMs) / slotMs));
  if (to <= from) return null;
  return { peakKw: Math.max(0, ...plan.siteLoadKw.slice(from, to)), basePeakKw: Math.max(0, ...plan.baseLoadKw.slice(from, to)) };
}

export interface WindowEffect {
  /** Cars the plan gives less than their top power during the window, though they still have energy to take. */
  readonly heldBack: number;
  /** Cars the plan keeps charging inside the window. */
  readonly charging: number;
  readonly plannedPeakKw: number;
  /** The building's own load at its highest in the window, which no plan can move. */
  readonly basePeakKw: number;
}

/** How the solved plan treats a window: who gives way and who keeps charging through it. */
export function windowEffect(plan: Plan | null, event: FlexEvent, sessions: readonly Session[]): WindowEffect | null {
  if (!plan) return null;
  const slotMs = plan.grid.slotMinutes * 60_000;
  const from = Math.max(0, Math.floor((event.startsMs - plan.grid.startMs) / slotMs));
  const to = Math.min(plan.grid.slots, Math.ceil((event.endsMs - plan.grid.startMs) / slotMs));
  if (to <= from) return null;
  let heldBack = 0;
  let charging = 0;
  for (const session of sessions) {
    if (session.status !== 'active') continue;
    const row = plan.allocationsKw[session.id];
    if (!row) continue;
    const inside = row.slice(from, to);
    const remaining = session.energyNeededKwh - session.energyDeliveredKwh;
    if (inside.some((kw) => kw > 0.01)) charging += 1;
    if (remaining > 0.05 && inside.some((kw) => kw < session.maxPowerKw - 0.1)) heldBack += 1;
  }
  const peaks = planWindow(plan, event.startsMs, event.endsMs);
  return { heldBack, charging, plannedPeakKw: peaks?.peakKw ?? 0, basePeakKw: peaks?.basePeakKw ?? 0 };
}

/** The measured answer for a window that has ended: its highest fifteen-minute draw against the cap. */
export function measuredResult(demand: Demand | null, event: FlexEvent): { peakKw: number; held: boolean } | null {
  if (!demand) return null;
  const inside = demand.intervals.filter((interval) => interval.startMs >= event.startsMs && interval.startMs < event.endsMs);
  if (inside.length === 0) return null;
  const peakKw = Math.max(...inside.map((interval) => interval.totalKw));
  return { peakKw, held: peakKw <= event.capKw + 0.5 };
}
