import type { Clock, Role } from '@cleangrid/shared';
import type { AppConfig } from '../config';
import type { EventBus } from '../events';
import type { ForecastService } from '../forecast/service';
import type { Logger } from '../logger';
import type { OcppGateway } from '../ocpp/gateway';
import type { OptimiserLoop } from '../optimiser/loop';
import type { Repositories } from '../repo/types';
import type { ReportService } from '../reports/service';
import type { SessionService } from '../sessions/service';

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
  readonly loop: OptimiserLoop;
  readonly siteId: string;
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
