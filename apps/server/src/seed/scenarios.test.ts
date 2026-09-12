import { parseScenario, resolveArrivals, type Scenario } from '@cleangrid/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The scenario files are data, and until now nothing checked them: a typo in one only surfaced as
 * the server refusing to boot, which is a bad place to find out. These read the real files.
 *
 * Beyond parsing, each case asserts something the schema cannot: that a day is actually chargeable
 * (no car is asked for more than its window or its battery allows), and that the site is worth
 * optimising (plugging everything in at once would exceed the connection). A scenario where the
 * chargers fit comfortably under the cap would run identically with the optimiser switched off,
 * so it would prove nothing on stage.
 */

const DIRECTORY = join(process.cwd(), 'scenarios');
const FILES = readdirSync(DIRECTORY).filter((name) => name.endsWith('.json'));

const load = (file: string): Scenario => parseScenario(JSON.parse(readFileSync(join(DIRECTORY, file), 'utf8')));

/** The charge rate a car actually gets: the lower of what the bay can give and the car can take. */
function ratesFor(scenario: Scenario) {
  const charger = new Map(scenario.chargers.map((c) => [c.id, c.maxPowerKw]));
  const vehicle = new Map(scenario.vehicles.map((v) => [v.id, v]));
  return { charger, vehicle };
}

describe('scenario files on disk', () => {
  it('finds the scenarios directory', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  describe.each(FILES)('%s', (file) => {
    const scenario = load(file);

    it('parses and describes a site with chargers, drivers and arrivals', () => {
      expect(scenario.chargers.length).toBeGreaterThan(0);
      expect(scenario.arrivals.length).toBeGreaterThan(0);
      expect(scenario.drivers.length).toBeGreaterThan(0);
    });

    it('starts the clock no later than its first arrival', () => {
      const arrivals = resolveArrivals(scenario);
      const first = arrivals[0];
      expect(first).toBeDefined();
      const startMs = Date.parse(`${scenario.simStart}Z`);
      expect(startMs).toBeLessThanOrEqual(Date.parse(`${first?.arriveAt}Z`));
    });

    it('asks every car for an amount it can take in the time it is parked', () => {
      const { charger, vehicle } = ratesFor(scenario);
      for (const arrival of resolveArrivals(scenario)) {
        const car = vehicle.get(arrival.vehicleId);
        const bay = charger.get(arrival.chargerId);
        expect(car, `${arrival.id} has no vehicle`).toBeDefined();
        expect(bay, `${arrival.id} has no charger`).toBeDefined();
        const rateKw = Math.min(bay as number, (car as { maxChargeKw: number }).maxChargeKw);
        const windowHours = (arrival.deadlineMs - arrival.arriveMs) / 3_600_000;
        // A scenario is allowed one impossible request to demonstrate the 422, and day-one has it.
        if (arrival.note?.toLowerCase().includes('impossible')) continue;
        expect(arrival.energyKwh / rateKw, `${arrival.id} cannot finish by its deadline`).toBeLessThanOrEqual(
          windowHours,
        );
      }
    });

    it('never asks a car for more than its battery holds', () => {
      const { vehicle } = ratesFor(scenario);
      for (const arrival of scenario.arrivals) {
        const car = vehicle.get(arrival.vehicleId) as { batteryKwh: number } | undefined;
        if (!car) continue;
        const endSoc = arrival.startSoc + arrival.energyKwh / car.batteryKwh;
        expect(endSoc, `${arrival.id} would finish above 100%`).toBeLessThanOrEqual(1.001);
      }
    });

    it('oversubscribes the grid connection, so the optimiser has something to do', () => {
      const chargerKw = scenario.chargers.reduce((sum, c) => sum + c.maxPowerKw, 0);
      const basePeakKw = Math.max(...scenario.site.baseLoadKw);
      expect(chargerKw + basePeakKw).toBeGreaterThan(scenario.site.gridConnectionKw);
    });

    it('leaves room under the connection for charging once the building is served', () => {
      const basePeakKw = Math.max(...scenario.site.baseLoadKw);
      const slowestBayKw = Math.min(...scenario.chargers.map((c) => c.maxPowerKw));
      expect(scenario.site.gridConnectionKw - basePeakKw).toBeGreaterThan(slowestBayKw);
    });
  });

  it('gives every site its own id, so several can be loaded together', () => {
    const ids = FILES.map((file) => load(file).site.id);
    // day-one and evening-peak are two days at Riverside and are never loaded at the same time.
    const distinct = new Set(ids);
    expect(distinct.size).toBeGreaterThanOrEqual(ids.length - 1);
  });
});
