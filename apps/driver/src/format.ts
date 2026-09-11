export const TIMEZONE = process.env.EXPO_PUBLIC_SITE_TZ ?? 'Europe/London';

export function clockTime(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

export const money = (value: number): string => `£${value.toFixed(2)}`;
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
  if (kg <= 0) return 'about the same as charging on plug-in';
  const carKm = kg / 0.12;
  if (carKm < 2) return `about ${(kg * 1000).toFixed(0)} g, roughly a kettle's worth`;
  return `about the same as ${carKm.toFixed(0)} km not driven in a petrol car`;
}
