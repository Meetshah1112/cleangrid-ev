import { MS_PER_MINUTE, createSlotGrid, round, type Clock, type PlanRecord, type Scheduler } from '@cleangrid/shared';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config';
import type { EventBus } from '../events';
import type { ForecastService } from '../forecast/service';
import type { Logger } from '../logger';
import type { Repositories } from '../repo/types';
import type { SessionService } from '../sessions/service';
import type { DemandMeter } from './demandMeter';
import type { DispatchService } from './dispatcher';
import { buildProblem } from './problem';

/**
 * The rolling horizon. Re-solve on every event that changes the picture (a car plugs in, a
 * deadline moves, a flex request arrives), plus a periodic solve to pick up forecast drift.
 * Only the immediate decision is binding; the next solve overwrites the rest.
 */

export interface OptimiserLoopDeps {
  readonly repos: Repositories;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly scheduler: Scheduler;
  readonly forecast: ForecastService;
  readonly dispatcher: DispatchService;
  readonly sessions: SessionService;
  readonly demand: DemandMeter;
  readonly config: AppConfig;
  readonly siteId: string;
}

/**
 * How often to re-solve while a driver is short. A simulated minute: often enough that anything
 * freeing up is used almost at once, and far enough apart that a site cannot spend itself solving.
 */
const AT_RISK_INTERVAL_MS = MS_PER_MINUTE;

export class OptimiserLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void)[] = [];
  private solving = false;
  private queuedTrigger: string | null = null;
  private lastSolveMs = Number.NEGATIVE_INFINITY;
  private lastPlan: PlanRecord | null = null;
  /** How many drivers the last plan could not get to their deadline. */
  private atRiskCount = 0;

  constructor(private readonly deps: OptimiserLoopDeps) {}

  /** Drivers the last plan could not satisfy. Zero is the normal state and the goal. */
  get driversAtRisk(): number {
    return this.atRiskCount;
  }

  /**
   * How long to wait before solving again with nothing else prompting it.
   *
   * The ordinary cadence assumes the plan in force is still the right one, which is a fair
   * assumption while every deadline is being met. It stops being fair the moment one is not: a
   * driver at risk is precisely the case where the answer is expected to change, because the thing
   * that would rescue them -- a car finishing early and freeing its share, a flexibility window
   * ending, a forecast revision -- arrives between solves and is worth nothing if it is not picked
   * up until the next one. So while anyone is short, the loop looks again far more often.
   */
  private intervalMs(): number {
    const ordinary = this.deps.config.RESOLVE_INTERVAL_MIN * MS_PER_MINUTE;
    return this.atRiskCount > 0 ? Math.min(ordinary, AT_RISK_INTERVAL_MS) : ordinary;
  }

  get latestPlan(): PlanRecord | null {
    return this.lastPlan;
  }

  start(): void {
    const { bus } = this.deps;
    // Each site has its own loop, so only react to what happened at this one.
    const mine =
      <T>(siteOf: (payload: T) => string, reason: string) =>
      (payload: T): void => {
        if (siteOf(payload) === this.deps.siteId) this.request(reason);
      };
    this.unsubscribe = [
      bus.on('session.created', mine(({ session }) => session.siteId, 'session_created')),
      bus.on('session.updated', mine(({ session }) => session.siteId, 'session_updated')),
      bus.on('session.ended', mine(({ session }) => session.siteId, 'session_ended')),
      bus.on('charger.connected', mine(({ charger }) => charger.siteId, 'charger_connected')),
      bus.on('charger.disconnected', mine(({ charger }) => charger.siteId, 'charger_disconnected')),
      bus.on('flex.updated', mine(({ flex }) => flex.siteId, 'flex_updated')),
    ];
    // Checked against the simulated clock, so a sped-up demo re-solves at the same cadence.
    this.timer = setInterval(() => {
      if (this.deps.clock.now() - this.lastSolveMs >= this.intervalMs()) {
        this.request(this.atRiskCount > 0 ? 'deadline_risk' : 'interval');
      }
    }, 1_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }

  /**
   * Ask for a solve soon; bursts of events collapse into one. The wait is capped at a simulated
   * minute, so a demo running at 600x does not leave a car uncontrolled for ten simulated hours.
   */
  request(trigger: string): void {
    if (this.debounce) return;
    const waitMs = Math.max(50, Math.min(this.deps.config.RESOLVE_DEBOUNCE_MS, 60_000 / this.deps.clock.scale));
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.solve(trigger);
    }, waitMs);
    this.debounce.unref?.();
  }

  async solve(trigger: string): Promise<PlanRecord | null> {
    // Baseline mode: the optimiser watches and measures but never intervenes.
    if (this.deps.config.OPTIMISER === 'off') return null;
    if (this.solving) {
      this.queuedTrigger = trigger;
      return null;
    }
    this.solving = true;
    try {
      return await this.solveOnce(trigger);
    } catch (error) {
      this.deps.logger.error({ err: error, trigger }, 'solve failed');
      return null;
    } finally {
      this.solving = false;
      const queued = this.queuedTrigger;
      this.queuedTrigger = null;
      if (queued) this.request(queued);
    }
  }

  private async solveOnce(trigger: string): Promise<PlanRecord | null> {
    const { repos, clock, config, logger } = this.deps;
    const site = await repos.sites.get(this.deps.siteId);
    if (!site) {
      logger.error({ siteId: this.deps.siteId }, 'site not found, cannot plan');
      return null;
    }
    this.lastSolveMs = clock.now();

    const grid = createSlotGrid({
      nowMs: clock.now(),
      slotMinutes: config.SLOT_MINUTES,
      horizonHours: config.HORIZON_HOURS,
    });
    const [sessions, chargerList, flexEvents, signals] = await Promise.all([
      repos.sessions.listActive(site.id),
      repos.chargers.listBySite(site.id),
      repos.flex.listBySite(site.id, ['accepted', 'active']),
      this.deps.forecast.signals(site, grid),
    ]);
    const chargers = new Map(chargerList.map((charger) => [charger.id, charger]));

    const built = buildProblem({
      site,
      grid,
      sessions,
      chargers,
      carbonGPerKwh: signals.carbonGPerKwh,
      pricePerKwh: signals.pricePerKwh,
      flexEvents,
      existingPeakKw: this.deps.demand.peakKw,
      marginFraction: config.CONNECTION_MARGIN_PCT / 100,
    });

    const result = await this.deps.scheduler.solve(built.problem);
    const plan: PlanRecord = {
      id: randomUUID(),
      siteId: site.id,
      solvedMs: clock.now(),
      trigger,
      grid: { startMs: grid.startMs, nowMs: grid.nowMs, slotMinutes: grid.slotMinutes, slots: grid.slots },
      solver: result.solver,
      status: result.status,
      fallbackReason: result.fallbackReason ?? null,
      solveMs: result.solveMs,
      totals: result.totals,
      shortfalls: result.shortfalls,
      allocationsKw: result.allocationsKw,
      siteLoadKw: result.siteLoadKw,
      baseLoadKw: built.problem.site.baseLoadKw,
      capKw: built.problem.site.capKw ?? [],
      carbonGPerKwh: signals.carbonGPerKwh,
      pricePerKwh: signals.pricePerKwh,
      renewableShare: signals.renewableShare,
    };
    await repos.plans.save(plan);
    this.lastPlan = plan;
    this.deps.bus.emit('plan.solved', { plan });

    const atRisk = await this.flagDeadlineRisk(
      sessions.map((session) => session.id),
      result.shortfalls,
      built.overdue,
    );
    // Recorded before dispatch, so the next tick is already on the shorter cadence if anyone is
    // short -- including on the solve that first discovers it.
    const wasAtRisk = this.atRiskCount;
    this.atRiskCount = atRisk;
    if (atRisk > 0 && wasAtRisk === 0) {
      logger.warn({ atRisk, everyMs: AT_RISK_INTERVAL_MS }, 'drivers at risk; re-planning more often until they are not');
    } else if (atRisk === 0 && wasAtRisk > 0) {
      logger.info('every deadline is reachable again; back to the ordinary cadence');
    }
    const sent = await this.deps.dispatcher.apply(plan, grid, sessions);

    logger.info(
      {
        trigger,
        solver: result.solver,
        status: result.status,
        cars: built.problem.sessions.length,
        skipped: built.skipped.length,
        peakKw: result.totals.peakKw,
        cost: round(result.totals.cost, 2),
        co2Kg: round(result.totals.co2Kg, 2),
        solveMs: round(result.solveMs, 1),
        dispatched: sent,
      },
      'plan solved',
    );
    return plan;
  }

  /** Highest metered interval so far, which is what a demand charge is billed on. */
  get peakKw(): number {
    return this.deps.demand.peakKw;
  }

  /** Marks each session and returns how many are short, which sets the cadence from here. */
  private async flagDeadlineRisk(
    sessionIds: readonly string[],
    shortfalls: readonly { sessionId: string }[],
    overdue: readonly string[],
  ): Promise<number> {
    const atRisk = new Set([...shortfalls.map((item) => item.sessionId), ...overdue]);
    for (const sessionId of sessionIds) {
      await this.deps.sessions.setDeadlineRisk(sessionId, atRisk.has(sessionId));
    }
    // Only sessions still in this plan count. One that has since unplugged is no longer at risk of
    // anything, and leaving it in the tally would hold the loop at the faster cadence forever.
    return sessionIds.filter((sessionId) => atRisk.has(sessionId)).length;
  }
}
