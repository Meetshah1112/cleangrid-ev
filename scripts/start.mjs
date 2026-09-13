#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * The hosted demo in one process tree: the server, and once it answers, the simulated chargers that
 * stand in for hardware. A host such as Render runs one command per service, and a demo whose bays
 * all read offline looks broken, so the chargers ship with the server.
 *
 *   node scripts/start.mjs
 *
 * Reads the server's own environment (PORT, SCENARIO, ACCESS_CODE_SECRET, OCPP_AUTH_KEY, ...), plus:
 *   SIMULATOR=off     run the server alone, for real chargers
 *   SIM_REBASE=today  move the scenario to today, which a server on the real clock needs
 *
 * If the simulator stops it is started again; if the server stops, everything stops and the host
 * restarts the service.
 */

const port = process.env.PORT ?? '8080';
const local = `127.0.0.1:${port}`;
const SIMULATOR_RESTART_MS = 10_000;
const HEALTH_TIMEOUT_MS = 120_000;

let stopping = false;
let simulator = null;

function launch(label, script, args = []) {
  const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], { stdio: 'inherit', env: process.env });
  child.on('error', (error) => console.error(`[start] ${label} could not start: ${error.message}`));
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${local}/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not answer /health within ${HEALTH_TIMEOUT_MS / 1000}s`);
}

function startSimulator() {
  if (stopping) return;
  const args = ['--api', `http://${local}`, '--url', `ws://${local}/ocpp`, '--loop'];
  if (process.env.SCENARIO) args.push('--scenario', process.env.SCENARIO);
  if (process.env.SIM_REBASE) args.push('--rebase', process.env.SIM_REBASE);
  simulator = launch('simulator', 'apps/simulator/src/cli.ts', args);
  simulator.on('exit', (code) => {
    simulator = null;
    if (stopping) return;
    console.error(`[start] simulator exited (${code}); starting it again in ${SIMULATOR_RESTART_MS / 1000}s`);
    setTimeout(startSimulator, SIMULATOR_RESTART_MS);
  });
}

const server = launch('server', 'apps/server/src/index.ts');

server.on('exit', (code, signal) => {
  stopping = true;
  simulator?.kill('SIGTERM');
  console.error(`[start] server exited (${signal ?? code})`);
  process.exit(code ?? 1);
});

// Pass the host's stop signal on and let the server drain its writes to Postgres before exiting.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    simulator?.kill('SIGTERM');
    server.kill(signal);
  });
}

if (process.env.SIMULATOR !== 'off') {
  waitForHealth()
    .then(startSimulator)
    .catch((error) => {
      console.error(`[start] ${error.message}`);
      stopping = true;
      server.kill('SIGTERM');
    });
}
