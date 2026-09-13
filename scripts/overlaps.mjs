#!/usr/bin/env node
/**
 * Finds text drawn on top of other text, across the console's pages and common screen sizes.
 *
 *   node scripts/overlaps.mjs --code <an operator's access code> [--base http://localhost:3000]
 *                             [--api http://127.0.0.1:8095] [--site site-riverside] [--pages forecast,schedules]
 *
 * Labels over the valley scenes are positioned from data, so a collision appears only at some widths
 * and some moments of the day: a peak early in the morning, a clean window that ends near now. Looking
 * at screenshots finds the one someone happened to take. This measures every line of visible text,
 * including SVG labels, and names each pair that overlaps.
 */

import { chromium } from 'playwright';

const arg = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const base = arg('base', 'http://localhost:3000');
const api = arg('api', 'http://127.0.0.1:8095');
const code = arg('code', process.env.CONSOLE_CODE);
const siteId = arg('site', 'site-riverside');
const only = arg('pages', '')
  .split(',')
  .filter(Boolean);
if (!code) {
  console.error('Pass --code with an operator access code (see scripts/access-codes.ts).');
  process.exit(1);
}

const VIEWPORTS = [
  [1920, 1080],
  [1600, 900],
  [1536, 864],
  [1440, 900],
  [1366, 768],
  [1280, 800],
  [1024, 768],
  [900, 1000],
  [768, 1024],
  [390, 844],
];

// The schedules page marks a clean window only when sent there with one, so ask for today's.
const forecast = await fetch(`${api}/sites/${siteId}/forecast?hours=24`, { headers: { 'x-access-code': code } })
  .then((response) => response.json())
  .then((body) => body.data)
  .catch(() => null);
const window = forecast?.greenWindow ? `?window=${forecast.greenWindow.startMs}-${forecast.greenWindow.endMs}` : '';

const PAGES = [
  ['overview', '/'],
  ['forecast', '/forecast'],
  ['schedules', `/schedules${window}`],
  ['grid', '/grid'],
  ['impact', '/impact'],
].filter(([name]) => only.length === 0 || only.includes(name));

const browser = await chromium.launch({ channel: 'chrome' });
let problems = 0;

for (const [width, height] of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.fill('#access-code', code);
  await page.click('button[type=submit]');
  await page.waitForSelector('.masthead', { timeout: 30_000 });

  for (const [name, path] of PAGES) {
    await page.goto(`${base}${path}#${siteId}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(2_500);
    const pairs = await page.evaluate(() => {
      const visible = (element) => {
        for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
        }
        return true;
      };
      const label = (element) => {
        const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const cls = typeof element.className === 'string' ? element.className : element.className?.baseVal ?? '';
        return `${element.tagName.toLowerCase()}${cls ? `.${cls.split(' ')[0]}` : ''} "${text}"`;
      };
      const boxes = [];
      const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const owner = node.parentElement;
        if (!owner || !visible(owner) || owner.closest('[role="status"].river-tip, .fchart-tip, .proof-tip')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = owner instanceof SVGElement ? [owner.getBoundingClientRect()] : [...range.getClientRects()];
        for (const rect of rects) {
          if (rect.width < 2 || rect.height < 2) continue;
          boxes.push({ owner, rect });
        }
      }
      const found = new Set();
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          if (a.owner === b.owner || a.owner.contains(b.owner) || b.owner.contains(a.owner)) continue;
          const dx = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const dy = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          // Line boxes carry some leading; a few pixels of it touching is not a collision.
          if (dx > 3 && dy > Math.min(a.rect.height, b.rect.height) * 0.3) {
            found.add(`${label(a.owner)}  x  ${label(b.owner)}  (at ${Math.round(Math.max(a.rect.left, b.rect.left))},${Math.round(Math.max(a.rect.top, b.rect.top) + scrollY)})`);
          }
        }
      }
      return [...found];
    });
    if (pairs.length > 0) {
      problems += pairs.length;
      console.log(`${String(width).padStart(4)}x${height} ${name}`);
      for (const pair of pairs) console.log(`    ${pair}`);
    }
  }
  await context.close();
}

await browser.close();
console.log(problems === 0 ? 'no overlapping text found' : `${problems} overlapping pairs`);
process.exitCode = problems === 0 ? 0 : 1;
