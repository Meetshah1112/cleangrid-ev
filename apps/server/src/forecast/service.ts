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
  readonly provider: ForecastProvider;
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

  async snapshot(site: Site, force = false): Promise<ForecastSnapshot> {
    const nowMs = this.deps.clock.now();
    const horizonHours = this.deps.horizonHours ?? 26;
    const cached = this.cache.get(site.id);
    const refreshMs = (this.deps.refreshMinutes ?? 30) * MS_PER_MINUTE;
    const covers = cached ? cached.snapshot.carbon.startMs <= nowMs : false;
    if (!force && cached && covers && nowMs - cached.fetchedMs < refreshMs) return cached.snapshot;

    const startMs = nowMs - MS_PER_MINUTE * 60;
    let snapshot: ForecastSnapshot;
    try {
      snapshot = await this.deps.provider.fetch(site, startMs, horizonHours);
    } catch (error) {
      this.deps.logger.warn({ err: error, provider: this.deps.provider.name }, 'forecast source failed');
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
    const stepMinutes = 15;
    const startMs = floorToStep(fromMs, stepMinutes);
    const endMs = Math.max(ceilToStep(toMs, stepMinutes), startMs + stepMinutes * MS_PER_MINUTE);
    const count = Math.round((endMs - startMs) / (stepMinutes * MS_PER_MINUTE));
    const hours = Math.max(1, (endMs - startMs) / (60 * MS_PER_MINUTE));

    let fallback: ForecastSnapshot;
    try {
      fallback = await this.deps.provider.fetch(site, startMs, hours);
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
    const toSamples = (kind: SignalSample['kind'], series: ForecastSnapshot['carbon'], source: string): SignalSample[] =>
      series.values.map((value, index) => ({
        siteId: site.id,
        kind,
        slotStartMs: series.startMs + index * series.stepMinutes * MS_PER_MINUTE,
        value,
        source,
        fetchedMs,
      }));
    await this.deps.repos.signals.upsertMany([
      ...toSamples('carbon', snapshot.carbon, snapshot.sources.carbon),
      ...toSamples('price', snapshot.price, snapshot.sources.price),
      ...toSamples('renewable', snapshot.renewable, snapshot.sources.renewable),
      ...(snapshot.actualCarbon ? toSamples('actual_carbon', snapshot.actualCarbon, snapshot.sources.carbon) : []),
    ]);
  }
}
