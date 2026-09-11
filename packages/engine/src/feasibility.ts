import { MS_PER_HOUR, MS_PER_MINUTE, type SessionNeed } from '@cleangrid/shared';

/** Most energy a session could receive at full power if it had the site to itself. */
export function maxDeliverableKwh(need: Pick<SessionNeed, 'maxPowerKw' | 'availableHours'>): number {
  return need.maxPowerKw * need.availableHours.reduce((total, hours) => total + hours, 0);
}

export interface DeadlineCheckInput {
  /** When charging could start: the later of now and plug-in. */
  readonly startMs: number;
  readonly deadlineMs: number;
  readonly energyKwh: number;
  readonly maxPowerKw: number;
}

export interface DeadlineCheck {
  readonly feasible: boolean;
  /** Full power from start, rounded up to the minute. Offered to the driver when their deadline is too early. */
  readonly earliestFinishMs: number;
  readonly maxDeliverableKwh: number;
  /** Hours the scheduler can move charging around; negative when infeasible. */
  readonly slackHours: number;
}

/** Intake check for a single car, ignoring other cars. The full solve then accounts for the site limit. */
export function checkDeadline(input: DeadlineCheckInput): DeadlineCheck {
  const { startMs, deadlineMs, energyKwh, maxPowerKw } = input;
  if (![startMs, deadlineMs, energyKwh, maxPowerKw].every(Number.isFinite)) {
    throw new RangeError('checkDeadline needs finite numbers');
  }
  if (energyKwh < 0) throw new RangeError(`energyKwh must be >= 0, got ${energyKwh}`);
  if (maxPowerKw <= 0) throw new RangeError(`maxPowerKw must be > 0, got ${maxPowerKw}`);

  const hoursNeeded = energyKwh / maxPowerKw;
  const earliestFinishMs = Math.ceil((startMs + hoursNeeded * MS_PER_HOUR) / MS_PER_MINUTE) * MS_PER_MINUTE;
  const availableHours = Math.max(0, (deadlineMs - startMs) / MS_PER_HOUR);
  return {
    feasible: energyKwh === 0 || earliestFinishMs <= deadlineMs,
    earliestFinishMs,
    maxDeliverableKwh: maxPowerKw * availableHours,
    slackHours: availableHours - hoursNeeded,
  };
}
