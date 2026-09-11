import type { ScheduleProblem, ScheduleResult, Scheduler } from '@cleangrid/shared';
import loadHighs from 'highs';
import { ScheduleValidationError } from './errors';
import { solveGreedy } from './greedy';
import { SHORTFALL_PENALTY, buildObjectiveContext, chargingHeadroomKw, slotScore, type ObjectiveContext } from './objective';
import { buildResult } from './result';
import { validateProblem } from './validate';

/**
 * The real scheduler: a linear program over power per session per slot.
 *
 *   minimise  sum kWh x normalised(price, carbon, earliness)  +  peak term  +  penalty x shortfall
 *   such that each car gets its energy before its deadline (a slack variable absorbs the
 *             impossible cases so the solve always returns a usable plan),
 *             no car draws more than its limit, no charging outside its plugged-in window,
 *             and the whole site stays under its connection (and any flex cap).
 *
 * Charging power is continuous, so this is an LP rather than a mixed-integer problem, and HiGHS
 * solves a day of a busy site in milliseconds.
 */

export const DEFAULT_TIME_LIMIT_SECONDS = 2;

export interface LpOptions {
  readonly timeLimitSeconds?: number;
}

interface VariableRef {
  readonly name: string;
  readonly sessionIndex: number;
  readonly slot: number;
  readonly hours: number;
}

export interface LpModel {
  readonly text: string;
  readonly variables: readonly VariableRef[];
  readonly usesPeak: boolean;
}

/** Plain decimal text; the LP format parser should never meet exponent notation. */
function fmt(value: number): string {
  const rounded = Number(value.toFixed(9));
  const text = String(rounded);
  return text.includes('e') || text.includes('E') ? rounded.toFixed(12) : text;
}

function term(coefficient: number, name: string): string {
  const sign = coefficient < 0 ? '-' : '+';
  return ` ${sign} ${fmt(Math.abs(coefficient))} ${name}`;
}

/** Write the problem as CPLEX LP text. Kept separate from solving so it can be inspected and tested. */
export function buildLpModel(problem: ScheduleProblem, ctx: ObjectiveContext): LpModel {
  const { grid, sessions, site } = problem;
  const headroomKw = chargingHeadroomKw(problem);
  const variables: VariableRef[] = [];
  const bySlot: number[][] = Array.from({ length: grid.slots }, () => []);
  const bySession: number[][] = sessions.map(() => []);

  sessions.forEach((need, sessionIndex) => {
    if (need.energyKwh <= 0) return;
    need.availableHours.forEach((hours, slot) => {
      if (hours <= 0 || (headroomKw[slot] ?? 0) <= 0) return;
      const index = variables.length;
      variables.push({ name: `p${sessionIndex}_${slot}`, sessionIndex, slot, hours });
      (bySlot[slot] as number[]).push(index);
      (bySession[sessionIndex] as number[]).push(index);
    });
  });

  const usesPeak = ctx.peakCoefficient > 0;
  const objective: string[] = [];
  for (const variable of variables) {
    const coefficient = variable.hours * slotScore(sessions[variable.sessionIndex]!.weights, ctx, variable.slot);
    if (Math.abs(coefficient) >= 1e-9) objective.push(term(coefficient, variable.name));
  }
  sessions.forEach((need, index) => {
    if (need.energyKwh > 0) objective.push(term(SHORTFALL_PENALTY, `u${index}`));
  });
  if (usesPeak) objective.push(term(ctx.peakCoefficient, 'P'));

  const constraints: string[] = [];
  // Each car gets exactly its energy; u absorbs whatever cannot fit before the deadline.
  sessions.forEach((need, index) => {
    if (need.energyKwh <= 0) return;
    const parts = (bySession[index] ?? []).map((variableIndex) => {
      const variable = variables[variableIndex] as VariableRef;
      return term(variable.hours, variable.name);
    });
    constraints.push(` e${index}:${[...parts, term(1, `u${index}`)].join('')} = ${fmt(need.energyKwh)}`);
  });

  // Site headroom, and the peak the demand charge is billed on.
  bySlot.forEach((indexes, slot) => {
    if (indexes.length === 0) return;
    const parts = indexes.map((variableIndex) => term(1, (variables[variableIndex] as VariableRef).name));
    constraints.push(` c${slot}:${parts.join('')} <= ${fmt(headroomKw[slot] ?? 0)}`);
    if (usesPeak) {
      constraints.push(` k${slot}:${parts.join('')}${term(-1, 'P')} <= ${fmt(-(site.baseLoadKw[slot] ?? 0))}`);
    }
  });

  const bounds: string[] = [];
  for (const variable of variables) {
    bounds.push(` ${variable.name} <= ${fmt(sessions[variable.sessionIndex]!.maxPowerKw)}`);
  }
  if (usesPeak) {
    const floorKw = Math.max(site.existingPeakKw ?? 0, ...site.baseLoadKw);
    bounds.push(` P >= ${fmt(floorKw)}`);
  }

  const text = [
    'Minimize',
    ` obj:${objective.join('') || ' 0 ONE'}`,
    'Subject To',
    ...(constraints.length > 0 ? constraints : [' empty: ONE = 0']),
    'Bounds',
    ...bounds,
    'End',
    '',
  ].join('\n');

  return { text, variables, usesPeak };
}

type HighsModule = Awaited<ReturnType<typeof loadHighs>>;
let highsPromise: Promise<HighsModule> | null = null;

async function getHighs(): Promise<HighsModule> {
  highsPromise ??= loadHighs();
  try {
    return await highsPromise;
  } catch (error) {
    highsPromise = null;
    throw error;
  }
}

/** Drop the cached WebAssembly instance so the next solve starts from a clean one. */
export function resetHighs(): void {
  highsPromise = null;
}

export async function solveLp(problem: ScheduleProblem, options: LpOptions = {}): Promise<ScheduleResult> {
  const startedMs = performance.now();
  validateProblem(problem);
  const ctx = buildObjectiveContext(problem);
  const model = buildLpModel(problem, ctx);

  if (model.variables.length === 0) {
    return buildResult(problem, [], 'lp', performance.now() - startedMs, ctx);
  }

  const highs = await getHighs();
  let solution: { Status: string; Columns: Record<string, { Primal: number }> };
  try {
    solution = highs.solve(model.text, {
      output_flag: false,
      time_limit: options.timeLimitSeconds ?? DEFAULT_TIME_LIMIT_SECONDS,
    }) as typeof solution;
  } catch (error) {
    // A WebAssembly failure can leave the module unusable; force a fresh one next time.
    resetHighs();
    throw error;
  }
  if (solution.Status !== 'Optimal') {
    throw new Error(`HiGHS finished with status "${solution.Status}"`);
  }

  const allocations = problem.sessions.map(() => new Array<number>(problem.grid.slots).fill(0));
  for (const variable of model.variables) {
    const value = solution.Columns[variable.name]?.Primal ?? 0;
    (allocations[variable.sessionIndex] as number[])[variable.slot] = value;
  }
  return buildResult(problem, allocations, 'lp', performance.now() - startedMs, ctx);
}

export class LpScheduler implements Scheduler {
  readonly name = 'lp';
  private readonly options: LpOptions;

  constructor(options: LpOptions = {}) {
    this.options = options;
  }

  async solve(problem: ScheduleProblem): Promise<ScheduleResult> {
    return solveLp(problem, this.options);
  }
}

export interface ResilientSchedulerOptions {
  readonly onFallback?: (reason: string) => void;
}

/**
 * Runs the LP and falls back to the greedy plan if the solver fails for any reason: a missing
 * WebAssembly build, a time limit, a numerical problem. Bad input still throws, because a
 * malformed problem should be fixed rather than approximated.
 */
export class ResilientScheduler implements Scheduler {
  readonly name = 'lp';

  constructor(
    private readonly primary: Scheduler,
    private readonly options: ResilientSchedulerOptions = {},
  ) {}

  async solve(problem: ScheduleProblem): Promise<ScheduleResult> {
    try {
      return await this.primary.solve(problem);
    } catch (error) {
      if (error instanceof ScheduleValidationError) throw error;
      const reason = (error as Error).message;
      this.options.onFallback?.(reason);
      const fallback = solveGreedy(problem);
      return Object.freeze({ ...fallback, fallbackReason: reason });
    }
  }
}
