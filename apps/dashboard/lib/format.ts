/** Formatting, and the one carbon colour scale the whole console reads by. */

export const DEFAULT_TZ = process.env.NEXT_PUBLIC_SITE_TZ ?? 'Europe/London';

const formatters = new Map<string, Intl.DateTimeFormat>();

function timeFormat(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  formatters.set(timeZone, created);
  return created;
}

export const clockTime = (ms: number, timeZone: string = DEFAULT_TZ): string => timeFormat(timeZone).format(new Date(ms));

export const kw = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined ? '--' : value.toFixed(digits);

export const money = (value: number | null | undefined, currency = 'GBP'): string =>
  value === null || value === undefined
    ? '--'
    : new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: value >= 1000 ? 0 : 2,
      }).format(value);

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
 * Carbon intensity to colour, used identically by every chart and tile so the same green always
 * means the same thing.
 */
export function carbonColor(gPerKwh: number): string {
  const stops: [number, [number, number, number]][] = [
    [120, [31, 138, 92]],
    [250, [106, 168, 79]],
    [400, [201, 138, 26]],
    [550, [199, 106, 45]],
    [750, [192, 57, 43]],
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
