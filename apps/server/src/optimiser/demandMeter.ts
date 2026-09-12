import { MS_PER_MINUTE, floorToStep, localHourOfDay, round, type Clock, type Site } from '@cleangrid/shared';
import type { EventBus } from '../events';

/**
 * Metered demand, the number a demand charge is actually billed on.
 *
 * Summing each session's last reported power overstates the site: readings arrive at different
 * moments, so a stale high reading can be added to a fresh one. This integrates the energy each
 * session drew inside each metering interval instead, and reports the highest completed interval.
 */
interface LastReading {
  readonly tsMs: number;
  readonly deliveredKwh: number;
}

export interface DemandInterval {
  readonly startMs: number;
  readonly chargingKw: number;
  readonly baseLoadKw: number;
  readonly totalKw: number;
}

export class DemandMeter {
  private readonly lastReading = new Map<string, LastReading>();
  private readonly bucketsKwh = new Map<number, number>();
  private readonly closed = new Map<number, DemandInterval>();
  private peakKwSeen = 0;
  private unsubscribe: (() => void)[] = [];

  constructor(
    private readonly deps: {
      readonly bus: EventBus;
      readonly clock: Clock;
      readonly site: Site;
      readonly slotMinutes?: number;
    },
  ) {}

  private get slotMinutes(): number {
    return this.deps.slotMinutes ?? 15;
  }

  start(): void {
    // One meter per site: ignore energy drawn anywhere else.
    const mine = (siteId: string): boolean => siteId === this.deps.site.id;
    this.unsubscribe = [
      this.deps.bus.on('meter.updated', ({ session }) => {
        if (mine(session.siteId)) this.record(session.id, session.energyDeliveredKwh, session.updatedMs);
      }),
      this.deps.bus.on('session.ended', ({ session }) => {
        if (mine(session.siteId)) {
          this.record(session.id, session.energyDeliveredKwh, session.unpluggedMs ?? this.deps.clock.now());
        }
      }),
    ];
  }

  stop(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }

  /** Highest completed metering interval so far, kW, including building load. */
  get peakKw(): number {
    this.closeFinishedBuckets();
    return round(this.peakKwSeen, 2);
  }

  /**
   * What the site actually drew, interval by interval. This is the line that shows a dumb site
   * going over its connection, which no plan can show because a dumb site has no plan.
   */
  history(fromMs: number, toMs: number): DemandInterval[] {
    this.closeFinishedBuckets();
    return [...this.closed.values()]
      .filter((interval) => interval.startMs >= fromMs && interval.startMs < toMs)
      .sort((a, b) => a.startMs - b.startMs);
  }

  /** Building load at an instant, from the site's hourly profile in local time. */
  private baseLoadKwAt(ms: number): number {
    const hour = Math.floor(localHourOfDay(ms, this.deps.site.timezone));
    return this.deps.site.baseLoadKw[hour] ?? 0;
  }

  /**
   * Energy between two readings is spread across the metering intervals it actually spans. A
   * reading taken just after a boundary carries energy drawn before it, and crediting all of it
   * to the later interval would invent a peak that never happened.
   */
  private record(sessionId: string, cumulativeKwh: number, tsMs: number): void {
    const previous = this.lastReading.get(sessionId);
    this.lastReading.set(sessionId, { tsMs, deliveredKwh: cumulativeKwh });
    if (!previous) return;

    const deltaKwh = cumulativeKwh - previous.deliveredKwh;
    if (deltaKwh <= 0) return;

    const stepMs = this.slotMinutes * MS_PER_MINUTE;
    const fromMs = previous.tsMs;
    const spanMs = tsMs - fromMs;
    if (spanMs <= 0) {
      this.addToBucket(floorToStep(tsMs, this.slotMinutes), deltaKwh);
    } else {
      for (let bucket = floorToStep(fromMs, this.slotMinutes); bucket < tsMs; bucket += stepMs) {
        const overlapMs = Math.min(tsMs, bucket + stepMs) - Math.max(fromMs, bucket);
        if (overlapMs > 0) this.addToBucket(bucket, deltaKwh * (overlapMs / spanMs));
      }
    }
    this.closeFinishedBuckets();
  }

  private addToBucket(bucket: number, kwh: number): void {
    this.bucketsKwh.set(bucket, (this.bucketsKwh.get(bucket) ?? 0) + kwh);
  }

  /**
   * A bucket is scored once its interval has passed, plus one more interval of grace: chargers
   * report at their own pace, so closing the moment the clock ticks over would score an interval
   * before every car had reported for it.
   */
  private closeFinishedBuckets(): void {
    const stepMs = this.slotMinutes * MS_PER_MINUTE;
    const settledBefore = floorToStep(this.deps.clock.now(), this.slotMinutes) - stepMs;
    const intervalHours = this.slotMinutes / 60;
    for (const [bucket, chargingKwh] of this.bucketsKwh) {
      if (bucket >= settledBefore) continue;
      const baseLoadKw = this.baseLoadKwAt(bucket + (this.slotMinutes * MS_PER_MINUTE) / 2);
      const chargingKw = chargingKwh / intervalHours;
      const totalKw = chargingKw + baseLoadKw;
      this.peakKwSeen = Math.max(this.peakKwSeen, totalKw);
      this.closed.set(bucket, {
        startMs: bucket,
        chargingKw: round(chargingKw, 2),
        baseLoadKw: round(baseLoadKw, 2),
        totalKw: round(totalKw, 2),
      });
      this.bucketsKwh.delete(bucket);
    }
    this.peakKwSeen = Math.max(this.peakKwSeen, this.baseLoadKwAt(this.deps.clock.now()));
  }
}
