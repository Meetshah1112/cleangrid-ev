'use client';

import { useState } from 'react';
import { Console } from '../../components/Console';
import { Icon } from '../../components/Icon';
import { ChartLayoutView } from '../../components/forecast/ChartLayoutView';
import { ForecastMoments } from '../../components/forecast/ForecastMoments';
import { Scene, washTone } from '../../components/scene/Scene';
import { Wave } from '../../components/scene/Wave';
import { clockTime, money, percent } from '../../lib/format';
import { flexibleInto, isModelled, momentsOf, sampleAt, worstHour } from '../../lib/forecastRead';
import type { LiveSite } from '../../lib/useLiveSite';
import type { Forecast, Site } from '../../lib/types';

/** Forecast. Where energy will be clean, cheap and renewable enough to move flexible charging into. */
export default function ForecastPage() {
  return <Console page="forecast">{({ site, live }) => <ForecastBody site={site} live={live} />}</Console>;
}

const DAY = 24 * 3_600_000;

function ForecastBody({ site, live }: { readonly site: Site | null; readonly live: LiveSite }) {
  const [pinned, setPinned] = useState(false);
  const forecast = live.forecast;
  const tz = site?.timezone ?? 'Europe/London';
  const currency = site?.currency ?? 'GBP';
  const window = forecast?.greenWindow ?? null;
  const windowSample = forecast && window ? sampleAt(forecast, Math.round((window.startMs - forecast.startMs) / (forecast.stepMinutes * 60_000))) : null;
  const movable = window ? flexibleInto(window, live.sessions) : [];
  const worst = forecast ? worstHour(forecast) : null;

  return (
    <>
      <section className="hero" aria-labelledby="forecast-title">
        <Scene
          className="is-hero"
          wash
          startMs={forecast?.startMs ?? 0}
          spanMs={forecast ? forecast.carbonGPerKwh.length * forecast.stepMinutes * 60_000 : DAY}
          nowMs={live.nowMs}
          timezone={tz}
          horizon={0.54}
          label={`The next 24 hours of grid at ${site?.name ?? 'this site'}`}
          layers={(geometry) => <ChartLayoutView.Layer forecast={forecast} geometry={geometry} timezone={tz} />}
        >
          {(geometry) => (
            <>
              <div className={`hero-copy tone-${washTone(geometry, 'left')}`}>
                <p className="eyebrow">Grid forecast · Next 24 hours</p>
                <h1 id="forecast-title" className="display">
                  Read the weather. Move the energy.
                </h1>
                <p className="lede is-wide">Real-time grid insights for cleaner, cheaper charging. A brighter tomorrow, hour by hour.</p>
              </div>
              <p className={`hero-note hand tone-${washTone(geometry, 'right')}`}>Renewable today. Brighter tomorrow.</p>
              <ChartLayoutView.Overlay
                forecast={forecast}
                geometry={geometry}
                timezone={tz}
                currency={currency}
                pinned={pinned}
                onPin={() => setPinned((value) => !value)}
              />
            </>
          )}
        </Scene>
      </section>

      <section className="chapter" aria-label="Best window">
        <Wave tone="paper" />
        <div className="wrap">
          <div className="ribbon">
            <div className="ribbon-item">
              <span className="figure">{window ? percent(window.avgRenewableShare) : '--'}</span>
              <span className="caption">
                <Icon name="leaf" size={16} />
                renewable in the best window
              </span>
            </div>
            <div className="ribbon-item">
              <span className="figure">{windowSample ? `${money(windowSample.price, currency)}/kWh` : '--'}</span>
              <span className="caption">
                <Icon name="bolt" size={16} />
                import price as it opens
              </span>
            </div>
            <div className="ribbon-item">
              <span className="figure">{window ? `${Math.round(window.avgCarbonGPerKwh)} g` : '--'}</span>
              <span className="caption">
                <Icon name="leaf" size={16} />
                CO₂ per kWh, on average
              </span>
            </div>
          </div>

          {pinned && window ? (
            <div className="pinned" role="region" aria-label="Cars that can move into the window">
              <p className="body">
                <strong>
                  {clockTime(window.startMs, tz)}-{clockTime(window.endMs, tz)}.
                </strong>{' '}
                {movable.length === 0
                  ? 'No car on site right now can move into it: every car is full, at risk, or leaves before it closes.'
                  : `${movable.length} car${movable.length === 1 ? '' : 's'} on site could move into it without risking a departure:`}
              </p>
              {movable.length > 0 ? (
                <ul className="pinned-list">
                  {movable.map((session) => (
                    <li key={session.id}>
                      <strong>{session.driverName ?? session.idTag}</strong> {session.chargerId}, needs{' '}
                      {(session.energyNeededKwh - session.energyDeliveredKwh).toFixed(1)} kWh by {clockTime(session.deadlineMs, tz)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="chapter is-tight" aria-labelledby="moments-title">
        <div className="wrap">
          <h2 id="moments-title" className="title">
            Three moments in the day ahead.
          </h2>
          {forecast ? <ForecastMoments moments={momentsOf(forecast, tz)} timezone={tz} nowMs={live.nowMs} /> : <p className="empty">Loading the forecast.</p>}
        </div>
      </section>

      <section className="hero is-close" aria-labelledby="insight-title">
        <Scene
          className="is-short"
          wash
          startMs={worst ? worst.ms - 14 * 3_600_000 : 0}
          spanMs={DAY}
          nowMs={live.nowMs}
          timezone={tz}
          horizon={0.66}
          features={{ turbines: true, solar: false, town: true }}
          label="The valley towards the evening peak"
        >
          {(geometry) => (
            <div className={`hero-copy tone-${washTone(geometry, 'left')}`}>
              <p className="eyebrow">Planning insight</p>
              <h2 id="insight-title" className="display is-close">
                {insightHeadline(movable.length, worst ? clockTime(worst.ms, tz) : null)}
              </h2>
              <p className="lede">Shift charging into cleaner, cheaper hours and help balance the grid.</p>
              <p className="actions">
                <a
                  className="btn is-primary"
                  href={`/schedules${window ? `?window=${window.startMs}-${window.endMs}` : ''}${site ? `#${site.id}` : ''}`}
                >
                  See charging schedules
                  <Icon name="arrow" size={16} />
                </a>
                <span className="hand">Cleaner power, happier drivers.</span>
              </p>
            </div>
          )}
        </Scene>
      </section>

      <section className="chapter is-last" aria-label="Planning signal and sources">
        <div className="wrap">
          <SourceDetail forecast={forecast} timezone={tz} />
        </div>
      </section>
    </>
  );
}

function insightHeadline(movable: number, peak: string | null): string {
  if (!peak) return 'Reading the day ahead.';
  if (movable === 0) return `The next flexible cars move before the ${peak} peak.`;
  return `Move ${movable} flexible car${movable === 1 ? '' : 's'} before the ${peak} peak.`;
}

/** The planning signal and where the numbers came from, available without being the focus. */
function SourceDetail({ forecast, timezone }: { readonly forecast: Forecast | null; readonly timezone: string }) {
  if (!forecast) return <p className="empty">No forecast loaded.</p>;
  const window = forecast.greenWindow;
  const worst = worstHour(forecast);
  const spread = Math.round(Math.max(...forecast.carbonGPerKwh) - Math.min(...forecast.carbonGPerKwh));
  const sources: [string, string][] = [
    ['Carbon', forecast.sources.carbon],
    ['Price', forecast.sources.price],
    ['Renewables', forecast.sources.renewable],
  ];

  return (
    <details className="detail">
      <summary>
        <span className="subtitle">Planning signal and sources</span>
        <span className="caption">
          Covers {clockTime(forecast.startMs, timezone)} to{' '}
          {clockTime(forecast.startMs + forecast.carbonGPerKwh.length * forecast.stepMinutes * 60_000, timezone)}
        </span>
      </summary>
      <dl className="detail-list">
        {window ? (
          <div>
            <dt>Cleanest window</dt>
            <dd>
              {clockTime(window.startMs, timezone)}-{clockTime(window.endMs, timezone)}, {percent(window.avgRenewableShare)} renewable
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Worst hour to draw</dt>
          <dd>
            {clockTime(worst.ms, timezone)}, {Math.round(worst.carbon)} gCO₂/kWh
          </dd>
        </div>
        <div>
          <dt>Spread between best and worst</dt>
          <dd>{spread} gCO₂/kWh</dd>
        </div>
        {sources.map(([label, source]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {source}
              {isModelled(source) ? <span className="status is-risk">modelled, not measured</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="body">
        Flexible sessions move into the green band. Drivers whose deadlines come before it keep their own schedule, which is why a few cars
        still charge in expensive hours.
      </p>
      {forecast.notes.map((note) => (
        <p key={note} className="caption">
          {note}
        </p>
      ))}
    </details>
  );
}
