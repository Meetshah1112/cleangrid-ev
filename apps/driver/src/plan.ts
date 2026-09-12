/**
 * Reading the plan the server sent back. The phone does no scheduling — it only describes, in the
 * driver's language, what the optimiser already decided, and what charging right now would have cost.
 */

import type { CurrentSession, Forecast } from './api';

export interface PlanSummary {
  /** First and last slot the plan actually charges in. */
  readonly startMs: number;
  readonly endMs: number;
  readonly energyKwh: number;
  readonly cost: number;
  readonly renewableShare: number;
  readonly carbonGPerKwh: number;
  /** What a charge-the-moment-you-plug-in session would have scored over the same need. */
  readonly baselineCarbonGPerKwh: number;
  readonly baselineCost: number;
  readonly chargingNow: boolean;
  readonly waitMs: number;
}

const EPSILON_KW = 0.05;

/**
 * Index into the forecast series for a plan slot. The two grids need not share a start — the plan
 * is snapped to a slot boundary, the forecast begins when it was fetched — so a slot just outside
 * the series is clamped to its nearest end rather than dropped.
 */
function forecastIndex(forecast: Forecast, atMs: number): number {
  const step = forecast.stepMinutes * 60_000;
  const raw = Math.round((atMs - forecast.startMs) / step);
  return Math.max(0, Math.min(forecast.carbonGPerKwh.length - 1, raw));
}

function at(series: readonly number[], index: number): number | null {
  const value = series[index];
  return value === undefined || !Number.isFinite(value) ? null : value;
}

export function summarisePlan(
  current: CurrentSession | null,
  forecast: Forecast | null,
  nowMs: number,
): PlanSummary | null {
  const grid = current?.planGrid;
  const planned = current?.plannedKw;
  if (!current || !grid || !planned || !forecast) return null;

  const slotMs = grid.slotMinutes * 60_000;
  const slotHours = grid.slotMinutes / 60;

  let energyKwh = 0;
  let cost = 0;
  let carbonWeighted = 0;
  let renewableWeighted = 0;
  let startMs: number | null = null;
  let endMs = grid.startMs;

  planned.forEach((kw, slot) => {
    if (kw <= EPSILON_KW) return;
    const slotStart = grid.startMs + slot * slotMs;
    const index = forecastIndex(forecast, slotStart);
    const energy = kw * slotHours;
    energyKwh += energy;
    cost += energy * (at(forecast.pricePerKwh, index) ?? 0);
    carbonWeighted += energy * (at(forecast.carbonGPerKwh, index) ?? 0);
    renewableWeighted += energy * (at(forecast.renewableShare, index) ?? 0);
    if (startMs === null) startMs = slotStart;
    endMs = slotStart + slotMs;
  });

  if (startMs === null || energyKwh <= 0) return null;

  // The counterfactual every number on this screen is measured against: full power from now on.
  const need = current.remainingKwh;
  const maxKw = Math.max(EPSILON_KW, current.session.maxPowerKw);
  let baseRemaining = need;
  let baseCost = 0;
  let baseCarbon = 0;
  let baseEnergy = 0;
  for (let slot = 0; slot < grid.slots && baseRemaining > 0; slot += 1) {
    const slotStart = grid.startMs + slot * slotMs;
    if (slotStart + slotMs <= nowMs) continue;
    const energy = Math.min(baseRemaining, maxKw * slotHours);
    const index = forecastIndex(forecast, slotStart);
    baseCost += energy * (at(forecast.pricePerKwh, index) ?? 0);
    baseCarbon += energy * (at(forecast.carbonGPerKwh, index) ?? 0);
    baseEnergy += energy;
    baseRemaining -= energy;
  }

  const firstMs: number = startMs;
  return {
    startMs: firstMs,
    endMs,
    energyKwh,
    cost,
    renewableShare: renewableWeighted / energyKwh,
    carbonGPerKwh: carbonWeighted / energyKwh,
    baselineCarbonGPerKwh: baseEnergy > 0 ? baseCarbon / baseEnergy : carbonWeighted / energyKwh,
    baselineCost: baseCost,
    chargingNow: firstMs <= nowMs + 60_000,
    waitMs: Math.max(0, firstMs - nowMs),
  };
}

/** How much cleaner the plan is than charging immediately, as a share. Negative means no gain. */
export function cleanerBy(summary: PlanSummary): number {
  if (summary.baselineCarbonGPerKwh <= 0) return 0;
  return (summary.baselineCarbonGPerKwh - summary.carbonGPerKwh) / summary.baselineCarbonGPerKwh;
}
