import { z } from 'zod';
import { CHARGING_MODES } from './modes';
import { daysBetweenLocalDates, isValidTimeZone, shiftLocalDateTime, zonedTimeToUtc } from './time';

/**
 * A scenario describes one site and one day of arrivals. The server seeds its repositories from
 * it and the charger simulator replays its arrivals, so both sides read the same file.
 * All times are site-local wall-clock strings (YYYY-MM-DDTHH:MM).
 */

const chargingMode = z.enum(CHARGING_MODES);
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'expected site-local YYYY-MM-DDTHH:MM');
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const id = z.string().min(1).max(64);

const siteSchema = z.object({
  id,
  name: z.string().min(1),
  timezone: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  regionCode: z.string().min(1).max(4),
  gridConnectionKw: z.number().positive(),
  demandChargePerKwMonth: z.number().nonnegative(),
  currency: z.string().length(3),
  defaultMode: chargingMode,
  baseLoadKw: z.array(z.number().nonnegative()).length(24),
});

const chargerSchema = z.object({
  id,
  ocppIdentity: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/, 'letters, digits, _ and - only'),
  label: z.string().min(1),
  maxPowerKw: z.number().positive().max(350),
  minPowerKw: z.number().nonnegative(),
  connectors: z.number().int().min(1).max(4).default(1),
  vendor: z.string().optional(),
  model: z.string().optional(),
});

const driverSchema = z.object({
  id,
  displayName: z.string().min(1),
  /** OCPP 1.6 idTag is CiString20. */
  idTag: z.string().min(1).max(20),
  defaultMode: chargingMode.default('balanced'),
  defaultDwellHours: z.number().positive().max(48).default(8),
  defaultEnergyKwh: z.number().positive().max(250).default(20),
});

const staffSchema = z.object({
  id,
  displayName: z.string().min(1),
  role: z.enum(['operator', 'grid_operator']),
});

const vehicleSchema = z.object({
  id,
  driverId: id,
  label: z.string().min(1),
  batteryKwh: z.number().positive().max(250),
  maxChargeKw: z.number().positive().max(350),
});

const arrivalSchema = z.object({
  id,
  chargerId: id,
  connectorId: z.number().int().min(1).default(1),
  driverId: id,
  vehicleId: id,
  /** app: driver sets need and deadline first. rfid: walk-up tap, driver defaults apply. */
  via: z.enum(['app', 'rfid']).default('app'),
  arriveAt: localDateTime,
  departAt: localDateTime,
  deadlineAt: localDateTime,
  energyKwh: z.number().positive().max(250),
  startSoc: z.number().min(0).max(1),
  mode: chargingMode.default('balanced'),
  note: z.string().optional(),
});

const asWallMs = (local: string): number => Date.parse(`${local}Z`);

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export const scenarioSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(''),
    day: localDate,
    simStart: localDateTime,
    site: siteSchema,
    chargers: z.array(chargerSchema).min(1),
    drivers: z.array(driverSchema),
    staff: z.array(staffSchema).default([]),
    vehicles: z.array(vehicleSchema),
    arrivals: z.array(arrivalSchema),
  })
  .superRefine((scenario, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: 'custom', message, path });
    };
    if (!isValidTimeZone(scenario.site.timezone)) {
      issue(`unknown time zone ${scenario.site.timezone}`, ['site', 'timezone']);
    }

    const collections = {
      chargers: scenario.chargers.map((c) => c.id),
      drivers: scenario.drivers.map((d) => d.id),
      vehicles: scenario.vehicles.map((v) => v.id),
      arrivals: scenario.arrivals.map((a) => a.id),
    };
    for (const [name, ids] of Object.entries(collections)) {
      for (const dup of duplicates(ids)) issue(`duplicate id ${dup}`, [name]);
    }
    for (const dup of duplicates(scenario.chargers.map((c) => c.ocppIdentity))) {
      issue(`duplicate ocppIdentity ${dup}`, ['chargers']);
    }
    for (const dup of duplicates(scenario.drivers.map((d) => d.idTag))) issue(`duplicate idTag ${dup}`, ['drivers']);

    const chargers = new Map(scenario.chargers.map((c) => [c.id, c]));
    const drivers = new Set(collections.drivers);
    const vehicles = new Map(scenario.vehicles.map((v) => [v.id, v]));
    scenario.vehicles.forEach((vehicle, index) => {
      if (!drivers.has(vehicle.driverId)) issue(`unknown driver ${vehicle.driverId}`, ['vehicles', index, 'driverId']);
    });
    scenario.arrivals.forEach((arrival, index) => {
      const at = (field: string): (string | number)[] => ['arrivals', index, field];
      const charger = chargers.get(arrival.chargerId);
      if (!charger) issue(`unknown charger ${arrival.chargerId}`, at('chargerId'));
      else if (arrival.connectorId > charger.connectors) {
        issue(`charger has no connector ${arrival.connectorId}`, at('connectorId'));
      }
      if (!drivers.has(arrival.driverId)) issue(`unknown driver ${arrival.driverId}`, at('driverId'));
      const vehicle = vehicles.get(arrival.vehicleId);
      if (!vehicle) issue(`unknown vehicle ${arrival.vehicleId}`, at('vehicleId'));
      else if (vehicle.driverId !== arrival.driverId) {
        issue(`vehicle ${vehicle.id} belongs to another driver`, at('vehicleId'));
      }
      if (asWallMs(arrival.departAt) <= asWallMs(arrival.arriveAt)) issue('departAt must be after arriveAt', at('departAt'));
      if (asWallMs(arrival.deadlineAt) <= asWallMs(arrival.arriveAt)) {
        issue('deadlineAt must be after arriveAt', at('deadlineAt'));
      }
    });
  });

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioArrival = Scenario['arrivals'][number];
export type ScenarioCharger = Scenario['chargers'][number];

export class ScenarioError extends Error {
  override readonly name = 'ScenarioError';
}

export function parseScenario(input: unknown): Scenario {
  const result = scenarioSchema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new ScenarioError(`Invalid scenario: ${details}`);
}

export interface ResolvedArrival extends ScenarioArrival {
  readonly arriveMs: number;
  readonly departMs: number;
  readonly deadlineMs: number;
}

/** Arrivals with their times converted to UTC epoch ms, in arrival order. */
export function resolveArrivals(scenario: Scenario): ResolvedArrival[] {
  const tz = scenario.site.timezone;
  return scenario.arrivals
    .map((arrival) => ({
      ...arrival,
      arriveMs: zonedTimeToUtc(arrival.arriveAt, tz),
      departMs: zonedTimeToUtc(arrival.departAt, tz),
      deadlineMs: zonedTimeToUtc(arrival.deadlineAt, tz),
    }))
    .sort((a, b) => a.arriveMs - b.arriveMs);
}

export function scenarioStartMs(scenario: Scenario): number {
  return zonedTimeToUtc(scenario.simStart, scenario.site.timezone);
}

/** Move the whole scenario to another calendar day, keeping every wall-clock time. */
export function rebaseScenario(scenario: Scenario, targetDay: string): Scenario {
  const days = daysBetweenLocalDates(scenario.day, targetDay);
  if (days === 0) return scenario;
  return {
    ...scenario,
    day: targetDay,
    simStart: shiftLocalDateTime(scenario.simStart, days),
    arrivals: scenario.arrivals.map((arrival) => ({
      ...arrival,
      arriveAt: shiftLocalDateTime(arrival.arriveAt, days),
      departAt: shiftLocalDateTime(arrival.departAt, days),
      deadlineAt: shiftLocalDateTime(arrival.deadlineAt, days),
    })),
  };
}
