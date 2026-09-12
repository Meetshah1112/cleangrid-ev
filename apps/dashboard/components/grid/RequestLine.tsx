'use client';

import { useSize } from '../scene/useSize';
import { clockTime, kw } from '../../lib/format';

/**
 * The shape of a response on one line: when load comes down, how long it is held, and when it
 * comes back, under the site's connection. A cap in kilowatts is a number to take on trust; the
 * shape is something an operator can check against what the site then does.
 */

export interface Ramp {
  readonly startsMs: number;
  readonly endsMs: number;
  readonly capKw: number;
  readonly connectionKw: number;
  readonly drawKw: number;
}

const HEIGHT = 170;
const TOP = 30;
const BASE = HEIGHT - 32;

export function RequestLine({ ramp, timezone }: { readonly ramp: Ramp; readonly timezone: string }) {
  const { ref, size } = useSize<HTMLDivElement>({ width: 720, height: HEIGHT });
  const width = size.width;
  const span = Math.max(1, ramp.endsMs - ramp.startsMs);
  const lead = Math.max(span * 0.22, 10 * 60_000);
  const from = ramp.startsMs - lead;
  const to = ramp.endsMs + lead;
  const padX = 12;
  const x = (ms: number): number => padX + ((ms - from) / (to - from)) * (width - padX * 2);
  const top = Math.max(ramp.connectionKw, ramp.drawKw) * 1.05 || 1;
  const y = (value: number): number => BASE - (Math.max(0, value) / top) * (BASE - TOP);
  const rampMs = Math.min(span * 0.12, 5 * 60_000);
  const before = y(ramp.drawKw);
  const held = y(Math.min(ramp.capKw, ramp.drawKw));
  const points = [
    [x(from), before],
    [x(ramp.startsMs), before],
    [x(ramp.startsMs + rampMs), held],
    [x(ramp.endsMs - rampMs), held],
    [x(ramp.endsMs), before],
    [x(to), before],
  ] as const;
  const line = points.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${x(to).toFixed(1)},${BASE} L${x(from).toFixed(1)},${BASE} Z`;
  const narrow = width < 520;

  return (
    <div className="ramp" ref={ref}>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`Hold below ${kw(ramp.capKw, 0)} kW from ${clockTime(ramp.startsMs, timezone)} to ${clockTime(ramp.endsMs, timezone)}`}>
        <rect x={x(ramp.startsMs)} y={TOP - 8} width={Math.max(1, x(ramp.endsMs) - x(ramp.startsMs))} height={BASE - TOP + 8} className="ramp-window" />
        <path d={area} className="ramp-area" />
        <line x1={padX} x2={width - padX} y1={y(ramp.connectionKw)} y2={y(ramp.connectionKw)} className="chart-limit" />
        <path d={line} className="ramp-line" />
        <line x1={padX} x2={width - padX} y1={BASE + 0.5} y2={BASE + 0.5} className="chart-grid" />
        <text x={padX} y={y(ramp.connectionKw) - 8} className="chart-limit-label">
          {kw(ramp.connectionKw, 0)} kW connection
        </text>
        <text x={(x(ramp.startsMs) + x(ramp.endsMs)) / 2} y={held - 10} className="ramp-held">
          held at {kw(Math.min(ramp.capKw, ramp.drawKw), 0)} kW
        </text>
        {[
          // Both labels sit inside the window, so neither runs off the edge of the chart.
          { ms: ramp.startsMs, label: 'ramp down', anchor: '' },
          { ms: ramp.endsMs, label: 'restore', anchor: 'is-end' },
        ].map((mark) => (
          <g key={mark.label}>
            <line x1={x(mark.ms)} x2={x(mark.ms)} y1={TOP - 8} y2={BASE} className="ramp-mark" />
            <text x={x(mark.ms) + (mark.anchor ? -6 : 6)} y={BASE + 20} className={`chart-tick ${mark.anchor}`}>
              {clockTime(mark.ms, timezone)}
              {narrow ? '' : ` ${mark.label}`}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
