#!/usr/bin/env node
/**
 * Tests for the autonomous player-simulation brain (ops/scripts/lib/player_ai.mjs).
 *
 * These cover the PURE, browser-free half of the player-sim harness:
 *   - decideAction(obs): the human-like "what would a player do next" policy.
 *   - detectStuck / detectBalance / detectQoL: issue detectors over a history buffer.
 *
 * The Playwright driver (qa_player_sim.mjs) drives the real game through
 * window.__QA.api and feeds it observations + this policy; here we test the
 * decision/detection logic in isolation so it can run offline in `npm test`.
 *
 * Usage: node ops/scripts/player_sim_tests.mjs
 */

import {
  decideAction,
  detectStuck,
  detectBalance,
  detectQoL,
  runDetectors,
  cargoWeight,
  totalUnits,
  CITIES,
} from './lib/player_ai.mjs';

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
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function hasFinding(findings, category, code) {
  return findings.some(f => f.category === category && (!code || f.code === code));
}

// ── Fixtures ────────────────────────────────────────────────────────────────

// A small two-city price book: grain is cheap in valdenmere, dear in ashport.
function twoCityPrices() {
  return {
    valdenmere: { grain: { buy: 10, sell: 9 }, relic: { buy: 70, sell: 66 } },
    ashport:    { grain: { buy: 22, sell: 20 }, relic: { buy: 60, sell: 55 } },
  };
}

function baseObs(over = {}) {
  return {
    cityId: 'valdenmere',
    gold: 220,
    capacity: 18,
    inv: {},
    gear: { pack: 0, boots: 0, tool: 0, pickaxe: 0 },
    prices: twoCityPrices(),
    reachableMines: 2,
    visibleContracts: [],
    modal: { event: false, dismissable: true },
    ...over,
  };
}

// A history entry the detectors consume.
function entry(over = {}) {
  return {
    step: 0,
    day: 1,
    pos: { x: 100, y: 100 },
    gold: 200,
    cargoUnits: 0,
    cargoWeight: 0,
    reachableMines: 2,
    cheapestBuy: 10,
    navActive: false,
    action: { type: 'idle' },
    actionOk: true,
    modalEvent: false,
    modalDismissable: true,
    ...over,
  };
}

// ── decideAction ──────────────────────────────────────────────────────────────
console.log('\ndecideAction');

test('buys the best-margin affordable item when pack is empty', () => {
  const a = decideAction(baseObs());
  assertEqual(a.type, 'buy');
  assertEqual(a.item, 'grain', 'grain has the positive cross-city margin here');
  assert(a.qty > 0, 'should buy a positive quantity');
});

test('does not buy an item it cannot afford', () => {
  // Only 5 gold: grain buy is 10, so nothing affordable, pack empty, mines reachable → mine.
  const a = decideAction(baseObs({ gold: 5 }));
  assertEqual(a.type, 'mine');
});

test('sells cargo when the current city is the best market', () => {
  // Holding grain in ashport (its dearest market) → sell here.
  const a = decideAction(baseObs({ cityId: 'ashport', inv: { grain: 5 } }));
  assertEqual(a.type, 'sell');
  assertEqual(a.item, 'grain');
});

test('travels to the better market when holding cargo elsewhere', () => {
  // Holding grain in valdenmere; ashport sells grain higher → travel to ashport.
  const a = decideAction(baseObs({ cityId: 'valdenmere', inv: { grain: 5 } }));
  assertEqual(a.type, 'travel');
  assertEqual(a.to, 'ashport');
});

test('mines to recover when broke and empty with a reachable vein', () => {
  const a = decideAction(baseObs({ gold: 0, inv: {}, reachableMines: 1 }));
  assertEqual(a.type, 'mine');
});

test('idles (stuck) when broke, empty, and no vein is reachable', () => {
  const a = decideAction(baseObs({ gold: 0, inv: {}, reachableMines: 0 }));
  assertEqual(a.type, 'idle');
});

test('resolves an open event modal before anything else', () => {
  const a = decideAction(baseObs({ modal: { event: true, dismissable: false } }));
  assertEqual(a.type, 'resolveEvent');
});

test('respects cargo capacity when sizing a buy', () => {
  // relic weighs 2; capacity 4 → at most 2 units regardless of gold.
  const prices = { valdenmere: { relic: { buy: 5, sell: 9 } }, ashport: { relic: { buy: 20, sell: 40 } } };
  // Own all gear so the gear-buy branch is skipped and the buy is purely capacity-bound.
  const a = decideAction(baseObs({ gold: 1000, capacity: 4, prices, inv: {}, gear: { pack: 3, boots: 2, tool: 2, pickaxe: 0 } }));
  assertEqual(a.type, 'buy');
  assertEqual(a.item, 'relic');
  assert(a.qty <= 2, `capacity 4 / weight 2 caps qty at 2, got ${a.qty}`);
});

// ── helpers ────────────────────────────────────────────────────────────────
console.log('\nhelpers');

test('totalUnits counts inventory items', () => {
  assertEqual(totalUnits({ grain: 3, relic: 2 }), 5);
  assertEqual(totalUnits({}), 0);
});

test('cargoWeight weights by item', () => {
  // grain weight 1, relic weight 2
  assertEqual(cargoWeight({ grain: 3, relic: 2 }), 3 * 1 + 2 * 2);
});

test('CITIES lists the four cities', () => {
  assertEqual(CITIES.length, 4);
  assert(CITIES.includes('valdenmere') && CITIES.includes('ironholt'));
});

// ── detectStuck ──────────────────────────────────────────────────────────────
console.log('\ndetectStuck');

test('flags economic softlock: broke + empty + no reachable mine', () => {
  const h = [entry({ gold: 3, cargoUnits: 0, reachableMines: 0, cheapestBuy: 10 })];
  const f = detectStuck(h);
  assert(hasFinding(f, 'stuck', 'economic-softlock'), 'should flag economic softlock');
  assert(f.some(x => x.severity === 'high'), 'economic softlock is high severity');
});

test('does NOT flag softlock when a mine is reachable', () => {
  const h = [entry({ gold: 3, cargoUnits: 0, reachableMines: 2, cheapestBuy: 10 })];
  assert(!hasFinding(detectStuck(h), 'stuck', 'economic-softlock'));
});

test('flags a frozen position while navigation is active', () => {
  const h = [];
  for (let i = 0; i < 40; i++) h.push(entry({ step: i, navActive: true, pos: { x: 100, y: 100 } }));
  assert(hasFinding(detectStuck(h), 'stuck', 'movement-frozen'), 'frozen nav should flag');
});

test('does NOT flag movement when the player is actually moving', () => {
  const h = [];
  for (let i = 0; i < 40; i++) h.push(entry({ step: i, navActive: true, pos: { x: 100 + i * 5, y: 100 } }));
  assert(!hasFinding(detectStuck(h), 'stuck', 'movement-frozen'));
});

// ── detectBalance ─────────────────────────────────────────────────────────────
console.log('\ndetectBalance');

test('flags a negative-gold invariant breach as high severity', () => {
  const h = [entry({ gold: 50 }), entry({ gold: -3 })];
  const f = detectBalance(h);
  assert(hasFinding(f, 'balance', 'negative-gold'));
  assert(f.some(x => x.code === 'negative-gold' && x.severity === 'high'));
});

test('flags runaway wealth (economy too trivial)', () => {
  // ~1000g/day sustained over 10 days → far above the runaway cap.
  const h = [];
  for (let i = 0; i <= 10; i++) h.push(entry({ step: i, day: 1 + i, gold: 200 + i * 1000 }));
  assert(hasFinding(detectBalance(h), 'balance', 'runaway-wealth'));
});

test('does NOT flag a healthy, gradual gold curve', () => {
  const h = [];
  for (let i = 0; i <= 10; i++) h.push(entry({ step: i, day: 1 + i, gold: 200 + i * 30 }));
  const f = detectBalance(h);
  assert(!hasFinding(f, 'balance', 'runaway-wealth'));
  assert(!hasFinding(f, 'balance', 'negative-gold'));
});

// ── detectQoL ────────────────────────────────────────────────────────────────
console.log('\ndetectQoL');

test('flags a repeated failing action (dead-click loop)', () => {
  const h = [];
  for (let i = 0; i < 6; i++) h.push(entry({ step: i, action: { type: 'buy', item: 'grain' }, actionOk: false }));
  assert(hasFinding(detectQoL(h), 'qol', 'repeated-failure'));
});

test('does NOT flag when actions are succeeding', () => {
  const h = [];
  for (let i = 0; i < 6; i++) h.push(entry({ step: i, action: { type: 'buy', item: 'grain' }, actionOk: true }));
  assert(!hasFinding(detectQoL(h), 'qol', 'repeated-failure'));
});

test('flags a modal that stays open across many steps (trap)', () => {
  const h = [];
  for (let i = 0; i < 20; i++) h.push(entry({ step: i, modalEvent: true, modalDismissable: false }));
  assert(hasFinding(detectQoL(h), 'qol', 'modal-stuck'));
});

// ── runDetectors aggregates + dedupes ─────────────────────────────────────────
console.log('\nrunDetectors');

test('runDetectors returns findings from all categories, deduped by code', () => {
  const h = [];
  for (let i = 0; i < 40; i++) {
    h.push(entry({ step: i, navActive: true, pos: { x: 100, y: 100 }, gold: -1, reachableMines: 0, cargoUnits: 0, cheapestBuy: 10 }));
  }
  const f = runDetectors(h);
  assert(hasFinding(f, 'stuck'));
  assert(hasFinding(f, 'balance', 'negative-gold'));
  // Deduped: negative-gold should appear once even though every entry breaches it.
  assertEqual(f.filter(x => x.code === 'negative-gold').length, 1, 'findings should dedupe by code');
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
