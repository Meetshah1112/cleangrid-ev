import { spawn } from 'node:child_process';
import process from 'node:process';

/** Starting a server, replaying a scenario through it, and reading back what happened. */

export function spawnLabelled(label, command, args, env, { quiet = false } = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = label.padEnd(9);
  const pipe = (stream) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim() && !quiet) process.stdout.write(`${prefix}| ${line}\n`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForHealth(api, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${api}/health`, { headers: { 'x-dev-role': 'operator' } });
      if (response.ok) return await response.json();
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error(`server at ${api} did not become healthy`);
}

export async function getJson(api, path, role = 'operator') {
  const response = await fetch(`${api}${path}`, { headers: { 'x-dev-role': role, 'x-dev-user': 'ops-priya' } });
  if (!response.ok) throw new Error(`GET ${path} failed: HTTP ${response.status}`);
  return (await response.json()).data;
}

export function kill(child) {
  try {
    child?.kill('SIGTERM');
  } catch {
    // already gone
  }
}

/**
 * Run one scenario end to end and return what the site did. `optimiser: 'off'` is the dumb-charger
 * baseline: nothing plans, nothing limits, every car charges flat out from the moment it plugs in.
 */
export async function runScenario({
  scenario,
  port,
  scale,
  optimiser = 'on',
  scheduler = 'lp',
  forecast = 'synthetic',
  siteId = 'site-riverside',
  quiet = false,
  label = 'run',
}) {
  const api = `http://127.0.0.1:${port}`;
  const server = spawnLabelled('server', 'npx', ['tsx', 'apps/server/src/index.ts'], {
    PORT: String(port),
    SCENARIO: scenario,
    SIM_START: 'scenario',
    SIM_TIME_SCALE: String(scale),
    SCHEDULER: scheduler,
    OPTIMISER: optimiser,
    FORECAST: forecast,
    DEV_AUTH: '1',
    LOG_LEVEL: 'info',
  }, { quiet });

  try {
    await waitForHealth(api);
    const simulator = spawnLabelled('chargers', 'npx', [
      'tsx',
      'apps/simulator/src/cli.ts',
      '--scenario',
      scenario,
      '--api',
      api,
      '--url',
      `ws://127.0.0.1:${port}/ocpp`,
    ], {}, { quiet });

    const code = await new Promise((resolve) => simulator.on('exit', resolve));
    if (code !== 0) console.log(`${label}: simulator exited with code ${code}`);

    const [overview, sessions, impact, demand] = await Promise.all([
      getJson(api, `/sites/${siteId}/overview`),
      getJson(api, `/sites/${siteId}/sessions?limit=100`),
      getJson(api, `/sites/${siteId}/reports`),
      getJson(api, `/sites/${siteId}/demand?hours=48`),
    ]);
    return { overview, sessions, impact, demand, api, label };
  } finally {
    kill(server);
    await sleep(400);
  }
}

export function deadlinesMet(sessions) {
  const finished = sessions.filter((session) => session.status === 'complete');
  const met = finished.filter((session) => session.energyDeliveredKwh + 0.5 >= session.energyNeededKwh);
  return { met: met.length, total: finished.length };
}

export const localTime = (ms) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(ms),
  );
