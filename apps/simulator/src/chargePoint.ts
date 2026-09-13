import WebSocket from 'ws';
import {
  MS_PER_MINUTE,
  OCPP_SUBPROTOCOL,
  OcppCallError,
  OcppRpc,
  buildMeterValue,
  ocppSchemas,
  round,
  type ChargingProfile,
  type Clock,
  type Payload,
  type StartTransactionResponse,
} from './deps';
import { chargeVehicle, deliveredPowerKw, profileLimitW, type VehicleState } from './vehicle';

/**
 * One simulated OCPP 1.6J charge point. It connects, reports meter values, and obeys the
 * charging profiles the optimiser sends, which is the whole point of the simulator: it is the
 * only way to prove the plan reaches hardware.
 */

/** The most simulated time one integration step may cover. */
const MAX_TICK_MS = 15 * 60_000;

export interface ChargePointOptions {
  readonly identity: string;
  readonly url: string;
  readonly maxPowerKw: number;
  readonly minPowerKw: number;
  readonly clock: Clock;
  readonly vendor?: string;
  readonly model?: string;
  readonly log: (message: string, detail?: Record<string, unknown>) => void;
  readonly meterIntervalMs?: number;
  /** Sent as HTTP Basic credentials on connect (OCPP 1.6 security profile 1), when the server asks for one. */
  readonly authKey?: string;
  /**
   * What to do when the central system asks for a remote start, which is what happens when a
   * driver confirms in the app. Returning a car means the cable is treated as already plugged in.
   */
  readonly onRemoteStart?: (input: { idTag: string; connectorId: number }) => PluggedCar | null;
}

export interface PluggedCar {
  readonly idTag: string;
  readonly vehicle: VehicleState;
  readonly connectorId: number;
}

interface ActiveTransaction {
  transactionId: number;
  connectorId: number;
  idTag: string;
  vehicle: VehicleState;
  energyWh: number;
  meterStartWh: number;
  startedMs: number;
  lastTickMs: number;
  lastMeterMs: number;
  profile: ChargingProfile | null;
  profileReceivedMs: number;
  powerKw: number;
}

export class SimulatedChargePoint {
  private socket: WebSocket | null = null;
  private rpc: OcppRpc | null = null;
  private transaction: ActiveTransaction | null = null;
  /** TxDefaultProfile: applies to any transaction that has no profile of its own. */
  private defaultProfile: ChargingProfile | null = null;
  private defaultProfileMs = 0;
  private meterRegisterWh = 0;
  private lastHeartbeatMs = 0;
  private connected = false;

  constructor(private readonly options: ChargePointOptions) {}

  get identity(): string {
    return this.options.identity;
  }

  get isCharging(): boolean {
    return this.transaction !== null;
  }

  get currentPowerKw(): number {
    return this.transaction?.powerKw ?? 0;
  }

  get currentSoc(): number | null {
    return this.transaction?.vehicle.soc ?? null;
  }

  async connect(): Promise<void> {
    const url = `${this.options.url.replace(/\/$/, '')}/${this.options.identity}`;
    const { identity, authKey } = this.options;
    const headers = authKey ? { authorization: `Basic ${Buffer.from(`${identity}:${authKey}`).toString('base64')}` } : undefined;
    const socket = new WebSocket(url, [OCPP_SUBPROTOCOL], headers ? { headers } : {});
    this.socket = socket;
    const rpc = new OcppRpc(
      (data) => socket.send(data),
      (action, payload) => this.handleCall(action, payload),
      { callTimeoutMs: 15_000, onWarning: (message) => this.options.log(`rpc warning: ${message}`) },
    );
    this.rpc = rpc;

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', (error) => reject(error));
    });
    socket.on('message', (data) => void rpc.receive(data.toString()));
    socket.on('close', () => {
      this.connected = false;
      rpc.close('socket closed');
    });
    this.connected = true;

    await rpc.call('BootNotification', {
      chargePointVendor: this.options.vendor ?? 'CleanGrid',
      chargePointModel: this.options.model ?? 'Simulator',
      firmwareVersion: '0.1.0',
    });
    await this.status(1, 'Available');
    this.lastHeartbeatMs = this.options.clock.now();
  }

  async disconnect(): Promise<void> {
    this.rpc?.close('simulator stopping');
    this.socket?.close(1000, 'simulator stopping');
    this.connected = false;
  }

  /** A car arrives: report Preparing, authorise the tag, then open a transaction. */
  async plugIn(car: PluggedCar): Promise<number | null> {
    if (!this.rpc || !this.connected) return null;
    const nowMs = this.options.clock.now();
    await this.status(car.connectorId, 'Preparing');
    const auth = await this.rpc.call<{ idTagInfo: { status: string } }>('Authorize', { idTag: car.idTag });
    if (auth.idTagInfo.status !== 'Accepted') {
      this.options.log(`authorisation refused for ${car.idTag}`, { status: auth.idTagInfo.status });
      await this.status(car.connectorId, 'Available');
      return null;
    }
    const response = await this.rpc.call<StartTransactionResponse>('StartTransaction', {
      connectorId: car.connectorId,
      idTag: car.idTag,
      meterStart: Math.round(this.meterRegisterWh),
      timestamp: new Date(nowMs).toISOString(),
    });
    this.transaction = {
      transactionId: response.transactionId,
      connectorId: car.connectorId,
      idTag: car.idTag,
      vehicle: car.vehicle,
      energyWh: this.meterRegisterWh,
      meterStartWh: this.meterRegisterWh,
      startedMs: nowMs,
      lastTickMs: nowMs,
      lastMeterMs: nowMs,
      profile: null,
      profileReceivedMs: nowMs,
      powerKw: 0,
    };
    await this.status(car.connectorId, 'Charging');
    await this.sendMeterValues(nowMs);
    return response.transactionId;
  }

  async unplug(reason = 'EVDisconnected'): Promise<{ energyKwh: number; soc: number } | null> {
    const transaction = this.transaction;
    if (!transaction || !this.rpc) return null;
    const nowMs = this.options.clock.now();
    this.tick(nowMs);
    await this.sendMeterValues(nowMs);
    await this.rpc.call('StopTransaction', {
      transactionId: transaction.transactionId,
      idTag: transaction.idTag,
      meterStop: Math.round(transaction.energyWh),
      timestamp: new Date(nowMs).toISOString(),
      reason,
    });
    this.meterRegisterWh = transaction.energyWh;
    this.transaction = null;
    await this.status(transaction.connectorId, 'Available');
    return {
      energyKwh: round((transaction.energyWh - transaction.meterStartWh) / 1000, 3),
      soc: round(transaction.vehicle.soc, 4),
    };
  }

  /** Advance the physics to `nowMs` and send periodic messages when they fall due. */
  async pump(nowMs: number): Promise<void> {
    this.tick(nowMs);
    const transaction = this.transaction;
    if (transaction && nowMs - transaction.lastMeterMs >= (this.options.meterIntervalMs ?? MS_PER_MINUTE)) {
      await this.sendMeterValues(nowMs);
    }
    if (nowMs - this.lastHeartbeatMs >= 5 * MS_PER_MINUTE) {
      this.lastHeartbeatMs = nowMs;
      await this.rpc?.call('Heartbeat').catch(() => undefined);
    }
  }

  private tick(nowMs: number): void {
    const transaction = this.transaction;
    if (!transaction) return;
    // Never integrate more than one metering interval in a single step. If the demo clock is
    // jumped forward, a real charger would not have delivered those hours unsupervised either.
    const elapsedMs = Math.min(nowMs - transaction.lastTickMs, MAX_TICK_MS);
    if (elapsedMs <= 0) {
      transaction.lastTickMs = nowMs;
      return;
    }

    // Higher stack level wins: the optimiser's transaction profile overrides the safety default.
    const limitW =
      profileLimitW(transaction.profile, nowMs, transaction.profileReceivedMs) ??
      profileLimitW(this.defaultProfile, nowMs, Math.max(this.defaultProfileMs, transaction.startedMs));
    const limitKw = limitW === null ? null : limitW / 1000;
    const offeredKw = limitKw !== null && limitKw < this.options.minPowerKw ? 0 : limitKw;
    const powerKw = deliveredPowerKw({
      vehicle: transaction.vehicle,
      chargerMaxKw: this.options.maxPowerKw,
      limitKw: offeredKw,
    });
    const charged = chargeVehicle(transaction.vehicle, powerKw, elapsedMs);
    transaction.vehicle = charged.vehicle;
    transaction.energyWh += charged.energyKwh * 1000;
    transaction.powerKw = charged.energyKwh > 0 ? powerKw : 0;
    transaction.lastTickMs = nowMs;
  }

  private async sendMeterValues(nowMs: number): Promise<void> {
    const transaction = this.transaction;
    if (!transaction || !this.rpc) return;
    transaction.lastMeterMs = nowMs;
    await this.rpc
      .call('MeterValues', {
        connectorId: transaction.connectorId,
        transactionId: transaction.transactionId,
        meterValue: [
          buildMeterValue({
            tsMs: nowMs,
            energyWh: transaction.energyWh,
            powerW: transaction.powerKw * 1000,
            soc: transaction.vehicle.soc,
          }),
        ],
      })
      .catch((error: unknown) => this.options.log(`meter values failed: ${(error as Error).message}`));
  }

  private async status(connectorId: number, status: string): Promise<void> {
    await this.rpc
      ?.call('StatusNotification', {
        connectorId,
        errorCode: 'NoError',
        status,
        timestamp: new Date(this.options.clock.now()).toISOString(),
      })
      .catch(() => undefined);
  }

  /** Commands from the central system. */
  private async handleCall(action: string, payload: Payload): Promise<Payload> {
    switch (action) {
      case 'SetChargingProfile': {
        const parsed = ocppSchemas.setChargingProfileSchema.safeParse(payload);
        if (!parsed.success) throw new OcppCallError('FormationViolation', 'bad charging profile');
        const profile = parsed.data.csChargingProfiles as ChargingProfile;
        if (profile.chargingProfilePurpose === 'TxDefaultProfile') {
          this.defaultProfile = profile;
          this.defaultProfileMs = this.options.clock.now();
          this.tick(this.options.clock.now());
          return { status: 'Accepted' };
        }
        if (!this.transaction) return { status: 'Rejected' };
        this.transaction.profile = profile;
        this.transaction.profileReceivedMs = this.options.clock.now();
        this.tick(this.options.clock.now());
        return { status: 'Accepted' };
      }
      case 'ClearChargingProfile': {
        if (this.transaction) this.transaction.profile = null;
        return { status: 'Accepted' };
      }
      case 'RemoteStopTransaction': {
        const parsed = ocppSchemas.remoteStopTransactionSchema.safeParse(payload);
        if (!parsed.success) throw new OcppCallError('FormationViolation', 'bad RemoteStopTransaction');
        if (!this.transaction || this.transaction.transactionId !== parsed.data.transactionId) {
          return { status: 'Rejected' };
        }
        void this.unplug('Remote');
        return { status: 'Accepted' };
      }
      case 'RemoteStartTransaction': {
        const parsed = ocppSchemas.remoteStartTransactionSchema.safeParse(payload);
        if (!parsed.success) throw new OcppCallError('FormationViolation', 'bad RemoteStartTransaction');
        if (this.transaction || !this.options.onRemoteStart) return { status: 'Rejected' };
        const car = this.options.onRemoteStart({
          idTag: parsed.data.idTag,
          connectorId: parsed.data.connectorId ?? 1,
        });
        if (!car) return { status: 'Rejected' };
        // Answer first, then open the transaction, which is the order a real charge point uses.
        setTimeout(() => {
          void this.plugIn(car).catch((error: unknown) =>
            this.options.log(`remote start failed: ${(error as Error).message}`),
          );
        }, 50);
        return { status: 'Accepted' };
      }
      case 'Reset':
        this.options.log('reset requested by the central system');
        return { status: 'Accepted' };
      case 'GetConfiguration':
        return {
          configurationKey: [
            { key: 'MeterValueSampleInterval', readonly: false, value: '60' },
            { key: 'ChargeProfileMaxStackLevel', readonly: true, value: '3' },
            { key: 'ChargingScheduleAllowedChargingRateUnit', readonly: true, value: 'Power' },
          ],
        };
      case 'ChangeConfiguration':
        return { status: 'Accepted' };
      case 'TriggerMessage':
        return { status: 'Accepted' };
      default:
        throw new OcppCallError('NotImplemented', `${action} is not implemented by this charge point`);
    }
  }
}
