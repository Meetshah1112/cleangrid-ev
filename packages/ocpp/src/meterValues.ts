import type { MeterValue, SampledValue } from './types';

/** Reading and writing the measurands we care about, with unit conversion. */

export const ENERGY_REGISTER = 'Energy.Active.Import.Register';
export const ACTIVE_POWER = 'Power.Active.Import';
export const STATE_OF_CHARGE = 'SoC';

export interface MeterSample {
  readonly tsMs: number;
  /** Cumulative import register, Wh. */
  readonly energyWh: number | null;
  readonly powerW: number | null;
  /** Battery state of charge, 0..1. */
  readonly soc: number | null;
}

const toNumber = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function scaled(sample: SampledValue, kiloUnit: string): number | null {
  const value = toNumber(sample.value);
  if (value === null) return null;
  return sample.unit === kiloUnit ? value * 1000 : value;
}

/** Read one MeterValue. Per the spec a sample with no measurand is the energy register. */
export function readMeterValue(meterValue: MeterValue): MeterSample {
  const tsMs = Date.parse(meterValue.timestamp);
  let energyWh: number | null = null;
  let powerW: number | null = null;
  let soc: number | null = null;

  for (const sample of meterValue.sampledValue) {
    const measurand = sample.measurand ?? ENERGY_REGISTER;
    if (measurand === ENERGY_REGISTER) energyWh = scaled(sample, 'kWh');
    else if (measurand === ACTIVE_POWER) powerW = scaled(sample, 'kW');
    else if (measurand === STATE_OF_CHARGE) {
      const percent = toNumber(sample.value);
      soc = percent === null ? null : percent / 100;
    }
  }
  return { tsMs: Number.isFinite(tsMs) ? tsMs : Number.NaN, energyWh, powerW, soc };
}

export interface MeterSampleInput {
  readonly tsMs: number;
  readonly energyWh: number;
  readonly powerW: number;
  readonly soc?: number | null;
}

/** Build the MeterValue a charger sends during a transaction. */
export function buildMeterValue(input: MeterSampleInput): MeterValue {
  const sampledValue: SampledValue[] = [
    {
      value: String(Math.round(input.energyWh)),
      context: 'Sample.Periodic',
      measurand: ENERGY_REGISTER,
      unit: 'Wh',
    },
    {
      value: String(Math.round(input.powerW)),
      context: 'Sample.Periodic',
      measurand: ACTIVE_POWER,
      unit: 'W',
    },
  ];
  if (input.soc !== undefined && input.soc !== null) {
    sampledValue.push({
      value: String(Math.round(input.soc * 100)),
      context: 'Sample.Periodic',
      measurand: STATE_OF_CHARGE,
      unit: 'Percent',
    });
  }
  return { timestamp: new Date(input.tsMs).toISOString(), sampledValue };
}
