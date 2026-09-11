import type { ScheduleProblem, SessionNeed } from '@cleangrid/shared';
import { ScheduleValidationError, type ScheduleValidationCode } from './errors';

const EPSILON_HOURS = 1e-9;

interface SeriesRule {
  readonly name: string;
  readonly lengthCode: ScheduleValidationCode;
  readonly valueCode: ScheduleValidationCode;
  readonly min?: number;
}

function checkSeries(values: readonly number[], length: number, rule: SeriesRule): void {
  if (values.length !== length) {
    throw new ScheduleValidationError(rule.lengthCode, `${rule.name} has ${values.length} values, expected ${length}`);
  }
  values.forEach((value, slot) => {
    if (!Number.isFinite(value)) {
      throw new ScheduleValidationError(rule.valueCode, `${rule.name}[${slot}] is not a finite number`);
    }
    if (rule.min !== undefined && value < rule.min) {
      throw new ScheduleValidationError(rule.valueCode, `${rule.name}[${slot}] = ${value} is below ${rule.min}`);
    }
  });
}

const isNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

function validateSession(need: SessionNeed, slots: number, slotLengthHours: number): void {
  const id = need.sessionId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new ScheduleValidationError('invalid_session', 'sessionId must be a non-empty string');
  }
  if (!isNonNegative(need.energyKwh)) {
    throw new ScheduleValidationError('invalid_energy', `energyKwh must be >= 0, got ${need.energyKwh}`, id);
  }
  if (!Number.isFinite(need.maxPowerKw) || need.maxPowerKw <= 0) {
    throw new ScheduleValidationError('invalid_power', `maxPowerKw must be > 0, got ${need.maxPowerKw}`, id);
  }
  if (need.minPowerKw !== undefined && (!isNonNegative(need.minPowerKw) || need.minPowerKw > need.maxPowerKw)) {
    throw new ScheduleValidationError('invalid_power', `minPowerKw must be within [0, maxPowerKw]`, id);
  }
  if (need.availableHours.length !== slots) {
    throw new ScheduleValidationError(
      'window_length',
      `availableHours has ${need.availableHours.length} values, expected ${slots}`,
      id,
    );
  }
  need.availableHours.forEach((hours, slot) => {
    if (!isNonNegative(hours) || hours > slotLengthHours + EPSILON_HOURS) {
      throw new ScheduleValidationError('invalid_window', `availableHours[${slot}] = ${hours} is outside the slot`, id);
    }
  });
  const { cost, co2, peak, speed } = need.weights;
  if (![cost, co2, peak, speed].every(isNonNegative)) {
    throw new ScheduleValidationError('invalid_weights', 'mode weights must be finite and >= 0', id);
  }
}

/** Reject malformed input with a coded error, so a bad request fails loudly instead of producing a wrong plan. */
export function validateProblem(problem: ScheduleProblem): void {
  const { grid, site, signals, sessions } = problem;
  if (!Number.isInteger(grid.slots) || grid.slots < 1 || grid.slotHours.length !== grid.slots) {
    throw new ScheduleValidationError('invalid_grid', `grid must have slots >= 1 and one slotHours entry per slot`);
  }
  const slotLengthHours = grid.slotMinutes / 60;
  grid.slotHours.forEach((hours, slot) => {
    if (!isNonNegative(hours) || hours > slotLengthHours + EPSILON_HOURS) {
      throw new ScheduleValidationError('invalid_grid', `slotHours[${slot}] = ${hours} is outside the slot`);
    }
  });

  checkSeries(signals.carbonGPerKwh, grid.slots, {
    name: 'carbonGPerKwh',
    lengthCode: 'signal_length',
    valueCode: 'signal_value',
    min: 0,
  });
  // Prices may be negative (some tariffs pay you to consume when renewables overflow).
  checkSeries(signals.pricePerKwh, grid.slots, { name: 'pricePerKwh', lengthCode: 'signal_length', valueCode: 'signal_value' });

  if (!Number.isFinite(site.gridConnectionKw) || site.gridConnectionKw <= 0) {
    throw new ScheduleValidationError('invalid_site', `gridConnectionKw must be > 0, got ${site.gridConnectionKw}`);
  }
  if (!isNonNegative(site.peakWeight)) {
    throw new ScheduleValidationError('invalid_site', `peakWeight must be >= 0, got ${site.peakWeight}`);
  }
  if (site.existingPeakKw !== undefined && !isNonNegative(site.existingPeakKw)) {
    throw new ScheduleValidationError('invalid_site', `existingPeakKw must be >= 0, got ${site.existingPeakKw}`);
  }
  checkSeries(site.baseLoadKw, grid.slots, {
    name: 'baseLoadKw',
    lengthCode: 'site_series_length',
    valueCode: 'invalid_site',
    min: 0,
  });
  if (site.capKw !== undefined) {
    checkSeries(site.capKw, grid.slots, { name: 'capKw', lengthCode: 'site_series_length', valueCode: 'invalid_site', min: 0 });
  }

  const seen = new Set<string>();
  for (const need of sessions) {
    validateSession(need, grid.slots, slotLengthHours);
    if (seen.has(need.sessionId)) {
      throw new ScheduleValidationError('duplicate_session', `session ${need.sessionId} appears twice`, need.sessionId);
    }
    seen.add(need.sessionId);
  }
}
