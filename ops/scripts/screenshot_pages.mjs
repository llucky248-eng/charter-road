#!/usr/bin/env node
/**
 * Screenshot test (best-effort) for validation.
 *
 * - Takes desktop + mobile screenshots of GitHub Pages.
 * - Requires Playwright to be available.
 *
 * Usage:
 *   node ops/scripts/screenshot_pages.mjs v0.0.68
 *
 * Output:
 *   ops/artifacts/<version>/pages-desktop.png
 *   ops/artifacts/<version>/pages-mobile.png
 */

import fs from 'node:fs';
import path from 'node:path';

function die(msg) {
  console.error('ERROR:', msg);
  process.exit(1);
}

const verArg = process.argv[2];
if (!verArg) die('Usage: node ops/scripts/screenshot_pages.mjs v0.0.68');
const v = verArg.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(v)) die('Version must look like v0.0.68');

const url = `https://llucky248-eng.github.io/charter-road/?v=${v}`;
const outDir = path.resolve('ops', 'artifacts', `v${v}`);
fs.mkdirSync(outDir, { recursive: true });

let chromium;
let devices;
try {
  ({ chromium, devices } = await import('playwright'));
} catch (e) {
  console.error('Playwright not available. To enable automated screenshots:');
  console.error('  npm i -D playwright && npx playwright install chromium');
  console.error('Then re-run this command.');
  process.exit(2);
}

async function shotDesktop() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'pages-desktop.png'), fullPage: true });
  await browser.close();
}

async function shotMobile() {
  const iPhone = devices['iPhone 14'];
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...iPhone });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'pages-mobile.png'), fullPage: true });
  await browser.close();
}

await shotDesktop();
await shotMobile();

console.log('OK: screenshots saved');
console.log(outDir);
console.log(url);
