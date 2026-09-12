'use client';

import { clockTime, countdown, modeLabel } from '../../lib/format';
import { readPlan } from '../../lib/planRead';
import type { Plan, Session } from '../../lib/types';
import { OverrideControls } from './OverrideControls';
import { plannedBlocks } from './PlanRiver';

/**
 * One car, chosen from the river or the list: its parked window, what the plan does with it and
 * why, and the two levers that change it.
 */
export function PlanDetail({
  session,
  plan,
  nowMs,
  siteId,
  timezone,
  currency,
  onChanged,
  onClose,
}: {
  readonly session: Session;
  readonly plan: Plan | null;
  readonly nowMs: number;
  readonly siteId: string;
  readonly timezone: string;
  readonly currency: string;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const reading = readPlan(session, plan, nowMs, timezone);
  const parked = Math.max(0, session.deadlineMs - session.pluggedInMs);
  const blocks = plan ? plannedBlocks(plan.allocationsKw[session.id] ?? [], plan.grid.startMs, plan.grid.slotMinutes * 60_000, timezone) : null;

  return (
    <section id="plan-detail" className={`plan-detail is-${reading.stance}`} aria-labelledby="plan-detail-title">
      <div className="plan-detail-head">
        <div>
          <p className="eyebrow">
            {session.chargerId} · {modeLabel[session.mode] ?? session.mode}
          </p>
          <h3 id="plan-detail-title" className="subtitle">
            {session.driverName ?? session.idTag}: {reading.headline.toLowerCase()}
          </h3>
        </div>
        <button type="button" className="btn is-small" onClick={onClose}>
          Close
        </button>
      </div>

      <p className={reading.stance === 'risk' ? 'notice is-error' : 'plan-detail-why'} role={reading.stance === 'risk' ? 'alert' : undefined}>
        {reading.why}
      </p>

      <dl className="plan-detail-facts">
        <div>
          <dt>Parked window</dt>
          <dd>
            {clockTime(session.pluggedInMs, timezone)} to {clockTime(session.deadlineMs, timezone)}, {countdown(session.pluggedInMs + parked, session.pluggedInMs)} in all
          </dd>
        </div>
        <div>
          <dt>Energy</dt>
          <dd>
            {session.energyDeliveredKwh.toFixed(1)} of {session.energyNeededKwh.toFixed(1)} kWh delivered, {reading.plannedKwh.toFixed(1)} kWh still planned
          </dd>
        </div>
        {blocks ? (
          <div>
            <dt>Plan</dt>
            <dd>{blocks}</dd>
          </div>
        ) : null}
      </dl>

      {session.status === 'active' || session.status === 'pending' ? (
        <OverrideControls session={session} siteId={siteId} timezone={timezone} currency={currency} onChanged={onChanged} />
      ) : null}
    </section>
  );
}
