'use client';

import { useEffect, useState } from 'react';
import { Console } from '../../components/Console';
import { SessionsList } from '../../components/SessionsList';
import { Scene, washTone } from '../../components/scene/Scene';
import { Wave } from '../../components/scene/Wave';
import { DispatchTrace } from '../../components/schedules/DispatchTrace';
import { PlanDetail } from '../../components/schedules/PlanDetail';
import { MODE_COLOUR, PlanRiver } from '../../components/schedules/PlanRiver';
import { SiteDrawLayer, SiteDrawOverlay, drawLayout } from '../../components/schedules/SiteDraw';
import { api } from '../../lib/api';
import { clockTime, kw, modeLabel, money } from '../../lib/format';
import type { LiveSite } from '../../lib/useLiveSite';
import type { Plan, Site } from '../../lib/types';

/**
 * Schedules. How the forecast, the price, the site's connection and every driver's deadline become
 * one plan, and proof that the plan is what reached the chargers.
 */
export default function SchedulesPage() {
  return <Console page="schedules">{({ site, live }) => <SchedulesBody site={site} live={live} />}</Console>;
}

const HOUR = 3_600_000;

function SchedulesBody({ site, live }: { readonly site: Site | null; readonly live: LiveSite }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{ startMs: number; endMs: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the last re-plan actually did. A re-solve on a site that is already optimal returns the
   * same schedule and nothing on the page moves, so without saying what came back the button is
   * indistinguishable from a broken one.
   */
  const [outcome, setOutcome] = useState<string | null>(null);

  const { plan, nowMs } = live;
  const tz = site?.timezone ?? 'Europe/London';
  const currency = site?.currency ?? 'GBP';

  // The overview and the forecast link here with a car or a window already chosen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    const span = params.get('window')?.match(/^(\d+)-(\d+)$/);
    if (session) setSelectedId(session);
    if (span) setHighlight({ startMs: Number(span[1]), endMs: Number(span[2]) });
  }, []);

  const selected = live.sessions.find((session) => session.id === selectedId) ?? null;
  const shownId = selected?.id ?? null;

  // Bring the chosen car's detail into view once it exists, whether it was chosen here or arrived in the link.
  useEffect(() => {
    if (!shownId) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('plan-detail')?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
  }, [shownId]);

  const active = live.sessions.filter((session) => session.status === 'active');
  const riskIds = new Set([...active.filter((session) => session.deadlineRisk).map((session) => session.id), ...(plan?.shortfalls.map((entry) => entry.sessionId) ?? [])]);
  const atRisk = active.filter((session) => riskIds.has(session.id)).length;
  const scheduled = plan ? Object.values(plan.allocationsKw).filter((row) => row.some((value) => value > 0.01)).length : 0;
  const frameStart = plan?.grid.startMs ?? (nowMs > 0 ? Math.floor(nowMs / HOUR) * HOUR : 0);
  const frameSpan = plan ? plan.grid.slots * plan.grid.slotMinutes * 60_000 : 24 * HOUR;

  const replan = (): void => {
    if (!site) return;
    const before = plan;
    setBusy(true);
    setError(null);
    setOutcome(null);
    void api
      .replan(site.id)
      .then(async (result) => {
        if (result.queued) {
          setOutcome('The optimiser is off at this site, so nothing was planned. It is watching and measuring only.');
          return;
        }
        // Wait for the new plan itself, not just the server's acknowledgement, so the figures quoted are the ones on screen.
        const [next] = await Promise.all([api.plan(site.id).catch(() => null), live.refresh()]);
        if (result.status === 'error' || !next) {
          setOutcome('The solver could not produce a plan. The last good one is still in force.');
          return;
        }
        setOutcome(describeReplan(before, next, tz, currency));
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <section className="hero" aria-labelledby="schedules-title">
        <Scene
          className="is-hero"
          wash
          startMs={frameStart}
          spanMs={frameSpan}
          nowMs={nowMs}
          timezone={tz}
          horizon={0.6}
          features={{ turbines: true, solar: false, town: true }}
          label={`The planning day at ${site?.name ?? 'this site'}, with the site's planned draw`}
          layers={(geometry) => {
            const layout = drawLayout(plan, geometry, nowMs, tz);
            return layout ? <SiteDrawLayer layout={layout} width={geometry.width} /> : null;
          }}
        >
          {(geometry) => {
            const layout = drawLayout(plan, geometry, nowMs, tz);
            const narrow = geometry.width < 760;
            return (
              <>
                <div className={`hero-copy tone-${washTone(geometry, 'left')}`}>
                  <p className="eyebrow">Optimised day plan · {plan?.grid.slotMinutes ?? 15}-minute blocks</p>
                  <h1 id="schedules-title" className="display">
                    Let every parked hour do more.
                  </h1>
                  <p className="lede is-wide">CleanGrid moves flexible energy into cleaner, cheaper hours while preserving every committed departure.</p>
                  <div className="actions">
                    <button type="button" className="btn is-primary" onClick={replan} disabled={busy || !site}>
                      {busy ? 'Re-planning' : 'Re-plan now'}
                    </button>
                  </div>
                  {outcome ? (
                    <p className="hero-outcome" role="status">
                      {outcome}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="notice is-error" role="alert">
                      Re-plan failed: {error}
                    </p>
                  ) : null}
                </div>

                <div
                  className={`hero-promise tone-${washTone(geometry, 'right')}`}
                  style={narrow && layout ? { top: layout.top - 150, bottom: 'auto' } : undefined}
                >
                  <p className="hero-promise-figure">
                    {active.length - atRisk} / {active.length} <span>deadlines safe</span>
                  </p>
                  <p className="hero-promise-note">
                    {plan ? `${plan.solver === 'lp' ? 'LP' : 'Safe greedy fallback'} · ${atRisk > 0 ? 're-planning every minute' : 'auto-replanning'}` : 'Waiting for the first plan'}
                  </p>
                </div>

                {layout && plan ? (
                  <SiteDrawOverlay
                    layout={layout}
                    plan={plan}
                    geometry={geometry}
                    connectionKw={site?.gridConnectionKw ?? null}
                    scheduled={scheduled}
                    timezone={tz}
                  />
                ) : (
                  <p className="scene-empty">No plan yet. The optimiser solves as soon as a car plugs in.</p>
                )}
              </>
            );
          }}
        </Scene>
        <div className="draw-legend">
          <div className="wrap">
            <p className="chart-legend">
              <span>
                <i className="key is-draw" /> planned charging
              </span>
              <span>
                <i className="key is-base" /> the building&apos;s own load
              </span>
              <span>
                <i className="key is-limit" /> planning limit, held below the connection
              </span>
              <span>
                <i className="key is-breach" /> a block above the limit
              </span>
            </p>
          </div>
        </div>
      </section>

      <section className="chapter" aria-labelledby="river-title">
        <Wave tone="paper" />
        <div className="wrap">
          <div className="chapter-head">
            <h2 id="river-title" className="title">
              The plan, one ribbon per car.
            </h2>
            <p className="caption">Choose a ribbon to see why it charges when it does.</p>
          </div>

          {atRisk > 0 ? (
            <p className="notice is-error river-alert" role="alert">
              {atRisk} driver{atRisk === 1 ? '' : 's'} cannot be fully charged by the deadline they gave. The plan re-solves every minute, so anything
              that frees up is used as soon as it does. Choose the car below to give it more time.
            </p>
          ) : null}

          <PlanRiver
            plan={plan}
            sessions={live.sessions}
            nowMs={nowMs}
            timezone={tz}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
            highlight={highlight}
          />

          <p className="chart-legend">
            {Object.entries(MODE_COLOUR).map(([mode, colour]) => (
              <span key={mode}>
                <i className="key is-mode" style={{ background: colour }} /> {modeLabel[mode]}
              </span>
            ))}
            <span className="chart-legend-note">Deeper means more power. The tick is the deadline.</span>
          </p>

          {selected && site ? (
            <PlanDetail
              session={selected}
              plan={plan}
              nowMs={nowMs}
              siteId={site.id}
              timezone={tz}
              currency={currency}
              onChanged={() => void live.refresh()}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      </section>

      <section className="chapter is-mist" aria-labelledby="promises-title">
        <Wave tone="mist" />
        <div className="wrap">
          <h2 id="promises-title" className="title">
            Every promise, still protected.
          </h2>
          <p className="body chapter-lede">Change a mode, or give a driver more time, and the plan re-solves.</p>
          <SessionsList
            sessions={live.sessions}
            nowMs={nowMs}
            timezone={tz}
            selectedId={selectedId}
            onSelect={(session) => setSelectedId(session.id)}
          />
        </div>
      </section>

      <section className="chapter is-last" aria-labelledby="trace-title">
        <Wave tone="paper" />
        <div className="wrap trace-wrap">
          <div>
            <h2 id="trace-title" className="subtitle">
              What actually reached the chargers
            </h2>
            <p className="caption">
              CleanGrid sends a charger a new profile only when the plan moves its next limits by more than a quarter of a kilowatt, or before the
              last one would expire. Open a line for the profile it carried.
            </p>
          </div>
          <DispatchTrace dispatches={live.dispatches} chargers={live.chargers} sessions={live.sessions} timezone={tz} />
        </div>
      </section>
    </>
  );
}

/** One sentence on what a re-plan changed, measured against the plan it replaced. */
function describeReplan(before: Plan | null, next: Plan, timezone: string, currency: string): string {
  const solver = next.solver === 'lp' ? 'LP' : 'the safe greedy fallback';
  const change = (after: number, prior: number | undefined, format: (value: number) => string, epsilon: number): string => {
    if (prior === undefined) return format(after);
    const diff = after - prior;
    return Math.abs(diff) < epsilon ? `${format(after)}, unchanged` : `${format(after)}, ${diff > 0 ? 'up' : 'down'} ${format(Math.abs(diff))}`;
  };
  const risk = next.shortfalls.length > 0 ? `${next.shortfalls.length} deadline${next.shortfalls.length === 1 ? '' : 's'} still cannot be met.` : 'Every deadline met.';
  return [
    `Solved ${clockTime(next.solvedMs, timezone)} by ${solver}.`,
    `Peak ${change(next.totals.peakKw, before?.totals.peakKw, (value) => `${kw(value)} kW`, 0.05)}.`,
    `CO₂ ${change(next.totals.co2Kg, before?.totals.co2Kg, (value) => `${value.toFixed(1)} kg`, 0.05)}.`,
    `Cost ${change(next.totals.cost, before?.totals.cost, (value) => money(value, currency), 0.005)}.`,
    risk,
  ].join(' ');
}
