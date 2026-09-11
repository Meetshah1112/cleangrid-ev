#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * Runs one simulated day end to end: starts the server on a sped-up clock, replays the scenario
 * through simulated OCPP chargers, then prints what each driver got.
 *
 *   node scripts/demo.mjs [--scale 120] [--scenario ./scenarios/day-one.json] [--scheduler greedy]
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const scale = flag('scale', '120');
const scenario = flag('scenario', './scenarios/day-one.json');
const scheduler = flag('scheduler', 'lp');
const forecast = flag('forecast', 'synthetic');
const port = flag('port', '8080');
const api = `http://127.0.0.1:${port}`;

const children = [];
let shuttingDown = false;

function run(label, command, commandArgs, env) {
  const child = spawn(command, commandArgs, {
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = label.padEnd(9);
  const pipe = (stream, sink) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) sink.write(`${prefix}| ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stdout);
  children.push(child);
  return child;
}

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${api}/health`, { headers: { 'x-dev-role': 'operator' } });
      if (response.ok) return await response.json();
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('server did not become healthy in time');
}

async function getJson(path) {
  const response = await fetch(`${api}${path}`, { headers: { 'x-dev-role': 'operator' } });
  if (!response.ok) throw new Error(`GET ${path} failed: HTTP ${response.status}`);
  const body = await response.json();
  return body.data;
}

function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

async function main() {
  console.log(`\nCleanGrid EV demo: ${scenario} at ${scale}x with the ${scheduler} scheduler\n`);
  run('server', 'npx', ['tsx', 'apps/server/src/index.ts'], {
    PORT: port,
    SCENARIO: scenario,
    SIM_START: 'scenario',
    SIM_TIME_SCALE: scale,
    SCHEDULER: scheduler,
    FORECAST: forecast,
    DEV_AUTH: '1',
    LOG_LEVEL: 'info',
  });
  await waitForHealth();

  const simulator = run('chargers', 'npx', [
    'tsx',
    'apps/simulator/src/cli.ts',
    '--scenario',
    scenario,
    '--api',
    api,
    '--url',
    `ws://127.0.0.1:${port}/ocpp`,
  ]);

  const code = await new Promise((resolve) => simulator.on('exit', resolve));
  if (code !== 0) console.log(`\nsimulator exited with code ${code}\n`);

  const [overview, sessions, impact] = await Promise.all([
    getJson('/sites/site-riverside/overview'),
    getJson('/sites/site-riverside/sessions?limit=100'),
    getJson('/sites/site-riverside/reports'),
  ]);

  const localTime = (ms) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));

  const finished = sessions
    .filter((session) => session.status === 'complete')
    .sort((a, b) => a.pluggedInMs - b.pluggedInMs);
  const reports = await Promise.all(
    finished.map(async (session) => {
      try {
        return await getJson(`/sessions/${session.id}/report`);
      } catch {
        return null;
      }
    }),
  );

  console.log('\n=== What each driver got ===\n');
  console.table(
    finished.map((session, index) => {
      const report = reports[index];
      return {
        driver: session.driverName ?? session.driverId ?? 'unknown',
        mode: session.mode,
        needed: Number(session.energyNeededKwh.toFixed(1)),
        delivered: Number(session.energyDeliveredKwh.toFixed(1)),
        'deadline met': session.energyDeliveredKwh + 0.5 >= session.energyNeededKwh ? 'yes' : 'NO',
        deadline: localTime(session.deadlineMs),
        'green score': report?.greenScore ?? '-',
        'renewable %': report ? Math.round(report.renewableShare * 100) : '-',
        'CO2 avoided kg': report ? Number(report.avoidedCo2Kg.toFixed(2)) : '-',
        'saved GBP': report ? Number(report.costSaved.toFixed(2)) : '-',
      };
    }),
  );

  console.log('\n=== Site for the day ===\n');
  console.table([
    { measure: 'sessions completed', value: impact.sessions },
    { measure: 'energy delivered kWh', value: impact.energyKwh },
    { measure: 'cost GBP', value: impact.cost },
    { measure: 'cost if dumb charging GBP', value: impact.baselineCost },
    { measure: 'CO2 kg', value: impact.co2Kg },
    { measure: 'CO2 if dumb charging kg', value: impact.baselineCo2Kg },
    { measure: 'CO2 avoided kg', value: impact.avoidedCo2Kg },
    { measure: 'average green score', value: impact.avgGreenScore },
    { measure: 'verified from meter data', value: `${impact.verifiedSessions}/${impact.sessions}` },
    { measure: 'peak site draw kW', value: impact.peakKw },
    { measure: 'grid connection kW', value: overview.gridConnectionKw },
    {
      measure: 'connection respected',
      value: impact.peakKw <= overview.gridConnectionKw + 0.5 ? 'yes' : 'NO',
    },
  ]);
  console.log('');

  stopAll();
  setTimeout(() => process.exit(0), 500);
}

main().catch((error) => {
  console.error(`demo failed: ${error.message}`);
  stopAll();
  process.exitCode = 1;
});
