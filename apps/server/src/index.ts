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
import { ReportService } from './reports/service';
import { loadScenarioFiles, seedFromScenario } from './seed/scenario';
import { SessionService } from './sessions/service';

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

  const repos = createMemoryRepositories();
  const bus = new EventBus(logger);
  for (const scenario of scenarios) await seedFromScenario(repos, scenario, clock, logger);

  const sessions = new SessionService({ repos, bus, clock, logger });
  const gateway = new OcppGateway({ repos, bus, clock, logger, sessions, safetyProfiles: config.OPTIMISER === 'on' });

  const live = new LiveForecastProvider({ logger });
  const synthetic = new SyntheticForecastProvider();
  const forecast = new ForecastService({
    // Live carbon and price feeds exist for Great Britain; elsewhere the forecast is modelled.
    provider: (site: Site) => (config.FORECAST === 'live' && site.country === 'GB' ? live : synthetic),
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
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('server failed to start:', error);
  process.exitCode = 1;
});
