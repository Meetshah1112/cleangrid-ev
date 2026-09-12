import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { localDateOf, parseScenario, rebaseScenario, type Scenario } from './depsRunner';
import { SimulatorRunner } from './runner';

/** Charger simulator: stands in for hardware that speaks OCPP 1.6J, at one site or several. */

interface CliOptions {
  readonly url: string;
  readonly api: string;
  readonly scenario: string;
  readonly timeScale?: string;
  readonly rebase?: string;
  readonly meterInterval: string;
  readonly loop?: boolean;
}

async function loadScenario(path: string, rebase: string | undefined): Promise<Scenario> {
  const raw = await readFile(resolve(path.trim()), 'utf8');
  const parsed = parseScenario(JSON.parse(raw));
  if (rebase === undefined) return parsed;
  return rebaseScenario(parsed, rebase === 'today' ? localDateOf(Date.now(), parsed.site.timezone) : rebase);
}

async function main(): Promise<void> {
  const program = new Command()
    .name('cleangrid-sim')
    .description('Simulated OCPP 1.6J charge points replaying one or more scenarios')
    .option('--url <url>', 'OCPP WebSocket base URL', 'ws://127.0.0.1:8080/ocpp')
    .option('--api <url>', 'REST base URL', 'http://127.0.0.1:8080')
    .option('--scenario <paths>', 'scenario files, comma separated for several sites', './scenarios/day-one.json')
    .option('--time-scale <n>', 'override the server time scale')
    .option('--rebase <day>', 'move the scenarios to another day (YYYY-MM-DD or "today")')
    .option('--meter-interval <minutes>', 'simulated minutes between meter values', '1')
    .option('--loop', 'replay the day instead of disconnecting after the last car leaves')
    .parse(process.argv);

  const options = program.opts<CliOptions>();
  const paths = options.scenario
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const runners = await Promise.all(
    paths.map(async (path) => {
      const scenario = await loadScenario(path, options.rebase);
      return new SimulatorRunner({
        scenario,
        wsUrl: options.url,
        apiUrl: options.api,
        ...(options.timeScale === undefined ? {} : { timeScale: Number(options.timeScale) }),
        meterIntervalMs: Number(options.meterInterval) * 60_000,
        ...(options.loop === true ? { loop: true } : {}),
        ...(paths.length > 1 ? { label: scenario.site.name } : {}),
      });
    }),
  );

  const shutdown = async (): Promise<void> => {
    await Promise.all(runners.map((runner) => runner.stop()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  for (const runner of runners) await runner.start();
  await Promise.all(runners.map((runner) => runner.waitForCompletion()));
  await Promise.all(runners.map((runner) => runner.stop()));
}

main().catch((error: unknown) => {
  console.error(`simulator failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
