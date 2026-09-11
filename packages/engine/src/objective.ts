import { mean, round, type ModeWeights, type ScheduleProblem, type ScheduleTotals, type Shortfall } from '@cleangrid/shared';

/**
 * One objective shared by every solver:
 *   sum over sessions and slots of kWh x (w_cost x price/meanPrice + w_co2 x carbon/meanCarbon + w_speed x t/N)
 *   + peakWeight x (total kWh / grid connection) x peak kW
 *   + SHORTFALL_PENALTY x kWh not delivered by the deadline.
 * Normalising by window means makes the weights dimensionless, so modes are just weight presets.
 */

export const SHORTFALL_PENALTY = 1000;
export const SHORTFALL_TOLERANCE_KWH = 0.001;

export interface ObjectiveContext {
  readonly priceNorm: readonly number[];
  readonly carbonNorm: readonly number[];
  readonly timeNorm: readonly number[];
  /** Objective cost per kW of site peak. */
  readonly peakCoefficient: number;
}

/** Divide by the mean absolute value; negative prices keep their sign. All-zero input maps to zeros. */
export function normalise(values: readonly number[]): number[] {
  const scale = mean(values.map(Math.abs));
  return scale > 0 ? values.map((value) => value / scale) : values.map(() => 0);
}

export function buildObjectiveContext(problem: ScheduleProblem): ObjectiveContext {
  const { grid, signals, site, sessions } = problem;
  const totalEnergyKwh = sessions.reduce((total, need) => total + need.energyKwh, 0);
  return {
    priceNorm: normalise(signals.pricePerKwh),
    carbonNorm: normalise(signals.carbonGPerKwh),
    timeNorm: Array.from({ length: grid.slots }, (_, slot) => slot / grid.slots),
    peakCoefficient: (site.peakWeight * totalEnergyKwh) / site.gridConnectionKw,
  };
}

/** Normalised cost of delivering one kWh to a session in `slot`. */
export function slotScore(weights: ModeWeights, ctx: ObjectiveContext, slot: number): number {
  return (
    weights.cost * (ctx.priceNorm[slot] ?? 0) +
    weights.co2 * (ctx.carbonNorm[slot] ?? 0) +
    weights.speed * (ctx.timeNorm[slot] ?? 0)
  );
}

/** Power available for charging in each slot: the tighter of grid connection and flex cap, minus base load. */
export function chargingHeadroomKw(problem: ScheduleProblem): number[] {
  const { site } = problem;
  return site.baseLoadKw.map((baseKw, slot) => {
    const capKw = Math.min(site.gridConnectionKw, site.capKw?.[slot] ?? Number.POSITIVE_INFINITY);
    return Math.max(0, capKw - baseKw);
  });
}

export interface PlanEvaluation {
  readonly siteLoadKw: readonly number[];
  readonly deliveredKwh: readonly number[];
  readonly shortfalls: readonly Shortfall[];
  readonly totals: ScheduleTotals;
}

/** Score a candidate allocation (rows follow problem.sessions order) with the shared objective. */
export function evaluatePlan(
  problem: ScheduleProblem,
  allocations: readonly (readonly number[])[],
  ctx: ObjectiveContext = buildObjectiveContext(problem),
): PlanEvaluation {
  const { grid, site, signals, sessions } = problem;
  const siteLoadKw = Array.from({ length: grid.slots }, (_, slot) => site.baseLoadKw[slot] ?? 0);
  const deliveredKwh: number[] = [];
  let energyKwh = 0;
  let cost = 0;
  let co2G = 0;
  let energyScore = 0;

  sessions.forEach((need, index) => {
    const row = allocations[index] ?? [];
    let delivered = 0;
    for (let slot = 0; slot < grid.slots; slot += 1) {
      const powerKw = row[slot] ?? 0;
      if (powerKw === 0) continue;
      const kwh = powerKw * (need.availableHours[slot] ?? 0);
      siteLoadKw[slot] = (siteLoadKw[slot] ?? 0) + powerKw;
      delivered += kwh;
      cost += kwh * (signals.pricePerKwh[slot] ?? 0);
      co2G += kwh * (signals.carbonGPerKwh[slot] ?? 0);
      energyScore += kwh * slotScore(need.weights, ctx, slot);
    }
    deliveredKwh.push(delivered);
    energyKwh += delivered;
  });

  const shortfalls = sessions.flatMap((need, index): Shortfall[] => {
    const missingKwh = need.energyKwh - (deliveredKwh[index] ?? 0);
    return missingKwh > SHORTFALL_TOLERANCE_KWH ? [{ sessionId: need.sessionId, shortfallKwh: round(missingKwh, 3) }] : [];
  });
  const shortfallKwh = shortfalls.reduce((total, item) => total + item.shortfallKwh, 0);
  const peakKw = Math.max(site.existingPeakKw ?? 0, ...siteLoadKw);
  const objective = energyScore + ctx.peakCoefficient * peakKw + SHORTFALL_PENALTY * shortfallKwh;

  return {
    siteLoadKw,
    deliveredKwh,
    shortfalls,
    totals: {
      energyKwh: round(energyKwh, 4),
      cost: round(cost, 4),
      co2Kg: round(co2G / 1000, 4),
      peakKw: round(peakKw, 4),
      objective,
    },
  };
}
