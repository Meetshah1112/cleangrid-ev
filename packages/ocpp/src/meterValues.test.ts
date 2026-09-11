import { describe, expect, it } from 'vitest';
import { buildMeterValue, readMeterValue } from './meterValues';
import { ocppSchemas } from './index';

const timestamp = '2026-09-12T08:15:00.000Z';

describe('readMeterValue', () => {
  it('reads energy, power and state of charge', () => {
    const sample = readMeterValue({
      timestamp,
      sampledValue: [
        { value: '12345', measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
        { value: '7400', measurand: 'Power.Active.Import', unit: 'W' },
        { value: '62', measurand: 'SoC', unit: 'Percent' },
      ],
    });
    expect(sample).toEqual({ tsMs: Date.parse(timestamp), energyWh: 12345, powerW: 7400, soc: 0.62 });
  });

  it('converts kWh and kW to Wh and W', () => {
    const sample = readMeterValue({
      timestamp,
      sampledValue: [
        { value: '12.5', measurand: 'Energy.Active.Import.Register', unit: 'kWh' },
        { value: '7.4', measurand: 'Power.Active.Import', unit: 'kW' },
      ],
    });
    expect(sample.energyWh).toBe(12500);
    expect(sample.powerW).toBe(7400);
  });

  it('treats a sample with no measurand as the energy register', () => {
    expect(readMeterValue({ timestamp, sampledValue: [{ value: '900' }] }).energyWh).toBe(900);
  });

  it('returns nulls for unreadable values instead of NaN', () => {
    const sample = readMeterValue({
      timestamp,
      sampledValue: [{ value: 'n/a', measurand: 'Energy.Active.Import.Register' }],
    });
    expect(sample.energyWh).toBeNull();
    expect(sample.powerW).toBeNull();
    expect(sample.soc).toBeNull();
  });
});

describe('buildMeterValue', () => {
  it('produces a schema-valid MeterValue that reads back unchanged', () => {
    const built = buildMeterValue({ tsMs: Date.parse(timestamp), energyWh: 8123.6, powerW: 7399.5, soc: 0.55 });
    expect(ocppSchemas.meterValueSchema.safeParse(built).success).toBe(true);
    expect(readMeterValue(built)).toEqual({
      tsMs: Date.parse(timestamp),
      energyWh: 8124,
      powerW: 7400,
      soc: 0.55,
    });
  });

  it('omits state of charge when the car does not report it', () => {
    const built = buildMeterValue({ tsMs: Date.parse(timestamp), energyWh: 10, powerW: 0 });
    expect(built.sampledValue).toHaveLength(2);
    expect(readMeterValue(built).soc).toBeNull();
  });
});

describe('inbound payload schemas', () => {
  it('accepts a well-formed StartTransaction and rejects a malformed one', () => {
    const good = { connectorId: 1, idTag: 'TAG-AMARA', meterStart: 0, timestamp };
    expect(ocppSchemas.startTransactionSchema.safeParse(good).success).toBe(true);
    expect(ocppSchemas.startTransactionSchema.safeParse({ ...good, meterStart: -1 }).success).toBe(false);
    expect(ocppSchemas.startTransactionSchema.safeParse({ ...good, idTag: 'x'.repeat(21) }).success).toBe(false);
  });

  it('accepts a charging profile carrying a watt limit', () => {
    const profile = {
      connectorId: 1,
      csChargingProfiles: {
        chargingProfileId: 1,
        transactionId: 42,
        stackLevel: 1,
        chargingProfilePurpose: 'TxProfile',
        chargingProfileKind: 'Absolute',
        chargingSchedule: {
          chargingRateUnit: 'W',
          startSchedule: timestamp,
          chargingSchedulePeriod: [{ startPeriod: 0, limit: 7400 }],
        },
      },
    };
    expect(ocppSchemas.setChargingProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('rejects a status the protocol does not define', () => {
    const parsed = ocppSchemas.statusNotificationSchema.safeParse({ connectorId: 1, errorCode: 'NoError', status: 'Vibing' });
    expect(parsed.success).toBe(false);
  });
});
