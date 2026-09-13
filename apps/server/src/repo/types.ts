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
  SessionStatus,
  Site,
  UserProfile,
  Vehicle,
} from '@cleangrid/shared';

/**
 * Storage behind one interface so the process can run on in-memory data during development
 * and on Supabase Postgres later without touching the services above it.
 */

export interface SiteRepo {
  get(id: string): Promise<Site | null>;
  list(): Promise<Site[]>;
  save(site: Site): Promise<Site>;
  update(id: string, patch: Partial<Site>): Promise<Site>;
}

export interface ChargerRepo {
  get(id: string): Promise<Charger | null>;
  getByIdentity(ocppIdentity: string): Promise<Charger | null>;
  listBySite(siteId: string): Promise<Charger[]>;
  save(charger: Charger): Promise<Charger>;
  update(id: string, patch: Partial<Charger>): Promise<Charger>;
}

export interface ConnectorRepo {
  get(chargerId: string, connectorId: number): Promise<ConnectorState | null>;
  listByCharger(chargerId: string): Promise<ConnectorState[]>;
  upsert(state: ConnectorState): Promise<ConnectorState>;
}

export interface SessionQuery {
  readonly status?: SessionStatus;
  readonly limit?: number;
}

export interface SessionRepo {
  get(id: string): Promise<ChargingSession | null>;
  save(session: ChargingSession): Promise<ChargingSession>;
  update(id: string, patch: Partial<ChargingSession>): Promise<ChargingSession>;
  listBySite(siteId: string, query?: SessionQuery): Promise<ChargingSession[]>;
  listActive(siteId: string): Promise<ChargingSession[]>;
  listByDriver(driverId: string, limit?: number): Promise<ChargingSession[]>;
  getByTransaction(transactionId: number): Promise<ChargingSession | null>;
  /** A session the driver declared before the charger reported the transaction. */
  findPending(chargerId: string, connectorId: number, idTag?: string): Promise<ChargingSession | null>;
  /** A connector can only carry one transaction at a time; this is the one it is carrying. */
  findActiveByConnector(chargerId: string, connectorId: number): Promise<ChargingSession | null>;
  /**
   * The session a driver has open, charging or waiting to start, however many finished ones they
   * have. Looked for directly rather than among their latest, because the latest by date can all be
   * finished sessions dated ahead of an open one.
   */
  findOpenByDriver(driverId: string): Promise<ChargingSession | null>;
  /** A session holding a connector, charging or declared and waiting for the cable. */
  findOpenByConnector(chargerId: string, connectorId: number): Promise<ChargingSession | null>;
  nextTransactionId(): Promise<number>;
  /**
   * Continue the OCPP transaction sequence above ids already issued. A restart must not reuse a
   * number the stored record has seen, because a transaction id identifies a charging session for
   * as long as it is kept.
   */
  resumeTransactionIds(highestIssued: number): Promise<void>;
}

export interface MeterRepo {
  append(reading: MeterReading): Promise<MeterReading>;
  listBySession(sessionId: string): Promise<MeterReading[]>;
  lastBySession(sessionId: string): Promise<MeterReading | null>;
}

export interface PlanRepo {
  save(plan: PlanRecord): Promise<PlanRecord>;
  latest(siteId: string): Promise<PlanRecord | null>;
  listBySite(siteId: string, limit?: number): Promise<PlanRecord[]>;
}

export interface DispatchRepo {
  append(record: DispatchRecord): Promise<DispatchRecord>;
  listBySite(siteId: string, limit?: number): Promise<DispatchRecord[]>;
}

export interface FlexRepo {
  get(id: string): Promise<FlexEvent | null>;
  save(event: FlexEvent): Promise<FlexEvent>;
  update(id: string, patch: Partial<FlexEvent>): Promise<FlexEvent>;
  listBySite(siteId: string, statuses?: readonly FlexStatus[]): Promise<FlexEvent[]>;
  list(): Promise<FlexEvent[]>;
}

export interface ReportRepo {
  save(report: SessionReport): Promise<SessionReport>;
  get(sessionId: string): Promise<SessionReport | null>;
  list(sessionIds: readonly string[]): Promise<SessionReport[]>;
}

export interface ProfileRepo {
  get(id: string): Promise<UserProfile | null>;
  getByIdTag(idTag: string): Promise<UserProfile | null>;
  list(): Promise<UserProfile[]>;
  save(profile: UserProfile): Promise<UserProfile>;
}

export interface VehicleRepo {
  get(id: string): Promise<Vehicle | null>;
  listByDriver(driverId: string): Promise<Vehicle[]>;
  save(vehicle: Vehicle): Promise<Vehicle>;
}

/** Measured or forecast grid signals kept for later verification of reports. */
export interface SignalSample {
  readonly siteId: string;
  readonly kind: 'carbon' | 'price' | 'renewable' | 'actual_carbon';
  readonly slotStartMs: number;
  readonly value: number;
  readonly source: string;
  readonly fetchedMs: number;
}

export interface SignalRepo {
  upsertMany(samples: readonly SignalSample[]): Promise<void>;
  list(siteId: string, kind: SignalSample['kind'], fromMs: number, toMs: number): Promise<SignalSample[]>;
}

export interface Repositories {
  readonly sites: SiteRepo;
  readonly chargers: ChargerRepo;
  readonly connectors: ConnectorRepo;
  readonly sessions: SessionRepo;
  readonly meters: MeterRepo;
  readonly plans: PlanRepo;
  readonly dispatches: DispatchRepo;
  readonly flex: FlexRepo;
  readonly reports: ReportRepo;
  readonly profiles: ProfileRepo;
  readonly vehicles: VehicleRepo;
  readonly signals: SignalRepo;
}
