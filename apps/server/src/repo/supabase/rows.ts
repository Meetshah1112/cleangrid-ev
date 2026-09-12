import type {
  Charger,
  ChargingSession,
  ConnectorState,
  DispatchRecord,
  FlexEvent,
  MeterReading,
  PlanRecord,
  SessionReport,
  Site,
  UserProfile,
  Vehicle,
} from '@cleangrid/shared';
import type { SignalSample } from '../types';

/**
 * Domain objects to database rows and back.
 *
 * The application works in epoch milliseconds; Postgres works in timestamptz. The conversion lives
 * here and nowhere else. Numeric columns come back from postgres-js as strings, so every read goes
 * through `num`.
 */

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));
const msOf = (value: string | null): number | null => (value === null ? null : Date.parse(value));

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : num(value);
const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.map(num) : []);

export type Row = Record<string, unknown>;

export const siteRow = (site: Site): Row => ({
  id: site.id,
  name: site.name,
  timezone: site.timezone,
  country: site.country,
  lat: site.lat,
  lng: site.lng,
  region_code: site.regionCode,
  grid_connection_kw: site.gridConnectionKw,
  demand_charge_per_kw_month: site.demandChargePerKwMonth,
  currency: site.currency,
  default_mode: site.defaultMode,
  base_load_kw: site.baseLoadKw,
});

export const rowToSite = (row: Row): Site => ({
  id: String(row.id),
  name: String(row.name),
  timezone: String(row.timezone),
  country: String(row.country),
  lat: num(row.lat),
  lng: num(row.lng),
  regionCode: String(row.region_code),
  gridConnectionKw: num(row.grid_connection_kw),
  demandChargePerKwMonth: num(row.demand_charge_per_kw_month),
  currency: String(row.currency),
  defaultMode: row.default_mode as Site['defaultMode'],
  baseLoadKw: numbers(row.base_load_kw),
});

export const chargerRow = (charger: Charger): Row => ({
  id: charger.id,
  site_id: charger.siteId,
  ocpp_identity: charger.ocppIdentity,
  label: charger.label,
  max_power_kw: charger.maxPowerKw,
  min_power_kw: charger.minPowerKw,
  connector_count: charger.connectorCount,
  online: charger.online,
  uncontrolled: charger.uncontrolled,
  vendor: charger.vendor,
  model: charger.model,
  last_seen_at: isoOrNull(charger.lastSeenMs),
});

export const rowToCharger = (row: Row): Charger => ({
  id: String(row.id),
  siteId: String(row.site_id),
  ocppIdentity: String(row.ocpp_identity),
  label: String(row.label),
  maxPowerKw: num(row.max_power_kw),
  minPowerKw: num(row.min_power_kw),
  connectorCount: num(row.connector_count),
  online: Boolean(row.online),
  lastSeenMs: msOf((row.last_seen_at as string | null) ?? null),
  vendor: (row.vendor as string | null) ?? null,
  model: (row.model as string | null) ?? null,
  uncontrolled: Boolean(row.uncontrolled),
});

export const connectorRow = (state: ConnectorState): Row => ({
  charger_id: state.chargerId,
  connector_id: state.connectorId,
  status: state.status,
  error_code: state.errorCode,
  current_session_id: state.sessionId,
  updated_at: iso(state.updatedMs),
});

export const profileRow = (profile: UserProfile): Row => ({
  id: profile.id,
  role: profile.role,
  display_name: profile.displayName,
  site_id: profile.siteId,
  id_tag: profile.idTag,
  default_mode: profile.defaultMode,
  default_dwell_hours: profile.defaultDwellHours,
  default_energy_kwh: profile.defaultEnergyKwh,
});

export const rowToProfile = (row: Row): UserProfile => ({
  id: String(row.id),
  role: row.role as UserProfile['role'],
  displayName: String(row.display_name),
  siteId: (row.site_id as string | null) ?? null,
  idTag: (row.id_tag as string | null) ?? null,
  defaultMode: row.default_mode as UserProfile['defaultMode'],
  defaultDwellHours: num(row.default_dwell_hours),
  defaultEnergyKwh: num(row.default_energy_kwh),
});

export const vehicleRow = (vehicle: Vehicle): Row => ({
  id: vehicle.id,
  driver_id: vehicle.driverId,
  label: vehicle.label,
  battery_kwh: vehicle.batteryKwh,
  max_charge_kw: vehicle.maxChargeKw,
});

export const rowToVehicle = (row: Row): Vehicle => ({
  id: String(row.id),
  driverId: String(row.driver_id),
  label: String(row.label),
  batteryKwh: num(row.battery_kwh),
  maxChargeKw: num(row.max_charge_kw),
});

export const sessionRow = (session: ChargingSession): Row => ({
  id: session.id,
  site_id: session.siteId,
  charger_id: session.chargerId,
  connector_id: session.connectorId,
  driver_id: session.driverId,
  vehicle_id: session.vehicleId,
  id_tag: session.idTag,
  transaction_id: session.transactionId,
  source: session.source,
  status: session.status,
  mode: session.mode,
  plugged_in_at: iso(session.pluggedInMs),
  deadline_at: iso(session.deadlineMs),
  deadline_is_default: session.deadlineIsDefault,
  unplugged_at: isoOrNull(session.unpluggedMs),
  energy_needed_kwh: session.energyNeededKwh,
  energy_delivered_kwh: session.energyDeliveredKwh,
  max_power_kw: session.maxPowerKw,
  meter_start_wh: session.meterStartWh,
  last_meter_wh: session.lastMeterWh,
  current_power_kw: session.currentPowerKw,
  limit_kw: session.limitKw,
  deadline_risk: session.deadlineRisk,
  created_at: iso(session.createdMs),
});

export const rowToSession = (row: Row): ChargingSession => ({
  id: String(row.id),
  siteId: String(row.site_id),
  chargerId: String(row.charger_id),
  connectorId: num(row.connector_id),
  driverId: (row.driver_id as string | null) ?? null,
  vehicleId: (row.vehicle_id as string | null) ?? null,
  idTag: String(row.id_tag),
  transactionId: numOrNull(row.transaction_id),
  source: row.source as ChargingSession['source'],
  status: row.status as ChargingSession['status'],
  mode: row.mode as ChargingSession['mode'],
  pluggedInMs: msOf(row.plugged_in_at as string) ?? 0,
  deadlineMs: msOf(row.deadline_at as string) ?? 0,
  deadlineIsDefault: Boolean(row.deadline_is_default),
  unpluggedMs: msOf((row.unplugged_at as string | null) ?? null),
  energyNeededKwh: num(row.energy_needed_kwh),
  energyDeliveredKwh: num(row.energy_delivered_kwh),
  maxPowerKw: num(row.max_power_kw),
  meterStartWh: numOrNull(row.meter_start_wh),
  lastMeterWh: numOrNull(row.last_meter_wh),
  currentPowerKw: num(row.current_power_kw),
  limitKw: numOrNull(row.limit_kw),
  deadlineRisk: Boolean(row.deadline_risk),
  createdMs: msOf(row.created_at as string) ?? 0,
  updatedMs: msOf((row.updated_at as string | null) ?? null) ?? 0,
});

export const rowToReport = (row: Row): SessionReport => ({
  sessionId: String(row.session_id),
  energyKwh: num(row.energy_kwh),
  cost: num(row.cost),
  co2Kg: num(row.co2_kg),
  renewableShare: num(row.renewable_share),
  avgCarbonGPerKwh: num(row.avg_carbon_g_per_kwh),
  baselineCost: num(row.baseline_cost),
  baselineCo2Kg: num(row.baseline_co2_kg),
  avoidedCo2Kg: num(row.avoided_co2_kg),
  costSaved: num(row.cost_saved),
  greenScore: num(row.green_score),
  windowMinCarbonGPerKwh: num(row.window_min_carbon_g_per_kwh),
  windowMaxCarbonGPerKwh: num(row.window_max_carbon_g_per_kwh),
  verified: Boolean(row.verified),
  carbonBasis: row.carbon_basis === 'actual' ? 'actual' : 'forecast',
  computedMs: msOf(row.computed_at as string) ?? 0,
});

export const meterRow = (reading: MeterReading): Row => ({
  session_id: reading.sessionId,
  recorded_at: iso(reading.tsMs),
  energy_wh: Math.max(0, Math.round(reading.energyWh)),
  power_w: Math.round(reading.powerW),
  soc: reading.soc,
});

export const signalRow = (sample: SignalSample): Row => ({
  site_id: sample.siteId,
  kind: sample.kind,
  slot_start: iso(sample.slotStartMs),
  value: sample.value,
  source: sample.source,
  fetched_at: iso(sample.fetchedMs),
});

export const planRow = (plan: PlanRecord): Row => ({
  id: plan.id,
  site_id: plan.siteId,
  solved_at: iso(plan.solvedMs),
  trigger: plan.trigger,
  horizon_start: iso(plan.grid.startMs),
  horizon_now: iso(plan.grid.nowMs),
  slot_minutes: plan.grid.slotMinutes,
  slots: plan.grid.slots,
  solver: plan.solver,
  status: plan.status,
  fallback_reason: plan.fallbackReason,
  solve_ms: plan.solveMs,
  peak_kw: plan.totals.peakKw,
  totals: plan.totals,
  shortfalls: plan.shortfalls,
  site_load_kw: plan.siteLoadKw,
  base_load_kw: plan.baseLoadKw,
  cap_kw: plan.capKw,
  carbon_g_per_kwh: plan.carbonGPerKwh,
  price_per_kwh: plan.pricePerKwh,
  renewable_share: plan.renewableShare,
});

/** One row per session in the plan: the array form keeps a 96-slot schedule in a single row. */
export const planScheduleRows = (plan: PlanRecord): Row[] =>
  Object.entries(plan.allocationsKw).map(([sessionId, powerKw]) => ({
    plan_id: plan.id,
    session_id: sessionId,
    power_kw: powerKw,
  }));

export const dispatchRow = (record: DispatchRecord): Row => ({
  id: record.id,
  plan_id: record.planId,
  site_id: record.siteId,
  charger_id: record.chargerId,
  connector_id: record.connectorId,
  session_id: record.sessionId,
  sent_at: iso(record.sentMs),
  limit_w: Math.round(record.limitW),
  profile: { periods: record.periods },
  status: record.status,
  error: record.error,
});

export const flexRow = (event: FlexEvent): Row => ({
  id: event.id,
  site_id: event.siteId,
  requested_by: event.requestedBy,
  starts_at: iso(event.startsMs),
  ends_at: iso(event.endsMs),
  cap_kw: event.capKw,
  reason: event.reason,
  status: event.status,
  created_at: iso(event.createdMs),
  responded_at: isoOrNull(event.respondedMs),
});

export const reportRow = (report: SessionReport): Row => ({
  session_id: report.sessionId,
  energy_kwh: report.energyKwh,
  cost: report.cost,
  co2_kg: report.co2Kg,
  renewable_share: report.renewableShare,
  avg_carbon_g_per_kwh: report.avgCarbonGPerKwh,
  baseline_cost: report.baselineCost,
  baseline_co2_kg: report.baselineCo2Kg,
  avoided_co2_kg: report.avoidedCo2Kg,
  cost_saved: report.costSaved,
  green_score: Math.round(report.greenScore),
  window_min_carbon_g_per_kwh: report.windowMinCarbonGPerKwh,
  window_max_carbon_g_per_kwh: report.windowMaxCarbonGPerKwh,
  verified: report.verified,
  carbon_basis: report.carbonBasis,
  computed_at: iso(report.computedMs),
});
