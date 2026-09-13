import { parseScenario, type Clock, type Scenario } from '@cleangrid/shared';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Logger } from '../logger';
import type { Repositories } from '../repo/types';

/** Loads the scenario file and fills the repositories with the site it describes. */

/**
 * The operator console watches a network of sites, not one car park, and the people in the scenario
 * files each run a single site. This is that network role: an operator with no site of their own,
 * which `requireSite` reads as access to all of them. Seeded once, outside any scenario, because it
 * belongs to none of them.
 */
export const NETWORK_OPERATOR_ID = 'ops-network';

/**
 * The grid operator who asks sites for flexibility. Seeded here too, not only by the scenarios that
 * happen to name one, because the console's Grid Flex page acts as this account on every deployment.
 */
export const GRID_OPERATOR_ID = 'grid-ops';

export async function seedNetworkOperator(repos: Repositories): Promise<void> {
  await repos.profiles.save({
    id: GRID_OPERATOR_ID,
    role: 'grid_operator',
    displayName: 'Regional Grid Control',
    siteId: null,
    idTag: null,
    defaultMode: 'balanced',
    defaultDwellHours: 8,
    defaultEnergyKwh: 20,
  });
  await repos.profiles.save({
    id: NETWORK_OPERATOR_ID,
    role: 'operator',
    displayName: 'Network Operations',
    siteId: null,
    idTag: null,
    defaultMode: 'balanced',
    defaultDwellHours: 8,
    defaultEnergyKwh: 20,
  });
}

export async function loadScenarioFile(path: string): Promise<Scenario> {
  const raw = await readFile(resolve(path.trim()), 'utf8');
  return parseScenario(JSON.parse(raw));
}

/** SCENARIO may name several files, one per site, separated by commas. */
export async function loadScenarioFiles(paths: string): Promise<Scenario[]> {
  const list = paths
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const scenarios = await Promise.all(list.map(loadScenarioFile));
  const siteIds = new Set<string>();
  for (const scenario of scenarios) {
    if (siteIds.has(scenario.site.id)) throw new Error(`two scenarios describe the same site: ${scenario.site.id}`);
    siteIds.add(scenario.site.id);
  }
  return scenarios;
}

export async function seedFromScenario(
  repos: Repositories,
  scenario: Scenario,
  clock: Clock,
  logger?: Logger,
): Promise<void> {
  const { site } = scenario;
  await repos.sites.save({
    id: site.id,
    name: site.name,
    timezone: site.timezone,
    country: site.country,
    lat: site.lat,
    lng: site.lng,
    regionCode: site.regionCode,
    gridConnectionKw: site.gridConnectionKw,
    demandChargePerKwMonth: site.demandChargePerKwMonth,
    currency: site.currency,
    defaultMode: site.defaultMode,
    baseLoadKw: site.baseLoadKw,
  });

  for (const charger of scenario.chargers) {
    await repos.chargers.save({
      id: charger.id,
      siteId: site.id,
      ocppIdentity: charger.ocppIdentity,
      label: charger.label,
      maxPowerKw: charger.maxPowerKw,
      minPowerKw: charger.minPowerKw,
      connectorCount: charger.connectors,
      online: false,
      lastSeenMs: null,
      vendor: charger.vendor ?? null,
      model: charger.model ?? null,
      uncontrolled: false,
    });
    for (let connectorId = 1; connectorId <= charger.connectors; connectorId += 1) {
      await repos.connectors.upsert({
        chargerId: charger.id,
        connectorId,
        status: 'Unavailable',
        errorCode: 'NoError',
        sessionId: null,
        updatedMs: clock.now(),
      });
    }
  }

  for (const driver of scenario.drivers) {
    await repos.profiles.save({
      id: driver.id,
      role: 'driver',
      displayName: driver.displayName,
      siteId: site.id,
      idTag: driver.idTag,
      defaultMode: driver.defaultMode,
      defaultDwellHours: driver.defaultDwellHours,
      defaultEnergyKwh: driver.defaultEnergyKwh,
    });
  }

  for (const member of scenario.staff) {
    await repos.profiles.save({
      id: member.id,
      role: member.role,
      displayName: member.displayName,
      siteId: member.role === 'operator' ? site.id : null,
      idTag: null,
      defaultMode: site.defaultMode,
      defaultDwellHours: 8,
      defaultEnergyKwh: 20,
    });
  }

  for (const vehicle of scenario.vehicles) {
    await repos.vehicles.save({
      id: vehicle.id,
      driverId: vehicle.driverId,
      label: vehicle.label,
      batteryKwh: vehicle.batteryKwh,
      maxChargeKw: vehicle.maxChargeKw,
    });
  }

  logger?.info(
    {
      site: site.name,
      chargers: scenario.chargers.length,
      drivers: scenario.drivers.length,
      arrivals: scenario.arrivals.length,
    },
    'scenario seeded',
  );
}
