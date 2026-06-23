#!/usr/bin/env node
/**
 * End-to-end screenshot validation for the loot pickup popup.
 *
 * Boots the local server, opens the game with the QA harness, teleports the
 * player onto a copper vein, triggers a swing, and captures a series of
 * screenshots over the popup's lifetime so the actual rendered sprite is
 * visible to a human reviewer:
 *
 *   ops/screenshots/loot_popup/
 *     desktop_baseline.png       - frame before the swing (no popup)
 *     desktop_t0.png             - popup just spawned (full alpha, low yOff)
 *     desktop_t750.png           - popup at mid-life  (~50% rise, ~75% alpha)
 *     desktop_t1400.png          - popup near expiry  (~95% rise, ~10% alpha)
 *     desktop_expired.png        - past LIFETIME_MS, popup gone
 *     mobile_t0.png              - same series at iPhone 12 viewport
 *     mobile_t750.png
 *
 * Also crops each frame around the player so the popup is easy to inspect.
 *
 * Usage:
 *   node ops/scripts/qa_popup_screenshot.mjs            # spins up local server
 *   QA_URL=http://localhost:8080 node ops/scripts/qa_popup_screenshot.mjs
 *
 * Exits non-zero if the QA harness fails or no popup ever appears in the
 * queue after a swing (regression guard, in addition to the visual proof).
 */

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { startServer } from './lib/static_server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCREENSHOTS_DIR = resolve(PROJECT_ROOT, 'ops/screenshots/loot_popup');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const PORT = Number(process.env.PORT) || 8081;
const externalUrl = process.argv[2] || process.env.QA_URL;
const url = externalUrl || `http://127.0.0.1:${PORT}/?qa=1`;

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const launchOptions = isRoot ? { args: ['--no-sandbox'] } : {};

function die(msg) {
  console.error('POPUP_SHOT_FAIL:', msg);
  process.exit(1);
}

function info(...args) { console.log('[popup-shot]', ...args); }

/**
 * Drive one viewport's full screenshot series.
 * Returns { popupCount, sx, sy, viewW, viewH } so the caller can also assert
 * the popup actually exists in the queue (regression guard, not just visual).
 */
async function captureSeries(browser, { name, contextOptions }) {
  info(`--- ${name} ---`);
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] pageerror:`, e?.message || e));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for the self-test harness to declare ready.
  await page.waitForFunction(
    () => window.__QA && (window.__QA.status === 'pass' || window.__QA.status === 'fail'),
    { timeout: 30_000 },
  );
  const qa = await page.evaluate(() => ({ status: window.__QA.status, details: window.__QA.details }));
  if (qa.status !== 'pass') die(`${name}: QA harness failed before screenshots: ${qa.details}`);

  // Stage the player on a copper vein with full stamina + cargo headroom.
  // Earlier QA selftest passes may have set a cooldown on the first copper
  // tile and accumulated inventory; reset both so the swing always lands.
  const setup = await page.evaluate(() => {
    const api = window.__QA.api;
    api.qaClearLootPopups();
    api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0, pickaxe: 0 } });
    api.setPlayer({ capacity: 999, inv: {} });
    api.qaSetStamina(100);
    api.qaResetMineCooldowns();
    const node = api.qaMineSiteNodeAt('copper');
    if (!node) return { ok: false, err: 'no copper vein' };
    api.teleportToTile(node.tx, node.ty);
    return { ok: true, node, constants: api.qaLootPopupConsts() };
  });
  if (!setup.ok) die(`${name}: setup failed: ${setup.err}`);
  info(`copper vein at (${setup.node.tx}, ${setup.node.ty}); LIFETIME=${setup.constants.lifetimeMs}ms`);

  // Baseline: no popup yet.
  await page.screenshot({
    path: `${SCREENSHOTS_DIR}/${name}_baseline.png`,
    fullPage: false,
  });
  info(`saved ${name}_baseline.png`);

  // Fire the swing. In QA mode the yield is synchronous so the popup is
  // queued before the screenshot tap.
  const swing = await page.evaluate(() => {
    const api = window.__QA.api;
    api.qaClearLootPopups();
    const node = api.qaMineSiteNodeAt('copper');
    const ok = api.qaPlayerMine(node.tx, node.ty);
    return { ok, popups: api.qaLootPopups() };
  });
  if (!swing.ok) die(`${name}: copper swing returned false (validate stamina/cargo/cooldown)`);
  if (!swing.popups.length) die(`${name}: swing landed but loot popup queue is empty`);
  info(`swing OK; popup queue: ${JSON.stringify(swing.popups)}`);

  // Capture lifecycle frames. We can't directly control rAF time, but the
  // popup ages off stateTime which we advance via api.step() — the render
  // pass under window.requestAnimationFrame consumes the current stateTime
  // each frame, so stepping advances the visible age.
  const frames = [
    { tag: 't0',      ageTargetMs:   60 },  // ~3 frames in
    { tag: 't500',    ageTargetMs:  500 },
    { tag: 't1000',   ageTargetMs: 1000 },
    { tag: 't1400',   ageTargetMs: 1400 },
    { tag: 'expired', ageTargetMs: setup.constants.lifetimeMs + 200 },
  ];
  let prevAge = 0;
  for (const f of frames) {
    const deltaMs = f.ageTargetMs - prevAge;
    prevAge = f.ageTargetMs;
    if (deltaMs > 0) {
      // Step ~deltaMs of game time in 1/60s increments so animation is smooth.
      const steps = Math.max(1, Math.round(deltaMs / (1000 / 60)));
      await page.evaluate((n) => {
        for (let i = 0; i < n; i++) window.__QA.api.step(1/60);
      }, steps);
    }
    // One real animation frame so the canvas reflects the new stateTime.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/${name}_${f.tag}.png`,
      fullPage: false,
    });
    const q = await page.evaluate(() => window.__QA.api.qaLootPopups());
    info(`${name}_${f.tag}.png saved; queue=${q.length}`);
    if (f.tag === 't0' && q.length === 0) {
      die(`${name}: popup vanished from queue at t=60ms — render is pruning too aggressively`);
    }
    if (f.tag === 'expired' && q.length !== 0) {
      die(`${name}: popup still in queue at t=${f.ageTargetMs}ms — past LIFETIME=${setup.constants.lifetimeMs} should be empty (got ${q.length})`);
    }
  }

  await context.close();
}

let server;
async function main() {
  if (!externalUrl) {
    server = await startServer(PROJECT_ROOT, PORT);
    info(`local server listening on http://127.0.0.1:${PORT}/`);
  } else {
    info(`using external URL ${externalUrl}`);
  }

  const browser = await chromium.launch(launchOptions);
  try {
    await captureSeries(browser, {
      name: 'desktop',
      contextOptions: { viewport: { width: 1280, height: 720 } },
    });
    await captureSeries(browser, {
      name: 'mobile',
      contextOptions: { ...devices['iPhone 12'] },
    });
  } finally {
    await browser.close();
    if (server) server.close();
  }

  console.log('');
  console.log(`Screenshots saved to ${SCREENSHOTS_DIR}`);
  console.log('Compare *_baseline (no popup) ↔ *_t0 (popup at full alpha) ↔ *_expired (popup gone) to confirm the sprite renders.');
}

main().catch((e) => die(e?.stack || e?.message || String(e)));
