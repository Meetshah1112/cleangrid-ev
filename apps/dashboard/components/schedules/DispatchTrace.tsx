'use client';

import { useState } from 'react';
import { clockTime, kw } from '../../lib/format';
import type { Charger, Dispatch, Session } from '../../lib/types';

/**
 * What actually reached the chargers: every charging profile sent, as sent.
 *
 * The rest of the page describes intent. This is the record of instruction, so it keeps the
 * machine's own terms, in columns, and opens to the profile periods and what the charger said.
 */

const SLOT_MS = 15 * 60_000;

export function DispatchTrace({
  dispatches,
  chargers,
  sessions,
  timezone,
}: {
  readonly dispatches: readonly Dispatch[];
  readonly chargers: readonly Charger[];
  readonly sessions: readonly Session[];
  readonly timezone: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (dispatches.length === 0) return <p className="empty">Nothing sent yet. A profile goes out the first time a plan changes what a charger should draw.</p>;

  return (
    <ol className="trace">
      {dispatches.map((dispatch) => {
        const charger = chargers.find((entry) => entry.id === dispatch.chargerId) ?? null;
        const session = sessions.find((entry) => entry.id === dispatch.sessionId) ?? null;
        const accepted = dispatch.status === 'Accepted';
        const expanded = open === dispatch.id;
        // Periods count from the start of the plan's first block, which is the block the profile was sent in.
        const scheduleStart = Math.floor(dispatch.sentMs / SLOT_MS) * SLOT_MS;
        const then = dispatch.periods && dispatch.periods.length > 1 ? dispatch.periods[1] : null;
        return (
          <li key={dispatch.id} className={`trace-row${accepted ? '' : ' is-refused'}`}>
            <button type="button" className="trace-line" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : dispatch.id)}>
              <span>{clockTime(dispatch.sentMs, timezone)}</span>
              <span>{dispatch.chargerId}</span>
              <span className="num">{kw(dispatch.limitW / 1000)} kW</span>
              <span className="trace-then">{then ? `then ${kw(then.limitW / 1000)} kW at${clockTime(scheduleStart + then.startPeriodS * 1000, timezone)}` : ''}</span>
              <span className="trace-status">{dispatch.status.toLowerCase()}</span>
            </button>
            {expanded ? (
              <div className="trace-detail">
                <p>
                  {session ? `${session.driverName ?? session.idTag}, connector ${dispatch.connectorId ?? session.connectorId}. ` : ''}
                  {accepted
                    ? 'The charger accepted the profile and is holding these limits.'
                    : charger?.uncontrolled
                      ? `The charger answered ${dispatch.status.toLowerCase()} again and is now uncontrolled: it runs at full power and the plan treats it as fixed load.`
                      : `The charger answered ${dispatch.status.toLowerCase()}${dispatch.error ? ` (${dispatch.error})` : ''}. It is sent again on the next solve.`}
                </p>
                {dispatch.periods && dispatch.periods.length > 0 ? (
                  <table className="appendix">
                    <thead>
                      <tr>
                        <th>From</th>
                        <th className="num">Limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dispatch.periods.map((period) => (
                        <tr key={period.startPeriodS}>
                          <td>{clockTime(scheduleStart + period.startPeriodS * 1000, timezone)}</td>
                          <td className="num">{kw(period.limitW / 1000)} kW</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>This record carries only the binding limit.</p>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
