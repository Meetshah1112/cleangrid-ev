import type { ScheduleProblem, ScheduleResult, Scheduler, SessionNeed } from '@cleangrid/shared';
import { buildObjectiveContext, chargingHeadroomKw, evaluatePlan, slotScore, type ObjectiveContext } from './objective';
import { buildResult } from './result';
import { validateProblem } from './validate';

/**
 * Greedy fallback scheduler.
 * 1. Rank each session's slots by its blended score (price, carbon, earliness per its mode).
 * 2. Serve sessions with the least slack first, filling their best reachable slots up to their
 *    power cap and the site's remaining headroom.
 * 3. If the site prices peak demand, repeat under a range of site-draw ceilings and keep the
 *    plan with the lowest shared objective, which flattens the peak.
 */

const EPS = 1e-9;
export const DEFAULT_CEILING_STEPS = 12;

export interface GreedyOptions {
  /** Ceilings tried per search pass when the site prices peak demand. */
  readonly ceilingSteps?: number;
}

interface RankedSession {
  readonly index: number;
  readonly need: SessionNeed;
}

interface Attempt {
  readonly ceilingKw: number;
  readonly allocations: readonly (readonly number[])[];
  readonly objective: number;
}

const sumHours = (hours: readonly number[]): number => hours.reduce((total, value) => total + value, 0);
const lastActiveSlot = (hours: readonly number[]): number => hours.findLastIndex((value) => value > 0);

/** Least slack first (window hours minus hours needed at full power), then earliest deadline. */
export function orderByLaxity(sessions: readonly SessionNeed[]): RankedSession[] {
  return sessions
    .map((need, index) => ({
      index,
      need,
      laxityHours: sumHours(need.availableHours) - need.energyKwh / need.maxPowerKw,
      lastSlot: lastActiveSlot(need.availableHours),
    }))
    .sort((a, b) => a.laxityHours - b.laxityHours || a.lastSlot - b.lastSlot || a.index - b.index)
    .map(({ index, need }) => ({ index, need }));
}

function rankSlots(need: SessionNeed, ctx: ObjectiveContext): number[] {
  return need.availableHours
    .map((hours, slot) => ({ slot, hours, score: slotScore(need.weights, ctx, slot) }))
    .filter((entry) => entry.hours > 0)
    .sort((a, b) => a.score - b.score || a.slot - b.slot)
    .map((entry) => entry.slot);
}

function fillUnderCeiling(
  problem: ScheduleProblem,
  ranked: readonly RankedSession[],
  rankedSlots: readonly (readonly number[])[],
  headroomKw: readonly number[],
  ceilingKw: number,
): number[][] {
  const { grid, site } = problem;
  const limitKw = headroomKw.map((room, slot) => Math.min(room, Math.max(0, ceilingKw - (site.baseLoadKw[slot] ?? 0))));
  const usedKw = new Array<number>(grid.slots).fill(0);
  const allocations = problem.sessions.map(() => new Array<number>(grid.slots).fill(0));

  for (const { index, need } of ranked) {
    const row = allocations[index] ?? [];
    let remainingKwh = need.energyKwh;
    for (const slot of rankedSlots[index] ?? []) {
      if (remainingKwh <= EPS) break;
      const hours = need.availableHours[slot] ?? 0;
      const roomKw = Math.min(need.maxPowerKw, (limitKw[slot] ?? 0) - (usedKw[slot] ?? 0));
      if (roomKw <= EPS || hours <= 0) continue;
      const powerKw = Math.min(roomKw, remainingKwh / hours);
      row[slot] = powerKw;
      usedKw[slot] = (usedKw[slot] ?? 0) + powerKw;
      remainingKwh -= powerKw * hours;
    }
  }
  return allocations;
}

function linspace(from: number, to: number, steps: number): number[] {
  if (steps <= 0 || to <= from) return [to];
  return Array.from({ length: steps + 1 }, (_, k) => from + ((to - from) * k) / steps);
}

function ceilingBounds(problem: ScheduleProblem, headroomKw: readonly number[]): { lowerKw: number; upperKw: number } {
  const base = problem.site.baseLoadKw;
  const upperKw = Math.max(...headroomKw.map((room, slot) => room + (base[slot] ?? 0)));
  const lowerKw = Math.min(upperKw, Math.max(problem.site.existingPeakKw ?? 0, ...base));
  return { lowerKw, upperKw };
}

function pickBest(attempts: readonly Attempt[]): Attempt {
  return attempts.reduce((best, next) => (next.objective < best.objective - 1e-9 ? next : best));
}

export function solveGreedy(problem: ScheduleProblem, options: GreedyOptions = {}): ScheduleResult {
  const startedMs = performance.now();
  validateProblem(problem);
  const ctx = buildObjectiveContext(problem);
  const headroomKw = chargingHeadroomKw(problem);
  const ranked = orderByLaxity(problem.sessions);
  const rankedSlots = problem.sessions.map((need) => rankSlots(need, ctx));

  const attempt = (ceilingKw: number): Attempt => {
    const allocations = fillUnderCeiling(problem, ranked, rankedSlots, headroomKw, ceilingKw);
    return { ceilingKw, allocations, objective: evaluatePlan(problem, allocations, ctx).totals.objective };
  };

  const { lowerKw, upperKw } = ceilingBounds(problem, headroomKw);
  let best = attempt(upperKw);
  const shavePeak = problem.site.peakWeight > 0 && problem.sessions.length > 0 && upperKw - lowerKw > EPS;
  if (shavePeak) {
    const steps = Math.max(1, Math.floor(options.ceilingSteps ?? DEFAULT_CEILING_STEPS));
    best = pickBest([best, ...linspace(lowerKw, upperKw, steps).map(attempt)]);
    const widthKw = (upperKw - lowerKw) / steps;
    const fine = linspace(Math.max(lowerKw, best.ceilingKw - widthKw), Math.min(upperKw, best.ceilingKw + widthKw), steps);
    best = pickBest([best, ...fine.map(attempt)]);
  }
  return buildResult(problem, best.allocations, 'greedy', performance.now() - startedMs, ctx);
}

export class GreedyScheduler implements Scheduler {
  readonly name = 'greedy';
  private readonly options: GreedyOptions;

  constructor(options: GreedyOptions = {}) {
    this.options = options;
  }

  async solve(problem: ScheduleProblem): Promise<ScheduleResult> {
    return solveGreedy(problem, this.options);
  }
}
