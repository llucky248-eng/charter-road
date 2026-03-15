#!/usr/bin/env node
/**
 * QA: Random click-to-move inside a city.
 *
 * Teleports the player to a city, then performs several random click-moves
 * within the city bounds, verifying that:
 *   1. The clickMove becomes active after each setClickMove call.
 *   2. The player position actually changes after walkSteps().
 *   3. The player stays roughly within the city bounds (±2 tiles padding).
 *   4. No JS errors occur during movement.
 *
 * Usage:
 *   node ops/scripts/qa_city_walk.mjs [url]
 *
 * Default URL:
 *   http://127.0.0.1:8080/?qa=1
 */

import { chromium } from 'playwright';

const CITIES   = ['valdenmere', 'ashport'];
const CLICKS   = 6;      // random click-moves per city
const STEPS    = 90;     // sim steps per click (1.5 s @ 60 fps)
const TILE     = 16;     // desktop tile size

function die(msg) {
  console.error('QA_FAIL:', msg);
  process.exit(1);
}

const url = process.argv[2] || process.env.QA_URL || 'http://127.0.0.1:8080/?qa=1';

async function testCityWalk(page, cityId) {
  // Teleport player into city and get its bounds.
  const info = await page.evaluate((cId) => {
    const api = window.__QA.api;
    api.teleportToCity(cId);
    api.step(1 / 60);          // flush enter logic
    return api.getCityInfo(cId);
  }, cityId);

  if (!info) die(`getCityInfo returned null for city: ${cityId}`);

  const { x: cx, y: cy, w: cw, h: ch } = info;
  // World pixel bounds (with 2-tile inner padding so clicks land on floor)
  const pad   = 2;
  const minWx = (cx + pad) * TILE;
  const maxWx = (cx + cw - pad) * TILE;
  const minWy = (cy + pad) * TILE;
  const maxWy = (cy + ch - pad) * TILE;

  // Deterministic "random" positions spread across city interior
  const targets = Array.from({ length: CLICKS }, (_, i) => {
    const t = (i + 1) / (CLICKS + 1);
    const u = ((i * 3 + 1) % (CLICKS + 1)) / (CLICKS + 1);
    return {
      wx: Math.round(minWx + t * (maxWx - minWx)),
      wy: Math.round(minWy + u * (maxWy - minWy)),
    };
  });

  for (let i = 0; i < targets.length; i++) {
    const { wx, wy } = targets[i];

    const result = await page.evaluate(
      ({ wx, wy, steps }) => {
        const api = window.__QA.api;
        const before = api.getPlayerPos();
        api.setClickMove(wx, wy);
        const cmActive = api.getClickMove().active;
        const after = api.walkSteps(steps);
        return { before, cmActive, after };
      },
      { wx, wy, steps: STEPS }
    );

    const { before, cmActive, after } = result;

    // 1. clickMove must have become active
    if (!cmActive) {
      die(`[${cityId}] click #${i+1}: clickMove not active after setClickMove(${wx},${wy})`);
    }

    // 2. Player must have moved (at least 1 px in some direction)
    const dx = Math.abs(after.x - before.x);
    const dy = Math.abs(after.y - before.y);
    if (dx + dy < 1) {
      die(`[${cityId}] click #${i+1}: player did not move (before=${JSON.stringify(before)}, after=${JSON.stringify(after)})`);
    }

    // 3. Player must remain within loose city bounds (allow 3-tile overshoot for
    //    gate/border tiles that are technically just outside the city rect)
    const border = 3 * TILE;
    const cityMinWx = (cx - border / TILE) * TILE;
    const cityMaxWx = (cx + cw + border / TILE) * TILE;
    const cityMinWy = (cy - border / TILE) * TILE;
    const cityMaxWy = (cy + ch + border / TILE) * TILE;
    if (
      after.x < cityMinWx || after.x > cityMaxWx ||
      after.y < cityMinWy || after.y > cityMaxWy
    ) {
      die(`[${cityId}] click #${i+1}: player escaped city bounds (pos=${JSON.stringify(after)}, city bounds x:${cityMinWx}–${cityMaxWx} y:${cityMinWy}–${cityMaxWy})`);
    }

    console.log(`  ✓ [${cityId}] click ${i+1}/${CLICKS}: (${wx},${wy}) moved Δ(${dx.toFixed(0)},${dy.toFixed(0)})`);
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page    = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.stack || e?.message || e)));
  page.on('console',  (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for QA harness to be ready
  await page.waitForFunction(() => window.__QA && typeof window.__QA.api?.teleportToCity === 'function', {
    timeout: 30_000,
  });

  for (const cityId of CITIES) {
    await testCityWalk(page, cityId);
    console.log(`QA_PASS: city-walk [${cityId}]`);
  }

  await browser.close();

  if (errors.length) {
    die(`JS errors during test:\n- ${errors.join('\n- ')}`);
  }

  console.log('QA_PASS: city-random-walk');
})();
