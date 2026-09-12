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
const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Move the whole day forward by however many whole days it takes to put it ahead of now.
 *
 * One pass is usually enough, but the server's clock can have run on while nobody was simulating,
 * so the shift is computed from the gap rather than assumed to be a single day.
 */
function replayAfter(arrivals: readonly ResolvedArrival[], nowMs: number): ResolvedArrival[] {
  const lastDepartMs = arrivals.reduce((latest, arrival) => Math.max(latest, arrival.departMs), 0);
  const days = Math.max(1, Math.ceil((nowMs - lastDepartMs) / DAY_MS));
  const shiftMs = days * DAY_MS;
  return arrivals.map((arrival) => ({
    ...arrival,
    arriveMs: arrival.arriveMs + shiftMs,
    departMs: arrival.departMs + shiftMs,
  }));
}

export interface RunnerOptions {
  readonly scenario: Scenario;
  readonly wsUrl: string;
  readonly apiUrl: string;
  readonly timeScale?: number;
  readonly meterIntervalMs?: number;
  readonly onLog?: (line: string) => void;
  /** Shown in log lines when more than one site is being simulated. */
  readonly label?: string;
  /**
   * Replay the day instead of stopping after the last car leaves. A demo rig that disconnects its
   * chargers looks identical to a broken one: every bay reads offline and no session can start.
   */
  readonly loop?: boolean;
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
    const where = this.options.label ? ` ${this.options.label}` : '';
    (this.options.onLog ?? ((text: string) => console.log(text)))(`[sim ${stamp}${where}] ${line}`);
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
        onRemoteStart: ({ idTag, connectorId }) => this.carFor(idTag, connectorId, charger.id),
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
    let arrivals = resolveArrivals(this.options.scenario);
    let lastDepartMs = arrivals.reduce((latest, arrival) => Math.max(latest, arrival.departMs), 0);
    let ticks = 0;
    let day = 1;

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

      if (this.unplugged.size === arrivals.length && nowMs > lastDepartMs) {
        if (!this.options.loop) break;
        // The chargers stay connected across the boundary; only the cars start over.
        day += 1;
        arrivals = replayAfter(arrivals, nowMs);
        lastDepartMs = arrivals.reduce((latest, arrival) => Math.max(latest, arrival.departMs), 0);
        this.pluggedIn.clear();
        this.unplugged.clear();
        this.log(`every car has come and gone; replaying as day ${day}`);
      }

      ticks += 1;
      if (ticks % RESYNC_EVERY_TICKS === 0) await this.resync();
      await sleep(TICK_MS);
    }
    if (!this.options.loop) this.log('every car has come and gone; scenario complete');
  }

  /**
   * A driver confirmed in the app, so a car turns up at that bay. Their own vehicle if the
   * scenario knows it, otherwise a plausible one, arriving with a fairly empty battery.
   */
  private carFor(idTag: string, connectorId: number, chargerId: string): {
    idTag: string;
    connectorId: number;
    vehicle: { batteryKwh: number; maxChargeKw: number; soc: number };
  } | null {
    const driver = this.options.scenario.drivers.find((entry) => entry.idTag === idTag);
    const vehicle = driver ? this.options.scenario.vehicles.find((entry) => entry.driverId === driver.id) : undefined;
    const spec = vehicle ?? { batteryKwh: 60, maxChargeKw: 11 };
    // Use the state of charge the scenario gave this driver, so the battery has room for what
    // they asked for; a walk-up guest turns up around a third full.
    const scheduled = driver
      ? this.options.scenario.arrivals.find((arrival) => arrival.driverId === driver.id)
      : undefined;
    this.log(`${chargerId} ${driver?.displayName ?? idTag} plugs in from the app`);
    return {
      idTag,
      connectorId,
      vehicle: { batteryKwh: spec.batteryKwh, maxChargeKw: spec.maxChargeKw, soc: scheduled?.startSoc ?? 0.3 },
    };
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

    // Declaring intent may have made the server ask the charger to start, in which case the car
    // is already on the cable and plugging it in again would open a second transaction.
    if (arrival.via === 'app' && (await this.waitForCharging(point))) {
      this.log(`${who} is already charging on ${arrival.chargerId}, started from the app`);
      return;
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

  /** A remote start is answered before the transaction opens, so give it a moment to appear. */
  private async waitForCharging(point: SimulatedChargePoint, attempts = 8): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (point.isCharging) return true;
      await sleep(50);
    }
    return point.isCharging;
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
