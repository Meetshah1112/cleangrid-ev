'use client';

import type { ReactNode } from 'react';
import { clockTime, countdown, modeLabel } from '../lib/format';
import type { Session } from '../lib/types';

/**
 * The cars on site, soonest departure first, one calm line each.
 *
 * A row says who, where, how far along, when they leave, what they asked for and what the car is
 * doing. It carries one warning, and only when a deadline is actually at risk, with the earliest
 * time the car could finish if it charged flat out: an operator can act on a time, and cannot act
 * on a red badge.
 */

export function SessionsList({
  sessions,
  nowMs,
  timezone,
  selectedId = null,
  onSelect,
  actions,
}: {
  readonly sessions: readonly Session[];
  readonly nowMs: number;
  readonly timezone: string;
  readonly selectedId?: string | null;
  readonly onSelect?: (session: Session) => void;
  /** Controls shown on the selected row only. */
  readonly actions?: (session: Session) => ReactNode;
}) {
  const rows = [...sessions]
    .filter((session) => session.status === 'active' || session.status === 'pending')
    .sort((a, b) => a.deadlineMs - b.deadlineMs);

  if (rows.length === 0) return <p className="empty">Nothing plugged in right now.</p>;

  return (
    <ul className="sessions">
      {rows.map((session) => {
        const remaining = Math.max(0, session.energyNeededKwh - session.energyDeliveredKwh);
        const done = session.energyNeededKwh > 0 ? Math.min(1, session.energyDeliveredKwh / session.energyNeededKwh) : 0;
        const earliest = nowMs > 0 ? nowMs + (remaining / Math.max(0.1, session.maxPowerKw)) * 3_600_000 : null;
        const state =
          remaining <= 0.05 ? 'Charged, ready to leave' : session.currentPowerKw > 0.05 ? `Charging at ${session.currentPowerKw.toFixed(1)} kW` : 'Holding for a better hour';
        const selected = selectedId === session.id;

        return (
          <li
            key={session.id}
            id={`session-${session.id}`}
            className={`session${selected ? ' is-selected' : ''}${session.deadlineRisk ? ' is-risk' : ''}`}
          >
            <button
              type="button"
              className="session-main"
              onClick={onSelect ? () => onSelect(session) : undefined}
              disabled={!onSelect}
              aria-expanded={onSelect ? selected : undefined}
            >
              <span className="session-who">
                <strong>{session.driverName ?? session.idTag}</strong>
                <span>{session.chargerId}</span>
              </span>
              <span className="session-energy">
                <span className="figure">
                  {session.energyDeliveredKwh.toFixed(1)} of {session.energyNeededKwh.toFixed(1)} kWh
                </span>
                <span className="session-line" aria-hidden="true">
                  <i style={{ width: `${Math.round(done * 100)}%` }} />
                </span>
              </span>
              <span className="session-deadline">
                <span className="figure">{clockTime(session.deadlineMs, timezone)}</span>
                <span>{nowMs <= 0 ? '' : session.deadlineMs <= nowMs ? 'leaving now' : `in ${countdown(session.deadlineMs, nowMs)}`}</span>
              </span>
              <span className={`session-mode is-${session.mode}`}>{modeLabel[session.mode] ?? session.mode}</span>
              <span className="session-state">{state}</span>
            </button>

            {session.deadlineRisk ? (
              <p className="session-warning" role="alert">
                {earliest !== null && earliest > session.deadlineMs ? (
                  <>
                    Deadline at risk. It still needs {remaining.toFixed(1)} kWh, and even at full power the earliest it can finish is{' '}
                    <strong>{clockTime(earliest, timezone)}</strong>, after its {clockTime(session.deadlineMs, timezone)} deadline. Giving
                    the driver more time is the only thing that closes the gap.
                  </>
                ) : (
                  <>
                    Deadline at risk. The car could finish by <strong>{earliest ? clockTime(earliest, timezone) : 'its deadline'}</strong> on its
                    own, but the site has no room to give it that power yet. The plan re-solves every minute until it does.
                  </>
                )}
              </p>
            ) : null}

            {selected && actions ? <div className="session-actions">{actions(session)}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
