#!/usr/bin/env node
/**
 * AI trader tests — determinism + one shared route-picker.
 *
 * The trader brain lives in src/sim/trader_core.js and is used by both the
 * server ticker (world_service.mjs) and the browser's offline fallback
 * (src/main.js). These tests pin three things:
 *   1. trader decisions are a pure function of state (seeded RNG, time passed in),
 *   2. a whole multi-day run of tickTrader replays identically,
 *   3. there is exactly one copy of the route-picking logic.
 *
 * Fully offline, no browser.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// Run fn with Math.random, Date.now and argless `new Date()` booby-trapped, so any
// hidden wall-clock or unseeded randomness inside trader logic fails the test.
function withNoClock(fn) {
  const RealDate = Date;
  const realRandom = Math.random;
  class TrapDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) throw new Error('new Date() called inside trader logic');
      super(...args);
    }
    static now() { throw new Error('Date.now() called inside trader logic'); }
  }
  Math.random = () => { throw new Error('Math.random() called inside trader logic'); };
  globalThis.Date = TrapDate;
  try { return fn(); }
  finally { Math.random = realRandom; globalThis.Date = RealDate; }
}

const core = await import('../../src/sim/trader_core.js');
const ws = await import('./world_service.mjs');

// ── Seeded RNG ──────────────────────────────────────────────────────────────
console.log('\ntrader_core: seeded RNG');

test('makeRng replays the same sequence for the same seed', () => {
  const a = core.makeRng(42), b = core.makeRng(42);
  for (let i = 0; i < 20; i++) assertEqual(a(), b(), `value ${i}`);
});

test('makeRng values are in [0,1) and differ across seeds', () => {
  const a = core.makeRng(1), b = core.makeRng(2);
  const va = [], vb = [];
  for (let i = 0; i < 200; i++) { va.push(a()); vb.push(b()); }
  assert(va.every(v => v >= 0 && v < 1), 'all values in [0,1)');
  assert(va.join() !== vb.join(), 'different seeds give different streams');
  assert(new Set(va).size > 190, 'stream is not degenerate');
});

test('hashSeed is stable and sensitive to every part', () => {
  assertEqual(core.hashSeed('olt', 3, 'route'), core.hashSeed('olt', 3, 'route'), 'stable');
  assert(core.hashSeed('olt', 3, 'route') !== core.hashSeed('olt', 4, 'route'), 'trip count matters');
  assert(core.hashSeed('olt', 3, 'route') !== core.hashSeed('mira', 3, 'route'), 'trader id matters');
  assert(core.hashSeed('olt', 3, 'route') !== core.hashSeed('olt', 3, 'dwell'), 'purpose matters');
  const h = core.hashSeed('x');
  assert(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, 'uint32');
});

// ── decideRoute (pure) ──────────────────────────────────────────────────────
console.log('\ntrader_core: decideRoute');

// A tiny two-city world where every price is explicit.
const TOY_ITEMS = [
  { id: 'a', weight: 1 },
  { id: 'b', weight: 1 },
  { id: 'c', weight: 2 },
  { id: 'src', weight: 1, sourceCities: ['y'] },
];
const TOY_BUY  = { x: { a: 10, b: 10, c: 10, src: 1 }, y: { a: 50, b: 50, c: 50, src: 1 } };
const TOY_SELL = { x: { a: 5,  b: 5,  c: 5,  src: 1 }, y: { a: 20, b: 18, c: 30, src: 99 } };
function toyCtx(over = {}) {
  return {
    cities: ['x', 'y'],
    items: TOY_ITEMS,
    capacity: 12,
    buy: (cityId, item) => TOY_BUY[cityId][item.id],
    sellNet: (cityId, item) => TOY_SELL[cityId][item.id],
    pressure: () => 0,
    rng: core.makeRng(7),
    ...over,
  };
}
const toyTrader = (over = {}) => ({ id: 't', from_id: 'x', to_id: 'x', personality: 'aggressive', profit_history: [], ...over });

test('aggressive takes the best score (profit × units)', () => {
  // a: (20-10)*12=120, b: 8*12=96, c: 20*6=120 → tie broken by stable order (a first)
  const r = core.decideRoute(toyTrader(), toyCtx());
  assertEqual(r.fromId, 'x', 'fromId'); assertEqual(r.toId, 'y', 'toId'); assertEqual(r.itemId, 'a', 'itemId');
});

test('respects item source cities', () => {
  const r = core.decideRoute(toyTrader(), toyCtx());
  assert(r.itemId !== 'src', 'src can only be bought in y');
});

test('preferred_item doubles the score', () => {
  const r = core.decideRoute(toyTrader({ preferred_item: 'b' }), toyCtx());
  assertEqual(r.itemId, 'b', 'preferred b (96×2) beats a (120)');
});

test('saturated sell market (pressure ≥ 0.4) is penalised', () => {
  const r = core.decideRoute(toyTrader(), toyCtx({ pressure: (c, i) => (c === 'y' && (i === 'a' || i === 'c') ? 0.5 : 0) }));
  assertEqual(r.itemId, 'b', 'b wins once a and c are saturated');
});

test('no profitable route → falls back to another city with grain, using the rng', () => {
  const ctx = toyCtx({ sellNet: () => 0 });
  const r = core.decideRoute(toyTrader(), ctx);
  assertEqual(r.toId, 'y', 'only other city'); assertEqual(r.itemId, 'grain', 'fallback item');
});

test('same trader + same rng seed → same pick, for every personality', () => {
  for (const personality of ['aggressive', 'cautious', 'opportunist']) {
    const t = toyTrader({ personality });
    const r1 = core.decideRoute(t, toyCtx({ rng: core.makeRng(99) }));
    const r2 = core.decideRoute(t, toyCtx({ rng: core.makeRng(99) }));
    assertEqual(JSON.stringify(r1), JSON.stringify(r2), personality);
  }
});

test('opportunist still varies its pick across seeds', () => {
  const picks = new Set();
  for (let s = 0; s < 50; s++) {
    picks.add(core.decideRoute(toyTrader({ personality: 'opportunist' }), toyCtx({ rng: core.makeRng(s) })).itemId);
  }
  assert(picks.size >= 2, `expected variety, got ${[...picks]}`);
});

test('crowd: items carried by 2+ other traders are skipped when an alternative exists', () => {
  const r = core.decideRoute(toyTrader(), toyCtx({ crowd: { a: 2 } }));
  assertEqual(r.itemId, 'c', 'a is crowded, c (120) is next');
  const all = core.decideRoute(toyTrader(), toyCtx({ crowd: { a: 2, b: 3, c: 2 } }));
  assertEqual(all.itemId, 'a', 'everything crowded → ignore the rule');
  const one = core.decideRoute(toyTrader(), toyCtx({ crowd: { a: 1 } }));
  assertEqual(one.itemId, 'a', 'one other trader is not a crowd');
});

test('traderRng depends on the salt (world seed / day)', () => {
  const t = { id: 'olt', trips_completed: 2 };
  assertEqual(core.traderRng(t, '1:5', 'route')(), core.traderRng(t, '1:5', 'route')(), 'same salt same value');
  assert(core.traderRng(t, '1:5', 'route')() !== core.traderRng(t, '1:6', 'route')(), 'day changes the stream');
});

test('decideRoute never reads the clock or Math.random', () => {
  withNoClock(() => {
    for (const personality of ['aggressive', 'cautious', 'opportunist']) {
      core.decideRoute(toyTrader({ personality }), toyCtx());
      core.decideRoute(toyTrader({ personality }), toyCtx({ sellNet: () => 0 }));
    }
  });
});

test('cityDwellSeconds is seeded and in [30, 90)', () => {
  const a = core.cityDwellSeconds(core.makeRng(5)), b = core.cityDwellSeconds(core.makeRng(5));
  assertEqual(a, b, 'same seed same dwell');
  for (let s = 0; s < 100; s++) {
    const d = core.cityDwellSeconds(core.makeRng(s));
    assert(d >= 30 && d < 90, `dwell ${d} out of range`);
  }
});

// ── world_service.tickTrader (server) ───────────────────────────────────────
console.log('\nworld_service: tickTrader determinism');

const NOW = '2026-01-01T00:00:00.000Z';

// world_service logs every trade; keep the test output readable.
function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}
const tick = (t, secs, ctx) => quiet(() => ws.tickTrader(t, secs, ctx));
const TICK = 1800;               // one cron tick's max elapsed seconds
const TICKS = 48;                // 48 × 30 min ≈ one simulated day of cron ticks

function runWorld() { return quiet(runWorldLoud); }
function runWorldLoud() {
  const traders = ws.TRADER_DEFS.map((def, i) => ws.makeSeedTrader(def, i, NOW));
  for (let k = 0; k < TICKS; k++) {
    const peers = traders.map(t => ({ ...t }));
    for (const t of traders) ws.tickTrader(t, TICK, { nowIso: NOW, peers });
  }
  return traders;
}

test('tickTrader is exported', () => {
  assertEqual(typeof ws.tickTrader, 'function', 'typeof tickTrader');
});

test('a multi-tick run never reads the clock or Math.random', () => {
  withNoClock(() => runWorld());
});

test('a multi-tick run replays identically', () => {
  const a = withNoClock(() => runWorld());
  const b = withNoClock(() => runWorld());
  assertEqual(JSON.stringify(b), JSON.stringify(a), 'trader states');
  const trips = a.reduce((s, t) => s + (t.trips_completed || 0), 0);
  assert(trips >= ws.TRADER_DEFS.length * 3, `traders should actually trade (got ${trips} trips)`);
});

test('timestamps come from the nowIso passed in', () => {
  const t = ws.makeSeedTrader(ws.TRADER_DEFS[0], 0, NOW);
  assertEqual(t.updated_at, NOW, 'seed updated_at');
  tick(t, TICK, { nowIso: NOW, peers: [] });
  assertEqual(t.updated_at, NOW, 'tick updated_at');
  for (const h of t.profit_history) assertEqual(h.at, NOW, 'history at');
});

test('makeSeedTrader refuses to run without a time', () => {
  let threw = false;
  try { ws.makeSeedTrader(ws.TRADER_DEFS[0], 0); } catch { threw = true; }
  assert(threw, 'makeSeedTrader without nowIso should throw');
});

test('tickTrader refuses to run without a time', () => {
  const t = ws.makeSeedTrader(ws.TRADER_DEFS[0], 0, NOW);
  let threw = false;
  try { tick(t, TICK); } catch { threw = true; }
  assert(threw, 'tickTrader without { nowIso } should throw');
});

test('dwell timer after a trip is in [30, 90)', () => {
  const t = ws.makeSeedTrader(ws.TRADER_DEFS[1], 1, NOW);
  t.city_timer = 0;
  // Step until the first arrival has happened.
  for (let i = 0; i < 20 && !t.trips_completed; i++) tick(t, 60, { nowIso: NOW, peers: [] });
  assert(t.trips_completed >= 1, 'trader should complete a trip');
  if (t.state === 'in_city') assert(t.city_timer > 0 && t.city_timer < 90, `city_timer ${t.city_timer}`);
});

// ── One shared route-picker ─────────────────────────────────────────────────
console.log('\nsingle source of trader logic');

const mainSrc = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const wsSrc   = readFileSync(join(ROOT, 'ops/scripts/world_service.mjs'), 'utf8');

test('world_service imports the shared trader core', () => {
  assert(/from ['"]\.\.\/\.\.\/src\/sim\/trader_core\.js['"]/.test(wsSrc), 'import from ../../src/sim/trader_core.js');
});

test('main.js loads the shared trader core', () => {
  assert(/sim\/trader_core\.js/.test(mainSrc), 'main.js should import sim/trader_core.js');
});

test('personality branching exists only in trader_core', () => {
  // Any `if (… personality === 'aggressive')` style branch, braced or not.
  // (UI ternaries like `personality === 'aggressive' ? '⚔️' : …` are fine.)
  const re = /personality\s*===\s*['"](aggressive|cautious|opportunist)['"]\s*\)/;
  assert(!re.test(wsSrc), 'world_service.mjs still has its own personality branch');
  assert(!re.test(mainSrc), 'main.js still has its own personality branch');
});

test('trader logic in world_service uses no Math.random / new Date()', () => {
  const section = (from, to) => {
    const a = wsSrc.indexOf(from), b = wsSrc.indexOf(to, a);
    assert(a > 0 && b > a, `locate ${from}`);
    return wsSrc.slice(a, b);
  };
  const bodies = [
    section('function makeSeedTrader', '\nconst ITEMS'),
    section('// ── Route picking', 'async function flushStrategyLog'),   // decideRoute + reviewStrategy
    section('function tickTrader', '// ── Main'),
  ].join('\n');
  assert(!/Math\.random\(/.test(bodies), 'Math.random in trader code');
  assert(!/new Date\(\)/.test(bodies), 'new Date() in trader code');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
