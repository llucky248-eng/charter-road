#!/usr/bin/env node
/**
 * Lightweight self-test runner.
 *
 * Usage:
 *   node ops/scripts/qa_selftest.mjs [url]
 *
 * Default URL:
 *   http://127.0.0.1:8080/?qa=1
 */

import { chromium, devices } from 'playwright';

function die(msg) {
  console.error('QA_FAIL:', msg);
  process.exit(1);
}

const url = process.argv[2] || 'http://127.0.0.1:8080/?qa=1';

async function runOnce({ name, contextOptions }) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && (e.stack || e.message) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for the QA harness to report pass/fail.
  const result = await page.waitForFunction(() => {
    // @ts-ignore
    return window.__QA && window.__QA.status && (window.__QA.status === 'pass' || window.__QA.status === 'fail');
  }, { timeout: 30_000 }).then(() => page.evaluate(() => {
    // @ts-ignore
    return window.__QA;
  }));

  await browser.close();

  if (!result || result.status !== 'pass') {
    const msg = result?.details || 'unknown failure';
    die(`${name}: ${msg}`);
  }
  if (errors.length) {
    // Non-fatal console noise can be normal, but for QA we treat it as a failure.
    die(`${name}: console/page errors:\n- ${errors.join('\n- ')}`);
  }

  console.log('QA_PASS:', name);
}

(async () => {
  // Desktop
  await runOnce({
    name: 'desktop',
    contextOptions: { viewport: { width: 1280, height: 720 } },
  });

  // Mobile emulation (iPhone 12)
  await runOnce({
    name: 'mobile-iphone',
    contextOptions: { ...devices['iPhone 12'] },
  });

  console.log('QA_PASS: all');
})();
