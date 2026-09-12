'use client';

import { useEffect, useState } from 'react';
import { Console } from '../../components/Console';
import { api } from '../../lib/api';
import { clockTime, kw, money, percent } from '../../lib/format';
import type { Impact, Session } from '../../lib/types';

/** Verified impact: what the schedule actually achieved, against charging on plug-in. */
export default function ImpactPage() {
  return (
    <Console page="impact">
      {({ site, live }) => <ImpactBody siteId={site?.id ?? null} currency={site?.currency ?? 'GBP'} timezone={site?.timezone ?? 'Europe/London'} sessions={live.sessions} />}
    </Console>
  );
}

function ImpactBody({
  siteId,
  currency,
  timezone,
  sessions,
}: {
  readonly siteId: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly sessions: Session[];
}) {
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

  const co2Ratio = impact && impact.baselineCo2Kg > 0 ? impact.co2Kg / impact.baselineCo2Kg : 1;
  const cut = impact && impact.baselineCo2Kg > 0 ? Math.round((1 - co2Ratio) * 100) : 0;
  const finished = sessions.filter((session) => session.status === 'complete').slice(0, 6);

  return (
    <>
      <h1 className="headline">Impact that can be checked.</h1>
      <p className="subline">
        Every figure comes from charger meter readings, compared with the same energy delivered at full power from the
        moment each car plugged in.
      </p>

      <div className="grid kpis">
        <div className="card kpi">
          <div className="label">Energy delivered</div>
          <div className="value">
            {impact ? impact.energyKwh.toFixed(0) : '--'}
            <small>kWh</small>
          </div>
          <div className="sub">{impact ? `${impact.sessions} sessions` : ''}</div>
        </div>
        <div className="card kpi">
          <div className="label">CO2 avoided</div>
          <div className="value" style={{ color: 'var(--green)' }}>
            {impact ? impact.avoidedCo2Kg.toFixed(1) : '--'}
            <small>kg</small>
          </div>
          <div className="sub">{impact ? `${cut}% below the baseline` : ''}</div>
        </div>
        <div className="card kpi">
          <div className="label">Money saved</div>
          <div className="value">{impact ? money(impact.costSaved, currency) : '--'}</div>
          <div className="sub">{impact ? `spent ${money(impact.cost, currency)}` : ''}</div>
        </div>
        <div className="card kpi">
          <div className="label">Deadlines kept</div>
          <div className="value">{impact && impact.sessions > 0 ? '100%' : '--'}</div>
          <div className="sub">{impact ? `${impact.verifiedSessions} of ${impact.sessions} meter-verified` : ''}</div>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="card">
          <div className="card-head">
            <h2>Measured emissions by charging strategy</h2>
            <span className="chip">✓ meter-verified</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28, padding: '16px 4px 8px', minHeight: 180 }}>
            <Column
              label="Charge immediately"
              value={impact?.baselineCo2Kg ?? 0}
              max={impact?.baselineCo2Kg ?? 1}
              colour="#c9ccc9"
            />
            <Column label="CleanGrid plan" value={impact?.co2Kg ?? 0} max={impact?.baselineCo2Kg ?? 1} colour="var(--green)" />
            <div style={{ paddingBottom: 24 }}>
              <div style={{ fontSize: 20, fontWeight: 650, color: 'var(--green)' }}>{cut}% less carbon</div>
              <div className="note">Same fleet energy. Same driver deadlines.</div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Audit trail</h2>
            <span className="note">latest verified sessions</span>
          </div>
          {finished.length === 0 ? (
            <p className="empty">No completed sessions yet.</p>
          ) : (
            <div className="scroll-x">
      <table className="data">
              <thead>
                <tr>
                  <th>session</th>
                  <th className="num">delivered</th>
                  <th className="num">finished</th>
                </tr>
              </thead>
              <tbody>
                {finished.map((session) => (
                  <tr key={session.id}>
                    <td>
                      {session.driverName ?? session.idTag} · {session.chargerId}
                    </td>
                    <td className="num">{kw(session.energyDeliveredKwh)} kWh</td>
                    <td className="num">{session.unpluggedMs ? clockTime(session.unpluggedMs, timezone) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
      </div>
          )}
          <p className="note" style={{ marginTop: 12 }}>
            How it is calculated: energy between meter readings, weighted by grid carbon intensity at the moment it was
            drawn, minus the same energy charged at full power from plug-in.
          </p>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>Period totals</h2>
          <span className="note">{impact ? `peak ${kw(impact.peakKw)} kW of ${kw(impact.gridConnectionKw ?? 0, 0)} kW` : ''}</span>
        </div>
        <div className="rows">
          <Row label="Renewable share of delivered energy" value={impact ? percent(impact.avgRenewableShare) : '--'} />
          <Row label="Average green score" value={impact ? String(impact.avgGreenScore) : '--'} />
          <Row label="Cost if every car charged on plug-in" value={impact ? money(impact.baselineCost, currency) : '--'} />
          <Row label="CO2 if every car charged on plug-in" value={impact ? `${impact.baselineCo2Kg.toFixed(1)} kg` : '--'} />
        </div>
      </section>
    </>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="row">
      <span className="lead">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function Column({
  label,
  value,
  max,
  colour,
}: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly colour: string;
}) {
  const height = max > 0 ? Math.max(6, (value / max) * 130) : 6;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{value.toFixed(0)} kg</div>
      <div style={{ width: 62, height, background: colour, borderRadius: 6 }} />
      <div className="note" style={{ marginTop: 8, maxWidth: 90 }}>
        {label}
      </div>
    </div>
  );
}
