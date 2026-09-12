import type { Site } from '@cleangrid/shared';
import { describe, expect, test } from 'vitest';
import { gridProfileFor, interpolateDaily, syntheticForecast } from './synthetic';

const siteIn = (country: string, timezone: string, currency: string): Site => ({
  id: `site-${country}`,
  name: `Site ${country}`,
  timezone,
  country,
  lat: 0,
  lng: 0,
  regionCode: 'C',
  gridConnectionKw: 100,
  demandChargePerKwMonth: 10,
  currency,
  defaultMode: 'balanced',
  baseLoadKw: Array.from({ length: 24 }, () => 10),
});

const START = Date.parse('2026-09-12T00:00:00Z');

describe('synthetic grid profiles', () => {
  test('prices a site in the magnitude of its own currency', () => {
    // Arrange
    const london = siteIn('GB', 'Europe/London', 'GBP');
    const bengaluru = siteIn('IN', 'Asia/Kolkata', 'INR');

    // Act
    const gb = syntheticForecast(london, START, 24).price.values;
    const india = syntheticForecast(bengaluru, START, 24).price.values;

    // Assert: pounds per kWh are small change, rupees per kWh are single digits upward.
    expect(Math.max(...gb)).toBeLessThan(1);
    expect(Math.min(...india)).toBeGreaterThan(5);
    expect(Math.max(...india)).toBeLessThan(20);
  });

  test('gives India a coal-led grid that dips at midday', () => {
    // Arrange
    const profile = gridProfileFor('IN');

    // Act
    const midday = interpolateDaily(profile.carbon, 12);
    const evening = interpolateDaily(profile.carbon, 18);
    const overnight = interpolateDaily(profile.carbon, 3);

    // Assert
    expect(midday).toBeLessThan(overnight);
    expect(evening).toBeGreaterThan(overnight);
    expect(overnight).toBeGreaterThan(600);
  });

  test('keeps Great Britain cleaner overall than India', () => {
    // Arrange
    const gb = gridProfileFor('GB');
    const india = gridProfileFor('IN');
    const meanOf = (curve: readonly (readonly [number, number])[]): number =>
      curve.reduce((total, [, value]) => total + value, 0) / curve.length;

    // Act + Assert
    expect(meanOf(gb.carbon)).toBeLessThan(meanOf(india.carbon));
    expect(meanOf(gb.renewable)).toBeGreaterThan(meanOf(india.renewable));
  });

  test('falls back to the Great Britain profile for a country with no model', () => {
    // Arrange + Act
    const unknown = gridProfileFor('ZZ');

    // Assert
    expect(unknown).toBe(gridProfileFor('GB'));
  });

  test('follows the site time zone, so the evening peak lands in local evening', () => {
    // Arrange: 18:30 IST is 13:00 UTC, so a UTC-shaped curve would miss it.
    const bengaluru = siteIn('IN', 'Asia/Kolkata', 'INR');
    const start = Date.parse('2026-09-12T12:45:00Z');

    // Act
    const snapshot = syntheticForecast(bengaluru, start, 1, 15);
    const peakPrice = Math.max(...snapshot.price.values);

    // Assert: the 18:00-19:00 IST window is the surcharged one.
    expect(peakPrice).toBeGreaterThan(11);
  });
});
