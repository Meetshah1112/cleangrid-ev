import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Mask, Path, Stop, Rect } from 'react-native-svg';
import { localHourExact } from '../format';
import { mix, rgb, ridge, scatter, skyAt, sunElevation, toneOn, type Rgb } from '../scene/sky';

/**
 * The console's valley, on a phone.
 *
 * Every column is a moment: the left edge is `startMs`, the right edge `startMs + spanMs`, and the
 * sky above each column is the sky at that hour at the driver's site. Screens draw their own data
 * into the same geometry, so a forecast or a charging plan sits on the land rather than in a card.
 *
 * The left part of the sky is held still behind the copy, in the colour of the left edge, so the
 * headline reads the same whether that corner is noon or night; `tone` says which ink to use on it.
 */

export interface ValleyGeometry {
  readonly width: number;
  readonly height: number;
  readonly horizonY: number;
  readonly x: (ms: number) => number;
  readonly nowX: number | null;
  /** Ink for copy laid over the held sky at the top left. */
  readonly tone: 'light' | 'dark';
}

const FOREST: Rgb = [24, 66, 49];
const MEADOW: Rgb = [33, 84, 60];
const HAZE: Rgb = [112, 150, 134];

export function Valley({
  startMs,
  spanMs,
  nowMs,
  height,
  horizon = 0.62,
  trees = true,
  layers,
  children,
}: {
  readonly startMs: number;
  readonly spanMs: number;
  readonly nowMs: number;
  readonly height: number;
  /** Fraction of the height where the far shore meets the lake. */
  readonly horizon?: number;
  /** Soft canopies along the ridge. Line-drawn machinery reads as noise at phone size; trees read as a place. */
  readonly trees?: boolean;
  readonly layers?: (geometry: ValleyGeometry) => ReactNode;
  readonly children?: (geometry: ValleyGeometry) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent): void => setWidth(Math.round(event.nativeEvent.layout.width));

  const startHour = useMemo(() => localHourExact(startMs), [startMs]);
  const hourAt = (px: number): number => startHour + ((px / Math.max(1, width)) * spanMs) / 3_600_000;
  const horizonY = height * horizon;
  const wash = skyAt(startHour);
  const washColour = mix(wash.zenith, wash.horizon, 0.42);

  const geometry: ValleyGeometry = {
    width,
    height,
    horizonY,
    x: (ms) => ((ms - startMs) / spanMs) * width,
    nowX: nowMs >= startMs && nowMs <= startMs + spanMs ? ((nowMs - startMs) / spanMs) * width : null,
    tone: toneOn(washColour),
  };

  const art = useMemo(() => {
    if (width === 0) return null;
    const outline = (fn: (px: number) => number, bottom: number): string => {
      const points: string[] = [];
      for (let px = 0; px <= width + 6; px += 6) points.push(`${px.toFixed(1)},${fn(px).toFixed(1)}`);
      return `M0,${bottom} L${points.join(' L')} L${width},${bottom} Z`;
    };
    const farHill = (px: number): number => horizonY - height * (0.04 + 0.13 * ridge(px / width, 2.1));
    const ridgeY = (px: number): number => horizonY - height * (0.015 + 0.08 * ridge(px / width, 5.4) ** 1.5);
    const meadowY = (px: number): number => horizonY + height * (0.03 + 0.05 * ridge(px / width, 8.8));
    const stars = Array.from({ length: 30 }, (_, index) => {
      const px = scatter(index, 1) * width;
      const night = skyAt(hourAt(px)).night;
      return { px, py: scatter(index, 2) * horizonY * 0.6, r: 0.5 + scatter(index, 3), opacity: night * (0.3 + 0.6 * scatter(index, 4)) };
    }).filter((star) => star.opacity > 0.08);
    // Off to the right and below the headline, which on a phone runs most of the way across the sky.
    const sunX = width * 0.88;
    const elevation = sunElevation(hourAt(sunX));
    // A sparse skyline: a few trees standing apart on the ridge, some round and some slim like
    // cypresses, small against the hill and placed by a fixed scatter so they hold their places.
    const canopies = trees
      ? [0.5, 0.58, 0.66, 0.7, 0.8, 0.93].map((u, index) => {
          const px = (u + (scatter(index, 11) - 0.5) * 0.03) * width;
          const slim = index % 3 !== 1;
          const tall = height * (slim ? 0.05 + 0.02 * scatter(index, 12) : 0.034 + 0.012 * scatter(index, 12));
          return { px, base: ridgeY(px) + 2, rx: slim ? tall * 0.34 : tall * 0.82, ry: slim ? tall : tall * 0.82 };
        })
      : [];
    const gradient = (pick: (sky: ReturnType<typeof skyAt>) => Rgb) =>
      Array.from({ length: 17 }, (_, index) => ({ offset: index / 16, colour: rgb(pick(skyAt(hourAt((index / 16) * width)))) }));
    return {
      zenithStops: gradient((sky) => sky.zenith),
      horizonStops: gradient((sky) => sky.horizon),
      stars,
      sun: { x: sunX, y: horizonY - height * (elevation > -0.06 ? 0.16 + 0.06 * Math.max(0, elevation) : 0.2), up: elevation > -0.06 },
      canopies,
      far: outline(farHill, horizonY + 4),
      ridge: outline(ridgeY, horizonY + 14),
      // The water's edge wanders, so the near shore is not drawn with a ruler.
      lake: outline((px) => horizonY - 1 + height * 0.014 * ridge(px / width, 3.3), horizonY + height * 0.14),
      meadow: outline(meadowY, height),
      farStops: gradient((sky) => mix(sky.horizon, HAZE, 0.5 + sky.night * 0.25)),
      ridgeStops: gradient((sky) => mix(sky.horizon, FOREST, 0.72 + sky.night * 0.18)),
      lakeStops: gradient((sky) => mix(mix(sky.zenith, sky.horizon, 0.55), [255, 255, 255], 0.12 * (1 - sky.night))),
      meadowStops: gradient((sky) => mix(sky.horizon, MEADOW, 0.86 + sky.night * 0.1)),
      canopyStops: gradient((sky) => mix(sky.horizon, FOREST, 0.78 + sky.night * 0.14)),
    };
    // hourAt is derived from startHour, spanMs and width, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, horizonY, startHour, spanMs, trees, geometry.nowX]);

  return (
    <View style={[styles.frame, { height }]} onLayout={onLayout}>
      {art ? (
        <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Defs>
            {/* The zenith colour everywhere, and the horizon colour fading in towards the land: one smooth sky, no seams. */}
            <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" />
              <Stop offset="0.35" stopColor="#262626" />
              <Stop offset="1" stopColor="#ffffff" />
            </LinearGradient>
            <Mask id="horizonMask" x="0" y="0" width={width} height={horizonY + 6} maskUnits="userSpaceOnUse">
              <Rect x={0} y={0} width={width} height={horizonY + 6} fill="url(#fade)" />
            </Mask>
            {(
              [
                ['zenith', art.zenithStops],
                ['horizon', art.horizonStops],
                ['far', art.farStops],
                ['ridge', art.ridgeStops],
                ['lake', art.lakeStops],
                ['meadow', art.meadowStops],
                ['canopy', art.canopyStops],
              ] as const
            ).map(([name, stops]) => (
              <LinearGradient key={name} id={name} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
                {stops.map((stop) => (
                  <Stop key={stop.offset} offset={stop.offset} stopColor={stop.colour} />
                ))}
              </LinearGradient>
            ))}
            <LinearGradient id="wash" x1="0" y1="0" x2={width * 0.9} y2="0" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={rgb(washColour)} stopOpacity={0.94} />
              <Stop offset="0.55" stopColor={rgb(washColour)} stopOpacity={0.8} />
              <Stop offset="1" stopColor={rgb(washColour)} stopOpacity={0} />
            </LinearGradient>
          </Defs>

          <Rect x={0} y={0} width={width} height={horizonY + 6} fill="url(#zenith)" />
          <Rect x={0} y={0} width={width} height={horizonY + 6} fill="url(#horizon)" mask="url(#horizonMask)" />
          {art.stars.map((star, index) => (
            <Circle key={index} cx={star.px} cy={star.py} r={star.r} fill="#ffffff" opacity={star.opacity} />
          ))}
          <Rect x={0} y={0} width={width} height={horizonY} fill="url(#wash)" />
          {art.sun.up ? (
            <>
              <Circle cx={art.sun.x} cy={art.sun.y} r={30} fill="rgb(255,244,214)" opacity={0.25} />
              <Circle cx={art.sun.x} cy={art.sun.y} r={13} fill="rgb(255,238,196)" />
            </>
          ) : (
            <Circle cx={art.sun.x} cy={art.sun.y} r={9} fill="rgb(236,239,226)" />
          )}
          <Path d={art.far} fill="url(#far)" />
          <Path d={art.ridge} fill="url(#ridge)" />
          <G>
            {art.canopies.map((tree, index) => (
              <Ellipse key={index} cx={tree.px} cy={tree.base - tree.ry} rx={tree.rx} ry={tree.ry} fill="url(#canopy)" />
            ))}
          </G>
          <Path d={art.lake} fill="url(#lake)" />
          <Path d={art.meadow} fill="url(#meadow)" />
          {layers?.(geometry)}
        </Svg>
      ) : null}
      {art && children ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {children(geometry)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden', backgroundColor: '#cfe3ec' },
});
