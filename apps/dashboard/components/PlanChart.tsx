'use client';

import { carbonColor, clockTime } from '../lib/format';
import type { Plan } from '../lib/types';

/**
 * The plan for the next 24 hours: building load and charging stacked against the grid connection,
 * with a ribbon underneath showing how clean the grid is in each slot. Hand-drawn SVG rather than
 * a chart library so the carbon scale is the same one the rest of the dashboard uses.
 */

const WIDTH = 980;
const HEIGHT = 260;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PLOT_HEIGHT = 190;
const RIBBON_TOP = PAD_TOP + PLOT_HEIGHT + 10;
const RIBBON_HEIGHT = 14;

interface PlanChartProps {
  readonly plan: Plan | null;
  readonly nowMs: number;
}

export function PlanChart({ plan, nowMs }: PlanChartProps) {
  if (!plan || plan.siteLoadKw.length === 0) {
    return <p className="empty">No plan yet. The optimiser solves as soon as a car plugs in.</p>;
  }

  const slots = plan.grid.slots;
  const slotMs = plan.grid.slotMinutes * 60_000;
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const slotWidth = plotWidth / slots;
  const capKw = plan.capKw.length > 0 ? Math.max(...plan.capKw) : Math.max(...plan.siteLoadKw);
  const maxKw = Math.max(capKw * 1.12, ...plan.siteLoadKw) || 1;

  const y = (kwValue: number): number => PAD_TOP + PLOT_HEIGHT - (kwValue / maxKw) * PLOT_HEIGHT;
  const x = (slot: number): number => PAD_LEFT + slot * slotWidth;

  const area = (values: readonly number[]): string => {
    const top = values.map((value, slot) => `${x(slot).toFixed(1)},${y(value).toFixed(1)} ${x(slot + 1).toFixed(1)},${y(value).toFixed(1)}`);
    return `M ${PAD_LEFT},${y(0)} L ${top.join(' L ')} L ${x(slots).toFixed(1)},${y(0)} Z`;
  };

  const nowSlot = Math.max(0, Math.min(slots, (nowMs - plan.grid.startMs) / slotMs));
  const ticks = [0, 4, 8, 12, 16, 20, 24].map((hour) => Math.round((hour * 60) / plan.grid.slotMinutes));
  const gridLines = [0.25, 0.5, 0.75, 1].map((fraction) => Math.round(maxKw * fraction));

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Planned site load over the next 24 hours">
        {gridLines.map((value) => (
          <g key={value}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(value)} y2={y(value)} stroke="var(--line-soft)" />
            <text x={PAD_LEFT - 8} y={y(value) + 4} fill="var(--dim)" fontSize="10" textAnchor="end">
              {value}
            </text>
          </g>
        ))}

        <path d={area(plan.siteLoadKw)} fill="rgb(61 220 151 / 0.22)" stroke="var(--accent)" strokeWidth="1.2" />
        <path d={area(plan.baseLoadKw)} fill="rgb(90 169 247 / 0.16)" stroke="rgb(90 169 247 / 0.5)" strokeWidth="1" />

        {plan.capKw.length > 0 && (
          <path
            d={`M ${plan.capKw
              .map((value, slot) => `${x(slot).toFixed(1)},${y(value).toFixed(1)} ${x(slot + 1).toFixed(1)},${y(value).toFixed(1)}`)
              .join(' L ')}`}
            fill="none"
            stroke="var(--red)"
            strokeWidth="1.2"
            strokeDasharray="5 4"
            style={{ opacity: 0.85 }}
          />
        )}

        {/* Carbon ribbon: how clean the grid is in each slot. */}
        {plan.carbonGPerKwh.map((value, slot) => (
          <rect
            key={slot}
            x={x(slot)}
            y={RIBBON_TOP}
            width={slotWidth + 0.5}
            height={RIBBON_HEIGHT}
            fill={carbonColor(value)}
            opacity={0.85}
          />
        ))}

        <line
          x1={x(nowSlot)}
          x2={x(nowSlot)}
          y1={PAD_TOP - 4}
          y2={RIBBON_TOP + RIBBON_HEIGHT + 2}
          stroke="var(--text)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <text x={x(nowSlot) + 4} y={PAD_TOP + 6} fill="var(--text)" fontSize="10">
          now
        </text>

        {ticks.map((slot) => (
          <text
            key={slot}
            x={x(Math.min(slot, slots))}
            y={RIBBON_TOP + RIBBON_HEIGHT + 14}
            fill="var(--dim)"
            fontSize="10"
            textAnchor="middle"
          >
            {clockTime(plan.grid.startMs + slot * slotMs)}
          </text>
        ))}
      </svg>

      <div className="legend">
        <span>
          <i className="swatch" style={{ background: 'rgb(61 220 151 / 0.5)', border: '1px solid var(--accent)' }} /> total
          site draw
        </span>
        <span>
          <i className="swatch" style={{ background: 'rgb(90 169 247 / 0.35)' }} /> building load
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--red)' }} /> grid connection limit
        </span>
        <span>
          <i className="swatch" style={{ background: `linear-gradient(90deg, ${carbonColor(120)}, ${carbonColor(700)})` }} />{' '}
          grid carbon intensity
        </span>
      </div>
    </div>
  );
}
