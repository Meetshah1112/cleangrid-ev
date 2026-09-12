'use client';

import { useState } from 'react';
import type { SceneGeometry } from '../scene/Scene';
import { clockTime, dayLabel } from '../../lib/format';
import type { SessionReport } from '../../lib/types';

/**
 * Carbon, added up session by session as each one finishes, drawn twice across the meadow: what the
 * cars actually emitted under CleanGrid, and what the same energy would have emitted at full power
 * from plug-in. The lines only step up when a session completes, because that is when its figures
 * exist; the space between their ends is the claim, and it is labelled with its real sign.
 */

/** Below this scene width the traces take the whole meadow and the scene leaves out its panels. */
export const COMPACT_WIDTH = 1100;

export interface ProofPoint {
  readonly ms: number;
  readonly report: SessionReport;
  readonly label: string;
  readonly co2Kg: number;
  readonly baselineCo2Kg: number;
}

export interface TraceLayout {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly x: (ms: number) => number;
  readonly y: (kg: number) => number;
  readonly actual: string;
  readonly baseline: string;
  readonly area: string;
  readonly end: { x: number; actualY: number; baselineY: number } | null;
  readonly ticks: readonly { x: number; label: string }[];
}

export function traceLayout(
  points: readonly ProofPoint[],
  geometry: SceneGeometry,
  range: { fromMs: number; toMs: number },
  nowMs: number,
  timezone: string,
): TraceLayout {
  const narrow = geometry.width < 760;
  // Below this width the chart takes the whole meadow: beside the panels it would be too narrow to read.
  const compact = geometry.width < COMPACT_WIDTH;
  const left = compact ? (narrow ? 20 : 40) : Math.max(geometry.width * 0.32, 380);
  // Room at the right end for the two totals, which are labelled where their lines finish.
  const right = geometry.width - (narrow ? 20 : compact ? 40 : Math.max(250, geometry.width * 0.17));
  // Clear of the white wave that opens the next section, which overlaps the foot of this scene.
  const bottom = geometry.height - (narrow ? 74 : 92);
  // The heading above the chart needs open meadow, clear of the lake below the far shore.
  const top = Math.max(geometry.horizonY + (narrow ? 150 : 140), bottom - geometry.height * 0.26);
  const endMs = Math.max(range.fromMs + 3_600_000, Math.min(range.toMs, nowMs > 0 ? nowMs : range.toMs));
  // A period longer than the record starts where the record does, rather than with days of nothing.
  const first = points[0];
  const startMs = first ? Math.max(range.fromMs, Math.min((first.report.pluggedInMs ?? first.ms) - 3_600_000, endMs - 3_600_000)) : range.fromMs;
  const x = (ms: number): number => left + ((ms - startMs) / (endMs - startMs)) * (right - left);
  const last = points[points.length - 1];
  const maxKg = Math.max(1, last ? Math.max(last.co2Kg, last.baselineCo2Kg) * 1.18 : 1);
  const y = (kg: number): number => bottom - (kg / maxKg) * (bottom - top);

  const steps = (pick: (point: ProofPoint) => number): string => {
    let d = `M${left.toFixed(1)},${bottom.toFixed(1)}`;
    let level = bottom;
    for (const point of points) {
      const px = x(point.ms);
      d += ` L${px.toFixed(1)},${level.toFixed(1)}`;
      level = y(pick(point));
      d += ` L${px.toFixed(1)},${level.toFixed(1)}`;
    }
    return `${d} L${x(endMs).toFixed(1)},${level.toFixed(1)}`;
  };
  const actual = steps((point) => point.co2Kg);

  const span = endMs - startMs;
  // The shortest round step whose labels stand at least 72px apart, so no two times overlap.
  const hourPx = ((right - left) / span) * 3_600_000;
  const every = ([2, 4, 6, 8, 12, 24, 48, 72, 120, 168, 240].find((hours) => hours * hourPx >= 72) ?? 240) * 3_600_000;
  const ticks: { x: number; label: string }[] = [];
  for (let ms = Math.ceil(startMs / every) * every; ms <= endMs; ms += every) {
    ticks.push({ x: x(ms), label: every < 86_400_000 ? clockTime(ms, timezone) : dayLabel(ms, timezone) });
  }

  return {
    left,
    right,
    top,
    bottom,
    x,
    y,
    actual,
    baseline: steps((point) => point.baselineCo2Kg),
    area: `${actual} L${x(endMs).toFixed(1)},${bottom} Z`,
    end: last ? { x: x(endMs), actualY: y(last.co2Kg), baselineY: y(last.baselineCo2Kg) } : null,
    ticks,
  };
}

export function ProofTracesLayer({ layout }: { readonly layout: TraceLayout }) {
  return (
    <g className="proof-trace" aria-hidden="true">
      <line x1={layout.left} x2={layout.right} y1={layout.bottom + 0.5} y2={layout.bottom + 0.5} className="draw-ground" />
      <path d={layout.area} className="proof-trace-area" />
      <path d={layout.baseline} className="proof-trace-baseline" />
      <path d={layout.actual} className="proof-trace-actual" />
      {layout.end ? (
        <line x1={layout.end.x + 14} x2={layout.end.x + 14} y1={layout.end.baselineY} y2={layout.end.actualY} className="proof-trace-bridge" />
      ) : null}
    </g>
  );
}

export function ProofTracesOverlay({
  layout,
  points,
  geometry,
  timezone,
  totals,
}: {
  readonly layout: TraceLayout;
  readonly points: readonly ProofPoint[];
  readonly geometry: SceneGeometry;
  readonly timezone: string;
  readonly totals: { readonly co2Kg: number; readonly baselineCo2Kg: number; readonly cut: string };
}) {
  const [hover, setHover] = useState<ProofPoint | null>(null);
  const narrow = geometry.width < 760;
  const compact = geometry.width < COMPACT_WIDTH;
  const avoided = totals.baselineCo2Kg - totals.co2Kg;

  const pick = (clientX: number, box: DOMRect): void => {
    const px = clientX - box.left + layout.left;
    let best: ProofPoint | null = null;
    for (const point of points) if (!best || Math.abs(layout.x(point.ms) - px) < Math.abs(layout.x(best.ms) - px)) best = point;
    setHover(best);
  };

  if (points.length === 0) {
    return (
      <p className="draw-label is-wrapping" style={{ left: layout.left, top: layout.bottom - 56, maxWidth: layout.right - layout.left }}>
        No session has finished in this period yet. Choose a longer period for its proof.
      </p>
    );
  }

  return (
    <>
      <div className="draw-head proof-head" style={{ left: layout.left, top: layout.top - (narrow ? 100 : 92) }}>
        <p className="draw-title">Measured emissions by charging strategy</p>
        <p className="proof-claim">
          <strong>{Math.abs(avoided).toFixed(1)} kg CO₂</strong> {avoided >= 0 ? 'avoided' : 'more than the baseline'}, {totals.cut}
        </p>
        <p className="draw-facts">
          <span>added up as each session finished</span>
          <span>same energy, same fleet, same deadlines</span>
        </p>
      </div>

      {layout.end && !compact ? (
        // Both totals stand together at the end of the lines, higher first, so they never overlap
        // even when the two lines finish a pixel apart.
        <div
          className="trace-ends"
          style={{ left: layout.end.x + 22, top: Math.min(layout.end.baselineY, layout.end.actualY) - 20 }}
        >
          {[
            { key: 'baseline', y: layout.end.baselineY, label: 'Charge immediately', kg: totals.baselineCo2Kg },
            { key: 'actual', y: layout.end.actualY, label: 'CleanGrid plan', kg: totals.co2Kg },
          ]
            .sort((a, b) => a.y - b.y)
            .map((end) => (
              <p key={end.key} className={`trace-end is-${end.key}`}>
                {end.label} <strong>{end.kg.toFixed(1)} kg</strong>
              </p>
            ))}
        </div>
      ) : null}

      <div
        className="proof-hit"
        style={{ left: layout.left, top: layout.top, width: layout.right - layout.left, height: layout.bottom - layout.top }}
        onMouseMove={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setHover(null)}
        aria-hidden="true"
      />
      {hover ? (
        <>
          <span className="fchart-cross" style={{ left: layout.x(hover.ms), top: layout.top, height: layout.bottom - layout.top }} />
          <div
            className="fchart-tip proof-tip"
            style={{
              left: Math.max(8, layout.x(hover.ms) + 300 > geometry.width ? layout.x(hover.ms) - 294 : layout.x(hover.ms) + 14),
              top: layout.top + 8,
            }}
            role="status"
          >
            <strong>
              {hover.label}, finished {clockTime(hover.ms, timezone)} {dayLabel(hover.ms, timezone)}
            </strong>
            <span>
              {hover.report.energyKwh.toFixed(1)} kWh at {Math.round(hover.report.avgCarbonGPerKwh)} gCO₂/kWh
            </span>
            <span>
              {hover.report.co2Kg.toFixed(2)} kg against {hover.report.baselineCo2Kg.toFixed(2)} kg charging on plug-in
            </span>
            <em>{hover.report.verified ? '✓ Meter-verified' : 'Estimated: the meter did not cover the whole session'}</em>
          </div>
        </>
      ) : null}

      {layout.ticks.map((tick, index) => (
        <span key={`${tick.label}-${index}`} className="draw-tick" style={{ left: tick.x, top: layout.bottom + 8 }}>
          {tick.label}
        </span>
      ))}
    </>
  );
}
