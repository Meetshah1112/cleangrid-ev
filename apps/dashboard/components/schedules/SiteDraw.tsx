'use client';

import type { SceneGeometry } from '../scene/Scene';
import { useOffsetBox, type OffsetBox } from '../scene/useOffsetBox';
import { clockTime, kw } from '../../lib/format';
import type { Plan } from '../../lib/types';

/**
 * The plan's total draw, grown out of the meadow under the day it happens in.
 *
 * One bar per fifteen-minute block, against the planning limit drawn as a dashed line. A block the
 * plan puts above that limit is drawn in coral and labelled, because a cap exception is exactly the
 * thing this picture must not make look calm. Blocks already behind now are faded.
 */

export interface DrawLayout {
  /** `y` and `h` are the whole block; `baseY` is where the building's own load ends and charging begins. */
  readonly bars: readonly { x: number; y: number; w: number; h: number; baseY: number; over: boolean; past: boolean }[];
  readonly capPath: string;
  readonly baseline: number;
  readonly top: number;
  readonly y: (kw: number) => number;
  readonly peak: { x: number; y: number; kw: number };
  readonly capKw: number;
  readonly overCount: number;
  readonly ticks: readonly { x: number; label: string }[];
}

export function drawLayout(plan: Plan | null, geometry: SceneGeometry, nowMs: number, timezone: string): DrawLayout | null {
  if (!plan || plan.siteLoadKw.length === 0) return null;
  const slots = plan.siteLoadKw.length;
  const slotMs = plan.grid.slotMinutes * 60_000;
  const narrow = geometry.width < 760;
  const baseline = geometry.height - (narrow ? 30 : 40);
  // Clear of the lake: the chart's heading sits in open meadow below the far shore.
  const chartH = Math.min(geometry.height * (narrow ? 0.18 : 0.2), baseline - geometry.horizonY - 110);
  const top = baseline - chartH;
  const capKw = plan.capKw.length > 0 ? Math.max(...plan.capKw) : Math.max(...plan.siteLoadKw);
  const maxKw = Math.max(capKw * 1.12, ...plan.siteLoadKw, 1);
  const y = (value: number): number => baseline - (value / maxKw) * chartH;
  const x = (slot: number): number => geometry.x(plan.grid.startMs + slot * slotMs);
  const gap = geometry.width / slots > 6 ? 2 : 1;

  let peakSlot = 0;
  const bars = plan.siteLoadKw.map((value, slot) => {
    if (value > (plan.siteLoadKw[peakSlot] ?? 0)) peakSlot = slot;
    const left = x(slot);
    const w = Math.max(1, x(slot + 1) - left - gap);
    return {
      x: left,
      y: y(value),
      w,
      h: Math.max(0, baseline - y(value)),
      baseY: y(Math.min(value, plan.baseLoadKw[slot] ?? 0)),
      over: value > (plan.capKw[slot] ?? capKw) + 0.01,
      past: nowMs > 0 && plan.grid.startMs + (slot + 1) * slotMs <= nowMs,
    };
  });

  const capPath = plan.capKw
    .map((value, slot) => `${slot === 0 ? 'M' : 'L'}${x(slot).toFixed(1)},${y(value).toFixed(1)} L${x(slot + 1).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ');

  const every = narrow ? 12 : 6;
  const ticks = Array.from({ length: Math.floor(24 / every) + 1 }, (_, index) => index * every)
    .map((hour) => Math.round((hour * 60) / plan.grid.slotMinutes))
    .filter((slot) => slot <= slots)
    .map((slot) => ({ x: x(slot), label: clockTime(plan.grid.startMs + slot * slotMs, timezone) }));

  return {
    bars,
    capPath,
    baseline,
    top,
    y,
    peak: { x: x(peakSlot) + (bars[peakSlot]?.w ?? 0) / 2, y: y(plan.siteLoadKw[peakSlot] ?? 0), kw: plan.totals.peakKw },
    capKw,
    overCount: bars.filter((bar) => bar.over).length,
    ticks,
  };
}

export function SiteDrawLayer({ layout, width }: { readonly layout: DrawLayout; readonly width: number }) {
  return (
    <g className="draw" aria-hidden="true">
      <line x1="0" x2={width} y1={layout.baseline + 0.5} y2={layout.baseline + 0.5} className="draw-ground" />
      {layout.bars.map((bar, index) => (
        <g key={index} className={`draw-block${bar.over ? ' is-over' : ''}${bar.past ? ' is-past' : ''}`}>
          <rect x={bar.x} y={bar.baseY} width={bar.w} height={Math.max(0, layout.baseline - bar.baseY)} className="draw-base" />
          <rect x={bar.x} y={bar.y} width={bar.w} height={Math.max(0, bar.baseY - bar.y)} rx={Math.min(2, bar.w / 2)} className="draw-bar" />
        </g>
      ))}
      <path d={layout.capPath} className="draw-cap-halo" />
      <path d={layout.capPath} className="draw-cap" />
    </g>
  );
}

/**
 * Where the planned-peak label goes: centred over the tallest block, unless that puts it on the
 * chart's heading, which happens whenever the peak comes early in the day and reaches the top of the
 * chart. Then it moves right, level with the peak, until it clears the heading, and only drops below
 * the heading when there is no room to the right. `x` is the label's centre and `y` its bottom edge.
 */
function peakPosition(layout: DrawLayout, width: number, centre: number, head: OffsetBox | null, label: OffsetBox | null): { x: number; y: number } {
  const y = layout.peak.y - 8;
  if (!head || !label) return { x: centre, y };
  const gap = 12;
  const overlaps = (x: number, bottom: number): boolean =>
    x + label.width / 2 + gap > head.left &&
    x - label.width / 2 - gap < head.left + head.width &&
    bottom > head.top - gap / 2 &&
    bottom - label.height < head.top + head.height + gap / 2;
  if (!overlaps(centre, y)) return { x: centre, y };
  const beside = head.left + head.width + gap + label.width / 2;
  if (beside + label.width / 2 <= width - 8) return { x: Math.max(centre, beside), y };
  return { x: centre, y: head.top + head.height + gap + label.height };
}

export function SiteDrawOverlay({
  layout,
  plan,
  geometry,
  connectionKw,
  scheduled,
  timezone,
}: {
  readonly layout: DrawLayout;
  readonly plan: Plan;
  readonly geometry: SceneGeometry;
  readonly connectionKw: number | null;
  readonly scheduled: number;
  readonly timezone: string;
}) {
  const head = useOffsetBox<HTMLDivElement>();
  const peakLabel = useOffsetBox<HTMLParagraphElement>();
  const clampX = (px: number): number => Math.min(Math.max(px, 110), geometry.width - 130);
  const capLabel =
    connectionKw !== null && Math.abs(connectionKw - layout.capKw) > 0.5
      ? `${kw(layout.capKw, 0)} kW planning limit, held below the ${kw(connectionKw, 0)} kW connection`
      : `${kw(layout.capKw, 0)} kW connection`;
  const peak = peakPosition(layout, geometry.width, clampX(layout.peak.x), head.box, peakLabel.box);

  return (
    <>
      <div className="draw-head" ref={head.ref} style={{ top: layout.top - 54 }}>
        <p className="draw-title">Site draw after optimisation</p>
        <p className="draw-facts">
          <span>
            {scheduled} car{scheduled === 1 ? '' : 's'} scheduled
          </span>
          <span>solved {clockTime(plan.solvedMs, timezone)}</span>
          {layout.overCount > 0 ? (
            <span className="is-over">
              {layout.overCount} block{layout.overCount === 1 ? '' : 's'} above the limit
            </span>
          ) : null}
        </p>
      </div>

      <p className="draw-label is-cap" style={{ right: 'var(--page-x)', top: layout.y(layout.capKw) - 24 }}>
        {capLabel}
      </p>
      <p className="draw-label is-peak" ref={peakLabel.ref} style={{ left: peak.x, top: peak.y }}>
        planned peak <strong>{kw(layout.peak.kw)} kW</strong>
      </p>

      {layout.ticks.map((tick, index) => (
        <span key={`${tick.label}-${index}`} className="draw-tick" style={{ left: Math.min(Math.max(tick.x, 22), geometry.width - 22), top: layout.baseline + 8 }}>
          {tick.label}
        </span>
      ))}
    </>
  );
}
