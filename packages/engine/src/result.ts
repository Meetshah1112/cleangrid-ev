import { round, type ScheduleProblem, type ScheduleResult, type SolverName } from '@cleangrid/shared';
import { evaluatePlan, type ObjectiveContext } from './objective';

const KW_SCALE = 1e4;

/** Strip solver noise: negatives and sub-milliwatt values become 0, the rest is rounded to 0.1 W. */
export function cleanKw(value: number): number {
  return value > 1e-7 ? Math.round(value * KW_SCALE) / KW_SCALE : 0;
}

/** Turn raw allocation rows (problem.sessions order) into a frozen, evaluated ScheduleResult. */
export function buildResult(
  problem: ScheduleProblem,
  rawAllocations: readonly (readonly number[])[],
  solver: SolverName,
  solveMs: number,
  ctx: ObjectiveContext,
  fallbackReason?: string,
): ScheduleResult {
  const { slots } = problem.grid;
  const allocations = problem.sessions.map((_, index) =>
    Array.from({ length: slots }, (_, slot) => cleanKw(rawAllocations[index]?.[slot] ?? 0)),
  );
  const evaluation = evaluatePlan(problem, allocations, ctx);
  const allocationsKw = Object.freeze(
    Object.fromEntries(problem.sessions.map((need, index) => [need.sessionId, Object.freeze(allocations[index] ?? [])])),
  );
  const result: ScheduleResult = {
    status: evaluation.shortfalls.length > 0 ? 'shortfall' : 'complete',
    solver,
    allocationsKw,
    siteLoadKw: Object.freeze(evaluation.siteLoadKw.map((kw) => round(kw, 4))),
    shortfalls: Object.freeze([...evaluation.shortfalls]),
    totals: Object.freeze({ ...evaluation.totals }),
    solveMs: round(solveMs, 3),
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
  };
  return Object.freeze(result);
}
