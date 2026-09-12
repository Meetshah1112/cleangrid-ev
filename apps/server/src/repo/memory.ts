import type {
  Charger,
  ChargingSession,
  ConnectorState,
  DispatchRecord,
  FlexEvent,
  FlexStatus,
  MeterReading,
  PlanRecord,
  SessionReport,
  Site,
  UserProfile,
  Vehicle,
} from '@cleangrid/shared';
import { NotFoundError } from '../errors';
import type {
  ChargerRepo,
  ConnectorRepo,
  DispatchRepo,
  FlexRepo,
  MeterRepo,
  PlanRepo,
  ProfileRepo,
  Repositories,
  ReportRepo,
  SessionQuery,
  SessionRepo,
  SignalRepo,
  SignalSample,
  SiteRepo,
  VehicleRepo,
} from './types';

/** In-memory repositories. Every stored record is frozen, so updates must go through the repo. */

class Store<T extends { readonly id: string }> {
  protected readonly items = new Map<string, T>();

  constructor(private readonly label: string) {}

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null;
  }

  async save(item: T): Promise<T> {
    const frozen = Object.freeze({ ...item });
    this.items.set(item.id, frozen);
    return frozen;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const current = this.items.get(id);
    if (!current) throw new NotFoundError(this.label, id);
    const next = Object.freeze({ ...current, ...patch });
    this.items.set(id, next);
    return next;
  }

  async list(): Promise<T[]> {
    return [...this.items.values()];
  }
}

class MemorySiteRepo extends Store<Site> implements SiteRepo {
  constructor() {
    super('site');
  }
}

class MemoryChargerRepo extends Store<Charger> implements ChargerRepo {
  constructor() {
    super('charger');
  }

  async getByIdentity(ocppIdentity: string): Promise<Charger | null> {
    return [...this.items.values()].find((charger) => charger.ocppIdentity === ocppIdentity) ?? null;
  }

  async listBySite(siteId: string): Promise<Charger[]> {
    return [...this.items.values()].filter((charger) => charger.siteId === siteId);
  }
}

class MemoryConnectorRepo implements ConnectorRepo {
  private readonly items = new Map<string, ConnectorState>();

  private key(chargerId: string, connectorId: number): string {
    return `${chargerId}#${connectorId}`;
  }

  async get(chargerId: string, connectorId: number): Promise<ConnectorState | null> {
    return this.items.get(this.key(chargerId, connectorId)) ?? null;
  }

  async listByCharger(chargerId: string): Promise<ConnectorState[]> {
    return [...this.items.values()].filter((state) => state.chargerId === chargerId);
  }

  async upsert(state: ConnectorState): Promise<ConnectorState> {
    const frozen = Object.freeze({ ...state });
    this.items.set(this.key(state.chargerId, state.connectorId), frozen);
    return frozen;
  }
}

class MemorySessionRepo extends Store<ChargingSession> implements SessionRepo {
  private transactionCounter = 1000;

  constructor() {
    super('session');
  }

  async listBySite(siteId: string, query: SessionQuery = {}): Promise<ChargingSession[]> {
    const matches = [...this.items.values()]
      .filter((session) => session.siteId === siteId && (query.status === undefined || session.status === query.status))
      .sort((a, b) => b.pluggedInMs - a.pluggedInMs);
    return query.limit === undefined ? matches : matches.slice(0, query.limit);
  }

  async listActive(siteId: string): Promise<ChargingSession[]> {
    return [...this.items.values()]
      .filter((session) => session.siteId === siteId && session.status === 'active')
      .sort((a, b) => a.pluggedInMs - b.pluggedInMs);
  }

  async listByDriver(driverId: string, limit = 50): Promise<ChargingSession[]> {
    return [...this.items.values()]
      .filter((session) => session.driverId === driverId)
      .sort((a, b) => b.pluggedInMs - a.pluggedInMs)
      .slice(0, limit);
  }

  async getByTransaction(transactionId: number): Promise<ChargingSession | null> {
    return [...this.items.values()].find((session) => session.transactionId === transactionId) ?? null;
  }

  async findPending(chargerId: string, connectorId: number, idTag?: string): Promise<ChargingSession | null> {
    const candidates = [...this.items.values()]
      .filter(
        (session) =>
          session.status === 'pending' && session.chargerId === chargerId && session.connectorId === connectorId,
      )
      .sort((a, b) => b.createdMs - a.createdMs);
    if (idTag !== undefined) {
      const exact = candidates.find((session) => session.idTag === idTag);
      if (exact) return exact;
    }
    return candidates[0] ?? null;
  }

  async findActiveByConnector(chargerId: string, connectorId: number): Promise<ChargingSession | null> {
    return (
      [...this.items.values()]
        .filter(
          (session) =>
            session.status === 'active' && session.chargerId === chargerId && session.connectorId === connectorId,
        )
        .sort((a, b) => b.pluggedInMs - a.pluggedInMs)[0] ?? null
    );
  }

  async nextTransactionId(): Promise<number> {
    this.transactionCounter += 1;
    return this.transactionCounter;
  }

  async resumeTransactionIds(highestIssued: number): Promise<void> {
    if (Number.isFinite(highestIssued)) this.transactionCounter = Math.max(this.transactionCounter, highestIssued);
  }
}

class MemoryMeterRepo implements MeterRepo {
  private readonly bySession = new Map<string, MeterReading[]>();

  async append(reading: MeterReading): Promise<MeterReading> {
    const frozen = Object.freeze({ ...reading });
    const list = this.bySession.get(reading.sessionId) ?? [];
    list.push(frozen);
    this.bySession.set(reading.sessionId, list);
    return frozen;
  }

  async listBySession(sessionId: string): Promise<MeterReading[]> {
    return [...(this.bySession.get(sessionId) ?? [])].sort((a, b) => a.tsMs - b.tsMs);
  }

  async lastBySession(sessionId: string): Promise<MeterReading | null> {
    const list = this.bySession.get(sessionId) ?? [];
    return list.length === 0 ? null : (list[list.length - 1] as MeterReading);
  }
}

class MemoryPlanRepo extends Store<PlanRecord> implements PlanRepo {
  constructor() {
    super('plan');
  }

  async latest(siteId: string): Promise<PlanRecord | null> {
    return (await this.listBySite(siteId, 1))[0] ?? null;
  }

  async listBySite(siteId: string, limit = 20): Promise<PlanRecord[]> {
    return [...this.items.values()]
      .filter((plan) => plan.siteId === siteId)
      .sort((a, b) => b.solvedMs - a.solvedMs)
      .slice(0, limit);
  }
}

class MemoryDispatchRepo implements DispatchRepo {
  private readonly records: DispatchRecord[] = [];

  async append(record: DispatchRecord): Promise<DispatchRecord> {
    const frozen = Object.freeze({ ...record });
    this.records.push(frozen);
    return frozen;
  }

  async listBySite(siteId: string, limit = 100): Promise<DispatchRecord[]> {
    return this.records
      .filter((record) => record.siteId === siteId)
      .sort((a, b) => b.sentMs - a.sentMs)
      .slice(0, limit);
  }
}

class MemoryFlexRepo extends Store<FlexEvent> implements FlexRepo {
  constructor() {
    super('flex event');
  }

  async listBySite(siteId: string, statuses?: readonly FlexStatus[]): Promise<FlexEvent[]> {
    return [...this.items.values()]
      .filter((event) => event.siteId === siteId && (statuses === undefined || statuses.includes(event.status)))
      .sort((a, b) => a.startsMs - b.startsMs);
  }
}

class MemoryReportRepo implements ReportRepo {
  private readonly items = new Map<string, SessionReport>();

  async save(report: SessionReport): Promise<SessionReport> {
    const frozen = Object.freeze({ ...report });
    this.items.set(report.sessionId, frozen);
    return frozen;
  }

  async get(sessionId: string): Promise<SessionReport | null> {
    return this.items.get(sessionId) ?? null;
  }

  async list(sessionIds: readonly string[]): Promise<SessionReport[]> {
    return sessionIds.flatMap((id) => {
      const report = this.items.get(id);
      return report ? [report] : [];
    });
  }
}

class MemoryProfileRepo extends Store<UserProfile> implements ProfileRepo {
  constructor() {
    super('profile');
  }

  async getByIdTag(idTag: string): Promise<UserProfile | null> {
    return [...this.items.values()].find((profile) => profile.idTag === idTag) ?? null;
  }
}

class MemoryVehicleRepo extends Store<Vehicle> implements VehicleRepo {
  constructor() {
    super('vehicle');
  }

  async listByDriver(driverId: string): Promise<Vehicle[]> {
    return [...this.items.values()].filter((vehicle) => vehicle.driverId === driverId);
  }
}

class MemorySignalRepo implements SignalRepo {
  private readonly samples = new Map<string, SignalSample>();

  private key(sample: Pick<SignalSample, 'siteId' | 'kind' | 'slotStartMs'>): string {
    return `${sample.siteId}#${sample.kind}#${sample.slotStartMs}`;
  }

  async upsertMany(samples: readonly SignalSample[]): Promise<void> {
    for (const sample of samples) this.samples.set(this.key(sample), Object.freeze({ ...sample }));
  }

  async list(siteId: string, kind: SignalSample['kind'], fromMs: number, toMs: number): Promise<SignalSample[]> {
    return [...this.samples.values()]
      .filter(
        (sample) =>
          sample.siteId === siteId && sample.kind === kind && sample.slotStartMs >= fromMs && sample.slotStartMs < toMs,
      )
      .sort((a, b) => a.slotStartMs - b.slotStartMs);
  }
}

export function createMemoryRepositories(): Repositories {
  return {
    sites: new MemorySiteRepo(),
    chargers: new MemoryChargerRepo(),
    connectors: new MemoryConnectorRepo(),
    sessions: new MemorySessionRepo(),
    meters: new MemoryMeterRepo(),
    plans: new MemoryPlanRepo(),
    dispatches: new MemoryDispatchRepo(),
    flex: new MemoryFlexRepo(),
    reports: new MemoryReportRepo(),
    profiles: new MemoryProfileRepo(),
    vehicles: new MemoryVehicleRepo(),
    signals: new MemorySignalRepo(),
  };
}
