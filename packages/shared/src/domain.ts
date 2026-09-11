import type { ChargingMode } from './modes';
import type { ScheduleStatus, ScheduleTotals, Shortfall, SolverName } from './schedule';

export const ROLES = ['driver', 'operator', 'grid_operator'] as const;
export type Role = (typeof ROLES)[number];

/** OCPP 1.6 ChargePointStatus values, kept verbatim. */
export const CONNECTOR_STATUSES = [
  'Available',
  'Preparing',
  'Charging',
  'SuspendedEVSE',
  'SuspendedEV',
  'Finishing',
  'Reserved',
  'Unavailable',
  'Faulted',
] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export interface Site {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly lat: number;
  readonly lng: number;
  /** Distribution region letter used for regional tariffs (Octopus "C" is London). */
  readonly regionCode: string;
  readonly gridConnectionKw: number;
  readonly demandChargePerKwMonth: number;
  readonly currency: string;
  readonly defaultMode: ChargingMode;
  /** Non-EV building load by local hour of day, 24 values, kW. */
  readonly baseLoadKw: readonly number[];
}

export interface Charger {
  readonly id: string;
  readonly siteId: string;
  /** Charge point identity, the last segment of the OCPP WebSocket URL. */
  readonly ocppIdentity: string;
  readonly label: string;
  readonly maxPowerKw: number;
  readonly minPowerKw: number;
  readonly connectorCount: number;
  readonly online: boolean;
  readonly lastSeenMs: number | null;
  readonly vendor: string | null;
  readonly model: string | null;
  /** Set after the charger keeps rejecting profiles: it runs at full power and is planned as fixed load. */
  readonly uncontrolled: boolean;
}

export interface ConnectorState {
  readonly chargerId: string;
  readonly connectorId: number;
  readonly status: ConnectorStatus;
  readonly errorCode: string;
  readonly sessionId: string | null;
  readonly updatedMs: number;
}

export interface UserProfile {
  readonly id: string;
  readonly role: Role;
  readonly displayName: string;
  readonly siteId: string | null;
  /** OCPP idTag (RFID card or app token) that links charger transactions to this driver. */
  readonly idTag: string | null;
  readonly defaultMode: ChargingMode;
  /** Used when a driver plugs in without the app: deadline = plug-in + this many hours. */
  readonly defaultDwellHours: number;
  readonly defaultEnergyKwh: number;
}

export interface Vehicle {
  readonly id: string;
  readonly driverId: string;
  readonly label: string;
  readonly batteryKwh: number;
  readonly maxChargeKw: number;
}

export const SESSION_STATUSES = ['pending', 'active', 'complete', 'aborted'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_SOURCES = ['app', 'rfid', 'remote'] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

export interface ChargingSession {
  readonly id: string;
  readonly siteId: string;
  readonly chargerId: string;
  readonly connectorId: number;
  readonly driverId: string | null;
  readonly vehicleId: string | null;
  readonly idTag: string;
  readonly transactionId: number | null;
  readonly source: SessionSource;
  readonly status: SessionStatus;
  readonly mode: ChargingMode;
  readonly pluggedInMs: number;
  readonly deadlineMs: number;
  readonly deadlineIsDefault: boolean;
  readonly unpluggedMs: number | null;
  readonly energyNeededKwh: number;
  readonly energyDeliveredKwh: number;
  /** Lower of charger rating and vehicle limit, kW. */
  readonly maxPowerKw: number;
  readonly meterStartWh: number | null;
  readonly lastMeterWh: number | null;
  readonly currentPowerKw: number;
  /** Last limit sent to the charger, kW (null before the first dispatch). */
  readonly limitKw: number | null;
  readonly deadlineRisk: boolean;
  readonly createdMs: number;
  readonly updatedMs: number;
}

export interface MeterReading {
  readonly sessionId: string;
  readonly tsMs: number;
  /** Energy.Active.Import.Register, Wh (monotonic). */
  readonly energyWh: number;
  readonly powerW: number;
  readonly soc: number | null;
}

export interface PlanRecord {
  readonly id: string;
  readonly siteId: string;
  readonly solvedMs: number;
  readonly trigger: string;
  readonly grid: {
    readonly startMs: number;
    readonly nowMs: number;
    readonly slotMinutes: number;
    readonly slots: number;
  };
  readonly solver: SolverName;
  readonly status: ScheduleStatus;
  readonly fallbackReason: string | null;
  readonly solveMs: number;
  readonly totals: ScheduleTotals;
  readonly shortfalls: readonly Shortfall[];
  readonly allocationsKw: Readonly<Record<string, readonly number[]>>;
  readonly siteLoadKw: readonly number[];
  readonly baseLoadKw: readonly number[];
  readonly capKw: readonly number[];
  readonly carbonGPerKwh: readonly number[];
  readonly pricePerKwh: readonly number[];
  readonly renewableShare: readonly number[];
}

export interface ChargingPeriod {
  /** Seconds from the profile's startSchedule. */
  readonly startPeriodS: number;
  readonly limitW: number;
}

export const DISPATCH_STATUSES = ['Accepted', 'Rejected', 'NotSupported', 'Timeout', 'Offline', 'Error'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export interface DispatchRecord {
  readonly id: string;
  readonly planId: string;
  readonly siteId: string;
  readonly chargerId: string;
  readonly connectorId: number;
  readonly sessionId: string;
  readonly sentMs: number;
  readonly limitW: number;
  readonly periods: readonly ChargingPeriod[];
  readonly status: DispatchStatus;
  readonly error: string | null;
}

export const FLEX_STATUSES = ['requested', 'accepted', 'declined', 'active', 'completed', 'cancelled'] as const;
export type FlexStatus = (typeof FLEX_STATUSES)[number];

/** A grid operator asking the site to keep total draw under `capKw` between two times. */
export interface FlexEvent {
  readonly id: string;
  readonly siteId: string;
  readonly requestedBy: string;
  readonly startsMs: number;
  readonly endsMs: number;
  readonly capKw: number;
  readonly reason: string | null;
  readonly status: FlexStatus;
  readonly createdMs: number;
  readonly respondedMs: number | null;
}

export interface SessionReport {
  readonly sessionId: string;
  readonly energyKwh: number;
  readonly cost: number;
  readonly co2Kg: number;
  readonly renewableShare: number;
  readonly avgCarbonGPerKwh: number;
  /** "Dumb charger" counterfactual: the same kWh at full power from the moment of plug-in. */
  readonly baselineCost: number;
  readonly baselineCo2Kg: number;
  readonly avoidedCo2Kg: number;
  readonly costSaved: number;
  /** 100 = charged at the cleanest moments the parked window offered, 0 = the dirtiest. */
  readonly greenScore: number;
  readonly windowMinCarbonGPerKwh: number;
  readonly windowMaxCarbonGPerKwh: number;
  /** True when energy comes from meter readings, false when estimated from the plan. */
  readonly verified: boolean;
  /** Whether carbon figures use measured grid intensity or the forecast. */
  readonly carbonBasis: 'actual' | 'forecast';
  readonly computedMs: number;
}
