import { MS_PER_MINUTE, floorToStep, localHourOfDay, round, type Clock, type Site } from '@cleangrid/shared';
import type { EventBus } from '../events';

/**
 * Metered demand, the number a demand charge is actually billed on.
 *
 * Summing each session's last reported power overstates the site: readings arrive at different
 * moments, so a stale high reading can be added to a fresh one. This integrates the energy each
 * session drew inside each metering interval instead, and reports the highest completed interval.
 */
export class DemandMeter {
  private readonly deliveredKwh = new Map<string, number>();
  private readonly bucketsKwh = new Map<number, number>();
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
    this.unsubscribe = [
      this.deps.bus.on('meter.updated', ({ session }) =>
        this.record(session.id, session.energyDeliveredKwh, session.updatedMs),
      ),
      this.deps.bus.on('session.ended', ({ session }) =>
        this.record(session.id, session.energyDeliveredKwh, session.unpluggedMs ?? this.deps.clock.now()),
      ),
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

  /** Building load at an instant, from the site's hourly profile in local time. */
  private baseLoadKwAt(ms: number): number {
    const hour = Math.floor(localHourOfDay(ms, this.deps.site.timezone));
    return this.deps.site.baseLoadKw[hour] ?? 0;
  }

  private record(sessionId: string, cumulativeKwh: number, tsMs: number): void {
    const previous = this.deliveredKwh.get(sessionId) ?? 0;
    const deltaKwh = cumulativeKwh - previous;
    this.deliveredKwh.set(sessionId, cumulativeKwh);
    if (deltaKwh <= 0) return;
    const bucket = floorToStep(tsMs, this.slotMinutes);
    this.bucketsKwh.set(bucket, (this.bucketsKwh.get(bucket) ?? 0) + deltaKwh);
    this.closeFinishedBuckets();
  }

  /** A bucket is only meaningful once its interval has passed. */
  private closeFinishedBuckets(): void {
    const currentBucket = floorToStep(this.deps.clock.now(), this.slotMinutes);
    const intervalHours = this.slotMinutes / 60;
    for (const [bucket, chargingKwh] of this.bucketsKwh) {
      if (bucket >= currentBucket) continue;
      const drawKw = chargingKwh / intervalHours + this.baseLoadKwAt(bucket + (this.slotMinutes * MS_PER_MINUTE) / 2);
      this.peakKwSeen = Math.max(this.peakKwSeen, drawKw);
      this.bucketsKwh.delete(bucket);
    }
    this.peakKwSeen = Math.max(this.peakKwSeen, this.baseLoadKwAt(this.deps.clock.now()));
  }
}
