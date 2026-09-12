/**
 * Formatting. The site decides the time zone, the currency and the locale, not the phone — a driver
 * in Gandhinagar should see rupees and a 12-hour clock while one in London sees pounds and 24-hour,
 * from the same build, because both are reading their own site's numbers.
 */

const LOCALES: Record<string, string> = { GB: 'en-GB', IN: 'en-IN' };

// These hold only until the first site loads, a few hundred milliseconds in. They match the
// default site so that first frame is not briefly in the wrong currency.
let timezone = process.env.EXPO_PUBLIC_SITE_TZ ?? 'Asia/Kolkata';
let currency = 'INR';
let locale = 'en-IN';

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

/**
 * A time as short as an axis label can be: "10 am" where the site reads a 12-hour clock, "10:00"
 * where it reads 24-hour. The full "10:00 am" is too wide for a phone's time axis.
 */
export function axisTime(ms: number): string {
  const twelve = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: 'numeric' }).resolvedOptions().hour12 === true;
  return twelve
    ? // Intl separates "10" from "am" with a narrow no-break space, which some Android fonts draw as a box.
      new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: 'numeric' }).format(new Date(ms)).replace(/[  ]/g, ' ').toLowerCase()
    : clockTime(ms);
}

/** The local hour with minutes as a fraction, for placing a moment in a drawn day. */
export function localHourExact(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(
    new Date(ms),
  );
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour + minute / 60;
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
