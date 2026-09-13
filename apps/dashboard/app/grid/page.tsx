'use client';

import { useCallback, useEffect, useState } from 'react';
import { Console } from '../../components/Console';
import { NetworkField } from '../../components/grid/NetworkField';
import { RequestLine } from '../../components/grid/RequestLine';
import { ResponsePathLayer, ResponsePathOverlay, pathLayout } from '../../components/grid/ResponsePath';
import { Scene, washTone } from '../../components/scene/Scene';
import { Wave } from '../../components/scene/Wave';
import { api, gridApi } from '../../lib/api';
import { STAGE_LABEL, drawnWhenAsked, measuredResult, previewRequest, stageOf, windowEffect, type FlexStage } from '../../lib/flexRead';
import { clockTime, kw } from '../../lib/format';
import type { ConsoleRole } from '../../lib/access';
import type { LiveSite } from '../../lib/useLiveSite';
import type { FlexEvent, GridSite, Site } from '../../lib/types';

/**
 * Grid Flex. A network operator asks a site to draw less for a while; the site answers by moving
 * charging that can move, and never by cutting off a car that would then miss its departure.
 *
 * Two people use this page. Signed in as the grid operator, it sends requests; signed in as a site's
 * operator, it answers them. Each sees the other's side without the other's buttons.
 */
export default function GridPage() {
  return (
    <Console page="grid">
      {({ site, live, selectSite, role }) => <GridBody site={site} live={live} onSelectSite={selectSite} role={role} />}
    </Console>
  );
}

const HOUR = 3_600_000;
const REDUCTIONS = [20, 40, 60];
const DURATIONS = [1, 2, 3];
const OPEN: readonly FlexStage[] = ['requested', 'accepted', 'active'];

function GridBody({
  site,
  live,
  onSelectSite,
  role,
}: {
  readonly site: Site | null;
  readonly live: LiveSite;
  readonly onSelectSite: (siteId: string) => void;
  readonly role: ConsoleRole;
}) {
  const canAsk = role === 'grid_operator';
  const canRespond = role === 'operator';
  const [network, setNetwork] = useState<GridSite[]>([]);
  const [reduction, setReduction] = useState(40);
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  // The server records a withdrawal and a refusal the same way; the page remembers which this was.
  const [withdrawn, setWithdrawn] = useState<readonly string[]>([]);

  const { nowMs, plan, overview } = live;
  const siteId = site?.id ?? null;
  const tz = site?.timezone ?? 'Europe/London';
  const connectionKw = site?.gridConnectionKw ?? 0;

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
  const drawKw = here?.currentDrawKw ?? overview?.siteDemandKw ?? 0;
  const active = live.sessions.filter((session) => session.status === 'active');
  const atRisk = active.filter((session) => session.deadlineRisk).length;

  // The request that matters now: one in force, then one about to start, then one awaiting an answer.
  const open = nowMs > 0 ? live.flexEvents.filter((event) => OPEN.includes(stageOf(event, nowMs))) : [];
  const rank: Record<string, number> = { active: 0, accepted: 1, requested: 2 };
  const current = [...open].sort((a, b) => (rank[stageOf(a, nowMs)] ?? 3) - (rank[stageOf(b, nowMs)] ?? 3) || b.createdMs - a.createdMs)[0] ?? null;
  const stage = current ? stageOf(current, nowMs) : null;
  const effect = current ? windowEffect(plan, current, live.sessions) : null;
  // What the plan actually gives back against what the site drew when asked, not what was asked for.
  const releasedKw = current ? Math.max(0, drawnWhenAsked(current, connectionKw) - (effect ? Math.max(current.capKw, effect.plannedPeakKw) : current.capKw)) : 0;

  const preview = previewRequest({
    sessions: live.sessions,
    plan,
    drawKw,
    connectionKw,
    baseKw: overview?.baseLoadKw ?? plan?.baseLoadKw[0] ?? 0,
    reductionPct: reduction,
    hours,
    nowMs,
  });
  const flexibleKw = here?.flexibleKw ?? 0;
  const movable = active.length - preview.mustCharge.length;

  const sent = live.flexEvents.find((event) => event.id === sentId) ?? null;
  const sentStage = sent && nowMs > 0 ? stageOf(sent, nowMs) : null;

  const frameStart = nowMs > 0 ? Math.floor(Math.min(current?.startsMs ?? nowMs, nowMs) / HOUR) * HOUR - 3 * HOUR : 0;
  const frameEnd = Math.max((current?.endsMs ?? 0) + 3 * HOUR, nowMs + 6 * HOUR);
  const frameSpan = nowMs > 0 ? Math.max(9 * HOUR, Math.ceil((frameEnd - frameStart) / HOUR) * HOUR) : 9 * HOUR;

  const request = (): void => {
    if (!siteId) return;
    setBusy(true);
    setError(null);
    void gridApi
      .requestReduction({ siteId, reductionPct: reduction, hours, drawKw, connectionKw, nowMs })
      .then(async (event) => {
        setSentId(event.id);
        await live.refresh();
        loadNetwork();
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  const respond = (event: FlexEvent, accept: boolean): void => {
    if (!siteId) return;
    setBusy(true);
    setError(null);
    void api
      .respondToFlex(siteId, event.id, accept)
      .then(async () => {
        if (!accept && stageOf(event, nowMs) !== 'requested') setWithdrawn((ids) => [...ids, event.id]);
        await live.refresh();
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  const actionLabel = busy
    ? 'Requesting'
    : sentStage === 'requested'
      ? 'Waiting for the site to accept'
      : sentStage === 'accepted' && sent
        ? `Accepted, starts ${clockTime(sent.startsMs, tz)}`
        : sentStage === 'active' && sent
          ? `In force until ${clockTime(sent.endsMs, tz)}`
          : `Reduce site load ${reduction}% for ${hours === 1 ? 'one hour' : `${hours} hours`}`;

  return (
    <>
      <section className="hero" aria-labelledby="grid-title">
        <Scene
          className="is-hero"
          wash
          startMs={frameStart}
          spanMs={frameSpan}
          nowMs={nowMs}
          timezone={tz}
          horizon={0.6}
          features={{ turbines: true, solar: false, town: true }}
          label={`The hours around now at ${site?.name ?? 'this site'}, with its draw on the grid`}
          layers={(geometry) => (
            <ResponsePathLayer
              layout={pathLayout({ geometry, startMs: frameStart, spanMs: frameSpan, nowMs, demand: live.demand, plan, connectionKw, event: current, timezone: tz })}
              width={geometry.width}
              nowX={geometry.nowX}
            />
          )}
        >
          {(geometry) => {
            const layout = pathLayout({ geometry, startMs: frameStart, spanMs: frameSpan, nowMs, demand: live.demand, plan, connectionKw, event: current, timezone: tz });
            const narrow = geometry.width < 760;
            return (
              <>
                <div className={`hero-copy tone-${washTone(geometry, 'left')}`}>
                  <p className="eyebrow">Grid Flex · Live response</p>
                  <h1 id="grid-title" className="display">
                    Give the grid room to breathe.
                  </h1>
                  <p className="lede is-wide">
                    CleanGrid makes capacity available when the network needs it, then moves flexible cars into a better moment without breaking a
                    departure promise.
                  </p>
                </div>

                <div
                  className={`hero-promise flex-state is-${stage ?? 'standby'} tone-${washTone(geometry, 'right')}`}
                  style={narrow ? { top: layout.top - 170, bottom: 'auto' } : undefined}
                >
                  <FlexState
                    event={current}
                    stage={stage}
                    releasedKw={releasedKw}
                    atRisk={atRisk}
                    busy={busy}
                    timezone={tz}
                    onRespond={canRespond ? respond : null}
                  />
                </div>

                <ResponsePathOverlay layout={layout} geometry={geometry} event={current} releasedKw={releasedKw} connectionKw={connectionKw} timezone={tz} />
              </>
            );
          }}
        </Scene>

        <div className="proof">
          <div className="wrap">
            {current && (stage === 'active' || stage === 'accepted') ? (
              <p className="proof-claims">
                <span>
                  <strong>{kw(releasedKw)} kW</strong> released
                </span>
                <span>
                  <strong>{atRisk}</strong> driver{atRisk === 1 ? '' : 's'} at risk
                </span>
                <span>
                  <strong>{effect ? effect.heldBack : '--'}</strong> session{effect?.heldBack === 1 ? '' : 's'} reshaped
                </span>
              </p>
            ) : (
              <p className="proof-claims">
                <span>
                  <strong>{kw(flexibleKw)} kW</strong> available to shed across {active.length} session{active.length === 1 ? '' : 's'}
                </span>
                <span>
                  <strong>{atRisk}</strong> driver{atRisk === 1 ? '' : 's'} at deadline risk
                </span>
              </p>
            )}
            <p className="proof-facts">
              <span>
                Drawing now {kw(drawKw)} kW of {kw(connectionKw, 0)} kW connection
              </span>
              {current ? (
                <span>
                  Holding below {kw(current.capKw, 0)} kW, from {clockTime(current.startsMs, tz)} to {clockTime(current.endsMs, tz)}
                </span>
              ) : (
                <span>
                  Would hold below {kw(preview.capKw, 0)} kW, {reduction}% below the {kw(preview.fromKw, 0)} kW drawn now
                </span>
              )}
              {effect ? (
                <span>
                  {effect.charging} car{effect.charging === 1 ? '' : 's'} keep charging inside the window, planned peak {kw(effect.plannedPeakKw)} kW
                </span>
              ) : null}
              {current && effect && effect.basePeakKw > current.capKw + 0.05 ? (
                <span className="is-over">
                  The building alone draws {kw(effect.basePeakKw)} kW in the window, above the cap. Only charging can move.
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </section>

      <section className="chapter" aria-labelledby="ask-title">
        <Wave tone="paper" />
        <div className="wrap ask">
          <div className="ask-control">
            <h2 id="ask-title" className="title">
              Ask for a reduction
            </h2>
            <div className="ask-choices">
              <div className="segmented" role="group" aria-label="How much to reduce by">
                {REDUCTIONS.map((value) => (
                  <button key={value} type="button" aria-pressed={value === reduction} onClick={() => setReduction(value)}>
                    {value}%
                  </button>
                ))}
              </div>
              <span className="caption">for</span>
              <div className="segmented" role="group" aria-label="For how long">
                {DURATIONS.map((value) => (
                  <button key={value} type="button" aria-pressed={value === hours} onClick={() => setHours(value)}>
                    {value} h
                  </button>
                ))}
              </div>
            </div>

            <dl className="ask-preview" aria-live="polite">
              <div>
                <dt>{preview.releasedKw < preview.askedKw - 0.05 ? `Releases, of ${kw(preview.askedKw)} kW asked` : 'Releases'}</dt>
                <dd>{kw(preview.releasedKw)} kW</dd>
              </div>
              <div>
                <dt>Charging reshaped</dt>
                <dd>
                  {preview.affected} car{preview.affected === 1 ? '' : 's'}
                </dd>
              </div>
              <div className={preview.atRisk > 0 ? 'is-risk' : ''}>
                <dt>Deadline risk</dt>
                <dd>
                  {preview.atRisk} driver{preview.atRisk === 1 ? '' : 's'}
                </dd>
              </div>
            </dl>

            <p className="ask-action">
              {canAsk ? (
                <button type="button" className="btn is-primary" onClick={request} disabled={busy || !siteId || nowMs <= 0 || current !== null}>
                  {actionLabel}
                </button>
              ) : null}
              {canRespond && current && stage !== 'requested' ? (
                <button type="button" className="btn" onClick={() => respond(current, false)} disabled={busy}>
                  Withdraw from this request
                </button>
              ) : null}
            </p>
            {!canAsk ? (
              <p className="caption">
                Requests come from the grid operator. Sign in with Regional Grid Control&apos;s code to send one; here you see what it would ask of this
                site, and answer it when it arrives.
              </p>
            ) : null}
            {canAsk && current && !sent ? <p className="caption">One request is already open for this site. It has to end or be withdrawn by the site before another.</p> : null}
            {sentStage === 'declined' || sentStage === 'cancelled' ? (
              <p className="notice is-calm">
                Your last request was {sent && withdrawn.includes(sent.id) ? 'withdrawn' : STAGE_LABEL[sentStage]}. The site is back on its own plan.
              </p>
            ) : null}
            {preview.baseAboveCapKw !== null && !current ? (
              <p className="notice is-error">
                The building&apos;s own load reaches {kw(preview.baseAboveCapKw)} kW in this window, above the {kw(preview.capKw, 0)} kW cap. CleanGrid can
                only move charging, so the site cannot hold below it.
              </p>
            ) : null}
            {sentStage === 'completed' && sent ? (
              <p className="notice is-calm">
                Your last request completed at {clockTime(sent.endsMs, tz)}. See the result in the requests below.
              </p>
            ) : null}
            {error ? (
              <p className="notice is-error" role="alert">
                {error}
              </p>
            ) : null}
            <p className="body">
              The optimiser moves charging out of the window rather than cutting cars off. Anything that cannot move without missing a deadline
              keeps charging, and shows up as deadline risk.
            </p>
          </div>

          <div className="ask-shape">
            <h3 className="subtitle">{current ? 'The response in force' : 'Automated response plan'}</h3>
            {nowMs > 0 ? (
              <RequestLine
                ramp={
                  current
                    ? { startsMs: current.startsMs, endsMs: current.endsMs, capKw: current.capKw, connectionKw, drawKw: drawnWhenAsked(current, connectionKw) }
                    : { startsMs: nowMs + 60_000, endsMs: nowMs + 60_000 + hours * HOUR, capKw: preview.capKw, connectionKw, drawKw: preview.fromKw }
                }
                timezone={tz}
              />
            ) : (
              <p className="empty">Reading the site clock.</p>
            )}
            <p className="caption">
              {current ? 'Now holding: ' : 'If accepted: '}
              {movable} flexible session{movable === 1 ? '' : 's'} step from {kw(active.length > 0 ? flexibleKw / active.length : 0)} kW to{' '}
              {kw(active.length > 0 ? Math.max(0, flexibleKw - preview.releasedKw) / active.length : 0)} kW each.
              {preview.mustCharge.length > 0
                ? ` ${preview.mustCharge.length} car${preview.mustCharge.length === 1 ? '' : 's'} cannot move without missing a deadline and keep charging.`
                : ' Cars that cannot move without missing a deadline keep charging and are counted as deadline risk.'}{' '}
              Estimated from each car&apos;s energy and deadline; the optimiser&apos;s own plan replaces it once the request is accepted.
            </p>
          </div>
        </div>
      </section>

      <section className="chapter is-mist" aria-labelledby="network-title">
        <Wave tone="mist" />
        <div className="wrap">
          <h2 id="network-title" className="title">
            The network, site by site.
          </h2>
          <p className="body chapter-lede">Each point sits where the site is. It grows and glows with how much of its connection it is using.</p>
          <NetworkField sites={network} selectedId={siteId} nowMs={nowMs} reductionPct={reduction} onSelect={onSelectSite} />
        </div>
      </section>

      <section className="chapter is-last" aria-label="Connected sites and requests">
        <Wave tone="paper" />
        <div className="wrap appendix-pair">
          <div>
            <h2 className="subtitle">Connected sites</h2>
            {network.length === 0 ? (
              <p className="empty">No sites connected.</p>
            ) : (
              <div className="scroll-x">
                <table className="appendix">
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th className="num">Drawing</th>
                      <th className="num is-wide-only">Connection</th>
                      <th className="num">Flexible</th>
                      <th className="num">Cars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {network.map((entry) => (
                      <tr key={entry.siteId} className={entry.siteId === siteId ? 'is-selected' : ''}>
                        <td>{entry.name}</td>
                        <td className={`num${entry.currentDrawKw > entry.gridConnectionKw ? ' is-over' : ''}`}>
                          {kw(entry.currentDrawKw)} kW
                          <span className="is-narrow-only">of {kw(entry.gridConnectionKw, 0)} kW</span>
                        </td>
                        <td className="num is-wide-only">{kw(entry.gridConnectionKw, 0)} kW</td>
                        <td className="num">{kw(entry.flexibleKw)} kW</td>
                        <td className="num">{entry.carsPluggedIn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h2 className="subtitle">Requests</h2>
            {live.flexEvents.length === 0 ? (
              <p className="empty">Nothing asked for yet.</p>
            ) : (
              <div className="scroll-x">
                <table className="appendix">
                  <thead>
                    <tr>
                      <th>Window</th>
                      <th className="num">Cap</th>
                      <th>Status</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...live.flexEvents]
                      .sort((a, b) => b.createdMs - a.createdMs)
                      .slice(0, 8)
                      .map((event) => {
                        const eventStage = nowMs > 0 ? stageOf(event, nowMs) : 'requested';
                        const result = eventStage === 'completed' ? measuredResult(live.demand, event) : null;
                        return (
                          <tr key={event.id}>
                            <td>
                              {clockTime(event.startsMs, tz)} to {clockTime(event.endsMs, tz)}
                            </td>
                            <td className="num">{kw(event.capKw, 0)} kW</td>
                            <td>
                              <span className={`status${eventStage === 'active' ? ' is-risk' : eventStage === 'completed' ? ' is-good' : ''}`}>
                                {eventStage === 'declined' && withdrawn.includes(event.id) ? 'withdrawn' : STAGE_LABEL[eventStage]}
                              </span>
                            </td>
                            <td>
                              {result
                                ? result.held
                                  ? `Held, metered peak ${kw(result.peakKw)} kW`
                                  : `Metered peak ${kw(result.peakKw)} kW, ${kw(result.peakKw - event.capKw)} kW over`
                                : eventStage === 'completed'
                                  ? 'No meter data for the window'
                                  : eventStage === 'active'
                                    ? 'Holding now'
                                    : ''}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/** The hero's statement of where the site stands with the network. */
function FlexState({
  event,
  stage,
  releasedKw,
  atRisk,
  busy,
  timezone,
  onRespond,
}: {
  readonly event: FlexEvent | null;
  readonly stage: FlexStage | null;
  readonly releasedKw: number;
  readonly atRisk: number;
  readonly busy: boolean;
  readonly timezone: string;
  /** Null when the signed-in account does not run the site, and so cannot answer for it. */
  readonly onRespond: ((event: FlexEvent, accept: boolean) => void) | null;
}) {
  if (!event || !stage) {
    return (
      <>
        <p className="hero-promise-figure">
          Standing by <span>No request in force</span>
        </p>
        <p className="hero-promise-note">This site is running to its own plan.</p>
      </>
    );
  }
  const span = `${clockTime(event.startsMs, timezone)} to ${clockTime(event.endsMs, timezone)}`;
  if (stage === 'requested') {
    return (
      <>
        <p className="hero-promise-figure">
          Request received <span>{span}</span>
        </p>
        <p className="hero-promise-note">Hold below {kw(event.capKw, 0)} kW. Nothing changes until the site accepts.</p>
        {onRespond ? (
          <p className="flex-actions">
            <button type="button" className="btn is-primary is-small" onClick={() => onRespond(event, true)} disabled={busy}>
              Accept
            </button>
            <button type="button" className="btn is-glass is-small" onClick={() => onRespond(event, false)} disabled={busy}>
              Decline
            </button>
          </p>
        ) : null}
      </>
    );
  }
  return (
    <>
      <p className="hero-promise-figure">
        {stage === 'active' ? `${kw(releasedKw)} kW` : 'Accepted'} <span>{stage === 'active' ? `released until ${clockTime(event.endsMs, timezone)}` : `starts ${clockTime(event.startsMs, timezone)}`}</span>
      </p>
      <p className="hero-promise-note">
        Flex request {span}, holding below {kw(event.capKw, 0)} kW.{' '}
        {atRisk === 0 ? 'Every departure still protected.' : `${atRisk} driver${atRisk === 1 ? '' : 's'} at risk.`}
      </p>
    </>
  );
}
