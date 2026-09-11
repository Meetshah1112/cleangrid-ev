import {
  MS_PER_MINUTE,
  SimClock,
  resolveArrivals,
  formatLocalTime,
  type Clock,
  type ResolvedArrival,
  type Scenario,
} from './depsRunner';
import { SimulatedChargePoint } from './chargePoint';
import { declareIntent } from './driver';

/** Replays a scenario against a running server: connects the chargers, then drives the day. */

const TICK_MS = 200;
const RESYNC_EVERY_TICKS = 150;

export interface RunnerOptions {
  readonly scenario: Scenario;
  readonly wsUrl: string;
  readonly apiUrl: string;
  readonly timeScale?: number;
  readonly meterIntervalMs?: number;
  readonly onLog?: (line: string) => void;
}

interface ClockSync {
  readonly nowMs: number;
  readonly scale: number;
}

async function fetchClock(apiUrl: string): Promise<ClockSync> {
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/clock`);
  if (!response.ok) throw new Error(`clock sync failed: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: ClockSync };
  if (!body.data) throw new Error('clock sync returned no data');
  return body.data;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SimulatorRunner {
  private clock: Clock | null = null;
  private readonly points = new Map<string, SimulatedChargePoint>();
  private readonly pluggedIn = new Set<string>();
  private readonly unplugged = new Set<string>();
  private readonly vehiclesById: Map<string, { batteryKwh: number; maxChargeKw: number }>;
  private running = false;
  private finished: Promise<void> | null = null;

  constructor(private readonly options: RunnerOptions) {
    this.vehiclesById = new Map(
      options.scenario.vehicles.map((vehicle) => [
        vehicle.id,
        { batteryKwh: vehicle.batteryKwh, maxChargeKw: vehicle.maxChargeKw },
      ]),
    );
  }

  private log(line: string): void {
    const stamp = this.clock ? formatLocalTime(this.clock.now(), this.options.scenario.site.timezone) : '--:--';
    (this.options.onLog ?? ((text: string) => console.log(text)))(`[sim ${stamp}] ${line}`);
  }

  async start(): Promise<void> {
    const sync = await fetchClock(this.options.apiUrl);
    const scale = this.options.timeScale ?? sync.scale;
    this.clock = new SimClock({ startMs: sync.nowMs, scale });
    this.log(`clock synced with the server, running at ${scale}x`);

    for (const charger of this.options.scenario.chargers) {
      const point = new SimulatedChargePoint({
        identity: charger.ocppIdentity,
        url: this.options.wsUrl,
        maxPowerKw: charger.maxPowerKw,
        minPowerKw: charger.minPowerKw,
        clock: this.clock,
        ...(charger.vendor === undefined ? {} : { vendor: charger.vendor }),
        ...(charger.model === undefined ? {} : { model: charger.model }),
        ...(this.options.meterIntervalMs === undefined ? {} : { meterIntervalMs: this.options.meterIntervalMs }),
        log: (message) => this.log(`${charger.ocppIdentity} ${message}`),
      });
      await point.connect();
      this.points.set(charger.id, point);
    }
    this.log(`${this.points.size} charge points online`);
    this.running = true;
    this.finished = this.loop();
  }

  /** Resolves when every arrival has come and gone. */
  async waitForCompletion(): Promise<void> {
    await this.finished;
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.finished?.catch(() => undefined);
    for (const point of this.points.values()) await point.disconnect();
  }

  private async loop(): Promise<void> {
    const arrivals = resolveArrivals(this.options.scenario);
    const lastDepartMs = arrivals.reduce((latest, arrival) => Math.max(latest, arrival.departMs), 0);
    let ticks = 0;

    while (this.running) {
      const clock = this.clock;
      if (!clock) break;
      const nowMs = clock.now();

      for (const arrival of arrivals) {
        if (!this.pluggedIn.has(arrival.id) && nowMs >= arrival.arriveMs) await this.arrive(arrival, nowMs);
        if (this.pluggedIn.has(arrival.id) && !this.unplugged.has(arrival.id) && nowMs >= arrival.departMs) {
          await this.depart(arrival);
        }
      }
      for (const point of this.points.values()) await point.pump(nowMs);

      if (this.unplugged.size === arrivals.length && nowMs > lastDepartMs) break;
      ticks += 1;
      if (ticks % RESYNC_EVERY_TICKS === 0) await this.resync();
      await sleep(TICK_MS);
    }
    this.log('every car has come and gone; scenario complete');
  }

  private async resync(): Promise<void> {
    try {
      const sync = await fetchClock(this.options.apiUrl);
      const clock = this.clock;
      if (clock instanceof SimClock) {
        if (Math.abs(clock.now() - sync.nowMs) > MS_PER_MINUTE) clock.jumpTo(sync.nowMs);
        if (clock.scale !== sync.scale && this.options.timeScale === undefined) clock.setScale(sync.scale);
      }
    } catch (error) {
      this.log(`clock resync failed: ${(error as Error).message}`);
    }
  }

  private async arrive(arrival: ResolvedArrival, nowMs: number): Promise<void> {
    this.pluggedIn.add(arrival.id);
    const point = this.points.get(arrival.chargerId);
    const vehicle = this.vehiclesById.get(arrival.vehicleId);
    if (!point || !vehicle) {
      this.log(`cannot start ${arrival.id}: unknown charger or vehicle`);
      this.unplugged.add(arrival.id);
      return;
    }
    const driver = this.options.scenario.drivers.find((entry) => entry.id === arrival.driverId);
    const who = driver?.displayName ?? arrival.driverId;
    const tz = this.options.scenario.site.timezone;

    let energyKwh = arrival.energyKwh;
    if (arrival.via === 'app') {
      const result = await declareIntent(this.options.apiUrl, {
        driverId: arrival.driverId,
        chargerId: arrival.chargerId,
        connectorId: arrival.connectorId,
        vehicleId: arrival.vehicleId,
        energyKwh: arrival.energyKwh,
        deadlineMs: arrival.deadlineMs,
        departMs: arrival.departMs,
        mode: arrival.mode,
      });
      energyKwh = result.energyKwh;
      if (result.outcome === 'accepted') {
        this.log(
          `${who} asks for ${energyKwh} kWh by ${formatLocalTime(result.deadlineMs, tz)} (${arrival.mode}) on ${arrival.chargerId}`,
        );
      } else if (result.outcome === 'adjusted') {
        this.log(
          `${who} asked for ${arrival.energyKwh} kWh by ${formatLocalTime(arrival.deadlineMs, tz)}: refused, ${result.message}`,
        );
      } else {
        this.log(`${who} could not open a session: ${result.message}`);
      }
    } else {
      this.log(`${who} taps an RFID card on ${arrival.chargerId} with no app; server defaults apply`);
    }

    const transactionId = await point.plugIn({
      idTag: driver?.idTag ?? arrival.driverId,
      connectorId: arrival.connectorId,
      vehicle: { batteryKwh: vehicle.batteryKwh, maxChargeKw: vehicle.maxChargeKw, soc: arrival.startSoc },
    });
    if (transactionId === null) {
      this.log(`${who} plugged in but the charger refused to start`);
      this.unplugged.add(arrival.id);
      return;
    }
    void nowMs;
  }

  private async depart(arrival: ResolvedArrival): Promise<void> {
    this.unplugged.add(arrival.id);
    const point = this.points.get(arrival.chargerId);
    const driver = this.options.scenario.drivers.find((entry) => entry.id === arrival.driverId);
    const result = await point?.unplug();
    if (result) {
      this.log(
        `${driver?.displayName ?? arrival.driverId} leaves ${arrival.chargerId} with ${result.energyKwh} kWh delivered, battery at ${Math.round(result.soc * 100)}%`,
      );
    }
  }
}
