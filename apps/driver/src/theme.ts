import type { TextStyle } from 'react-native';

/**
 * The driver app wears the operator console's clothes: forest ink on paper, and every other colour
 * an energy state used for nothing else. Lime is renewable availability, sun-gold is price, pale
 * cyan is waiting, coral is a limit or a deadline at risk. A colour on screen is always a claim.
 *
 * Text uses the "-ink" variant of a hue, darkened to read on paper; the pure lime, gold and cyan are
 * fills only and are never set as text on a light ground.
 */

export const theme = {
  forest: '#14392b',
  forestDeep: '#0d2a1f',
  forestMid: '#1f4d3a',

  canopy: '#2f8a5a',
  canopyInk: '#22704a',
  canopySoft: '#dcefe2',

  lime: '#b9e36b',
  limeSoft: '#eef8d9',

  sun: '#e2a63b',
  sunInk: '#8a5f12',
  sunSoft: '#f8eed6',

  cyan: '#9fd6dd',
  cyanInk: '#2c6b76',

  coral: '#d9644c',
  coralInk: '#b04630',
  coralSoft: '#fbe6e0',

  paper: '#fcfdfb',
  mist: '#eff4ef',
  stone: '#55665d',
  pebble: '#879890',
  rule: '#dce6dd',

  /** Text on the forest bands. */
  onForest: '#fcfdfb',
  onForestMuted: 'rgba(252,253,251,0.72)',
  onForestRule: 'rgba(252,253,251,0.14)',

  /** One radius for controls, one for panels, one for pills. */
  radiusControl: 10,
  radiusPanel: 22,
  radiusPill: 999,

  space: (n: number): number => n * 4,
} as const;

/**
 * Font families, one per weight. Android does not pick a bold file from a single custom family, so
 * each weight the app uses is registered under its own name and chosen by name, never by fontWeight.
 */
export const fonts = {
  serif: 'HedvigLettersSerif',
  sans: 'SchibstedGrotesk',
  sansSemiBold: 'SchibstedGrotesk-SemiBold',
  sansBold: 'SchibstedGrotesk-Bold',
} as const;

/** The type ramp, shared with the console: a serif for headlines and figures, a grotesk for the rest. */
export const type = {
  display: { fontFamily: fonts.serif, fontSize: 34, lineHeight: 42, letterSpacing: -0.4, color: theme.forest },
  title: { fontFamily: fonts.serif, fontSize: 26, lineHeight: 33, letterSpacing: -0.2, color: theme.forest },
  subtitle: { fontFamily: fonts.serif, fontSize: 20, lineHeight: 28, color: theme.forest },
  // Serif line heights leave room under the baseline: Hedvig's descenders run deep, and a caption set
  // straight beneath a figure would otherwise cut the tail off a g or a y.
  figure: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 40, color: theme.forest },
  eyebrow: { fontFamily: fonts.sansSemiBold, fontSize: 11.5, letterSpacing: 1.5, textTransform: 'uppercase', color: theme.stone },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: theme.forest },
  caption: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: theme.stone },
  strong: { fontFamily: fonts.sansSemiBold, fontSize: 15, lineHeight: 21, color: theme.forest },
} as const satisfies Record<string, TextStyle>;

/** Carbon intensity to colour, the same scale the console reads by. */
export function carbonColor(gPerKwh: number): string {
  const stops: [number, [number, number, number]][] = [
    [120, [34, 112, 74]],
    [250, [80, 140, 60]],
    [400, [138, 95, 18]],
    [550, [176, 90, 40]],
    [750, [176, 70, 48]],
  ];
  const first = stops[0] as [number, [number, number, number]];
  const last = stops[stops.length - 1] as [number, [number, number, number]];
  if (gPerKwh <= first[0]) return `rgb(${first[1].join(',')})`;
  if (gPerKwh >= last[0]) return `rgb(${last[1].join(',')})`;
  for (let index = 1; index < stops.length; index += 1) {
    const [upper, upperColor] = stops[index] as [number, [number, number, number]];
    const [lower, lowerColor] = stops[index - 1] as [number, [number, number, number]];
    if (gPerKwh <= upper) {
      const ratio = (gPerKwh - lower) / (upper - lower);
      const mixed = lowerColor.map((channel, position) => Math.round(channel + ((upperColor[position] as number) - channel) * ratio));
      return `rgb(${mixed.join(',')})`;
    }
  }
  return `rgb(${last[1].join(',')})`;
}

/** Words only. The icon for each mode comes from the drawn set in components/Icon.tsx. */
export const MODE_COPY: Record<string, { title: string; blurb: string }> = {
  cheapest: { title: 'Cheapest', blurb: 'Favour lowest rates' },
  greenest: { title: 'Greenest', blurb: 'Favour clean hours' },
  fastest: { title: 'Fastest', blurb: 'Charge right away' },
  balanced: { title: 'Balanced', blurb: 'Mix cost and carbon' },
};

/** The same mode colours as the console's plan ribbons. */
export const MODE_COLOUR: Record<string, string> = {
  greenest: theme.canopy,
  cheapest: theme.sun,
  balanced: theme.cyanInk,
  fastest: theme.forest,
};

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
