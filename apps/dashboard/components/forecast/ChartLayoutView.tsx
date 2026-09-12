'use client';

import { useState } from 'react';
import type { SceneGeometry } from '../scene/Scene';
import { ForecastChartLayer, ForecastChartOverlay, chartLayout } from './ForecastLandscape';
import type { Forecast } from '../../lib/types';

/**
 * The forecast chart as the two halves a scene takes: the drawing that sits in the valley, and the
 * readable, pointable layer above it. The pointer position lives in the upper half, because only
 * the tooltip changes as it moves; the landscape underneath stays still.
 */

function Layer({ forecast, geometry, timezone }: { readonly forecast: Forecast | null; readonly geometry: SceneGeometry; readonly timezone: string }) {
  const layout = chartLayout(forecast, geometry, timezone);
  return layout ? <ForecastChartLayer layout={layout} geometry={geometry} /> : null;
}

function Overlay({
  forecast,
  geometry,
  timezone,
  currency,
  pinned,
  onPin,
}: {
  readonly forecast: Forecast | null;
  readonly geometry: SceneGeometry;
  readonly timezone: string;
  readonly currency: string;
  readonly pinned: boolean;
  readonly onPin: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const layout = chartLayout(forecast, geometry, timezone);
  if (!layout || !forecast) {
    return <p className="scene-empty">The forecast appears here once the server has fetched it.</p>;
  }
  return (
    <ForecastChartOverlay
      layout={layout}
      forecast={forecast}
      timezone={timezone}
      currency={currency}
      hover={hover}
      onHover={setHover}
      pinned={pinned}
      onPin={onPin}
    />
  );
}

export const ChartLayoutView = { Layer, Overlay };
