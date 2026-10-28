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
import { spawnSync } from 'node:child_process';
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

test('gold caps units: an unaffordable item loses to an affordable one', () => {
  // With 30g: a (buy 10) → 3 units × 10 = 30; c (buy 10, weight 2) → 3 units × 20 = 60;
  // make c expensive so only 1 fits: 1 × 20 = 20 → a (30) wins.
  const buy = (cityId, item) => (item.id === 'c' ? 25 : TOY_BUY[cityId][item.id]);
  const sellNet = (cityId, item) => (item.id === 'c' ? 45 : TOY_SELL[cityId][item.id]);
  const r = core.decideRoute(toyTrader(), toyCtx({ buy, sellNet, gold: 30 }));
  assertEqual(r.itemId, 'a', 'affordable a beats c');
  assertEqual(r.units, 3, 'units capped by gold');
});

test('gold too low for any cargo → fallback trip (no phantom profit)', () => {
  const r = core.decideRoute(toyTrader(), toyCtx({ gold: 5 }));
  assertEqual(r.itemId, 'grain', 'fallback item');
  assert(!r.units, 'no units');
});

test('score is gold per minute: a shorter route wins at equal trip profit', () => {
  const ctx = toyCtx({
    cities: ['x', 'y', 'z'],
    buy: (c, it) => ({ a: 10, b: 10, c: 10, src: 99 })[it.id],
    sellNet: (c, it) => (c === 'x' ? 1 : ({ a: 20, b: 1, c: 1, src: 1 })[it.id]),
    routeSeconds: (from, to) => (to === 'y' ? 300 : 120),
  });
  const r = core.decideRoute(toyTrader(), ctx);
  assertEqual(r.toId, 'z', 'same profit to y (300s) and z (120s) → z');
});

test('routeSeconds defaults to the shared ROUTE_SECONDS table', () => {
  assertEqual(core.routeSeconds('valdenmere', 'ironholt'), 180, 'valdenmere→ironholt');
  assertEqual(core.routeSeconds('ashport', 'ironholt'), 360, 'ashport→ironholt');
  assertEqual(core.routeSeconds('nowhere', 'else'), 240, 'unknown route default');
});

test('gold given as a numeric string still caps units', () => {
  const buy = (cityId, item) => (item.id === 'c' ? 25 : TOY_BUY[cityId][item.id]);
  const sellNet = (cityId, item) => (item.id === 'c' ? 45 : TOY_SELL[cityId][item.id]);
  const r = core.decideRoute(toyTrader(), toyCtx({ buy, sellNet, gold: '30' }));
  assertEqual(r.units, 3, 'units capped by "30"');
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

test('gear upgrade keeps enough gold to fill the new cart with the cheapest goods', () => {
  const reserve = ws.upgradeReserve(1, 'valdenmere'); // tier 1 cart, seed trader stands in valdenmere
  assert(reserve > 0, `reserve ${reserve}`);
  const history = [1, 2, 3].map(trip => ({ trip, profit: 60, item: 'grain', to: 'ironholt' }));
  const poor = { ...ws.makeSeedTrader(ws.TRADER_DEFS[0], 0, NOW), gold: 200 + reserve - 1, profit_history: history };
  quiet(() => ws.tryGearUpgrade(poor));
  assertEqual(poor.gear_tier, 0, 'one gold short of cost + reserve → no upgrade');
  const rich = { ...ws.makeSeedTrader(ws.TRADER_DEFS[0], 0, NOW), gold: 200 + reserve, profit_history: history };
  quiet(() => ws.tryGearUpgrade(rich));
  assertEqual(rich.gear_tier, 1, 'cost + reserve → upgrade');
  assert(rich.gold >= reserve, `left with ${rich.gold}g, reserve ${reserve}g`);
});

test('tickTrader loads exactly the units decideRoute chose (fallback → empty cart)', () => {
  let sawFallback = false;
  for (const gold of [5, 12, 15, 25, 40, 500]) {
    for (const from of ws.CITIES) {
      const t = ws.makeSeedTrader(ws.TRADER_DEFS[0], 0, NOW);
      t.gold = gold; t.city_timer = 0; t.from_id = from; t.to_id = from;
      const route = ws.decideRoute(t);
      tick(t, 60, { nowIso: NOW, peers: [] });
      const expected = route.units ? { [route.itemId]: route.units } : {};
      assertEqual(JSON.stringify(t.inv), JSON.stringify(expected), `gold ${gold} from ${from}`);
      if (!route.units) sawFallback = true;
    }
  }
  assert(sawFallback, 'at least one case should hit the fallback');
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

// ── aggregatePressure (offline mirror of SQL aggregate_economy) ─────────────
console.log('\nworld_service: aggregatePressure');

test('aggregatePressure: decay, fold events, clamp, drop near-zero', () => {
  const { decay, perUnit, clamp } = ws.PRESSURE_AGG;
  const before = { 'a:grain': clamp * 0.9, 'b:ore': 0.0011, 'c:food': -0.05 };
  const big = Math.ceil(clamp / perUnit); // enough units to hit the clamp on its own
  const events = [
    { city_id: 'a', item_id: 'grain', direction: 'buy', qty: big },
    { city_id: 'c', item_id: 'food', direction: 'sell', qty: 5 },
    { city_id: 'd', item_id: 'ink', direction: 'buy', qty: 3 },
  ];
  const after = ws.aggregatePressure(before, events);
  assertEqual(after['a:grain'], clamp, 'a:grain clamps at +clamp');
  assert(!('b:ore' in after), 'b:ore decays below 0.001 and is dropped');
  assert(Math.abs(after['c:food'] - (-0.05 * decay - 5 * perUnit)) < 1e-12, `c:food got ${after['c:food']}`);
  assert(Math.abs(after['d:ink'] - 3 * perUnit) < 1e-12, `d:ink got ${after['d:ink']}`);
  assertEqual(before['a:grain'], clamp * 0.9, 'input map not mutated');
  // Boundary: SQL neither decays nor deletes a row at exactly the threshold.
  assertEqual(ws.aggregatePressure({ 'e:ore': 0.001 }, [])['e:ore'], 0.001, 'exactly 0.001 kept as is');
  // Selling clamps at -clamp too.
  assertEqual(ws.aggregatePressure({}, [{ city_id: 'f', item_id: 'ore', direction: 'sell', qty: big * 2 }])['f:ore'], -clamp, '-clamp');
});

test('aggregatePressure constants match ops/supabase_schema.sql aggregate_economy()', () => {
  const sql = readFileSync(join(ROOT, 'ops/supabase_schema.sql'), 'utf8');
  const fn = sql.slice(sql.indexOf('FUNCTION aggregate_economy()'), sql.indexOf('REVOKE EXECUTE ON FUNCTION aggregate_economy()'));
  const decay = Number(/decay_factor\s+FLOAT\s*:=\s*([0-9.]+)/.exec(fn)?.[1]);
  const perUnit = Number(/ELSE -qty END\)\s*\*\s*([0-9.]+)/.exec(fn)?.[1]);
  const clampM = /GREATEST\(-([0-9.]+),\s*LEAST\(([0-9.]+)/.exec(fn);
  assertEqual(clampM?.[1], clampM?.[2], 'SQL clamp is symmetric');
  const clamp = Number(clampM?.[1]);
  const drop = Number(/DELETE FROM market_economy WHERE ABS\(pressure\) < ([0-9.]+)/.exec(fn)?.[1]);
  const decayWhere = Number(/decay_factor,[\s\S]*?WHERE ABS\(pressure\) > ([0-9.]+)/.exec(fn)?.[1]);
  assertEqual(decayWhere, drop, 'SQL decays rows above the same threshold it deletes below');
  assertEqual(ws.PRESSURE_AGG.decay, decay, 'decay');
  assertEqual(ws.PRESSURE_AGG.perUnit, perUnit, 'per-unit pressure');
  assertEqual(ws.PRESSURE_AGG.clamp, clamp, 'clamp');
  assertEqual(ws.PRESSURE_AGG.drop, drop, 'drop threshold');
});

// ── Live pressure aggregation (world_service replaces the broken SQL RPC) ───
console.log('\nworld_service: live pressure aggregation');

test('gentler pressure: 0.002 per unit, clamp ±0.15 (one 18-unit cart moves a price ~4%)', () => {
  assertEqual(ws.PRESSURE_AGG.perUnit, 0.002, 'perUnit');
  assertEqual(ws.PRESSURE_AGG.clamp, 0.15, 'clamp');
});

test('foldTradeEvents: folds only events after the watermark; writes changed rows + new watermark', () => {
  const prev = { 'a:grain': 0.1, 'b:ore': 0.0011 };
  const events = [
    { id: 3, city_id: 'a', item_id: 'grain', direction: 'buy', qty: 99 },  // at/below watermark: ignored
    { id: 5, city_id: 'a', item_id: 'grain', direction: 'buy', qty: 10 },
    { id: 7, city_id: 'c', item_id: 'food', direction: 'sell', qty: 5 },
  ];
  const r = ws.foldTradeEvents(prev, events, 4);
  assertEqual(r.lastId, 7, 'watermark advances to the newest event');
  const a = 0.1 * 0.85 + 10 * 0.002, c = -5 * 0.002;
  assert(Math.abs(r.next['a:grain'] - a) < 1e-12, `a:grain ${r.next['a:grain']}`);
  assert(Math.abs(r.next['c:food'] - c) < 1e-12, `c:food ${r.next['c:food']}`);
  const row = (city, item) => r.rows.find(x => x.city_id === city && x.item_id === item);
  assert(Math.abs(row('a', 'grain').pressure - a) < 1e-12, 'a:grain row');
  assertEqual(row('b', 'ore').pressure, 0, 'dropped key is written back as 0');
  assertEqual(row(ws.AGG_WATERMARK.city_id, ws.AGG_WATERMARK.item_id).pressure, 7, 'watermark row');
});

test('foldTradeEvents: first run (no watermark) skips the backlog, but decays + clamps old values', () => {
  const prev = { 'a:grain': 0.5, 'b:ore': 0.1 }; // 0.5 = left over from the old ±0.5 clamp
  const events = [{ id: 40, city_id: 'a', item_id: 'grain', direction: 'buy', qty: 500 }];
  const r = ws.foldTradeEvents(prev, events, null);
  assertEqual(r.lastId, 40, 'watermark = newest event');
  assertEqual(r.next['a:grain'], ws.PRESSURE_AGG.clamp, 'old 0.5 clamped to the new cap (backlog not folded)');
  assert(Math.abs(r.next['b:ore'] - 0.1 * ws.PRESSURE_AGG.decay) < 1e-12, 'decayed');
  assert(r.rows.some(x => x.city_id === 'a' && x.pressure === ws.PRESSURE_AGG.clamp), 'clamped row written');
});

test('newestEventId: rejects a malformed response instead of recording watermark 0', () => {
  assertEqual(ws.newestEventId([{ id: 77 }]), 77, 'newest id');
  assertEqual(ws.newestEventId([]), 0, 'empty table → 0');
  let threw = false;
  try { ws.newestEventId(null); } catch { threw = true; }
  assert(threw, 'null response must throw');
});

test('browser pressure constants match the ticker (optimistic updates use the same scale)', () => {
  const mainSrc = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
  const per = Number(/const PRESSURE_PER_UNIT\s*=\s*([0-9.]+)/.exec(mainSrc)?.[1]);
  const clamp = Number(/const PRESSURE_CLAMP\s*=\s*([0-9.]+)/.exec(mainSrc)?.[1]);
  assertEqual(per, ws.PRESSURE_AGG.perUnit, 'main.js PRESSURE_PER_UNIT');
  assertEqual(clamp, ws.PRESSURE_AGG.clamp, 'main.js PRESSURE_CLAMP');
  assert(!/ECONOMY\.pressure[^\n]*0\.25/.test(mainSrc), 'no leftover ±0.25 pressure clamps in main.js');
  assert(/__agg__|AGG_MARKER/.test(mainSrc), 'economySync should skip the watermark marker row');
});

test('SQL aggregate_economy skips the watermark row and is not callable by anon', () => {
  const sql = readFileSync(join(ROOT, 'ops/supabase_schema.sql'), 'utf8');
  const fn = sql.slice(sql.indexOf('FUNCTION aggregate_economy()'), sql.indexOf('REVOKE EXECUTE ON FUNCTION aggregate_economy()'));
  const body = fn.replace(/--[^\n]*/g, '');
  const re = /\b(UPDATE|DELETE FROM)\s+market_economy\b/g;
  let m, n = 0;
  while ((m = re.exec(body))) {
    n++;
    const rest = body.slice(m.index);
    const stmt = rest.slice(0, rest.search(/;/));
    assert(/city_id\s*<>\s*'__agg__'/.test(stmt), `market_economy statement must skip the marker row: ${stmt.trim().slice(0, 60)}`);
  }
  assert(n >= 3, `found ${n} market_economy UPDATE/DELETE statements`);
  assert(!/GRANT EXECUTE ON FUNCTION aggregate_economy\(\) TO anon/.test(sql), 'anon must not be granted aggregate_economy');
  assert(/REVOKE EXECUTE ON FUNCTION aggregate_economy\(\) FROM/.test(sql), 'REVOKE present');
});

test('foldTradeEvents: unchanged keys are not rewritten; no events still decays', () => {
  const r = ws.foldTradeEvents({ 'a:grain': 0.1, 'z:ink': 0 }, [], 9);
  assertEqual(r.lastId, 9, 'watermark unchanged');
  assert(r.rows.some(x => x.city_id === 'a' && Math.abs(x.pressure - 0.085) < 1e-12), 'decayed row written');
  assert(!r.rows.some(x => x.city_id === 'z'), 'zero row stays as is');
});

test('parsePressureRows: the watermark row is not market pressure', () => {
  const { map, lastId } = ws.parsePressureRows([
    { city_id: 'a', item_id: 'grain', pressure: 0.1 },
    { city_id: ws.AGG_WATERMARK.city_id, item_id: ws.AGG_WATERMARK.item_id, pressure: 1234 },
  ]);
  assertEqual(JSON.stringify(map), JSON.stringify({ 'a:grain': 0.1 }), 'map');
  assertEqual(lastId, 1234, 'lastId');
  assertEqual(ws.parsePressureRows([]).lastId, null, 'no watermark yet');
});

test('nothing calls the broken aggregate_economy RPC any more', () => {
  const mainSrc = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
  const wsSrc = readFileSync(join(ROOT, 'ops/scripts/world_service.mjs'), 'utf8');
  assert(!/rpc\/aggregate_economy/.test(mainSrc), 'main.js still calls rpc/aggregate_economy');
  assert(!/rpc\/aggregate_economy/.test(wsSrc), 'world_service.mjs still calls rpc/aggregate_economy');
});

test('SQL aggregate_economy is safeupdate-proof: every UPDATE/DELETE has a WHERE', () => {
  const sql = readFileSync(join(ROOT, 'ops/supabase_schema.sql'), 'utf8');
  const fn = sql.slice(sql.indexOf('FUNCTION aggregate_economy()'), sql.indexOf('REVOKE EXECUTE ON FUNCTION aggregate_economy()'));
  const body = fn.replace(/--[^\n]*/g, '');
  // ON CONFLICT … DO UPDATE has no table name, so it never matches this regex.
  const re = /\b(UPDATE|DELETE FROM)\s+(market_economy|trade_events)\b/g;
  let m, n = 0;
  while ((m = re.exec(body))) {
    n++;
    const rest = body.slice(m.index + m[0].length);
    const end = rest.search(/;|\bRETURNING\b/);
    const clause = end >= 0 ? rest.slice(0, end) : rest;
    assert(/\bWHERE\b/.test(clause), `missing WHERE after "${m[0]}"`);
  }
  assert(n >= 4, `found ${n} UPDATE/DELETE statements`);
});

test('world-sim workflow runs one tick at a time (no double folding)', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/world-sim.yml'), 'utf8');
  assert(/^concurrency:/m.test(wf), 'world-sim.yml needs a concurrency group');
});

// ── simulateTraders (offline multi-day run + report) ───────────────────────
console.log('\nworld_service: simulateTraders');

const sim = (o) => withNoClock(() => ws.simulateTraders(o));

test('simulateTraders is exported', () => {
  assertEqual(typeof ws.simulateTraders, 'function', 'typeof simulateTraders');
});

test('same seed → identical report; different seed → different report', () => {
  const a = sim({ days: 10, seed: 7 }), b = sim({ days: 10, seed: 7 }), c = sim({ days: 10, seed: 8 });
  assertEqual(JSON.stringify(b), JSON.stringify(a), 'seed 7 replay');
  assert(JSON.stringify(c) !== JSON.stringify(a), 'seed 8 should differ');
});

test('report shape: traders, items, routes, diversity, totals', () => {
  const r = sim({ days: 10, seed: 1 });
  assertEqual(r.days, 10, 'days'); assertEqual(r.seed, 1, 'seed');
  assertEqual(r.traders.length, ws.TRADER_DEFS.length, 'one row per trader');
  for (const t of r.traders) {
    for (const k of ['id', 'name', 'personality', 'startGold', 'endGold', 'profit', 'trips', 'gearTier']) {
      assert(k in t, `trader.${k}`);
    }
  }
  assert(r.items && typeof r.items === 'object', 'items');
  assert(Array.isArray(r.routes), 'routes');
  for (const k of ['distinctItems', 'distinctRoutes', 'topItemShare', 'hhi']) assert(k in r.diversity, `diversity.${k}`);
  for (const k of ['trips', 'profit', 'goldStart', 'goldEnd']) assert(k in r.totals, `totals.${k}`);
  const shareSum = Object.values(r.items).reduce((s, i) => s + i.share, 0);
  assert(Math.abs(shareSum - 1) < 1e-9, `item shares sum to 1 (got ${shareSum})`);
});

test('30 days: every trader trades and nobody ends with negative gold', () => {
  const r = sim({ days: 30, seed: 3 });
  for (const t of r.traders) {
    assert(t.trips >= 5, `${t.id} made only ${t.trips} trips`);
    assert(t.endGold >= 0, `${t.id} ended at ${t.endGold}g`);
  }
  assertEqual(r.totals.trips, r.traders.reduce((s, t) => s + t.trips, 0), 'totals.trips');
});

// Health guardrails below run on the BASE economy (pressure: false): they check
// the trader brain and prices, not the strength of live market pressure, which
// is a separate tuning question (see the pressure-feedback test).
test('30 days: traders spread across goods (no herding onto one item)', () => {
  // Baseline (loaded trips, seeds 1–3): 9 distinct items, top item 21–38%, HHI 0.13–0.20.
  for (const seed of [1, 2, 3]) {
    const d = sim({ days: 30, seed, pressure: false }).diversity;
    assert(d.distinctItems >= 6, `seed ${seed}: only ${d.distinctItems} distinct items`);
    assert(d.topItemShare <= 0.4, `seed ${seed}: one item takes ${d.topItemShare} of trips`);
    assert(d.hhi <= 0.25, `seed ${seed}: item concentration HHI ${d.hhi}`);
  }
});

test('report counts stranded rescues and empty-cart trips, and keeps them out of item shares', () => {
  const r = sim({ days: 120, seed: 1 });
  assert(Number.isInteger(r.totals.rescues), 'totals.rescues');
  assert(Number.isInteger(r.totals.emptyTrips), 'totals.emptyTrips');
  for (const t of r.traders) {
    assert(Number.isInteger(t.rescues), `${t.id}.rescues`);
    assert(Number.isInteger(t.emptyTrips), `${t.id}.emptyTrips`);
  }
  assertEqual(r.totals.rescues, r.traders.reduce((s, t) => s + t.rescues, 0), 'rescue total');
  const itemTrips = Object.values(r.items).reduce((s, i) => s + i.trips, 0);
  assertEqual(itemTrips + r.totals.emptyTrips, r.totals.trips, 'item trips + empty trips = all trips');
});

test('snapshotPeers copies profit_history (peers never see this tick\'s trips)', () => {
  const t = ws.makeSeedTrader(ws.TRADER_DEFS[0], 0, NOW);
  t.profit_history = [{ trip: 1, profit: 5 }];
  const [p] = ws.snapshotPeers([t]);
  t.profit_history.push({ trip: 2, profit: 999 });
  assertEqual(p.profit_history.length, 1, 'snapshot history length');
});

test('tickTrader reports rescues through ctx.onRescue', () => {
  const t = ws.makeSeedTrader(ws.TRADER_DEFS[0], 0, NOW);
  t.gold = 0; t.city_timer = 0;
  let rescues = 0;
  for (let i = 0; i < 20 && !t.trips_completed; i++) tick(t, 60, { nowIso: NOW, peers: [], onRescue: () => rescues++ });
  assert(t.trips_completed >= 1, 'made a trip');
  assertEqual(rescues, 1, 'broke trader arriving with an empty cart is rescued once');
});

test('30 days: almost no trader leaves with an empty cart', () => {
  // Before afford-aware routing: 23–34% of trips were empty.
  for (const seed of [1, 2, 3]) {
    const t = sim({ days: 30, seed, pressure: false }).totals;
    assert(t.emptyTrips / t.trips <= 0.10, `seed ${seed}: ${t.emptyTrips}/${t.trips} trips empty`);
  }
});

test('120 days: every trader ends richer than it started, with no rescues', () => {
  // Before the upgrade reserve + afford-aware routing, 2 of 6 ended near or below start.
  const r = sim({ days: 120, seed: 1, pressure: false });
  for (const t of r.traders) {
    assert(t.endGold > t.startGold, `${t.id}: ${t.startGold}g → ${t.endGold}g`);
    assertEqual(t.rescues, 0, `${t.id} rescues`);
  }
});

test('pressure feedback: on by default, builds market pressure, still deterministic', () => {
  const r = sim({ days: 30, seed: 1 });
  assertEqual(r.pressureFeedback, true, 'pressureFeedback');
  assert(r.market && r.market.maxPressure > 0.05, `pressure should build up (max ${r.market && r.market.maxPressure})`);
  assert(r.market.minPressure < -0.05, `sell pressure should build up (min ${r.market.minPressure})`);
  assertEqual(JSON.stringify(sim({ days: 30, seed: 1 })), JSON.stringify(r), 'replay with pressure');
  const off = sim({ days: 30, seed: 1, pressure: false });
  assertEqual(off.pressureFeedback, false, 'pressure: false turns it off');
  assertEqual(off.market.maxPressure, 0, 'no pressure when off');
});

test('30 days: no strategy herds (2+ traders switching to the same item in one step)', () => {
  for (const seed of [1, 2, 3]) for (const pressure of [false, true]) {
    const st = sim({ days: 30, seed, pressure }).strategy;
    assertEqual(st.herds, 0, `seed ${seed} pressure ${pressure} herds`);
  }
});

test('with live (gentler) pressure: traders stay healthy over 30 and 120 days', () => {
  for (const seed of [1, 2, 3]) {
    const r = sim({ days: 30, seed, pressure: true });
    assert(r.totals.emptyTrips / r.totals.trips <= 0.10, `seed ${seed}: ${r.totals.emptyTrips}/${r.totals.trips} empty`);
    assert(r.diversity.hhi <= 0.25, `seed ${seed}: HHI ${r.diversity.hhi}`);
    assert(r.diversity.topItemShare <= 0.40, `seed ${seed}: top item ${r.diversity.topItemShare}`);
  }
  const long = sim({ days: 120, seed: 1, pressure: true });
  for (const t of long.traders) {
    assert(t.endGold > t.startGold, `${t.id}: ${t.startGold}g → ${t.endGold}g`);
  }
});

test('simulateTraders leaves world_service module state as it found it', () => {
  const snap = () => JSON.stringify({ w: ws.WORLD_STATE, e: ws.WORLD_EVENTS, p: ws.PRESSURE_MAP, t: ws.CITY_TREASURY, d: ws.MARKET_DRIFT });
  ws.MARKET_DRIFT.valdenmere = { ...(ws.MARKET_DRIFT.valdenmere || {}), grain: 1.07 }; // non-neutral drift must survive
  const before = snap();
  sim({ days: 5, seed: 2 });
  const after = snap();
  assertEqual(after, before, 'module state restored');
});

test('trader_report CLI prints the same JSON as simulateTraders', () => {
  const r = spawnSync('node', [join(ROOT, 'ops/scripts/trader_report.mjs'), '--days', '6', '--seed', '4'], { encoding: 'utf8' });
  assertEqual(r.status, 0, `exit code (stderr: ${r.stderr})`);
  assertEqual(r.stdout.trim(), JSON.stringify(sim({ days: 6, seed: 4 })), 'CLI stdout');
});

// ── Live-failure fixes: stuck traders + strategy herding ────────────────────
console.log('\nworld_service: stuck-trader rescue + strategy herding');

test('stuck rescue: a trader who cannot afford any profitable cargo where it stands is rescued', () => {
  // Live: Cargo Dom and Olt held >= the global cheapest unit, so the old rescue
  // never fired, but nothing profitable from their city was affordable: empty
  // trips forever. Find a city where that gap exists today.
  const city = ws.CITIES.find(c => ws.stuckRescueGold(c) > ws.cheapestBuy());
  assert(city, 'expected a city whose cheapest profitable unit costs more than the global cheapest unit');
  const t = ws.makeSeedTrader(ws.TRADER_DEFS[2], 2, NOW);
  const other = ws.CITIES.find(c => c !== city);
  Object.assign(t, { state: 'traveling', from_id: other, to_id: city, progress: 0.99, inv: {}, gold: ws.cheapestBuy() });
  let rescued = 0;
  tick(t, 60, { nowIso: NOW, peers: [], onRescue: () => rescued++ });
  assertEqual(rescued, 1, 'rescued on arrival');
  assert(t.gold >= ws.stuckRescueGold(city), `gold ${t.gold} should cover one profitable unit (${ws.stuckRescueGold(city)})`);
  t.city_timer = 0;
  tick(t, 60, { nowIso: NOW, peers: [] });
  assert(Object.keys(t.inv).length > 0, `next trip should carry cargo, got ${JSON.stringify(t.inv)}`);
});

test('stuck rescue never fires for a trader that can afford a profitable trip', () => {
  const t = ws.makeSeedTrader(ws.TRADER_DEFS[2], 2, NOW);
  Object.assign(t, { state: 'traveling', from_id: 'ashport', to_id: 'valdenmere', progress: 0.99, inv: {}, gold: 500, gear_tier: 3 }); // maxed cart: no upgrade spend
  let rescued = 0;
  tick(t, 60, { nowIso: NOW, peers: [], onRescue: () => rescued++ });
  assertEqual(rescued, 0, 'no rescue');
  assertEqual(t.gold, 500, 'gold untouched');
});

function fresh(i, over = {}) {
  return { ...ws.makeSeedTrader(ws.TRADER_DEFS[i], i, NOW), ...over };
}
const review = (t, ctx) => quiet(() => ws.reviewStrategy(t, { nowIso: NOW, ...ctx }));

test('herding: traders reviewing in the same tick pick different focus items', () => {
  // Live: 3-5 traders "pivot to uncontested X" in one run, all to the same X,
  // because each compared itself with the pre-tick snapshot.
  const traders = [0, 1, 2, 3].map(i => fresh(i, { trips_completed: 0, profit_history: [] }));
  const peers = ws.snapshotPeers(traders);
  const focus = {};
  for (const t of traders) review(t, { peers, focus });
  const picks = traders.map(t => t.preferred_item);
  assertEqual(new Set(picks).size, picks.length, `distinct picks, got ${picks}`);
  for (const t of traders) assertEqual(focus[t.id], t.preferred_item, 'focus board updated');
});

test('herding: trailing traders do not all pivot to the same niche in one tick', () => {
  const hist = p => [1, 2, 3].map(trip => ({ trip, profit: p, item: 'grain', to: 'ironholt' }));
  const leader = fresh(0, { trips_completed: 9, preferred_item: 'grain', profit_history: hist(400) });
  const laggards = [1, 2, 3].map(i => fresh(i, { trips_completed: 9, preferred_item: 'grain', profit_history: hist(5), review_at_trips: 9 }));
  const all = [leader, ...laggards];
  const peers = ws.snapshotPeers(all);
  const focus = Object.fromEntries(all.map(t => [t.id, t.preferred_item]));
  for (const t of laggards) review(t, { peers, focus });
  const moved = laggards.map(t => t.preferred_item).filter(x => x !== 'grain');
  assertEqual(new Set(moved).size, moved.length, `no two laggards move to the same item, got ${laggards.map(t => t.preferred_item)}`);
});

test('hysteresis: hold when the current focus is within 25% of the niche; switch when clearly beaten', () => {
  const hist = p => [1, 2, 3].map(trip => ({ trip, profit: p, item: 'x', to: 'ironholt' }));
  const scores = ws.focusScores(fresh(1, { trips_completed: 9 }));
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const worst = ranked[ranked.length - 1];
  assert(second[1] * 1.25 >= best[1], `test needs a runner-up within 25% of the best (${best[0]} ${best[1]}, ${second[0]} ${second[1]})`);
  assert(worst[1] * 1.25 < best[1], `test needs a clearly beaten item (${worst[0]} ${worst[1]})`);
  // Leader earns far more and focuses on the worst item, so trailing traders pivot rather than copy.
  const mk = (pref) => {
    const leader = fresh(0, { trips_completed: 9, preferred_item: worst[0], profit_history: hist(400) });
    const t = fresh(1, { trips_completed: 9, preferred_item: pref, profit_history: hist(5) });
    review(t, { peers: ws.snapshotPeers([leader, t]), focus: { [leader.id]: leader.preferred_item, [t.id]: pref } });
    return t.preferred_item;
  };
  assertEqual(mk(second[0]), second[0], `${second[0]} is within 25% of ${best[0]}: hold`);
  const moved = mk(ranked[ranked.length - 2][0]);
  assert(moved !== ranked[ranked.length - 2][0] && scores[moved] >= scores[ranked[ranked.length - 2][0]] * 1.25,
    `a clearly beaten focus should switch to something >=25% better, got ${moved}`);
});

test('copy_leader does not pile a 3rd trader onto an item two already hold', () => {
  const hist = p => [1, 2, 3].map(trip => ({ trip, profit: p, item: 'x', to: 'ironholt' }));
  const scores = ws.focusScores(fresh(1, { trips_completed: 9 }));
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  // Every other item is taken, so there's no niche to pivot to; leader + one more hold `top`.
  const others = Object.keys(scores).filter(k => k !== top);
  const leader = fresh(0, { trips_completed: 9, preferred_item: top, profit_history: hist(400) });
  const twin = fresh(2, { trips_completed: 9, preferred_item: top, profit_history: hist(300) });
  const t = fresh(1, { trips_completed: 9, preferred_item: others[0], profit_history: hist(5) });
  const fillers = others.slice(1).map((item, i) => ({ id: `filler_${i}`, preferred_item: item, profit_history: hist(1) }));
  const all = [leader, twin, t, ...fillers];
  const focus = Object.fromEntries(all.map(x => [x.id, x.preferred_item]));
  review(t, { peers: ws.snapshotPeers(all), focus });
  assert(t.preferred_item !== top, `should not become the 3rd trader on ${top}`);
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

test('main.js fallback passes the trader\'s gold to decideRoute', () => {
  const i = mainSrc.indexOf('function traderDecideRoute');
  const body = mainSrc.slice(i, mainSrc.indexOf('\n}\n', i));
  assert(i > 0 && /\bgold:\s*trader\.gold\b/.test(body), 'traderDecideRoute should pass gold: trader.gold');
});

test('route durations live only in trader_core', () => {
  assert(!/const ROUTE_DURATION\s*=\s*\{/.test(wsSrc), 'world_service.mjs still defines its own ROUTE_DURATION table');
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
