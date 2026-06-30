#!/usr/bin/env node
/**
 * End-to-end screenshot validation for the loot pickup popup AND every mine
 * site on the map. Boots the local server, opens the game with the QA
 * harness, then for each of the three mine sites (copper, silver, gold)
 * teleports the player onto a vein, triggers a swing, and captures a series
 * of screenshots over the popup's lifetime so a human reviewer can confirm
 * the sprite paints and each mine reads correctly on screen.
 *
 *   ops/screenshots/loot_popup/
 *     desktop_<metal>_baseline.png  - frame before the swing (no popup)
 *     desktop_<metal>_t0.png        - popup just spawned (full alpha, low yOff)
 *     desktop_<metal>_t500.png      - 500ms in
 *     desktop_<metal>_t1000.png     - 1000ms in
 *     desktop_<metal>_t1400.png     - 1400ms in (~93% rise, ~13% alpha)
 *     desktop_<metal>_expired.png   - past LIFETIME_MS, popup gone
 *     mobile_<metal>_*.png          - same series at iPhone 12 viewport
 *
 *   <metal> ∈ { copper, silver, gold }
 *
 *   copper → Coppervein Hollow (Crosshaven hub, south-center)
 *   silver → Argent Reach       (Ironholt hub,   TOP-RIGHT)
 *   gold   → Sunwell Shaft      (Valdenmere hub, top-left, needs Pickaxe T2)
 *
 * Usage:
 *   node ops/scripts/qa_popup_screenshot.mjs            # spins up local server
 *   QA_URL=http://localhost:8080 node ops/scripts/qa_popup_screenshot.mjs
 *
 * Exits non-zero if the QA harness fails or any site's popup never appears
 * in the queue after a swing (regression guard, in addition to visual proof).
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

// Pickaxe tier needed to mine each metal. Gold's ITEMS entry sets
// minPickaxeTier=2; copper/silver are unrestricted so T0 is fine.
const METAL_PICKAXE_TIER = { copper: 0, silver: 0, gold: 2 };
const METALS = ['copper', 'silver', 'gold'];

function die(msg) {
  console.error('POPUP_SHOT_FAIL:', msg);
  process.exit(1);
}

function info(...args) { console.log('[popup-shot]', ...args); }

/**
 * Drive one (viewport, metal) screenshot series.
 *
 * Per-site setup resets stamina + cargo + cooldown so an earlier QA selftest
 * pass can't leave residual state that blocks the swing. The pickaxe tier
 * is bumped to the metal's minimum (T0 for copper/silver, T2 for gold), then
 * the player is teleported onto a tagged vein of that metal.
 */
async function captureSeries(page, { viewportName, metal }) {
  const tier = METAL_PICKAXE_TIER[metal];
  const tag = `${viewportName}_${metal}`;
  info(`--- ${tag} (pickaxe T${tier}) ---`);

  const setup = await page.evaluate(({ metal, tier }) => {
    const api = window.__QA.api;
    api.qaClearLootPopups();
    api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0, pickaxe: tier } });
    api.setPlayer({ capacity: 999, inv: {} });
    api.qaSetStamina(100);
    api.qaResetMineCooldowns();
    const node = api.qaMineSiteNodeAt(metal);
    if (!node) return { ok: false, err: `no ${metal} vein` };
    api.teleportToTile(node.tx, node.ty);
    return { ok: true, node, constants: api.qaLootPopupConsts() };
  }, { metal, tier });
  if (!setup.ok) die(`${tag}: setup failed: ${setup.err}`);
  info(`${metal} vein at (${setup.node.tx}, ${setup.node.ty}); LIFETIME=${setup.constants.lifetimeMs}ms`);

  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${tag}_baseline.png`, fullPage: false });
  info(`saved ${tag}_baseline.png`);

  const swing = await page.evaluate(({ metal }) => {
    const api = window.__QA.api;
    api.qaClearLootPopups();
    const node = api.qaMineSiteNodeAt(metal);
    const ok = api.qaPlayerMine(node.tx, node.ty);
    return { ok, popups: api.qaLootPopups() };
  }, { metal });
  if (!swing.ok) die(`${tag}: ${metal} swing returned false (validate stamina/cargo/cooldown/pickaxe)`);
  if (!swing.popups.length) die(`${tag}: swing landed but loot popup queue is empty`);
  info(`swing OK; popup queue: ${JSON.stringify(swing.popups)}`);

  const frames = [
    { tag: 't0',      ageTargetMs:   60 },
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
      const steps = Math.max(1, Math.round(deltaMs / (1000 / 60)));
      await page.evaluate((n) => {
        for (let i = 0; i < n; i++) window.__QA.api.step(1/60);
      }, steps);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/${tag}_${f.tag}.png`, fullPage: false });
    const q = await page.evaluate(() => window.__QA.api.qaLootPopups());
    info(`${tag}_${f.tag}.png saved; queue=${q.length}`);
    if (f.tag === 't0' && q.length === 0) {
      die(`${tag}: popup vanished from queue at t=60ms — render is pruning too aggressively`);
    }
    if (f.tag === 'expired' && q.length !== 0) {
      die(`${tag}: popup still in queue at t=${f.ageTargetMs}ms — past LIFETIME=${setup.constants.lifetimeMs} should be empty (got ${q.length})`);
    }
  }
}

/**
 * Boot a viewport, wait for the QA harness, then run captureSeries for every
 * mine site. The page is reused across metals so we don't reload between
 * sites — the per-metal setup() above resets all the state we care about.
 */
async function runViewport(browser, { viewportName, contextOptions }) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${viewportName}] pageerror:`, e?.message || e));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__QA && (window.__QA.status === 'pass' || window.__QA.status === 'fail'),
    { timeout: 30_000 },
  );
  const qa = await page.evaluate(() => ({ status: window.__QA.status, details: window.__QA.details }));
  if (qa.status !== 'pass') die(`${viewportName}: QA harness failed before screenshots: ${qa.details}`);

  for (const metal of METALS) {
    await captureSeries(page, { viewportName, metal });
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
    await runViewport(browser, {
      viewportName: 'desktop',
      contextOptions: { viewport: { width: 1280, height: 720 } },
    });
    await runViewport(browser, {
      viewportName: 'mobile',
      contextOptions: { ...devices['iPhone 12'] },
    });
  } finally {
    await browser.close();
    if (server) server.close();
  }

  console.log('');
  console.log(`Screenshots saved to ${SCREENSHOTS_DIR}`);
  console.log('Compare *_baseline (no popup) ↔ *_t0 (popup at full alpha) ↔ *_expired (popup gone) to confirm the sprite renders for each metal.');
  console.log('Top-right mine is silver (Argent Reach near Ironholt) — look at desktop_silver_*.png and mobile_silver_*.png.');
}

main().catch((e) => die(e?.stack || e?.message || String(e)));
