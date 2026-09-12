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
          void api
            .replan(site.id)
            .then(() => live.refresh())
            .finally(() => setBusy(false));
        };

        return (
          <>
            <h1 className="headline">Spread the load, hold the promise.</h1>
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
                  <span className="chip plain">{plan ? `${plan.solver.toUpperCase()} · auto-replanning` : 'no plan'}</span>
                  <button type="button" className="btn" onClick={replan} disabled={busy || !site}>
                    {busy ? 'Replanning…' : 'Re-plan now'}
                  </button>
                </span>
              </div>
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
                <span className="note">operator can override a deadline or mode through the API</span>
              </div>
              <SessionsTable sessions={live.sessions} nowMs={live.nowMs} timezone={tz} />
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
