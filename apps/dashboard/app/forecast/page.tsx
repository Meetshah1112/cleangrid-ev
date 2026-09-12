'use client';

import { Console } from '../../components/Console';
import { ForecastChart } from '../../components/ForecastChart';
import { carbonColor, clockTime, money, percent } from '../../lib/format';
import type { Forecast } from '../../lib/types';

/** Forecast and planning: the evidence behind the scheduler's choices. */
export default function ForecastPage() {
  return (
    <Console page="forecast">
      {({ site, live }) => {
        const forecast = live.forecast;
        const tz = site?.timezone ?? 'Europe/London';
        const stepMs = forecast ? forecast.stepMinutes * 60_000 : 0;
        const slots = forecast ? [4, 12, 24, 36] : [];

        return (
          <>
            <h1 className="headline">Forecast the cleanest blocks.</h1>
            <p className="subline">
              {forecast
                ? `Grid data for ${site?.name}: carbon from ${forecast.sources.carbon}, price from ${forecast.sources.price}, renewables from ${forecast.sources.renewable}.`
                : 'Loading the forecast.'}
            </p>

            <section className="card">
              <div className="card-head">
                <h2>Next 24 hours</h2>
                <span className="note">{forecast ? `updated ${clockTime(forecast.startMs, tz)}` : ''}</span>
              </div>
              <ForecastChart forecast={forecast} timezone={tz} />
            </section>

            <div className="grid two" style={{ marginTop: 14 }}>
              <section className="card">
                <div className="card-head">
                  <h2>Energy weather</h2>
                  <span className="note">renewable share ahead</span>
                </div>
                <div className="weather">
                  {slots.map((index) => {
                    const share = forecast?.renewableShare[index];
                    const carbon = forecast?.carbonGPerKwh[index];
                    const price = forecast?.pricePerKwh[index];
                    if (share === undefined || carbon === undefined) return null;
                    return (
                      <div key={index} className="weather-cell">
                        <div className="label">{clockTime((forecast?.startMs ?? 0) + index * stepMs, tz)}</div>
                        <div className="value" style={{ fontSize: 22, color: carbonColor(carbon) }}>
                          {percent(share)}
                        </div>
                        <div className="sub">
                          {Math.round(carbon)} g · {money(price ?? 0, site?.currency ?? 'GBP')}/kWh
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Planning signal</h2>
                </div>
                <PlanningSignal forecast={forecast} timezone={tz} />
                {forecast?.notes.map((note) => (
                  <p key={note} className="note" style={{ marginTop: 10 }}>
                    {note}
                  </p>
                ))}
              </section>
            </div>
          </>
        );
      }}
    </Console>
  );
}

function PlanningSignal({ forecast, timezone }: { readonly forecast: Forecast | null; readonly timezone: string }) {
  if (!forecast) return <p className="empty">No forecast loaded.</p>;
  const window = forecast.greenWindow;
  const worstIndex = forecast.carbonGPerKwh.reduce(
    (worst, value, index) => (value > (forecast.carbonGPerKwh[worst] ?? 0) ? index : worst),
    0,
  );
  const worstMs = forecast.startMs + worstIndex * forecast.stepMinutes * 60_000;

  return (
    <div className="rows">
      {window && (
        <div className="row">
          <span className="lead">
            <i />
            Cleanest window
          </span>
          <span className="num">
            {clockTime(window.startMs, timezone)}&ndash;{clockTime(window.endMs, timezone)} ·{' '}
            {percent(window.avgRenewableShare)} renewable
          </span>
        </div>
      )}
      <div className="row">
        <span className="lead">
          <i className="amber" />
          Worst hour to draw
        </span>
        <span className="num">
          {clockTime(worstMs, timezone)} · {Math.round(forecast.carbonGPerKwh[worstIndex] ?? 0)} gCO2/kWh
        </span>
      </div>
      <div className="row">
        <span className="lead">
          <i className="dim" />
          Spread between best and worst
        </span>
        <span className="num">
          {Math.round(Math.max(...forecast.carbonGPerKwh) - Math.min(...forecast.carbonGPerKwh))} gCO2/kWh
        </span>
      </div>
      <p className="note" style={{ marginTop: 12 }}>
        Flexible sessions are moved into the green band and away from the peak. Anything with a deadline before the
        window keeps its own schedule, which is why a few cars still charge in expensive hours.
      </p>
    </div>
  );
}
