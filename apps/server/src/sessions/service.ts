import {
  MS_PER_HOUR,
  round,
  whToKwh,
  type ChargingMode,
  type ChargingSession,
  type Clock,
  type SessionSource,
} from '@cleangrid/shared';
import { randomUUID } from 'node:crypto';
import type { EventBus } from '../events';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import type { Repositories } from '../repo/types';

/**
 * Owns the life of a charging session: the driver's declared need and deadline, the OCPP
 * transaction that fulfils it, and the meter readings that say what actually happened.
 */

export interface SessionServiceDeps {
  readonly repos: Repositories;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface DeclareIntentInput {
  readonly siteId: string;
  readonly chargerId: string;
  readonly connectorId: number;
  readonly driverId: string | null;
  readonly vehicleId?: string | null;
  readonly idTag: string;
  readonly energyKwh: number;
  readonly deadlineMs: number;
  readonly mode: ChargingMode;
  readonly source: SessionSource;
  readonly maxPowerKw: number;
}

export interface StartTransactionInput {
  readonly chargerId: string;
  readonly connectorId: number;
  readonly idTag: string;
  readonly meterStartWh: number;
  readonly tsMs: number;
}

export interface MeterInput {
  readonly transactionId: number;
  readonly tsMs: number;
  readonly energyWh: number | null;
  readonly powerW: number | null;
  readonly soc: number | null;
}

export interface StopTransactionInput {
  readonly transactionId: number;
  readonly meterStopWh: number;
  readonly tsMs: number;
  readonly reason?: string;
}

export interface SessionPatch {
  readonly deadlineMs?: number;
  readonly energyKwh?: number;
  readonly mode?: ChargingMode;
}

export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  /** Energy still owed to the car. */
  remainingKwh(session: ChargingSession): number {
    return Math.max(0, round(session.energyNeededKwh - session.energyDeliveredKwh, 4));
  }

  /** The driver's app declares a need and a deadline; the transaction may not have started yet. */
  async declareIntent(input: DeclareIntentInput): Promise<ChargingSession> {
    const nowMs = this.deps.clock.now();
    const session: ChargingSession = {
      id: randomUUID(),
      siteId: input.siteId,
      chargerId: input.chargerId,
      connectorId: input.connectorId,
      driverId: input.driverId,
      vehicleId: input.vehicleId ?? null,
      idTag: input.idTag,
      transactionId: null,
      source: input.source,
      status: 'pending',
      mode: input.mode,
      pluggedInMs: nowMs,
      deadlineMs: input.deadlineMs,
      deadlineIsDefault: false,
      unpluggedMs: null,
      energyNeededKwh: input.energyKwh,
      energyDeliveredKwh: 0,
      maxPowerKw: input.maxPowerKw,
      meterStartWh: null,
      lastMeterWh: null,
      currentPowerKw: 0,
      limitKw: null,
      deadlineRisk: false,
      createdMs: nowMs,
      updatedMs: nowMs,
    };
    const saved = await this.deps.repos.sessions.save(session);
    this.deps.bus.emit('session.created', { session: saved });
    return saved;
  }

  /**
   * A charger reported StartTransaction. Attach it to the driver's declared session if there is
   * one, otherwise open a session from that driver's defaults (a walk-up RFID tap).
   */
  async startTransaction(input: StartTransactionInput): Promise<{ session: ChargingSession; transactionId: number }> {
    const { repos, bus } = this.deps;
    const charger = await repos.chargers.get(input.chargerId);
    if (!charger) throw new NotFoundError('charger', input.chargerId);

    // A connector carries one transaction at a time. If something is still open on it, the cable
    // came out without a StopTransaction or the charger restarted: close it before opening another.
    const stale = await repos.sessions.findActiveByConnector(input.chargerId, input.connectorId);
    if (stale) await this.abandon(stale.id, 'a new transaction started on this connector');

    const transactionId = await repos.sessions.nextTransactionId();
    const declared = await repos.sessions.findPending(input.chargerId, input.connectorId, input.idTag);
    const base = declared ?? (await this.openFromDefaults(input, charger.siteId, charger.maxPowerKw));

    const deadlineMs = base.deadlineIsDefault
      ? input.tsMs + (await this.defaultDwellHours(base.driverId)) * MS_PER_HOUR
      : base.deadlineMs;

    const session = await repos.sessions.update(base.id, {
      transactionId,
      status: 'active',
      pluggedInMs: input.tsMs,
      deadlineMs,
      meterStartWh: input.meterStartWh,
      lastMeterWh: input.meterStartWh,
      energyDeliveredKwh: 0,
      updatedMs: input.tsMs,
    });
    bus.emit('session.updated', { session, reason: 'transaction_started' });
    return { session, transactionId };
  }

  async recordMeter(input: MeterInput): Promise<ChargingSession | null> {
    const { repos, bus, logger } = this.deps;
    const session = await repos.sessions.getByTransaction(input.transactionId);
    if (!session) {
      logger.warn({ transactionId: input.transactionId }, 'meter values for an unknown transaction');
      return null;
    }
    if (session.status !== 'active') {
      logger.warn({ sessionId: session.id, status: session.status }, 'meter values for a session that is not active');
      return null;
    }
    if (input.energyWh === null) return session;

    const startWh = session.meterStartWh ?? input.energyWh;
    const previousWh = session.lastMeterWh ?? startWh;
    if (input.energyWh + 1 < previousWh) {
      logger.warn(
        { sessionId: session.id, previousWh, energyWh: input.energyWh },
        'meter register went backwards, reading ignored',
      );
      return session;
    }

    const reading = { sessionId: session.id, tsMs: input.tsMs, energyWh: input.energyWh, powerW: input.powerW ?? 0, soc: input.soc };
    await repos.meters.append(reading);
    const updated = await repos.sessions.update(session.id, {
      lastMeterWh: input.energyWh,
      energyDeliveredKwh: round(whToKwh(input.energyWh - startWh), 4),
      currentPowerKw: round((input.powerW ?? 0) / 1000, 3),
      updatedMs: input.tsMs,
    });
    bus.emit('meter.updated', { session: updated, reading });
    return updated;
  }

  async stopTransaction(input: StopTransactionInput): Promise<ChargingSession | null> {
    const { repos, bus, logger } = this.deps;
    const session = await repos.sessions.getByTransaction(input.transactionId);
    if (!session) {
      logger.warn({ transactionId: input.transactionId }, 'stop for an unknown transaction');
      return null;
    }
    const startWh = session.meterStartWh ?? input.meterStopWh;
    const delivered = round(whToKwh(Math.max(0, input.meterStopWh - startWh)), 4);
    const ended = await repos.sessions.update(session.id, {
      status: 'complete',
      unpluggedMs: input.tsMs,
      lastMeterWh: input.meterStopWh,
      energyDeliveredKwh: delivered,
      currentPowerKw: 0,
      limitKw: null,
      updatedMs: input.tsMs,
    });
    bus.emit('session.ended', { session: ended });
    return ended;
  }

  /** Driver or operator changes the deadline, the need or the mode. */
  async patch(sessionId: string, patch: SessionPatch, reason = 'driver'): Promise<ChargingSession> {
    const { repos, bus, clock } = this.deps;
    const session = await repos.sessions.get(sessionId);
    if (!session) throw new NotFoundError('session', sessionId);
    if (session.status === 'complete' || session.status === 'aborted') {
      throw new ConflictError('session_finished', 'this session has already finished');
    }
    if (patch.deadlineMs !== undefined && patch.deadlineMs <= clock.now()) {
      throw new ValidationError('deadline_in_past', 'the deadline must be in the future');
    }
    const updated = await repos.sessions.update(sessionId, {
      ...(patch.deadlineMs === undefined ? {} : { deadlineMs: patch.deadlineMs, deadlineIsDefault: false }),
      ...(patch.energyKwh === undefined ? {} : { energyNeededKwh: patch.energyKwh }),
      ...(patch.mode === undefined ? {} : { mode: patch.mode }),
      updatedMs: clock.now(),
    });
    bus.emit('session.updated', { session: updated, reason });
    return updated;
  }

  /** Record what the dispatcher last told the charger, for the dashboard and the driver app. */
  async setLimit(sessionId: string, limitKw: number | null): Promise<ChargingSession> {
    return this.deps.repos.sessions.update(sessionId, { limitKw, updatedMs: this.deps.clock.now() });
  }

  async setDeadlineRisk(sessionId: string, deadlineRisk: boolean): Promise<void> {
    const session = await this.deps.repos.sessions.get(sessionId);
    if (!session || session.deadlineRisk === deadlineRisk) return;
    const updated = await this.deps.repos.sessions.update(sessionId, { deadlineRisk, updatedMs: this.deps.clock.now() });
    this.deps.bus.emit('session.updated', { session: updated, reason: 'deadline_risk' });
  }

  /** Close sessions whose charger dropped off without a StopTransaction. */
  async abandon(sessionId: string, reason: string): Promise<void> {
    const session = await this.deps.repos.sessions.get(sessionId);
    if (!session || session.status !== 'active') return;
    const ended = await this.deps.repos.sessions.update(sessionId, {
      status: 'aborted',
      unpluggedMs: this.deps.clock.now(),
      currentPowerKw: 0,
      limitKw: null,
      updatedMs: this.deps.clock.now(),
    });
    this.deps.logger.warn({ sessionId, reason }, 'session abandoned');
    this.deps.bus.emit('session.ended', { session: ended });
  }

  private async defaultDwellHours(driverId: string | null): Promise<number> {
    if (!driverId) return 8;
    const profile = await this.deps.repos.profiles.get(driverId);
    return profile?.defaultDwellHours ?? 8;
  }

  private async openFromDefaults(
    input: StartTransactionInput,
    siteId: string,
    chargerMaxKw: number,
  ): Promise<ChargingSession> {
    const { repos } = this.deps;
    const profile = await repos.profiles.getByIdTag(input.idTag);
    const vehicles = profile ? await repos.vehicles.listByDriver(profile.id) : [];
    const vehicle = vehicles[0] ?? null;
    return this.declareIntent({
      siteId,
      chargerId: input.chargerId,
      connectorId: input.connectorId,
      driverId: profile?.id ?? null,
      vehicleId: vehicle?.id ?? null,
      idTag: input.idTag,
      energyKwh: profile?.defaultEnergyKwh ?? 20,
      deadlineMs: input.tsMs + (profile?.defaultDwellHours ?? 8) * MS_PER_HOUR,
      mode: profile?.defaultMode ?? 'balanced',
      source: 'rfid',
      maxPowerKw: Math.min(chargerMaxKw, vehicle?.maxChargeKw ?? chargerMaxKw),
    }).then((session) => this.deps.repos.sessions.update(session.id, { deadlineIsDefault: true }));
  }
}
