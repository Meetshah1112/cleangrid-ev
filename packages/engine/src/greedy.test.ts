import { MODE_WEIGHTS } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { GreedyScheduler, orderByLaxity, solveGreedy } from './greedy';
import { makeProblem, runSchedulerContract } from './testkit';

runSchedulerContract('greedy', () => new GreedyScheduler());

describe('greedy specifics', () => {
  it('orders sessions by slack, then by deadline', () => {
    const hours = (from: number, to: number): number[] =>
      Array.from({ length: 96 }, (_, slot) => (slot >= from && slot < to ? 0.25 : 0));
    const weights = MODE_WEIGHTS.balanced;
    const order = orderByLaxity([
      { sessionId: 'loose', energyKwh: 7, maxPowerKw: 7, availableHours: hours(0, 40), weights },
      { sessionId: 'tight', energyKwh: 7, maxPowerKw: 7, availableHours: hours(0, 4), weights },
      { sessionId: 'mid-late', energyKwh: 7, maxPowerKw: 7, availableHours: hours(8, 16), weights },
      { sessionId: 'mid-early', energyKwh: 7, maxPowerKw: 7, availableHours: hours(0, 8), weights },
    ]);
    expect(order.map((entry) => entry.need.sessionId)).toEqual(['tight', 'mid-early', 'mid-late', 'loose']);
  });

  it('returns a frozen result tagged as greedy', () => {
    const result = solveGreedy(makeProblem({ sessions: [{ id: 'a', energyKwh: 5, maxPowerKw: 7, fromHour: 1, toHour: 3 }] }));
    expect(result.solver).toBe('greedy');
    expect(result.fallbackReason).toBeUndefined();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.allocationsKw.a)).toBe(true);
  });

  it('still plans with a single ceiling step', () => {
    const problem = makeProblem({
      sessions: [{ id: 'a', energyKwh: 22, maxPowerKw: 11, fromHour: 8, toHour: 20 }],
      peakWeight: 1,
    });
    expect(solveGreedy(problem, { ceilingSteps: 1 }).status).toBe('complete');
  });
});
