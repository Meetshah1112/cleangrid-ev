import { describe, expect, it } from 'vitest';
import { gridProfileFor } from './synthetic';
import {
  applyWeather,
  clearnessIndex,
  clearSkyIrradiance,
  solarElevationSin,
  toHubHeight,
  weatherFactor,
  windCapacityFactor,
} from './weather';

/**
 * Solar geometry is the one part of this system with answers known in advance, so it is checked
 * against them: the equinox, the tropics, the difference between a London noon and an Ahmedabad
 * one. If these drift, every renewable figure outside Great Britain drifts with them.
 */

const AHMEDABAD = { lat: 23.0225, lng: 72.5714 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

/** Solar noon at a longitude, near enough for these assertions. */
const noonMs = (day: string, lng: number): number => Date.parse(`${day}T12:00:00Z`) - (lng / 15) * 3_600_000;

describe('solar position', () => {
  it('puts the sun overhead at the equator at the equinox', () => {
    const sin = solarElevationSin(0, 0, noonMs('2026-03-20', 0));
    expect(sin).toBeGreaterThan(0.99);
  });

  it('puts the sun below the horizon at local midnight', () => {
    const midnight = noonMs('2026-09-12', AHMEDABAD.lng) + 12 * 3_600_000;
    expect(solarElevationSin(AHMEDABAD.lat, AHMEDABAD.lng, midnight)).toBeLessThan(0);
  });

  it('has the sun higher over Ahmedabad than over London on the same September day', () => {
    const gujarat = solarElevationSin(AHMEDABAD.lat, AHMEDABAD.lng, noonMs('2026-09-12', AHMEDABAD.lng));
    const britain = solarElevationSin(LONDON.lat, LONDON.lng, noonMs('2026-09-12', LONDON.lng));
    expect(gujarat).toBeGreaterThan(britain);
  });
});

describe('clear-sky irradiance', () => {
  it('reaches roughly a kilowatt per square metre at a tropical noon', () => {
    const peak = clearSkyIrradiance(AHMEDABAD.lat, AHMEDABAD.lng, noonMs('2026-09-12', AHMEDABAD.lng));
    expect(peak).toBeGreaterThan(850);
    expect(peak).toBeLessThan(1100);
  });

  it('is zero at night', () => {
    const midnight = noonMs('2026-09-12', AHMEDABAD.lng) + 12 * 3_600_000;
    expect(clearSkyIrradiance(AHMEDABAD.lat, AHMEDABAD.lng, midnight)).toBe(0);
  });

  it('is lower at a British noon than a Gujarati one in September', () => {
    expect(clearSkyIrradiance(LONDON.lat, LONDON.lng, noonMs('2026-09-12', LONDON.lng))).toBeLessThan(
      clearSkyIrradiance(AHMEDABAD.lat, AHMEDABAD.lng, noonMs('2026-09-12', AHMEDABAD.lng)),
    );
  });
});

describe('clearness index', () => {
  it('reads the same for a good day at either latitude, though the watts differ', () => {
    const gujaratNoon = noonMs('2026-09-12', AHMEDABAD.lng);
    const londonNoon = noonMs('2026-09-12', LONDON.lng);
    const gujaratCeiling = clearSkyIrradiance(AHMEDABAD.lat, AHMEDABAD.lng, gujaratNoon);
    const londonCeiling = clearSkyIrradiance(LONDON.lat, LONDON.lng, londonNoon);

    const sunnyGujarat = clearnessIndex(AHMEDABAD.lat, AHMEDABAD.lng, gujaratNoon, gujaratCeiling * 0.8);
    const sunnyLondon = clearnessIndex(LONDON.lat, LONDON.lng, londonNoon, londonCeiling * 0.8);

    expect(sunnyGujarat).toBeCloseTo(0.8, 2);
    expect(sunnyLondon).toBeCloseTo(0.8, 2);
    // The absolute figure that earned each of those is very different, which is the point.
    expect(gujaratCeiling).toBeGreaterThan(londonCeiling * 1.2);
  });

  it('has no answer at night rather than reporting a cloudy zero', () => {
    const midnight = noonMs('2026-09-12', AHMEDABAD.lng) + 12 * 3_600_000;
    expect(clearnessIndex(AHMEDABAD.lat, AHMEDABAD.lng, midnight, 0)).toBeNull();
  });
});

describe('hub height', () => {
  it('finds more wind ninety metres up than at the weather station', () => {
    expect(toHubHeight(25)).toBeGreaterThan(25);
    // The power law puts it around forty per cent faster over open ground.
    expect(toHubHeight(25) / 25).toBeCloseTo(1.39, 1);
  });

  it('leaves a reading already taken at hub height alone', () => {
    expect(toHubHeight(30, 100)).toBeCloseTo(30, 6);
  });
});

describe('wind capacity factor', () => {
  it('makes nothing below cut-in and everything above rated', () => {
    expect(windCapacityFactor(5)).toBe(0);
    expect(windCapacityFactor(50)).toBe(1);
  });

  it('shuts down in a storm', () => {
    expect(windCapacityFactor(120)).toBe(0);
  });

  it('rises faster than linearly between the two', () => {
    const low = windCapacityFactor(20);
    const mid = windCapacityFactor(28);
    const high = windCapacityFactor(36);
    expect(mid - low).toBeLessThan(high - mid);
  });
});

describe('weather factor', () => {
  const gujarat = gridProfileFor('IN', 'GJ');
  const britain = gridProfileFor('GB');
  const noon = noonMs('2026-09-12', AHMEDABAD.lng);
  const ceiling = clearSkyIrradiance(AHMEDABAD.lat, AHMEDABAD.lng, noon);

  it('sits near one on an ordinary day', () => {
    const factor = weatherFactor(gujarat, AHMEDABAD.lat, AHMEDABAD.lng, {
      startMs: noon,
      irradianceWm2: ceiling * 0.72,
      windSpeedKph: toHubHeight(25),
    });
    expect(factor).toBeGreaterThan(0.75);
    expect(factor).toBeLessThan(1.3);
  });

  it('marks a bright still noon up on a solar grid and down on a wind-led one', () => {
    const point = { startMs: noon, irradianceWm2: ceiling, windSpeedKph: 4 };
    const solarLed = weatherFactor(gujarat, AHMEDABAD.lat, AHMEDABAD.lng, point);
    const windLed = weatherFactor(britain, AHMEDABAD.lat, AHMEDABAD.lng, point);
    expect(solarLed).toBeGreaterThan(windLed);
  });

  it('marks an overcast noon down', () => {
    const dull = weatherFactor(gujarat, AHMEDABAD.lat, AHMEDABAD.lng, {
      startMs: noon,
      irradianceWm2: ceiling * 0.15,
      windSpeedKph: toHubHeight(6),
    });
    expect(dull).toBeLessThan(0.5);
  });

  it('judges the night on wind alone rather than calling it sunless', () => {
    const midnight = noon + 12 * 3_600_000;
    const breezy = weatherFactor(gujarat, AHMEDABAD.lat, AHMEDABAD.lng, {
      startMs: midnight,
      irradianceWm2: 0,
      windSpeedKph: toHubHeight(40),
    });
    const still = weatherFactor(gujarat, AHMEDABAD.lat, AHMEDABAD.lng, {
      startMs: midnight,
      irradianceWm2: 0,
      windSpeedKph: toHubHeight(3),
    });
    expect(breezy).toBeGreaterThan(1);
    expect(still).toBeLessThan(0.5);
  });

  it('leaves the firm renewables alone on a dead calm night', () => {
    const midnight = noon + 12 * 3_600_000;
    const factor = weatherFactor(gujarat, AHMEDABAD.lat, AHMEDABAD.lng, {
      startMs: midnight,
      irradianceWm2: 0,
      windSpeedKph: 0,
    });
    const share = applyWeather(gujarat, 0.18, factor);
    // Sun and wind are producing nothing, but the biomass and waste plants have not stopped.
    expect(share).toBeGreaterThanOrEqual(gujarat.firmShare);
    expect(share).toBeLessThan(0.1);
  });

  it('never claims more renewables than there is generation', () => {
    expect(applyWeather(gujarat, 0.62, 2)).toBeLessThanOrEqual(1);
    expect(applyWeather(britain, 0.9, 2)).toBeLessThanOrEqual(1);
  });

  it('stays inside its bounds however extreme the weather', () => {
    for (const irradiance of [0, 400, 1400]) {
      for (const windKph of [0, 30, 200]) {
        const factor = weatherFactor(gujarat, AHMEDABAD.lat, AHMEDABAD.lng, {
          startMs: noon,
          irradianceWm2: irradiance,
          windSpeedKph: windKph,
        });
        expect(factor).toBeGreaterThanOrEqual(0.1);
        expect(factor).toBeLessThanOrEqual(2);
      }
    }
  });
});
