import { describe, expect, it } from 'vitest';
import { acceptedPowerKw, chargeVehicle, deliveredPowerKw, profileLimitW } from './vehicle';
import type { ChargingProfile } from './deps';

const car = { batteryKwh: 60, maxChargeKw: 11, soc: 0.5 };
const startSchedule = '2026-09-12T10:00:00.000Z';
const at = (iso: string): number => Date.parse(iso);

const profile = (periods: { startPeriod: number; limit: number }[], extra: Record<string, unknown> = {}): ChargingProfile =>
  ({
    chargingProfileId: 1,
    stackLevel: 1,
    chargingProfilePurpose: 'TxProfile',
    chargingProfileKind: 'Absolute',
    chargingSchedule: { chargingRateUnit: 'W', startSchedule, chargingSchedulePeriod: periods, ...extra },
  }) as ChargingProfile;

describe('acceptedPowerKw', () => {
  it('takes everything offered below the taper point', () => {
    expect(acceptedPowerKw(car, 7)).toBe(7);
    expect(acceptedPowerKw(car, 22)).toBe(11);
  });

  it('tapers near a full battery and stops at 100 percent', () => {
    expect(acceptedPowerKw({ ...car, soc: 0.95 }, 11)).toBeCloseTo(11 / 3, 5);
    expect(acceptedPowerKw({ ...car, soc: 1 }, 11)).toBe(0);
  });
});

describe('chargeVehicle', () => {
  it('adds energy and raises state of charge', () => {
    const result = chargeVehicle(car, 12, 30 * 60_000);
    expect(result.energyKwh).toBeCloseTo(6, 9);
    expect(result.vehicle.soc).toBeCloseTo(0.6, 9);
  });

  it('never charges past a full battery', () => {
    const result = chargeVehicle({ ...car, soc: 0.99 }, 11, 60 * 60_000);
    expect(result.energyKwh).toBeCloseTo(0.6, 9);
    expect(result.vehicle.soc).toBe(1);
  });

  it('does nothing without power or time', () => {
    expect(chargeVehicle(car, 0, 60_000).energyKwh).toBe(0);
    expect(chargeVehicle(car, 7, 0).energyKwh).toBe(0);
  });
});

describe('profileLimitW', () => {
  const fallback = at(startSchedule);

  it('applies the period in force at the given time', () => {
    const schedule = profile([
      { startPeriod: 0, limit: 7400 },
      { startPeriod: 900, limit: 3000 },
      { startPeriod: 1800, limit: 0 },
    ]);
    expect(profileLimitW(schedule, at('2026-09-12T10:05:00Z'), fallback)).toBe(7400);
    expect(profileLimitW(schedule, at('2026-09-12T10:20:00Z'), fallback)).toBe(3000);
    expect(profileLimitW(schedule, at('2026-09-12T10:45:00Z'), fallback)).toBe(0);
  });

  it('does not apply before the schedule starts or after its duration', () => {
    const schedule = profile([{ startPeriod: 0, limit: 7400 }], { duration: 900 });
    expect(profileLimitW(schedule, at('2026-09-12T09:59:00Z'), fallback)).toBeNull();
    expect(profileLimitW(schedule, at('2026-09-12T10:20:00Z'), fallback)).toBeNull();
  });

  it('converts an amp limit to watts and handles a missing profile', () => {
    const amps = profile([{ startPeriod: 0, limit: 32 }]);
    const inAmps = { ...amps, chargingSchedule: { ...amps.chargingSchedule, chargingRateUnit: 'A' as const } };
    expect(profileLimitW(inAmps, at('2026-09-12T10:05:00Z'), fallback)).toBe(7360);
    expect(profileLimitW(null, at('2026-09-12T10:05:00Z'), fallback)).toBeNull();
  });
});

describe('deliveredPowerKw', () => {
  it('takes the lowest of profile limit, charger rating and what the car accepts', () => {
    expect(deliveredPowerKw({ vehicle: car, chargerMaxKw: 22, limitKw: 3 })).toBe(3);
    expect(deliveredPowerKw({ vehicle: car, chargerMaxKw: 7.4, limitKw: 22 })).toBe(7.4);
    expect(deliveredPowerKw({ vehicle: car, chargerMaxKw: 22, limitKw: null })).toBe(11);
    expect(deliveredPowerKw({ vehicle: { ...car, soc: 1 }, chargerMaxKw: 22, limitKw: 11 })).toBe(0);
  });
});
