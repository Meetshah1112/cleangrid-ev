import type { ScheduleProblem, SessionNeed } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { ScheduleValidationError } from './errors';
import { GreedyScheduler } from './greedy';
import { makeProblem } from './testkit';
import { validateProblem } from './validate';

const valid = (): ScheduleProblem =>
  makeProblem({ sessions: [{ id: 'a', energyKwh: 10, maxPowerKw: 7, fromHour: 8, toHour: 12 }] });

const withSession = (patch: Partial<SessionNeed>): ScheduleProblem => {
  const problem = valid();
  const [first] = problem.sessions;
  return { ...problem, sessions: [{ ...(first as SessionNeed), ...patch }] };
};

const withSite = (patch: Partial<ScheduleProblem['site']>): ScheduleProblem => {
  const problem = valid();
  return { ...problem, site: { ...problem.site, ...patch } };
};

const withSignals = (patch: Partial<ScheduleProblem['signals']>): ScheduleProblem => {
  const problem = valid();
  return { ...problem, signals: { ...problem.signals, ...patch } };
};

function codeOf(problem: ScheduleProblem): string | undefined {
  try {
    validateProblem(problem);
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(ScheduleValidationError);
    return (error as ScheduleValidationError).code;
  }
}

const slots96 = (value: number): number[] => Array<number>(96).fill(value);

describe('validateProblem', () => {
  it('accepts a well-formed problem, including negative prices', () => {
    expect(codeOf(valid())).toBeUndefined();
    expect(codeOf(withSignals({ pricePerKwh: slots96(-0.05) }))).toBeUndefined();
  });

  it.each<[string, ScheduleProblem, string]>([
    ['negative energy', withSession({ energyKwh: -1 }), 'invalid_energy'],
    ['NaN energy', withSession({ energyKwh: Number.NaN }), 'invalid_energy'],
    ['zero power', withSession({ maxPowerKw: 0 }), 'invalid_power'],
    ['min power above max power', withSession({ minPowerKw: 8 }), 'invalid_power'],
    ['a window of the wrong length', withSession({ availableHours: [0.25] }), 'window_length'],
    ['more plugged-in hours than the slot has', withSession({ availableHours: slots96(0.5) }), 'invalid_window'],
    ['negative mode weights', withSession({ weights: { cost: -1, co2: 0, peak: 0, speed: 0 } }), 'invalid_weights'],
    ['an empty session id', withSession({ sessionId: '' }), 'invalid_session'],
    ['a zero grid connection', withSite({ gridConnectionKw: 0 }), 'invalid_site'],
    ['a negative peak weight', withSite({ peakWeight: -1 }), 'invalid_site'],
    ['a negative existing peak', withSite({ existingPeakKw: -3 }), 'invalid_site'],
    ['base load of the wrong length', withSite({ baseLoadKw: [1, 2] }), 'site_series_length'],
    ['a negative flex cap', withSite({ capKw: slots96(-1) }), 'invalid_site'],
    ['carbon of the wrong length', withSignals({ carbonGPerKwh: [100] }), 'signal_length'],
    ['NaN carbon', withSignals({ carbonGPerKwh: slots96(Number.NaN) }), 'signal_value'],
    ['negative carbon', withSignals({ carbonGPerKwh: slots96(-5) }), 'signal_value'],
    ['infinite price', withSignals({ pricePerKwh: slots96(Number.POSITIVE_INFINITY) }), 'signal_value'],
  ])('rejects %s', (_label, problem, code) => {
    expect(codeOf(problem)).toBe(code);
  });

  it('rejects duplicate session ids', () => {
    const problem = valid();
    const [first] = problem.sessions;
    expect(codeOf({ ...problem, sessions: [first as SessionNeed, first as SessionNeed] })).toBe('duplicate_session');
  });

  it('rejects a grid whose slot hours do not match its slot count', () => {
    const problem = valid();
    expect(codeOf({ ...problem, grid: { ...problem.grid, slotHours: [0.25] } })).toBe('invalid_grid');
  });

  it('names the offending session', () => {
    try {
      validateProblem(withSession({ maxPowerKw: -2 }));
    } catch (error) {
      expect((error as ScheduleValidationError).sessionId).toBe('a');
    }
  });

  it('makes schedulers reject instead of planning on bad input', async () => {
    await expect(new GreedyScheduler().solve(withSession({ energyKwh: -1 }))).rejects.toBeInstanceOf(
      ScheduleValidationError,
    );
  });
});
