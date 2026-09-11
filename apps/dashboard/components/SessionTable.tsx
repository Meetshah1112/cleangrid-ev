'use client';

import { clockTime, countdown, kw, modeLabel } from '../lib/format';
import type { Session } from '../lib/types';

interface SessionTableProps {
  readonly sessions: Session[];
  readonly nowMs: number;
}

export function SessionTable({ sessions, nowMs }: SessionTableProps) {
  const rows = [...sessions]
    .filter((session) => session.status === 'active' || session.status === 'pending')
    .sort((a, b) => a.deadlineMs - b.deadlineMs);

  if (rows.length === 0) {
    return <p className="empty">Nothing plugged in right now.</p>;
  }

  return (
    <table className="sessions">
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
        </tr>
      </thead>
      <tbody>
        {rows.map((session) => {
          const progress = Math.min(100, (session.energyDeliveredKwh / Math.max(0.1, session.energyNeededKwh)) * 100);
          return (
            <tr key={session.id}>
              <td>
                {session.driverName ?? session.idTag}
                {session.source === 'rfid' && <span className="pill" style={{ marginLeft: 6 }}>rfid</span>}
              </td>
              <td>{session.chargerId}</td>
              <td>
                <span className={`pill mode-${session.mode}`}>{modeLabel[session.mode] ?? session.mode}</span>
              </td>
              <td className="num">{kw(session.currentPowerKw)}</td>
              <td className="num">{session.limitKw === null ? '--' : kw(session.limitKw)}</td>
              <td className="num">
                {session.energyDeliveredKwh.toFixed(1)} / {session.energyNeededKwh.toFixed(1)}
              </td>
              <td>
                <span className="bar">
                  <i style={{ width: `${progress}%` }} />
                </span>
              </td>
              <td className="num">{clockTime(session.deadlineMs)}</td>
              <td className="num">
                {session.deadlineRisk ? <span className="pill risk">at risk</span> : countdown(session.deadlineMs, nowMs)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
