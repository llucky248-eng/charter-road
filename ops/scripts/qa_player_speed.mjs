#!/usr/bin/env node
/**
 * QA: Player click-move speed test.
 *
 * Verifies that after a click-move:
 *   1. Player moves at roughly the configured speed (px/sec)
 *   2. Player is faster than the fastest AI trader (85 px/sec)
 *   3. Speed is not wildly over the configured value (no teleporting)
 *
 * Usage:
 *   node ops/scripts/qa_player_speed.mjs [url]
 */

import { chromium } from 'playwright';

const EXPECTED_SPEED = 90;       // px/sec (must match src/main.js player.speed)
const TRADER_MAX_SPEED = 85;     // fastest AI trader (Wren the Swift)
const TOLERANCE = 0.20;          // ±20% acceptable deviation
const MIN_SPEED = EXPECTED_SPEED * (1 - TOLERANCE);
const MAX_SPEED = EXPECTED_SPEED * (1 + TOLERANCE);
const MEASURE_FRAMES = 60;       // frames to measure over (1s @ 60fps — larger window smooths snap jumps)

function die(msg) { console.error('QA_FAIL:', msg); process.exit(1); }

const url = process.argv[2] || process.env.QA_URL || 'http://127.0.0.1:8080/?qa=1';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on('pageerror', e => errors.push(String(e?.stack || e?.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__QA && typeof window.__QA.api?.teleportToCity === 'function', { timeout: 30_000 });

  const result = await page.evaluate(({ frames, expectedSpeed, traderMax, minS, maxS }) => {
    const api = window.__QA.api;
    const TILE = 16;

    api.teleportToCity('valdenmere');
    api.step(1/60);

    const info = api.getCityInfo('valdenmere');
    const start = api.getPlayerPos();

    // Click toward bottom-right — known walkable area from city-walk QA
    const targetX = (info.x + info.w - 4) * TILE;
    const targetY = (info.y + info.h - 4) * TILE;
    api.setClickMove(targetX, targetY);

    // Measure per-frame speeds; use median to exclude waypoint-snap teleport jumps
    api.step(1/60);
    const frameSpeeds = [];
    let prev = api.getPlayerPos();
    for (let i = 0; i < frames; i++) {
      api.step(1/60);
      const cur = api.getPlayerPos();
      const d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      frameSpeeds.push(d * 60); // convert px/frame → px/sec
      prev = cur;
    }
    // Filter out snap-teleport frames (waypoint center snapping causes 1-frame
    // jumps of ~960 px/sec). Keep only frames where the player is genuinely walking.
    const MAX_SNAP = expectedSpeed * 1.5;
    const walkFrames = frameSpeeds.filter(v => v > 1 && v <= MAX_SNAP);
    if (walkFrames.length === 0) return { measuredSpeed: 0, frameSpeeds, expectedSpeed, traderMax, minS, maxS, fasterThanTrader: false, withinTolerance: false };
    walkFrames.sort((a, b) => a - b);
    const lo = Math.floor(walkFrames.length * 0.1);
    const hi = Math.ceil(walkFrames.length * 0.9);
    const trimmed = walkFrames.slice(lo, hi);
    const measuredSpeed = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;

    return {
      start,
      frameSpeeds: frameSpeeds.map(v => Math.round(v)),
      measuredSpeed: Math.round(measuredSpeed * 10) / 10,
      expectedSpeed,
      traderMax,
      minS: Math.round(minS),
      maxS: Math.round(maxS),
      fasterThanTrader: measuredSpeed > traderMax,
      withinTolerance: measuredSpeed >= minS && measuredSpeed <= maxS,
    };
  }, { frames: MEASURE_FRAMES, expectedSpeed: EXPECTED_SPEED, traderMax: TRADER_MAX_SPEED, minS: MIN_SPEED, maxS: MAX_SPEED });


  console.log(`Player speed (median): ${result.measuredSpeed} px/sec`);
  console.log(`Expected: ${result.expectedSpeed} ±20% (${result.minS}–${result.maxS} px/sec)`);
  console.log(`Fastest AI trader: ${result.traderMax} px/sec`);
  console.log(`Faster than AI trader: ${result.fasterThanTrader ? 'YES ✓' : 'NO ✗'}`);
  console.log(`Within tolerance:     ${result.withinTolerance ? 'YES ✓' : 'NO ✗'}`);

  if (!result.fasterThanTrader) {
    die(`Player (${result.measuredSpeed} px/sec) is not faster than AI traders (${result.traderMax} px/sec)`);
  }
  if (!result.withinTolerance) {
    die(`Player speed ${result.measuredSpeed} px/sec outside expected range ${result.minS}–${result.maxS}`);
  }

  await browser.close();
  if (errors.length) die(`JS errors:\n- ${errors.join('\n- ')}`);

  console.log('QA_PASS: player-speed');
})();
