'use client';

import { useState } from 'react';
import { api } from '../lib/api';
import { clockTime, countdown, kw, modeLabel } from '../lib/format';
import type { Session } from '../lib/types';

/**
 * Active and pending sessions in deadline order, with the ones at risk called out.
 *
 * The operator can change a session's mode or push its deadline back from here. That was always
 * possible through the API and the table said so, which is a strange thing for a console to admit:
 * the one person watching a driver run out of time had to open a terminal to do anything about it.
 * Extending a deadline is the only lever that actually rescues a car that cannot finish, so it is
 * the one that belongs closest to the row saying so.
 */

const MODES = ['cheapest', 'greenest', 'balanced', 'fastest'] as const;
/** What to offer when a driver needs longer. Half an hour rescues most, two hours rescues the rest. */
const EXTENSIONS_MIN = [30, 60, 120] as const;

export function SessionsTable({
  sessions,
  nowMs,
  timezone,
  onChanged,
}: {
  readonly sessions: Session[];
  readonly nowMs: number;
  readonly timezone: string;
  /** Called after a successful override, so the page can pull the new plan. */
  readonly onChanged?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const rows = [...sessions]
    .filter((session) => session.status === 'active' || session.status === 'pending')
    .sort((a, b) => a.deadlineMs - b.deadlineMs);

  if (rows.length === 0) return <p className="empty">Nothing plugged in right now.</p>;

  const override = (session: Session, body: { mode?: string; deadlineAt?: string }, said: string): void => {
    setBusyId(session.id);
    setError(null);
    setDone(null);
    void api
      .patchSession(session.id, body)
      .then(() => {
        setDone(said);
        onChanged?.();
      })
      // The server refuses a change it cannot deliver in time rather than promising it, so this
      // is a real answer about the car and not a transport failure. It has to be shown.
      .catch((caught: Error) => setError(`${session.driverName ?? session.idTag}: ${caught.message}`))
      .finally(() => setBusyId(null));
  };

  return (
    <>
      {error ? <div className="error">{error}</div> : null}
      {done && !error ? <p className="note">{done}</p> : null}
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th>driver</th>
              <th>bay</th>
              <th>mode</th>
              <th className="num">now</th>
              <th className="num">limit</th>
              <th className="num">delivered</th>
              <th>progress</th>
              <th className="num">deadline</th>
              <th className="num">left</th>
              <th>give more time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((session) => {
              const progress = Math.min(100, (session.energyDeliveredKwh / Math.max(0.1, session.energyNeededKwh)) * 100);
              const busy = busyId === session.id;
              const label = session.driverName ?? session.idTag;
              return (
                <tr key={session.id}>
                  <td>
                    {label}
                    {session.source === 'rfid' && (
                      <span className="pill" style={{ marginLeft: 6 }}>
                        rfid
                      </span>
                    )}
                  </td>
                  <td>{session.chargerId}</td>
                  <td>
                    <select
                      className={`row-select ${session.mode}`}
                      value={session.mode}
                      disabled={busy}
                      aria-label={`Charging mode for ${label}`}
                      onChange={(event) =>
                        override(
                          session,
                          { mode: event.target.value },
                          `${label} is now on ${modeLabel[event.target.value] ?? event.target.value}. The plan has been re-solved.`,
                        )
                      }
                    >
                      {MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {modeLabel[mode] ?? mode}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{kw(session.currentPowerKw)}</td>
                  <td className="num">{session.limitKw === null ? '--' : kw(session.limitKw)}</td>
                  <td className="num">
                    {session.energyDeliveredKwh.toFixed(1)} / {session.energyNeededKwh.toFixed(1)}
                  </td>
                  <td>
                    <span className="mini-bar">
                      <i style={{ width: `${progress}%` }} />
                    </span>
                  </td>
                  <td className="num">{clockTime(session.deadlineMs, timezone)}</td>
                  <td className="num">
                    {session.deadlineRisk ? <span className="pill risk">at risk</span> : countdown(session.deadlineMs, nowMs)}
                  </td>
                  <td>
                    <span className="row-actions">
                      {EXTENSIONS_MIN.map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          className="btn tiny"
                          disabled={busy}
                          aria-label={`Give ${label} ${minutes} more minutes`}
                          onClick={() =>
                            override(
                              session,
                              { deadlineAt: new Date(session.deadlineMs + minutes * 60_000).toISOString() },
                              `${label} now has until ${clockTime(session.deadlineMs + minutes * 60_000, timezone)}. The plan has been re-solved.`,
                            )
                          }
                        >
                          +{minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                        </button>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
