'use client';

import { clockTime } from '../lib/format';

/**
 * What the site will actually do about a flexibility request, on a timeline.
 *
 * A cap in kilowatts is a number an operator has to take on trust. The ramp shows the shape of the
 * response instead: when load comes down, how long it is held, when it returns, and how much of the
 * connection is given back over that window. The shaded band is the reduction the network receives.
 */

export interface Ramp {
  readonly startsMs: number;
  readonly endsMs: number;
  readonly capKw: number;
  readonly connectionKw: number;
  readonly drawKw: number;
  readonly sessions: number;
  readonly perSessionBeforeKw: number;
  readonly perSessionAfterKw: number;
}

const WIDTH = 720;
const HEIGHT = 132;
const PAD_X = 16;
const BASE_Y = HEIGHT - 26;
const TOP_Y = 16;

export function RampPlan({ ramp, timezone, live }: { readonly ramp: Ramp; readonly timezone: string; readonly live: boolean }) {
  const span = Math.max(1, ramp.endsMs - ramp.startsMs);
  // A quarter of an hour of lead either side, so the ramp reads as an event inside a longer day.
  const lead = Math.max(span * 0.22, 10 * 60_000);
  const from = ramp.startsMs - lead;
  const to = ramp.endsMs + lead;
  const x = (ms: number): number => PAD_X + ((ms - from) / (to - from)) * (WIDTH - PAD_X * 2);
  const y = (kw: number): number => BASE_Y - (Math.min(kw, ramp.connectionKw) / Math.max(1, ramp.connectionKw)) * (BASE_Y - TOP_Y);

  const rampMs = Math.min(span * 0.12, 5 * 60_000);
  const before = y(ramp.drawKw);
  const held = y(ramp.capKw);

  const points = [
    [x(from), before],
    [x(ramp.startsMs), before],
    [x(ramp.startsMs + rampMs), held],
    [x(ramp.endsMs - rampMs), held],
    [x(ramp.endsMs), before],
    [x(to), before],
  ];
  const line = points.map(([px, py]) => `${px?.toFixed(1)},${py?.toFixed(1)}`).join(' ');
  const shed = `${line} ${x(to).toFixed(1)},${before.toFixed(1)} ${x(to).toFixed(1)},${BASE_Y} ${x(from).toFixed(1)},${BASE_Y}`;

  return (
    <div className="ramp">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Planned response to the flexibility request">
        <polygon points={shed} className="ramp-area" />
        <line x1={PAD_X} y1={y(ramp.connectionKw)} x2={WIDTH - PAD_X} y2={y(ramp.connectionKw)} className="ramp-limit" />
        <polyline points={line} className="ramp-line" />

        {[
          { ms: ramp.startsMs, label: 'ramp down' },
          { ms: ramp.endsMs, label: 'restore' },
        ].map((mark) => (
          <g key={mark.label} transform={`translate(${x(mark.ms)} 0)`}>
            <line x1="0" y1={TOP_Y - 6} x2="0" y2={BASE_Y} className="ramp-mark" />
            <circle cx="0" cy={before} r="4.5" className="ramp-knob" />
            <text x="0" y={BASE_Y + 16} className="ramp-time">
              {clockTime(mark.ms, timezone)} {mark.label}
            </text>
          </g>
        ))}

        <text x={PAD_X} y={y(ramp.connectionKw) - 6} className="ramp-axis">
          {Math.round(ramp.connectionKw)} kW connection
        </text>
        <text x={WIDTH - PAD_X} y={held - 8} className="ramp-axis is-end">
          held at {Math.round(ramp.capKw)} kW
        </text>
      </svg>

      <p className="ramp-note">
        {live ? 'Now holding: ' : 'If accepted: '}
        <strong>{ramp.sessions}</strong> flexible session{ramp.sessions === 1 ? '' : 's'} step from{' '}
        <strong>{ramp.perSessionBeforeKw.toFixed(1)} kW</strong> to{' '}
        <strong>{ramp.perSessionAfterKw.toFixed(1)} kW</strong> each. Cars that cannot move without missing a deadline keep
        charging and are counted as deadline risk.
      </p>
    </div>
  );
}
