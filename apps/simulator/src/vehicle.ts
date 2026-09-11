import { MS_PER_HOUR, clamp, type ChargingProfile } from './deps';

/** The physics half of the simulator: how much power actually flows, and how a profile limits it. */

export const TAPER_START_SOC = 0.85;
const MIN_TAPER_FACTOR = 0.1;

export interface VehicleState {
  readonly batteryKwh: number;
  readonly maxChargeKw: number;
  /** 0..1 */
  readonly soc: number;
}

/**
 * A real battery tapers as it fills. Below 85% the car takes everything offered; above that the
 * accepted power falls away linearly, so the last few percent are slow.
 */
export function acceptedPowerKw(vehicle: VehicleState, offeredKw: number): number {
  if (vehicle.soc >= 1) return 0;
  const taper = vehicle.soc <= TAPER_START_SOC ? 1 : Math.max(MIN_TAPER_FACTOR, (1 - vehicle.soc) / (1 - TAPER_START_SOC));
  return Math.max(0, Math.min(offeredKw, vehicle.maxChargeKw * taper));
}

/** Charge for `elapsedMs` of simulated time at `powerKw`, capped by the room left in the battery. */
export function chargeVehicle(
  vehicle: VehicleState,
  powerKw: number,
  elapsedMs: number,
): { readonly vehicle: VehicleState; readonly energyKwh: number } {
  if (powerKw <= 0 || elapsedMs <= 0) return { vehicle, energyKwh: 0 };
  const roomKwh = Math.max(0, (1 - vehicle.soc) * vehicle.batteryKwh);
  const energyKwh = Math.min(roomKwh, (powerKw * elapsedMs) / MS_PER_HOUR);
  const soc = clamp(vehicle.soc + energyKwh / vehicle.batteryKwh, 0, 1);
  return { vehicle: { ...vehicle, soc }, energyKwh };
}

/**
 * The limit an OCPP charging profile imposes at `tsMs`, in watts, or null when the profile does
 * not apply yet or has expired. Periods are offsets in seconds from startSchedule.
 */
export function profileLimitW(profile: ChargingProfile | null, tsMs: number, fallbackStartMs: number): number | null {
  if (!profile) return null;
  const schedule = profile.chargingSchedule;
  const startMs = schedule.startSchedule ? Date.parse(schedule.startSchedule) : fallbackStartMs;
  if (!Number.isFinite(startMs)) return null;
  if (tsMs < startMs) return null;
  if (schedule.duration !== undefined && tsMs > startMs + schedule.duration * 1000) return null;

  const elapsedS = (tsMs - startMs) / 1000;
  const applicable = [...schedule.chargingSchedulePeriod]
    .sort((a, b) => a.startPeriod - b.startPeriod)
    .filter((period) => period.startPeriod <= elapsedS)
    .pop();
  if (!applicable) return null;
  return schedule.chargingRateUnit === 'W' ? applicable.limit : ampsToWatts(applicable.limit);
}

/** Single phase at 230 V; enough for a simulator that is sent watt profiles anyway. */
const ampsToWatts = (amps: number): number => amps * 230;

export interface PowerInputs {
  readonly vehicle: VehicleState;
  readonly chargerMaxKw: number;
  /** Limit from the active charging profile, kW, or null for unconstrained. */
  readonly limitKw: number | null;
}

/** What the charger will actually deliver right now. */
export function deliveredPowerKw(inputs: PowerInputs): number {
  const offeredKw = inputs.limitKw === null ? inputs.chargerMaxKw : Math.min(inputs.chargerMaxKw, inputs.limitKw);
  return acceptedPowerKw(inputs.vehicle, offeredKw);
}
