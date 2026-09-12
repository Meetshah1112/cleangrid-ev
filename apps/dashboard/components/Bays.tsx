'use client';

import { countdown, kw } from '../lib/format';
import type { Charger, Session } from '../lib/types';

/** Operational view of every connector: who is on it, at what power, and how long they have. */
export function Bays({
  chargers,
  sessions,
  nowMs,
}: {
  readonly chargers: Charger[];
  readonly sessions: Session[];
  readonly nowMs: number;
}) {
  const active = new Map(
    sessions.filter((session) => session.status === 'active').map((session) => [session.chargerId, session]),
  );

  if (chargers.length === 0) return <p className="empty">No chargers at this site.</p>;

  return (
    <div className="bays">
      {chargers.map((charger) => {
        const session = active.get(charger.id);
        const state = !charger.online
          ? 'offline'
          : session?.deadlineRisk
            ? 'risk'
            : session && session.currentPowerKw > 0.05
              ? 'charging'
              : session
                ? 'waiting'
                : '';
        const progress = session
          ? Math.min(100, (session.energyDeliveredKwh / Math.max(0.1, session.energyNeededKwh)) * 100)
          : 0;

        return (
          <article key={charger.id} className={`bay ${state}`}>
            <div className="top">
              <span>{charger.label}</span>
              <span>{charger.online ? (charger.uncontrolled ? 'uncontrolled' : `${charger.maxPowerKw} kW`) : 'offline'}</span>
            </div>
            <div className="who">{session?.driverName ?? (charger.online ? 'free' : 'no connection')}</div>
            <div className="kw">
              {kw(session?.currentPowerKw ?? 0)}
              <small> kW</small>
              {session?.limitKw !== null && session?.limitKw !== undefined && <small> / {kw(session.limitKw)} limit</small>}
            </div>
            {session && (
              <>
                <span className="mini-bar" style={{ width: '100%' }}>
                  <i style={{ width: `${progress}%` }} />
                </span>
                <div className="foot">
                  <span>
                    {session.energyDeliveredKwh.toFixed(1)} / {session.energyNeededKwh.toFixed(1)} kWh
                  </span>
                  <span>{countdown(session.deadlineMs, nowMs)}</span>
                </div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
