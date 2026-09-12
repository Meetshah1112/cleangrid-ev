'use client';

import { useEffect, useState } from 'react';
import { Console } from '../components/Console';
import { DemandChart } from '../components/DemandChart';
import { SessionsTable } from '../components/SessionsTable';
import { SiteMap } from '../components/SiteMap';
import { api } from '../lib/api';
import { carbonLabel, carbonColor, clockTime, kw, money, percent } from '../lib/format';
import type { Impact } from '../lib/types';

/** Overview: what the site is doing right now, and what the scheduler is doing about it. */
export default function OverviewPage() {
  return (
    <Console page="overview">
      {({ site, live }) => {
        const overview = live.overview;
        const plan = live.plan;
        const tz = site?.timezone ?? 'Europe/London';
        const used = overview && overview.gridConnectionKw > 0 ? overview.siteDemandKw / overview.gridConnectionKw : 0;
        const safe = plan ? plan.shortfalls.length === 0 : true;
        const urgent = live.sessions.filter(
          (session) => session.status === 'active' && session.deadlineMs - live.nowMs < 2 * 3_600_000,
        ).length;
        const scheduled = plan ? Object.values(plan.allocationsKw).filter((row) => row.some((value) => value > 0.01)).length : 0;

        return (
          <>
            <h1 className="headline">
              {overview && overview.carbonGPerKwh < 250
                ? 'The site is charging into a cleaner hour.'
                : overview && overview.carsCharging === 0 && overview.carsPluggedIn > 0
                  ? 'Holding the fleet until the grid gets cleaner.'
                  : 'Live network picture.'}
            </h1>
            <p className="subline">
              {plan
                ? `Scheduler last ran ${clockTime(plan.solvedMs, tz)} · ${plan.trigger.replace(/_/g, ' ')} · ${plan.solver.toUpperCase()} in ${plan.solveMs.toFixed(1)} ms`
                : 'Waiting for the first plan.'}
            </p>

            {/* One instrument rail rather than four floating cards: an operator reads these
                together, and four identical boxes make none of them the important one. */}
            <div className="rail">
              <div className="rail-cell">
                <span className="rail-label">Charging now</span>
                <span className="rail-value">
                  {overview?.carsCharging ?? '--'}
                  <small>of {overview?.carsPluggedIn ?? '--'} plugged in</small>
                </span>
                <span className="rail-sub">
                  {overview ? `${overview.chargersOnline} of ${overview.chargersTotal} bays online` : ''}
                </span>
              </div>

              <div className="rail-cell is-wide">
                <span className="rail-label">Site load</span>
                <span className="rail-value">
                  {kw(overview?.siteDemandKw)}
                  <small>kW of {kw(overview?.gridConnectionKw, 0)}</small>
                </span>
                <span className="gauge" aria-hidden="true">
                  <span
                    className={`gauge-fill${used > 0.95 ? ' is-bad' : used > 0.8 ? ' is-warn' : ''}`}
                    style={{ width: `${Math.max(2, Math.min(100, used * 100))}%` }}
                  />
                </span>
                <span className="rail-sub">
                  {overview ? `${kw(overview.headroomKw)} kW of headroom` : ''}
                </span>
              </div>

              <div className="rail-cell">
                <span className="rail-label">Renewable share</span>
                <span className="rail-value" style={{ color: overview ? carbonColor(overview.carbonGPerKwh) : undefined }}>
                  {percent(overview?.renewableShare)}
                </span>
                <span className="rail-sub">
                  {overview ? `${Math.round(overview.carbonGPerKwh)} gCO2/kWh, ${carbonLabel(overview.carbonGPerKwh)}` : ''}
                </span>
              </div>

              <TodaySaving siteId={site?.id ?? null} currency={site?.currency ?? 'GBP'} />
            </div>

            <div className="grid two" style={{ marginTop: 14 }}>
              <section className="card">
                <div className="card-head">
                  <h2>Measured site demand</h2>
                  <span className="note">
                    peak {kw(overview?.peakSoFarKw)} kW of {kw(overview?.gridConnectionKw, 0)} kW
                  </span>
                </div>
                <DemandChart demand={live.demand} nowMs={live.nowMs} timezone={tz} />
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>What the scheduler is doing</h2>
                </div>
                <div className="rows">
                  <div className="row">
                    <span className="lead">
                      <i />
                      Schedules {scheduled} session{scheduled === 1 ? '' : 's'} around the cleanest hours
                    </span>
                    <span className="num">{kw(plan?.totals.energyKwh ?? 0)} kWh</span>
                  </div>
                  <div className="row">
                    <span className="lead">
                      <i />
                      Holds the site under its connection
                    </span>
                    <span className="num">{plan ? `${kw(Math.max(...plan.capKw), 0)} kW` : '--'}</span>
                  </div>
                  <div className="row">
                    <span className="lead">
                      <i className={urgent > 0 ? 'amber' : 'dim'} />
                      Serves the cars with least slack first
                    </span>
                    <span className="num">{urgent} due &lt; 2h</span>
                  </div>
                  <div className="row">
                    <span className="lead">
                      <i className={plan?.fallbackReason ? 'amber' : ''} />
                      {plan?.fallbackReason ? 'Running on the greedy fallback' : 'Solving as a linear program'}
                    </span>
                    <span className="num">{plan ? `${plan.solveMs.toFixed(1)} ms` : '--'}</span>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <span className={safe ? 'chip' : 'chip red'}>
                    {safe ? '✓ All driver deadlines protected' : `${plan?.shortfalls.length} deadline at risk`}
                  </span>
                </div>
              </section>
            </div>

            <section className="card" style={{ marginTop: 14 }}>
              <div className="card-head">
                <h2>Live chargers</h2>
                <span className="note">{site?.name}</span>
              </div>
              <SiteMap chargers={live.chargers} sessions={live.sessions} siteName={site?.name ?? 'this site'} />
            </section>

            <section className="card" style={{ marginTop: 14 }}>
              <div className="card-head">
                <h2>Sessions and exceptions</h2>
                <span className="note">deadline order</span>
              </div>
              <SessionsTable sessions={live.sessions} nowMs={live.nowMs} timezone={tz} />
            </section>
          </>
        );
      }}
    </Console>
  );
}

/** Money saved so far today, measured rather than projected. */
function TodaySaving({ siteId, currency }: { readonly siteId: string | null; readonly currency: string }) {
  const [impact, setImpact] = useState<Impact | null>(null);

  useEffect(() => {
    if (!siteId) return undefined;
    const load = (): void => {
      void api
        .impact(siteId)
        .then(setImpact)
        .catch(() => setImpact(null));
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [siteId]);

  return (
    <div className="rail-cell">
      <span className="rail-label">Saved so far</span>
      <span className="rail-value" style={{ color: 'var(--green)' }}>
        {impact ? money(impact.costSaved, currency) : '--'}
      </span>
      <span className="rail-sub">
        {impact ? `${impact.avoidedCo2Kg.toFixed(1)} kg CO2 avoided, ${impact.sessions} sessions` : 'against charging on plug-in'}
      </span>
    </div>
  );
}
