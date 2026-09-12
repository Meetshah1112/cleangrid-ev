'use client';

import { useSize } from './scene/useSize';
import { clockTime, kw } from '../lib/format';
import type { Demand } from '../lib/types';

/**
 * What the site actually drew, interval by interval, against its connection.
 *
 * A plan cannot show this. An unmanaged site has no plan, and this is the line that goes over the
 * connection when nothing is managing it. Any interval that did go over is filled in coral and
 * counted in words, never smoothed into the line.
 */

const PAD = { left: 40, right: 14, top: 26, bottom: 30 };

export function DemandChart({
  demand,
  nowMs,
  timezone,
}: {
  readonly demand: Demand | null;
  readonly nowMs: number;
  readonly timezone: string;
}) {
  const { ref, size } = useSize<HTMLDivElement>({ width: 900, height: 280 });

  if (!demand || demand.intervals.length < 2) {
    return (
      <div className="demand" ref={ref}>
        <p className="empty">Measuring. The first interval appears once it has finished.</p>
      </div>
    );
  }

  const { width, height } = size;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const intervals = demand.intervals;
  const first = intervals[0]!;
  const last = intervals[intervals.length - 1]!;
  const stepMs = demand.stepMinutes * 60_000;
  const startMs = first.startMs;
  const endMs = Math.max(last.startMs + stepMs, nowMs);
  const spanMs = Math.max(stepMs, endMs - startMs);
  const limitKw = demand.gridConnectionKw;
  const maxKw = Math.max(limitKw * 1.12, ...intervals.map((interval) => interval.totalKw)) || 1;

  const x = (ms: number): number => PAD.left + ((ms - startMs) / spanMs) * plotW;
  const y = (value: number): number => PAD.top + plotH - (value / maxKw) * plotH;

  const line = intervals
    .flatMap((interval) => [`${x(interval.startMs).toFixed(1)},${y(interval.totalKw).toFixed(1)}`, `${x(interval.startMs + stepMs).toFixed(1)},${y(interval.totalKw).toFixed(1)}`])
    .join(' L');
  const area = `M${x(startMs).toFixed(1)},${y(0)} L${line} L${x(last.startMs + stepMs).toFixed(1)},${y(0)} Z`;

  const breaches = intervals.filter((interval) => interval.totalKw > limitKw + 0.05);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(maxKw * fraction));
  const hourly = intervals.filter((interval) => new Date(interval.startMs).getUTCMinutes() === 0);
  const every = Math.max(1, Math.ceil(hourly.length / Math.max(3, Math.floor(plotW / 110))));

  // The legend sits outside the measured box: inside it, a legend that wraps on a phone would spill
  // past the chart's fixed height into whatever follows.
  return (
    <div>
    <div className="demand" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Measured site draw against the ${kw(limitKw, 0)} kW connection`}>
        {ticks.map((value) => (
          <g key={value}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} className="chart-grid" />
            <text x={PAD.left - 8} y={y(value) + 4} className="chart-tick is-end">
              {value}
            </text>
          </g>
        ))}

        <path d={area} className="demand-area" />
        <path d={`M${line}`} className="demand-line" />

        {breaches.map((interval) => (
          <rect
            key={interval.startMs}
            x={x(interval.startMs)}
            y={y(interval.totalKw)}
            width={Math.max(1.5, x(interval.startMs + stepMs) - x(interval.startMs))}
            height={Math.max(1, y(limitKw) - y(interval.totalKw))}
            className="demand-breach"
          />
        ))}

        <line x1={PAD.left} x2={width - PAD.right} y1={y(limitKw)} y2={y(limitKw)} className="chart-limit" />
        <text x={width - PAD.right} y={y(limitKw) - 8} className="chart-limit-label is-end">
          connection limit {kw(limitKw, 0)} kW
        </text>

        {hourly
          .filter((_, index) => index % every === 0)
          .map((interval) => (
            <text key={interval.startMs} x={x(interval.startMs)} y={height - 8} className="chart-tick is-middle">
              {clockTime(interval.startMs, timezone)}
            </text>
          ))}
      </svg>
    </div>

      <p className="chart-legend">
        <span>
          <i className="key is-draw" aria-hidden="true" />
          measured site draw
        </span>
        <span>
          <i className="key is-breach" aria-hidden="true" />
          over the connection
        </span>
        <span className="chart-legend-note">
          peak so far <strong className={demand.peakKw > limitKw ? 'is-over' : undefined}>{kw(demand.peakKw)} kW</strong>{breaches.length > 0 ? `, ${breaches.length} interval${breaches.length === 1 ? '' : 's'} over` : ', never over'}
        </span>
      </p>
    </div>
  );
}
