/** One palette, shared with the operator dashboard's meaning: green is clean, red is dirty. */

export const theme = {
  bg: '#f6f8f7',
  card: '#ffffff',
  ink: '#10201a',
  muted: '#5d7168',
  faint: '#98a8a1',
  line: '#e2e9e5',
  accent: '#0f8f5f',
  accentSoft: '#e4f4ec',
  amber: '#c9891a',
  red: '#c0392b',
  radius: 16,
  space: (n: number): number => n * 4,
} as const;

export function carbonColor(gPerKwh: number): string {
  const stops: [number, [number, number, number]][] = [
    [120, [34, 160, 98]],
    [250, [104, 172, 72]],
    [400, [201, 137, 26]],
    [550, [200, 100, 45]],
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

export const MODE_COPY: Record<string, { title: string; blurb: string }> = {
  cheapest: { title: 'Cheapest', blurb: 'Lowest bill' },
  greenest: { title: 'Greenest', blurb: 'Lowest emissions' },
  fastest: { title: 'Fastest', blurb: 'Done as early as possible' },
  balanced: { title: 'Balanced', blurb: 'Half cost, half carbon' },
};
