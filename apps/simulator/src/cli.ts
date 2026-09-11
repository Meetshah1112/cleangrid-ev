import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { localDateOf, parseScenario, rebaseScenario } from './depsRunner';
import { SimulatorRunner } from './runner';

/** Charger simulator: stands in for hardware that speaks OCPP 1.6J. */

interface CliOptions {
  readonly url: string;
  readonly api: string;
  readonly scenario: string;
  readonly timeScale?: string;
  readonly rebase?: string;
  readonly meterInterval: string;
}

async function main(): Promise<void> {
  const program = new Command()
    .name('cleangrid-sim')
    .description('Simulated OCPP 1.6J charge points replaying a scenario against the CleanGrid server')
    .option('--url <url>', 'OCPP WebSocket base URL', 'ws://127.0.0.1:8080/ocpp')
    .option('--api <url>', 'REST base URL', 'http://127.0.0.1:8080')
    .option('--scenario <path>', 'scenario file', './scenarios/day-one.json')
    .option('--time-scale <n>', 'override the server time scale')
    .option('--rebase <day>', 'move the scenario to another day (YYYY-MM-DD or "today")')
    .option('--meter-interval <minutes>', 'simulated minutes between meter values', '1')
    .parse(process.argv);

  const options = program.opts<CliOptions>();
  const raw = await readFile(resolve(options.scenario), 'utf8');
  const parsed = parseScenario(JSON.parse(raw));
  const scenario =
    options.rebase === undefined
      ? parsed
      : rebaseScenario(parsed, options.rebase === 'today' ? localDateOf(Date.now(), parsed.site.timezone) : options.rebase);

  const runner = new SimulatorRunner({
    scenario,
    wsUrl: options.url,
    apiUrl: options.api,
    ...(options.timeScale === undefined ? {} : { timeScale: Number(options.timeScale) }),
    meterIntervalMs: Number(options.meterInterval) * 60_000,
  });

  const shutdown = async (): Promise<void> => {
    await runner.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await runner.start();
  await runner.waitForCompletion();
  await runner.stop();
}

main().catch((error: unknown) => {
  console.error(`simulator failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
