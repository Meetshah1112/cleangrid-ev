/**
 * Formatting. The site decides the time zone, the currency and the locale, not the phone — a driver
 * in Bengaluru should see rupees and a 12-hour clock while one in London sees pounds and 24-hour,
 * from the same build, because both are reading their own site's numbers.
 */

const LOCALES: Record<string, string> = { GB: 'en-GB', IN: 'en-IN' };

let timezone = process.env.EXPO_PUBLIC_SITE_TZ ?? 'Europe/London';
let currency = 'GBP';
let locale = 'en-GB';

export const setLocale = (nextTimezone: string, nextCurrency: string, country = 'GB'): void => {
  timezone = nextTimezone;
  currency = nextCurrency;
  locale = LOCALES[country.toUpperCase()] ?? 'en-GB';
};

export const getTimezone = (): string => timezone;
export const getCurrency = (): string => currency;
export const getLocale = (): string => locale;

/** Hour format is left to the locale: 23:00 in London, 11:00 pm in Bengaluru. */
export function clockTime(ms: number): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

export function localHour(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(
    new Date(ms),
  );
  return Number(parts);
}

export const money = (value: number): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);

/** A calendar stamp in the site's time zone, split so the day can be stacked over the month. */
export function dayStamp(ms: number): { day: string; month: string } {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: timezone, day: '2-digit', month: 'short' }).formatToParts(
    new Date(ms),
  );
  return {
    day: parts.find((part) => part.type === 'day')?.value ?? '',
    month: parts.find((part) => part.type === 'month')?.value ?? '',
  };
}

export const monthLabel = (ms: number): string =>
  new Intl.DateTimeFormat(locale, { timeZone: timezone, month: 'long' }).format(new Date(ms));

export const weekday = (ms: number): string =>
  new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'long' }).format(new Date(ms));

/**
 * Is this timestamp in the same calendar month, in the site's time zone, as the reference?
 * The locale is pinned here on purpose: this builds a comparison key, never anything displayed.
 */
export function sameMonth(ms: number, referenceMs: number): boolean {
  const key = (value: number): string =>
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit' }).format(new Date(value));
  return key(ms) === key(referenceMs);
}

export const percent = (share: number): string => `${Math.round(share * 100)}%`;
export const kwh = (value: number): string => `${value.toFixed(1)} kWh`;

export function countdown(toMs: number, nowMs: number): string {
  const minutes = Math.round((toMs - nowMs) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A number people can picture, rather than a mass of gas. */
export function co2Equivalent(kg: number): string {
  if (kg <= 0.01) return 'about the same as charging on plug-in';
  const carKm = kg / 0.12;
  if (carKm < 2) return `about ${(kg * 1000).toFixed(0)} g, roughly a kettle's worth`;
  return `about the same as ${carKm.toFixed(0)} km not driven in a petrol car`;
}
