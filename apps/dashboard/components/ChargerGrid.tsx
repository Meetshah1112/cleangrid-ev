'use client';

import { countdown, kw } from '../lib/format';
import type { Charger, Session } from '../lib/types';

interface ChargerGridProps {
  readonly chargers: Charger[];
  readonly sessions: Session[];
  readonly nowMs: number;
}

export function ChargerGrid({ chargers, sessions, nowMs }: ChargerGridProps) {
  const activeByCharger = new Map(
    sessions.filter((session) => session.status === 'active').map((session) => [session.chargerId, session]),
  );

  return (
    <div className="chargers">
      {chargers.map((charger) => {
        const session = activeByCharger.get(charger.id);
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
          <article key={charger.id} className={`charger ${state}`}>
            <div className="bay">
              <span>{charger.label}</span>
              <span>{charger.online ? (charger.uncontrolled ? 'uncontrolled' : 'online') : 'offline'}</span>
            </div>
            <div className="driver">{session?.driverName ?? (charger.online ? 'free' : 'no connection')}</div>
            <div className="power">
              {kw(session?.currentPowerKw ?? 0)}
              <small> kW</small>
              {session?.limitKw !== null && session?.limitKw !== undefined && (
                <small> / {kw(session.limitKw)} limit</small>
              )}
            </div>
            {session && (
              <>
                <span className="bar">
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
