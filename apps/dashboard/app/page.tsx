'use client';

import { useEffect, useState } from 'react';
import { Bays } from '../components/Bays';
import { Console } from '../components/Console';
import { DemandChart } from '../components/DemandChart';
import { SessionsTable } from '../components/SessionsTable';
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

            <div className="grid kpis">
              <div className="card kpi">
                <div className="label">Charging now</div>
                <div className="value">
                  {overview?.carsCharging ?? '--'}
                  <small>/ {overview?.carsPluggedIn ?? '--'} plugged in</small>
                </div>
                <div className="sub">{overview ? `${overview.chargersOnline} of ${overview.chargersTotal} bays online` : ''}</div>
              </div>

              <div className="card kpi">
                <div className="label">Site load</div>
                <div className="value">
                  {kw(overview?.siteDemandKw)}
                  <small>kW</small>
                </div>
                <div className="sub">
                  {overview ? `${kw(overview.headroomKw)} kW under the ${kw(overview.gridConnectionKw, 0)} kW cap` : ''}
                </div>
                <span className="bar">
                  <i className={used > 0.95 ? 'bad' : used > 0.8 ? 'warn' : ''} style={{ width: `${Math.min(100, used * 100)}%` }} />
                </span>
              </div>

              <div className="card kpi">
                <div className="label">Renewable share</div>
                <div className="value" style={{ color: overview ? carbonColor(overview.carbonGPerKwh) : undefined }}>
                  {percent(overview?.renewableShare)}
                </div>
                <div className="sub">
                  {overview ? `${Math.round(overview.carbonGPerKwh)} gCO2/kWh, ${carbonLabel(overview.carbonGPerKwh)}` : ''}
                </div>
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
                <h2>Charger fleet</h2>
                <span className="note">{site?.name}</span>
              </div>
              <Bays chargers={live.chargers} sessions={live.sessions} nowMs={live.nowMs} />
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
    <div className="card kpi">
      <div className="label">Saved so far</div>
      <div className="value" style={{ color: 'var(--green)' }}>
        {impact ? money(impact.costSaved, currency) : '--'}
      </div>
      <div className="sub">
        {impact ? `${impact.avoidedCo2Kg.toFixed(1)} kg CO2 avoided, ${impact.sessions} sessions` : 'against charging on plug-in'}
      </div>
    </div>
  );
}
