#!/usr/bin/env node
import process from 'node:process';
import { deadlinesMet, runScenario } from './lib/run.mjs';

/**
 * Scenes 1 and 2 of the demo, back to back: the same cars and the same deadlines, once with the
 * optimiser off and once with it on, then the two sets of numbers side by side.
 *
 *   node scripts/compare.mjs [--scale 60] [--scenario ./scenarios/evening-peak.json]
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const scale = flag('scale', '60');
const scenario = flag('scenario', './scenarios/evening-peak.json');
const basePort = Number(flag('port', '8100'));
const quiet = args.includes('--quiet');

function row(measure, baseline, optimised, better) {
  return { measure, 'optimiser off': baseline, 'optimiser on': optimised, ...(better ? { change: better } : {}) };
}

const pct = (before, after) => (before === 0 ? '--' : `${Math.round(((before - after) / before) * 100)}% lower`);

async function main() {
  console.log(`\nCleanGrid EV: the same evening, twice, at ${scale}x\n`);

  console.log('--- Scene 1: optimiser off, every car charges flat out from plug-in ---\n');
  const baseline = await runScenario({ scenario, port: basePort, scale, optimiser: 'off', label: 'baseline', quiet });

  console.log('\n--- Scene 2: optimiser on, same cars, same deadlines ---\n');
  const optimised = await runScenario({ scenario, port: basePort + 1, scale, optimiser: 'on', label: 'optimised', quiet });

  const b = { ...baseline.impact, ...deadlinesMet(baseline.sessions), connectionKw: baseline.overview.gridConnectionKw };
  const o = { ...optimised.impact, ...deadlinesMet(optimised.sessions), connectionKw: optimised.overview.gridConnectionKw };
  const overBaseline = baseline.demand.intervals.filter((i) => i.totalKw > b.connectionKw + 0.05).length;
  const overOptimised = optimised.demand.intervals.filter((i) => i.totalKw > o.connectionKw + 0.05).length;

  console.log('\n=== Side by side ===\n');
  console.table([
    row('energy delivered kWh', b.energyKwh, o.energyKwh),
    row('deadlines met', `${b.met} of ${b.total}`, `${o.met} of ${o.total}`),
    row('cost GBP', b.cost, o.cost, pct(b.cost, o.cost)),
    row('CO2 kg', b.co2Kg, o.co2Kg, pct(b.co2Kg, o.co2Kg)),
    row('peak site draw kW', b.peakKw, o.peakKw, pct(b.peakKw, o.peakKw)),
    row('grid connection kW', b.connectionKw, o.connectionKw),
    row('intervals over the connection', overBaseline, overOptimised),
    row('average green score', b.avgGreenScore, o.avgGreenScore),
    row('renewable share', `${Math.round(b.avgRenewableShare * 100)}%`, `${Math.round(o.avgRenewableShare * 100)}%`),
  ]);

  const saved = (b.co2Kg - o.co2Kg).toFixed(1);
  const money = (b.cost - o.cost).toFixed(2);
  console.log(
    `\n${saved} kg of CO2 and £${money} saved on the same ${o.energyKwh} kWh, with the peak cut from ` +
      `${b.peakKw} kW to ${o.peakKw} kW against a ${o.connectionKw} kW connection.\n`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(`comparison failed: ${error.message}`);
  process.exitCode = 1;
});
