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

export class OptimiserLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void)[] = [];
  private solving = false;
  private queuedTrigger: string | null = null;
  private lastSolveMs = Number.NEGATIVE_INFINITY;
  private lastPlan: PlanRecord | null = null;

  constructor(private readonly deps: OptimiserLoopDeps) {}

  get latestPlan(): PlanRecord | null {
    return this.lastPlan;
  }

  start(): void {
    const { bus } = this.deps;
    const trigger = (reason: string) => () => this.request(reason);
    this.unsubscribe = [
      bus.on('session.created', trigger('session_created')),
      bus.on('session.updated', trigger('session_updated')),
      bus.on('session.ended', trigger('session_ended')),
      bus.on('charger.connected', trigger('charger_connected')),
      bus.on('charger.disconnected', trigger('charger_disconnected')),
      bus.on('flex.updated', trigger('flex_updated')),
    ];
    // Checked against the simulated clock, so a sped-up demo re-solves at the same cadence.
    this.timer = setInterval(() => {
      if (this.deps.clock.now() - this.lastSolveMs >= this.deps.config.RESOLVE_INTERVAL_MIN * MS_PER_MINUTE) {
        this.request('interval');
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

    await this.flagDeadlineRisk(sessions.map((session) => session.id), result.shortfalls, built.overdue);
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

  private async flagDeadlineRisk(
    sessionIds: readonly string[],
    shortfalls: readonly { sessionId: string }[],
    overdue: readonly string[],
  ): Promise<void> {
    const atRisk = new Set([...shortfalls.map((item) => item.sessionId), ...overdue]);
    for (const sessionId of sessionIds) {
      await this.deps.sessions.setDeadlineRisk(sessionId, atRisk.has(sessionId));
    }
  }
}
