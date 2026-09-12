import { MS_PER_HOUR, MS_PER_MINUTE, clamp, makeSeries, type ForecastSnapshot, type Site, type StepSeries } from '@cleangrid/shared';
import type { Logger } from '../logger';
import type { ForecastProvider } from './service';
import { gridNameFor, gridProfileFor, mapsZoneFor, syntheticForecast, type GridProfile } from './synthetic';
import { applyWeather, toHubHeight, weatherFactor, type WeatherPoint } from './weather';

/**
 * Real grid data, all keyless:
 *   carbon      National Grid ESO Carbon Intensity API (30-minute forecast and measured actuals)
 *   price       Octopus Agile half-hourly import prices for the site's distribution region
 *   renewables  measured generation mix where there is one, otherwise implied by a measured carbon
 *               intensity, otherwise the grid's modelled share scaled by live Open-Meteo weather
 *
 * Each source falls back independently: one dead API degrades one signal, and the snapshot says
 * so in its notes rather than quietly pretending. Every source names itself as a noun phrase with
 * no comma in it, because these strings are read into sentences and listed beside one another.
 *
 * Two of those three feeds are British, which for a long time made this class British too. It is
 * not any more: every site gets live weather wherever it is, and that weather is read against the
 * grid the site actually sits on rather than against a single set of thresholds. What a still,
 * bright afternoon means depends entirely on whether the grid beneath it was built out of sun or
 * out of wind, and Gujarat and Great Britain answer that differently.
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
  /** Optional Electricity Maps token, which unlocks live carbon outside Great Britain. */
  readonly electricityMapsToken?: string;
  /** Overrides the zone a site's grid profile would ask for, for a token granted on another. */
  readonly electricityMapsZone?: string;
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

    // National Grid and Octopus are British. Open-Meteo and Electricity Maps are not, so every
    // site gets live weather, and a site outside GB gets live carbon too when a token is present.
    const isGb = site.country.toUpperCase() === 'GB';
    const nothing = <T,>(): Promise<T[]> => Promise.resolve([]);

    const [carbonResult, priceResult, mixResult, weatherResult, mapsResult] = await Promise.allSettled([
      isGb ? this.carbonReadings(startMs, endMs) : nothing<CarbonReading>(),
      isGb ? this.agilePrices(site, startMs, endMs) : nothing<{ startMs: number; value: number }>(),
      isGb ? this.generationMix(startMs, Math.min(endMs, Date.now())) : nothing<{ startMs: number; value: number }>(),
      this.weather(site, startMs, endMs),
      this.electricityMaps(site, startMs, endMs),
    ]);

    const carbonReadings = carbonResult.status === 'fulfilled' ? carbonResult.value : [];
    if (carbonResult.status === 'rejected') notes.push(`carbon intensity unavailable (${reason(carbonResult)})`);

    const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : [];
    if (weatherResult.status === 'rejected') notes.push(`weather unavailable (${reason(weatherResult)})`);

    // How today compares with a normal day on this particular grid, hour by hour. Everything the
    // weather is allowed to say about carbon and renewables goes through this one number.
    const profile = gridProfileFor(site.country, site.regionCode);
    const gridName = gridNameFor(site.country, site.regionCode);
    const factors = alignedSeries(
      weather.map((point) => ({ startMs: point.startMs, value: weatherFactor(profile, site.lat, site.lng, point) })),
      startMs,
      steps,
    );

    const maps = mapsResult.status === 'fulfilled' ? mapsResult.value : [];
    if (mapsResult.status === 'rejected') notes.push(`electricity maps unavailable (${reason(mapsResult)})`);

    const measuredMix = mixResult.status === 'fulfilled' ? mixResult.value : [];

    // Carbon, in order of how directly it was measured.
    let carbonSource = `a model of the ${gridName} grid`;
    // Starts false to match that label. Only a feed that actually measured this grid raises it,
    // so a new branch added below cannot claim a measurement by forgetting to say otherwise.
    let carbonIsMeasured = false;
    let carbon = fallback.carbon;
    const esoCarbon = alignedSeries(
      carbonReadings.flatMap((reading) => {
        const value = reading.actual ?? reading.forecast;
        return value === null ? [] : [{ startMs: reading.startMs, value }];
      }),
      startMs,
      steps,
    );
    if (esoCarbon) {
      carbon = esoCarbon;
      carbonSource = 'National Grid ESO';
      carbonIsMeasured = true;
    } else {
      const mapsCarbon = alignedSeries(maps, startMs, steps);
      if (mapsCarbon) {
        carbon = mapsCarbon;
        carbonSource = 'Electricity Maps';
        carbonIsMeasured = true;
      } else {
        // No carbon feed for this grid. Take the modelled shape and correct it with live weather:
        // a cloudy midday on a solar-heavy grid is dirtier than the calendar alone would say.
        if (factors) {
          carbon = correctByWeather(profile, fallback.carbon, fallback.renewable, factors);
          carbonSource = `a model of the ${gridName} grid corrected by live weather`;
        }
      }
    }

    const actualPoints = carbonReadings.flatMap((reading) =>
      reading.actual === null ? [] : [{ startMs: reading.startMs, value: reading.actual }],
    );
    const actualCarbon =
      actualPoints.length > 0 ? alignedSeries(actualPoints, startMs, actualSteps(actualPoints, startMs)) : null;

    let price = fallback.price;
    let priceSource = `the ${gridName} time-of-day tariff`;
    if (priceResult.status === 'fulfilled' && priceResult.value.length > 0) {
      price = alignedSeries(priceResult.value, startMs, steps) ?? fallback.price;
      priceSource = 'Octopus Agile';
    } else if (isGb) {
      notes.push(
        `agile prices unavailable (${priceResult.status === 'rejected' ? reason(priceResult) : 'no rates returned'})`,
      );
    }

    const renewable = this.renewableSeries({
      profile,
      modelShare: fallback.renewable,
      carbon,
      carbonIsMeasured,
      measuredMix,
      factors,
      startMs,
      steps,
    });

    return {
      generatedMs: Date.now(),
      carbon,
      price,
      renewable,
      actualCarbon,
      sources: {
        carbon: carbonSource,
        price: priceSource,
        renewable:
          measuredMix.length > 0
            ? 'ESO mix and Open-Meteo'
            : weather.length === 0
              ? `a model of the ${gridName} grid`
              : carbonIsMeasured
                ? 'measured carbon and Open-Meteo'
                : `a model of the ${gridName} grid scaled by Open-Meteo irradiance and wind`,
      },
      notes,
    };
  }

  /**
   * Electricity Maps, when a token is configured. It covers roughly seventy grids including India,
   * which is the gap worth filling: National Grid publishes Britain carbon data for nothing, and no
   * keyless equivalent exists elsewhere. With no token this returns nothing and the caller models it.
   */
  private async electricityMaps(
    site: Site,
    startMs: number,
    endMs: number,
  ): Promise<{ startMs: number; value: number }[]> {
    const token = this.options.electricityMapsToken;
    if (!token || site.country.toUpperCase() === 'GB') return [];
    // By zone where the grid has one, because a free token is granted for a named zone and the
    // coordinate endpoint it would otherwise use is refused on that tier. Coordinates remain the
    // fallback for a grid we have not mapped, where a paid token would still answer.
    const zone = this.options.electricityMapsZone ?? mapsZoneFor(site.country, site.regionCode);
    const where = zone ? `zone=${encodeURIComponent(zone)}` : `lat=${site.lat}&lon=${site.lng}`;
    const url = `https://api.electricitymap.org/v3/carbon-intensity/forecast?${where}`;
    const body = await this.getJson<{ forecast?: { datetime: string; carbonIntensity: number }[] }>(url, {
      'auth-token': token,
    });
    return (body.forecast ?? [])
      .map((entry) => ({ startMs: Date.parse(entry.datetime), value: entry.carbonIntensity }))
      .filter(
        (point) =>
          Number.isFinite(point.startMs) && point.startMs <= endMs && point.startMs >= startMs - MS_PER_HOUR,
      );
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
  /**
   * Open-Meteo, for anywhere on earth and without a key. Wind is asked for at 100 m as well as at
   * 10 m: turbines work at hub height, output goes with the cube of speed, and the difference
   * between the two heights is therefore not a detail. Where the 100 m series is missing the 10 m
   * one is raised to hub height instead.
   */
  private async weather(site: Site, startMs: number, endMs: number): Promise<WeatherPoint[]> {
    const days = Math.min(7, Math.max(1, Math.ceil((endMs - startMs) / (24 * MS_PER_HOUR)) + 1));
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${site.lat}&longitude=${site.lng}` +
      `&hourly=shortwave_radiation,wind_speed_10m,wind_speed_100m&forecast_days=${days}&timezone=UTC`;
    const body = await this.getJson<{
      hourly?: {
        time?: string[];
        shortwave_radiation?: number[];
        wind_speed_10m?: number[];
        wind_speed_100m?: number[];
      };
    }>(url);
    const hourly = body.hourly;
    const times = hourly?.time ?? [];
    return times.map((time, index) => {
      const atHub = hourly?.wind_speed_100m?.[index];
      const atStation = hourly?.wind_speed_10m?.[index] ?? 0;
      return {
        startMs: Date.parse(`${time}Z`),
        irradianceWm2: hourly?.shortwave_radiation?.[index] ?? 0,
        windSpeedKph: atHub ?? toHubHeight(atStation),
      };
    });
  }

  /**
   * How much of the grid is running on renewables, in the order of how well we know.
   *
   * A measured mix is the truth and is used as it stands. Failing that, a measured carbon
   * intensity implies a share through the grid's own curve. Failing both, the modelled share is
   * scaled by how today's weather compares with a normal day here. The three cases genuinely
   * differ in confidence, and the snapshot's source line says which one produced the number.
   */
  private renewableSeries(input: {
    profile: GridProfile;
    modelShare: StepSeries;
    carbon: StepSeries;
    carbonIsMeasured: boolean;
    measuredMix: readonly { startMs: number; value: number }[];
    factors: StepSeries | null;
    startMs: number;
    steps: number;
  }): StepSeries {
    const stepMs = STEP_MINUTES * MS_PER_MINUTE;
    const measured = new Map(input.measuredMix.map((point) => [Math.floor(point.startMs / stepMs) * stepMs, point.value]));
    const values = Array.from({ length: input.steps }, (_, index) => {
      const slotMs = input.startMs + index * stepMs;
      const fromMeasurement = measured.get(slotMs);
      if (fromMeasurement !== undefined) return fromMeasurement;

      const modelled = input.modelShare.values[index] ?? 0;
      const factor = input.factors?.values[index] ?? 1;
      const fromWeather = applyWeather(input.profile, modelled, factor);
      if (!input.carbonIsMeasured) return fromWeather;

      // Carbon was measured for this grid, so let it lead and let the weather adjust the edges.
      const fromCarbon = shareFromCarbon(input.profile, input.carbon.values[index] ?? 300);
      return clamp(0.7 * fromCarbon + 0.3 * fromWeather, 0, 1);
    });
    return makeSeries(input.startMs, STEP_MINUTES, values);
  }

  private async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await this.doFetch(url, {
      signal: AbortSignal.timeout(this.options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json', ...headers },
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

/**
 * Bend a modelled carbon curve towards what the weather is actually doing.
 *
 * The model knows the shape of a normal day on this grid; the weather knows whether today is one.
 * The arithmetic follows from what carbon intensity is: emissions come from the part of generation
 * that is not renewable, so if renewables run at f times their usual share s, the fossil part goes
 * from 1 - s to 1 - s*f and the intensity moves with it.
 *
 * Bounded either way, because a correction should nudge a model rather than replace it, and
 * because near a fully renewable hour the ratio grows without limit.
 */
export function correctByWeather(
  profile: GridProfile,
  modelCarbon: StepSeries,
  modelShare: StepSeries,
  factors: StepSeries,
): StepSeries {
  const values = modelCarbon.values.map((carbon, index) => {
    const share = modelShare.values[index];
    const factor = factors.values[index];
    if (share === undefined || factor === undefined) return carbon;
    const fossilNormally = 1 - share;
    if (fossilNormally <= 0.05) return carbon;
    const fossilToday = 1 - applyWeather(profile, share, factor);
    return carbon * clamp(fossilToday / fossilNormally, 0.6, 1.4);
  });
  return makeSeries(modelCarbon.startMs, STEP_MINUTES, values);
}

/**
 * Carbon intensity read backwards into a renewable share, through this grid's own curves.
 *
 * There is no universal conversion: 400 gCO2/kWh is a filthy hour in Britain and a clean one in
 * Gujarat. What is portable is the relationship the grid's own profile already encodes between its
 * dirtiest hour and its cleanest, so the reading is placed on that scale. Extrapolation past
 * either end is allowed — a real feed can beat anything the model expected — but the result is
 * still a share, so it is held inside nought and one.
 */
export function shareFromCarbon(profile: GridProfile, gPerKwh: number): number {
  const carbons = profile.carbon.map(([, value]) => value);
  const shares = profile.renewable.map(([, value]) => value);
  const dirtiest = Math.max(...carbons);
  const cleanest = Math.min(...carbons);
  const span = dirtiest - cleanest;
  if (span <= 0) return clamp(Math.max(...shares), 0, 1);
  const position = (dirtiest - gPerKwh) / span;
  const lowest = Math.min(...shares);
  const highest = Math.max(...shares);
  return clamp(lowest + position * (highest - lowest), 0, 1);
}
