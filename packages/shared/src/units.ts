/** Unit constants and conversions. Field names carry their unit (kW, kWh, W, Wh, Ms). */

export const W_PER_KW = 1000;
export const WH_PER_KWH = 1000;
export const G_PER_KG = 1000;
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export const kwToW = (kw: number): number => kw * W_PER_KW;
export const wToKw = (w: number): number => w / W_PER_KW;
export const kwhToWh = (kwh: number): number => kwh * WH_PER_KWH;
export const whToKwh = (wh: number): number => wh / WH_PER_KWH;
export const gToKg = (g: number): number => g / G_PER_KG;
export const msToHours = (ms: number): number => ms / MS_PER_HOUR;
export const hoursToMs = (hours: number): number => hours * MS_PER_HOUR;

export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
