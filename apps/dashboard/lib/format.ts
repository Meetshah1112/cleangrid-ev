/** Formatting and the one carbon colour scale the whole dashboard reads by. */

export const TIMEZONE = process.env.NEXT_PUBLIC_SITE_TZ ?? 'Europe/London';

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const clockTime = (ms: number): string => timeFormat.format(new Date(ms));

export const kw = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined ? '--' : value.toFixed(digits);

export const money = (value: number | null | undefined, currency = 'GBP'): string =>
  value === null || value === undefined
    ? '--'
    : new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);

export const percent = (share: number | null | undefined): string =>
  share === null || share === undefined ? '--' : `${Math.round(share * 100)}%`;

export function countdown(toMs: number, nowMs: number): string {
  const minutes = Math.round((toMs - nowMs) / 60_000);
  if (minutes <= 0) return 'due';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * Carbon intensity to colour, used identically by the chart, the ribbon and the tiles so the
 * same green always means the same thing.
 */
export function carbonColor(gPerKwh: number): string {
  const stops: [number, [number, number, number]][] = [
    [120, [52, 199, 123]],
    [250, [126, 200, 80]],
    [400, [232, 181, 58]],
    [550, [231, 124, 58]],
    [750, [222, 74, 74]],
  ];
  const first = stops[0] as [number, [number, number, number]];
  const last = stops[stops.length - 1] as [number, [number, number, number]];
  if (gPerKwh <= first[0]) return `rgb(${first[1].join(' ')})`;
  if (gPerKwh >= last[0]) return `rgb(${last[1].join(' ')})`;
  for (let index = 1; index < stops.length; index += 1) {
    const [upper, upperColor] = stops[index] as [number, [number, number, number]];
    const [lower, lowerColor] = stops[index - 1] as [number, [number, number, number]];
    if (gPerKwh <= upper) {
      const ratio = (gPerKwh - lower) / (upper - lower);
      const mixed = lowerColor.map((channel, position) =>
        Math.round(channel + ((upperColor[position] as number) - channel) * ratio),
      );
      return `rgb(${mixed.join(' ')})`;
    }
  }
  return `rgb(${last[1].join(' ')})`;
}

export const carbonLabel = (gPerKwh: number): string =>
  gPerKwh < 180 ? 'very clean' : gPerKwh < 300 ? 'clean' : gPerKwh < 450 ? 'average' : gPerKwh < 600 ? 'dirty' : 'very dirty';

export const modeLabel: Record<string, string> = {
  cheapest: 'Cheapest',
  greenest: 'Greenest',
  fastest: 'Fastest',
  balanced: 'Balanced',
};
