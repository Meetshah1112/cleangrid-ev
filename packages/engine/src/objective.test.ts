import { describe, expect, it } from 'vitest';
import { buildObjectiveContext, chargingHeadroomKw, evaluatePlan, normalise, SHORTFALL_PENALTY } from './objective';
import { makeProblem } from './testkit';

describe('normalise', () => {
  it('divides by the mean absolute value and keeps signs', () => {
    expect(normalise([-0.1, 0.1, 0.2, 0.2])).toEqual([-2 / 3, 2 / 3, 4 / 3, 4 / 3]);
  });

  it('maps an all-zero series to zeros instead of NaN', () => {
    expect(normalise([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('chargingHeadroomKw', () => {
  it('takes the tighter of connection and flex cap, minus base load, never below zero', () => {
    const capKw = Array.from({ length: 96 }, (_, slot) => (slot === 1 ? 20 : slot === 2 ? 3 : 1000));
    const headroom = chargingHeadroomKw(makeProblem({ gridConnectionKw: 50, baseLoadKw: 5, capKw }));
    expect(headroom[0]).toBe(45);
    expect(headroom[1]).toBe(15);
    expect(headroom[2]).toBe(0);
  });
});

describe('evaluatePlan', () => {
  const flat = { carbon: Array<number>(96).fill(300), price: Array<number>(96).fill(0.2) };

  it('computes energy, cost, CO2, site load, peak and shortfall from allocations', () => {
    const problem = makeProblem({
      ...flat,
      baseLoadKw: 5,
      sessions: [{ id: 'a', energyKwh: 5, maxPowerKw: 11, fromHour: 0, toHour: 0.5 }],
    });
    const row = Array<number>(96).fill(0);
    row[0] = 10;
    row[1] = 4;
    const evaluation = evaluatePlan(problem, [row]);
    expect(evaluation.deliveredKwh[0]).toBeCloseTo(3.5, 9);
    expect(evaluation.totals.cost).toBeCloseTo(0.7, 9);
    expect(evaluation.totals.co2Kg).toBeCloseTo(1.05, 9);
    expect(evaluation.siteLoadKw.slice(0, 3)).toEqual([15, 9, 5]);
    expect(evaluation.totals.peakKw).toBe(15);
    expect(evaluation.shortfalls).toEqual([{ sessionId: 'a', shortfallKwh: 1.5 }]);
    expect(evaluation.totals.objective).toBeGreaterThan(SHORTFALL_PENALTY * 1.5);
  });

  it('counts the existing billing-period peak', () => {
    const problem = makeProblem({ ...flat, baseLoadKw: 5, existingPeakKw: 40 });
    expect(evaluatePlan(problem, []).totals.peakKw).toBe(40);
  });

  it('prices the peak in proportion to total energy and the peak weight', () => {
    const problem = makeProblem({
      gridConnectionKw: 50,
      peakWeight: 0.5,
      sessions: [{ id: 'a', energyKwh: 20, maxPowerKw: 11, fromHour: 8, toHour: 12 }],
    });
    expect(buildObjectiveContext(problem).peakCoefficient).toBeCloseTo((0.5 * 20) / 50, 12);
  });
});
