#!/usr/bin/env node
import process from 'node:process';
import { getJson, kill, sleep, spawnLabelled, waitForHealth } from './lib/run.mjs';

/**
 * Scene 3 of the demo: the part a driver can feel.
 *
 * compare.mjs shows what the site saves over a whole day. This shows the decision underneath it,
 * on one car, in a few seconds: give the optimiser more time and watch the charging move; ask it
 * for a different thing and watch it move somewhere else entirely.
 *
 *   node scripts/shift.mjs [--scenario ./scenarios/vadodara-alkapuri-depot.json] [--scale 300]
 *
 * Vadodara by default, because Gujarat is the one place in this network where the two questions
 * genuinely disagree. Its nights are the cheapest hours under the time-of-day tariff and also the
 * dirtiest, running on coal; its middays are the cleanest and cost more. A driver asking for
 * "cheapest" and a driver asking for "greenest" want opposite things from the same parked window,
 * and one plan cannot serve both. That is the whole argument for asking them.
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const scenario = flag('scenario', './scenarios/vadodara-alkapuri-depot.json');
const port = Number(flag('port', '8110'));
const scale = flag('scale', '300');
const api = `http://127.0.0.1:${port}`;
const quiet = !args.includes('--verbose');

const DRIVER = (id) => ({ 'x-dev-role': 'driver', 'x-dev-user': id });
/**
 * How much slack to hand the car in scene two. Enough to carry an overnight window past dawn and
 * into the middle of the day, because that is where the two questions start disagreeing: before
 * it, a Gujarat night is cheap and dirty and every mode picks the same hours.
 */
const EXTRA_HOURS = 6;
const BLOCKS = ' ▁▂▃▄▅▆▇█';

/** One row of the 24 hours ahead, at hourly resolution, so it fits a terminal. */
function sparkline(values, hours = 24, perHour = 4) {
  const hourly = Array.from({ length: hours }, (_, hour) => {
    const slice = values.slice(hour * perHour, (hour + 1) * perHour).filter((v) => Number.isFinite(v));
    return slice.length === 0 ? 0 : slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const top = Math.max(...hourly, 1e-9);
  return hourly.map((v) => BLOCKS[Math.min(BLOCKS.length - 1, Math.round((v / top) * (BLOCKS.length - 1)))]).join('');
}

/** Hour labels under the chart, aligned to the plan's own start rather than to the wall clock. */
function hourAxis(startMs, timezone, hours = 24) {
  const at = (hour) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(startMs + hour * 3_600_000),
    );
  let line = '';
  for (let hour = 0; hour < hours; hour += 1) line += hour % 6 === 0 ? at(hour).padEnd(6, ' ') : '';
  return line.slice(0, hours);
}

/**
 * Where the energy in a plan actually lands, weighted by how much goes in each slot. This is the
 * number the whole product turns on: two plans can deliver the same kWh by the same deadline and
 * still differ by a third in what they emit.
 */
function weighted(plannedKw, series, slotHours) {
  let energy = 0;
  let total = 0;
  for (let slot = 0; slot < plannedKw.length; slot += 1) {
    const kwh = (plannedKw[slot] ?? 0) * slotHours;
    const value = series[slot];
    if (kwh <= 0 || !Number.isFinite(value)) continue;
    energy += kwh;
    total += kwh * value;
  }
  return { energyKwh: energy, average: energy === 0 ? 0 : total / energy };
}

/** The forecast resampled onto the plan's slot grid, so the two can be compared slot for slot. */
function onPlanGrid(forecast, grid) {
  const pick = (values) =>
    Array.from({ length: grid.slots }, (_, slot) => {
      const ms = grid.startMs + slot * grid.slotMinutes * 60_000;
      const index = Math.floor((ms - forecast.startMs) / (forecast.stepMinutes * 60_000));
      return values[Math.max(0, Math.min(values.length - 1, index))] ?? Number.NaN;
    });
  return {
    carbon: pick(forecast.carbonGPerKwh),
    price: pick(forecast.pricePerKwh),
    renewable: pick(forecast.renewableShare),
  };
}

async function readPlan(sessionId, driverId, site) {
  const detail = await getJson(api, `/sessions/${sessionId}`, 'driver', DRIVER(driverId));
  const forecast = await getJson(api, `/sites/${site.id}/forecast?hours=26`, 'driver', DRIVER(driverId));
  const grid = detail.planGrid;
  const slotHours = grid.slotMinutes / 60;
  const onGrid = onPlanGrid(forecast, grid);
  return {
    detail,
    grid,
    plannedKw: detail.plannedKw,
    onGrid,
    hoursLeft: (detail.session.deadlineMs - grid.nowMs) / 3_600_000,
    carbon: weighted(detail.plannedKw, onGrid.carbon, slotHours),
    price: weighted(detail.plannedKw, onGrid.price, slotHours),
    renewable: weighted(detail.plannedKw, onGrid.renewable, slotHours),
  };
}

function render(label, plan, site, currency) {
  const axis = hourAxis(plan.grid.startMs, site.timezone);
  console.log(`\n  ${label}`);
  console.log(`    grid CO2  ${sparkline(plan.onGrid.carbon)}   ${Math.round(Math.min(...plan.onGrid.carbon.filter(Number.isFinite)))}-${Math.round(Math.max(...plan.onGrid.carbon.filter(Number.isFinite)))} g`);
  console.log(`    charging  ${sparkline(plan.plannedKw)}   ${plan.carbon.energyKwh.toFixed(1)} kWh planned`);
  console.log(`              ${axis}`);
  console.log(
    `    lands at  ${Math.round(plan.carbon.average)} gCO2/kWh · ${currency}${plan.price.average.toFixed(2)}/kWh · ` +
      `${Math.round(plan.renewable.average * 100)}% renewable`,
  );
}

/** Wait for the optimiser to have re-solved and the new plan to have reached the session. */
async function settle(ms = 4_000) {
  await sleep(ms);
}

async function ask(sessionId, driverId, body) {
  const response = await fetch(`${api}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { ...DRIVER(driverId), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PATCH /sessions failed: HTTP ${response.status}`);
  await settle();
}

async function main() {
  const site = JSON.parse(await (await import('node:fs/promises')).readFile(scenario, 'utf8')).site;
  const currency = { GBP: '£', INR: '₹', EUR: '€', USD: '$' }[site.currency] ?? `${site.currency} `;

  console.log(`\nCleanGrid EV at ${site.name}: one car, three answers\n`);

  const server = spawnLabelled('server', 'npx', ['tsx', 'apps/server/src/index.ts'], {
    PORT: String(port),
    SCENARIO: scenario,
    SIM_START: 'scenario',
    SIM_TIME_SCALE: scale,
    SCHEDULER: 'lp',
    OPTIMISER: 'on',
    FORECAST: 'synthetic',
    REPO: 'memory',
    DEV_AUTH: '1',
    LOG_LEVEL: 'warn',
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

    try {
      // Wait for the first car of the day to plug in and be given a plan.
      let active = [];
      for (let attempt = 0; attempt < 60 && active.length === 0; attempt += 1) {
        await sleep(1_000);
        active = await getJson(api, `/sites/${site.id}/sessions?status=active`);
      }
      const session = active[0];
      if (!session) throw new Error('no car plugged in; try a higher --scale');

      const driverId = session.driverId;
      const who = await getJson(api, '/me', 'driver', DRIVER(driverId));
      console.log(
        `  ${who.displayName} plugged in at ${session.chargerId}, wants ${session.energyNeededKwh} kWh, ` +
          `and is not leaving for a while.\n`,
      );

      // --- Scene 1: the plan it can make inside the deadline it was given ---------------------
      console.log('  --- 1. As green as it can be, inside the window it has ---');
      await ask(session.id, driverId, { mode: 'greenest' });
      const tight = await readPlan(session.id, driverId, site);
      render(`greenest · ${tight.hoursLeft.toFixed(1)}h until they leave`, tight, site, currency);

      // --- Scene 2: the same request, with more room to answer it ----------------------------
      console.log(`\n  --- 2. The driver says they can wait ${EXTRA_HOURS} hours longer ---`);
      const wider = new Date(session.deadlineMs + EXTRA_HOURS * 3_600_000).toISOString();
      await ask(session.id, driverId, { deadlineAt: wider });
      const loose = await readPlan(session.id, driverId, site);
      render(`greenest · ${loose.hoursLeft.toFixed(1)}h until they leave`, loose, site, currency);

      const moved = tight.carbon.average - loose.carbon.average;
      console.log(
        moved > 1
          ? `\n  Nothing else changed. ${EXTRA_HOURS} more hours of slack moved the charging into daylight ` +
            `and took ${Math.round(moved)} gCO2/kWh off it — ` +
            `${Math.round((moved / Math.max(1, tight.carbon.average)) * 100)}% less carbon for the same kWh.`
          : `\n  The plan held: it had already reached the cleanest hours inside the original deadline, so ` +
            `more time bought nothing. That is the right answer, and worth showing too.`,
      );

      // --- Scene 3: the same window, asked a different question -------------------------------
      console.log('\n  --- 3. Same car, same window. Now ask for the cheapest hours instead ---');
      await ask(session.id, driverId, { mode: 'cheapest' });
      const cheap = await readPlan(session.id, driverId, site);
      render(`cheapest · ${cheap.hoursLeft.toFixed(1)}h until they leave`, cheap, site, currency);

      const carbonGap = cheap.carbon.average - loose.carbon.average;
      const priceGap = loose.price.average - cheap.price.average;
      if (carbonGap > 1) {
        console.log(
          `\n  The two answers pull apart: cheapest stays on the cheap overnight tariff and burns coal for ` +
            `it, greenest waits for the sun. Clean costs ${currency}${priceGap.toFixed(2)} more per kWh and ` +
            `saves ${Math.round(carbonGap)} gCO2/kWh — ${Math.round((carbonGap / Math.max(1, cheap.carbon.average)) * 100)}% less carbon.`,
        );
        console.log('  There is no single right plan here, which is exactly why the driver is asked.');
      } else {
        console.log(
          `\n  On this grid, in this window, the cheapest hours are also the cleanest, so both answers agree. ` +
            `That is worth showing too — it is not true everywhere, and it is not true here all day.`,
        );
      }

      console.log('\n  All three finish before the driver leaves. That is the constraint, not the goal —');
      console.log('  the goal is where inside it the energy lands.\n');
    } finally {
      kill(simulator);
    }
  } finally {
    kill(server);
    await sleep(400);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`\nshift failed: ${error.message}\n`);
  process.exitCode = 1;
});
