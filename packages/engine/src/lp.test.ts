import type { ScheduleProblem, ScheduleResult, Scheduler } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import { ScheduleValidationError } from './errors';
import { GreedyScheduler, solveGreedy } from './greedy';
import { LpScheduler, ResilientScheduler, buildLpModel, solveLp } from './lp';
import { buildObjectiveContext } from './objective';
import { makeProblem, runSchedulerContract, type TestSession } from './testkit';

runSchedulerContract('lp', () => new LpScheduler());

const contended = (): ScheduleProblem => {
  const sessions: TestSession[] = [
    { id: 'a', energyKwh: 30, maxPowerKw: 11, fromHour: 8, toHour: 18, mode: 'greenest' },
    { id: 'b', energyKwh: 25, maxPowerKw: 11, fromHour: 8, toHour: 17, mode: 'cheapest' },
    { id: 'c', energyKwh: 40, maxPowerKw: 11, fromHour: 9, toHour: 19, mode: 'balanced' },
    { id: 'd', energyKwh: 12, maxPowerKw: 7.4, fromHour: 12, toHour: 14, mode: 'fastest' },
  ];
  return makeProblem({ sessions, gridConnectionKw: 40, baseLoadKw: 12, peakWeight: 0.3 });
};

describe('LP model', () => {
  it('writes one variable per reachable slot and one energy row per car', () => {
    const problem = makeProblem({ sessions: [{ id: 'a', energyKwh: 10, maxPowerKw: 7, fromHour: 10, toHour: 11 }] });
    const model = buildLpModel(problem, buildObjectiveContext(problem));
    expect(model.variables).toHaveLength(4);
    expect(model.text).toContain('Minimize');
    expect(model.text).toMatch(/e0:.*= 10/);
    expect(model.text).toContain('p0_40 <= 7');
    expect(model.text).not.toMatch(/[eE][+-]\d/);
  });

  it('adds peak rows only when the site prices demand', () => {
    const sessions: TestSession[] = [{ id: 'a', energyKwh: 10, maxPowerKw: 7, fromHour: 10, toHour: 12 }];
    const flat = buildLpModel(makeProblem({ sessions }), buildObjectiveContext(makeProblem({ sessions })));
    expect(flat.usesPeak).toBe(false);
    expect(flat.text).not.toContain(' P ');

    const priced = makeProblem({ sessions, peakWeight: 0.5, baseLoadKw: 6 });
    const withPeak = buildLpModel(priced, buildObjectiveContext(priced));
    expect(withPeak.usesPeak).toBe(true);
    expect(withPeak.text).toMatch(/k40:/);
    expect(withPeak.text).toMatch(/P >= 6/);
  });

  it('skips slots with no headroom instead of writing impossible variables', () => {
    const capKw = Array.from({ length: 96 }, (_, slot) => (slot < 44 ? 12 : 40));
    const problem = makeProblem({
      sessions: [{ id: 'a', energyKwh: 10, maxPowerKw: 7, fromHour: 10, toHour: 12 }],
      baseLoadKw: 12,
      capKw,
    });
    const model = buildLpModel(problem, buildObjectiveContext(problem));
    expect(model.variables.every((variable) => variable.slot >= 44)).toBe(true);
  });
});

describe('LP against greedy', () => {
  it('never produces a worse plan than the greedy fallback on a contended site', async () => {
    const problem = contended();
    const lp = await solveLp(problem);
    const greedy = solveGreedy(problem);
    expect(lp.status).toBe('complete');
    expect(lp.totals.objective).toBeLessThanOrEqual(greedy.totals.objective + 1e-6);
  });

  it('solves a full day of a busy site quickly', async () => {
    const sessions: TestSession[] = Array.from({ length: 20 }, (_, index) => ({
      id: `car-${index}`,
      energyKwh: 10 + (index % 7) * 4,
      maxPowerKw: index % 3 === 0 ? 7.4 : 11,
      fromHour: 7 + (index % 5),
      toHour: 17 + (index % 6),
      mode: (['cheapest', 'greenest', 'balanced', 'fastest'] as const)[index % 4],
    }));
    const problem = makeProblem({ sessions, gridConnectionKw: 65, baseLoadKw: 20, peakWeight: 0.3 });
    const result = await solveLp(problem);
    expect(result.status).toBe('complete');
    expect(result.solveMs).toBeLessThan(2_000);
  });
});

describe('ResilientScheduler', () => {
  const broken: Scheduler = {
    name: 'lp',
    solve: async () => {
      throw new Error('WebAssembly.instantiate failed');
    },
  };

  it('falls back to the greedy plan and says why', async () => {
    const result = await new ResilientScheduler(broken).solve(contended());
    expect(result.solver).toBe('greedy');
    expect(result.fallbackReason).toMatch(/WebAssembly/);
    expect(result.status).toBe('complete');
  });

  it('reports the fallback to its owner', async () => {
    const reasons: string[] = [];
    await new ResilientScheduler(broken, { onFallback: (reason) => reasons.push(reason) }).solve(contended());
    expect(reasons).toHaveLength(1);
  });

  it('still refuses malformed problems instead of hiding them', async () => {
    const problem = contended();
    const [first] = problem.sessions;
    const invalid: ScheduleProblem = { ...problem, sessions: [{ ...first!, energyKwh: Number.NaN }] };
    const throwing: Scheduler = {
      name: 'lp',
      solve: async (): Promise<ScheduleResult> => {
        throw new ScheduleValidationError('invalid_energy', 'energyKwh must be >= 0');
      },
    };
    await expect(new ResilientScheduler(throwing).solve(invalid)).rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('passes a good problem straight through', async () => {
    const result = await new ResilientScheduler(new GreedyScheduler()).solve(contended());
    expect(result.fallbackReason).toBeUndefined();
  });
});
