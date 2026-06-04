#!/usr/bin/env node
/**
 * Mining redesign tests (test-first per CLAUDE.md).
 *
 * Exercises the deterministic mining-economy module that models:
 *   - 2 mining sites, each producing a different metal variant
 *   - NPC miners + the player producing metal into a site warehouse
 *   - traders + the player shipping metal from a site hub to cities for profit
 *   - rarity-based pricing (rarer metal => higher price)
 *
 * Pure + offline + browser-free, in keeping with the headless constraint.
 *
 * Usage:
 *   node ops/scripts/mining_tests.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  RARITY,
  METALS,
  MINE_SITES,
  METAL_CITY_MULTS,
  metalById,
  rarityRank,
  unitMidPrice,
  dailyProduction,
  bestRoute,
  shipProfit,
  simulateMiningEconomy,
} from './lib/mining.mjs';

import { ITEMS as WS_ITEMS, CITY_MULTS as WS_CITY_MULTS } from './world_service.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

const CITIES = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];

// ── Sites & metal variants ────────────────────────────────────────────────
console.log('\n=== mining sites & metal variants ===');

test('exactly three mining sites exist', () => {
  assert(Array.isArray(MINE_SITES), 'MINE_SITES must be an array');
  assert(MINE_SITES.length === 3, `expected 3 sites, got ${MINE_SITES.length}`);
});

test('each site produces a distinct metal variant', () => {
  const metals = MINE_SITES.map(s => s.metal);
  assert(new Set(metals).size === 3, `sites must yield 3 distinct metals, got ${metals.join(',')}`);
  for (const s of MINE_SITES) {
    assert(metalById(s.metal), `site ${s.id} references unknown metal ${s.metal}`);
    assert(typeof s.hub === 'string' && CITIES.includes(s.hub), `site ${s.id} needs a valid hub city`);
    assert(Number.isFinite(s.x) && Number.isFinite(s.y), `site ${s.id} needs map coordinates`);
    assert((s.npcMiners | 0) > 0, `site ${s.id} needs NPC miners`);
  }
});

test('every metal carries a known rarity tier and base price', () => {
  for (const m of METALS) {
    assert(RARITY[m.rarity], `metal ${m.id} has unknown rarity ${m.rarity}`);
    assert(Number.isFinite(m.base) && m.base > 0, `metal ${m.id} needs a positive base price`);
    assert(Number.isFinite(m.weight) && m.weight > 0, `metal ${m.id} needs a positive weight`);
  }
});

// ── Rarity-based pricing ──────────────────────────────────────────────────
console.log('\n=== rarity-based pricing ===');

test('three rarity tiers exist and are all populated by a metal', () => {
  assert(RARITY.common && RARITY.rare && RARITY.legendary,
    'RARITY must define common, rare, and legendary tiers');
  const tiers = new Set(METALS.map(m => m.rarity));
  for (const t of ['common', 'rare', 'legendary']) {
    assert(tiers.has(t), `no metal carries rarity tier '${t}'`);
  }
});

test('rarer metal ranks higher than common metal', () => {
  assert(rarityRank('silver') > rarityRank('copper'),
    'silver (rare) must out-rank copper (common)');
  assert(rarityRank('gold') > rarityRank('silver'),
    'gold (legendary) must out-rank silver (rare)');
});

test('rarer metal has a higher base price', () => {
  assert(metalById('silver').base > metalById('copper').base,
    `silver base (${metalById('silver').base}) must exceed copper base (${metalById('copper').base})`);
  assert(metalById('gold').base > metalById('silver').base,
    `gold base (${metalById('gold').base}) must exceed silver base (${metalById('silver').base})`);
});

test('rarer metal is dearer than common metal in every city', () => {
  for (const city of CITIES) {
    const cu = unitMidPrice('copper', city);
    const ag = unitMidPrice('silver', city);
    assert(ag > cu, `silver (${ag}) must beat copper (${cu}) in ${city}`);
  }
});

test('each metal is cheapest at its own mine hub (source) city', () => {
  for (const site of MINE_SITES) {
    const atHub = unitMidPrice(site.metal, site.hub);
    for (const city of CITIES) {
      if (city === site.hub) continue;
      assert(unitMidPrice(site.metal, city) > atHub,
        `${site.metal} should be cheapest at hub ${site.hub}; ${city} was not dearer`);
    }
  }
});

test('METAL_CITY_MULTS defines a multiplier for every metal in every city', () => {
  for (const city of CITIES) {
    assert(METAL_CITY_MULTS[city], `missing multipliers for ${city}`);
    for (const m of METALS) {
      assert(Number.isFinite(METAL_CITY_MULTS[city][m.id]),
        `missing ${m.id} multiplier for ${city}`);
    }
  }
});

// ── NPC + player production into the site warehouse ────────────────────────
console.log('\n=== production (NPC miners + player) ===');

test('daily production is deterministic for a given site/day/seed', () => {
  const site = MINE_SITES[0];
  const a = dailyProduction(site, { day: 5, seed: 3 });
  const b = dailyProduction(site, { day: 5, seed: 3 });
  assert(a === b, `production must be deterministic, got ${a} vs ${b}`);
  assert(a > 0, 'NPC miners must produce a positive amount');
});

test('the player adds to production beyond the NPC crew', () => {
  const site = MINE_SITES[0];
  const npcOnly = dailyProduction(site, { day: 5, seed: 3, playerSwings: 0 });
  const withPlayer = dailyProduction(site, { day: 5, seed: 3, playerSwings: 4 });
  assert(withPlayer > npcOnly,
    `player swings must raise output (${withPlayer} !> ${npcOnly})`);
});

test('the rarer site yields less metal per miner than the common site', () => {
  const common = MINE_SITES.find(s => metalById(s.metal).rarity === 'common');
  const rare   = MINE_SITES.find(s => metalById(s.metal).rarity === 'rare');
  const perMinerCommon = dailyProduction(common, { day: 1, seed: 1 }) / common.npcMiners;
  const perMinerRare   = dailyProduction(rare,   { day: 1, seed: 1 }) / rare.npcMiners;
  assert(perMinerCommon > perMinerRare,
    `common metal should mine faster per miner (${perMinerCommon} !> ${perMinerRare})`);
});

// ── Shipping to cities for profit (traders + player) ──────────────────────
console.log('\n=== shipping for profit ===');

test('best route ships out of the mine hub at a positive margin', () => {
  for (const site of MINE_SITES) {
    const route = bestRoute(site.metal);
    assert(route.fromId === site.hub,
      `${site.metal} should be sourced at its hub ${site.hub}, got ${route.fromId}`);
    assert(route.toId !== site.hub, 'must ship to a different city');
    assert(route.unitProfit > 0,
      `${site.metal} route must be profitable, got ${route.unitProfit}`);
  }
});

test('ship profit scales linearly with quantity', () => {
  const route = bestRoute('silver');
  const one = shipProfit('silver', 1, route.fromId, route.toId);
  const ten = shipProfit('silver', 10, route.fromId, route.toId);
  assert(ten === one * 10, `profit should scale: 10x=${ten}, 1x*10=${one * 10}`);
  assert(one > 0, 'single-unit ship should be profitable on the best route');
});

test('the rare metal earns a larger per-unit margin than the common metal', () => {
  const copper = bestRoute('copper').unitProfit;
  const silver = bestRoute('silver').unitProfit;
  assert(silver > copper, `silver margin (${silver}) should beat copper (${copper})`);
});

// ── Headless economy report (the --days N milestone shape) ─────────────────
console.log('\n=== headless economy simulation ===');

test('simulateMiningEconomy returns a JSON-serialisable report', () => {
  const report = simulateMiningEconomy({ days: 30, seed: 7 });
  const round = JSON.parse(JSON.stringify(report));
  assert(round.days === 30, 'report echoes day count');
  assert(round.seed === 7, 'report echoes seed');
  assert(typeof round.totalRevenue === 'number', 'report has numeric totalRevenue');
  for (const m of METALS) {
    assert(round.metals[m.id], `report missing metal ${m.id}`);
  }
});

test('simulation is deterministic for identical inputs', () => {
  const a = simulateMiningEconomy({ days: 45, seed: 11 });
  const b = simulateMiningEconomy({ days: 45, seed: 11 });
  assert(JSON.stringify(a) === JSON.stringify(b), 'same inputs must yield identical reports');
});

test('warehouse stock is conserved: mined = shipped + remaining', () => {
  const report = simulateMiningEconomy({ days: 30, seed: 7 });
  for (const m of METALS) {
    const row = report.metals[m.id];
    assert(row.mined === row.shipped + row.stockRemaining,
      `${m.id}: mined ${row.mined} != shipped ${row.shipped} + remaining ${row.stockRemaining}`);
    assert(row.stockRemaining >= 0, `${m.id} warehouse stock must not go negative`);
    assert(row.mined > 0, `${m.id} should be mined over 30 days`);
  }
});

test('a participating player increases total revenue', () => {
  const withoutPlayer = simulateMiningEconomy({ days: 30, seed: 7, player: null });
  const withPlayer = simulateMiningEconomy({
    days: 30, seed: 7,
    player: { minesAt: MINE_SITES[0].id, swingsPerDay: 4, shipsPerDay: 1 },
  });
  assert(withPlayer.totalRevenue > withoutPlayer.totalRevenue,
    `player participation should raise revenue (${withPlayer.totalRevenue} !> ${withoutPlayer.totalRevenue})`);
});

test('pickaxe yield multiplier scales the player share of production', () => {
  // Player at the copper site, 4 swings/day, no ships: only the mining delta differs.
  const base = simulateMiningEconomy({
    days: 30, seed: 7,
    player: { minesAt: 'coppervein_hollow', swingsPerDay: 4, shipsPerDay: 0, yieldMult: 1.0 },
  });
  const doubled = simulateMiningEconomy({
    days: 30, seed: 7,
    player: { minesAt: 'coppervein_hollow', swingsPerDay: 4, shipsPerDay: 0, yieldMult: 2.0 },
  });
  const npcOnly = simulateMiningEconomy({ days: 30, seed: 7, player: null });
  const baseDelta    = base.metals.copper.mined    - npcOnly.metals.copper.mined;
  const doubledDelta = doubled.metals.copper.mined - npcOnly.metals.copper.mined;
  assert(baseDelta > 0, `player swings must add copper output (${baseDelta})`);
  assert(doubledDelta === baseDelta * 2,
    `2x yieldMult must double player contribution: base=${baseDelta} doubled=${doubledDelta}`);
});

test('report flags that pricing is sorted by rarity', () => {
  const report = simulateMiningEconomy({ days: 10, seed: 1 });
  assert(report.rarityCheck && report.rarityCheck.raritySorted === true,
    'report should confirm prices increase with rarity');
});

// ── Three-way constant parity (mining.mjs ⇄ world_service.mjs ⇄ main.js) ────
// Prices/sites are duplicated across three files (the browser script can't
// import). economy_parity_test.mjs covers main.js⇄world_service; these cover
// mining.mjs against the other two so all copies stay in lock-step.
console.log('\n=== three-way constant parity ===');

test('metal base price + weight match world_service ITEMS', () => {
  for (const m of METALS) {
    const ws = WS_ITEMS.find(i => i.id === m.id);
    assert(ws, `world_service ITEMS missing ${m.id}`);
    assert(ws.base === m.base, `${m.id} base: mining=${m.base} world_service=${ws.base}`);
    assert(ws.weight === m.weight, `${m.id} weight: mining=${m.weight} world_service=${ws.weight}`);
  }
});

test('metal city multipliers match world_service CITY_MULTS', () => {
  for (const city of CITIES) {
    for (const m of METALS) {
      const mineMult = METAL_CITY_MULTS[city][m.id];
      const wsMult = WS_CITY_MULTS[city]?.[m.id];
      assert(mineMult === wsMult,
        `${city}.${m.id}: mining=${mineMult} world_service=${wsMult}`);
    }
  }
});

test('mine site coordinates + hubs match src/main.js', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const mainSrc = readFileSync(join(here, '../../src/main.js'), 'utf8');
  for (const site of MINE_SITES) {
    const re = new RegExp(
      `id:\\s*'${site.id}'[^}]*?metal:\\s*'([a-z]+)'[^}]*?hub:\\s*'([a-z]+)'[^}]*?x:\\s*(\\d+),\\s*y:\\s*(\\d+)`);
    const mm = mainSrc.match(re);
    assert(mm, `src/main.js MINE_SITES missing entry for ${site.id}`);
    assert(mm[1] === site.metal, `${site.id} metal: main.js=${mm[1]} mining=${site.metal}`);
    assert(mm[2] === site.hub, `${site.id} hub: main.js=${mm[2]} mining=${site.hub}`);
    assert(Number(mm[3]) === site.x && Number(mm[4]) === site.y,
      `${site.id} coords: main.js=(${mm[3]},${mm[4]}) mining=(${site.x},${site.y})`);
  }
});

// ── Headless determinism guard ────────────────────────────────────────────
console.log('\n=== headless constraint ===');

test('mining module contains no wall-clock or nondeterministic calls', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'lib/mining.mjs'), 'utf8');
  assert(!/Date\.now\s*\(/.test(src), 'mining.mjs must not use Date.now()');
  assert(!/Math\.random\s*\(/.test(src), 'mining.mjs must not use Math.random()');
});

// ───────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
