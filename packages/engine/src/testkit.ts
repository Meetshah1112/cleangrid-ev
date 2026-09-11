import { describe, expect, it } from 'vitest';
import {
  createSlotGrid,
  MODE_WEIGHTS,
  windowHours,
  type ChargingMode,
  type ScheduleProblem,
  type ScheduleResult,
  type Scheduler,
  type SessionNeed,
  type SlotGrid,
} from '@cleangrid/shared';

/** Fixtures and a shared behavioural contract that every scheduler implementation must pass. */

export const DAY_START = Date.parse('2026-09-12T00:00:00Z');
export const HOUR_MS = 3_600_000;
export const SLOTS_PER_HOUR = 4;

/** Overnight is cheapest, midday solar is cleanest, the evening peak is worst for both. */
export const CARBON_BY_HOUR = [
  250, 250, 250, 250, 250, 250, 400, 400, 400, 400, 180, 180, 180, 180, 180, 180, 650, 650, 650, 650, 350, 350, 350, 350,
];
export const PRICE_BY_HOUR = [
  0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.25, 0.25, 0.25, 0.25, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.38, 0.38, 0.38, 0.38,
  0.2, 0.2, 0.2, 0.2,
];

export const hourlyToSlots = (values: readonly number[]): number[] =>
  values.flatMap((value) => Array<number>(SLOTS_PER_HOUR).fill(value));

export interface TestSession {
  readonly id: string;
  readonly energyKwh: number;
  readonly maxPowerKw: number;
  /** Hours after DAY_START. */
  readonly fromHour: number;
  readonly toHour: number;
  readonly mode?: ChargingMode;
  readonly minPowerKw?: number;
}

export interface ProblemOptions {
  readonly sessions?: readonly TestSession[];
  readonly nowMs?: number;
  readonly gridConnectionKw?: number;
  readonly baseLoadKw?: number | readonly number[];
  readonly capKw?: readonly number[];
  readonly peakWeight?: number;
  readonly existingPeakKw?: number;
  readonly carbon?: readonly number[];
  readonly price?: readonly number[];
}

export function toNeed(grid: SlotGrid, session: TestSession): SessionNeed {
  return {
    sessionId: session.id,
    energyKwh: session.energyKwh,
    maxPowerKw: session.maxPowerKw,
    ...(session.minPowerKw === undefined ? {} : { minPowerKw: session.minPowerKw }),
    availableHours: windowHours(grid, DAY_START + session.fromHour * HOUR_MS, DAY_START + session.toHour * HOUR_MS),
    weights: MODE_WEIGHTS[session.mode ?? 'balanced'],
  };
}

export function makeProblem(options: ProblemOptions = {}): ScheduleProblem {
  const grid = createSlotGrid({ nowMs: options.nowMs ?? DAY_START });
  const base = options.baseLoadKw ?? 0;
  return {
    grid,
    sessions: (options.sessions ?? []).map((session) => toNeed(grid, session)),
    site: {
      gridConnectionKw: options.gridConnectionKw ?? 100,
      baseLoadKw: typeof base === 'number' ? Array<number>(grid.slots).fill(base) : base,
      ...(options.capKw === undefined ? {} : { capKw: options.capKw }),
      ...(options.existingPeakKw === undefined ? {} : { existingPeakKw: options.existingPeakKw }),
      peakWeight: options.peakWeight ?? 0,
    },
    signals: {
      carbonGPerKwh: options.carbon ?? hourlyToSlots(CARBON_BY_HOUR),
      pricePerKwh: options.price ?? hourlyToSlots(PRICE_BY_HOUR),
    },
  };
}

export function deliveredKwh(problem: ScheduleProblem, result: ScheduleResult, sessionId: string): number {
  const need = problem.sessions.find((session) => session.sessionId === sessionId);
  const row = result.allocationsKw[sessionId] ?? [];
  return row.reduce((total, kw, slot) => total + kw * (need?.availableHours[slot] ?? 0), 0);
}

export function hoursWithCharging(result: ScheduleResult, sessionId: string): number[] {
  const row = result.allocationsKw[sessionId] ?? [];
  const hours = row.flatMap((kw, slot) => (kw > 1e-6 ? [Math.floor(slot / SLOTS_PER_HOUR)] : []));
  return [...new Set(hours)];
}

const TOLERANCE_KW = 1e-3;

export function runSchedulerContract(label: string, makeScheduler: () => Scheduler): void {
  const solve = (problem: ScheduleProblem): Promise<ScheduleResult> => makeScheduler().solve(problem);

  describe(`${label}: scheduler contract`, () => {
    it('delivers exactly the requested energy, inside the window, within the power cap', async () => {
      const problem = makeProblem({ sessions: [{ id: 'a', energyKwh: 20, maxPowerKw: 7, fromHour: 8, toHour: 17 }] });
      const result = await solve(problem);
      expect(result.status).toBe('complete');
      expect(deliveredKwh(problem, result, 'a')).toBeCloseTo(20, 2);
      (result.allocationsKw.a ?? []).forEach((kw, slot) => {
        expect(kw).toBeLessThanOrEqual(7 + TOLERANCE_KW);
        if (slot < 8 * SLOTS_PER_HOUR || slot >= 17 * SLOTS_PER_HOUR) expect(kw).toBe(0);
      });
    });

    it('runs at full power for the whole window when the deadline is exactly reachable', async () => {
      const problem = makeProblem({ sessions: [{ id: 'tight', energyKwh: 22, maxPowerKw: 11, fromHour: 9, toHour: 11 }] });
      const result = await solve(problem);
      expect(result.status).toBe('complete');
      const row = result.allocationsKw.tight ?? [];
      for (let slot = 36; slot < 44; slot += 1) expect(row[slot]).toBeCloseTo(11, 3);
    });

    it('never exceeds the grid connection, spreading cars that cannot all charge at once', async () => {
      const sessions = ['a', 'b', 'c', 'd'].map((id) => ({ id, energyKwh: 20, maxPowerKw: 11, fromHour: 8, toHour: 18 }));
      const problem = makeProblem({ sessions, gridConnectionKw: 30, baseLoadKw: 10 });
      const result = await solve(problem);
      expect(result.status).toBe('complete');
      result.siteLoadKw.forEach((kw) => expect(kw).toBeLessThanOrEqual(30 + TOLERANCE_KW));
      sessions.forEach((session) => expect(deliveredKwh(problem, result, session.id)).toBeCloseTo(20, 2));
    });

    it('charges greenest sessions in the solar hours and cheapest sessions overnight', async () => {
      const sessions: TestSession[] = [
        { id: 'green', energyKwh: 11, maxPowerKw: 11, fromHour: 0, toHour: 24, mode: 'greenest' },
        { id: 'cheap', energyKwh: 11, maxPowerKw: 11, fromHour: 0, toHour: 24, mode: 'cheapest' },
      ];
      const result = await solve(makeProblem({ sessions }));
      expect(result.status).toBe('complete');
      hoursWithCharging(result, 'green').forEach((hour) => expect(hour >= 10 && hour < 16).toBe(true));
      hoursWithCharging(result, 'cheap').forEach((hour) => expect(hour < 6).toBe(true));
    });

    it('front-loads fastest sessions from the moment of plug-in', async () => {
      const problem = makeProblem({
        sessions: [{ id: 'fast', energyKwh: 11, maxPowerKw: 11, fromHour: 8, toHour: 20, mode: 'fastest' }],
      });
      const row = (await solve(problem)).allocationsKw.fast ?? [];
      row.forEach((kw, slot) => expect(kw).toBeCloseTo(slot >= 32 && slot < 36 ? 11 : 0, 3));
    });

    it('keeps total site draw under a grid flex cap', async () => {
      const capKw = Array.from({ length: 96 }, (_, slot) => (slot >= 40 && slot < 64 ? 15 : 100));
      const sessions: TestSession[] = [
        { id: 'a', energyKwh: 22, maxPowerKw: 11, fromHour: 8, toHour: 20, mode: 'greenest' },
        { id: 'b', energyKwh: 22, maxPowerKw: 11, fromHour: 8, toHour: 20, mode: 'greenest' },
      ];
      const result = await solve(makeProblem({ sessions, capKw, baseLoadKw: 5 }));
      expect(result.status).toBe('complete');
      result.siteLoadKw.forEach((kw, slot) => expect(kw).toBeLessThanOrEqual((capKw[slot] ?? 0) + TOLERANCE_KW));
    });

    it('returns a best-effort plan and reports the shortfall when a deadline cannot be met', async () => {
      const problem = makeProblem({ sessions: [{ id: 'late', energyKwh: 60, maxPowerKw: 11, fromHour: 9, toHour: 10 }] });
      const result = await solve(problem);
      expect(result.status).toBe('shortfall');
      expect(result.shortfalls).toHaveLength(1);
      expect(result.shortfalls[0]?.sessionId).toBe('late');
      expect(result.shortfalls[0]?.shortfallKwh).toBeCloseTo(49, 2);
      const row = result.allocationsKw.late ?? [];
      for (let slot = 36; slot < 40; slot += 1) expect(row[slot]).toBeCloseTo(11, 3);
    });

    it('handles a session with nothing left to deliver and an empty site', async () => {
      const done = await solve(makeProblem({ sessions: [{ id: 'full', energyKwh: 0, maxPowerKw: 7, fromHour: 8, toHour: 9 }] }));
      expect(done.status).toBe('complete');
      expect((done.allocationsKw.full ?? []).every((kw) => kw === 0)).toBe(true);

      const empty = await solve(makeProblem({ baseLoadKw: 12 }));
      expect(empty.status).toBe('complete');
      expect(empty.siteLoadKw.every((kw) => kw === 12)).toBe(true);
      expect(empty.totals.energyKwh).toBe(0);
    });

    it('uses only the minutes left in a partial first slot', async () => {
      const nowMs = DAY_START + 8 * HOUR_MS + 10 * 60_000;
      const fits = makeProblem({ nowMs, sessions: [{ id: 'a', energyKwh: 9, maxPowerKw: 11, fromHour: 8, toHour: 9 }] });
      expect((await solve(fits)).status).toBe('complete');
      const tooMuch = makeProblem({ nowMs, sessions: [{ id: 'a', energyKwh: 9.5, maxPowerKw: 11, fromHour: 8, toHour: 9 }] });
      const result = await solve(tooMuch);
      expect(result.status).toBe('shortfall');
      expect(result.shortfalls[0]?.shortfallKwh).toBeCloseTo(9.5 - (11 * 50) / 60, 2);
    });

    it('flattens the site peak when the site prices demand', async () => {
      const flat = { carbon: Array<number>(96).fill(300), price: Array<number>(96).fill(0.2) };
      const sessions: TestSession[] = [
        { id: 'a', energyKwh: 22, maxPowerKw: 11, fromHour: 8, toHour: 20 },
        { id: 'b', energyKwh: 22, maxPowerKw: 11, fromHour: 8, toHour: 20 },
      ];
      const spiky = await solve(makeProblem({ ...flat, sessions, peakWeight: 0 }));
      const shaved = await solve(makeProblem({ ...flat, sessions, peakWeight: 1 }));
      expect(shaved.status).toBe('complete');
      expect(shaved.totals.peakKw).toBeLessThan(spiky.totals.peakKw * 0.5);
    });

    it('serves the session with no slack before a flexible one takes its slots', async () => {
      const sessions: TestSession[] = [
        { id: 'flexible', energyKwh: 11, maxPowerKw: 11, fromHour: 8, toHour: 20, mode: 'fastest' },
        { id: 'tight', energyKwh: 11, maxPowerKw: 11, fromHour: 8, toHour: 9, mode: 'balanced' },
      ];
      const problem = makeProblem({ sessions, gridConnectionKw: 11 });
      const result = await solve(problem);
      expect(result.status).toBe('complete');
      expect(deliveredKwh(problem, result, 'tight')).toBeCloseTo(11, 2);
      expect(deliveredKwh(problem, result, 'flexible')).toBeCloseTo(11, 2);
    });

    it('reports totals consistent with its allocations', async () => {
      const problem = makeProblem({ sessions: [{ id: 'a', energyKwh: 10, maxPowerKw: 7, fromHour: 10, toHour: 14 }] });
      const result = await solve(problem);
      expect(result.totals.energyKwh).toBeCloseTo(10, 2);
      expect(result.totals.cost).toBeCloseTo(10 * 0.18, 2);
      expect(result.totals.co2Kg).toBeCloseTo((10 * 180) / 1000, 2);
      expect(result.solveMs).toBeGreaterThanOrEqual(0);
    });
  });
}
