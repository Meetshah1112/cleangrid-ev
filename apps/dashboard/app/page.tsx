'use client';

import { useEffect, useMemo, useState } from 'react';
import { Console } from '../components/Console';
import { DemandChart } from '../components/DemandChart';
import { SessionsList } from '../components/SessionsList';
import { ChargerLaneLayer, LaneDetail, LaneLegend, laneLayout } from '../components/overview/ChargerLane';
import { EnergyHorizonLayer, horizonLayout } from '../components/overview/EnergyHorizon';
import { SchedulerActivity } from '../components/overview/SchedulerActivity';
import { SitePlan } from '../components/overview/SitePlan';
import { Scene, washTone } from '../components/scene/Scene';
import { Wave } from '../components/scene/Wave';
import { api } from '../lib/api';
import { readBays, type Bay } from '../lib/bays';
import { carbonLabel, clockTime, kw, money, percent } from '../lib/format';
import type { LiveSite } from '../lib/useLiveSite';
import type { Impact, Site } from '../lib/types';

/**
 * Overview. One question, answered before anything is read closely: is the site charging at the
 * cleanest time it can without putting a departure at risk?
 */
export default function OverviewPage() {
  return <Console page="overview">{({ site, live }) => <OverviewBody site={site} live={live} />}</Console>;
}

const HOUR = 3_600_000;

function OverviewBody({ site, live }: { readonly site: Site | null; readonly live: LiveSite }) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const siteId = site?.id ?? null;
  const tz = site?.timezone ?? 'Europe/London';
  const { overview, plan, forecast, nowMs } = live;

  useEffect(() => {
    if (!siteId) return undefined;
    const load = (): void => {
      void api
        .impact(siteId)
        .then(setImpact)
        .catch(() => setImpact(null));
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [siteId]);

  // Four hours behind now and twenty ahead, re-anchored on the hour, so now walks across the
  // valley through each hour instead of sitting pinned to the left edge.
  const frameStart = nowMs > 0 ? Math.floor(nowMs / HOUR) * HOUR - 4 * HOUR : 0;
  const bays = useMemo(() => readBays(live.chargers, live.sessions, forecast, nowMs, tz), [live.chargers, live.sessions, forecast, nowMs, tz]);

  const active = live.sessions.filter((session) => session.status === 'active');
  const atRisk = active.filter((session) => session.deadlineRisk).length;
  const cut = impact && impact.baselineCo2Kg > 0 ? Math.round((1 - impact.co2Kg / impact.baselineCo2Kg) * 100) : null;

  const choose = (bay: Bay): void => {
    if (!bay.session) return;
    window.location.href = `/schedules?session=${bay.session.id}${siteId ? `#${siteId}` : ''}`;
  };

  return (
    <>
      <section className="hero" aria-labelledby="overview-title">
        <Scene
          className="is-hero is-tall"
          wash
          startMs={frameStart}
          spanMs={24 * HOUR}
          nowMs={nowMs}
          timezone={tz}
          horizon={0.62}
          label={`The next day at ${site?.name ?? 'this site'}, with its renewable forecast and chargers`}
          layers={(geometry) => {
            const horizon = horizonLayout(forecast, geometry);
            const lane = laneLayout(bays, geometry);
            return (
              <>
                {horizon ? <EnergyHorizonLayer layout={horizon} geometry={geometry} /> : null}
                <ChargerLaneLayer layout={lane} selected={hovered} onHover={setHovered} onChoose={choose} />
              </>
            );
          }}
        >
          {(geometry) => {
            const horizon = horizonLayout(forecast, geometry);
            const lane = laneLayout(bays, geometry);
            const tone = washTone(geometry, 'left');
            const promiseTone = washTone(geometry, 'right');
            // Labels written onto the landscape stay clear of both edges.
            const clampX = (px: number): number => Math.min(Math.max(px, 90), geometry.width - 110);
            const window = forecast?.greenWindow ?? null;
            const node = lane.nodes.find((entry) => entry.bay.charger.id === hovered) ?? null;
            const centre = geometry.width * 0.56;

            return (
              <>
                <div className={`hero-copy tone-${tone}`}>
                  <p className="eyebrow">Live site · {site?.name ?? 'Loading'}</p>
                  <h1 id="overview-title" className="display">
                    Let the sun set the schedule.
                  </h1>
                  <p className="lede">Cleaner energy. Happier drivers. A brighter tomorrow.</p>
                </div>

                <div className={`hero-promise is-scene-only tone-${promiseTone}`}>
                  {active.length > 0 ? (
                    <>
                      <p className="hero-promise-figure">
                        {active.length - atRisk} / {active.length} <span>departures protected</span>
                      </p>
                      <p className="hero-promise-note">
                        {atRisk === 0
                          ? 'All drivers on track. No missed deadlines.'
                          : `${atRisk} driver${atRisk === 1 ? '' : 's'} at risk. The plan re-solves every minute.`}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="hero-promise-figure">
                        0 <span>cars on site</span>
                      </p>
                      <p className="hero-promise-note">The plan is ready for the next arrival.</p>
                    </>
                  )}
                </div>

                {horizon ? (
                  <>
                    {geometry.nowX !== null && horizon.shareNow !== null && horizon.topNow !== null ? (
                      <p className="horizon-label is-now" style={{ left: clampX(geometry.nowX), top: horizon.topNow - 12 }}>
                        <strong>{percent(horizon.shareNow)}</strong> renewable
                      </p>
                    ) : null}
                    {overview && !lane.narrow ? (
                      <p className="horizon-label" style={{ left: centre, top: horizon.baseline + geometry.height * 0.07 }}>
                        <strong>
                          {kw(overview.siteDemandKw)} kW
                        </strong>{' '}
                        of {kw(overview.gridConnectionKw, 0)} kW
                      </p>
                    ) : null}
                    {window && horizon.windowSpan ? (
                      <p
                        className="horizon-label is-window"
                        style={{ left: clampX((horizon.windowSpan.x0 + horizon.windowSpan.x1) / 2), top: horizon.baseline - geometry.height * 0.25 }}
                      >
                        <strong>{clockTime(window.startMs, tz)}</strong> clean run
                      </p>
                    ) : null}
                    {horizon.ticks.map((tick, index) => (
                      <span key={`${tick.label}-${index}`} className="horizon-tick" style={{ left: tick.x, top: horizon.baseline + 8 }}>
                        {tick.label}
                      </span>
                    ))}
                  </>
                ) : null}

                <LaneDetail node={node} width={geometry.width} timezone={tz} />
                <div className="hero-legend">
                  <LaneLegend bays={bays} />
                </div>
              </>
            );
          }}
        </Scene>

        <div className="proof">
          <div className="wrap">
            {/* On a phone the promise has no open sky to stand in, so it leads the proof instead. */}
            <p className="proof-promise">
              {active.length > 0 ? (
                <>
                  <strong>
                    {active.length - atRisk} / {active.length}
                  </strong>{' '}
                  departures protected. {atRisk === 0 ? 'No missed deadlines.' : `${atRisk} at risk, re-solving every minute.`}
                </>
              ) : (
                <>
                  <strong>0</strong> cars on site. The plan is ready for the next arrival.
                </>
              )}
            </p>
            <p className="proof-claims">
              <span>
                <strong>{impact ? energy(impact.energyKwh) : '--'}</strong> delivered
              </span>
              <span>
                <strong>{cut === null ? '--' : cut === 0 ? '0%' : `${cut > 0 ? '-' : '+'}${Math.abs(cut)}%`}</strong>
                {cut !== null && cut < 0 ? ' more carbon than charging on plug-in' : ' carbon against charging on plug-in'}
              </span>
              <span>
                <strong>{impact ? `${Math.abs(impact.avoidedCo2Kg).toFixed(1)} kg` : '--'}</strong>
                {impact && impact.avoidedCo2Kg < 0 ? ' CO₂ above the plug-in baseline' : ' CO₂ avoided'},{' '}
                {impact ? `${impact.verifiedSessions} of ${impact.sessions}` : '--'} meter verified
              </span>
            </p>
            <p className="proof-facts">
              <span>
                Charging now {overview?.carsCharging ?? '--'} of {overview?.carsPluggedIn ?? '--'} plugged in
              </span>
              <span>
                {overview ? `${overview.chargersOnline} of ${overview.chargersTotal}` : '--'} bays online
              </span>
              <span>
                Site load {kw(overview?.siteDemandKw)} kW of {kw(overview?.gridConnectionKw, 0)}, {kw(overview?.headroomKw)} kW of headroom
              </span>
              <span>{overview ? `${Math.round(overview.carbonGPerKwh)} gCO₂/kWh, ${carbonLabel(overview.carbonGPerKwh)}` : '--'}</span>
              <span>Saved so far {impact ? money(impact.costSaved, site?.currency) : '--'}</span>
            </p>
          </div>
        </div>
      </section>

      <section className="chapter" aria-labelledby="site-now">
        <Wave tone="paper" />
        <div className="wrap">
          <h2 id="site-now" className="title">
            {headlineFor(live)}
          </h2>
          <div className="split">
            <div className="band">
              <h3 className="subtitle">Measured site demand</h3>
              <DemandChart demand={live.demand} nowMs={nowMs} timezone={tz} />
            </div>
            <div>
              <h3 className="subtitle">What the scheduler is doing</h3>
              <SchedulerActivity plan={plan} sessions={live.sessions} nowMs={nowMs} />
            </div>
          </div>
        </div>
      </section>

      <section className="chapter is-tight" aria-labelledby="car-park">
        <div className="wrap">
          <h2 id="car-park" className="subtitle">
            The car park, live
          </h2>
          <p className="caption">Point at a bay for its driver and current draw.</p>
          <SitePlan bays={bays} timezone={tz} onChoose={choose} />
          <LaneLegend bays={bays} />
        </div>
      </section>

      <section className="chapter is-tight is-last" aria-labelledby="exceptions">
        <div className="wrap">
          <div className="chapter-head">
            <h2 id="exceptions" className="subtitle">
              Sessions and exceptions
            </h2>
            <p className="caption">Deadline order</p>
          </div>
          <SessionsList
            sessions={live.sessions}
            nowMs={nowMs}
            timezone={tz}
            onSelect={(session) => {
              window.location.href = `/schedules?session=${session.id}${siteId ? `#${siteId}` : ''}`;
            }}
          />
        </div>
      </section>
    </>
  );
}

function energy(kwh: number): string {
  return kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${kwh.toFixed(0)} kWh`;
}

/** The chapter heading says what the site is actually doing, not what we would like it to be doing. */
function headlineFor(live: LiveSite): string {
  const overview = live.overview;
  const window = live.forecast?.greenWindow ?? null;
  if (!overview) return 'Reading the site.';
  if (overview.carsPluggedIn === 0) return 'The site is quiet, and ready for the next car.';
  if (window && live.nowMs >= window.startMs && live.nowMs < window.endMs) return 'The site is charging into a cleaner hour.';
  if (overview.carsCharging === 0) return 'The site is holding its cars for a cleaner hour.';
  return 'The site is charging to its plan.';
}
