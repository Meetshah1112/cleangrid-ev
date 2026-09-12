import type { Site } from '@cleangrid/shared';
import { describe, expect, it, vi } from 'vitest';
import { LiveForecastProvider, renewableFromWeather, shareFromCarbon } from './live';

const startMs = Date.parse('2026-09-12T10:00:00Z');

const site: Site = {
  id: 'site',
  name: 'Riverside',
  timezone: 'Europe/London',
  country: 'GB',
  lat: 51.5,
  lng: -0.12,
  regionCode: 'C',
  gridConnectionKw: 65,
  demandChargePerKwMonth: 12,
  currency: 'GBP',
  defaultMode: 'balanced',
  baseLoadKw: Array<number>(24).fill(10),
};

const halfHours = (count: number, from = startMs): string[] =>
  Array.from({ length: count }, (_, index) => new Date(from + index * 1_800_000).toISOString());

interface FetchOverrides {
  carbon?: unknown;
  price?: unknown;
  mix?: unknown;
  weather?: unknown;
  fail?: string[];
  from?: number;
}

/** A fetch that answers each API by hostname, so one source can be broken on purpose. */
function fakeFetch(overrides: FetchOverrides = {}) {
  const from = overrides.from ?? startMs;
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const host = new URL(url).host;
    if (overrides.fail?.some((part) => url.includes(part))) {
      return new Response('nope', { status: 503 });
    }
    if (host.includes('carbonintensity') && url.includes('/generation/')) {
      return Response.json(overrides.mix ?? { data: [] });
    }
    if (host.includes('carbonintensity')) {
      return Response.json(
        overrides.carbon ?? {
          data: halfHours(6, from).map((periodStart, index) => ({
            from: periodStart,
            intensity: { forecast: 200 + index * 50, actual: index === 0 ? 180 : null },
          })),
        },
      );
    }
    if (host.includes('octopus')) {
      return Response.json(
        overrides.price ?? {
          results: halfHours(6, from).map((validFrom, index) => ({ valid_from: validFrom, value_inc_vat: 20 + index })),
        },
      );
    }
    if (host.includes('open-meteo')) {
      return Response.json(
        overrides.weather ?? {
          hourly: {
            time: Array.from({ length: 4 }, (_, index) => new Date(from + index * 3_600_000).toISOString().slice(0, 16)),
            shortwave_radiation: [450, 450, 200, 0],
            wind_speed_10m: [20, 20, 30, 30],
          },
        },
      );
    }
    return new Response('unexpected', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('LiveForecastProvider', () => {
  it('reads carbon, price and renewable share from the live APIs', async () => {
    const provider = new LiveForecastProvider({ fetchImpl: fakeFetch() });
    const snapshot = await provider.fetch(site, startMs, 3);

    expect(snapshot.sources.carbon).toBe('National Grid ESO');
    expect(snapshot.sources.price).toBe('Octopus Agile');
    // Measured intensity wins over the forecast for a period that has already happened.
    expect(snapshot.carbon.values[0]).toBe(180);
    expect(snapshot.carbon.values[1]).toBe(250);
    // Pence per kWh becomes pounds per kWh.
    expect(snapshot.price.values[0]).toBeCloseTo(0.2, 9);
    expect(snapshot.actualCarbon?.values[0]).toBe(180);
    expect(snapshot.renewable.values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(snapshot.notes).toEqual([]);
  });

  it('prefers the measured generation mix for periods that have already happened', async () => {
    // The mix endpoint only has data for the past, so this window starts two hours ago.
    const pastStart = Math.floor((Date.now() - 2 * 3_600_000) / 1_800_000) * 1_800_000;
    const provider = new LiveForecastProvider({
      fetchImpl: fakeFetch({
        from: pastStart,
        mix: {
          data: [
            {
              from: new Date(pastStart).toISOString(),
              generationmix: [
                { fuel: 'wind', perc: 40 },
                { fuel: 'solar', perc: 10 },
                { fuel: 'gas', perc: 45 },
                { fuel: 'nuclear', perc: 5 },
              ],
            },
          ],
        },
      }),
    });
    const snapshot = await provider.fetch(site, pastStart, 3);
    expect(snapshot.renewable.values[0]).toBeCloseTo(0.5, 9);
    expect(snapshot.sources.renewable).toContain('ESO mix');
  });

  it('falls back per source and says which one failed', async () => {
    const provider = new LiveForecastProvider({ fetchImpl: fakeFetch({ fail: ['octopus'] }) });
    const snapshot = await provider.fetch(site, startMs, 3);
    expect(snapshot.sources.carbon).toBe('National Grid ESO');
    expect(snapshot.sources.price).toBe('synthetic');
    expect(snapshot.notes.join(' ')).toMatch(/agile prices unavailable/);
  });

  it('still returns a usable snapshot when every source is down', async () => {
    const provider = new LiveForecastProvider({ fetchImpl: fakeFetch({ fail: ['http'] }) });
    const snapshot = await provider.fetch(site, startMs, 3);
    expect(snapshot.carbon.values.length).toBeGreaterThan(0);
    expect(snapshot.sources.carbon).toBe('synthetic');
    expect(snapshot.notes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('renewable share estimation', () => {
  it('reads carbon intensity backwards into a share', () => {
    expect(shareFromCarbon(30)).toBe(1);
    expect(shareFromCarbon(450)).toBe(0);
    expect(shareFromCarbon(240)).toBeCloseTo(0.5, 2);
  });

  it('rises with sun and wind, and ignores wind below cut-in', () => {
    const calm = renewableFromWeather(0, 5);
    const sunny = renewableFromWeather(900, 5);
    const windy = renewableFromWeather(0, 45);
    expect(calm).toBeCloseTo(0.1, 6);
    expect(sunny).toBeGreaterThan(calm);
    expect(windy).toBeGreaterThan(sunny);
    expect(renewableFromWeather(900, 60)).toBeLessThanOrEqual(1);
  });
});
