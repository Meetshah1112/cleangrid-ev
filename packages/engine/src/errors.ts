export const VALIDATION_CODES = [
  'invalid_grid',
  'signal_length',
  'signal_value',
  'invalid_site',
  'site_series_length',
  'invalid_session',
  'duplicate_session',
  'invalid_energy',
  'invalid_power',
  'window_length',
  'invalid_window',
  'invalid_weights',
] as const;

export type ScheduleValidationCode = (typeof VALIDATION_CODES)[number];

/** Thrown before solving when the problem itself is malformed. Never thrown for "too little time". */
export class ScheduleValidationError extends Error {
  override readonly name = 'ScheduleValidationError';
  readonly code: ScheduleValidationCode;
  readonly sessionId: string | undefined;

  constructor(code: ScheduleValidationCode, message: string, sessionId?: string) {
    super(message);
    this.code = code;
    this.sessionId = sessionId;
  }
}
