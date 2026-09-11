import { MS_PER_HOUR, MS_PER_MINUTE, clamp, makeSeries, type ForecastSnapshot, type Site, type StepSeries } from '@cleangrid/shared';
import type { Logger } from '../logger';
import type { ForecastProvider } from './service';
import { syntheticForecast } from './synthetic';

/**
 * Real grid data, all keyless:
 *   carbon      National Grid ESO Carbon Intensity API (30-minute forecast and measured actuals)
 *   price       Octopus Agile half-hourly import prices for the site's distribution region
 *   renewables  measured generation mix for the past, and for the future a share implied by the
 *               carbon forecast, nudged by Open-Meteo irradiance and wind
 *
 * Each source falls back independently: one dead API degrades one signal, and the snapshot says
 * so in its notes rather than quietly pretending.
 */

const STEP_MINUTES = 30;
const REQUEST_TIMEOUT_MS = 8_000;
/** Fuels the Carbon Intensity API reports that count as renewable generation. */
const RENEWABLE_FUELS = new Set(['wind', 'solar', 'hydro', 'biomass']);

export interface LiveForecastOptions {
  readonly fetchImpl?: typeof fetch;
  readonly logger?: Logger;
  readonly timeoutMs?: number;
  /** Octopus product to price against. */
  readonly agileProduct?: string;
}

interface CarbonReading {
  readonly startMs: number;
  readonly forecast: number | null;
  readonly actual: number | null;
}

const isoMinute = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16)}Z`;

function alignedSeries(
  points: readonly { startMs: number; value: number }[],
  startMs: number,
  steps: number,
): StepSeries | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.startMs - b.startMs);
  const stepMs = STEP_MINUTES * MS_PER_MINUTE;
  const values: number[] = [];
  let cursor = 0;
  let last = sorted[0]?.value ?? 0;
  for (let index = 0; index < steps; index += 1) {
    const slotMs = startMs + index * stepMs;
    while (cursor < sorted.length && (sorted[cursor] as { startMs: number }).startMs <= slotMs) {
      last = (sorted[cursor] as { value: number }).value;
      cursor += 1;
    }
    values.push(last);
  }
  return makeSeries(startMs, STEP_MINUTES, values);
}

export class LiveForecastProvider implements ForecastProvider {
  readonly name = 'live';
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: LiveForecastOptions = {}) {
    this.doFetch = options.fetchImpl ?? fetch;
  }

  async fetch(site: Site, startMs: number, hours: number): Promise<ForecastSnapshot> {
    const steps = Math.ceil((hours * 60) / STEP_MINUTES);
    const endMs = startMs + hours * MS_PER_HOUR;
    const fallback = syntheticForecast(site, startMs, hours, STEP_MINUTES);
    const notes: string[] = [];

    const [carbonResult, priceResult, mixResult, weatherResult] = await Promise.allSettled([
      this.carbonReadings(startMs, endMs),
      this.agilePrices(site, startMs, endMs),
      this.generationMix(startMs, Math.min(endMs, Date.now())),
      this.weather(site, startMs, endMs),
    ]);

    const carbonReadings = carbonResult.status === 'fulfilled' ? carbonResult.value : [];
    if (carbonResult.status === 'rejected') notes.push(`carbon intensity unavailable (${reason(carbonResult)})`);

    const carbon =
      alignedSeries(
        carbonReadings.flatMap((reading) => {
          const value = reading.actual ?? reading.forecast;
          return value === null ? [] : [{ startMs: reading.startMs, value }];
        }),
        startMs,
        steps,
      ) ?? fallback.carbon;

    const actualPoints = carbonReadings.flatMap((reading) =>
      reading.actual === null ? [] : [{ startMs: reading.startMs, value: reading.actual }],
    );
    const actualCarbon = actualPoints.length > 0 ? alignedSeries(actualPoints, startMs, actualSteps(actualPoints, startMs)) : null;

    let price = fallback.price;
    if (priceResult.status === 'fulfilled' && priceResult.value.length > 0) {
      price = alignedSeries(priceResult.value, startMs, steps) ?? fallback.price;
    } else {
      notes.push(`agile prices unavailable (${priceResult.status === 'rejected' ? reason(priceResult) : 'no rates returned'})`);
    }

    const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : [];
    if (weatherResult.status === 'rejected') notes.push(`weather unavailable (${reason(weatherResult)})`);
    const measuredMix = mixResult.status === 'fulfilled' ? mixResult.value : [];

    const renewable = this.renewableSeries({ carbon, measuredMix, weather, startMs, steps }) ?? fallback.renewable;

    return {
      generatedMs: Date.now(),
      carbon,
      price,
      renewable,
      actualCarbon,
      sources: {
        carbon: carbonReadings.length > 0 ? 'National Grid ESO' : 'synthetic',
        price: priceResult.status === 'fulfilled' && priceResult.value.length > 0 ? 'Octopus Agile' : 'synthetic',
        renewable: measuredMix.length > 0 || weather.length > 0 ? 'ESO mix and Open-Meteo' : 'derived from carbon',
      },
      notes,
    };
  }

  /** 30-minute carbon intensity, forecast plus measured actuals where the period has passed. */
  private async carbonReadings(startMs: number, endMs: number): Promise<CarbonReading[]> {
    const url = `https://api.carbonintensity.org.uk/intensity/${isoMinute(startMs)}/${isoMinute(endMs)}`;
    const body = await this.getJson<{ data?: { from: string; intensity?: { forecast?: number; actual?: number } }[] }>(url);
    return (body.data ?? []).map((entry) => ({
      startMs: Date.parse(entry.from),
      forecast: entry.intensity?.forecast ?? null,
      actual: entry.intensity?.actual ?? null,
    }));
  }

  /** Half-hourly import prices, pence per kWh including VAT, converted to pounds. */
  private async agilePrices(site: Site, startMs: number, endMs: number): Promise<{ startMs: number; value: number }[]> {
    const product = this.options.agileProduct ?? 'AGILE-24-10-01';
    const tariff = `E-1R-${product}-${site.regionCode.toUpperCase()}`;
    const url =
      `https://api.octopus.energy/v1/products/${product}/electricity-tariffs/${tariff}/standard-unit-rates/` +
      `?period_from=${encodeURIComponent(new Date(startMs).toISOString())}` +
      `&period_to=${encodeURIComponent(new Date(endMs).toISOString())}&page_size=200`;
    const body = await this.getJson<{ results?: { value_inc_vat: number; valid_from: string }[] }>(url);
    return (body.results ?? []).map((rate) => ({ startMs: Date.parse(rate.valid_from), value: rate.value_inc_vat / 100 }));
  }

  /** Measured generation mix, which only exists for periods that have already happened. */
  private async generationMix(startMs: number, endMs: number): Promise<{ startMs: number; value: number }[]> {
    if (endMs <= startMs) return [];
    const url = `https://api.carbonintensity.org.uk/generation/${isoMinute(startMs)}/${isoMinute(endMs)}`;
    const body = await this.getJson<{ data?: { from: string; generationmix?: { fuel: string; perc: number }[] }[] }>(url);
    const entries = Array.isArray(body.data) ? body.data : [];
    return entries.map((entry) => ({
      startMs: Date.parse(entry.from),
      value: clamp(
        (entry.generationmix ?? [])
          .filter((fuel) => RENEWABLE_FUELS.has(fuel.fuel))
          .reduce((total, fuel) => total + fuel.perc, 0) / 100,
        0,
        1,
      ),
    }));
  }

  /** Hourly irradiance and wind, used to nudge the renewable share forecast. */
  private async weather(site: Site, startMs: number, endMs: number): Promise<{ startMs: number; value: number }[]> {
    const days = Math.min(7, Math.max(1, Math.ceil((endMs - startMs) / (24 * MS_PER_HOUR)) + 1));
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${site.lat}&longitude=${site.lng}` +
      `&hourly=shortwave_radiation,wind_speed_10m&forecast_days=${days}&timezone=UTC`;
    const body = await this.getJson<{
      hourly?: { time?: string[]; shortwave_radiation?: number[]; wind_speed_10m?: number[] };
    }>(url);
    const times = body.hourly?.time ?? [];
    return times.map((time, index) => ({
      startMs: Date.parse(`${time}Z`),
      value: renewableFromWeather(body.hourly?.shortwave_radiation?.[index] ?? 0, body.hourly?.wind_speed_10m?.[index] ?? 0),
    }));
  }

  /**
   * Measured mix where it exists, otherwise the share implied by the carbon forecast, nudged
   * towards what the weather suggests. Blending beats either alone: carbon intensity knows the
   * whole system, the weather knows what is about to happen to wind and sun.
   */
  private renewableSeries(input: {
    carbon: StepSeries;
    measuredMix: readonly { startMs: number; value: number }[];
    weather: readonly { startMs: number; value: number }[];
    startMs: number;
    steps: number;
  }): StepSeries | null {
    const stepMs = STEP_MINUTES * MS_PER_MINUTE;
    const measured = new Map(input.measuredMix.map((point) => [Math.floor(point.startMs / stepMs) * stepMs, point.value]));
    const weatherSeries = alignedSeries(input.weather, input.startMs, input.steps);
    const values = Array.from({ length: input.steps }, (_, index) => {
      const slotMs = input.startMs + index * stepMs;
      const fromMeasurement = measured.get(slotMs);
      if (fromMeasurement !== undefined) return fromMeasurement;
      const fromCarbon = shareFromCarbon(input.carbon.values[index] ?? 300);
      const fromWeather = weatherSeries?.values[index];
      return fromWeather === undefined ? fromCarbon : clamp(0.6 * fromCarbon + 0.4 * fromWeather, 0, 1);
    });
    return makeSeries(input.startMs, STEP_MINUTES, values);
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.doFetch(url, {
      signal: AbortSignal.timeout(this.options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
    return (await response.json()) as T;
  }
}

const reason = (result: PromiseRejectedResult): string => (result.reason as Error)?.message ?? 'unknown error';

function actualSteps(points: readonly { startMs: number }[], startMs: number): number {
  const last = points[points.length - 1]?.startMs ?? startMs;
  return Math.max(1, Math.round((last - startMs) / (STEP_MINUTES * MS_PER_MINUTE)) + 1);
}

/** Carbon intensity read backwards: about 30 gCO2/kWh is an all-renewable grid, 450 is none of it. */
export const shareFromCarbon = (gPerKwh: number): number => clamp((450 - gPerKwh) / (450 - 30), 0, 1);

/**
 * Renewable share suggested by the weather. Solar scales with irradiance against a clear-sky
 * maximum; wind follows the cube of speed between a cut-in and a rated speed, as turbines do.
 */
export function renewableFromWeather(irradianceWm2: number, windSpeedKph: number): number {
  const solar = clamp(irradianceWm2 / 900, 0, 1);
  const cutInKph = 11;
  const ratedKph = 45;
  const wind = windSpeedKph <= cutInKph ? 0 : clamp(((windSpeedKph - cutInKph) / (ratedKph - cutInKph)) ** 3, 0, 1);
  return clamp(0.1 + 0.3 * solar + 0.5 * wind, 0, 1);
}
