'use client';

import { Scene } from '../scene/Scene';
import { localHour } from '../scene/sky';
import type { SceneGeometry } from '../scene/Scene';

/**
 * The two ways the same energy could have been delivered, each set in a day of its own.
 *
 * The baseline side carries a trace of when it would have drawn that energy, worked out from each
 * session's plug-in time and top power, and it bunches where arrivals bunch. The CleanGrid side
 * carries no trace, because the console is not given the metered energy hour by hour and a drawn
 * curve would be invented; it states what the meters and the grid did establish instead.
 */

const HOUR = 3_600_000;

export function StoryMoments({
  nowMs,
  timezone,
  baselineCo2Kg,
  co2Kg,
  baselineByHour,
  renewableShare,
  greenScore,
  cut,
}: {
  readonly nowMs: number;
  readonly timezone: string;
  readonly baselineCo2Kg: number;
  readonly co2Kg: number;
  readonly baselineByHour: readonly number[];
  readonly renewableShare: string;
  readonly greenScore: number | null;
  readonly cut: string;
}) {
  const midnight = nowMs > 0 ? nowMs - Math.round(localHour(nowMs, timezone) * 60) * 60_000 : 0;
  const difference = baselineCo2Kg - co2Kg;
  const peakHour = baselineByHour.reduce((best, value, hour) => (value > (baselineByHour[best] ?? 0) ? hour : best), 0);
  const total = baselineByHour.reduce((sum, value) => sum + value, 0);

  return (
    <div className="story">
      <figure className="story-moment is-baseline">
        <Scene
          className="is-crop"
          startMs={midnight}
          spanMs={24 * HOUR}
          nowMs={0}
          timezone={timezone}
          horizon={0.5}
          features={{ turbines: false, solar: false, town: true }}
          label="A day of charging on plug-in"
          layers={(geometry) => <HourTrace hours={baselineByHour} geometry={geometry} />}
        />
        <figcaption>
          <p className="eyebrow">If every car charged immediately</p>
          <p className="story-figure">{baselineCo2Kg.toFixed(1)} kg CO₂</p>
          <p className="body">
            Same vehicles and energy, at full power from plug-in.
            {total > 0 ? ` Its heaviest hour would have been ${String(peakHour).padStart(2, '0')}:00, when arrivals bunch.` : ''}
          </p>
        </figcaption>
      </figure>

      <p className="story-bridge" aria-label={`Difference: ${Math.abs(difference).toFixed(1)} kilograms, ${cut}`}>
        <strong>
          {difference >= 0 ? '−' : '+'}
          {Math.abs(difference).toFixed(1)} kg
        </strong>
        <span>{cut}</span>
      </p>

      <figure className="story-moment is-cleangrid">
        <Scene
          className="is-crop"
          startMs={midnight}
          spanMs={24 * HOUR}
          nowMs={0}
          timezone={timezone}
          horizon={0.5}
          features={{ turbines: true, solar: true, town: false }}
          label="A day of scheduled charging"
        />
        <figcaption>
          <p className="eyebrow">With CleanGrid scheduling</p>
          <p className="story-figure is-clean">{co2Kg.toFixed(1)} kg CO₂</p>
          <p className="body">
            The same energy moved into cleaner hours inside each car&apos;s parked window. {renewableShare} of it was renewable
            {greenScore === null ? '.' : `, with an average Green Score of ${greenScore}.`}
          </p>
        </figcaption>
      </figure>
    </div>
  );
}

/** Grey columns of baseline energy by hour of day, standing on the meadow. */
function HourTrace({ hours, geometry }: { readonly hours: readonly number[]; readonly geometry: SceneGeometry }) {
  const max = Math.max(0.001, ...hours);
  const base = geometry.height - 18;
  const tall = geometry.height * 0.34;
  const slot = geometry.width / 24;
  return (
    <g className="story-trace" aria-hidden="true">
      {hours.map((value, hour) => (
        <rect key={hour} x={hour * slot + 2} y={base - (value / max) * tall} width={Math.max(1, slot - 4)} height={(value / max) * tall} rx="2" />
      ))}
    </g>
  );
}
