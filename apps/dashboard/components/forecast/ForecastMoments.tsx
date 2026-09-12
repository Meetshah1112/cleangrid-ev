'use client';

import { Icon } from '../Icon';
import { Scene } from '../scene/Scene';
import type { Moment } from '../../lib/forecastRead';

/**
 * Three moments of the coming day, each shown in the valley as it will look at that hour.
 *
 * A crop of the same scene, framed around the moment, so the solar lift is a bright noon, the price
 * peak is an evening, and the night is dark, because those are the hours. The first moment is given
 * more room than the other two: it is the one flexible charging is moved towards.
 */
export function ForecastMoments({
  moments,
  timezone,
  nowMs,
}: {
  readonly moments: readonly Moment[];
  readonly timezone: string;
  readonly nowMs: number;
}) {
  return (
    <div className="moments">
      {moments.map((moment, index) => (
        <article key={moment.key} className={`moment${index === 0 ? ' is-lead' : ''}`}>
          <Scene
            className="is-crop"
            startMs={moment.ms - 2 * 3_600_000}
            spanMs={4 * 3_600_000}
            nowMs={nowMs}
            timezone={timezone}
            horizon={0.62}
            features={{ turbines: moment.key !== 'solar', solar: moment.key === 'solar', town: moment.key !== 'solar' }}
            label={`The valley at ${moment.time}`}
          />
          <div className="moment-copy">
            <p className="moment-time">
              <Icon name={moment.icon} size={18} />
              {moment.time}
            </p>
            <h3 className="subtitle">{moment.title}</h3>
            <p className="body">{moment.copy}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
