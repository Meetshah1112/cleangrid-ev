'use client';

import { useState } from 'react';
import { Console } from '../../components/Console';
import { ScheduleGantt, SiteDrawBars } from '../../components/ScheduleGantt';
import { SessionsTable } from '../../components/SessionsTable';
import { api } from '../../lib/api';
import { clockTime, kw } from '../../lib/format';

/** The scheduler proof screen: every planned charging block, and the shape it makes. */
export default function SchedulesPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the last re-plan actually did.
   *
   * Without it the button was indistinguishable from a broken one. A re-solve on an already
   * optimal site returns the same schedule, so the chart does not move, and the only sign anything
   * happened was a label flickering for a few hundred milliseconds. A failure looked exactly the
   * same, because nothing caught it. Saying what came back is the difference between a control
   * that works and one that appears not to.
   */
  const [outcome, setOutcome] = useState<string | null>(null);

  return (
    <Console page="schedules">
      {({ site, live }) => {
        const plan = live.plan;
        const tz = site?.timezone ?? 'Europe/London';
        const deadlinesSafe = plan ? plan.shortfalls.length === 0 : true;
        const planned = plan ? Object.values(plan.allocationsKw).filter((row) => row.some((value) => value > 0.01)).length : 0;
        const active = live.sessions.filter((session) => session.status === 'active').length;

        const replan = (): void => {
          if (!site) return;
          setBusy(true);
          setError(null);
          setOutcome(null);
          void api
            .replan(site.id)
            // Wait for the new plan to be in state, not merely for the server to have accepted the
            // request, or the button reports itself finished while the chart still shows the old one.
            .then(async (result) => {
              await live.refresh();
              if (result.queued) {
                setOutcome('The optimiser is off at this site, so nothing was planned. It is watching and measuring only.');
                return;
              }
              if (result.status === 'error') {
                setOutcome('The solver could not produce a plan. The last good one is still in force.');
                return;
              }
              const solver = (result.solver ?? 'lp').toUpperCase();
              const risk = result.status === 'shortfall' ? ' · some deadlines cannot be met' : ' · every deadline met';
              setOutcome(`Re-planned ${clockTime(Date.now(), tz)} · solved by ${solver}${risk}`);
            })
            .catch((caught: Error) => setError(caught.message))
            .finally(() => setBusy(false));
        };

        return (
          <>
            <h1 className="headline">Spread the load, hold the promise.</h1>
            {error ? <div className="error">{error}</div> : null}
            <p className="subline">
              24-hour plan in {plan?.grid.slotMinutes ?? 15}-minute blocks. Each bar is power the optimiser has committed
              to a car.
            </p>

            <section className="card">
              <div className="card-head">
                <h2>Charging schedule</h2>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className={deadlinesSafe ? 'chip' : 'chip red'}>
                    {deadlinesSafe ? `✓ ${active} / ${active} deadlines safe` : `${plan?.shortfalls.length} at risk`}
                  </span>
                  <span className="chip plain">
                    {plan
                      ? `${plan.solver.toUpperCase()} · ${deadlinesSafe ? 'auto-replanning' : 'replanning every minute'}`
                      : 'no plan'}
                  </span>
                  <button type="button" className="btn" onClick={replan} disabled={busy || !site}>
                    {busy ? 'Replanning…' : 'Re-plan now'}
                  </button>
                </span>
              </div>
              {outcome ? <p className="note replan-outcome">{outcome}</p> : null}
              {!deadlinesSafe && plan ? (
                <p className="note replan-outcome">
                  {plan.shortfalls.length} driver{plan.shortfalls.length === 1 ? '' : 's'} cannot be fully charged by
                  the deadline they gave. The optimiser is re-planning every minute until that changes, so anything
                  that frees up — a car finishing early, a flexibility window ending — is used as soon as it does.
                </p>
              ) : null}
              <ScheduleGantt plan={plan} sessions={live.sessions} nowMs={live.nowMs} timezone={tz} />
            </section>

            <section className="card" style={{ marginTop: 14 }}>
              <div className="card-head">
                <h2>Site draw after optimisation</h2>
                <span className="note">
                  {planned} car{planned === 1 ? '' : 's'} scheduled · planned peak {kw(plan?.totals.peakKw)} kW ·{' '}
                  {plan ? `solved ${clockTime(plan.solvedMs, tz)}` : ''}
                </span>
              </div>
              <SiteDrawBars plan={plan} timezone={tz} />
            </section>

            <section className="card" style={{ marginTop: 14 }}>
              <div className="card-head">
                <h2>Sessions</h2>
                <span className="note">change a mode, or give a driver more time, and the plan re-solves</span>
              </div>
              <SessionsTable
                sessions={live.sessions}
                nowMs={live.nowMs}
                timezone={tz}
                onChanged={() => void live.refresh()}
              />
            </section>

            <section className="card" style={{ marginTop: 14 }}>
              <div className="card-head">
                <h2>Dispatch log</h2>
                <span className="note">what actually reached the chargers</span>
              </div>
              {live.dispatches.length === 0 ? (
                <p className="empty">Nothing sent yet.</p>
              ) : (
                <div className="log">
                  {live.dispatches.map((dispatch) => (
                    <div key={dispatch.id}>
                      {clockTime(dispatch.sentMs, tz)} {dispatch.chargerId} {(dispatch.limitW / 1000).toFixed(1)} kW{' '}
                      <span className={dispatch.status === 'Accepted' ? 'ok' : 'bad'}>{dispatch.status.toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        );
      }}
    </Console>
  );
}
