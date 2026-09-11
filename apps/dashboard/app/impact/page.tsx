'use client';

import { useEffect, useState } from 'react';
import { TopBar } from '../../components/TopBar';
import { api } from '../../lib/api';
import { money, percent } from '../../lib/format';
import type { Impact } from '../../lib/types';
import { useLiveSite } from '../../lib/useLiveSite';

/** What the site actually saved, measured from meter readings rather than from the plan. */
export default function ImpactPage() {
  const site = useLiveSite();
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = (): void => {
      void api
        .impact()
        .then((next) => {
          setImpact(next);
          setError(null);
        })
        .catch((caught: Error) => setError(caught.message));
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  const co2Ratio = impact && impact.baselineCo2Kg > 0 ? impact.co2Kg / impact.baselineCo2Kg : 1;
  const costRatio = impact && impact.baselineCost > 0 ? impact.cost / impact.baselineCost : 1;

  return (
    <main className="shell">
      <TopBar nowMs={site.nowMs} timeScale={site.timeScale} connected={site.connected} page="impact" />
      {error && <div className="error-banner">Cannot reach the server: {error}</div>}

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Verified impact</h2>
          <span className="panel-note">
            {impact ? `${impact.verifiedSessions} of ${impact.sessions} sessions measured from meter data` : ''}
          </span>
        </div>

        <div className="impact-hero">
          <div>
            <span className="label" style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: '0.08em' }}>
              CO2 AVOIDED
            </span>
            <div className="figure" style={{ color: 'var(--accent)' }}>
              {impact ? impact.avoidedCo2Kg.toFixed(1) : '--'}
              <span style={{ fontSize: 16, color: 'var(--muted)' }}> kg</span>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
              against charging at full power from the moment each car plugged in
            </p>
          </div>
          <div>
            <span style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: '0.08em' }}>MONEY SAVED</span>
            <div className="figure">{impact ? money(impact.costSaved, impact.currency) : '--'}</div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
              on {impact ? impact.energyKwh.toFixed(0) : '--'} kWh delivered
            </p>
          </div>
          <div>
            <span style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: '0.08em' }}>AVERAGE GREEN SCORE</span>
            <div className="figure">{impact ? impact.avgGreenScore : '--'}</div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
              {impact ? percent(impact.avgRenewableShare) : '--'} of energy from renewables
            </p>
          </div>
          <div>
            <span style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: '0.08em' }}>PEAK SITE DRAW</span>
            <div className="figure">
              {impact ? impact.peakKw.toFixed(0) : '--'}
              <span style={{ fontSize: 16, color: 'var(--muted)' }}> kW</span>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
              against a {site.overview?.gridConnectionKw ?? '--'} kW connection
            </p>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <h2>Smart charging against dumb charging</h2>
        <div className="compare">
          <div className="compare-row">
            <span>CO2, smart</span>
            <span className="track">
              <i style={{ width: `${Math.min(100, co2Ratio * 100)}%`, background: 'var(--accent)' }} />
            </span>
            <span className="num">{impact ? `${impact.co2Kg.toFixed(1)} kg` : '--'}</span>
          </div>
          <div className="compare-row">
            <span>CO2, dumb</span>
            <span className="track">
              <i style={{ width: '100%', background: 'var(--red)' }} />
            </span>
            <span className="num">{impact ? `${impact.baselineCo2Kg.toFixed(1)} kg` : '--'}</span>
          </div>
          <div className="compare-row">
            <span>Cost, smart</span>
            <span className="track">
              <i style={{ width: `${Math.min(100, costRatio * 100)}%`, background: 'var(--accent)' }} />
            </span>
            <span className="num">{impact ? money(impact.cost, impact.currency) : '--'}</span>
          </div>
          <div className="compare-row">
            <span>Cost, dumb</span>
            <span className="track">
              <i style={{ width: '100%', background: 'var(--red)' }} />
            </span>
            <span className="num">{impact ? money(impact.baselineCost, impact.currency) : '--'}</span>
          </div>
        </div>
        <p style={{ color: 'var(--dim)', fontSize: 12, marginTop: 14 }}>
          Energy comes from charger meter readings. Emissions use the grid intensity at the moment each kilowatt hour
          was drawn. The counterfactual delivers the same energy at full power starting when the cable went in.
        </p>
      </section>
    </main>
  );
}
