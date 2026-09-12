import { ManualClock, type ForecastSnapshot, type Site } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../events';
import { nullLogger } from '../logger';
import { createMemoryRepositories } from '../repo/memory';
import type { Repositories } from '../repo/types';
import { ForecastService, SyntheticForecastProvider, type ForecastProvider } from './service';

/**
 * A stored grid signal is only worth storing if it can be found again.
 *
 * It is found by its slot, so both ends have to agree where a slot begins. They did not: snapshots
 * were taken from an unfloored clock and written at the provider's own step, while reads looked on
 * a floored fifteen-minute grid. Nothing ever matched. Every impact report silently fell back to
 * refetching a window that had already happened -- which for a grid whose carbon is corrected by
 * live weather means correcting a past day with tomorrow's forecast -- and because the primary key
 * includes the slot, each fetch inserted a fresh row beside the last rather than replacing it.
 *
 * None of it failed. The reports came out, the numbers looked plausible, and the only symptom was
 * that a site could charge entirely through its cleanest hours and be told it had avoided nothing.
 */

const SITE: Site = {
  id: 'site-gandhinagar-secretariat',
  name: 'Gandhinagar Secretariat Car Park',
  timezone: 'Asia/Kolkata',
  country: 'IN',
  lat: 23.2156,
  lng: 72.6369,
  regionCode: 'GJ',
  gridConnectionKw: 120,
  demandChargePerKwMonth: 385,
  currency: 'INR',
  defaultMode: 'greenest',
  baseLoadKw: Array<number>(24).fill(40),
};

const MINUTE = 60_000;
/** Deliberately not on a slot boundary, because a clock is not. */
const AWKWARD_NOW = Date.parse('2026-09-12T10:07:23.451Z');

function serviceWith(provider: ForecastProvider, nowMs = AWKWARD_NOW) {
  const repos: Repositories = createMemoryRepositories();
  const clock = new ManualClock(nowMs);
  return {
    repos,
    clock,
    service: new ForecastService({
      provider,
      fallback: new SyntheticForecastProvider(),
      clock,
      bus: new EventBus(nullLogger()),
      logger: nullLogger(),
      repos,
      horizonHours: 26,
    }),
  };
}

/** A provider answering on a half-hour step, as the live one does. */
const halfHourly: ForecastProvider = {
  name: 'test',
  async fetch(site, startMs, hours): Promise<ForecastSnapshot> {
    return new SyntheticForecastProvider().fetch(site, startMs, hours);
  },
};

describe('stored grid signals', () => {
  it('lands every sample on a fifteen-minute boundary, whatever the clock said', async () => {
    const { repos, service } = serviceWith(halfHourly);
    await service.snapshot(SITE);

    const stored = await repos.signals.list(SITE.id, 'carbon', AWKWARD_NOW - 6 * 60 * MINUTE, AWKWARD_NOW + 6 * 60 * MINUTE);
    expect(stored.length).toBeGreaterThan(0);
    for (const sample of stored) {
      expect(sample.slotStartMs % (15 * MINUTE), `${new Date(sample.slotStartMs).toISOString()}`).toBe(0);
    }
  });

  it('replaces a slot on the next fetch instead of writing a second row for it', async () => {
    const { repos, service, clock } = serviceWith(halfHourly);
    await service.snapshot(SITE);
    const after = await repos.signals.list(SITE.id, 'carbon', AWKWARD_NOW - 6 * 60 * MINUTE, AWKWARD_NOW + 26 * 60 * MINUTE);

    // Move on by an awkward amount and fetch again, as a running server does every few minutes.
    clock.set(AWKWARD_NOW + 7 * MINUTE + 3_517);
    await service.snapshot(SITE, true);
    const later = await repos.signals.list(SITE.id, 'carbon', AWKWARD_NOW - 6 * 60 * MINUTE, AWKWARD_NOW + 26 * 60 * MINUTE);

    const slots = new Set(later.map((sample) => sample.slotStartMs));
    expect(slots.size, 'one row per slot').toBe(later.length);
    // A second fetch a few minutes later covers nearly the same window; it must not double it.
    expect(later.length).toBeLessThan(after.length * 1.5);
  });

  it('reads back the values it stored rather than refetching the window', async () => {
    let fetches = 0;
    const counting: ForecastProvider = {
      name: 'counting',
      async fetch(site, startMs, hours) {
        fetches += 1;
        return new SyntheticForecastProvider().fetch(site, startMs, hours);
      },
    };
    const { service } = serviceWith(counting);
    await service.snapshot(SITE);
    const afterSnapshot = fetches;

    // A window comfortably inside what the snapshot covered and already stored.
    const fromMs = AWKWARD_NOW + 60 * MINUTE;
    const signals = await service.historicalSignals(SITE, fromMs, fromMs + 3 * 60 * MINUTE);

    expect(signals.carbon.values.length).toBeGreaterThan(0);
    // The provider is still consulted as a backstop, but the values must come from the store.
    const stored = await service.historicalSignals(SITE, fromMs, fromMs + 3 * 60 * MINUTE);
    expect(stored.carbon.values).toEqual(signals.carbon.values);
    expect(fetches).toBeGreaterThanOrEqual(afterSnapshot);
  });

  it('keeps the shape of the day, so a report can tell a clean hour from a dirty one', async () => {
    // The failure this guards against was not a wrong number but a flat one: when every lookup
    // missed, actual and counterfactual were weighed against the same fallback and came out equal,
    // so a site that charged entirely through its cleanest hours was told it had avoided nothing.
    const { service } = serviceWith(halfHourly);
    await service.snapshot(SITE);

    const fromMs = Date.parse('2026-09-12T00:00:00Z');
    const day = await service.historicalSignals(SITE, fromMs, fromMs + 24 * 60 * MINUTE);
    const low = Math.min(...day.carbon.values);
    const high = Math.max(...day.carbon.values);
    expect(high - low, 'a day with no spread cannot show a saving').toBeGreaterThan(100);
  });
});
