import { scenarioStartMs, type Site } from '@cleangrid/shared';
import 'dotenv/config';
import type { Duplex } from 'node:stream';
import { buildApp } from './api/app';
import { DashboardChannel, WS_PATH_PREFIX } from './api/channel';
import type { ApiContext, SiteRuntime } from './api/context';
import { createClock, loadConfig } from './config';
import { EventBus } from './events';
import { LiveForecastProvider } from './forecast/live';
import { ForecastService, SyntheticForecastProvider } from './forecast/service';
import { createLogger } from './logger';
import { OCPP_PATH_PREFIX, OcppGateway } from './ocpp/gateway';
import { DemandMeter } from './optimiser/demandMeter';
import { DispatchService } from './optimiser/dispatcher';
import { OptimiserLoop } from './optimiser/loop';
import { createScheduler } from './optimiser/scheduler';
import { createMemoryRepositories } from './repo/memory';
import { createSupabaseRepositories } from './repo/supabase';
import { ReportService } from './reports/service';
import { loadScenarioFiles, seedFromScenario, seedNetworkOperator } from './seed/scenario';
import { SessionService } from './sessions/service';

const EMPTY_MIRROR = {
  queued: 0,
  written: 0,
  failed: 0,
  dropped: 0,
  degraded: false,
  complete: true,
  lastError: null,
} as const;

/**
 * One process holds the REST API, the OCPP gateway and an optimiser loop per site, because the
 * gateway needs long-lived sockets and each loop has to answer plug-in events in seconds.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.LOG_PRETTY);

  const scenarios = await loadScenarioFiles(config.SCENARIO);
  const first = scenarios[0];
  if (!first) throw new Error('SCENARIO named no scenario files');
  // Every site shares one clock; their local times differ, which is the point of having two.
  const clock = createClock({
    simStart: config.SIM_START,
    timeScale: config.SIM_TIME_SCALE,
    scenarioStartMs: Math.min(...scenarios.map(scenarioStartMs)),
    timezone: first.site.timezone,
  });

  // On Supabase the repositories still answer from memory and stream every write to Postgres; see
  // repo/supabase/index.ts for why a control loop does not wait on a network round trip.
  const store =
    config.REPO === 'supabase'
      ? createSupabaseRepositories({
          url: config.SUPABASE_URL as string,
          serviceKey: config.SUPABASE_SERVICE_KEY as string,
          logger,
        })
      : null;
  const repos = store?.repos ?? createMemoryRepositories();
  if (store) logger.info(await store.hydrate(), 'hydrated from supabase');

  const bus = new EventBus(logger);
  for (const scenario of scenarios) await seedFromScenario(repos, scenario, clock, logger);
  await seedNetworkOperator(repos);
  // Get the topology into Postgres before any session can reference it.
  if (store) await store.flush();

  const sessions = new SessionService({ repos, bus, clock, logger });
  const gateway = new OcppGateway({ repos, bus, clock, logger, sessions, safetyProfiles: config.OPTIMISER === 'on' });

  const live = new LiveForecastProvider({
    logger,
    ...(config.ELECTRICITY_MAPS_TOKEN ? { electricityMapsToken: config.ELECTRICITY_MAPS_TOKEN } : {}),
    ...(config.ELECTRICITY_MAPS_ZONE ? { electricityMapsZone: config.ELECTRICITY_MAPS_ZONE } : {}),
  });
  const synthetic = new SyntheticForecastProvider();
  const forecast = new ForecastService({
    // Every site gets the live provider. It decides per country how much of the forecast is
    // measured: Britain has free carbon and price feeds, everywhere gets live weather, and a
    // configured Electricity Maps token adds measured carbon for the rest.
    provider: () => (config.FORECAST === 'live' ? live : synthetic),
    fallback: synthetic,
    clock,
    bus,
    logger,
    repos,
    horizonHours: config.HORIZON_HOURS + 4,
  });

  const dispatcher = new DispatchService({
    gateway,
    repos,
    bus,
    clock,
    logger,
    sessions,
    lookaheadPeriods: config.LOOKAHEAD_PERIODS,
    hysteresisW: config.DISPATCH_HYSTERESIS_W,
  });
  const reports = new ReportService({ repos, bus, clock, logger, forecast });
  const scheduler = createScheduler(config, logger);

  const runtimes = new Map<string, SiteRuntime>();
  for (const scenario of scenarios) {
    const site = await repos.sites.get(scenario.site.id);
    if (!site) throw new Error(`scenario site ${scenario.site.id} was not seeded`);
    const demand = new DemandMeter({ bus, clock, site, slotMinutes: config.SLOT_MINUTES });
    const loop = new OptimiserLoop({
      repos,
      bus,
      clock,
      logger,
      scheduler,
      forecast,
      dispatcher,
      sessions,
      demand,
      config,
      siteId: site.id,
    });
    runtimes.set(site.id, { site, loop, demand });
  }

  const ctx: ApiContext = {
    config,
    repos,
    bus,
    clock,
    logger,
    sessions,
    gateway,
    forecast,
    reports,
    runtimes,
    defaultSiteId: first.site.id,
    storage: { kind: config.REPO, stats: () => store?.stats() ?? EMPTY_MIRROR },
  };
  const app = await buildApp(ctx);
  const channel = new DashboardChannel({ bus, clock, repos, logger });

  // Fastify does not own WebSocket upgrades, so chargers and dashboards are routed here by path.
  app.server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    const path = url.split('?')[0] ?? '';
    if (path.startsWith(OCPP_PATH_PREFIX)) {
      gateway.handleUpgrade(request, socket as Duplex, head, decodeURIComponent(path.slice(OCPP_PATH_PREFIX.length)));
      return;
    }
    if (path.startsWith(WS_PATH_PREFIX)) {
      channel.handleUpgrade(request, socket as Duplex, head, decodeURIComponent(path.slice(WS_PATH_PREFIX.length)));
      return;
    }
    socket.destroy();
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  channel.start();
  reports.start();
  for (const runtime of runtimes.values()) {
    runtime.demand.start();
    runtime.loop.start();
  }

  logger.info(
    {
      port: config.PORT,
      sites: [...runtimes.values()].map((runtime) => `${runtime.site.name} (${runtime.site.country})`),
      clock: new Date(clock.now()).toISOString(),
      timeScale: clock.scale,
      optimiser: config.OPTIMISER,
      scheduler: config.SCHEDULER,
      forecast: config.FORECAST,
      devAuth: config.DEV_AUTH,
    },
    'CleanGrid EV server ready',
  );
  for (const runtime of runtimes.values()) await runtime.loop.solve('startup');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    for (const runtime of runtimes.values()) {
      runtime.loop.stop();
      runtime.demand.stop();
    }
    reports.stop();
    await channel.close();
    await gateway.close();
    await app.close();
    // Drain what is still queued, so a clean stop leaves Postgres complete.
    if (store) {
      await store.close();
      logger.info(store.stats(), 'supabase mirror drained');
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('server failed to start:', error);
  process.exitCode = 1;
});
