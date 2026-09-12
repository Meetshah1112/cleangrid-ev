import type { Clock, Role, Site } from '@cleangrid/shared';
import type { AppConfig } from '../config';
import type { EventBus } from '../events';
import type { ForecastService } from '../forecast/service';
import type { Logger } from '../logger';
import type { OcppGateway } from '../ocpp/gateway';
import type { DemandMeter } from '../optimiser/demandMeter';
import type { OptimiserLoop } from '../optimiser/loop';
import type { Repositories } from '../repo/types';
import type { ReportService } from '../reports/service';
import type { SessionService } from '../sessions/service';
import { NotFoundError } from '../errors';

/** Everything that belongs to one site: its own plan loop and its own meter. */
export interface SiteRuntime {
  readonly site: Site;
  readonly loop: OptimiserLoop;
  readonly demand: DemandMeter;
}

export interface ApiContext {
  readonly config: AppConfig;
  readonly repos: Repositories;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sessions: SessionService;
  readonly gateway: OcppGateway;
  readonly forecast: ForecastService;
  readonly reports: ReportService;
  readonly runtimes: ReadonlyMap<string, SiteRuntime>;
  /** The site shown when a client has not chosen one. */
  readonly defaultSiteId: string;
}

export function runtimeFor(ctx: ApiContext, siteId: string): SiteRuntime {
  const runtime = ctx.runtimes.get(siteId);
  if (!runtime) throw new NotFoundError('site', siteId);
  return runtime;
}

/** The runtime a session belongs to, used by driver endpoints that never name a site. */
export function runtimeForSession(ctx: ApiContext, siteId: string): SiteRuntime | null {
  return ctx.runtimes.get(siteId) ?? null;
}

export interface Principal {
  readonly id: string;
  readonly role: Role;
  readonly siteId: string | null;
  readonly displayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}
