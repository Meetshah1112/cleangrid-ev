'use client';

import { clockTime, kw } from '../lib/format';
import type { Demand } from '../lib/types';

/**
 * What the site actually drew, interval by interval. A plan cannot show this: an unmanaged site
 * has no plan, and this is the line that goes over the connection when nothing is managing it.
 */

const WIDTH = 960;
const HEIGHT = 190;
const PAD_LEFT = 42;
const PAD_RIGHT = 10;
const PAD_TOP = 10;
const PLOT = 140;

export function DemandChart({
  demand,
  nowMs,
  timezone,
}: {
  readonly demand: Demand | null;
  readonly nowMs: number;
  readonly timezone: string;
}) {
  if (!demand || demand.intervals.length < 2) {
    return <p className="empty">Measuring. The first interval appears once it has finished.</p>;
  }

  const intervals = demand.intervals;
  const first = intervals[0]!;
  const last = intervals[intervals.length - 1]!;
  const stepMs = demand.stepMinutes * 60_000;
  const startMs = first.startMs;
  const endMs = Math.max(last.startMs + stepMs, nowMs);
  const spanMs = Math.max(stepMs, endMs - startMs);
  const limitKw = demand.gridConnectionKw;
  const maxKw = Math.max(limitKw * 1.12, ...intervals.map((interval) => interval.totalKw)) || 1;

  const x = (ms: number): number => PAD_LEFT + ((ms - startMs) / spanMs) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (value: number): number => PAD_TOP + PLOT - (value / maxKw) * PLOT;

  const points = intervals.flatMap((interval) => [
    `${x(interval.startMs).toFixed(1)},${y(interval.totalKw).toFixed(1)}`,
    `${x(interval.startMs + stepMs).toFixed(1)},${y(interval.totalKw).toFixed(1)}`,
  ]);
  const area = `M ${x(startMs).toFixed(1)},${y(0).toFixed(1)} L ${points.join(' L ')} L ${x(
    last.startMs + stepMs,
  ).toFixed(1)},${y(0).toFixed(1)} Z`;

  const breaches = intervals.filter((interval) => interval.totalKw > limitKw + 0.05);
  const ticks = intervals.filter((interval) => new Date(interval.startMs).getUTCMinutes() === 0);
  const every = Math.max(1, Math.ceil(ticks.length / 8));

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Measured site demand against the grid connection">
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const value = Math.round(maxKw * fraction);
          return (
            <g key={value}>
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(value)} y2={y(value)} stroke="var(--line-soft)" />
              <text x={PAD_LEFT - 8} y={y(value) + 4} fill="var(--dim)" fontSize="10" textAnchor="end">
                {value}
              </text>
            </g>
          );
        })}

        <path d={area} fill="rgb(31 138 92 / 0.14)" stroke="var(--green)" strokeWidth="1.6" />

        {breaches.map((interval) => (
          <rect
            key={interval.startMs}
            x={x(interval.startMs)}
            y={y(interval.totalKw)}
            width={Math.max(1, x(interval.startMs + stepMs) - x(interval.startMs))}
            height={Math.max(1, y(limitKw) - y(interval.totalKw))}
            fill="rgb(192 57 43 / 0.5)"
          />
        ))}

        <line
          x1={PAD_LEFT}
          x2={WIDTH - PAD_RIGHT}
          y1={y(limitKw)}
          y2={y(limitKw)}
          stroke="var(--red)"
          strokeWidth="1.3"
          strokeDasharray="6 4"
        />
        <text x={WIDTH - PAD_RIGHT} y={y(limitKw) - 6} fill="var(--red)" fontSize="10" textAnchor="end">
          connection limit {kw(limitKw, 0)} kW
        </text>

        {ticks
          .filter((_, index) => index % every === 0)
          .map((interval) => (
            <text
              key={interval.startMs}
              x={x(interval.startMs)}
              y={PAD_TOP + PLOT + 16}
              fill="var(--dim)"
              fontSize="10"
              textAnchor="middle"
            >
              {clockTime(interval.startMs, timezone)}
            </text>
          ))}
      </svg>

      <div className="legend">
        <span>
          <i className="swatch" style={{ background: 'rgb(31 138 92 / 0.35)', border: '1px solid var(--green)' }} />{' '}
          measured site draw
        </span>
        <span>
          <i className="swatch" style={{ background: 'rgb(192 57 43 / 0.6)' }} /> over the connection
        </span>
        <span>
          peak so far{' '}
          <strong style={{ color: demand.peakKw > limitKw ? 'var(--red)' : 'var(--green)' }}>{kw(demand.peakKw)} kW</strong>
          {breaches.length > 0 ? ` · ${breaches.length} intervals over` : ' · never over'}
        </span>
      </div>
    </div>
  );
}
