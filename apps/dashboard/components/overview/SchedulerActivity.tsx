import { kw } from '../../lib/format';
import type { Plan, Session } from '../../lib/types';

/**
 * What the scheduler is doing, as four plain statements with their evidence.
 *
 * Set as a list rather than a panel, because each line is a sentence about the site that ends in
 * the number that proves it, and a reader goes down it the way they would read a short report.
 */
export function SchedulerActivity({
  plan,
  sessions,
  nowMs,
}: {
  readonly plan: Plan | null;
  readonly sessions: readonly Session[];
  readonly nowMs: number;
}) {
  if (!plan) return <p className="empty">The scheduler solves as soon as a car plugs in.</p>;

  const scheduled = Object.values(plan.allocationsKw).filter((row) => row.some((value) => value > 0.01)).length;
  // Only cars that still need energy compete for it; a full one leaving soon is not urgent.
  const dueSoon = sessions.filter(
    (session) =>
      session.status === 'active' &&
      nowMs > 0 &&
      session.deadlineMs - nowMs < 2 * 3_600_000 &&
      session.energyNeededKwh - session.energyDeliveredKwh > 0.05,
  ).length;
  const capKw = plan.capKw.length > 0 ? Math.max(...plan.capKw) : null;
  const safe = plan.shortfalls.length === 0;

  return (
    <div className="activity">
      <ol>
        <li>
          <span>
            Schedules {scheduled} session{scheduled === 1 ? '' : 's'} around the cleanest hours
          </span>
          <span className="figure">{kw(plan.totals.energyKwh)} kWh</span>
        </li>
        <li>
          <span>Holds the site under its connection</span>
          <span className="figure">{capKw === null ? '--' : `${kw(capKw, 0)} kW`}</span>
        </li>
        <li>
          <span>Serves the cars with least slack first</span>
          <span className="figure">{dueSoon} due within 2h</span>
        </li>
        <li className={plan.fallbackReason ? 'is-caution' : undefined}>
          <span>{plan.fallbackReason ? 'Running on the safe greedy fallback' : 'Solving as a linear program'}</span>
          <span className="figure">{plan.solveMs.toFixed(1)} ms</span>
        </li>
      </ol>
      <p className={safe ? 'activity-close is-safe' : 'activity-close is-risk'}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {safe ? (
            <path d="m4.5 12.5 5 5 10-11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M12 4 21 20H3zM12 10v4.5M12 17.2v.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        {safe
          ? 'All driver deadlines protected'
          : `${plan.shortfalls.length} driver${plan.shortfalls.length === 1 ? '' : 's'} cannot be fully charged in time. Re-planning every minute.`}
      </p>
    </div>
  );
}
