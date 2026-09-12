'use client';

import { useCallback, useEffect, useState } from 'react';
import { Console } from '../../components/Console';
import { api, gridApi } from '../../lib/api';
import { clockTime, kw } from '../../lib/format';
import type { FlexEvent, GridSite } from '../../lib/types';

/**
 * Grid-flex response. A network operator asks a site to hold below a share of its connection;
 * the site answers by reshuffling charging, not by cutting anyone off.
 */

const REDUCTIONS = [20, 40, 60];

export default function GridPage() {
  return (
    <Console page="grid">
      {({ site, live }) => (
        <GridBody
          siteId={site?.id ?? null}
          siteName={site?.name ?? ''}
          timezone={site?.timezone ?? 'Europe/London'}
          connectionKw={site?.gridConnectionKw ?? 0}
          nowMs={live.nowMs}
          flexEvents={live.flexEvents}
          atRisk={live.sessions.filter((session) => session.status === 'active' && session.deadlineRisk).length}
          activeSessions={live.sessions.filter((session) => session.status === 'active').length}
          onChanged={live.refresh}
        />
      )}
    </Console>
  );
}

function GridBody({
  siteId,
  siteName,
  timezone,
  connectionKw,
  nowMs,
  flexEvents,
  atRisk,
  activeSessions,
  onChanged,
}: {
  readonly siteId: string | null;
  readonly siteName: string;
  readonly timezone: string;
  readonly connectionKw: number;
  readonly nowMs: number;
  readonly flexEvents: FlexEvent[];
  readonly atRisk: number;
  readonly activeSessions: number;
  readonly onChanged: () => void;
}) {
  const [network, setNetwork] = useState<GridSite[]>([]);
  const [reduction, setReduction] = useState(40);
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNetwork = useCallback(() => {
    void gridApi
      .sites()
      .then(setNetwork)
      .catch((caught: Error) => setError(caught.message));
  }, []);

  useEffect(() => {
    loadNetwork();
    const timer = setInterval(loadNetwork, 4_000);
    return () => clearInterval(timer);
  }, [loadNetwork]);

  const here = network.find((entry) => entry.siteId === siteId) ?? null;
  const live = flexEvents.find((event) => event.status === 'accepted' && event.endsMs > nowMs) ?? null;
  const capKw = Math.round(connectionKw * (1 - reduction / 100) * 10) / 10;

  const request = (): void => {
    if (!siteId) return;
    setBusy(true);
    void gridApi
      .requestReduction({ siteId, reductionPct: reduction, hours, connectionKw, nowMs })
      .then(() => {
        loadNetwork();
        onChanged();
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  const withdraw = (eventId: string): void => {
    if (!siteId) return;
    setBusy(true);
    void api
      .respondToFlex(siteId, eventId, false)
      .then(() => onChanged())
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <h1 className="headline">Respond to the grid without breaking departures.</h1>
      <p className="subline">A flexible site is easier for the network to plan around.</p>
      {error && <div className="error">{error}</div>}

      {live ? (
        <div className="banner">
          <div>
            <div className="when">
              Active request · in force until {clockTime(live.endsMs, timezone)} · {siteName}
            </div>
            <div className="what">
              Hold below {kw(live.capKw, 0)} kW for{' '}
              {Math.max(1, Math.round((live.endsMs - live.startsMs) / 60_000))} minutes
            </div>
          </div>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className={atRisk === 0 ? 'chip' : 'chip red'}>{atRisk === 0 ? 'Compliant' : `${atRisk} at risk`}</span>
            <button type="button" className="btn" onClick={() => withdraw(live.id)} disabled={busy}>
              Withdraw
            </button>
          </span>
        </div>
      ) : (
        <div className="banner">
          <div>
            <div className="when">No request in force</div>
            <div className="what">The site is running to its own plan</div>
          </div>
          <span className="chip plain">standing by</span>
        </div>
      )}

      <div className="grid kpis" style={{ marginTop: 14 }}>
        <div className="card kpi">
          <div className="label">Available to shed</div>
          <div className="value">
            {kw(here?.flexibleKw ?? 0)}
            <small>kW</small>
          </div>
          <div className="sub">across {activeSessions} sessions</div>
        </div>
        <div className="card kpi">
          <div className="label">Deadline risk</div>
          <div className="value" style={{ color: atRisk > 0 ? 'var(--red)' : undefined }}>
            {atRisk}
          </div>
          <div className="sub">drivers affected</div>
        </div>
        <div className="card kpi">
          <div className="label">Drawing now</div>
          <div className="value">
            {kw(here?.currentDrawKw ?? 0)}
            <small>kW</small>
          </div>
          <div className="sub">of {kw(connectionKw, 0)} kW connection</div>
        </div>
        <div className="card kpi">
          <div className="label">Would hold below</div>
          <div className="value">
            {kw(capKw, 0)}
            <small>kW</small>
          </div>
          <div className="sub">at {reduction}% reduction</div>
        </div>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>Ask for a reduction</h2>
          <span className="note">the site honours it automatically under its flexibility contract</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {REDUCTIONS.map((value) => (
            <button
              key={value}
              type="button"
              className={value === reduction ? 'btn primary' : 'btn'}
              onClick={() => setReduction(value)}
              aria-pressed={value === reduction}
            >
              {value}%
            </button>
          ))}
          <span className="note" style={{ marginInline: 6 }}>
            for
          </span>
          {[1, 2, 3].map((value) => (
            <button
              key={value}
              type="button"
              className={value === hours ? 'btn primary' : 'btn'}
              onClick={() => setHours(value)}
              aria-pressed={value === hours}
            >
              {value} h
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" onClick={request} disabled={busy || !siteId} style={{ fontSize: 15, padding: '10px 16px' }}>
          {busy ? 'Sending…' : `Reduce site load ${reduction}% for ${hours === 1 ? 'one hour' : `${hours} hours`}`}
        </button>
        <p className="note" style={{ marginTop: 10 }}>
          The optimiser moves charging out of the window rather than cutting cars off. Anything that cannot move without
          missing a deadline keeps charging, and shows up as deadline risk above.
        </p>
      </section>

      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="card">
          <div className="card-head">
            <h2>Connected sites</h2>
            <span className="note">what the network can see</span>
          </div>
          {network.length === 0 ? (
            <p className="empty">No sites connected.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>site</th>
                  <th className="num">drawing</th>
                  <th className="num">connection</th>
                  <th className="num">flexible</th>
                  <th className="num">cars</th>
                </tr>
              </thead>
              <tbody>
                {network.map((entry) => (
                  <tr key={entry.siteId}>
                    <td>{entry.name}</td>
                    <td className="num" style={{ color: entry.currentDrawKw > entry.gridConnectionKw ? 'var(--red)' : undefined }}>
                      {kw(entry.currentDrawKw)} kW
                    </td>
                    <td className="num">{kw(entry.gridConnectionKw, 0)} kW</td>
                    <td className="num" style={{ color: 'var(--green)' }}>
                      {kw(entry.flexibleKw)} kW
                    </td>
                    <td className="num">{entry.carsPluggedIn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Requests</h2>
            <span className="note">{siteName}</span>
          </div>
          {flexEvents.length === 0 ? (
            <p className="empty">Nothing asked for yet.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>window</th>
                  <th className="num">cap</th>
                  <th>status</th>
                </tr>
              </thead>
              <tbody>
                {[...flexEvents]
                  .sort((a, b) => b.createdMs - a.createdMs)
                  .slice(0, 8)
                  .map((event) => (
                    <tr key={event.id}>
                      <td>
                        {clockTime(event.startsMs, timezone)}&ndash;{clockTime(event.endsMs, timezone)}
                      </td>
                      <td className="num">{kw(event.capKw, 0)} kW</td>
                      <td>
                        <span className={`pill${event.status === 'declined' ? ' risk' : ''}`}>
                          {event.status === 'accepted' && event.endsMs > nowMs ? 'in force' : event.status}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
