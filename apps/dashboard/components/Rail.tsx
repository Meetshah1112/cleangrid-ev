'use client';

import { useState } from 'react';
import { api } from '../lib/api';
import { carbonColor, clockTime, kw, percent } from '../lib/format';
import type { Dispatch, FlexEvent, Forecast, Plan } from '../lib/types';

interface RailProps {
  readonly plan: Plan | null;
  readonly forecast: Forecast | null;
  readonly flexEvents: FlexEvent[];
  readonly dispatches: Dispatch[];
  readonly onChanged: () => void;
}

export function Rail({ plan, forecast, flexEvents, dispatches, onChanged }: RailProps) {
  const [busy, setBusy] = useState(false);
  const pending = flexEvents.filter((event) => event.status === 'requested');
  const honoured = flexEvents.filter((event) => event.status === 'accepted' || event.status === 'active');

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await run();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="rail">
      <section className="panel">
        <div className="panel-head">
          <h2>Current plan</h2>
          <span className="panel-note">{plan ? `${plan.solveMs.toFixed(1)} ms` : '--'}</span>
        </div>
        <div className="row">
          <span>solver</span>
          <span>{plan ? `${plan.solver}${plan.fallbackReason ? ' (fallback)' : ''}` : '--'}</span>
        </div>
        <div className="row">
          <span>status</span>
          <span>{plan?.status ?? '--'}</span>
        </div>
        <div className="row">
          <span>solved</span>
          <span>{plan ? clockTime(plan.solvedMs) : '--'}</span>
        </div>
        <div className="row">
          <span>triggered by</span>
          <span>{plan?.trigger ?? '--'}</span>
        </div>
        <div className="row">
          <span>planned peak</span>
          <span>{plan ? `${kw(plan.totals.peakKw)} kW` : '--'}</span>
        </div>
        {plan && plan.shortfalls.length > 0 && (
          <div className="row">
            <span>shortfalls</span>
            <span style={{ color: 'var(--red)' }}>{plan.shortfalls.length}</span>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy} onClick={() => void act(() => api.replan())}>
            Re-plan now
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Grid flexibility</h2>
        {pending.length === 0 && honoured.length === 0 && <p className="empty">No requests from the network.</p>}
        {pending.map((event) => (
          <div key={event.id} className="flex-request">
            <span className="when">
              {clockTime(event.startsMs)}&ndash;{clockTime(event.endsMs)} cap {kw(event.capKw, 0)} kW
            </span>
            {event.reason && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{event.reason}</span>}
            <div className="flex-actions">
              <button className="primary" disabled={busy} onClick={() => void act(() => api.respondToFlex(event.id, true))}>
                Accept
              </button>
              <button className="ghost" disabled={busy} onClick={() => void act(() => api.respondToFlex(event.id, false))}>
                Decline
              </button>
            </div>
          </div>
        ))}
        {honoured.map((event) => (
          <div key={event.id} className="row">
            <span>
              {clockTime(event.startsMs)}&ndash;{clockTime(event.endsMs)}
            </span>
            <span>honouring {kw(event.capKw, 0)} kW</span>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Forecast sources</h2>
        {forecast ? (
          <>
            <div className="row">
              <span>carbon</span>
              <span>{forecast.sources.carbon}</span>
            </div>
            <div className="row">
              <span>price</span>
              <span>{forecast.sources.price}</span>
            </div>
            <div className="row">
              <span>renewables</span>
              <span>{forecast.sources.renewable}</span>
            </div>
            {forecast.greenWindow && (
              <div className="row">
                <span>cleanest window</span>
                <span style={{ color: carbonColor(forecast.greenWindow.avgCarbonGPerKwh) }}>
                  {clockTime(forecast.greenWindow.startMs)}&ndash;{clockTime(forecast.greenWindow.endMs)},{' '}
                  {percent(forecast.greenWindow.avgRenewableShare)}
                </span>
              </div>
            )}
            {forecast.notes.map((note) => (
              <p key={note} style={{ fontSize: 12, color: 'var(--dim)', margin: '8px 0 0' }}>
                {note}
              </p>
            ))}
          </>
        ) : (
          <p className="empty">No forecast loaded.</p>
        )}
      </section>

      <section className="panel">
        <h2>Dispatch log</h2>
        {dispatches.length === 0 ? (
          <p className="empty">Nothing sent to the chargers yet.</p>
        ) : (
          <div className="log">
            {dispatches.map((dispatch) => (
              <div key={dispatch.id}>
                {clockTime(dispatch.sentMs)} {dispatch.chargerId} {(dispatch.limitW / 1000).toFixed(1)} kW{' '}
                <span className={dispatch.status === 'Accepted' ? 'ok' : 'bad'}>{dispatch.status.toLowerCase()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
