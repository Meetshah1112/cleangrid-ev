'use client';

import type { SceneGeometry } from '../scene/Scene';
import type { Forecast } from '../../lib/types';

/**
 * The next day's energy, drawn as part of the valley.
 *
 * Lime is renewable availability: a stepped ridge whose height is the share of the grid running on
 * renewables in each half hour. The fine white arc is how clean the grid is, carbon intensity read
 * upside down so that higher means cleaner. Where the renewable ridge is falling towards evening it
 * turns pale cyan, because that is solar leaving. Hours already gone are faded, and the next clean
 * window, the one the scheduler is aiming at, is drawn brighter than the rest.
 *
 * Nothing here is invented to fill the scene: where the forecast has no value, nothing is drawn.
 */

export interface HorizonLayout {
  readonly baseline: number;
  readonly steps: readonly { readonly x0: number; readonly x1: number; readonly top: number; readonly fading: boolean; readonly ms: number; readonly share: number }[];
  readonly clean: string;
  readonly windowSpan: { readonly x0: number; readonly x1: number } | null;
  readonly ticks: readonly { readonly x: number; readonly label: string }[];
  /** The renewable share at the moment the now marker sits on. */
  readonly shareNow: number | null;
  readonly topNow: number | null;
}

// Heights as shares of the scene, kept low enough that the tallest reading stays clear of the copy above.
const PEAK = 0.24;
const ARC = 0.22;

export function horizonLayout(forecast: Forecast | null, geometry: SceneGeometry): HorizonLayout | null {
  if (!forecast || forecast.renewableShare.length < 2) return null;
  const { width, height, horizonY, x, hourAt, nowX } = geometry;
  const baseline = horizonY + height * 0.025;
  const stepMs = forecast.stepMinutes * 60_000;

  const steps = forecast.renewableShare
    .map((share, index) => {
      const ms = forecast.startMs + index * stepMs;
      const x0 = x(ms);
      const x1 = x(ms + stepMs);
      const hour = hourAt((x0 + x1) / 2);
      const next = forecast.renewableShare[index + 1] ?? share;
      const h = ((hour % 24) + 24) % 24;
      return { x0, x1, top: baseline - share * height * PEAK, fading: h >= 15.5 && h <= 21.5 && next <= share, ms, share };
    })
    .filter((step) => step.x1 > 0 && step.x0 < width);

  const carbon = forecast.carbonGPerKwh;
  const low = Math.min(...carbon);
  const high = Math.max(...carbon);
  const range = Math.max(1, high - low);
  const points = carbon
    .map((value, index) => {
      const ms = forecast.startMs + (index + 0.5) * stepMs;
      return [x(ms), baseline - (1 - (value - low) / range) * height * ARC * 0.9 - height * 0.03] as const;
    })
    .filter(([px]) => px > -40 && px < width + 40);

  // A smooth line through the samples, so the arc reads as weather rather than a bar chart.
  let clean = '';
  points.forEach(([px, py], index) => {
    if (index === 0) {
      clean = `M${px.toFixed(1)},${py.toFixed(1)}`;
      return;
    }
    const [bx, by] = points[index - 1] as readonly [number, number];
    const mid = (bx + px) / 2;
    clean += ` C${mid.toFixed(1)},${by.toFixed(1)} ${mid.toFixed(1)},${py.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
  });

  const window = forecast.greenWindow;
  const windowSpan = window
    ? { x0: Math.max(0, x(window.startMs)), x1: Math.min(width, x(window.endMs)) }
    : null;

  // Labels on the hours a person would say out loud: six, noon, six, midnight.
  const ticks: { x: number; label: string }[] = [];
  for (let px = 2; px <= width; px += 2) {
    const whole = Math.floor(hourAt(px));
    const crossed = whole !== Math.floor(hourAt(px - 2));
    const hour = ((whole % 24) + 24) % 24;
    if (crossed && hour % 6 === 0 && px > 24 && px < width - 24) {
      ticks.push({ x: px, label: hour === 0 ? '24:00' : `${String(hour).padStart(2, '0')}:00` });
    }
  }

  const stepNow = nowX === null ? null : steps.find((step) => nowX >= step.x0 && nowX < step.x1) ?? null;

  return {
    baseline,
    steps,
    clean,
    windowSpan: windowSpan && windowSpan.x1 > windowSpan.x0 ? windowSpan : null,
    ticks,
    shareNow: stepNow?.share ?? null,
    topNow: stepNow?.top ?? null,
  };
}

export function EnergyHorizonLayer({ layout, geometry }: { readonly layout: HorizonLayout; readonly geometry: SceneGeometry }) {
  const { baseline, steps, clean, windowSpan } = layout;
  const nowX = geometry.nowX ?? -1;

  const area = (list: typeof steps): string =>
    list.length === 0
      ? ''
      : `M${list[0]?.x0.toFixed(1)},${baseline} ` +
        list.map((step) => `L${step.x0.toFixed(1)},${step.top.toFixed(1)} L${step.x1.toFixed(1)},${step.top.toFixed(1)}`).join(' ') +
        ` L${list[list.length - 1]?.x1.toFixed(1)},${baseline} Z`;

  const past = steps.filter((step) => step.x1 <= nowX);
  const ahead = steps.filter((step) => step.x1 > nowX);
  const inWindow = windowSpan ? ahead.filter((step) => step.x0 >= windowSpan.x0 - 1 && step.x1 <= windowSpan.x1 + 1) : [];

  return (
    <g className="horizon" aria-hidden="true">
      <path d={area(past)} className="horizon-area is-past" />
      <path d={area(ahead)} className="horizon-area" />
      {inWindow.length > 0 ? <path d={area(inWindow)} className="horizon-area is-window" /> : null}

      {ahead.map((step, index) =>
        step.fading ? (
          <line key={index} x1={step.x0} x2={step.x1} y1={step.top} y2={step.top} className="horizon-edge is-fading" />
        ) : (
          <line key={index} x1={step.x0} x2={step.x1} y1={step.top} y2={step.top} className="horizon-edge" />
        ),
      )}

      <path d={clean} className="horizon-arc" />

      {geometry.nowX !== null ? (
        <line x1={geometry.nowX} x2={geometry.nowX} y1={baseline + 2} y2={baseline - geometry.height * 0.34} className="horizon-now" />
      ) : null}
    </g>
  );
}
