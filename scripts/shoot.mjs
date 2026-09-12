#!/usr/bin/env node
/**
 * Screenshots the console in a real browser, because reading the CSS is not seeing the page.
 *
 *   node scripts/shoot.mjs [--out <dir>] [--base http://localhost:3000] [--wide 1440] [--narrow 375]
 *
 * Drives the Chrome already installed on this machine rather than downloading one. Every route is
 * captured at both breakpoints, and anything the page logged to the console or failed to fetch is
 * printed, so a screenshot that looks fine but is quietly erroring cannot pass unnoticed.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const base = arg('base', 'http://localhost:3000');
const out = arg('out', 'C:/Users/hetss/AppData/Local/Temp/claude/shots');
const wide = Number(arg('wide', 1440));
const narrow = Number(arg('narrow', 375));
const only = arg('only', null);

const ROUTES = [
  ['overview', '/'],
  ['forecast', '/forecast'],
  ['schedules', '/schedules'],
  ['grid', '/grid'],
  ['impact', '/impact'],
].filter(([name]) => only === null || name === only);

mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

for (const [width, label] of [
  [wide, 'wide'],
  [narrow, 'narrow'],
]) {
  const context = await browser.newContext({ viewport: { width, height: label === 'wide' ? 900 : 812 } });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console ${message.text().slice(0, 160)}`);
  });
  page.on('requestfailed', (request) => {
    problems.push(`request failed ${request.url().slice(0, 120)} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('pageerror', (error) => problems.push(`page error ${error.message.slice(0, 160)}`));

  for (const [name, path] of ROUTES) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    // The console polls; give it a beat to paint real numbers rather than placeholders.
    await page.waitForTimeout(2_500);
    const file = join(out, `${name}-${label}.png`);
    await page.screenshot({ path: file, fullPage: label === 'wide' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow) problems.push(`${name} @${width}px scrolls horizontally`);
    console.log(`${file}`);
  }
  await context.close();
}

await browser.close();

if (problems.length > 0) {
  console.log('\nproblems:');
  for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);
} else {
  console.log('\nno console errors, failed requests, or horizontal overflow');
}
