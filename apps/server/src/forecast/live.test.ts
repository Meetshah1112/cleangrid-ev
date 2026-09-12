import { makeSeries, type Site } from '@cleangrid/shared';
import { describe, expect, it, vi } from 'vitest';
import { correctByWeather, LiveForecastProvider, shareFromCarbon } from './live';
import { gridProfileFor } from './synthetic';

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
    // The label names the model that stood in, not just that something did.
    expect(snapshot.sources.price).toBe('the GB time-of-day tariff');
    expect(snapshot.notes.join(' ')).toMatch(/agile prices unavailable/);
  });

  it('gives a site outside Great Britain live weather rather than a bare model', async () => {
    // National Grid and Octopus are British. A site elsewhere must still end up with something
    // measured in it, or "real-time grid data" is a claim the product cannot support.
    const india = { ...site, country: 'IN', lat: 12.9352, lng: 77.6245 };
    const provider = new LiveForecastProvider({ fetchImpl: fakeFetch({}) });
    const snapshot = await provider.fetch(india, startMs, 3);

    expect(snapshot.sources.renewable).toContain('Open-Meteo');
    expect(snapshot.sources.carbon).toMatch(/corrected by live weather/);
    // Its own grid, not Britain's: a coal-led baseline, not a wind-led one.
    expect(Math.max(...snapshot.carbon.values)).toBeGreaterThan(400);
  });

  it('does not call the British feeds for a site outside Great Britain', async () => {
    const called: string[] = [];
    const inner = fakeFetch({});
    const spy: typeof fetch = (input, init) => {
      called.push(String(input));
      return inner(input, init);
    };
    const india = { ...site, country: 'IN', lat: 12.9352, lng: 77.6245 };
    await new LiveForecastProvider({ fetchImpl: spy }).fetch(india, startMs, 3);

    expect(called.some((url) => url.includes('carbonintensity.org.uk'))).toBe(false);
    expect(called.some((url) => url.includes('octopus.energy'))).toBe(false);
    expect(called.some((url) => url.includes('open-meteo.com'))).toBe(true);
  });

  it('still returns a usable snapshot when every source is down', async () => {
    const provider = new LiveForecastProvider({ fetchImpl: fakeFetch({ fail: ['http'] }) });
    const snapshot = await provider.fetch(site, startMs, 3);
    expect(snapshot.carbon.values.length).toBeGreaterThan(0);
    expect(snapshot.sources.carbon).toMatch(/^a model of the GB grid/);
    expect(snapshot.notes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('correcting a modelled carbon curve with the weather', () => {
  const gujarat = gridProfileFor('IN', 'GJ');
  // One noon hour: 330 g on a grid running 62% renewable, which leaves 38% of it burning fuel.
  const carbon = makeSeries(0, 30, [330]);
  const share = makeSeries(0, 30, [0.62]);
  const factorsOf = (value: number) => makeSeries(0, 30, [value]);

  it('leaves the curve alone on an ordinary day', () => {
    expect(correctByWeather(gujarat, carbon, share, factorsOf(1)).values[0]).toBeCloseTo(330, 6);
  });

  it('cleans the curve when the weather beats the model', () => {
    const better = correctByWeather(gujarat, carbon, share, factorsOf(1.3)).values[0] as number;
    expect(better).toBeLessThan(330);
  });

  it('dirties the curve when the weather falls short', () => {
    const worse = correctByWeather(gujarat, carbon, share, factorsOf(0.4)).values[0] as number;
    expect(worse).toBeGreaterThan(330);
  });

  it('nudges rather than replaces, however extreme the weather', () => {
    for (const factor of [0, 0.05, 5, 50]) {
      const value = correctByWeather(gujarat, carbon, share, factorsOf(factor)).values[0] as number;
      expect(value).toBeGreaterThanOrEqual(330 * 0.6 - 0.001);
      expect(value).toBeLessThanOrEqual(330 * 1.4 + 0.001);
    }
  });

  it('holds still on an hour the model already calls fully renewable', () => {
    // There is no fossil generation left to scale, and the ratio would run away.
    const allRenewable = makeSeries(0, 30, [0.99]);
    const value = correctByWeather(gujarat, makeSeries(0, 30, [20]), allRenewable, factorsOf(0.2)).values[0];
    expect(value).toBe(20);
  });
});

describe('Electricity Maps', () => {
  const called = (spy: string[]) => spy.find((url) => url.includes('electricitymap.org')) ?? '';

  const spyFetch = (urls: string[]): typeof fetch => {
    const inner = fakeFetch({});
    return (input, init) => {
      urls.push(String(input));
      return inner(input, init);
    };
  };

  it('is not called at all without a token', async () => {
    const urls: string[] = [];
    await new LiveForecastProvider({ fetchImpl: spyFetch(urls) }).fetch(
      { ...site, country: 'IN', regionCode: 'GJ' },
      startMs,
      3,
    );
    expect(called(urls)).toBe('');
  });

  it('asks for the zone its grid sits in, not for coordinates', async () => {
    // A free token is granted per named zone; the coordinate endpoint is refused on that tier, so
    // asking by lat/lon would leave every Indian site modelled however valid the token was.
    const urls: string[] = [];
    await new LiveForecastProvider({ fetchImpl: spyFetch(urls), electricityMapsToken: 'test' }).fetch(
      { ...site, country: 'IN', regionCode: 'GJ' },
      startMs,
      3,
    );
    expect(called(urls)).toContain('zone=IN-WE');
    expect(called(urls)).not.toContain('lat=');
  });

  it('sends a Karnataka site to the southern zone instead', async () => {
    const urls: string[] = [];
    await new LiveForecastProvider({ fetchImpl: spyFetch(urls), electricityMapsToken: 'test' }).fetch(
      { ...site, country: 'IN', regionCode: 'KA' },
      startMs,
      3,
    );
    expect(called(urls)).toContain('zone=IN-SO');
  });

  it('honours a configured zone over the one the grid would pick', async () => {
    const urls: string[] = [];
    await new LiveForecastProvider({
      fetchImpl: spyFetch(urls),
      electricityMapsToken: 'test',
      electricityMapsZone: 'IN',
    }).fetch({ ...site, country: 'IN', regionCode: 'GJ' }, startMs, 3);
    expect(called(urls)).toContain('zone=IN');
  });

  it('falls back to coordinates for a grid with no zone of its own', async () => {
    const urls: string[] = [];
    await new LiveForecastProvider({ fetchImpl: spyFetch(urls), electricityMapsToken: 'test' }).fetch(
      { ...site, country: 'FR', regionCode: 'IDF' },
      startMs,
      3,
    );
    expect(called(urls)).toContain('lat=');
  });

  it('leaves Great Britain to National Grid, which measures it for nothing', async () => {
    const urls: string[] = [];
    await new LiveForecastProvider({ fetchImpl: spyFetch(urls), electricityMapsToken: 'test' }).fetch(site, startMs, 3);
    expect(called(urls)).toBe('');
  });
});

describe('source names', () => {
  it('names every source as one phrase with no comma in it', async () => {
    // These strings are read into a sentence ("carbon from X, price from Y") and listed beside one
    // another. A comma inside one makes both unreadable, so it is not allowed inside one.
    const provider = new LiveForecastProvider({ fetchImpl: fakeFetch({}) });
    for (const country of ['GB', 'IN']) {
      const snapshot = await provider.fetch({ ...site, country }, startMs, 3);
      for (const [signal, name] of Object.entries(snapshot.sources)) {
        expect(name, `${country} ${signal}: "${name}"`).not.toContain(',');
        expect(name.length, `${country} ${signal}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('renewable share estimation', () => {
  const britain = gridProfileFor('GB');
  const gujarat = gridProfileFor('IN', 'GJ');

  it('reads carbon intensity backwards into a share', () => {
    const dirty = shareFromCarbon(britain, 690);
    const clean = shareFromCarbon(britain, 190);
    expect(clean).toBeGreaterThan(dirty);
    expect(dirty).toBeGreaterThanOrEqual(0);
    expect(clean).toBeLessThanOrEqual(1);
  });

  it('reads the same number differently on two grids', () => {
    // 400 g is a poor hour in Britain and a good one in Gujarat. A single scale cannot say both,
    // which is exactly the bug this replaced: an Indian grid never reached the British clean end,
    // so its renewable share was pinned near zero all day.
    expect(shareFromCarbon(britain, 400)).toBeLessThan(shareFromCarbon(gujarat, 400));
    expect(shareFromCarbon(gujarat, 400)).toBeGreaterThan(0.3);
  });

  it('stays a share however far past the model a real feed goes', () => {
    expect(shareFromCarbon(britain, 5)).toBeLessThanOrEqual(1);
    expect(shareFromCarbon(britain, 1200)).toBeGreaterThanOrEqual(0);
    expect(shareFromCarbon(gujarat, 0)).toBeLessThanOrEqual(1);
  });
});
