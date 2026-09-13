'use client';

import { useMemo, useState } from 'react';
import { useSize } from '../scene/useSize';
import { css, localHour, mix, skyAt } from '../scene/sky';
import { clockTime, modeLabel } from '../../lib/format';
import { slotAt } from '../../lib/planRead';
import type { Plan, Session } from '../../lib/types';

/**
 * The plan as a river of fine ribbons, one per car, across the same day the valley above shows.
 *
 * A faint thread runs through each car's parked window, from plug-in to its deadline tick. On it, a
 * ribbon appears only where power is planned, deeper where more of it flows, in the colour of what
 * the driver asked for. Above the ribbons runs a strip of the day's own sky, so a block of charging
 * reads as noon or as the small hours without anyone doing the arithmetic.
 *
 * Every block inside the window is always drawn, at zero opacity when nothing is planned, so a
 * re-solve fades the blocks that changed from the old allocation to the new one and leaves the rest
 * alone. Blocks behind now are greyed; the block binding the chargers right now is drawn strongest.
 */

export const MODE_COLOUR: Record<string, string> = {
  greenest: 'var(--canopy)',
  cheapest: 'var(--sun)',
  balanced: 'var(--cyan-ink)',
  fastest: 'var(--forest)',
};

const PAD_RIGHT = 20;
const ROW = 40;
const SKY = 20;
const HEAD = 30;
const TIP_W = 330;
/** A 12px semibold character, slightly generous, for placing labels before the browser has drawn them. */
const CHAR_W = 7;
const WINDOW_TEXT = 'clean window';

type Anchor = 'start' | 'middle' | 'end';
interface SkyLabel {
  readonly x: number;
  readonly anchor: Anchor;
}

/**
 * Where the two labels under the sky strip go: "now" beside its line, "clean window" over its band.
 *
 * They share one line of height, and a clean window that ends near now put one on top of the other.
 * Each has a few acceptable places, tried in order of preference; the first pair that fits inside the
 * plot without touching wins. If none does, the band goes unlabelled rather than illegible, since
 * its tint and the link that brought the operator here already say what it is.
 */
function placeSkyLabels(
  window: { readonly x0: number; readonly x1: number } | null,
  nowX: number | null,
  nowText: string,
  left: number,
  right: number,
): { readonly window: SkyLabel | null; readonly now: SkyLabel | null } {
  const extent = (label: SkyLabel, width: number): [number, number] =>
    label.anchor === 'start' ? [label.x, label.x + width] : label.anchor === 'end' ? [label.x - width, label.x] : [label.x - width / 2, label.x + width / 2];
  const fits = (label: SkyLabel, width: number): boolean => {
    const [from, to] = extent(label, width);
    return from >= left - 2 && to <= right + 2;
  };
  const apart = (a: SkyLabel, aw: number, b: SkyLabel, bw: number): boolean => {
    const [a0, a1] = extent(a, aw);
    const [b0, b1] = extent(b, bw);
    return a1 + 8 <= b0 || b1 + 8 <= a0;
  };

  const nowW = nowText.length * CHAR_W;
  const windowW = WINDOW_TEXT.length * CHAR_W;
  const nowOptions: SkyLabel[] = nowX === null ? [] : [{ x: nowX + 6, anchor: 'start' as const }, { x: nowX - 6, anchor: 'end' as const }].filter((option) => fits(option, nowW));
  const windowOptions: SkyLabel[] =
    window === null
      ? []
      : [
          { x: (window.x0 + window.x1) / 2, anchor: 'middle' as const },
          { x: window.x0 + 6, anchor: 'start' as const },
          { x: window.x1 - 6, anchor: 'end' as const },
        ].filter((option) => fits(option, windowW));

  const now = nowOptions[0] ?? null;
  if (windowOptions.length === 0) return { window: null, now };
  if (nowOptions.length === 0) return { window: windowOptions[0] ?? null, now: null };
  for (const nowOption of nowOptions) {
    const clear = windowOptions.find((option) => apart(option, windowW, nowOption, nowW));
    if (clear) return { window: clear, now: nowOption };
  }
  return { window: null, now };
}

export function PlanRiver({
  plan,
  sessions,
  nowMs,
  timezone,
  selectedId,
  onSelect,
  highlight,
}: {
  readonly plan: Plan | null;
  readonly sessions: readonly Session[];
  readonly nowMs: number;
  readonly timezone: string;
  readonly selectedId: string | null;
  readonly onSelect: (sessionId: string) => void;
  /** A window to mark, when the forecast page sent the operator here with one. */
  readonly highlight: { readonly startMs: number; readonly endMs: number } | null;
}) {
  const { ref, size } = useSize<HTMLDivElement>({ width: 1200, height: 300 });
  const [hovered, setHovered] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!plan) return [];
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return Object.entries(plan.allocationsKw)
      .map(([sessionId, powers]) => ({ sessionId, powers, session: byId.get(sessionId) ?? null }))
      .filter((row) => row.powers.some((value) => value > 0.01) || row.session?.status === 'active')
      .sort((a, b) => (a.session?.deadlineMs ?? Infinity) - (b.session?.deadlineMs ?? Infinity));
  }, [plan, sessions]);

  if (!plan) return <p className="empty">No plan yet. The optimiser solves as soon as a car plugs in.</p>;

  const narrow = size.width < 700;
  const padLeft = narrow ? 92 : 176;
  const slots = plan.grid.slots;
  const slotMs = plan.grid.slotMinutes * 60_000;
  const plotW = Math.max(1, size.width - padLeft - PAD_RIGHT);
  const slotW = plotW / slots;
  const x = (slot: number): number => padLeft + Math.max(0, Math.min(slots, slot)) * slotW;
  const bodyTop = SKY + HEAD;
  const height = bodyTop + Math.max(1, rows.length) * ROW + 30;
  const nowSlot = nowMs > 0 ? (nowMs - plan.grid.startMs) / slotMs : 0;
  const bindingSlot = Math.max(0, Math.floor(nowSlot));
  const startHour = localHour(plan.grid.startMs, timezone);
  const spanHours = (slots * slotMs) / 3_600_000;
  const skyStops = Array.from({ length: 13 }, (_, index) => {
    const sky = skyAt(startHour + (index / 12) * spanHours);
    return { offset: index / 12, colour: css(mix(sky.zenith, sky.horizon, 0.55)) };
  });
  const every = narrow ? 8 : 4;
  const ticks = Array.from({ length: Math.floor(24 / every) + 1 }, (_, index) => Math.round((index * every * 60) / plan.grid.slotMinutes)).filter(
    (slot) => slot <= slots,
  );
  const shown = rows.find((row) => row.sessionId === hovered) ?? null;
  // The tip sits on the car's own row, beside its ribbon, so it never covers another car's plan.
  const tip = (() => {
    if (!shown) return null;
    const first = shown.powers.findIndex((power) => power > 0.01);
    const last = shown.powers.length - 1 - [...shown.powers].reverse().findIndex((power) => power > 0.01);
    const end = shown.session ? Math.max(x(last + 1), x((shown.session.deadlineMs - plan.grid.startMs) / slotMs)) : x(last + 1);
    const room = size.width - end - 16;
    const left = first < 0 ? padLeft : room >= TIP_W || size.width < TIP_W + padLeft ? end + 16 : Math.max(0, x(first) - 16 - TIP_W);
    return { left: Math.min(left, Math.max(0, size.width - TIP_W)), top: bodyTop + rows.indexOf(shown) * ROW + ROW / 2 };
  })();
  const highlightSpan = highlight ? { x0: x((highlight.startMs - plan.grid.startMs) / slotMs), x1: x((highlight.endMs - plan.grid.startMs) / slotMs) } : null;
  const nowShown = nowMs > 0 && nowSlot >= 0 && nowSlot <= slots;
  const nowText = `now ${clockTime(nowMs, timezone)}`;
  const skyLabels = placeSkyLabels(
    highlightSpan && highlightSpan.x1 > highlightSpan.x0 ? highlightSpan : null,
    nowShown ? x(nowSlot) : null,
    nowText,
    padLeft,
    padLeft + plotW,
  );

  return (
    <div className="river" ref={ref} style={{ height }}>
      <svg width={size.width} height={height} viewBox={`0 0 ${size.width} ${height}`} role="group" aria-label="Planned charging, one ribbon per car">
        <defs>
          <linearGradient id="river-sky" x1={padLeft} x2={padLeft + plotW} y1="0" y2="0" gradientUnits="userSpaceOnUse">
            {skyStops.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={stop.colour} />
            ))}
          </linearGradient>
        </defs>
        <rect x={padLeft} y="0" width={plotW} height={SKY} rx={SKY / 2} fill="url(#river-sky)" />

        {highlightSpan && highlightSpan.x1 > highlightSpan.x0 ? (
          <g className="river-window">
            <rect x={highlightSpan.x0} y={SKY + 4} width={highlightSpan.x1 - highlightSpan.x0} height={height - SKY - 30} rx="8" />
            {skyLabels.window ? (
              <text x={skyLabels.window.x} y={SKY + 20} textAnchor={skyLabels.window.anchor}>
                {WINDOW_TEXT}
              </text>
            ) : null}
          </g>
        ) : null}

        {rows.length === 0 ? (
          <text x={padLeft} y={bodyTop + 22} className="river-empty">
            Nothing is scheduled: no car on site needs energy right now.
          </text>
        ) : null}

        {rows.map((row, index) => {
          const top = bodyTop + index * ROW;
          const mid = top + ROW / 2;
          const colour = MODE_COLOUR[row.session?.mode ?? 'balanced'] ?? 'var(--canopy)';
          const maxKw = Math.max(1, row.session?.maxPowerKw ?? Math.max(...row.powers));
          const name = row.session ? (row.session.driverName ?? row.session.idTag) : row.sessionId.slice(0, 6);
          const from = row.session ? Math.max(0, slotAt(plan, row.session.pluggedInMs)) : 0;
          const to = row.session ? Math.min(slots, Math.ceil((row.session.deadlineMs - plan.grid.startMs) / slotMs)) : slots;
          const selected = selectedId === row.sessionId;
          return (
            <g
              key={row.sessionId}
              className={`river-row${selected ? ' is-selected' : ''}${hovered === row.sessionId ? ' is-hovered' : ''}${row.session?.deadlineRisk ? ' is-risk' : ''}`}
              tabIndex={0}
              role="button"
              aria-pressed={selected}
              aria-label={`${name}, ${row.session?.chargerId ?? ''}, ${modeLabel[row.session?.mode ?? 'balanced']}, ready by ${row.session ? clockTime(row.session.deadlineMs, timezone) : 'unknown'}`}
              onMouseEnter={() => setHovered(row.sessionId)}
              onMouseLeave={() => setHovered((current) => (current === row.sessionId ? null : current))}
              onFocus={() => setHovered(row.sessionId)}
              onBlur={() => setHovered((current) => (current === row.sessionId ? null : current))}
              onClick={() => onSelect(row.sessionId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(row.sessionId);
                }
              }}
            >
              <rect x="0" y={top + 2} width={size.width} height={ROW - 4} rx="10" className="river-hit" />
              <text x="10" y={narrow ? mid + 4 : mid - 3} className="river-label">
                {narrow ? name.split(' ')[0] : name}
              </text>
              {!narrow ? (
                <text x="10" y={mid + 13} className="river-sub">
                  {row.session?.chargerId ?? ''}
                </text>
              ) : null}
              <line x1={x(from)} x2={x(to)} y1={mid} y2={mid} className="river-thread" />
              {row.session && to <= slots ? <line x1={x(to)} x2={x(to)} y1={mid - 8} y2={mid + 8} className="river-deadline" /> : null}
              {Array.from({ length: Math.max(0, to - from) }, (_, offset) => {
                const slot = from + offset;
                const power = row.powers[slot] ?? 0;
                const on = power > 0.01;
                const past = slot + 1 <= nowSlot;
                const intensity = 0.3 + 0.7 * Math.min(1, power / maxKw);
                return (
                  <rect
                    key={slot}
                    x={x(slot)}
                    y={mid - (slot === bindingSlot && on ? 6 : 4.5)}
                    width={slotW + 0.6}
                    height={slot === bindingSlot && on ? 12 : 9}
                    className={`river-block${past ? ' is-past' : ''}`}
                    style={{ fill: colour, fillOpacity: on ? (past ? 0.22 : intensity) : 0 }}
                  />
                );
              })}
            </g>
          );
        })}

        {nowShown ? (
          <g className="river-now">
            <line x1={x(nowSlot)} x2={x(nowSlot)} y1={SKY + 6} y2={bodyTop + rows.length * ROW} />
            {skyLabels.now ? (
              <text x={skyLabels.now.x} y={SKY + 20} textAnchor={skyLabels.now.anchor}>
                {nowText}
              </text>
            ) : null}
          </g>
        ) : null}

        {ticks.map((slot) => (
          <text key={slot} x={x(slot)} y={height - 8} className={`chart-tick${slot === 0 ? '' : slot === slots ? ' is-end' : ' is-middle'}`}>
            {clockTime(plan.grid.startMs + slot * slotMs, timezone)}
          </text>
        ))}
      </svg>

      {shown?.session && tip ? (
        <div className="river-tip" style={{ left: tip.left, top: tip.top, width: TIP_W }} role="status">
          <strong>
            {shown.session.driverName ?? shown.session.idTag}, {shown.session.chargerId}
          </strong>
          <span>
            {shown.session.energyDeliveredKwh.toFixed(1)} of {shown.session.energyNeededKwh.toFixed(1)} kWh, {modeLabel[shown.session.mode]?.toLowerCase()}, ready
            by {clockTime(shown.session.deadlineMs, timezone)}
          </span>
          <span>{plannedBlocks(shown.powers, plan.grid.startMs, slotMs, timezone)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Planned charging as the handful of time ranges a person would quote. */
export function plannedBlocks(powers: readonly number[], startMs: number, slotMs: number, timezone: string): string {
  const ranges: string[] = [];
  let open: number | null = null;
  powers.forEach((power, slot) => {
    const on = power > 0.01;
    if (on && open === null) open = slot;
    const closes = open !== null && (!on || slot === powers.length - 1);
    if (closes && open !== null) {
      const end = on ? slot + 1 : slot;
      ranges.push(`${clockTime(startMs + open * slotMs, timezone)} to ${clockTime(startMs + end * slotMs, timezone)}`);
      open = null;
    }
  });
  if (ranges.length === 0) return 'No charging planned';
  return `Charging ${ranges.slice(0, 3).join(', ')}${ranges.length > 3 ? `, and ${ranges.length - 3} more blocks` : ''}`;
}
