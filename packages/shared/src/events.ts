import type {
  Charger,
  ChargingSession,
  ConnectorState,
  DispatchRecord,
  FlexEvent,
  PlanRecord,
  SessionReport,
} from './domain';
import type { ForecastSnapshot } from './forecast';

/** Events pushed to operator dashboards over /ws/sites/:id. */
export type SiteEvent =
  | { readonly type: 'session.updated'; readonly session: ChargingSession }
  | { readonly type: 'charger.updated'; readonly charger: Charger; readonly connectors: readonly ConnectorState[] }
  | {
      readonly type: 'meter.updated';
      readonly sessionId: string;
      readonly chargerId: string;
      readonly powerKw: number;
      readonly energyKwh: number;
      readonly tsMs: number;
    }
  | { readonly type: 'plan.solved'; readonly plan: PlanRecord }
  | { readonly type: 'forecast.updated'; readonly forecast: ForecastSnapshot }
  | { readonly type: 'dispatch.sent'; readonly dispatch: DispatchRecord }
  | { readonly type: 'flex.updated'; readonly flex: FlexEvent }
  | { readonly type: 'report.ready'; readonly report: SessionReport }
  | { readonly type: 'clock.tick'; readonly nowMs: number; readonly scale: number };

export type SiteEventType = SiteEvent['type'];
