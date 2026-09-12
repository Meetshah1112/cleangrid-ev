/**
 * The colour of the sky at a given local hour, the same model the operator console draws its valleys
 * with, so the dusk on a driver's phone is the dusk on the operator's screen.
 *
 * Colours are keyframes by hour, interpolated in RGB: cheap enough to run for every column on every
 * tick, and meant to read as an illustration of a place rather than a weather simulation.
 */

export type Rgb = readonly [number, number, number];

interface Frame {
  readonly hour: number;
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  /** 0 in daylight, 1 in full night. Stars and the moon follow it. */
  readonly night: number;
}

const FRAMES: readonly Frame[] = [
  { hour: 0, zenith: [12, 23, 41], horizon: [30, 44, 70], night: 1 },
  { hour: 4.6, zenith: [16, 30, 52], horizon: [44, 55, 84], night: 0.95 },
  { hour: 5.6, zenith: [46, 60, 94], horizon: [178, 124, 121], night: 0.55 },
  { hour: 6.5, zenith: [112, 148, 185], horizon: [241, 186, 140], night: 0.15 },
  { hour: 8, zenith: [141, 190, 223], horizon: [232, 239, 240], night: 0 },
  { hour: 12, zenith: [124, 180, 221], horizon: [229, 241, 244], night: 0 },
  { hour: 16, zenith: [136, 184, 217], horizon: [241, 232, 208], night: 0 },
  { hour: 17.8, zenith: [110, 142, 180], horizon: [243, 193, 127], night: 0.05 },
  { hour: 18.8, zenith: [64, 80, 125], horizon: [226, 139, 93], night: 0.35 },
  { hour: 19.8, zenith: [30, 40, 69], horizon: [108, 91, 123], night: 0.75 },
  { hour: 21, zenith: [14, 27, 47], horizon: [35, 49, 76], night: 0.95 },
  { hour: 24, zenith: [12, 23, 41], horizon: [30, 44, 70], night: 1 },
];

export interface SkyColour {
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly night: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
];

/** React Native wants the comma form of rgb(). */
export const rgb = (colour: Rgb): string => `rgb(${colour[0]},${colour[1]},${colour[2]})`;

export function skyAt(hour: number): SkyColour {
  const h = ((hour % 24) + 24) % 24;
  for (let index = 1; index < FRAMES.length; index += 1) {
    const after = FRAMES[index] as Frame;
    const before = FRAMES[index - 1] as Frame;
    if (h <= after.hour) {
      const t = (h - before.hour) / (after.hour - before.hour);
      return {
        zenith: mix(before.zenith, after.zenith, t),
        horizon: mix(before.horizon, after.horizon, t),
        night: lerp(before.night, after.night, t),
      };
    }
  }
  const last = FRAMES[FRAMES.length - 1] as Frame;
  return { zenith: last.zenith, horizon: last.horizon, night: last.night };
}

/** How high the sun stands, from -1 (deep night) to 1 (overhead). Good enough to place a sun in a picture. */
export function sunElevation(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return Math.sin((Math.PI * (h - 6.2)) / 12.6);
}

/** Whether text over this colour should be light or dark. */
export function toneOn(colour: Rgb): 'light' | 'dark' {
  const linear = (value: number): number => (value / 255) ** 2.2;
  const luminance = 0.2126 * linear(colour[0]) + 0.7152 * linear(colour[1]) + 0.0722 * linear(colour[2]);
  return luminance > 0.3 ? 'dark' : 'light';
}

/** Deterministic smooth noise in 0..1, so a hillside keeps its shape between renders. */
export function ridge(u: number, seed: number): number {
  const value =
    Math.sin(u * Math.PI * 2 * 1.15 + seed) * 0.5 +
    Math.sin(u * Math.PI * 2 * 2.7 + seed * 1.9) * 0.3 +
    Math.sin(u * Math.PI * 2 * 5.3 + seed * 0.7) * 0.2;
  return (value + 1) / 2;
}

/** A fixed scatter in 0..1, for stars. */
export function scatter(index: number, seed: number): number {
  const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
