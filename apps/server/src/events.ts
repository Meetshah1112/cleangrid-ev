import type {
  Charger,
  ChargingSession,
  ConnectorState,
  DispatchRecord,
  FlexEvent,
  ForecastSnapshot,
  MeterReading,
  PlanRecord,
  SessionReport,
} from '@cleangrid/shared';
import type { Logger } from './logger';

/** Internal events. The dashboard channel translates the ones operators care about into SiteEvents. */
export interface DomainEvents {
  'charger.connected': { readonly charger: Charger };
  'charger.disconnected': { readonly charger: Charger };
  'charger.status': { readonly charger: Charger; readonly connector: ConnectorState };
  'session.created': { readonly session: ChargingSession };
  'session.updated': { readonly session: ChargingSession; readonly reason: string };
  'session.ended': { readonly session: ChargingSession };
  'meter.updated': { readonly session: ChargingSession; readonly reading: MeterReading };
  'plan.solved': { readonly plan: PlanRecord };
  'dispatch.sent': { readonly dispatch: DispatchRecord };
  'flex.updated': { readonly flex: FlexEvent };
  'forecast.updated': { readonly forecast: ForecastSnapshot };
  'report.ready': { readonly report: SessionReport };
}

export type DomainEventType = keyof DomainEvents;
type Handler<K extends DomainEventType> = (payload: DomainEvents[K]) => void;

/**
 * Small typed bus. A handler that throws is logged and ignored: one bad subscriber must not
 * take down the OCPP gateway or the optimiser loop.
 */
export class EventBus {
  private readonly handlers = new Map<DomainEventType, Set<Handler<DomainEventType>>>();

  constructor(private readonly logger?: Logger) {}

  on<K extends DomainEventType>(type: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as Handler<DomainEventType>);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler as Handler<DomainEventType>);
    };
  }

  emit<K extends DomainEventType>(type: K, payload: DomainEvents[K]): void {
    for (const handler of this.handlers.get(type) ?? []) {
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        this.logger?.error({ err: error, event: type }, 'event handler failed');
      }
    }
  }

  listenerCount(type: DomainEventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}
