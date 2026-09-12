'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Console } from '../../components/Console';
import { Ledger, type LedgerEntry } from '../../components/impact/Ledger';
import { COMPACT_WIDTH, ProofTracesLayer, ProofTracesOverlay, traceLayout, type ProofPoint } from '../../components/impact/ProofTraces';
import { StoryMoments } from '../../components/impact/StoryMoments';
import { Scene, washTone } from '../../components/scene/Scene';
import { localHour } from '../../components/scene/sky';
import { Wave } from '../../components/scene/Wave';
import { api } from '../../lib/api';
import { RANGE_LABEL, baselineByHour, carbonCut, cutPhrase, deadlineOutcome, rangeOf, totalsOf, type RangeKey } from '../../lib/impactRead';
import { kw, money, percent } from '../../lib/format';
import type { LiveSite } from '../../lib/useLiveSite';
import type { Impact, Session, SessionReport, Site } from '../../lib/types';

/**
 * Impact. What the schedule actually achieved, measured from charger meters and weighed against
 * the grid's carbon at the moment the energy flowed, beside the same energy charged on plug-in.
 */
export default function ImpactPage() {
  return <Console page="impact">{({ site, live }) => <ImpactBody site={site} live={live} />}</Console>;
}

const HOUR = 3_600_000;
/** Reports fetched per period. Beyond this the page says its figures cover the latest sessions only. */
const REPORT_LIMIT = 300;
const QUARTER_HOUR = 15 * 60_000;

function ImpactBody({ site, live }: { readonly site: Site | null; readonly live: LiveSite }) {
  const [range, setRange] = useState<RangeKey>('today');
  const [impact, setImpact] = useState<Impact | null>(null);
  const [history, setHistory] = useState<Session[]>([]);
  const [reports, setReports] = useState<ReadonlyMap<string, SessionReport>>(new Map());
  const [provisional, setProvisional] = useState<SessionReport[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cache = useRef(new Map<string, SessionReport>());

  const siteId = site?.id ?? null;
  const tz = site?.timezone ?? 'Europe/London';
  const currency = site?.currency ?? 'GBP';
  const { nowMs } = live;
  // Periods move on the quarter hour, not every second, so the evidence is not refetched with each clock tick.
  const coarseNow = nowMs > 0 ? Math.floor(nowMs / QUARTER_HOUR) * QUARTER_HOUR : 0;
  const bounds = useMemo(() => (coarseNow > 0 ? rangeOf(range, coarseNow, tz) : null), [range, coarseNow, tz]);

  useEffect(() => {
    cache.current = new Map();
    setReports(new Map());
    setHistory([]);
  }, [siteId]);

  useEffect(() => {
    if (!siteId || !bounds) return undefined;
    const load = (): void => {
      void api
        .impact(siteId, bounds)
        .then((next) => {
          setImpact(next);
          setLoadError(null);
        })
        .catch((caught: Error) => setLoadError(caught.message));
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [siteId, bounds]);

  // Finished sessions in the period, and their reports. A finished report does not change, so each is fetched once.
  useEffect(() => {
    if (!siteId || !bounds) return undefined;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [complete, aborted] = await Promise.all([api.sessionsWithStatus(siteId, 'complete'), api.sessionsWithStatus(siteId, 'aborted')]);
        const inPeriod = [...complete, ...aborted]
          .filter((session) => session.pluggedInMs >= bounds.fromMs && session.pluggedInMs < bounds.toMs)
          .sort((a, b) => (b.unpluggedMs ?? 0) - (a.unpluggedMs ?? 0));
        const wanted = inPeriod.slice(0, REPORT_LIMIT).filter((session) => !cache.current.has(session.id));
        for (let index = 0; index < wanted.length; index += 6) {
          const batch = await Promise.all(wanted.slice(index, index + 6).map((session) => api.sessionReport(session.id).catch(() => null)));
          for (const report of batch) if (report) cache.current.set(report.sessionId, report);
          if (cancelled) return;
        }
        if (cancelled) return;
        setHistory(inPeriod);
        setReports(new Map(cache.current));
      } catch (caught) {
        if (!cancelled) setLoadError((caught as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [siteId, bounds]);

  // Cars still charging, read once a minute: asking for a live report makes the server rebuild it.
  const activeIds = live.sessions
    .filter((session) => session.status === 'active')
    .map((session) => session.id)
    .slice(0, 12)
    .join(',');
  useEffect(() => {
    if (!activeIds) {
      setProvisional([]);
      return undefined;
    }
    const load = (): void => {
      void Promise.all(activeIds.split(',').map((id) => api.sessionReport(id).catch(() => null))).then((list) =>
        setProvisional(list.filter((report): report is SessionReport => report !== null)),
      );
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [activeIds]);


  /**
   * Only what has happened on this clock. A store that outlives a run can hold sessions stamped
   * later than now by an earlier run's clock; counting those would report charging that has not
   * happened yet, so the figures on this page are worked out from the reports of sessions that have
   * actually finished, and the ones left out are counted aloud.
   */
  const settled = useMemo<LedgerEntry[]>(
    () =>
      history.flatMap((session) => {
        const report = reports.get(session.id);
        const happened = coarseNow > 0 && session.pluggedInMs <= coarseNow && session.unpluggedMs !== null && session.unpluggedMs <= coarseNow;
        return report && happened ? [{ session, report }] : [];
      }),
    [history, reports, coarseNow],
  );
  const aheadOfClock = coarseNow > 0 ? history.filter((session) => session.pluggedInMs > coarseNow || (session.unpluggedMs ?? 0) > coarseNow).length : 0;
  const reportsLoaded = history.length === 0 || reports.size > 0;

  const points: ProofPoint[] = [...settled]
    .sort((a, b) => (a.session.unpluggedMs ?? 0) - (b.session.unpluggedMs ?? 0))
    .reduce<ProofPoint[]>((list, entry) => {
      const previous = list[list.length - 1];
      return [
        ...list,
        {
          ms: entry.session.unpluggedMs ?? 0,
          report: entry.report,
          label: `${entry.session.driverName ?? entry.session.idTag}, ${entry.session.chargerId}`,
          co2Kg: (previous?.co2Kg ?? 0) + entry.report.co2Kg,
          baselineCo2Kg: (previous?.baselineCo2Kg ?? 0) + entry.report.baselineCo2Kg,
        },
      ];
    }, []);

  const totals = totalsOf(settled.map((entry) => entry.report));
  const cut = carbonCut(totals.co2Kg, totals.baselineCo2Kg);
  const mean = (pick: (report: SessionReport) => number): number | null =>
    settled.length > 0 ? settled.reduce((sum, entry) => sum + pick(entry.report), 0) / settled.length : null;
  const renewableShare = mean((report) => report.renewableShare);
  const greenScore = mean((report) => report.greenScore);

  const finished = settled.filter((entry) => entry.session.status === 'complete').map((entry) => entry.session);
  const kept = finished.filter((session) => deadlineOutcome(session) === 'kept').length;
  const missed = finished.filter((session) => deadlineOutcome(session) === 'missed').length;
  const judged = kept + missed;
  const stillCharging = totalsOf(provisional);
  const byHour = useMemo(
    () => baselineByHour(settled.filter((entry) => entry.session.status === 'complete').map((entry) => entry.session), tz),
    [settled, tz],
  );

  const dayStart = coarseNow > 0 ? coarseNow - Math.round(localHour(coarseNow, tz) * 60) * 60_000 : 0;
  const shown = (value: string): string => (reportsLoaded ? value : '--');

  return (
    <>
      <section className="hero" aria-labelledby="impact-title">
        <Scene
          className="is-hero is-tall"
          wash
          startMs={dayStart > 0 ? dayStart + 6 * HOUR : 0}
          spanMs={18 * HOUR}
          nowMs={0}
          timezone={tz}
          horizon={0.58}
          features={{ turbines: true, town: true, solar: COMPACT_WIDTH }}
          label={`A day at ${site?.name ?? 'this site'}, from morning sun to evening wind, with its measured emissions`}
          layers={(geometry) => (bounds ? <ProofTracesLayer layout={traceLayout(points, geometry, bounds, nowMs, tz)} /> : null)}
        >
          {(geometry) => (
            <>
              <div className={`hero-copy tone-${washTone(geometry, 'left')}`}>
                <p className="eyebrow">Verified impact · {RANGE_LABEL[range]}</p>
                <h1 id="impact-title" className="display">
                  Every clean charge leaves proof.
                </h1>
                <p className="lede is-wider">
                  Measured from charger meters and matched to the grid&apos;s real carbon intensity at the moment energy actually flowed.
                </p>
                <div className="actions">
                  <div className="segmented is-glass" role="group" aria-label="Period">
                    {(Object.keys(RANGE_LABEL) as RangeKey[]).map((key) => (
                      <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>
                        {RANGE_LABEL[key]}
                      </button>
                    ))}
                  </div>
                  <p className="trust">
                    {!reportsLoaded ? (
                      'Reading the meters'
                    ) : totals.sessions === 0 ? (
                      'No finished session in this period'
                    ) : (
                      <>
                        <span aria-hidden="true">{totals.verified === totals.sessions ? '✓' : '≈'}</span> Verified from {totals.verified} of {totals.sessions} completed
                        session{totals.sessions === 1 ? '' : 's'}
                      </>
                    )}
                  </p>
                </div>
              </div>
              {bounds && reportsLoaded ? (
                <ProofTracesOverlay
                  layout={traceLayout(points, geometry, bounds, nowMs, tz)}
                  points={points}
                  geometry={geometry}
                  timezone={tz}
                  totals={{ co2Kg: totals.co2Kg, baselineCo2Kg: totals.baselineCo2Kg, cut: cutPhrase(cut) }}
                />
              ) : null}
            </>
          )}
        </Scene>
      </section>

      <section className="chapter" aria-label="Proof">
        <Wave tone="paper" />
        <div className="wrap">
          {loadError ? (
            <p className="notice is-error" role="alert">
              Impact could not be loaded: {loadError}
            </p>
          ) : null}
          <div className="ribbon proof-ribbon">
            <div className="ribbon-item">
              <span className="figure">{shown(energy(totals.energyKwh))}</span>
              <span className="caption">
                Energy delivered, {totals.sessions} session{totals.sessions === 1 ? '' : 's'}
              </span>
            </div>
            <div className="ribbon-item">
              <span className={`figure${totals.avoidedCo2Kg < 0 ? ' is-over' : ' is-clean'}`}>{shown(`${Math.abs(totals.avoidedCo2Kg).toFixed(1)} kg`)}</span>
              <span className="caption">
                {totals.avoidedCo2Kg < 0 ? 'CO₂ above the baseline' : 'CO₂ avoided'}, {cutPhrase(cut)}
              </span>
            </div>
            <div className="ribbon-item">
              <span className="figure">{shown(money(Math.abs(totals.costSaved), currency))}</span>
              <span className="caption">
                {totals.costSaved < 0 ? 'Cost above the baseline' : 'Money saved'}, spent {money(totals.cost, currency)}
              </span>
            </div>
            <div className="ribbon-item">
              <span className="figure">{judged > 0 ? `${Math.round((kept / judged) * 100)}%` : '--'}</span>
              <span className="caption">
                {judged > 0 ? `Deadlines kept in ${kept} of ${judged} sessions` : 'Deadlines kept: nothing finished yet'}
                {totals.sessions > 0 ? `, ${totals.verified === totals.sessions ? 'all' : `${totals.verified} of ${totals.sessions}`} meter-verified` : ''}
              </span>
            </div>
          </div>
          {provisional.length > 0 ? (
            <p className="caption provisional">
              <strong>Provisional:</strong> {provisional.length} car{provisional.length === 1 ? ' is' : 's are'} still charging, {stillCharging.energyKwh.toFixed(1)} kWh so far and{' '}
              {Math.abs(stillCharging.avoidedCo2Kg).toFixed(1)} kg CO₂ {stillCharging.avoidedCo2Kg >= 0 ? 'avoided' : 'above the baseline'}. These figures settle when each
              session finishes and are not counted above.
            </p>
          ) : null}
          {history.length > REPORT_LIMIT ? (
            <p className="caption">
              These figures cover the latest {REPORT_LIMIT} of the {history.length} sessions in this period.
            </p>
          ) : null}
          {aheadOfClock > 0 ? (
            <p className="caption">
              {aheadOfClock} stored session{aheadOfClock === 1 ? ' is' : 's are'} stamped later than the site&apos;s current clock, left from an earlier run, and
              {aheadOfClock === 1 ? ' is' : ' are'} not counted.
            </p>
          ) : null}
        </div>
      </section>

      <section className="chapter is-tight" aria-labelledby="story-title">
        <div className="wrap">
          <h2 id="story-title" className="title">
            The same energy, two ways.
          </h2>
          {reportsLoaded && totals.sessions > 0 ? (
            <StoryMoments
              nowMs={nowMs}
              timezone={tz}
              baselineCo2Kg={totals.baselineCo2Kg}
              co2Kg={totals.co2Kg}
              baselineByHour={byHour}
              renewableShare={percent(renewableShare)}
              greenScore={greenScore === null ? null : Math.round(greenScore)}
              cut={cutPhrase(cut)}
            />
          ) : (
            <p className="empty">{reportsLoaded ? 'Once a session finishes in this period, its two versions appear here.' : 'Reading the period.'}</p>
          )}
        </div>
      </section>

      <section className="chapter is-mist is-last" aria-labelledby="audit-title">
        <Wave tone="mist" />
        <div className="wrap">
          <div className="chapter-head">
            <h2 id="audit-title" className="title">
              Audit trail
            </h2>
            <p className="caption">Latest sessions first. Open one for its proof.</p>
          </div>
          <p className="body chapter-lede">
            Energy between meter readings, weighted by grid carbon intensity at the moment it was drawn, minus the same energy charged at full power
            from plug-in.
          </p>
          {!reportsLoaded ? (
            <p className="empty">Loading session reports.</p>
          ) : settled.length === 0 ? (
            <p className="empty">No session has finished in this period yet.</p>
          ) : (
            <Ledger entries={settled} timezone={tz} currency={currency} />
          )}

          <dl className="period">
            <div>
              <dt>Renewable share of delivered energy</dt>
              <dd>{percent(renewableShare)}</dd>
            </div>
            <div>
              <dt>Average Green Score</dt>
              <dd>{greenScore === null ? '--' : Math.round(greenScore)}</dd>
            </div>
            <div>
              <dt>Cost if every car charged on plug-in</dt>
              <dd>{money(totals.baselineCost, currency)}</dd>
            </div>
            <div>
              <dt>CO₂ if every car charged on plug-in</dt>
              <dd>{totals.baselineCo2Kg.toFixed(1)} kg</dd>
            </div>
            <div>
              <dt>Site peak so far</dt>
              <dd>{impact ? `${kw(impact.peakKw)} kW of ${kw(impact.gridConnectionKw ?? site?.gridConnectionKw ?? 0, 0)} kW` : '--'}</dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}

function energy(kwh: number): string {
  return kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${kwh.toFixed(0)} kWh`;
}
