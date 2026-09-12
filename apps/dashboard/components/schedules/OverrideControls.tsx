'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { clockTime, modeLabel, money } from '../../lib/format';
import type { ChargingMode, ModePreview, Session } from '../../lib/types';

/**
 * Changing a driver's plan, with the consequence shown before it is confirmed.
 *
 * Two levers: what the car optimises for, and when it must be ready. Choosing either asks the same
 * scheduler that will run the plan what it would cost, emit and finish, beside what the current
 * choice does, so the operator confirms a known result rather than discovering it. Nothing changes
 * until "Confirm". If the server refuses because the change cannot be delivered in time, the
 * refusal and the earliest time that could work are shown as they came back.
 */

const MODES: ChargingMode[] = ['greenest', 'cheapest', 'balanced', 'fastest'];
const EXTENSIONS = [30, 60, 120];

type Change = { readonly kind: 'mode'; readonly mode: ChargingMode } | { readonly kind: 'deadline'; readonly minutes: number };

export function OverrideControls({
  session,
  siteId,
  timezone,
  currency,
  onChanged,
}: {
  readonly session: Session;
  readonly siteId: string;
  readonly timezone: string;
  readonly currency: string;
  readonly onChanged: () => void;
}) {
  const [change, setChange] = useState<Change | null>(null);
  const [current, setCurrent] = useState<ModePreview | null>(null);
  const [proposed, setProposed] = useState<ModePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const remaining = Math.max(0.5, session.energyNeededKwh - session.energyDeliveredKwh);
  const newDeadlineMs = change?.kind === 'deadline' ? session.deadlineMs + change.minutes * 60_000 : session.deadlineMs;
  const newMode = change?.kind === 'mode' ? change.mode : session.mode;

  useEffect(() => {
    setCurrent(null);
    setProposed(null);
    setPreviewError(null);
    if (!change) return undefined;
    let cancelled = false;
    const ask = (deadlineMs: number) => api.preview({ siteId, energyKwh: remaining, deadlineMs, maxPowerKw: session.maxPowerKw });
    void Promise.all([ask(session.deadlineMs), change.kind === 'deadline' ? ask(newDeadlineMs) : null])
      .then(([now, later]) => {
        if (cancelled) return;
        setCurrent(now.modes.find((mode) => mode.mode === session.mode) ?? null);
        setProposed((later ?? now).modes.find((mode) => mode.mode === newMode) ?? null);
      })
      .catch((caught: Error) => {
        if (!cancelled) setPreviewError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [change, siteId, remaining, session.deadlineMs, session.maxPowerKw, session.mode, newDeadlineMs, newMode]);

  const confirm = (): void => {
    if (!change) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const body = change.kind === 'mode' ? { mode: change.mode } : { deadlineAt: new Date(newDeadlineMs).toISOString() };
    const said =
      change.kind === 'mode'
        ? `${session.driverName ?? session.idTag} is now on ${modeLabel[change.mode]?.toLowerCase()}. The plan has re-solved.`
        : `${session.driverName ?? session.idTag} now has until ${clockTime(newDeadlineMs, timezone)}. The plan has re-solved.`;
    void api
      .patchSession(session.id, body)
      .then(() => {
        setDone(said);
        setChange(null);
        onChanged();
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  const delta = (after: number, before: number, unit: (value: number) => string): string => {
    const diff = after - before;
    if (Math.abs(diff) < 0.005) return 'no change';
    return `${diff > 0 ? '+' : '-'}${unit(Math.abs(diff))}`;
  };

  return (
    <div className="override">
      <div className="override-row">
        <span className="override-label">Optimise for</span>
        <div className="segmented" role="group" aria-label={`Charging mode for ${session.driverName ?? session.idTag}`}>
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={newMode === mode}
              disabled={busy}
              onClick={() => setChange(mode === session.mode ? null : { kind: 'mode', mode })}
            >
              {modeLabel[mode]}
            </button>
          ))}
        </div>
      </div>

      <div className="override-row">
        <span className="override-label">Ready by {clockTime(session.deadlineMs, timezone)}</span>
        <div className="segmented" role="group" aria-label="Give the driver more time">
          {EXTENSIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={change?.kind === 'deadline' && change.minutes === minutes}
              disabled={busy}
              onClick={() => setChange(change?.kind === 'deadline' && change.minutes === minutes ? null : { kind: 'deadline', minutes })}
            >
              +{minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
            </button>
          ))}
        </div>
      </div>

      {change ? (
        <div className="override-preview" aria-live="polite">
          {previewError ? (
            <p className="notice is-error">The scheduler could not price that change: {previewError}</p>
          ) : !current || !proposed ? (
            <p className="caption">Asking the scheduler what this would do.</p>
          ) : (
            <>
              <p className="override-compare">
                <span>
                  Cost <strong>{money(proposed.cost, currency)}</strong> ({delta(proposed.cost, current.cost, (value) => money(value, currency))})
                </span>
                <span>
                  CO₂ <strong>{proposed.co2Kg.toFixed(1)} kg</strong> ({delta(proposed.co2Kg, current.co2Kg, (value) => `${value.toFixed(1)} kg`)})
                </span>
                <span>
                  Finishes by <strong>{clockTime(proposed.finishByMs, timezone)}</strong>
                </span>
              </p>
              {proposed.shortfallKwh > 0.05 ? (
                <p className="notice is-error">
                  This would still leave {proposed.shortfallKwh.toFixed(1)} kWh undelivered by {clockTime(newDeadlineMs, timezone)}.
                </p>
              ) : null}
              <div className="override-actions">
                <button type="button" className="btn is-primary" onClick={confirm} disabled={busy}>
                  {busy
                    ? 'Re-solving'
                    : change.kind === 'mode'
                      ? `Confirm ${modeLabel[change.mode]?.toLowerCase()}`
                      : `Confirm until ${clockTime(newDeadlineMs, timezone)}`}
                </button>
                <button type="button" className="btn" onClick={() => setChange(null)} disabled={busy}>
                  Keep the current plan
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="notice is-error" role="alert">
          {error}
        </p>
      ) : null}
      {done && !error ? <p className="notice is-calm">{done}</p> : null}
    </div>
  );
}
