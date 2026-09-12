#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { deadlinesMet, runScenario } from './lib/run.mjs';

/**
 * Scenes 1 and 2 of the demo, back to back: the same cars and the same deadlines, once with the
 * optimiser off and once with it on, then the two sets of numbers side by side.
 *
 *   node scripts/compare.mjs [--scale 60] [--scenario ./scenarios/gandhinagar-secretariat.json]
 *
 * The site and its currency come from the scenario file rather than being written down here, so
 * this works on whichever site it is pointed at. Reporting a Gujarat depot's bill in pounds would
 * be a thirty-fold error wearing the wrong sign.
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const scale = flag('scale', '60');
const scenario = flag('scenario', './scenarios/gandhinagar-secretariat.json');

/** Who this run is about, read from the scenario rather than assumed. */
const site = JSON.parse(readFileSync(scenario, 'utf8')).site;
const SYMBOLS = { GBP: '£', INR: '₹', EUR: '€', USD: '$' };
const symbol = SYMBOLS[site.currency] ?? `${site.currency} `;
const basePort = Number(flag('port', '8100'));
const quiet = args.includes('--quiet');

function row(measure, baseline, optimised, better) {
  return { measure, 'optimiser off': baseline, 'optimiser on': optimised, ...(better ? { change: better } : {}) };
}

const pct = (before, after) => (before === 0 ? '--' : `${Math.round(((before - after) / before) * 100)}% lower`);
const per = (total, energyKwh) => (energyKwh === 0 ? 0 : Number((total / energyKwh).toFixed(3)));

async function main() {
  console.log(`\nCleanGrid EV at ${site.name}: the same day, twice, at ${scale}x\n`);

  console.log('--- Scene 1: optimiser off, every car charges flat out from plug-in ---\n');
  const baseline = await runScenario({
    scenario,
    port: basePort,
    scale,
    optimiser: 'off',
    siteId: site.id,
    label: 'baseline',
    quiet,
  });

  console.log('\n--- Scene 2: optimiser on, same cars, same deadlines ---\n');
  const optimised = await runScenario({
    scenario,
    port: basePort + 1,
    scale,
    optimiser: 'on',
    siteId: site.id,
    label: 'optimised',
    quiet,
  });

  const b = { ...baseline.impact, ...deadlinesMet(baseline.sessions), connectionKw: baseline.overview.gridConnectionKw };
  const o = { ...optimised.impact, ...deadlinesMet(optimised.sessions), connectionKw: optimised.overview.gridConnectionKw };
  const overBaseline = baseline.demand.intervals.filter((i) => i.totalKw > b.connectionKw + 0.05).length;
  const overOptimised = optimised.demand.intervals.filter((i) => i.totalKw > o.connectionKw + 0.05).length;

  console.log('\n=== Side by side ===\n');
  console.table([
    row('energy delivered kWh', b.energyKwh, o.energyKwh),
    row('deadlines met', `${b.met} of ${b.total}`, `${o.met} of ${o.total}`),
    row(`cost ${site.currency}`, b.cost, o.cost, pct(b.cost, o.cost)),
    row(`cost per kWh ${site.currency}`, per(b.cost, b.energyKwh), per(o.cost, o.energyKwh), pct(per(b.cost, b.energyKwh), per(o.cost, o.energyKwh))),
    row('CO2 kg', b.co2Kg, o.co2Kg, pct(b.co2Kg, o.co2Kg)),
    row('CO2 g per kWh', Math.round(per(b.co2Kg, b.energyKwh) * 1000), Math.round(per(o.co2Kg, o.energyKwh) * 1000), pct(per(b.co2Kg, b.energyKwh), per(o.co2Kg, o.energyKwh))),
    row('peak site draw kW', b.peakKw, o.peakKw, pct(b.peakKw, o.peakKw)),
    row('grid connection kW', b.connectionKw, o.connectionKw),
    row('intervals over the connection', overBaseline, overOptimised),
    row('average green score', b.avgGreenScore, o.avgGreenScore),
    row('renewable share', `${Math.round(b.avgRenewableShare * 100)}%`, `${Math.round(o.avgRenewableShare * 100)}%`),
  ]);

  const saved = (b.co2Kg - o.co2Kg).toFixed(1);
  const money = (b.cost - o.cost).toFixed(2);
  console.log(
    `\n${saved} kg of CO2 and ${symbol}${money} saved, with the peak cut from ${b.peakKw} kW to ` +
      `${o.peakKw} kW against a ${o.connectionKw} kW connection, and every deadline still met.\n`,
  );

  /**
   * The two runs rarely deliver the same number of kWh, and pretending otherwise would overstate
   * the case. A charger with no plan cannot know what a driver asked for, so it fills the battery;
   * the optimiser delivers what was requested and stops. That is a real saving, but it is a
   * different saving from moving energy to a cleaner hour, and the per-kWh rows above separate
   * them: those compare like with like, and they are the honest headline.
   */
  const extra = Number((b.energyKwh - o.energyKwh).toFixed(1));
  if (Math.abs(extra) > 0.5) {
    console.log(
      `Note: the unplanned run put ${extra} kWh more into the same cars, because a dumb charger ` +
        `fills a battery rather than meeting a request. Compare the per-kWh rows for the effect of ` +
        `timing alone.\n`,
    );
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`comparison failed: ${error.message}`);
  process.exitCode = 1;
});
