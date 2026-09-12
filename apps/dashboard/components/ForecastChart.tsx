'use client';

import { clockTime } from '../lib/format';
import type { Forecast } from '../lib/types';

/**
 * Why the scheduler picks the hours it picks: renewable share, carbon and price over the next
 * day, with the cleanest window marked. Three series on one frame, each normalised to its own
 * range because they share no unit.
 */

const WIDTH = 960;
const HEIGHT = 230;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PLOT = 160;

const path = (values: readonly number[], x: (i: number) => number, y: (v: number) => number): string =>
  values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');

export function ForecastChart({ forecast, timezone }: { readonly forecast: Forecast | null; readonly timezone: string }) {
  if (!forecast || forecast.carbonGPerKwh.length < 2) return <p className="empty">No forecast loaded.</p>;

  const steps = forecast.carbonGPerKwh.length;
  const stepMs = forecast.stepMinutes * 60_000;
  const x = (index: number): number => PAD_LEFT + (index / (steps - 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT);

  const span = (values: readonly number[]): [number, number] => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return max - min < 1e-6 ? [min - 1, max + 1] : [min, max];
  };
  const [carbonMin, carbonMax] = span(forecast.carbonGPerKwh);
  const [priceMin, priceMax] = span(forecast.pricePerKwh);

  const yShare = (value: number): number => PAD_TOP + PLOT - value * PLOT;
  const yCarbon = (value: number): number => PAD_TOP + PLOT - ((value - carbonMin) / (carbonMax - carbonMin)) * PLOT;
  const yPrice = (value: number): number => PAD_TOP + PLOT - ((value - priceMin) / (priceMax - priceMin)) * PLOT;

  const window = forecast.greenWindow;
  const windowFrom = window ? Math.max(0, Math.round((window.startMs - forecast.startMs) / stepMs)) : null;
  const windowTo = window ? Math.min(steps - 1, Math.round((window.endMs - forecast.startMs) / stepMs)) : null;

  const ticks = Array.from({ length: 7 }, (_, index) => Math.round((index * (steps - 1)) / 6));

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Renewable share, carbon intensity and price over the next day">
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yShare(fraction)}
              y2={yShare(fraction)}
              stroke="var(--line-soft)"
            />
            <text x={PAD_LEFT - 8} y={yShare(fraction) + 4} fill="var(--dim)" fontSize="10" textAnchor="end">
              {Math.round(fraction * 100)}%
            </text>
          </g>
        ))}

        {windowFrom !== null && windowTo !== null && windowTo > windowFrom && (
          <g>
            <rect
              x={x(windowFrom)}
              y={PAD_TOP}
              width={x(windowTo) - x(windowFrom)}
              height={PLOT}
              fill="rgb(167 224 138 / 0.28)"
            />
            <text x={(x(windowFrom) + x(windowTo)) / 2} y={PAD_TOP - 3} fill="#2c6b45" fontSize="10" textAnchor="middle">
              cleanest window
            </text>
          </g>
        )}

        <path d={path(forecast.renewableShare, x, yShare)} fill="none" stroke="var(--green)" strokeWidth="2" />
        <path d={path(forecast.carbonGPerKwh, x, yCarbon)} fill="none" stroke="#124c37" strokeWidth="1.6" opacity="0.85" />
        <path
          d={path(forecast.pricePerKwh, x, yPrice)}
          fill="none"
          stroke="var(--amber)"
          strokeWidth="1.6"
          strokeDasharray="5 4"
        />

        {ticks.map((index) => (
          <text key={index} x={x(index)} y={PAD_TOP + PLOT + 18} fill="var(--dim)" fontSize="10" textAnchor="middle">
            {clockTime(forecast.startMs + index * stepMs, timezone)}
          </text>
        ))}
      </svg>

      <div className="legend">
        <span>
          <i className="swatch" style={{ background: 'var(--green)' }} /> renewable share
        </span>
        <span>
          <i className="swatch" style={{ background: '#124c37' }} /> carbon intensity
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--amber)' }} /> import price
        </span>
        <span>
          sources: {forecast.sources.carbon}, {forecast.sources.price}, {forecast.sources.renewable}
        </span>
      </div>
    </div>
  );
}
