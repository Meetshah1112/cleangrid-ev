'use client';

import { clockTime, kw } from '../lib/format';
import type { Plan, Session } from '../lib/types';

/**
 * The scheduler proof screen: one row per car showing exactly when it is planned to draw power,
 * and underneath, what that adds up to against the connection.
 */

const WIDTH = 960;
const ROW_HEIGHT = 18;
const LABEL_WIDTH = 74;
const PAD_RIGHT = 10;

const MODE_COLOUR: Record<string, string> = {
  greenest: '#2f9e6b',
  cheapest: '#3d7fae',
  fastest: '#d09025',
  balanced: '#1f8a5c',
};

export function ScheduleGantt({
  plan,
  sessions,
  nowMs,
  timezone,
}: {
  readonly plan: Plan | null;
  readonly sessions: Session[];
  readonly nowMs: number;
  readonly timezone: string;
}) {
  if (!plan) return <p className="empty">No plan yet. The optimiser solves as soon as a car plugs in.</p>;

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const rows = Object.entries(plan.allocationsKw)
    .map(([sessionId, powers]) => ({ sessionId, powers, session: byId.get(sessionId) ?? null }))
    .filter((row) => row.powers.some((value) => value > 0.01))
    .sort((a, b) => (a.session?.chargerId ?? '').localeCompare(b.session?.chargerId ?? ''));

  if (rows.length === 0) return <p className="empty">Nothing is scheduled: no car needs energy right now.</p>;

  const slots = plan.grid.slots;
  const slotMs = plan.grid.slotMinutes * 60_000;
  const plotWidth = WIDTH - LABEL_WIDTH - PAD_RIGHT;
  const slotWidth = plotWidth / slots;
  const height = rows.length * ROW_HEIGHT + 26;
  const x = (slot: number): number => LABEL_WIDTH + slot * slotWidth;
  const nowSlot = Math.max(0, Math.min(slots, (nowMs - plan.grid.startMs) / slotMs));
  const ticks = [0, 4, 8, 12, 16, 20, 24].map((hour) => Math.round((hour * 60) / plan.grid.slotMinutes));

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Planned charging blocks per car">
        {rows.map((row, index) => {
          const top = index * ROW_HEIGHT;
          const colour = MODE_COLOUR[row.session?.mode ?? 'balanced'] ?? 'var(--green)';
          return (
            <g key={row.sessionId}>
              <text x={0} y={top + 12} fill="var(--muted)" fontSize="10.5">
                {row.session?.chargerId ?? row.sessionId.slice(0, 6)}
              </text>
              <rect x={LABEL_WIDTH} y={top + 3} width={plotWidth} height={ROW_HEIGHT - 7} fill="var(--line-soft)" rx="3" />
              {row.powers.map((power, slot) =>
                power > 0.01 ? (
                  <rect
                    key={slot}
                    x={x(slot)}
                    y={top + 3}
                    width={slotWidth + 0.4}
                    height={ROW_HEIGHT - 7}
                    fill={colour}
                    opacity={0.35 + 0.65 * Math.min(1, power / Math.max(1, row.session?.maxPowerKw ?? 11))}
                  />
                ) : null,
              )}
            </g>
          );
        })}

        <line x1={x(nowSlot)} x2={x(nowSlot)} y1={0} y2={rows.length * ROW_HEIGHT} stroke="var(--ink)" strokeDasharray="2 3" />

        {ticks.map((slot) => (
          <text
            key={slot}
            x={x(Math.min(slot, slots))}
            y={rows.length * ROW_HEIGHT + 16}
            fill="var(--dim)"
            fontSize="10"
            textAnchor="middle"
          >
            {clockTime(plan.grid.startMs + slot * slotMs, timezone)}
          </text>
        ))}
      </svg>

      <div className="legend">
        {Object.entries(MODE_COLOUR).map(([mode, colour]) => (
          <span key={mode}>
            <i className="swatch" style={{ background: colour }} /> {mode}
          </span>
        ))}
        <span>darker means more power</span>
      </div>
    </div>
  );
}

/** Total planned site draw per slot against the connection: the flattened peak, or not. */
export function SiteDrawBars({ plan, timezone }: { readonly plan: Plan | null; readonly timezone: string }) {
  if (!plan || plan.siteLoadKw.length === 0) return null;

  const width = 960;
  const height = 150;
  const padLeft = 40;
  const padRight = 10;
  const padTop = 10;
  const plot = 110;
  const slots = plan.siteLoadKw.length;
  const capKw = plan.capKw.length > 0 ? Math.max(...plan.capKw) : Math.max(...plan.siteLoadKw);
  const maxKw = Math.max(capKw * 1.12, ...plan.siteLoadKw) || 1;
  const barWidth = (width - padLeft - padRight) / slots;
  const y = (value: number): number => padTop + plot - (value / maxKw) * plot;
  const ticks = [0, 6, 12, 18, 24].map((hour) => Math.round((hour * 60) / plan.grid.slotMinutes));

  return (
    <div className="chart" style={{ marginTop: 10 }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Planned site draw against the connection">
        {[0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y(maxKw * fraction)}
              y2={y(maxKw * fraction)}
              stroke="var(--line-soft)"
            />
            <text x={padLeft - 8} y={y(maxKw * fraction) + 4} fill="var(--dim)" fontSize="10" textAnchor="end">
              {Math.round(maxKw * fraction)}
            </text>
          </g>
        ))}

        {plan.siteLoadKw.map((value, slot) => (
          <rect
            key={slot}
            x={padLeft + slot * barWidth}
            y={y(value)}
            width={Math.max(1, barWidth - 1)}
            height={Math.max(0, padTop + plot - y(value))}
            fill={value > (plan.capKw[slot] ?? capKw) + 0.01 ? 'var(--red)' : 'rgb(47 158 107 / 0.75)'}
            rx="1.5"
          />
        ))}

        <path
          d={plan.capKw
            .map((value, slot) => `${slot === 0 ? 'M' : 'L'} ${(padLeft + slot * barWidth).toFixed(1)},${y(value).toFixed(1)}`)
            .join(' ')}
          fill="none"
          stroke="var(--red)"
          strokeWidth="1.3"
          strokeDasharray="6 4"
        />

        {ticks.map((slot) => (
          <text
            key={slot}
            x={padLeft + Math.min(slot, slots) * barWidth}
            y={padTop + plot + 16}
            fill="var(--dim)"
            fontSize="10"
            textAnchor="middle"
          >
            {clockTime(plan.grid.startMs + slot * plan.grid.slotMinutes * 60_000, timezone)}
          </text>
        ))}
      </svg>
      <div className="legend">
        <span>
          <i className="swatch" style={{ background: 'rgb(47 158 107 / 0.75)' }} /> planned site draw
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--red)' }} /> planning limit, held below the connection
        </span>
        <span>planned peak {kw(plan.totals.peakKw)} kW</span>
      </div>
    </div>
  );
}
