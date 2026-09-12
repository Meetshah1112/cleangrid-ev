import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Charger,
  ChargingSession,
  ConnectorState,
  DispatchRecord,
  FlexEvent,
  MeterReading,
  PlanRecord,
  SessionReport,
  Site,
  UserProfile,
  Vehicle,
} from '@cleangrid/shared';
import type { Logger } from 'pino';
import { createMemoryRepositories } from '../memory';
import type { Repositories, SignalSample } from '../types';
import {
  chargerRow,
  connectorRow,
  dispatchRow,
  flexRow,
  meterRow,
  planRow,
  planScheduleRows,
  profileRow,
  reportRow,
  rowToCharger,
  rowToProfile,
  rowToSite,
  rowToVehicle,
  sessionRow,
  signalRow,
  siteRow,
  vehicleRow,
} from './rows';
import { MirrorWriter, type MirrorOptions, type MirrorStats } from './writer';

/**
 * Supabase-backed repositories.
 *
 * Reads are served from memory and every write is mirrored to Postgres through {@link MirrorWriter}.
 * This is deliberate: one process owns these sites, its optimiser has to answer inside a
 * quarter-hour slot, and a network round trip per meter value would put a database in the middle of
 * a control loop. What is stored is complete — sites, chargers, sessions, meter readings, plans,
 * dispatches, reports and grid signals all land in Postgres, under the row level security in
 * 0002_rls.sql — it simply lands a moment after the decision, not before it.
 *
 * Because memory always holds the whole object, every mirrored write is a full-row upsert. That
 * makes writes idempotent and order within a table irrelevant; only the order between tables
 * matters, and the FIFO queue preserves it.
 */

export interface SupabaseRepoOptions {
  readonly url: string;
  readonly serviceKey: string;
  readonly logger: Logger;
  readonly mirror?: MirrorOptions;
}

export interface SupabaseRepositories {
  readonly repos: Repositories;
  /** Load the topology Postgres already knows about, before the scenario seed runs. */
  hydrate(): Promise<{ sites: number; chargers: number; profiles: number; vehicles: number }>;
  stats(): MirrorStats;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function createSupabaseClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'cleangrid-server' } },
  });
}

export function createSupabaseRepositories(options: SupabaseRepoOptions): SupabaseRepositories {
  const client = createSupabaseClient(options.url, options.serviceKey);
  const writer = new MirrorWriter(client, options.logger, options.mirror);
  const memory = createMemoryRepositories();

  const repos: Repositories = {
    sites: {
      get: (id) => memory.sites.get(id),
      list: () => memory.sites.list(),
      save: async (site: Site) => mirror(await memory.sites.save(site), (value) => writer.enqueue('sites', siteRow(value), 'id')),
      update: async (id, patch) =>
        mirror(await memory.sites.update(id, patch), (value) => writer.enqueue('sites', siteRow(value), 'id')),
    },

    chargers: {
      get: (id) => memory.chargers.get(id),
      getByIdentity: (identity) => memory.chargers.getByIdentity(identity),
      listBySite: (siteId) => memory.chargers.listBySite(siteId),
      save: async (charger: Charger) =>
        mirror(await memory.chargers.save(charger), (value) => writer.enqueue('chargers', chargerRow(value), 'id')),
      update: async (id, patch) =>
        mirror(await memory.chargers.update(id, patch), (value) => writer.enqueue('chargers', chargerRow(value), 'id')),
    },

    connectors: {
      get: (chargerId, connectorId) => memory.connectors.get(chargerId, connectorId),
      listByCharger: (chargerId) => memory.connectors.listByCharger(chargerId),
      upsert: async (state: ConnectorState) =>
        mirror(await memory.connectors.upsert(state), (value) =>
          writer.enqueue('connectors', connectorRow(value), 'charger_id,connector_id'),
        ),
    },

    sessions: {
      get: (id) => memory.sessions.get(id),
      listBySite: (siteId, query) => memory.sessions.listBySite(siteId, query),
      listActive: (siteId) => memory.sessions.listActive(siteId),
      listByDriver: (driverId, limit) => memory.sessions.listByDriver(driverId, limit),
      getByTransaction: (transactionId) => memory.sessions.getByTransaction(transactionId),
      findPending: (chargerId, connectorId, idTag) => memory.sessions.findPending(chargerId, connectorId, idTag),
      findActiveByConnector: (chargerId, connectorId) =>
        memory.sessions.findActiveByConnector(chargerId, connectorId),
      nextTransactionId: () => memory.sessions.nextTransactionId(),
      save: async (session: ChargingSession) =>
        mirror(await memory.sessions.save(session), (value) => writer.enqueue('sessions', sessionRow(value), 'id')),
      update: async (id, patch) =>
        mirror(await memory.sessions.update(id, patch), (value) => writer.enqueue('sessions', sessionRow(value), 'id')),
    },

    meters: {
      listBySession: (sessionId) => memory.meters.listBySession(sessionId),
      lastBySession: (sessionId) => memory.meters.lastBySession(sessionId),
      append: async (reading: MeterReading) =>
        mirror(await memory.meters.append(reading), (value) =>
          writer.enqueue('meter_readings', meterRow(value), 'session_id,recorded_at'),
        ),
    },

    plans: {
      latest: (siteId) => memory.plans.latest(siteId),
      listBySite: (siteId, limit) => memory.plans.listBySite(siteId, limit),
      save: async (plan: PlanRecord) =>
        mirror(await memory.plans.save(plan), (value) => {
          writer.enqueue('plans', planRow(value), 'id');
          writer.enqueue('plan_schedules', planScheduleRows(value), 'plan_id,session_id');
        }),
    },

    dispatches: {
      listBySite: (siteId, limit) => memory.dispatches.listBySite(siteId, limit),
      append: async (record: DispatchRecord) =>
        mirror(await memory.dispatches.append(record), (value) => writer.enqueue('dispatch_log', dispatchRow(value), 'id')),
    },

    flex: {
      get: (id) => memory.flex.get(id),
      list: () => memory.flex.list(),
      listBySite: (siteId, statuses) => memory.flex.listBySite(siteId, statuses),
      save: async (event: FlexEvent) =>
        mirror(await memory.flex.save(event), (value) => writer.enqueue('flex_events', flexRow(value), 'id')),
      update: async (id, patch) =>
        mirror(await memory.flex.update(id, patch), (value) => writer.enqueue('flex_events', flexRow(value), 'id')),
    },

    reports: {
      get: (sessionId) => memory.reports.get(sessionId),
      list: (sessionIds) => memory.reports.list(sessionIds),
      save: async (report: SessionReport) =>
        mirror(await memory.reports.save(report), (value) => writer.enqueue('session_reports', reportRow(value), 'session_id')),
    },

    profiles: {
      get: (id) => memory.profiles.get(id),
      getByIdTag: (idTag) => memory.profiles.getByIdTag(idTag),
      list: () => memory.profiles.list(),
      save: async (profile: UserProfile) =>
        mirror(await memory.profiles.save(profile), (value) => writer.enqueue('profiles', profileRow(value), 'id')),
    },

    vehicles: {
      get: (id) => memory.vehicles.get(id),
      listByDriver: (driverId) => memory.vehicles.listByDriver(driverId),
      save: async (vehicle: Vehicle) =>
        mirror(await memory.vehicles.save(vehicle), (value) => writer.enqueue('vehicles', vehicleRow(value), 'id')),
    },

    signals: {
      list: (siteId, kind, fromMs, toMs) => memory.signals.list(siteId, kind, fromMs, toMs),
      upsertMany: async (samples: readonly SignalSample[]) => {
        await memory.signals.upsertMany(samples);
        if (samples.length > 0) writer.enqueue('grid_signals', samples.map(signalRow), 'site_id,kind,slot_start');
      },
    },
  };

  /** Mirror after the memory write succeeds, and hand back exactly what memory returned. */
  function mirror<T>(value: T, send: (value: T) => void): T {
    send(value);
    return value;
  }

  async function hydrate(): Promise<{ sites: number; chargers: number; profiles: number; vehicles: number }> {
    // Topology first: a session cannot be read before the charger it is plugged into exists.
    const sites = await load('sites', rowToSite, (site) => memory.sites.save(site));
    const profiles = await load('profiles', rowToProfile, (profile) => memory.profiles.save(profile));
    const vehicles = await load('vehicles', rowToVehicle, (vehicle) => memory.vehicles.save(vehicle));
    const chargers = await load('chargers', rowToCharger, (charger) => memory.chargers.save(charger));
    return { sites, profiles, vehicles, chargers };
  }

  async function load<T>(
    table: string,
    map: (row: Record<string, unknown>) => T,
    save: (value: T) => Promise<unknown>,
  ): Promise<number> {
    const { data, error } = await client.from(table).select('*');
    if (error) {
      options.logger.warn({ table, error: error.message }, 'could not hydrate from supabase');
      return 0;
    }
    for (const row of data ?? []) await save(map(row as Record<string, unknown>));
    return data?.length ?? 0;
  }

  return {
    repos,
    hydrate,
    stats: () => writer.stats(),
    flush: () => writer.flush(),
    close: () => writer.stop(),
  };
}
