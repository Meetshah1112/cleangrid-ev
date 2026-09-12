#!/usr/bin/env node
/** Names the elements wider than the viewport, so a horizontal scrollbar can be fixed at its source. */

import { chromium } from 'playwright';

const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:3000';
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 375);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width, height: 812 } });

for (const [name, path] of [
  ['overview', '/'],
  ['forecast', '/forecast'],
  ['schedules', '/schedules'],
  ['grid', '/grid'],
  ['impact', '/impact'],
]) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1_500);
  const culprits = await page.evaluate((limit) => {
    const found = [];
    for (const element of document.querySelectorAll('*')) {
      const box = element.getBoundingClientRect();
      if (box.right > limit + 1 && box.width > 40) {
        const parent = element.parentElement;
        const parentBox = parent?.getBoundingClientRect();
        // Only report the outermost offender in each chain.
        if (parentBox && parentBox.right > limit + 1) continue;
        found.push(
          `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)} w=${Math.round(box.width)} right=${Math.round(box.right)}`,
        );
      }
    }
    return found.slice(0, 6);
  }, width);
  console.log(`${name.padEnd(10)} ${culprits.length === 0 ? 'ok' : culprits.join(' | ')}`);
}

await browser.close();
