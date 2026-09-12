'use client';

import type { SceneGeometry } from '../scene/Scene';
import { clockTime, money } from '../../lib/format';
import { recommendation, sampleAt } from '../../lib/forecastRead';
import type { Forecast } from '../../lib/types';

/**
 * The next twenty-four hours of grid, laid over the lower half of the valley.
 *
 * A pale morning mist rises from the bottom of the scene so three lines can be read against it:
 * renewable share as the bright green area, carbon intensity as the forest line, import price as
 * the gold dashes. Renewable share is drawn on the percentage axis. Carbon and price share no unit
 * with it, so each is drawn against its own low and high for the day, and the caption says so.
 */

export interface ChartLayout {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly x: (index: number) => number;
  readonly indexAt: (px: number) => number;
  readonly shareY: (share: number) => number;
  readonly renewableArea: string;
  readonly renewableLine: string;
  readonly carbonLine: string;
  readonly priceLine: string;
  readonly window: { readonly x0: number; readonly x1: number } | null;
  readonly ticks: readonly { readonly x: number; readonly label: string }[];
}

export function chartLayout(forecast: Forecast | null, geometry: SceneGeometry, timezone: string): ChartLayout | null {
  if (!forecast || forecast.carbonGPerKwh.length < 2) return null;
  const { width, height, horizonY } = geometry;
  const narrow = width < 760;
  const left = narrow ? 44 : Math.max(64, width * 0.05);
  const right = width - (narrow ? 18 : Math.max(40, width * 0.035));
  const top = horizonY + height * (narrow ? 0.04 : 0.02);
  // Room below for the ticks and a legend that can wrap, all clear of the wave that opens the next section.
  const bottom = height - (narrow ? 150 : 120);
  const count = forecast.carbonGPerKwh.length;
  const stepMs = forecast.stepMinutes * 60_000;

  const x = (index: number): number => left + (index / (count - 1)) * (right - left);
  const indexAt = (px: number): number => Math.round(((px - left) / (right - left)) * (count - 1));
  const shareY = (share: number): number => bottom - share * (bottom - top);
  const span = (values: readonly number[]) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    return { low, range: Math.max(1e-6, high - low) };
  };
  const carbon = span(forecast.carbonGPerKwh);
  const price = span(forecast.pricePerKwh);

  const line = (values: readonly number[], y: (value: number) => number): string =>
    values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');

  const renewableLine = line(forecast.renewableShare, shareY);
  const renewableArea = `${renewableLine} L${x(count - 1).toFixed(1)},${bottom} L${x(0).toFixed(1)},${bottom} Z`;
  // Carbon and price keep a margin from the frame so their extremes are not lost against the edges.
  const inset = (share: number): number => shareY(0.06 + share * 0.88);
  const carbonLine = line(forecast.carbonGPerKwh, (value) => inset((value - carbon.low) / carbon.range));
  const priceLine = line(forecast.pricePerKwh, (value) => inset((value - price.low) / price.range));

  const greenWindow = forecast.greenWindow;
  const windowX = greenWindow
    ? {
        x0: x(Math.max(0, (greenWindow.startMs - forecast.startMs) / stepMs)),
        x1: x(Math.min(count - 1, (greenWindow.endMs - forecast.startMs) / stepMs)),
      }
    : null;

  const every = narrow ? 8 : 4;
  const ticks: { x: number; label: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const ms = forecast.startMs + index * stepMs;
    const label = clockTime(ms, timezone);
    if (label.endsWith(':00') && Number(label.slice(0, 2)) % every === 0) ticks.push({ x: x(index), label });
  }

  return {
    left,
    right,
    top,
    bottom,
    x,
    indexAt,
    shareY,
    renewableArea,
    renewableLine,
    carbonLine,
    priceLine,
    window: windowX && windowX.x1 > windowX.x0 ? windowX : null,
    ticks,
  };
}

export function ForecastChartLayer({ layout, geometry }: { readonly layout: ChartLayout; readonly geometry: SceneGeometry }) {
  return (
    <g className="fchart" aria-hidden="true">
      <defs>
        <linearGradient id="fchart-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--paper)" stopOpacity="0" />
          <stop offset="0.16" stopColor="var(--paper)" stopOpacity="0.8" />
          <stop offset="1" stopColor="var(--paper)" stopOpacity="0.94" />
        </linearGradient>
      </defs>
      <rect x="0" y={layout.top - 70} width={geometry.width} height={geometry.height - layout.top + 70} fill="url(#fchart-mist)" />

      {[0, 0.25, 0.5, 0.75, 1].map((share) => (
        <line key={share} x1={layout.left} x2={layout.right} y1={layout.shareY(share)} y2={layout.shareY(share)} className="fchart-grid" />
      ))}

      {layout.window ? (
        <rect x={layout.window.x0} y={layout.top - 4} width={layout.window.x1 - layout.window.x0} height={layout.bottom - layout.top + 4} className="fchart-window" rx="6" />
      ) : null}

      <path d={layout.renewableArea} className="fchart-area" />
      <path d={layout.renewableLine} className="fchart-renewable" />
      <path d={layout.carbonLine} className="fchart-carbon" />
      <path d={layout.priceLine} className="fchart-price" />

      {geometry.nowX !== null && geometry.nowX >= layout.left ? (
        <line x1={geometry.nowX} x2={geometry.nowX} y1={layout.top - 10} y2={layout.bottom} className="fchart-now" />
      ) : null}
    </g>
  );
}

export function ForecastChartOverlay({
  layout,
  forecast,
  timezone,
  currency,
  hover,
  onHover,
  onPin,
  pinned,
}: {
  readonly layout: ChartLayout;
  readonly forecast: Forecast;
  readonly timezone: string;
  readonly currency: string;
  readonly hover: number | null;
  readonly onHover: (index: number | null) => void;
  readonly onPin: () => void;
  readonly pinned: boolean;
}) {
  const sample = hover === null ? null : sampleAt(forecast, hover);
  const window = forecast.greenWindow;
  const windowIndex = window ? Math.round((window.startMs - forecast.startMs) / (forecast.stepMinutes * 60_000)) : null;
  const windowSample = windowIndex === null ? null : sampleAt(forecast, windowIndex);

  return (
    <>
      {[0, 0.25, 0.5, 0.75, 1].map((share) => (
        <span key={share} className="fchart-y" style={{ left: layout.left - 10, top: layout.shareY(share) }}>
          {Math.round(share * 100)}%
        </span>
      ))}
      {layout.ticks.map((tick, index) => (
        <span key={`${tick.label}-${index}`} className="fchart-x" style={{ left: tick.x, top: layout.bottom + 10 }}>
          {tick.label}
        </span>
      ))}

      {layout.window && window && windowSample ? (
        <button
          type="button"
          className={`fchart-window-label${pinned ? ' is-pinned' : ''}`}
          style={{ left: clampLabel((layout.window.x0 + layout.window.x1) / 2, layout.right + 18), top: layout.top - 12 }}
          onClick={onPin}
          aria-pressed={pinned}
        >
          <strong>
            Best charging window · {clockTime(window.startMs, timezone)}-{clockTime(window.endMs, timezone)}
          </strong>
          <span>
            {Math.round(window.avgRenewableShare * 100)}% renewable, {money(windowSample.price, currency)}/kWh, {Math.round(window.avgCarbonGPerKwh)} gCO₂/kWh
          </span>
        </button>
      ) : null}

      <div
        className="fchart-hit"
        style={{ left: layout.left, top: layout.top, width: layout.right - layout.left, height: layout.bottom - layout.top }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onHover(layout.indexAt(layout.left + (event.clientX - box.left)));
        }}
        onPointerLeave={() => onHover(null)}
        aria-hidden="true"
      />

      {sample ? (
        <>
          <span className="fchart-cross" style={{ left: layout.x(sample.index), top: layout.top, height: layout.bottom - layout.top }} />
          <div
            className="fchart-tip"
            role="status"
            style={{
              left: Math.min(Math.max(layout.x(sample.index), layout.left + 120), layout.right - 120),
              top: layout.shareY(sample.renewable) - 14,
            }}
          >
            <strong>{clockTime(sample.ms, timezone)}</strong>
            <span>
              {Math.round(sample.renewable * 100)}% renewable, {Math.round(sample.carbon)} gCO₂/kWh, {money(sample.price, currency)}/kWh
            </span>
            <em>{recommendation(forecast, sample.index)}</em>
          </div>
        </>
      ) : null}

      <p className="fchart-legend" style={{ left: layout.left, top: layout.bottom + 34 }}>
        <span>
          <i className="key is-renewable" aria-hidden="true" />
          Renewable share
        </span>
        <span>
          <i className="key is-carbon" aria-hidden="true" />
          Carbon intensity (gCO₂/kWh)
        </span>
        <span>
          <i className="key is-price" aria-hidden="true" />
          Import price ({currency === 'INR' ? '₹' : currency === 'GBP' ? '£' : currency}/kWh)
        </span>
      </p>
    </>
  );
}

/** A centred label kept whole inside the scene: half its likely width from either edge. */
function clampLabel(centre: number, width: number): number {
  const half = Math.min(150, width / 2 - 12);
  return Math.min(Math.max(centre, half + 12), width - half - 12);
}
