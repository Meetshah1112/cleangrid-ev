'use client';

import type { SceneGeometry } from '../scene/Scene';
import { clockTime, kw } from '../../lib/format';
import type { Demand, FlexEvent, Plan } from '../../lib/types';

/**
 * The site's draw as one line across the valley: measured up to now, planned after it.
 *
 * With a request in force, the window it covers is marked with the page's one coral signal, the cap
 * is drawn inside it, and the line is left to show what the site actually did about it. Nothing is
 * drawn as though the site complied before the plan or the meter says it did.
 */

export interface PathLayout {
  readonly baseline: number;
  readonly top: number;
  readonly y: (kw: number) => number;
  readonly measured: string | null;
  readonly planned: string | null;
  readonly plannedArea: string | null;
  readonly connectionY: number;
  readonly window: { x0: number; x1: number; capY: number } | null;
  readonly endY: number | null;
  readonly ticks: readonly { x: number; label: string }[];
}

export function pathLayout(input: {
  readonly geometry: SceneGeometry;
  readonly startMs: number;
  readonly spanMs: number;
  readonly nowMs: number;
  readonly demand: Demand | null;
  readonly plan: Plan | null;
  readonly connectionKw: number;
  readonly event: FlexEvent | null;
  readonly timezone: string;
}): PathLayout {
  const { geometry, startMs, spanMs, nowMs, demand, plan, connectionKw, event } = input;
  const narrow = geometry.width < 760;
  const baseline = geometry.height - (narrow ? 30 : 40);
  const chartH = Math.min(geometry.height * (narrow ? 0.17 : 0.2), baseline - geometry.horizonY - 110);
  const endMs = startMs + spanMs;

  const past = (demand?.intervals ?? [])
    .filter((interval) => interval.startMs >= startMs && interval.startMs < nowMs)
    .map((interval) => ({ ms: interval.startMs + ((demand?.stepMinutes ?? 15) * 60_000) / 2, kw: interval.totalKw }));
  const slotMs = (plan?.grid.slotMinutes ?? 15) * 60_000;
  const ahead = (plan?.siteLoadKw ?? [])
    .map((value, slot) => ({ ms: (plan?.grid.startMs ?? 0) + slot * slotMs + slotMs / 2, kw: value }))
    .filter((point) => point.ms >= nowMs - slotMs / 2 && point.ms <= endMs);

  const maxKw = Math.max(connectionKw * 1.08, ...past.map((point) => point.kw), ...ahead.map((point) => point.kw), 1);
  const y = (value: number): number => baseline - (Math.max(0, value) / maxKw) * chartH;
  const line = (points: readonly { ms: number; kw: number }[]): string | null =>
    points.length < 2 ? null : points.map((point, index) => `${index === 0 ? 'M' : 'L'}${geometry.x(point.ms).toFixed(1)},${y(point.kw).toFixed(1)}`).join(' ');

  const planned = line(ahead);
  const first = ahead[0];
  const last = ahead[ahead.length - 1];
  const plannedArea = planned && first && last ? `${planned} L${geometry.x(last.ms).toFixed(1)},${baseline} L${geometry.x(first.ms).toFixed(1)},${baseline} Z` : null;

  const inFrame = event && event.endsMs > startMs && event.startsMs < endMs;
  const hourMs = 3_600_000;
  const every = spanMs > 10 * hourMs || narrow ? 3 * hourMs : 2 * hourMs;
  const ticks = [];
  for (let ms = Math.ceil(startMs / every) * every; ms <= endMs; ms += every) {
    ticks.push({ x: geometry.x(ms), label: clockTime(ms, input.timezone) });
  }

  const afterEnd = event ? ahead.find((point) => point.ms >= event.endsMs) : undefined;

  return {
    baseline,
    top: baseline - chartH,
    y,
    measured: line(past),
    planned,
    plannedArea,
    connectionY: y(connectionKw),
    window: inFrame && event ? { x0: Math.max(0, geometry.x(event.startsMs)), x1: Math.min(geometry.width, geometry.x(event.endsMs)), capY: y(event.capKw) } : null,
    endY: afterEnd ? y(afterEnd.kw) : null,
    ticks,
  };
}

export function ResponsePathLayer({ layout, width, nowX }: { readonly layout: PathLayout; readonly width: number; readonly nowX: number | null }) {
  return (
    <g className="path" aria-hidden="true">
      <line x1="0" x2={width} y1={layout.baseline + 0.5} y2={layout.baseline + 0.5} className="draw-ground" />
      <line x1="0" x2={width} y1={layout.connectionY} y2={layout.connectionY} className="path-connection" />
      {layout.window ? (
        <g className="path-window">
          <rect x={layout.window.x0} y={layout.top - 26} width={Math.max(2, layout.window.x1 - layout.window.x0)} height={layout.baseline - layout.top + 26} />
          <line x1={layout.window.x0} x2={layout.window.x0} y1={layout.top - 26} y2={layout.baseline} className="path-call" />
          <line x1={layout.window.x0} x2={layout.window.x1} y1={layout.window.capY} y2={layout.window.capY} className="path-cap" />
        </g>
      ) : null}
      {layout.plannedArea ? <path d={layout.plannedArea} className="path-area" /> : null}
      {layout.measured ? <path d={layout.measured} className="path-measured" /> : null}
      {layout.planned ? <path d={layout.planned} className="path-planned" /> : null}
      {nowX !== null ? <line x1={nowX} x2={nowX} y1={layout.top - 10} y2={layout.baseline} className="horizon-now" /> : null}
    </g>
  );
}

export function ResponsePathOverlay({
  layout,
  geometry,
  event,
  releasedKw,
  connectionKw,
  timezone,
}: {
  readonly layout: PathLayout;
  readonly geometry: SceneGeometry;
  readonly event: FlexEvent | null;
  readonly releasedKw: number;
  readonly connectionKw: number;
  readonly timezone: string;
}) {
  const clampX = (px: number): number => Math.min(Math.max(px, 90), geometry.width - 110);
  const narrow = geometry.width < 760;
  return (
    <>
      <div className="draw-head" style={{ top: layout.top - 54 }}>
        <p className="draw-title">{event ? 'The response, as it happens' : 'Site draw, measured then planned'}</p>
        <p className="draw-facts">
          <span>{kw(connectionKw, 0)} kW connection</span>
          {geometry.nowX !== null ? <span>white is metered, green is the plan</span> : null}
        </p>
      </div>

      {event && layout.window ? (
        // A one-hour window is narrow against the day, so the call and what it releases stand to its
        // left and the resumption to its right, where neither can land on the other.
        (() => {
          // Left of the window only when that clears the chart's own heading.
          const roomLeft = !narrow && layout.window.x0 > 480;
          const top = narrow ? layout.top + 6 : layout.top - 22;
          const stackStyle = roomLeft
            ? { right: geometry.width - layout.window.x0 + 10, top }
            : { left: Math.min(layout.window.x1 + 10, geometry.width - 190), top };
          return (
            <>
              <div className={`draw-callout${roomLeft ? '' : ' is-right'}`} style={stackStyle}>
                <p>
                  network calls <strong className="is-call">{clockTime(event.startsMs, timezone)}</strong>
                </p>
                <p>
                  CleanGrid releases <strong>{kw(releasedKw)} kW</strong>
                </p>
              </div>
              {roomLeft && layout.endY !== null && layout.window.x1 < geometry.width - 170 ? (
                <p className="draw-label" style={{ left: layout.window.x1 + 10, top: layout.top - 22 }}>
                  cars resume <strong>{clockTime(event.endsMs, timezone)}</strong>
                </p>
              ) : null}
            </>
          );
        })()
      ) : null}

      {layout.ticks.map((tick, index) => (
        <span key={`${tick.label}-${index}`} className="draw-tick" style={{ left: Math.min(Math.max(tick.x, 22), geometry.width - 22), top: layout.baseline + 8 }}>
          {tick.label}
        </span>
      ))}
    </>
  );
}
