import { buildSessionReport } from '@cleangrid/engine';
import { makeSeries, round, type ChargingSession, type Clock, type SessionReport, type Site } from '@cleangrid/shared';
import type { EventBus } from '../events';
import type { ForecastService } from '../forecast/service';
import type { Logger } from '../logger';
import type { Repositories } from '../repo/types';

/**
 * Turns a finished session into a verified impact report: what it cost, what it emitted, and what
 * a dumb charger would have emitted for the same kWh starting the moment the cable went in.
 */

export interface ReportServiceDeps {
  readonly repos: Repositories;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly forecast: ForecastService;
}

export interface SiteImpact {
  readonly sessions: number;
  readonly verifiedSessions: number;
  readonly energyKwh: number;
  readonly cost: number;
  readonly co2Kg: number;
  readonly baselineCost: number;
  readonly baselineCo2Kg: number;
  readonly avoidedCo2Kg: number;
  readonly costSaved: number;
  readonly avgGreenScore: number;
  readonly avgRenewableShare: number;
}

export class ReportService {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ReportServiceDeps) {}

  start(): void {
    this.unsubscribe = this.deps.bus.on('session.ended', ({ session }) => {
      void this.buildFor(session).catch((error: unknown) =>
        this.deps.logger.error({ err: error, sessionId: session.id }, 'could not build the session report'),
      );
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async buildFor(session: ChargingSession): Promise<SessionReport | null> {
    const site = await this.deps.repos.sites.get(session.siteId);
    if (!site) return null;
    const endedMs = session.unpluggedMs ?? this.deps.clock.now();
    /**
     * The window has to cover both what happened and the counterfactual, and the counterfactual
     * runs at full power from plug-in, so it can only ever finish earlier.
     */
    const [readings, signals] = await Promise.all([
      this.deps.repos.meters.listBySession(session.id),
      this.deps.forecast.historicalSignals(site, session.pluggedInMs, endedMs),
    ]);

    const report = buildSessionReport({
      sessionId: session.id,
      readings,
      pluggedInMs: session.pluggedInMs,
      unpluggedMs: endedMs,
      maxPowerKw: session.maxPowerKw,
      signals: { carbon: signals.carbon, price: signals.price, renewable: signals.renewable },
      carbonBasis: signals.basis,
      plannedKwh: session.energyDeliveredKwh,
      computedMs: this.deps.clock.now(),
    });

    await this.deps.repos.reports.save(report);
    this.deps.bus.emit('report.ready', { report });
    this.deps.logger.info(
      {
        sessionId: session.id,
        energyKwh: report.energyKwh,
        avoidedCo2Kg: report.avoidedCo2Kg,
        greenScore: report.greenScore,
        verified: report.verified,
      },
      'session report ready',
    );
    return report;
  }

  /** Everything the site has done in a period, for the operator's impact page. */
  async siteImpact(site: Site, fromMs: number, toMs: number): Promise<SiteImpact> {
    const sessions = (await this.deps.repos.sessions.listBySite(site.id, { limit: 500 })).filter(
      (session) => session.pluggedInMs >= fromMs && session.pluggedInMs < toMs,
    );
    const reports = await this.deps.repos.reports.list(sessions.map((session) => session.id));
    const total = (pick: (report: SessionReport) => number): number =>
      reports.reduce((sum, report) => sum + pick(report), 0);
    const count = Math.max(1, reports.length);

    return {
      sessions: reports.length,
      verifiedSessions: reports.filter((report) => report.verified).length,
      energyKwh: round(total((report) => report.energyKwh), 2),
      cost: round(total((report) => report.cost), 2),
      co2Kg: round(total((report) => report.co2Kg), 3),
      baselineCost: round(total((report) => report.baselineCost), 2),
      baselineCo2Kg: round(total((report) => report.baselineCo2Kg), 3),
      avoidedCo2Kg: round(total((report) => report.avoidedCo2Kg), 3),
      costSaved: round(total((report) => report.costSaved), 2),
      avgGreenScore: Math.round(total((report) => report.greenScore) / count),
      avgRenewableShare: round(total((report) => report.renewableShare) / count, 3),
    };
  }

  /** Report for a session that is still running, so the driver app can show a live Green Score. */
  async provisionalFor(session: ChargingSession): Promise<SessionReport | null> {
    if (session.status === 'complete' || session.status === 'aborted') {
      const stored = await this.deps.repos.reports.get(session.id);
      if (stored) return stored;
    }
    return this.buildFor(session);
  }
}

/** Exported for tests: a flat series stands in when no forecast is available. */
export const flatSeries = (startMs: number, value: number, steps = 96): ReturnType<typeof makeSeries> =>
  makeSeries(startMs, 15, Array<number>(steps).fill(value));
