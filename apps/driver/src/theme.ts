/** One palette. Green means clean, everywhere, in the app and in the operator console. */

export const theme = {
  bg: '#eef5f0',
  card: '#ffffff',
  deep: '#123528',
  deepSoft: '#1b4634',
  lime: '#b8e986',
  limeDim: '#9ed268',
  limeSoft: '#e4f4d9',
  ink: '#0f2a20',
  inkOnDeep: '#eaf6ee',
  muted: '#5f7d70',
  mutedOnDeep: '#9dc0ac',
  faint: '#98ada3',
  line: '#e2ebe6',
  lineOnDeep: '#26503c',
  green: '#1f8a5c',
  greenSoft: '#dcf2e5',
  amber: '#c98a1a',
  amberSoft: '#fdf2dc',
  red: '#c0392b',
  redSoft: '#fbe9e7',
  radius: 22,
  radiusSmall: 14,
  space: (n: number): number => n * 4,
} as const;

export function carbonColor(gPerKwh: number): string {
  const stops: [number, [number, number, number]][] = [
    [120, [31, 138, 92]],
    [250, [124, 176, 84]],
    [400, [201, 138, 26]],
    [550, [199, 106, 45]],
    [750, [192, 57, 43]],
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
      const mixed = lowerColor.map((channel, position) =>
        Math.round(channel + ((upperColor[position] as number) - channel) * ratio),
      );
      return `rgb(${mixed.join(',')})`;
    }
  }
  return `rgb(${last[1].join(',')})`;
}

export const MODE_COPY: Record<string, { title: string; blurb: string; glyph: string }> = {
  cheapest: { title: 'Cheapest', blurb: 'Favour lowest rates', glyph: '₹' },
  greenest: { title: 'Greenest', blurb: 'Favour clean hours', glyph: '✦' },
  fastest: { title: 'Fastest', blurb: 'Charge right away', glyph: '⚡' },
  balanced: { title: 'Balanced', blurb: 'Mix cost and carbon', glyph: '◐' },
};

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
