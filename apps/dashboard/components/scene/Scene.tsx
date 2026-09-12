'use client';

import { useId, useMemo, type ReactNode } from 'react';
import { css, localHour, mix, ridge, scatter, skyAt, sunElevation, type Rgb } from './sky';
import { useSize } from './useSize';

/**
 * A valley observed across a span of time.
 *
 * Every column of the scene is a moment: the left edge is `startMs`, the right edge is
 * `startMs + spanMs`, and the sky, the tint of the hills, the stars and the lights in the town are
 * all whatever that moment looks like at the site. Pages then draw their own data into the same
 * geometry, so a forecast curve or a charging plan sits on the landscape rather than on a chart
 * pasted over a photograph.
 *
 * Nothing here is real photography, and it does not pretend to be. What it has instead is truth to
 * the clock: the dusk on this page is the dusk that is coming.
 */

export interface SceneGeometry {
  readonly width: number;
  readonly height: number;
  /** Where the lake meets the far shore. */
  readonly horizonY: number;
  readonly x: (ms: number) => number;
  readonly hourAt: (x: number) => number;
  readonly skyAtX: (x: number) => ReturnType<typeof skyAt>;
  readonly ridgeY: (x: number) => number;
  readonly meadowY: (x: number) => number;
  /** Null when now is outside the span. */
  readonly nowX: number | null;
}

export interface SceneFeatures {
  readonly turbines?: boolean;
  /** Panels in the near field; a number shows them only when the scene is at least that wide. */
  readonly solar?: boolean | number;
  readonly town?: boolean;
}

interface SceneProps {
  readonly startMs: number;
  readonly spanMs: number;
  readonly nowMs: number;
  readonly timezone: string;
  readonly label: string;
  /** Fraction of the height where land begins. */
  readonly horizon?: number;
  readonly features?: SceneFeatures;
  readonly className?: string;
  /** Data drawn into the landscape itself. */
  readonly layers?: (geometry: SceneGeometry) => ReactNode;
  /** HTML laid over the scene, positioned with the same geometry. */
  readonly children?: (geometry: SceneGeometry) => ReactNode;
  /**
   * Hold the sky still behind the copy at the left and right edges.
   *
   * Over a day-strip the headline can start in afternoon light and end in night, and no single text
   * colour survives both. The wash extends the colour of each edge inwards for a short way and
   * fades out, so the copy always sits on one sky and the rest of the scene keeps its time of day.
   */
  readonly wash?: boolean;
}

const STOPS = 18;
const FOREST: Rgb = [24, 66, 49];
const MEADOW: Rgb = [33, 84, 60];
const HAZE: Rgb = [112, 150, 134];
const PANEL: Rgb = [20, 42, 58];
const WARM_LIGHT: Rgb = [255, 213, 148];

export function Scene({
  startMs,
  spanMs,
  nowMs,
  timezone,
  label,
  horizon = 0.58,
  features = { turbines: true, solar: true, town: true },
  className,
  layers,
  children,
  wash = false,
}: SceneProps) {
  const { ref, size } = useSize<HTMLDivElement>({ width: 1440, height: 720 });
  // Several scenes can share a page, and SVG ids are global to the document.
  const uid = `sc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const id = (name: string): string => `${uid}-${name}`;
  const ref_ = (name: string): string => `url(#${id(name)})`;
  const { width, height } = size;

  // Before the clock is known there is no "now" to draw, so the valley holds a calm noon.
  const known = startMs > 0 && spanMs > 0;
  const startHour = useMemo(() => (known ? localHour(startMs, timezone) : 12), [known, startMs, timezone]);

  const geometry = useMemo<SceneGeometry>(() => {
    const horizonY = height * horizon;
    const hourAt = (px: number): number => (known ? startHour + ((px / width) * spanMs) / 3_600_000 : 12);
    return {
      width,
      height,
      horizonY,
      x: (ms: number) => (known ? ((ms - startMs) / spanMs) * width : width / 2),
      hourAt,
      skyAtX: (px: number) => skyAt(hourAt(px)),
      ridgeY: (px: number) => horizonY - height * (0.012 + 0.07 * ridge(px / width, 5.4) ** 1.5),
      // A narrow lake: the near meadow rises close to the far shore, so water reads as a sliver of light.
      meadowY: (px: number) => horizonY + height * (0.026 + 0.04 * ridge(px / width, 8.8)),
      nowX: known && nowMs >= startMs && nowMs <= startMs + spanMs ? ((nowMs - startMs) / spanMs) * width : null,
    };
  }, [width, height, horizon, known, startHour, spanMs, startMs, nowMs]);

  const art = useMemo(() => {
    const { horizonY, hourAt, ridgeY, meadowY } = geometry;
    const columns = Array.from({ length: STOPS + 1 }, (_, index) => {
      const px = (index / STOPS) * width;
      return { offset: index / STOPS, sky: skyAt(hourAt(px)) };
    });

    const outline = (fn: (px: number) => number, bottom: number): string => {
      const points: string[] = [];
      for (let px = 0; px <= width + 8; px += 8) points.push(`${px.toFixed(1)},${fn(px).toFixed(1)}`);
      return `M0,${bottom} L${points.join(' L')} L${width},${bottom} Z`;
    };

    const farHill = (px: number): number => horizonY - height * (0.03 + 0.11 * ridge(px / width, 2.1));

    const stars = Array.from({ length: 64 }, (_, index) => {
      const px = scatter(index, 1) * width;
      const py = scatter(index, 2) * horizonY * 0.62;
      const night = skyAt(hourAt(px)).night;
      return { px, py, r: 0.5 + scatter(index, 3) * 1.1, opacity: night * (0.25 + 0.7 * scatter(index, 4)) };
    }).filter((star) => star.opacity > 0.05);

    const turbineAt = [0.5, 0.58, 0.67, 0.77, 0.86, 0.94].map((u, index) => {
      const px = u * width;
      const night = skyAt(hourAt(px)).night;
      return {
        px,
        base: farHill(px) + 2,
        tall: height * (0.1 - index * 0.004),
        turn: (scatter(index, 9) * 120) | 0,
        colour: mix(skyAt(hourAt(px)).horizon, [242, 246, 243], 1 - night * 0.6),
      };
    });

    const lights = Array.from({ length: 30 }, (_, index) => {
      const px = (0.7 + scatter(index, 5) * 0.28) * width;
      return {
        px,
        py: horizonY + height * (0.004 + scatter(index, 6) * 0.018),
        opacity: skyAt(hourAt(px)).night * (0.5 + 0.5 * scatter(index, 7)),
      };
    }).filter((light) => light.opacity > 0.08);

    // Rows of panels in the near field, lower left, receding towards the lake.
    const panels: { d: string; px: number }[] = [];
    if (features.solar !== false && width > (typeof features.solar === 'number' ? features.solar : 560)) {
      for (let row = 0; row < 4; row += 1) {
        const depth = 1 - row * 0.16;
        const panelW = width * 0.03 * depth;
        const panelH = height * 0.036 * depth;
        const y = height * (0.9 - row * 0.062);
        const count = Math.round(8 - row * 1.2);
        for (let column = 0; column < count; column += 1) {
          const left = width * (0.015 + row * 0.018) + column * (panelW + 4 * depth);
          const skew = panelH * 0.55;
          panels.push({
            px: left,
            d: `M${left},${y} L${left + panelW},${y} L${left + panelW + skew},${y - panelH} L${left + skew},${y - panelH} Z`,
          });
        }
      }
    }

    const shore = (px: number): number => horizonY - 1 + height * 0.006 * ridge(px / width, 3.3);
    const lakePoints: string[] = [];
    for (let px = 0; px <= width + 8; px += 8) lakePoints.push(`${px.toFixed(1)},${shore(px).toFixed(1)}`);
    const lakePath = `M0,${horizonY + height * 0.11} L${lakePoints.join(' L')} L${width},${horizonY + height * 0.11} Z`;

    return {
      columns,
      lakePath,
      farPath: outline(farHill, horizonY + 4),
      ridgePath: outline(ridgeY, horizonY + 6),
      meadowPath: outline(meadowY, height),
      stars,
      turbines: features.turbines !== false ? turbineAt : [],
      lights: features.town !== false ? lights : [],
      panels,
    };
  }, [geometry, width, height, features.solar, features.turbines, features.town]);

  // On a phone the copy runs the full width of the sky, so nothing may stand in the upper sky.
  const narrow = width < 760;

  const sun = useMemo(() => {
    // The sun or moon stands at now when now is in open sky. When now is behind the page's copy it
    // moves to the open part of the sky instead, and shows whatever that column's hour holds.
    const px = narrow ? width * 0.84 : geometry.nowX !== null && geometry.nowX > width * 0.5 ? geometry.nowX : width * 0.72;
    const hour = geometry.hourAt(px);
    const elevation = sunElevation(hour);
    const radius = Math.min(30, Math.max(14, height * 0.04));
    if (elevation > -0.06) {
      return {
        kind: 'sun' as const,
        px,
        py: geometry.horizonY - height * ((narrow ? 0.04 : 0.05) + (narrow ? 0.04 : 0.13) * Math.max(0, elevation)),
        radius,
      };
    }
    return { kind: 'moon' as const, px, py: narrow ? geometry.horizonY - height * 0.13 : height * 0.2, radius: radius * 0.8 };
  }, [geometry, width, height, narrow]);

  const stop = (kind: 'zenith' | 'horizon' | 'far' | 'ridge' | 'meadow' | 'lake' | 'panel') =>
    art.columns.map(({ offset, sky }) => {
      const colour =
        kind === 'zenith'
          ? sky.zenith
          : kind === 'horizon'
            ? sky.horizon
            : kind === 'far'
              ? mix(sky.horizon, HAZE, 0.5 + sky.night * 0.25)
              : kind === 'ridge'
                ? mix(sky.horizon, FOREST, 0.72 + sky.night * 0.18)
                : kind === 'meadow'
                  ? mix(sky.horizon, MEADOW, 0.86 + sky.night * 0.1)
                  : kind === 'lake'
                    ? mix(mix(sky.zenith, sky.horizon, 0.55), [255, 255, 255], 0.12 * (1 - sky.night))
                    : mix(sky.zenith, PANEL, 0.72);
      return <stop key={`${kind}-${offset}`} offset={offset} stopColor={css(colour)} />;
    });

  return (
    <div ref={ref} className={`scene${className ? ` ${className}` : ''}`}>
      <svg className="scene-art" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <defs>
          {(['zenith', 'horizon', 'far', 'ridge', 'meadow', 'lake', 'panel'] as const).map((kind) => (
            <linearGradient key={kind} id={id(kind)} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
              {stop(kind)}
            </linearGradient>
          ))}
          <linearGradient id={id('glow')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity="0" />
            <stop offset="1" stopColor="white" stopOpacity="1" />
          </linearGradient>
          <mask id={id('horizon-mask')}>
            <rect x="0" y="0" width={width} height={geometry.horizonY} fill={ref_('glow')} />
          </mask>
          {(['left', 'right'] as const).map((side) => {
            const colour = washColour(geometry, side);
            const x0 = side === 'left' ? 0 : width * 0.62;
            const x1 = side === 'left' ? width * 0.68 : width;
            return (
              <linearGradient key={side} id={id(`wash-${side}`)} x1={x0} y1="0" x2={x1} y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor={css(colour)} stopOpacity={side === 'left' ? 0.94 : 0} />
                <stop offset={side === 'left' ? '0.55' : '0.45'} stopColor={css(colour)} stopOpacity={0.82} />
                <stop offset="1" stopColor={css(colour)} stopOpacity={side === 'left' ? 0 : 0.94} />
              </linearGradient>
            );
          })}
          <linearGradient id={id('wash-fade')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="0.7" stopColor="white" stopOpacity="0.85" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={id('wash-mask')}>
            <rect x="0" y="0" width={width} height={geometry.horizonY} fill={ref_('wash-fade')} />
          </mask>
          <radialGradient id={id('sun-halo')}>
            <stop offset="0" stopColor="rgb(255 244 214)" stopOpacity="0.55" />
            <stop offset="1" stopColor="rgb(255 244 214)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width={width} height={height} fill={ref_('zenith')} />
        <rect x="0" y="0" width={width} height={geometry.horizonY} fill={ref_('horizon')} mask={ref_('horizon-mask')} />

        {wash && narrow ? (
          <rect x="0" y="0" width={width} height={geometry.horizonY} fill={css(washColour(geometry, 'left'))} fillOpacity={0.86} mask={ref_('wash-mask')} aria-hidden="true" />
        ) : wash ? (
          <g aria-hidden="true">
            {(['left', 'right'] as const).map((side) => (
              <rect
                key={side}
                x={side === 'left' ? 0 : width * 0.62}
                y="0"
                width={width * 0.38 + (side === 'left' ? width * 0.3 : 0)}
                height={geometry.horizonY}
                fill={ref_(`wash-${side}`)}
                mask={ref_('wash-mask')}
              />
            ))}
          </g>
        ) : null}

        <g aria-hidden="true">
          {art.stars.map((star, index) => (
            <circle key={index} cx={star.px} cy={star.py} r={star.r} fill="white" opacity={star.opacity} />
          ))}

          {sun.kind === 'sun' ? (
            <g>
              <circle cx={sun.px} cy={sun.py} r={sun.radius * 3.2} fill={ref_('sun-halo')} />
              <circle cx={sun.px} cy={sun.py} r={sun.radius} fill="rgb(255 238 196)" />
            </g>
          ) : (
            <g>
              <circle cx={sun.px} cy={sun.py} r={sun.radius} fill="rgb(236 239 226)" />
              <circle cx={sun.px + sun.radius * 0.42} cy={sun.py - sun.radius * 0.18} r={sun.radius * 0.9} fill={ref_('zenith')} />
            </g>
          )}

          <path d={art.farPath} fill={ref_('far')} />

          {art.turbines.map((turbine, index) => {
            const hubY = turbine.base - turbine.tall;
            const blade = turbine.tall * 0.52;
            return (
              <g key={index} stroke={css(turbine.colour)} strokeLinecap="round">
                <line x1={turbine.px} y1={turbine.base} x2={turbine.px} y2={hubY} strokeWidth={Math.max(1.4, turbine.tall * 0.028)} />
                {[0, 120, 240].map((angle) => {
                  const radians = ((angle + turbine.turn) * Math.PI) / 180;
                  return (
                    <line
                      key={angle}
                      x1={turbine.px}
                      y1={hubY}
                      x2={turbine.px + Math.sin(radians) * blade}
                      y2={hubY - Math.cos(radians) * blade}
                      strokeWidth={Math.max(1.1, turbine.tall * 0.02)}
                    />
                  );
                })}
              </g>
            );
          })}

          <path d={art.ridgePath} fill={ref_('ridge')} />
          <path d={art.lakePath} fill={ref_('lake')} />
          {[0.018, 0.034, 0.05].map((depth, index) => (
            <line
              key={depth}
              x1={width * (0.2 + index * 0.13)}
              x2={width * (0.34 + index * 0.16)}
              y1={geometry.horizonY + height * depth}
              y2={geometry.horizonY + height * depth}
              stroke="white"
              strokeOpacity={0.22 - index * 0.05}
              strokeWidth="1.2"
            />
          ))}
          {art.lights.map((light, index) => (
            <circle key={index} cx={light.px} cy={light.py} r="1.5" fill={css(WARM_LIGHT)} opacity={light.opacity} />
          ))}

          <path d={art.meadowPath} fill={ref_('meadow')} />

          {art.panels.map((panel, index) => (
            <path key={index} d={panel.d} fill={ref_('panel')} stroke="rgb(255 255 255 / 0.22)" strokeWidth="0.8" />
          ))}
        </g>

        {layers?.(geometry)}
      </svg>

      {children ? <div className="scene-overlay">{children(geometry)}</div> : null}
    </div>
  );
}

/** The sky colour an edge wash holds still: the edge's own sky, part way between zenith and horizon. */
export function washColour(geometry: SceneGeometry, side: 'left' | 'right'): Rgb {
  const sky = geometry.skyAtX(side === 'left' ? 0 : geometry.width);
  return mix(sky.zenith, sky.horizon, 0.42);
}

/**
 * Whether text over one of the washed edges should be light or dark. Forest ink disappears into a
 * night sky and white disappears into noon, so text reads the colour it actually sits on.
 */
export function washTone(geometry: SceneGeometry, side: 'left' | 'right'): 'light' | 'dark' {
  const colour = washColour(geometry, side);
  const linear = (value: number): number => (value / 255) ** 2.2;
  const luminance = 0.2126 * linear(colour[0]) + 0.7152 * linear(colour[1]) + 0.0722 * linear(colour[2]);
  return luminance > 0.3 ? 'dark' : 'light';
}
