import {
  OCPP_SUBPROTOCOL,
  OcppCallError,
  OcppRpc,
  ocppSchemas,
  readMeterValue,
  type ClearChargingProfileRequest,
  type ClearChargingProfileResponse,
  type MeterValue,
  type Payload,
  type RemoteStartTransactionRequest,
  type RemoteStartTransactionResponse,
  type RemoteStopTransactionRequest,
  type RemoteStopTransactionResponse,
  type ResetResponse,
  type SetChargingProfileRequest,
  type SetChargingProfileResponse,
} from '@cleangrid/ocpp';
import type { Charger, Clock, ConnectorStatus } from '@cleangrid/shared';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { EventBus } from '../events';
import type { Logger } from '../logger';
import type { Repositories } from '../repo/types';
import type { SessionService } from '../sessions/service';

/**
 * The central system side of OCPP 1.6J. Chargers connect to /ocpp/<identity>; everything the
 * server sends them (charging profiles, remote start/stop, reset) goes out through here.
 */

export const OCPP_PATH_PREFIX = '/ocpp/';
/** Stack level 0 default profile installed on every charger as a connection-overload guard. */
export const SAFETY_PROFILE_ID = 99;

export interface GatewayDeps {
  readonly repos: Repositories;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sessions: SessionService;
  readonly heartbeatIntervalS?: number;
  readonly callTimeoutMs?: number;
  /** Off in baseline mode, where nothing may limit a charger. */
  readonly safetyProfiles?: boolean;
}

interface Connection {
  readonly chargerId: string;
  readonly identity: string;
  readonly rpc: OcppRpc;
  readonly socket: WebSocket;
  readonly connectedMs: number;
}

export class OcppGateway {
  private readonly wss: WebSocketServer;
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly deps: GatewayDeps) {
    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => (protocols.has(OCPP_SUBPROTOCOL) ? OCPP_SUBPROTOCOL : false),
    });
  }

  /** Route WebSocket upgrades for /ocpp/<identity> to this gateway. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, identity: string): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      void this.accept(identity, ws);
    });
  }

  /** Attach directly to an http.Server when the API is not in front of it (tests). */
  attach(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      const url = request.url ?? '';
      if (!url.startsWith(OCPP_PATH_PREFIX)) return;
      this.handleUpgrade(request, socket as Duplex, head, decodeURIComponent(url.slice(OCPP_PATH_PREFIX.length)));
    });
  }

  isOnline(chargerId: string): boolean {
    return this.connections.has(chargerId);
  }

  onlineCount(): number {
    return this.connections.size;
  }

  async setChargingProfile(chargerId: string, request: SetChargingProfileRequest): Promise<SetChargingProfileResponse> {
    return this.call<SetChargingProfileResponse>(chargerId, 'SetChargingProfile', request as unknown as Payload);
  }

  async clearChargingProfile(
    chargerId: string,
    request: ClearChargingProfileRequest,
  ): Promise<ClearChargingProfileResponse> {
    return this.call<ClearChargingProfileResponse>(chargerId, 'ClearChargingProfile', request as unknown as Payload);
  }

  async remoteStart(
    chargerId: string,
    request: RemoteStartTransactionRequest,
  ): Promise<RemoteStartTransactionResponse> {
    return this.call<RemoteStartTransactionResponse>(chargerId, 'RemoteStartTransaction', request as unknown as Payload);
  }

  async remoteStop(chargerId: string, request: RemoteStopTransactionRequest): Promise<RemoteStopTransactionResponse> {
    return this.call<RemoteStopTransactionResponse>(chargerId, 'RemoteStopTransaction', request as unknown as Payload);
  }

  async reset(chargerId: string, type: 'Hard' | 'Soft' = 'Soft'): Promise<ResetResponse> {
    return this.call<ResetResponse>(chargerId, 'Reset', { type });
  }

  async close(): Promise<void> {
    for (const connection of this.connections.values()) {
      connection.rpc.close('server shutting down');
      connection.socket.close(1001, 'server shutting down');
    }
    this.connections.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private async call<T>(chargerId: string, action: string, payload: Payload): Promise<T> {
    const connection = this.connections.get(chargerId);
    if (!connection) throw new OcppCallError('GenericError', `charger ${chargerId} is offline`);
    return connection.rpc.call<T>(action, payload);
  }

  private async accept(identity: string, socket: WebSocket): Promise<void> {
    const { repos, logger, clock, bus } = this.deps;
    const charger = await repos.chargers.getByIdentity(identity);
    if (!charger) {
      logger.warn({ identity }, 'rejecting unknown charge point');
      socket.close(1008, 'unknown charge point');
      return;
    }

    const existing = this.connections.get(charger.id);
    if (existing) {
      logger.warn({ identity }, 'charge point reconnected, dropping the previous socket');
      existing.rpc.close('replaced by a new connection');
      existing.socket.close(1012, 'replaced');
    }

    const rpc = new OcppRpc(
      (data) => socket.send(data),
      (action, payload) => this.dispatchInbound(charger.id, action, payload),
      {
        ...(this.deps.callTimeoutMs === undefined ? {} : { callTimeoutMs: this.deps.callTimeoutMs }),
        onWarning: (message, detail) => logger.warn({ identity, detail }, `ocpp: ${message}`),
      },
    );
    this.connections.set(charger.id, { chargerId: charger.id, identity, rpc, socket, connectedMs: clock.now() });

    socket.on('message', (data) => {
      void rpc.receive(typeof data === 'string' ? data : data.toString());
    });
    socket.on('close', () => {
      void this.handleClose(charger.id, rpc);
    });
    socket.on('error', (error) => logger.warn({ err: error, identity }, 'charge point socket error'));

    const online = await repos.chargers.update(charger.id, { online: true, lastSeenMs: clock.now() });
    logger.info({ identity, chargerId: charger.id }, 'charge point connected');
    bus.emit('charger.connected', { charger: online });
  }

  private async handleClose(chargerId: string, rpc: OcppRpc): Promise<void> {
    const { repos, logger, bus, clock } = this.deps;
    rpc.close('charge point disconnected');
    this.connections.delete(chargerId);
    const charger = await repos.chargers.update(chargerId, { online: false, lastSeenMs: clock.now() });
    logger.warn({ chargerId }, 'charge point disconnected');
    bus.emit('charger.disconnected', { charger });
  }

  private async dispatchInbound(chargerId: string, action: string, payload: Payload): Promise<Payload> {
    const { repos, clock } = this.deps;
    const charger = await repos.chargers.get(chargerId);
    if (!charger) throw new OcppCallError('InternalError', `charger ${chargerId} vanished`);
    await repos.chargers.update(chargerId, { lastSeenMs: clock.now() });

    switch (action) {
      case 'BootNotification':
        return this.onBootNotification(charger, payload);
      case 'Heartbeat':
        return { currentTime: this.nowIso() };
      case 'StatusNotification':
        return this.onStatusNotification(charger, payload);
      case 'Authorize':
        return this.onAuthorize(payload);
      case 'StartTransaction':
        return this.onStartTransaction(charger, payload);
      case 'MeterValues':
        return this.onMeterValues(payload);
      case 'StopTransaction':
        return this.onStopTransaction(payload);
      case 'DataTransfer':
        return { status: 'UnknownVendorId' };
      default:
        throw new OcppCallError('NotImplemented', `${action} is not supported by this central system`);
    }
  }

  private nowIso(): string {
    return new Date(this.deps.clock.now()).toISOString();
  }

  private parse<T>(schema: { safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: unknown } }, payload: Payload, action: string): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new OcppCallError('FormationViolation', `${action} payload is invalid`, result.error);
    }
    return result.data as T;
  }

  private async onBootNotification(charger: Charger, payload: Payload): Promise<Payload> {
    const request = this.parse<{ chargePointVendor: string; chargePointModel: string }>(
      ocppSchemas.bootNotificationSchema,
      payload,
      'BootNotification',
    );
    const updated = await this.deps.repos.chargers.update(charger.id, {
      vendor: request.chargePointVendor,
      model: request.chargePointModel,
      online: true,
      lastSeenMs: this.deps.clock.now(),
    });
    this.deps.bus.emit('charger.connected', { charger: updated });
    // Sent after the boot response so a car that plugs in before the first plan cannot
    // overload the connection while it waits for one.
    void this.installSafetyProfile(updated);
    return {
      status: 'Accepted',
      currentTime: this.nowIso(),
      interval: this.deps.heartbeatIntervalS ?? 300,
    };
  }

  /**
   * A default profile that applies to any transaction with no plan of its own. It is sized so
   * that every bay at this limit, plus the worst hour of building load, still fits inside the
   * grid connection. The optimiser's own profiles sit above it and override it.
   */
  private async installSafetyProfile(charger: Charger): Promise<void> {
    if (this.deps.safetyProfiles === false) return;
    try {
      const site = await this.deps.repos.sites.get(charger.siteId);
      if (!site) return;
      const chargers = await this.deps.repos.chargers.listBySite(site.id);
      const worstBaseKw = Math.max(0, ...site.baseLoadKw);
      const shareKw = (site.gridConnectionKw - worstBaseKw) / Math.max(1, chargers.length);
      const limitKw = Math.max(charger.minPowerKw, Math.min(charger.maxPowerKw, shareKw));
      await this.setChargingProfile(charger.id, {
        connectorId: 0,
        csChargingProfiles: {
          chargingProfileId: SAFETY_PROFILE_ID,
          stackLevel: 0,
          chargingProfilePurpose: 'TxDefaultProfile',
          chargingProfileKind: 'Relative',
          chargingSchedule: {
            chargingRateUnit: 'W',
            chargingSchedulePeriod: [{ startPeriod: 0, limit: Math.round(limitKw * 1000) }],
          },
        },
      });
      this.deps.logger.info({ chargerId: charger.id, limitKw: Math.round(limitKw * 10) / 10 }, 'safety profile installed');
    } catch (error) {
      this.deps.logger.warn({ err: error, chargerId: charger.id }, 'could not install the safety profile');
    }
  }

  private async onStatusNotification(charger: Charger, payload: Payload): Promise<Payload> {
    const request = this.parse<{ connectorId: number; status: ConnectorStatus; errorCode: string }>(
      ocppSchemas.statusNotificationSchema,
      payload,
      'StatusNotification',
    );
    const existing = await this.deps.repos.connectors.get(charger.id, request.connectorId);
    const connector = await this.deps.repos.connectors.upsert({
      chargerId: charger.id,
      connectorId: request.connectorId,
      status: request.status,
      errorCode: request.errorCode,
      sessionId: existing?.sessionId ?? null,
      updatedMs: this.deps.clock.now(),
    });
    this.deps.bus.emit('charger.status', { charger, connector });
    return {};
  }

  private async onAuthorize(payload: Payload): Promise<Payload> {
    const request = this.parse<{ idTag: string }>(ocppSchemas.authorizeSchema, payload, 'Authorize');
    const profile = await this.deps.repos.profiles.getByIdTag(request.idTag);
    return { idTagInfo: { status: profile ? 'Accepted' : 'Invalid' } };
  }

  private async onStartTransaction(charger: Charger, payload: Payload): Promise<Payload> {
    const request = this.parse<{ connectorId: number; idTag: string; meterStart: number; timestamp: string }>(
      ocppSchemas.startTransactionSchema,
      payload,
      'StartTransaction',
    );
    const { session, transactionId } = await this.deps.sessions.startTransaction({
      chargerId: charger.id,
      connectorId: request.connectorId,
      idTag: request.idTag,
      meterStartWh: request.meterStart,
      tsMs: this.timestampOf(request.timestamp),
    });
    const existing = await this.deps.repos.connectors.get(charger.id, request.connectorId);
    await this.deps.repos.connectors.upsert({
      chargerId: charger.id,
      connectorId: request.connectorId,
      status: existing?.status ?? 'Charging',
      errorCode: existing?.errorCode ?? 'NoError',
      sessionId: session.id,
      updatedMs: this.deps.clock.now(),
    });
    return { transactionId, idTagInfo: { status: 'Accepted' } };
  }

  private async onMeterValues(payload: Payload): Promise<Payload> {
    const request = this.parse<{ transactionId?: number; meterValue: MeterValue[] }>(
      ocppSchemas.meterValuesSchema,
      payload,
      'MeterValues',
    );
    if (request.transactionId === undefined) return {};
    for (const meterValue of request.meterValue) {
      const sample = readMeterValue(meterValue);
      await this.deps.sessions.recordMeter({
        transactionId: request.transactionId,
        tsMs: Number.isFinite(sample.tsMs) ? sample.tsMs : this.deps.clock.now(),
        energyWh: sample.energyWh,
        powerW: sample.powerW,
        soc: sample.soc,
      });
    }
    return {};
  }

  private async onStopTransaction(payload: Payload): Promise<Payload> {
    const request = this.parse<{ transactionId: number; meterStop: number; timestamp: string; reason?: string }>(
      ocppSchemas.stopTransactionSchema,
      payload,
      'StopTransaction',
    );
    const session = await this.deps.sessions.stopTransaction({
      transactionId: request.transactionId,
      meterStopWh: request.meterStop,
      tsMs: this.timestampOf(request.timestamp),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    });
    if (session) {
      const existing = await this.deps.repos.connectors.get(session.chargerId, session.connectorId);
      await this.deps.repos.connectors.upsert({
        chargerId: session.chargerId,
        connectorId: session.connectorId,
        status: existing?.status ?? 'Finishing',
        errorCode: existing?.errorCode ?? 'NoError',
        sessionId: null,
        updatedMs: this.deps.clock.now(),
      });
    }
    return { idTagInfo: { status: 'Accepted' } };
  }

  /** Chargers timestamp their own messages; fall back to server time if the clock is unreadable. */
  private timestampOf(iso: string): number {
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : this.deps.clock.now();
  }
}
