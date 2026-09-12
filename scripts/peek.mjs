#!/usr/bin/env node
/** Screenshots a local HTML file in both themes, to check a page before publishing it. */

import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const file = process.argv[2];
const out = process.argv[3] ?? 'C:/Users/hetss/AppData/Local/Temp/claude/shots';

const browser = await chromium.launch({ channel: 'chrome' });
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: `${out}/explainer-${scheme}.png`, fullPage: true });
  console.log(`${out}/explainer-${scheme}.png`);
  await context.close();
}

const narrow = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await narrow.newPage();
await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
);
console.log(overflow ? 'PROBLEM: scrolls horizontally at 390px' : 'no horizontal overflow at 390px');
await browser.close();
