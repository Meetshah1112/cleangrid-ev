import {
  MS_PER_MINUTE,
  ceilToStep,
  floorToStep,
  makeSeries,
  sampleSeries,
  valueAtClamped,
  type Clock,
  type ForecastSnapshot,
  type SlotGrid,
  type Site,
  type StepSeries,
} from '@cleangrid/shared';
import type { EventBus } from '../events';
import type { Logger } from '../logger';
import type { Repositories, SignalSample } from '../repo/types';
import { syntheticForecast } from './synthetic';

/**
 * The one resolution grid signals are stored at, whatever step the provider answered in.
 *
 * A stored signal is only useful if it can be found again, and it is found by its slot. So both
 * ends have to agree on where a slot starts: write at the provider's own step and read at fifteen
 * minutes, and half the lookups miss even when everything else is right. Write from an unfloored
 * clock and every one of them misses, and each fetch inserts a fresh row beside the last instead
 * of replacing it -- which is how a table meant to hold a few hundred rows a day reached a hundred
 * and sixty thousand, while every impact report quietly fell back to refetching a window that had
 * already happened.
 */
const SIGNAL_STEP_MINUTES = 15;

/** Where grid signals come from. Live sources implement this too. */
export interface ForecastProvider {
  readonly name: string;
  fetch(site: Site, startMs: number, hours: number): Promise<ForecastSnapshot>;
}

export class SyntheticForecastProvider implements ForecastProvider {
  readonly name = 'synthetic';

  async fetch(site: Site, startMs: number, hours: number): Promise<ForecastSnapshot> {
    return syntheticForecast(site, startMs, hours);
  }
}

export interface ForecastServiceDeps {
  /** One provider, or a choice per site: live feeds exist for some countries and not others. */
  readonly provider: ForecastProvider | ((site: Site) => ForecastProvider);
  readonly fallback?: ForecastProvider;
  readonly clock: Clock;
  readonly bus: EventBus;
  readonly logger: Logger;
  readonly repos: Repositories;
  /** Simulated minutes before a snapshot is refetched. */
  readonly refreshMinutes?: number;
  readonly horizonHours?: number;
}

export interface GridSignalArrays {
  readonly carbonGPerKwh: number[];
  readonly pricePerKwh: number[];
  readonly renewableShare: number[];
  readonly snapshot: ForecastSnapshot;
}

/**
 * Caches one snapshot per site and keeps serving the last good one when a source fails, so a
 * flaky API during a demo degrades the plan instead of stopping it.
 */
export class ForecastService {
  private readonly cache = new Map<string, { snapshot: ForecastSnapshot; fetchedMs: number }>();

  constructor(private readonly deps: ForecastServiceDeps) {}

  private providerFor(site: Site): ForecastProvider {
    return typeof this.deps.provider === 'function' ? this.deps.provider(site) : this.deps.provider;
  }

  async snapshot(site: Site, force = false): Promise<ForecastSnapshot> {
    const nowMs = this.deps.clock.now();
    const horizonHours = this.deps.horizonHours ?? 26;
    const cached = this.cache.get(site.id);
    const refreshMs = (this.deps.refreshMinutes ?? 30) * MS_PER_MINUTE;
    const covers = cached ? cached.snapshot.carbon.startMs <= nowMs : false;
    if (!force && cached && covers && nowMs - cached.fetchedMs < refreshMs) return cached.snapshot;

    // Floored, so every slot this snapshot produces lands where a later read will look for it.
    const startMs = floorToStep(nowMs - MS_PER_MINUTE * 60, SIGNAL_STEP_MINUTES);
    let snapshot: ForecastSnapshot;
    try {
      snapshot = await this.providerFor(site).fetch(site, startMs, horizonHours);
    } catch (error) {
      this.deps.logger.warn({ err: error, provider: this.providerFor(site).name }, 'forecast source failed');
      if (cached) return cached.snapshot;
      const fallback = this.deps.fallback ?? new SyntheticForecastProvider();
      snapshot = await fallback.fetch(site, startMs, horizonHours);
    }

    this.cache.set(site.id, { snapshot, fetchedMs: nowMs });
    await this.persist(site, snapshot);
    this.deps.bus.emit('forecast.updated', { forecast: snapshot });
    return snapshot;
  }

  /** Forecast values resampled onto the planning grid, which is what the solver consumes. */
  async signals(site: Site, grid: SlotGrid): Promise<GridSignalArrays> {
    const snapshot = await this.snapshot(site);
    const read = (series: ForecastSnapshot['carbon']): number[] =>
      sampleSeries(series, grid.startMs, grid.slotMinutes, grid.slots);
    return {
      carbonGPerKwh: read(snapshot.carbon),
      pricePerKwh: read(snapshot.price),
      renewableShare: read(snapshot.renewable),
      snapshot,
    };
  }

  /**
   * Signals covering a window that has already happened, which is what an impact report needs.
   * Stored samples come first (they are what the grid actually looked like at the time); any gap
   * is filled from the provider, which can regenerate or refetch that window.
   */
  async historicalSignals(
    site: Site,
    fromMs: number,
    toMs: number,
  ): Promise<{ carbon: StepSeries; price: StepSeries; renewable: StepSeries; basis: 'actual' | 'forecast' }> {
    const stepMinutes = SIGNAL_STEP_MINUTES;
    const startMs = floorToStep(fromMs, stepMinutes);
    const endMs = Math.max(ceilToStep(toMs, stepMinutes), startMs + stepMinutes * MS_PER_MINUTE);
    const count = Math.round((endMs - startMs) / (stepMinutes * MS_PER_MINUTE));
    const hours = Math.max(1, (endMs - startMs) / (60 * MS_PER_MINUTE));

    let fallback: ForecastSnapshot;
    try {
      fallback = await this.providerFor(site).fetch(site, startMs, hours);
    } catch {
      fallback = await (this.deps.fallback ?? new SyntheticForecastProvider()).fetch(site, startMs, hours);
    }

    const actualSamples = await this.deps.repos.signals.list(site.id, 'actual_carbon', startMs, endMs);
    const basis = actualSamples.length >= count ? 'actual' : 'forecast';

    const build = async (kind: 'carbon' | 'price' | 'renewable', fromSnapshot: StepSeries): Promise<StepSeries> => {
      const source = kind === 'carbon' && basis === 'actual' ? actualSamples : await this.deps.repos.signals.list(site.id, kind, startMs, endMs);
      const bySlot = new Map(source.map((sample) => [sample.slotStartMs, sample.value]));
      const values = Array.from({ length: count }, (_, index) => {
        const slotStartMs = startMs + index * stepMinutes * MS_PER_MINUTE;
        return bySlot.get(slotStartMs) ?? valueAtClamped(fromSnapshot, slotStartMs + (stepMinutes * MS_PER_MINUTE) / 2);
      });
      return makeSeries(startMs, stepMinutes, values);
    };

    return {
      carbon: await build('carbon', fallback.carbon),
      price: await build('price', fallback.price),
      renewable: await build('renewable', fallback.renewable),
      basis,
    };
  }

  private async persist(site: Site, snapshot: ForecastSnapshot): Promise<void> {
    const fetchedMs = this.deps.clock.now();
    const stepMs = SIGNAL_STEP_MINUTES * MS_PER_MINUTE;
    /**
     * Resampled onto the storage grid rather than written at whatever step the provider used, so a
     * thirty-minute feed and a fifteen-minute one both land on the same slots and both can be read
     * back by the same lookup.
     */
    const toSamples = (kind: SignalSample['kind'], series: ForecastSnapshot['carbon'], source: string): SignalSample[] => {
      const startMs = floorToStep(series.startMs, SIGNAL_STEP_MINUTES);
      const spanMs = series.values.length * series.stepMinutes * MS_PER_MINUTE;
      const count = Math.max(1, Math.round(spanMs / stepMs));
      return sampleSeries(series, startMs, SIGNAL_STEP_MINUTES, count).map((value, index) => ({
        siteId: site.id,
        kind,
        slotStartMs: startMs + index * stepMs,
        value,
        source,
        fetchedMs,
      }));
    };
    await this.deps.repos.signals.upsertMany([
      ...toSamples('carbon', snapshot.carbon, snapshot.sources.carbon),
      ...toSamples('price', snapshot.price, snapshot.sources.price),
      ...toSamples('renewable', snapshot.renewable, snapshot.sources.renewable),
      ...(snapshot.actualCarbon ? toSamples('actual_carbon', snapshot.actualCarbon, snapshot.sources.carbon) : []),
    ]);
  }
}
