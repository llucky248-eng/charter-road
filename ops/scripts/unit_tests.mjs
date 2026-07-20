#!/usr/bin/env node
/**
 * Unit tests for pure/utility functions extracted from src/main.js.
 * These run in Node.js without a browser.
 *
 * Usage:
 *   node ops/scripts/unit_tests.mjs
 */

// ─── Live extraction from src/main.js ────────────────────────────────────────
// Several tested helpers live inside the game IIFE and are deliberately
// self-contained; extract them from source (rather than copying) so the tests
// can never drift from the shipped logic. Matches `function <name>(...) {`
// through the function's closing 2-space-indented brace.
import { readFileSync as _readFileSync } from 'node:fs';
import { fileURLToPath as _fileURLToPath } from 'node:url';
import { join as _join, dirname as _dirname } from 'node:path';
const _mainJsSrc = _readFileSync(_join(_dirname(_fileURLToPath(import.meta.url)), '../../src/main.js'), 'utf8');
function extractFromMain(name) {
  const m = _mainJsSrc.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  return m ? new Function(`return (${m[0]})`)() : null;
}

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

function assertClose(a, b, tol = 1e-6, msg) {
  if (Math.abs(a - b) > tol)
    throw new Error(msg || `expected ~${b}, got ${a} (tol=${tol})`);
}

// ─── Function implementations (copied verbatim from src/main.js) ──────────────

// hash2
function hash2(x, y) {
  let n = (x * 374761393 + y * 668265263) >>> 0;
  n = (n ^ (n >> 13)) >>> 0;
  n = (n * 1274126177) >>> 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

// seeded01
function seeded01(a, b, c = 0) {
  let n = (a * 374761393 + b * 668265263 + c * 362437) >>> 0;
  n = (n ^ (n >> 13)) >>> 0;
  n = (n * 1274126177) >>> 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

// citySeed
function citySeed(cityId) {
  const seeds = { valdenmere: 1337, ashport: 7331, crosshaven: 4219, ironholt: 9901 };
  const a = seeds[cityId] || 5555;
  return a;
}

// townItemModifier
function townItemModifier(cityId, itemId) {
  const cs = citySeed(cityId);
  const u = seeded01(cs, itemId.length, itemId.charCodeAt(0) || 0);
  const skew = (u * 2 - 1) * 0.18;
  const v = seeded01(cs, 999, 42);
  const cityTilt = (v * 2 - 1) * 0.06;
  return 1 + skew + cityTilt;
}

// referencePrice
function referencePrice(item) {
  return Math.max(1, Math.round(item.base));
}

// midPriceFor (needs stateTime; pass it as param)
function midPriceFor(cityId, item, stateTime = 0) {
  const mod = townItemModifier(cityId, item.id);
  const wob = 0.97 + (Math.sin((item.base + stateTime) * 0.001) + 1) * 0.03;
  return Math.max(1, Math.round(item.base * mod * wob));
}

// quoteFor (MARKET.spread hardcoded as in main; no cityBonus for tests)
const MARKET_SPREAD = 0.06;
function quoteFor(cityId, item, stateTime = 0, cityBonus = {}) {
  const mid = midPriceFor(cityId, item, stateTime);
  const half = MARKET_SPREAD / 2;
  const discount = cityBonus[cityId]?.marketDiscount || 0;
  const buy  = Math.max(1, Math.round(mid * (1 + half) * (1 - discount)));
  const sell = Math.max(1, Math.round(mid * (1 - half)));
  return { mid, buy, sell };
}

// fmtDeltaPct
function fmtDeltaPct(cur, ref) {
  if (!ref) return '';
  const d = (cur - ref) / ref;
  const pct = Math.round(d * 100);
  return (pct >= 0 ? `+${pct}%` : `${pct}%`);
}

// htmlEscape
function htmlEscape(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// rewardForContract — mirrors src/main.js exactly (copy verbatim on any change)
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
const ITEMS_FOR_REWARD = [
  { id: 'grain',  base: 10 },
  { id: 'food',   base: 16 },
  { id: 'ore',    base: 22 },
  { id: 'herbs',  base: 24 },
  { id: 'potion', base: 40 },
  { id: 'relic',  base: 60 },
  { id: 'ink',    base: 75 },
];
function rewardForContract(want, qty) {
  const it = ITEMS_FOR_REWARD.find(x => x.id === want);
  const base = it ? it.base : 20;
  const bestMarginRef = {
    grain: 7, food: 5, ore: 9, herbs: 7, potion: 10, relic: 18, ink: 13,
  }[want] || 5;
  const buyCostRef = Math.round(base * 0.88);
  const deliveryPremium = Math.round(bestMarginRef * 1.2);
  const perUnit = buyCostRef + deliveryPremium;
  const qtyMult = qty === 1 ? 1.0 : qty === 2 ? 1.75 : 2.35;
  const r = Math.round(perUnit * qtyMult);
  return clamp(r, 18, 280);
}

// contractTierForRep
const CONTRACT_TIER_THRESHOLDS = [3, 7];
function contractTierForRep(rep) {
  const r = Number(rep) || 0;
  if (r >= CONTRACT_TIER_THRESHOLDS[1]) return 2;
  if (r >= CONTRACT_TIER_THRESHOLDS[0]) return 1;
  return 0;
}

// isObj
function isObj(x) { return !!x && typeof x === 'object'; }

// validateSave — mirrors logic in main.js exactly (copy verbatim on any change)
const SAVE_SCHEMA_VERSION = 1;
function validateSave(s) {
  const errors = [];
  if (!isObj(s)) errors.push('save is not an object');
  if (s?.saveVersion !== undefined && !Number.isInteger(s.saveVersion)) {
    errors.push('saveVersion must be an integer if present');
  }
  if (!isObj(s?.player)) errors.push('player missing');
  else {
    const p = s.player;
    if (!Number.isFinite(p.x)) errors.push('player.x must be number');
    if (!Number.isFinite(p.y)) errors.push('player.y must be number');
    if (!Number.isFinite(p.gold)) errors.push('player.gold must be number');
    if (!Number.isFinite(p.capacity)) errors.push('player.capacity must be number');
    if (!isObj(p.inv)) errors.push('player.inv must be object');
    if (!isObj(p.rep)) errors.push('player.rep must be object');
    if (!isObj(p.permits)) errors.push('player.permits must be object');
    if (!isObj(p.facing)) errors.push('player.facing must be object');
    else {
      if (!Number.isFinite(p.facing.x)) errors.push('player.facing.x must be number');
      if (!Number.isFinite(p.facing.y)) errors.push('player.facing.y must be number');
    }
    if (p.lastCityId != null && typeof p.lastCityId !== 'string') {
      errors.push('player.lastCityId must be string|null');
    }
    if (p.gear !== undefined) {
      if (!isObj(p.gear)) {
        errors.push('player.gear must be object');
      } else {
        for (const slot of ['pack', 'boots', 'tool', 'pickaxe']) {
          if (p.gear[slot] !== undefined && !Number.isInteger(p.gear[slot])) {
            errors.push(`player.gear.${slot} must be an integer`);
          }
        }
      }
    }
  }
  if (!isObj(s?.time)) errors.push('time missing');
  else {
    const t = s.time;
    if (!Number.isFinite(t.day)) errors.push('time.day must be number');
    if (!Number.isFinite(t.frac)) errors.push('time.frac must be number');
    if (!Number.isFinite(t.seed)) errors.push('time.seed must be number');
  }
  if (s.marketDrift !== undefined) {
    if (!isObj(s.marketDrift)) errors.push('marketDrift must be object');
  }
  if (s.contracts !== undefined) {
    if (!isObj(s.contracts)) errors.push('contracts must be object');
    else {
      const a = s.contracts.active;
      if (a !== null && a !== undefined && !isObj(a))
        errors.push('contracts.active must be object|null');
    }
  }
  if (s.openedCaches !== undefined) {
    if (!Array.isArray(s.openedCaches)) errors.push('openedCaches must be an array if present');
  }
  return { ok: errors.length === 0, errors };
}

// migrateSave — mirrors logic in main.js exactly (copy verbatim on any change)
function migrateSave(raw) {
  let s;
  try { s = JSON.parse(JSON.stringify(raw)); } catch { s = raw; }
  const v = Number.isInteger(s?.saveVersion) ? s.saveVersion : 0;
  if (v > SAVE_SCHEMA_VERSION) return s; // future version — return as-is
  if (v === 0) {
    s.saveVersion = 1;
    s.player ||= {};
    s.player.inv ||= {};
    if (s.player.rep?.sunspire !== undefined) { s.player.rep.valdenmere = s.player.rep.sunspire; delete s.player.rep.sunspire; }
    if (s.player.rep?.gloomwharf !== undefined) { s.player.rep.ashport = s.player.rep.gloomwharf; delete s.player.rep.gloomwharf; }
    if (s.player.permits?.sunspire !== undefined) { s.player.permits.valdenmere = s.player.permits.sunspire; delete s.player.permits.sunspire; }
    if (s.player.permits?.gloomwharf !== undefined) { s.player.permits.ashport = s.player.permits.gloomwharf; delete s.player.permits.gloomwharf; }
    s.player.rep ||= { valdenmere: 0, ashport: 0, crosshaven: 0, ironholt: 0 };
    s.player.permits ||= { valdenmere: false, ashport: false, crosshaven: false, ironholt: false };
    for (const cid of ['valdenmere','ashport','crosshaven','ironholt']) {
      s.player.rep[cid] ??= 0;
      s.player.permits[cid] ??= false;
    }
    s.player.facing ||= { x: 0, y: 1 };
    s.time ||= { day: 1, frac: 0, seed: 1 };
    s.marketDrift ||= {};
    for (const cid of ['valdenmere','ashport','crosshaven','ironholt']) s.marketDrift[cid] ||= {};
    if (s.marketDrift.sunspire) { s.marketDrift.valdenmere = s.marketDrift.sunspire; delete s.marketDrift.sunspire; }
    if (s.marketDrift.gloomwharf) { s.marketDrift.ashport = s.marketDrift.gloomwharf; delete s.marketDrift.gloomwharf; }
    s.contracts ||= { active: null };
    if (s.contracts.active === undefined) s.contracts.active = null;
    if (!Array.isArray(s.openedCaches)) s.openedCaches = [];
  }
  if (!Array.isArray(s.openedCaches)) s.openedCaches = [];
  return s;
}

// smoothPath (pure portion — no isSolid/player, just path compression logic)
function smoothPath(tilePath) {
  if (!tilePath || tilePath.length <= 2) return tilePath;
  // simplified: keep first, last, and direction-change waypoints
  const out = [tilePath[0]];
  for (let i = 1; i < tilePath.length - 1; i++) {
    const prev = tilePath[i - 1];
    const cur  = tilePath[i];
    const next = tilePath[i + 1];
    const dx1 = cur.x - prev.x, dy1 = cur.y - prev.y;
    const dx2 = next.x - cur.x, dy2 = next.y - cur.y;
    if (dx1 !== dx2 || dy1 !== dy2) out.push(cur);
  }
  out.push(tilePath[tilePath.length - 1]);
  return out;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n=== hash2 ===');
test('returns a number in [0,1]', () => {
  const v = hash2(3, 7);
  assert(v >= 0 && v <= 1, `out of range: ${v}`);
});
test('deterministic: same inputs → same output', () => {
  assertEqual(hash2(10, 20), hash2(10, 20));
});
test('different inputs → different outputs', () => {
  assert(hash2(1, 2) !== hash2(2, 1), 'hash2(1,2) should differ from hash2(2,1)');
});
test('handles zero inputs', () => {
  const v = hash2(0, 0);
  assert(typeof v === 'number', 'should be a number');
});

console.log('\n=== seeded01 ===');
test('returns a number in [0,1]', () => {
  const v = seeded01(100, 200, 300);
  assert(v >= 0 && v <= 1, `out of range: ${v}`);
});
test('deterministic', () => {
  assertEqual(seeded01(1, 2, 3), seeded01(1, 2, 3));
});
test('third arg defaults to 0', () => {
  assertEqual(seeded01(5, 6), seeded01(5, 6, 0));
});
test('different inputs vary output', () => {
  assert(seeded01(1, 1, 1) !== seeded01(2, 2, 2), 'should differ');
});

console.log('\n=== citySeed ===');
test('known cities return correct seeds', () => {
  assertEqual(citySeed('valdenmere'), 1337);
  assertEqual(citySeed('ashport'), 7331);
  assertEqual(citySeed('crosshaven'), 4219);
  assertEqual(citySeed('ironholt'), 9901);
});
test('unknown city returns fallback 5555', () => {
  assertEqual(citySeed('unknowncity'), 5555);
});

console.log('\n=== townItemModifier ===');
test('returns a positive multiplier', () => {
  const m = townItemModifier('valdenmere', 'grain');
  assert(m > 0, `modifier must be positive, got ${m}`);
});
test('modifier is in reasonable range (0.76 – 1.24)', () => {
  const m = townItemModifier('ashport', 'ore');
  assert(m >= 0.76 && m <= 1.24, `modifier ${m} out of expected range`);
});
test('deterministic per city+item', () => {
  assertEqual(
    townItemModifier('crosshaven', 'potion'),
    townItemModifier('crosshaven', 'potion')
  );
});
test('different cities give different modifiers for same item', () => {
  assert(
    townItemModifier('valdenmere', 'grain') !== townItemModifier('ashport', 'grain'),
    'cities should differ'
  );
});

console.log('\n=== referencePrice ===');
test('rounds to nearest integer', () => {
  assertEqual(referencePrice({ base: 7.6 }), 8);
  assertEqual(referencePrice({ base: 7.4 }), 7);
});
test('minimum is 1', () => {
  assertEqual(referencePrice({ base: 0 }), 1);
  assertEqual(referencePrice({ base: -5 }), 1);
});
test('normal price passthrough', () => {
  assertEqual(referencePrice({ base: 50 }), 50);
});

console.log('\n=== midPriceFor ===');
test('returns a positive integer', () => {
  const p = midPriceFor('valdenmere', { id: 'grain', base: 10 });
  assert(Number.isInteger(p) && p >= 1, `got ${p}`);
});
test('minimum is 1 even for tiny base', () => {
  const p = midPriceFor('ashport', { id: 'grain', base: 0.001 });
  assert(p >= 1, `got ${p}`);
});

console.log('\n=== quoteFor ===');
test('buy >= sell', () => {
  const q = quoteFor('valdenmere', { id: 'ore', base: 14 });
  assert(q.buy >= q.sell, `buy ${q.buy} < sell ${q.sell}`);
});
test('all fields present', () => {
  const q = quoteFor('ashport', { id: 'potion', base: 30 });
  assert('mid' in q && 'buy' in q && 'sell' in q, 'missing fields');
});
test('market discount lowers buy price', () => {
  const item = { id: 'grain', base: 20 };
  const qNormal   = quoteFor('ashport', item, 0, {});
  const qDiscount = quoteFor('ashport', item, 0, { ashport: { marketDiscount: 0.1 } });
  assert(qDiscount.buy <= qNormal.buy, 'discount should lower buy price');
});

console.log('\n=== fmtDeltaPct ===');
test('zero reference returns empty string', () => {
  assertEqual(fmtDeltaPct(100, 0), '');
});
test('positive delta returns +N%', () => {
  assertEqual(fmtDeltaPct(110, 100), '+10%');
});
test('negative delta returns -N%', () => {
  assertEqual(fmtDeltaPct(90, 100), '-10%');
});
test('no change returns +0%', () => {
  assertEqual(fmtDeltaPct(100, 100), '+0%');
});
test('rounds correctly', () => {
  // 105/100 = +5%, 95/100 = -5%
  assertEqual(fmtDeltaPct(105, 100), '+5%');
  assertEqual(fmtDeltaPct(95, 100), '-5%');
});

console.log('\n=== htmlEscape ===');
test('escapes ampersand', () => {
  assertEqual(htmlEscape('a&b'), 'a&amp;b');
});
test('escapes less-than', () => {
  assertEqual(htmlEscape('<script>'), '&lt;script&gt;');
});
test('escapes double quotes', () => {
  assertEqual(htmlEscape('"hello"'), '&quot;hello&quot;');
});
test('escapes single quotes', () => {
  assertEqual(htmlEscape("it's"), 'it&#39;s');
});
test('handles null/undefined → empty string', () => {
  assertEqual(htmlEscape(null), '');
  assertEqual(htmlEscape(undefined), '');
});
test('plain text unchanged', () => {
  assertEqual(htmlEscape('hello world'), 'hello world');
});

console.log('\n=== rewardForContract ===');
test('relic qty=1 is in [18,280]', () => {
  const r = rewardForContract('relic', 1);
  assert(r >= 18 && r <= 280, `got ${r}`);
});
test('relic qty=1 exact value (buyCostRef=53 + deliveryPremium=22 = 75)', () => {
  assertEqual(rewardForContract('relic', 1), 75);
});
test('potion reward > grain reward (same qty)', () => {
  assert(rewardForContract('potion', 1) > rewardForContract('grain', 1), 'potion should pay more');
});
test('ink reward > grain reward (same qty)', () => {
  assert(rewardForContract('ink', 1) > rewardForContract('grain', 1), 'ink should pay more than grain');
});
test('ink qty=1 exact value (buyCostRef=66 + deliveryPremium=16 = 82)', () => {
  assertEqual(rewardForContract('ink', 1), 82);
});
test('higher qty → higher reward', () => {
  assert(rewardForContract('ore', 3) > rewardForContract('ore', 1), 'more qty → more reward');
});
test('qty=2 multiplier (~1.75× qty=1)', () => {
  const q1 = rewardForContract('herbs', 1); // perUnit=29 → r=29
  const q2 = rewardForContract('herbs', 2); // perUnit=29 × 1.75 → r=51
  assert(q2 > q1, `qty=2 (${q2}) should exceed qty=1 (${q1})`);
  // ratio should be close to 1.75
  const ratio = q2 / q1;
  assert(ratio > 1.5 && ratio < 2.0, `ratio ${ratio.toFixed(2)} out of expected 1.5–2.0`);
});
test('qty=3 multiplier (~2.35× qty=1)', () => {
  const q1 = rewardForContract('food', 1); // perUnit=20 → r=20
  const q3 = rewardForContract('food', 3); // perUnit=20 × 2.35 → r=47
  assert(q3 > q1, `qty=3 (${q3}) should exceed qty=1 (${q1})`);
  const ratio = q3 / q1;
  assert(ratio > 2.0 && ratio < 2.7, `ratio ${ratio.toFixed(2)} out of expected 2.0–2.7`);
});
test('clamp ceiling is 280 (relic qty=3 would be 176, below 280)', () => {
  // relic: perUnit=75, qtyMult=2.35 → r=round(176.25)=176 — above old 160 ceiling, below new 280
  const r = rewardForContract('relic', 3);
  assertEqual(r, 176, `expected 176, got ${r}`);
});
test('clamp ceiling 280 not 160: relic qty=3 exceeds old 160 ceiling', () => {
  assert(rewardForContract('relic', 3) > 160, 'relic qty=3 should exceed old 160 ceiling');
});
test('grain qty=1 hits floor: r=17 clamped to 18', () => {
  // grain: buyCostRef=round(8.8)=9, deliveryPremium=round(8.4)=8, perUnit=17, qtyMult=1.0 → r=17 → clamp=18
  assertEqual(rewardForContract('grain', 1), 18);
});
test('unknown item uses base=20 fallback without crash', () => {
  const r = rewardForContract('dragonskin', 1);
  assert(r >= 18 && r <= 280, `got ${r}`);
});
test('unknown item bestMarginRef falls back to 5', () => {
  // base=20: buyCostRef=round(17.6)=18, deliveryPremium=round(6)=6, perUnit=24, qty=1 → r=24
  assertEqual(rewardForContract('dragonskin', 1), 24);
});

console.log('\n=== contractTierForRep ===');
test('rep < 3 → tier 0', () => {
  assertEqual(contractTierForRep(0), 0);
  assertEqual(contractTierForRep(2), 0);
});
test('rep 3–6 → tier 1', () => {
  assertEqual(contractTierForRep(3), 1);
  assertEqual(contractTierForRep(6), 1);
});
test('rep >= 7 → tier 2', () => {
  assertEqual(contractTierForRep(7), 2);
  assertEqual(contractTierForRep(100), 2);
});
test('string rep coerced to number', () => {
  assertEqual(contractTierForRep('5'), 1);
});
test('non-numeric rep defaults to 0 (tier 0)', () => {
  assertEqual(contractTierForRep(null), 0);
  assertEqual(contractTierForRep(undefined), 0);
  assertEqual(contractTierForRep('abc'), 0);
});

console.log('\n=== isObj ===');
test('plain object → true', () => assert(isObj({})));
test('array → true', () => assert(isObj([])));
test('null → false', () => assert(!isObj(null)));
test('number → false', () => assert(!isObj(42)));
test('string → false', () => assert(!isObj('hi')));

console.log('\n=== validateSave ===');
function makeSave(overrides = {}) {
  return {
    saveVersion: 1,
    player: {
      x: 100, y: 200, gold: 50, capacity: 10,
      inv: {}, rep: {}, permits: {},
      facing: { x: 1, y: 0 },
      lastCityId: 'ashport',
    },
    time: { day: 1, frac: 0.5, seed: 99 },
    ...overrides,
  };
}

test('valid save → ok', () => {
  const r = validateSave(makeSave());
  assert(r.ok, `errors: ${r.errors.join(', ')}`);
});
test('non-object → fail or throw (not ok)', () => {
  // validateSave may throw when given null because it accesses s.contracts
  // after recording the top-level error. Either a throw or ok:false is
  // acceptable defensive behaviour.
  for (const bad of [null, 'string', 42]) {
    let ok = false;
    try { ok = validateSave(bad).ok; } catch { ok = false; }
    assert(!ok, `expected failure for ${JSON.stringify(bad)}`);
  }
});
test('missing player → fail', () => {
  const s = makeSave();
  delete s.player;
  assert(!validateSave(s).ok);
});
test('non-finite player.gold → fail', () => {
  const s = makeSave({ player: { ...makeSave().player, gold: NaN } });
  assert(!validateSave(s).ok);
});
test('missing time → fail', () => {
  const s = makeSave();
  delete s.time;
  assert(!validateSave(s).ok);
});
test('saveVersion non-integer → fail', () => {
  assert(!validateSave(makeSave({ saveVersion: 1.5 })).ok);
});
test('saveVersion absent → ok (legacy)', () => {
  const s = makeSave();
  delete s.saveVersion;
  assert(validateSave(s).ok);
});
test('openedCaches not array → fail', () => {
  assert(!validateSave(makeSave({ openedCaches: 'bad' })).ok);
});
test('openedCaches as array → ok', () => {
  assert(validateSave(makeSave({ openedCaches: [] })).ok);
});
test('lastCityId null → ok', () => {
  const s = makeSave();
  s.player.lastCityId = null;
  assert(validateSave(s).ok);
});
test('lastCityId number → fail', () => {
  const s = makeSave();
  s.player.lastCityId = 42;
  assert(!validateSave(s).ok);
});
test('gear absent → ok (optional field)', () => {
  const s = makeSave();
  delete s.player.gear;
  assert(validateSave(s).ok);
});
test('gear valid integers → ok', () => {
  const s = makeSave();
  s.player.gear = { pack: 1, boots: 0, tool: 2 };
  assert(validateSave(s).ok, JSON.stringify(validateSave(s).errors));
});
test('gear not an object → fail', () => {
  const s = makeSave();
  s.player.gear = 'bad';
  assert(!validateSave(s).ok);
});
test('gear slot is float → fail', () => {
  const s = makeSave();
  s.player.gear = { pack: 1.5, boots: 0, tool: 0 };
  assert(!validateSave(s).ok);
});
test('gear slot is string → fail', () => {
  const s = makeSave();
  s.player.gear = { pack: 'max', boots: 0, tool: 0 };
  assert(!validateSave(s).ok);
});
test('gear pickaxe tier integer → ok', () => {
  const s = makeSave();
  s.player.gear = { pack: 0, boots: 0, tool: 0, pickaxe: 3 };
  assert(validateSave(s).ok, JSON.stringify(validateSave(s).errors));
});
test('gear pickaxe non-integer → fail', () => {
  const s = makeSave();
  s.player.gear = { pack: 0, boots: 0, tool: 0, pickaxe: 'max' };
  assert(!validateSave(s).ok);
});
// mineCooldown is stateTime-relative and intentionally NOT serialized by the
// current saveGame, but validateSave still accepts both shapes: the new
// (absent) format and legacy saves that carry the field. _applyLoadedState
// migrates legacy entries to {} on load.
test('mineCooldown absent → ok (current saveGame format)', () => {
  const s = makeSave();
  assert(s.player.mineCooldown === undefined,
    'baseline: makeSave does not include mineCooldown');
  assert(validateSave(s).ok, JSON.stringify(validateSave(s).errors));
});
test('mineCooldown present → ok (legacy save format)', () => {
  const s = makeSave();
  s.player.mineCooldown = { '12345': 999999 };
  assert(validateSave(s).ok, JSON.stringify(validateSave(s).errors));
});
// Cooldown overlay decision mirror: the canvas branch in src/main.js renders
// a vein as "spent" (gray + amber hourglass-pip) instead of active when its
// stored cooldown timestamp is still in the future of stateTime. This is the
// pure decision logic — the renderer just dispatches on its boolean result.
function veinInCooldown(mineCooldown, key, stateTime) {
  return !!(mineCooldown && (mineCooldown[key] || 0) > stateTime);
}
test('vein cooldown: empty map → active (not in cooldown)', () => {
  assert(veinInCooldown({}, 100, 50) === false);
});
test('vein cooldown: timestamp in past → active (cooldown expired)', () => {
  assert(veinInCooldown({ 100: 40 }, 100, 50) === false);
});
test('vein cooldown: timestamp equal to stateTime → active (expires at now)', () => {
  assert(veinInCooldown({ 100: 50 }, 100, 50) === false);
});
test('vein cooldown: timestamp in future → spent (show cooldown icon)', () => {
  assert(veinInCooldown({ 100: 60 }, 100, 50) === true);
});
test('vein cooldown: only the queried key matters', () => {
  // Other keys having future cooldowns must not bleed onto the queried vein.
  assert(veinInCooldown({ 100: 60, 200: 10 }, 200, 50) === false);
  assert(veinInCooldown({ 100: 60, 200: 99 }, 200, 50) === true);
});
// Loot-popup stack decision mirror: when the player gains or loses items in
// rapid succession the renderer collapses identical-itemId popups within a
// short window into a single "+N"/"-N" entry so the screen doesn't spam.
// qty is signed (+ gain, - loss); only same-sign popups merge — a gain must
// never cancel out a loss popup visually. The same itemId outside the
// window, an opposite sign, or a different itemId queues a new popup.
function stackPopup(queue, popup, stackWindowMs, nowMs) {
  const last = queue[queue.length - 1];
  if (last && last.itemId === popup.itemId &&
      Math.sign(last.qty) === Math.sign(popup.qty) &&
      (nowMs - last.startMs) < stackWindowMs) {
    last.qty += popup.qty;
    last.startMs = nowMs;
    return queue;
  }
  return [...queue, { ...popup, startMs: nowMs }];
}
test('loot popup: same item within window stacks qty into latest popup', () => {
  let q = [];
  q = stackPopup(q, { itemId: 'copper', qty: 3 }, 300, 0);
  q = stackPopup(q, { itemId: 'copper', qty: 2 }, 300, 100);
  assert(q.length === 1, `expected 1 popup, got ${q.length}`);
  assert(q[0].qty === 5, `expected stacked qty=5, got ${q[0].qty}`);
  assert(q[0].startMs === 100, `expected timer refresh to nowMs=100, got ${q[0].startMs}`);
});
test('loot popup: same item OUTSIDE window starts a fresh popup', () => {
  let q = [];
  q = stackPopup(q, { itemId: 'copper', qty: 3 }, 300, 0);
  q = stackPopup(q, { itemId: 'copper', qty: 2 }, 300, 500);
  assert(q.length === 2, `expected 2 popups (stale window), got ${q.length}`);
  assert(q[0].qty === 3 && q[1].qty === 2);
});
test('loot popup: different items queue separately even within window', () => {
  let q = [];
  q = stackPopup(q, { itemId: 'copper', qty: 3 }, 300, 0);
  q = stackPopup(q, { itemId: 'coal',   qty: 1 }, 300, 50);
  q = stackPopup(q, { itemId: 'gem',    qty: 1 }, 300, 100);
  assert(q.length === 3, `expected 3 popups (distinct items), got ${q.length}`);
  assert(q[0].itemId === 'copper' && q[1].itemId === 'coal' && q[2].itemId === 'gem');
});
test('loot popup: stacking only checks the LAST entry, not earlier ones', () => {
  // If a different item interrupts, the next same-item entry starts fresh.
  let q = [];
  q = stackPopup(q, { itemId: 'copper', qty: 3 }, 300, 0);
  q = stackPopup(q, { itemId: 'coal',   qty: 1 }, 300, 50);
  q = stackPopup(q, { itemId: 'copper', qty: 1 }, 300, 100);
  assert(q.length === 3, `expected 3 popups (copper not stacked through coal), got ${q.length}`);
  assert(q[0].qty === 3 && q[2].qty === 1);
});
test('loot popup: losses stack with losses of the same item within window', () => {
  let q = [];
  q = stackPopup(q, { itemId: 'food', qty: -1 }, 300, 0);
  q = stackPopup(q, { itemId: 'food', qty: -2 }, 300, 100);
  assert(q.length === 1, `expected 1 loss popup, got ${q.length}`);
  assert(q[0].qty === -3, `expected stacked qty=-3, got ${q[0].qty}`);
});
test('loot popup: a gain never merges into a loss popup (opposite signs)', () => {
  let q = [];
  q = stackPopup(q, { itemId: 'food', qty: -1 }, 300, 0);
  q = stackPopup(q, { itemId: 'food', qty: 2 }, 300, 100);
  assert(q.length === 2, `expected 2 popups (loss then gain kept apart), got ${q.length}`);
  assert(q[0].qty === -1 && q[1].qty === 2, `expected [-1, +2], got [${q[0].qty}, ${q[1].qty}]`);
});
// Lifecycle mirror of drawLootPopups' age-out pass: keep popups whose age
// is < lifetimeMs, drop the rest. The src/main.js render path does exactly
// this in-place during the draw call.
function ageOutPopups(queue, nowMs, lifetimeMs) {
  return queue.filter(p => (nowMs - p.startMs) < lifetimeMs);
}
test('loot popup lifecycle: at age=0 the popup is kept (no render = no expiry)', () => {
  const q = [{ itemId: 'copper', qty: 3, startMs: 100 }];
  const kept = ageOutPopups(q, 100, 1500);
  assert(kept.length === 1, `freshly spawned popup must survive (got ${kept.length})`);
});
test('loot popup lifecycle: at age < lifetime the popup is kept', () => {
  const q = [{ itemId: 'copper', qty: 3, startMs: 100 }];
  const kept = ageOutPopups(q, 1599, 1500); // age = 1499 < 1500
  assert(kept.length === 1, `popup at age=1499ms must survive (got ${kept.length})`);
});
test('loot popup lifecycle: at age = lifetime the popup is removed', () => {
  const q = [{ itemId: 'copper', qty: 3, startMs: 100 }];
  const kept = ageOutPopups(q, 1600, 1500); // age = 1500, NOT < 1500
  assert(kept.length === 0, `popup at age=lifetime must expire (got ${kept.length})`);
});
test('loot popup lifecycle: mixed-age queue prunes only expired entries', () => {
  const q = [
    { itemId: 'copper', qty: 3, startMs:    0 }, // age 2000 (expired)
    { itemId: 'gem',    qty: 1, startMs:  800 }, // age 1200 (kept)
    { itemId: 'silver', qty: 2, startMs: 1900 }, // age  100 (kept)
  ];
  const kept = ageOutPopups(q, 2000, 1500);
  assert(kept.length === 2, `expected 2 survivors (gem + silver), got ${kept.length}`);
  assert(kept[0].itemId === 'gem' && kept[1].itemId === 'silver');
});
test('marketDrift absent → ok', () => {
  const s = makeSave();
  assert(validateSave(s).ok);
});
test('marketDrift as object → ok', () => {
  assert(validateSave(makeSave({ marketDrift: { valdenmere: {} } })).ok);
});
test('marketDrift not an object → fail', () => {
  assert(!validateSave(makeSave({ marketDrift: 'bad' })).ok);
});

console.log('\n=== migrateSave ===');
function makeV0Save(overrides = {}) {
  // v0 save: no saveVersion, old city ids
  return {
    player: {
      x: 10, y: 20, gold: 100, capacity: 10,
      inv: {}, rep: { sunspire: 3 }, permits: { sunspire: true },
      facing: { x: 1, y: 0 },
    },
    time: { day: 2, frac: 0.3, seed: 42 },
    ...overrides,
  };
}
test('v0 → v1: saveVersion set to 1', () => {
  const out = migrateSave(makeV0Save());
  assertEqual(out.saveVersion, 1);
});
test('v0 → v1: sunspire rep migrated to valdenmere', () => {
  const out = migrateSave(makeV0Save());
  assertEqual(out.player.rep.valdenmere, 3);
  assert(out.player.rep.sunspire === undefined, 'sunspire key should be deleted');
});
test('v0 → v1: sunspire permit migrated to valdenmere', () => {
  const out = migrateSave(makeV0Save());
  assertEqual(out.player.permits.valdenmere, true);
  assert(out.player.permits.sunspire === undefined, 'sunspire permit key should be deleted');
});
test('v0 → v1: all city rep keys present after migration', () => {
  const out = migrateSave(makeV0Save());
  for (const cid of ['valdenmere', 'ashport', 'crosshaven', 'ironholt']) {
    assert(cid in out.player.rep, `rep missing key: ${cid}`);
  }
});
test('v0 → v1: openedCaches defaulted to []', () => {
  const out = migrateSave(makeV0Save());
  assert(Array.isArray(out.openedCaches) && out.openedCaches.length === 0);
});
test('v0 → v1: marketDrift created with all city keys', () => {
  const out = migrateSave(makeV0Save());
  for (const cid of ['valdenmere', 'ashport', 'crosshaven', 'ironholt']) {
    assert(isObj(out.marketDrift[cid]), `marketDrift missing: ${cid}`);
  }
});
test('v0 → v1: gloomwharf marketDrift migrated to ashport', () => {
  const raw = makeV0Save();
  raw.marketDrift = { gloomwharf: { grain: 0.1 } };
  const out = migrateSave(raw);
  assert(isObj(out.marketDrift.ashport), 'ashport should exist');
  assert(out.marketDrift.gloomwharf === undefined, 'gloomwharf key should be deleted');
});
test('v1 → v1: no changes applied (idempotent)', () => {
  const save = makeSave();
  const out = migrateSave(save);
  assertEqual(out.saveVersion, 1);
  assertEqual(out.player.gold, save.player.gold);
});
test('future version: returned as-is without mangling', () => {
  const futureSave = { saveVersion: 99, player: { x: 1, y: 2 }, time: {}, custom: 'data' };
  const out = migrateSave(futureSave);
  assertEqual(out.saveVersion, 99);
  assertEqual(out.custom, 'data');
});
test('future version: openedCaches not injected (schema unknown)', () => {
  const futureSave = { saveVersion: 99, player: {}, time: {} };
  const out = migrateSave(futureSave);
  // v0 defaulting logic should NOT run for future versions
  assert(out.openedCaches === undefined, 'should not inject openedCaches for unknown future version');
});

console.log('\n=== smoothPath ===');
test('null → null', () => assert(smoothPath(null) === null));
test('single point preserved', () => {
  const p = [{ x: 0, y: 0 }];
  assertEqual(smoothPath(p), p);
});
test('two points preserved', () => {
  const p = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  assertEqual(smoothPath(p).length, 2);
});
test('straight line collapses to endpoints', () => {
  const path = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
  ];
  const out = smoothPath(path);
  assertEqual(out.length, 2, `expected 2 points, got ${out.length}`);
  assertEqual(out[0].x, 0);
  assertEqual(out[1].x, 3);
});
test('L-shaped path keeps corner', () => {
  const path = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 },
  ];
  const out = smoothPath(path);
  // start, corner, end
  assertEqual(out.length, 3, `expected 3, got ${out.length}: ${JSON.stringify(out)}`);
});

// ─── _pickNewerSave ───────────────────────────────────────────────────────────
// Pure function extracted from loadGameAsync() — determines whether DB or
// localStorage wins when both saves exist.
// Mirrors the logic in src/main.js _pickNewerSave().
function pickNewerSave(dbData, localData) {
  const dbTs    = dbData?.savedAt   || 0;
  const localTs = localData?.savedAt || 0;
  const dbDay   = dbData?.time?.day   || 0;
  const localDay = localData?.time?.day || 0;
  if (dbTs > 0 && localTs > 0) {
    return dbTs >= localTs ? 'db' : 'local';
  }
  return dbDay >= localDay ? 'db' : 'local';
}

console.log('\n=== pickNewerSave ===');

test('db newer timestamp → db wins', () => {
  const db    = { savedAt: 2000, time: { day: 1 } };
  const local = { savedAt: 1000, time: { day: 1 } };
  assert(pickNewerSave(db, local) === 'db');
});

test('local newer timestamp → local wins (the gear-buy bug)', () => {
  // Exact scenario: player buys gear on day 1, DB still has pre-purchase save
  const db    = { savedAt: 1000, time: { day: 1 }, player: { gold: 220 } };
  const local = { savedAt: 2000, time: { day: 1 }, player: { gold: 110 } };
  assert(pickNewerSave(db, local) === 'local');
});

test('equal timestamps → db wins (tie goes to db)', () => {
  const db    = { savedAt: 1000, time: { day: 1 } };
  const local = { savedAt: 1000, time: { day: 1 } };
  assert(pickNewerSave(db, local) === 'db');
});

test('no timestamps, db higher day → db wins', () => {
  const db    = { time: { day: 5 } };
  const local = { time: { day: 3 } };
  assert(pickNewerSave(db, local) === 'db');
});

test('no timestamps, local higher day → local wins', () => {
  const db    = { time: { day: 3 } };
  const local = { time: { day: 5 } };
  assert(pickNewerSave(db, local) === 'local');
});

test('no timestamps, same day → db wins (legacy tie-break)', () => {
  const db    = { time: { day: 1 } };
  const local = { time: { day: 1 } };
  assert(pickNewerSave(db, local) === 'db');
});

test('only db has timestamp → fall back to day comparison', () => {
  const db    = { savedAt: 9999, time: { day: 1 } };
  const local = { time: { day: 1 } }; // no savedAt
  // localTs === 0 so timestamp branch skipped, day comparison: 1 >= 1 → db
  assert(pickNewerSave(db, local) === 'db');
});

test('null db → local wins (dbDay=0 < localDay=1)', () => {
  assert(pickNewerSave(null, { savedAt: 1000, time: { day: 1 } }) === 'local');
});

// ─── Road events: wealth-scaled stakes + context-weighted selection ──────────
// Mirrors cargoMarketValue / roadStakes / roadEventWeights / pickWeighted in
// src/main.js (copy verbatim on any change). Road events must scale with what
// the player stands to lose (gold + cargo value) and be picked deterministically
// from a context-weighted table — no Math.random in selection.

// cargoMarketValue — mirrors src/main.js
function cargoMarketValue(inv, items) {
  let v = 0;
  for (const it of items) v += (inv[it.id] || 0) * it.base;
  return v;
}

// roadStakes — mirrors src/main.js
function roadStakes(gold, cargoVal) {
  const wealth = Math.max(0, gold || 0) + Math.max(0, cargoVal || 0);
  const heat = Math.min(1, wealth / 600); // 600g total wealth = fully "worth robbing"
  return {
    wealth,
    heat,
    banditDemand: Math.min(150, Math.max(12, Math.round(wealth * 0.12))),
    toll:         Math.min(60,  Math.max(8,  Math.round(wealth * 0.05))),
    shelter:      Math.min(25,  Math.max(4,  Math.round(wealth * 0.02))),
    quarantine:   Math.min(45,  Math.max(10, Math.round(wealth * 0.04))),
    escortPay:    Math.round(12 + heat * 28),
    omenFind:     Math.round(5 + heat * 20),
    fightLoot:    Math.round(10 + heat * 30),
    dropCount:    cargoVal >= 240 ? 3 : cargoVal >= 80 ? 2 : 1,
  };
}

// roadEventWeights — mirrors src/main.js
function roadEventWeights(ctx) {
  const w = {
    bandits: 1 + (ctx.heat || 0) * 2, // valuable travelers attract predators
    toll: 1, storm: 1, omen: 1, escort: 1,
    wandering_merchant: 1, wounded_soldier: 1, plague_cart: 0.7,
    lost_cargo: 1, wild_animal: 1, hermit: 1, waystone: 1,
  };
  if ((ctx.cargoVal || 0) <= 0) w.bandits = 0.25; // empty pack — nothing to rob
  if ((ctx.food || 0) <= 0) { w.wandering_merchant += 1; w.hermit += 0.75; }
  if (ctx.patrolOk) w.patrol = ctx.hasContraband ? 2.5 : 1;
  return w;
}

// eventChoiceLocked — mirrors src/main.js
// Input lock right after an event dialog opens, so a tap meant for movement
// can never activate a choice. Driven by stateTime (deterministic frame clock);
// a clock reset (now < openedAt) must unlock, never permanently lock.
function eventChoiceLocked(nowMs, openedAtMs, lockMs) {
  if (typeof openedAtMs !== 'number') return false; // legacy/QA path — unlocked
  if (nowMs < openedAtMs) return false;             // clock reset — unlocked
  return (nowMs - openedAtMs) < lockMs;
}

// EVENT_THEMES / eventThemeFor — mirrors src/main.js
// threat:true events are forced encounters: no X button, Esc is refused.
const EVENT_THEMES = {
  bandits:            { icon: '⚔️', accent: '#c0392b', threat: true },
  toll:               { icon: '🛑', accent: '#b0722a', threat: true },
  patrol:             { icon: '🛡️', accent: '#3d6da8', threat: true },
  plague_cart:        { icon: '☠️', accent: '#5b6e5a', threat: true },
  wild_animal:        { icon: '🐺', accent: '#7a4a2b', threat: true },
  storm:              { icon: '⛈️', accent: '#5a6472', threat: false },
  omen:               { icon: '✨', accent: '#d18816', threat: false },
  escort:             { icon: '🤝', accent: '#4f9e5b', threat: false },
  wandering_merchant: { icon: '🧺', accent: '#8a5aa3', threat: false },
  wounded_soldier:    { icon: '🩹', accent: '#a8485e', threat: false },
  lost_cargo:         { icon: '📦', accent: '#a87a3e', threat: false },
  hermit:             { icon: '🔥', accent: '#e57389', threat: false },
  waystone:           { icon: '🗿', accent: '#7fbf83', threat: false },
  default:            { icon: '❗', accent: '#7c5cd6', threat: false },
};

function eventThemeFor(kind) {
  return EVENT_THEMES[kind] || EVENT_THEMES.default;
}

// pickWeighted — mirrors src/main.js
function pickWeighted(weights, roll) {
  const keys = Object.keys(weights).filter(k => weights[k] > 0);
  if (keys.length === 0) return null;
  let total = 0;
  for (const k of keys) total += weights[k];
  let x = Math.min(0.999999999, Math.max(0, roll || 0)) * total;
  for (const k of keys) {
    x -= weights[k];
    if (x < 0) return k;
  }
  return keys[keys.length - 1];
}

const RE_ITEMS = [
  { id: 'grain', base: 10, weight: 1 },
  { id: 'relic', base: 60, weight: 2 },
  { id: 'ink',   base: 75, weight: 1, contrabandName: 'Demon Ink' },
];

console.log('\n=== cargoMarketValue ===');

test('empty inventory → 0', () => {
  assertEqual(cargoMarketValue({}, RE_ITEMS), 0);
});

test('sums qty × base across items', () => {
  assertEqual(cargoMarketValue({ grain: 3, relic: 1 }, RE_ITEMS), 90);
});

test('ignores ids not in the item list and missing counts', () => {
  assertEqual(cargoMarketValue({ mystery: 5, grain: 2 }, RE_ITEMS), 20);
});

console.log('\n=== roadStakes ===');

test('broke traveler hits the floors', () => {
  const s = roadStakes(0, 0);
  assertEqual(s.wealth, 0);
  assertEqual(s.heat, 0);
  assertEqual(s.banditDemand, 12);
  assertEqual(s.toll, 8);
  assertEqual(s.shelter, 4);
  assertEqual(s.quarantine, 10);
  assertEqual(s.escortPay, 12);
  assertEqual(s.omenFind, 5);
  assertEqual(s.fightLoot, 10);
  assertEqual(s.dropCount, 1);
});

test('starting player (220g, no cargo) pays meaningful stakes', () => {
  const s = roadStakes(220, 0);
  assertEqual(s.wealth, 220);
  assertClose(s.heat, 220 / 600, 1e-9);
  assertEqual(s.banditDemand, 26); // round(220 * 0.12)
  assertEqual(s.toll, 11);         // round(220 * 0.05)
  assertEqual(s.escortPay, 22);    // round(12 + heat*28)
});

test('rich trader (500g + 300g cargo) faces rich-trader stakes', () => {
  const s = roadStakes(500, 300);
  assertEqual(s.wealth, 800);
  assertEqual(s.heat, 1); // capped
  assertEqual(s.banditDemand, 96); // round(800 * 0.12)
  assertEqual(s.toll, 40);
  assertEqual(s.escortPay, 40);    // 12 + 28
  assertEqual(s.omenFind, 25);     // 5 + 20
  assertEqual(s.fightLoot, 40);    // 10 + 30
  assertEqual(s.dropCount, 3);     // cargo ≥ 240
});

test('stakes are capped so late-game is not absurd', () => {
  const s = roadStakes(5000, 0);
  assertEqual(s.banditDemand, 150);
  assertEqual(s.toll, 60);
  assertEqual(s.shelter, 25);
  assertEqual(s.quarantine, 45);
});

test('stakes grow monotonically with wealth', () => {
  assert(roadStakes(400, 0).banditDemand > roadStakes(200, 0).banditDemand);
  assert(roadStakes(0, 400).banditDemand > roadStakes(0, 200).banditDemand);
});

test('dropCount tiers with cargo value', () => {
  assertEqual(roadStakes(0, 0).dropCount, 1);
  assertEqual(roadStakes(0, 100).dropCount, 2);
  assertEqual(roadStakes(0, 300).dropCount, 3);
});

test('negative inputs are clamped, not amplified', () => {
  const s = roadStakes(-50, -10);
  assertEqual(s.wealth, 0);
  assertEqual(s.banditDemand, 12);
});

console.log('\n=== roadEventWeights ===');

const baseCtx = { cargoVal: 100, heat: 0.3, food: 2, hasContraband: false, patrolOk: false };

test('no patrol entry when patrol is on cooldown', () => {
  const w = roadEventWeights(baseCtx);
  assert(!('patrol' in w), 'patrol should be absent when patrolOk=false');
});

test('patrol appears when off cooldown, boosted by contraband', () => {
  const plain = roadEventWeights({ ...baseCtx, patrolOk: true });
  const smuggling = roadEventWeights({ ...baseCtx, patrolOk: true, hasContraband: true });
  assertEqual(plain.patrol, 1);
  assertEqual(smuggling.patrol, 2.5);
});

test('valuable cargo attracts bandits', () => {
  const poor = roadEventWeights({ ...baseCtx, heat: 0 });
  const rich = roadEventWeights({ ...baseCtx, heat: 1 });
  assertEqual(poor.bandits, 1);
  assertEqual(rich.bandits, 3); // 1 + heat*2
});

test('empty pack makes bandits nearly skip you', () => {
  const w = roadEventWeights({ ...baseCtx, cargoVal: 0, heat: 0 });
  assertEqual(w.bandits, 0.25);
});

test('no rations boosts food-seller encounters', () => {
  const fed = roadEventWeights(baseCtx);
  const hungry = roadEventWeights({ ...baseCtx, food: 0 });
  assert(hungry.wandering_merchant > fed.wandering_merchant);
  assert(hungry.hermit > fed.hermit);
});

console.log('\n=== pickWeighted ===');

test('deterministic: same roll → same pick', () => {
  const w = { a: 1, b: 2, c: 3 };
  assertEqual(pickWeighted(w, 0.5), pickWeighted(w, 0.5));
});

test('roll 0 → first positive-weight key', () => {
  assertEqual(pickWeighted({ a: 1, b: 1 }, 0), 'a');
});

test('roll near 1 → last key', () => {
  assertEqual(pickWeighted({ a: 1, b: 1 }, 0.999999), 'b');
});

test('zero-weight keys are never picked', () => {
  for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
    assertEqual(pickWeighted({ a: 0, b: 1 }, roll), 'b');
  }
});

test('picks proportionally to weight (boundary at 1/4 for {a:1,b:3})', () => {
  assertEqual(pickWeighted({ a: 1, b: 3 }, 0.24), 'a');
  assertEqual(pickWeighted({ a: 1, b: 3 }, 0.26), 'b');
});

test('roll ≥ 1 is clamped into range, not out of bounds', () => {
  assertEqual(pickWeighted({ a: 1, b: 1 }, 1), 'b');
});

test('empty table → null', () => {
  assertEqual(pickWeighted({}, 0.5), null);
  assertEqual(pickWeighted({ a: 0 }, 0.5), null);
});

console.log('\n=== eventChoiceLocked ===');

test('locked immediately after open', () => {
  assertEqual(eventChoiceLocked(100, 0, 400), true);
  assertEqual(eventChoiceLocked(399, 0, 400), true);
});

test('unlocked once lock window elapses', () => {
  assertEqual(eventChoiceLocked(400, 0, 400), false);
  assertEqual(eventChoiceLocked(500, 0, 400), false);
});

test('clock reset (now < openedAt) → unlocked, never a permanent lock', () => {
  assertEqual(eventChoiceLocked(0, 500, 400), false);
  assertEqual(eventChoiceLocked(10, 99999, 400), false);
});

test('missing/invalid openedAt → unlocked (legacy and QA paths)', () => {
  assertEqual(eventChoiceLocked(100, undefined, 400), false);
  assertEqual(eventChoiceLocked(100, null, 400), false);
});

console.log('\n=== eventThemeFor / EVENT_THEMES ===');

test('threat set is exactly the five forced encounters', () => {
  const threats = Object.keys(EVENT_THEMES).filter(k => EVENT_THEMES[k].threat).sort();
  assertEqual(JSON.stringify(threats), JSON.stringify(['bandits', 'patrol', 'plague_cart', 'toll', 'wild_animal']));
});

test('every event kind in the weight table has a theme', () => {
  const w = roadEventWeights({ cargoVal: 1, heat: 0, food: 1, hasContraband: true, patrolOk: true });
  for (const kind of Object.keys(w)) {
    assert(kind in EVENT_THEMES, `missing theme for '${kind}'`);
  }
});

test('every theme has an icon and accent color', () => {
  for (const [k, t] of Object.entries(EVENT_THEMES)) {
    assert(t.icon && t.icon.length > 0, `no icon for '${k}'`);
    assert(/^#[0-9a-f]{6}$/i.test(t.accent), `bad accent for '${k}': ${t.accent}`);
  }
});

test('unknown kind falls back to non-threat default', () => {
  const t = eventThemeFor('nonsense');
  assertEqual(t, EVENT_THEMES.default);
  assertEqual(t.threat, false);
  assertEqual(eventThemeFor(null), EVENT_THEMES.default);
});

test('known kind returns its own theme', () => {
  assertEqual(eventThemeFor('bandits'), EVENT_THEMES.bandits);
  assertEqual(eventThemeFor('bandits').threat, true);
});

// ─── DB layer (fetch-mocked) ──────────────────────────────────────────────────
// Tests for saveGameToDb / loadGameFromDb / deleteSaveFromDb.
// Each test gets its own context with an injected fetch stub so no real network
// calls are made. The factory mirrors the exact logic in src/main.js.

function makeDbContext({ playerId = 'player1', qaEnabled = false, economyEnabled = true, fetchStub } = {}) {
  const SUPABASE_URL = 'https://test.supabase.co';
  const SUPABASE_KEY = 'test-key';
  const calls = []; // recorded fetch invocations: { url, method, body }

  const defaultFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    return { ok: true, text: async () => '', json: async () => [] };
  };
  const fetch = fetchStub || defaultFetch;

  function economyHeaders() {
    return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  }

  let dbSaveInFlight = false;
  let dbSavePending  = null;

  async function saveGameToDb(state) {
    if (qaEnabled) return;
    if (!economyEnabled) return;
    if (dbSaveInFlight) { dbSavePending = state; return; }
    dbSaveInFlight = true;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/player_saves`, {
        method: 'POST',
        headers: { ...economyHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ uid: playerId, save_data: state, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) await res.text().catch(() => '');
    } catch {}
    finally {
      dbSaveInFlight = false;
      if (dbSavePending) {
        const pending = dbSavePending;
        dbSavePending = null;
        await saveGameToDb(pending);
      }
    }
  }

  async function loadGameFromDb() {
    if (playerId === '0') return null;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/player_saves?uid=eq.${encodeURIComponent(playerId)}&select=save_data`,
        { headers: economyHeaders() }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows[0].save_data;
    } catch { return null; }
  }

  async function deleteSaveFromDb() {
    if (qaEnabled || !economyEnabled) return;
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/player_saves?uid=eq.${encodeURIComponent(playerId)}`,
        { method: 'DELETE', headers: economyHeaders() }
      );
    } catch {}
  }

  return { saveGameToDb, loadGameFromDb, deleteSaveFromDb, calls };
}

// ─── Summary + async test runner ─────────────────────────────────────────────
// Sync tests already ran above. Async DB tests run here before the final count.

const _asyncTests = [];
function asyncTest(name, fn) { _asyncTests.push({ name, fn }); }

// saveGameToDb
asyncTest('saveGameToDb: QA mode → no fetch call', async () => {
  const ctx = makeDbContext({ qaEnabled: true });
  await ctx.saveGameToDb({ savedAt: 1 });
  assertEqual(ctx.calls.length, 0, 'should not call fetch in QA mode');
});
asyncTest('saveGameToDb: economy disabled → no fetch call', async () => {
  const ctx = makeDbContext({ economyEnabled: false });
  await ctx.saveGameToDb({ savedAt: 1 });
  assertEqual(ctx.calls.length, 0);
});
asyncTest('saveGameToDb: success → POST to player_saves with uid + save_data', async () => {
  const ctx = makeDbContext({ playerId: 'p42' });
  await ctx.saveGameToDb({ savedAt: 999, time: { day: 3 } });
  assertEqual(ctx.calls.length, 1);
  assertEqual(ctx.calls[0].method, 'POST');
  assert(ctx.calls[0].url.includes('/rest/v1/player_saves'), 'wrong endpoint');
  assertEqual(ctx.calls[0].body.uid, 'p42');
  assertEqual(ctx.calls[0].body.save_data.savedAt, 999);
});
asyncTest('saveGameToDb: HTTP error → swallowed, does not throw', async () => {
  const ctx = makeDbContext({
    fetchStub: async () => ({ ok: false, text: async () => 'bad request', json: async () => [] }),
  });
  await ctx.saveGameToDb({ savedAt: 1 }); // must not throw
});
asyncTest('saveGameToDb: network error → swallowed, does not throw', async () => {
  const ctx = makeDbContext({ fetchStub: async () => { throw new Error('network down'); } });
  await ctx.saveGameToDb({ savedAt: 1 }); // must not throw
});
asyncTest('saveGameToDb: in-flight lock queues second save', async () => {
  let unblockFirst;
  let callCount = 0;
  const ctx = makeDbContext({
    fetchStub: async (url, opts) => {
      ctx.calls.push({ url, method: opts.method || 'POST', body: JSON.parse(opts.body) });
      callCount++;
      if (callCount === 1) await new Promise(r => { unblockFirst = r; }); // only block first
      return { ok: true };
    },
  });
  const p1 = ctx.saveGameToDb({ savedAt: 1 });   // starts, blocks in fetch
  await Promise.resolve();                         // yield so p1 enters fetch
  ctx.saveGameToDb({ savedAt: 2 });               // queued as pending (returns immediately)
  assertEqual(ctx.calls.length, 1, 'only one fetch in flight');
  unblockFirst();
  await p1;
  await new Promise(r => setTimeout(r, 0));       // let pending flush
  assertEqual(ctx.calls.length, 2, 'pending save flushed after first completes');
  assertEqual(ctx.calls[1].body.save_data.savedAt, 2, 'pending state is the queued save');
});
asyncTest('saveGameToDb: only latest pending state sent (coalescing)', async () => {
  let unblockFirst;
  let callCount = 0;
  const ctx = makeDbContext({
    fetchStub: async (url, opts) => {
      ctx.calls.push({ body: JSON.parse(opts.body) });
      callCount++;
      if (callCount === 1) await new Promise(r => { unblockFirst = r; }); // only block first
      return { ok: true };
    },
  });
  const p1 = ctx.saveGameToDb({ savedAt: 10 });  // in flight, blocks
  await Promise.resolve();
  ctx.saveGameToDb({ savedAt: 20 });              // pending → 20
  ctx.saveGameToDb({ savedAt: 30 });              // overrides pending → 30
  ctx.saveGameToDb({ savedAt: 40 });              // overrides pending → 40
  unblockFirst();
  await p1;
  await new Promise(r => setTimeout(r, 0));
  assertEqual(ctx.calls.length, 2, 'exactly 2 fetches total');
  assertEqual(ctx.calls[1].body.save_data.savedAt, 40, 'only latest state (40) was sent, not 20 or 30');
});

// loadGameFromDb
asyncTest('loadGameFromDb: guest uid=0 → null without fetch', async () => {
  const ctx = makeDbContext({
    playerId: '0',
    fetchStub: async () => { throw new Error('should not be called'); },
  });
  const result = await ctx.loadGameFromDb();
  assert(result === null, 'guest must return null');
  assertEqual(ctx.calls.length, 0, 'no fetch for guest');
});
asyncTest('loadGameFromDb: non-guest, no rows → null', async () => {
  const ctx = makeDbContext({
    fetchStub: async (url, opts) => {
      ctx.calls.push({ url });
      return { ok: true, json: async () => [] };
    },
  });
  const result = await ctx.loadGameFromDb();
  assert(result === null);
  assertEqual(ctx.calls.length, 1, 'fetch was called');
});
asyncTest('loadGameFromDb: non-ok response → null', async () => {
  const ctx = makeDbContext({ fetchStub: async () => ({ ok: false, json: async () => [] }) });
  assert(await ctx.loadGameFromDb() === null);
});
asyncTest('loadGameFromDb: network error → null', async () => {
  const ctx = makeDbContext({ fetchStub: async () => { throw new Error('offline'); } });
  assert(await ctx.loadGameFromDb() === null);
});
asyncTest('loadGameFromDb: valid row → returns save_data', async () => {
  const saveData = { savedAt: 5000, time: { day: 7 }, player: { gold: 300 } };
  const ctx = makeDbContext({
    playerId: 'userX',
    fetchStub: async () => ({ ok: true, json: async () => [{ save_data: saveData }] }),
  });
  const result = await ctx.loadGameFromDb();
  assertEqual(result.savedAt, 5000);
  assertEqual(result.time.day, 7);
  assertEqual(result.player.gold, 300);
});
asyncTest('loadGameFromDb: URL includes uid filter', async () => {
  const ctx = makeDbContext({
    playerId: 'abc123',
    fetchStub: async (url, opts) => {
      ctx.calls.push({ url });
      return { ok: true, json: async () => [] };
    },
  });
  await ctx.loadGameFromDb();
  assert(ctx.calls[0].url.includes('uid=eq.abc123'), `URL missing uid filter: ${ctx.calls[0].url}`);
});

// deleteSaveFromDb
asyncTest('deleteSaveFromDb: QA mode → no fetch', async () => {
  const ctx = makeDbContext({ qaEnabled: true });
  await ctx.deleteSaveFromDb();
  assertEqual(ctx.calls.length, 0);
});
asyncTest('deleteSaveFromDb: economy disabled → no fetch', async () => {
  const ctx = makeDbContext({ economyEnabled: false });
  await ctx.deleteSaveFromDb();
  assertEqual(ctx.calls.length, 0);
});
asyncTest('deleteSaveFromDb: sends DELETE to player_saves with uid filter', async () => {
  const ctx = makeDbContext({
    playerId: 'del99',
    fetchStub: async (url, opts) => {
      ctx.calls.push({ url, method: opts.method });
      return { ok: true };
    },
  });
  await ctx.deleteSaveFromDb();
  assertEqual(ctx.calls.length, 1);
  assertEqual(ctx.calls[0].method, 'DELETE');
  assert(ctx.calls[0].url.includes('uid=eq.del99'), 'URL missing uid filter');
});
asyncTest('deleteSaveFromDb: network error → swallowed, does not throw', async () => {
  const ctx = makeDbContext({ fetchStub: async () => { throw new Error('gone'); } });
  await ctx.deleteSaveFromDb(); // must not throw
});

// ─── mine_ore_vein RPC outcome handling (fetch-mocked) ────────────────────────
// Mirrors the mine_ore_vein RPC branch in playerMineNode (src/main.js). A
// genuine 2xx response with body {ok:false} means real contention (another
// player's swing won the race). A non-2xx HTTP response means the RPC call
// itself failed (missing function, bad auth, paused project, etc.) — an
// infra problem, not contention — and must fail OPEN the same way a thrown
// network error already does. Otherwise every player is phantom-blocked
// with a fake "another miner" message the moment the backend hiccups.
function makeMineRpcContext({ fetchStub, key = 1, stateTime = 0, miningStaminaCost, mineStamina = 100 } = {}) {
  const player = { mineCooldown: {}, mineStamina, miningStaminaCost };
  let yielded = false;
  let toastMsg = null;
  function doMineYield() { yielded = true; }
  function toast(msg) { toastMsg = msg; }

  const staminaCost = player.miningStaminaCost ?? 15;
  player.mineCooldown[key] = stateTime + 30000; // optimistic local cooldown
  player.mineStamina = Math.max(0, player.mineStamina - staminaCost);

  const ready = fetchStub('mine_ore_vein_url', { method: 'POST' })
    .then(r => {
      if (!r.ok) throw new Error(`mine_ore_vein HTTP ${r.status}`);
      return r.json();
    })
    .then(result => {
      if (result?.ok) {
        doMineYield();
      } else {
        player.mineStamina = Math.min(100, player.mineStamina + staminaCost);
        const msLeft = result?.cooldown_remaining_ms || 30000;
        player.mineCooldown[key] = stateTime + msLeft;
        toast(`Another miner just worked this vein — try again in ${Math.ceil(msLeft / 1000)}s.`);
      }
    })
    .catch(() => {
      doMineYield();
    });

  return { player, ready, get yielded() { return yielded; }, get toastMsg() { return toastMsg; } };
}
asyncTest('mine RPC: HTTP error response → fails open, mines anyway (not phantom-blocked)', async () => {
  const ctx = makeMineRpcContext({
    key: 5, stateTime: 1000,
    fetchStub: async () => ({ ok: false, status: 500 }),
  });
  await ctx.ready;
  assert(ctx.yielded, 'HTTP failure must fail open and yield ore, not show "another miner"');
  assert(ctx.toastMsg === null, 'must not show the contested-vein toast on infra failure');
});
asyncTest('mine RPC: network error (thrown) → fails open, mines anyway', async () => {
  const ctx = makeMineRpcContext({
    key: 5, stateTime: 1000,
    fetchStub: async () => { throw new Error('offline'); },
  });
  await ctx.ready;
  assert(ctx.yielded, 'network failure must fail open');
});
asyncTest('mine RPC: clean 2xx {ok:true} → yields ore', async () => {
  const ctx = makeMineRpcContext({
    key: 5, stateTime: 1000,
    fetchStub: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  await ctx.ready;
  assert(ctx.yielded);
});
asyncTest('mine RPC: clean 2xx {ok:false} → genuine contention, no yield, cooldown from server', async () => {
  const ctx = makeMineRpcContext({
    key: 5, stateTime: 1000,
    fetchStub: async () => ({ ok: true, json: async () => ({ ok: false, cooldown_remaining_ms: 12000 }) }),
  });
  await ctx.ready;
  assert(!ctx.yielded, 'real contention must not yield ore');
  assertEqual(ctx.player.mineCooldown[5], 1000 + 12000, 'cooldown should use server-provided remaining ms');
  assert(/Another miner/.test(ctx.toastMsg || ''), 'should show contested-vein toast');
});
asyncTest('mine RPC: contention rollback refunds exactly the stamina that was deducted (upgraded pickaxe)', async () => {
  const ctx = makeMineRpcContext({
    key: 5, stateTime: 1000, miningStaminaCost: 8, mineStamina: 50, // e.g. Diamond-Tip Pick, not the 15-stamina default; start below the 100 cap so an over-refund is observable
    fetchStub: async () => ({ ok: true, json: async () => ({ ok: false, cooldown_remaining_ms: 12000 }) }),
  });
  await ctx.ready;
  assertEqual(ctx.player.mineStamina, 50, 'losing a contested swing must net zero stamina change, regardless of pickaxe tier');
});

// ─── open_cache RPC outcome handling (fetch-mocked) ───────────────────────────
// Mirrors the open_cache RPC branch in the hidden-cache event handler
// (src/main.js). Same fail-open contract as mine_ore_vein above: a non-2xx
// HTTP response is an infra problem, not a genuine "someone already looted
// this" response, and must fail OPEN like a thrown network error — not
// permanently mark the cache as looted with zero compensation.
function makeCacheRpcContext({ fetchStub, key = 'c1' } = {}) {
  const openedCaches = new Set();
  let lootApplied = false;
  let toastMsg = null;
  let saved = false;
  function applyLoot() { lootApplied = true; }
  function toast(msg) { toastMsg = msg; }

  const ready = fetchStub('open_cache_url', { method: 'POST' })
    .then(r => {
      if (!r.ok) throw new Error(`open_cache HTTP ${r.status}`);
      return r.json();
    })
    .then(result => {
      if (result?.ok) {
        openedCaches.add(key);
        applyLoot();
      } else {
        openedCaches.add(key); // don't prompt again locally
        toast('Already looted — empty crate.');
      }
      saved = true;
    })
    .catch(() => {
      openedCaches.add(key);
      applyLoot();
      saved = true;
    });

  return { openedCaches, ready, get lootApplied() { return lootApplied; }, get toastMsg() { return toastMsg; }, get saved() { return saved; } };
}
asyncTest('open_cache RPC: HTTP error response → fails open, loot applied (not permanently marked empty)', async () => {
  const ctx = makeCacheRpcContext({
    fetchStub: async () => ({ ok: false, status: 500 }),
  });
  await ctx.ready;
  assert(ctx.lootApplied, 'HTTP failure must fail open and grant loot, not silently mark the cache empty');
  assert(ctx.toastMsg === null, 'must not show the "already looted" toast on infra failure');
});
asyncTest('open_cache RPC: network error (thrown) → fails open, loot applied', async () => {
  const ctx = makeCacheRpcContext({
    fetchStub: async () => { throw new Error('offline'); },
  });
  await ctx.ready;
  assert(ctx.lootApplied, 'network failure must fail open');
});
asyncTest('open_cache RPC: clean 2xx {ok:true} → loot applied', async () => {
  const ctx = makeCacheRpcContext({
    fetchStub: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  await ctx.ready;
  assert(ctx.lootApplied);
});
asyncTest('open_cache RPC: clean 2xx {ok:false} → genuine already-looted, no loot, shows toast', async () => {
  const ctx = makeCacheRpcContext({
    fetchStub: async () => ({ ok: true, json: async () => ({ ok: false }) }),
  });
  await ctx.ready;
  assert(!ctx.lootApplied, 'real already-looted must not grant loot');
  assert(/Already looted/.test(ctx.toastMsg || ''), 'should show the already-looted toast');
});

// ─── Market keyboard navigation (extracted live from src/main.js) ────────────
// The SELL tab renders only held items (and no permit row), so the keyboard
// handler must cycle through exactly the rows the renderer shows — not the
// full 0..ITEMS.length index space. These helpers are extracted from the real
// source (not copied) so the test can never drift from the game.
{
  const marketVisibleIndices = extractFromMain('marketVisibleIndices');
  const marketNavStep = extractFromMain('marketNavStep');

  const FIX_ITEMS = [{ id: 'grain' }, { id: 'food' }, { id: 'ore' }, { id: 'herbs' }];

  console.log('\n=== Market keyboard navigation ===');
  test('marketVisibleIndices exists in src/main.js', () => {
    assert(typeof marketVisibleIndices === 'function', 'marketVisibleIndices not found in src/main.js');
  });
  test('marketNavStep exists in src/main.js', () => {
    assert(typeof marketNavStep === 'function', 'marketNavStep not found in src/main.js');
  });
  test('buy mode lists every item plus the permit row', () => {
    const vis = marketVisibleIndices('buy', FIX_ITEMS, {});
    assertEqual(JSON.stringify(vis), JSON.stringify([0, 1, 2, 3, 4]));
  });
  test('sell mode lists only held items, no permit row', () => {
    const vis = marketVisibleIndices('sell', FIX_ITEMS, { food: 5, herbs: 2, ore: 0 });
    assertEqual(JSON.stringify(vis), JSON.stringify([1, 3]));
  });
  test('sell mode with empty pack lists nothing', () => {
    const vis = marketVisibleIndices('sell', FIX_ITEMS, { food: 0 });
    assertEqual(JSON.stringify(vis), JSON.stringify([]));
  });
  test('nav steps forward within visible rows and wraps', () => {
    assertEqual(marketNavStep([1, 3], 1, +1), 3);
    assertEqual(marketNavStep([1, 3], 3, +1), 1, 'wraps to first');
    assertEqual(marketNavStep([1, 3], 1, -1), 3, 'wraps back to last');
  });
  test('nav snaps a hidden selection to a visible row', () => {
    assertEqual(marketNavStep([1, 3], 2, +1), 1, 'hidden selection snaps to first on down');
    assertEqual(marketNavStep([1, 3], 2, -1), 3, 'hidden selection snaps to last on up');
  });
  test('nav on an empty list leaves selection unchanged', () => {
    assertEqual(marketNavStep([], 2, +1), 2);
  });
}

// ─── Mining stamina HUD meter (extracted live from src/main.js) ──────────────
// Stamina is a real resource (8–15/swing, regen 1/s) but was never drawn;
// the player only discovered it via a failed-swing toast. staminaMeterState
// decides when the HUD meter is visible and what it shows.
{
  const staminaMeterState = extractFromMain('staminaMeterState');

  console.log('\n=== Mining stamina HUD meter ===');
  test('staminaMeterState exists in src/main.js', () => {
    assert(typeof staminaMeterState === 'function', 'staminaMeterState not found in src/main.js');
  });
  test('hidden at full stamina away from veins', () => {
    assertEqual(staminaMeterState(100, false, 15), null);
  });
  test('shown at full stamina when near a vein', () => {
    const s = staminaMeterState(100, true, 15);
    assert(s && s.frac === 1, `expected frac 1, got ${JSON.stringify(s)}`);
  });
  test('shown whenever stamina is below max', () => {
    const s = staminaMeterState(40, false, 15);
    assert(s && Math.abs(s.frac - 0.4) < 1e-9, `expected frac 0.4, got ${JSON.stringify(s)}`);
  });
  test('color ramps green → amber → red as swings run out', () => {
    assertEqual(staminaMeterState(40, false, 15).color, '#4ade80', 'two+ swings left = green');
    assertEqual(staminaMeterState(20, false, 15).color, '#fbbf24', 'one swing left = amber');
    assertEqual(staminaMeterState(10, false, 15).color, '#ef4444', 'cannot swing = red');
  });
  test('out-of-range stamina is clamped', () => {
    assertEqual(staminaMeterState(120, false, 15), null, '>=100 hides off-vein');
    const s = staminaMeterState(-5, false, 15);
    assert(s && s.frac === 0 && s.color === '#ef4444', `expected clamped 0/red, got ${JSON.stringify(s)}`);
  });
}

// ─── Contract accept/replace decision (extracted live from src/main.js) ──────
// Accepting a job while another contract is active used to silently discard
// the active one. The decision helper arms a confirm step instead: first
// activation on a row returns 'confirm', a second activation on the same row
// returns 'accept'.
{
  const contractAcceptDecision = extractFromMain('contractAcceptDecision');

  console.log('\n=== Contract accept/replace decision ===');
  test('contractAcceptDecision exists in src/main.js', () => {
    assert(typeof contractAcceptDecision === 'function', 'contractAcceptDecision not found in src/main.js');
  });
  test('no active contract accepts immediately', () => {
    assertEqual(contractAcceptDecision(null, -1, 0), 'accept');
  });
  test('active contract arms a confirm on first activation', () => {
    assertEqual(contractAcceptDecision({ want: 'ore' }, -1, 0), 'confirm');
  });
  test('second activation on the armed row accepts', () => {
    assertEqual(contractAcceptDecision({ want: 'ore' }, 2, 2), 'accept');
  });
  test('activating a different row re-arms the confirm there', () => {
    assertEqual(contractAcceptDecision({ want: 'ore' }, 2, 0), 'confirm');
  });
}

// ─── Toast queue (extracted live from src/main.js) ───────────────────────────
// toast() was a single slot (ui.toast/ui.toastT): a sell toast followed within
// a frame by a milestone toast erased the first before it could be read. The
// queue keeps up to 3 concurrent toasts, dropping the oldest on overflow, and
// each entry expires on its own timer.
{
  const toastQueuePush = extractFromMain('toastQueuePush');
  const toastQueueTick = extractFromMain('toastQueueTick');

  console.log('\n=== Toast queue ===');
  test('toastQueuePush exists in src/main.js', () => {
    assert(typeof toastQueuePush === 'function', 'toastQueuePush not found in src/main.js');
  });
  test('toastQueueTick exists in src/main.js', () => {
    assert(typeof toastQueueTick === 'function', 'toastQueueTick not found in src/main.js');
  });
  test('rapid toasts stack instead of overwriting', () => {
    let q = [];
    q = toastQueuePush(q, 'Sold 5 Grain (+60g)', 2, 3);
    q = toastQueuePush(q, 'Guild milestone!', 2, 3);
    assertEqual(q.length, 2);
    assertEqual(q[0].msg, 'Sold 5 Grain (+60g)');
    assertEqual(q[1].msg, 'Guild milestone!');
  });
  test('overflow drops the oldest, never the newest', () => {
    let q = [];
    for (const m of ['a', 'b', 'c', 'd']) q = toastQueuePush(q, m, 2, 3);
    assertEqual(q.length, 3);
    assertEqual(JSON.stringify(q.map(t => t.msg)), JSON.stringify(['b', 'c', 'd']));
  });
  test('entries expire independently on their own timers', () => {
    let q = [];
    q = toastQueuePush(q, 'short', 0.5, 3);
    q = toastQueuePush(q, 'long', 3, 3);
    q = toastQueueTick(q, 1);
    assertEqual(q.length, 1);
    assertEqual(q[0].msg, 'long');
    assertClose(q[0].t, 2);
  });
  test('tick with no elapsed time changes nothing', () => {
    let q = toastQueuePush([], 'x', 2, 3);
    q = toastQueueTick(q, 0);
    assertEqual(q.length, 1);
    assertClose(q[0].t, 2);
  });
}

// ─── Bank deposit quick-amounts (extracted live from src/main.js) ────────────
// Fixed +10/+50/+100 deposit buttons are meaningless once gear costs six
// figures; bankQuickAmounts scales the three buttons to the player's wealth.
{
  const bankQuickAmounts = extractFromMain('bankQuickAmounts');

  console.log('\n=== Bank deposit quick-amounts ===');
  test('bankQuickAmounts exists in src/main.js', () => {
    assert(typeof bankQuickAmounts === 'function', 'bankQuickAmounts not found in src/main.js');
  });
  test('scales to 10% / 50% / 100% for a wealthy player', () => {
    assertEqual(JSON.stringify(bankQuickAmounts(1000)), JSON.stringify([100, 500, 1000]));
  });
  test('MAX always equals current gold', () => {
    assertEqual(bankQuickAmounts(1000)[2], 1000);
    assertEqual(bankQuickAmounts(37)[2], 37);
    assertEqual(bankQuickAmounts(5)[2], 5);
  });
  test('amounts round to whole gold', () => {
    assertEqual(JSON.stringify(bankQuickAmounts(255)), JSON.stringify([26, 128, 255]));
  });
  test('smallest button floors at 10g while it fits under MAX', () => {
    // 10% of 50 = 5, floored up to 10; half = 25; max = 50.
    assertEqual(JSON.stringify(bankQuickAmounts(50)), JSON.stringify([10, 25, 50]));
  });
  test('never offers more than the player holds', () => {
    // gold below the 10g floor: every button clamps down to gold, MAX == gold.
    const a = bankQuickAmounts(5);
    assert(a.every(v => v <= 5), `amounts exceed gold: ${JSON.stringify(a)}`);
    assertEqual(a[2], 5);
  });
  test('zero gold yields all-zero amounts', () => {
    assertEqual(JSON.stringify(bankQuickAmounts(0)), JSON.stringify([0, 0, 0]));
  });
}

// ─── Navigate ETA (extracted live from src/main.js) ──────────────────────────
// The navigate picker now shows trip distance + ETA so the player can judge a
// trip's cost before committing. pathLengthPx sums the waypoint segments;
// etaSeconds divides by the player's effective boots speed.
{
  const pathLengthPx = extractFromMain('pathLengthPx');
  const etaSeconds = extractFromMain('etaSeconds');

  console.log('\n=== Navigate ETA ===');
  test('pathLengthPx exists in src/main.js', () => {
    assert(typeof pathLengthPx === 'function', 'pathLengthPx not found in src/main.js');
  });
  test('etaSeconds exists in src/main.js', () => {
    assert(typeof etaSeconds === 'function', 'etaSeconds not found in src/main.js');
  });
  test('single segment measures Euclidean distance', () => {
    assertClose(pathLengthPx([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5);
  });
  test('multi-segment path sums each leg', () => {
    assertClose(pathLengthPx([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }]), 20);
  });
  test('degenerate paths are zero length', () => {
    assertClose(pathLengthPx([{ x: 5, y: 5 }]), 0);
    assertClose(pathLengthPx([]), 0);
    assertClose(pathLengthPx(null), 0);
  });
  test('ETA is distance over speed', () => {
    assertClose(etaSeconds(180, 90), 2);
    assertClose(etaSeconds(45, 90), 0.5);
  });
  test('non-positive speed yields zero ETA (no divide-by-zero)', () => {
    assertEqual(etaSeconds(100, 0), 0);
    assertEqual(etaSeconds(100, -5), 0);
  });
}

// ─── Contract board hints (extracted live from src/main.js) ──────────────────
// Board rows now show what the player already holds toward each job and where
// the item is cheapest, using static public knowledge (no live prices).
{
  const contractHoldLabel = extractFromMain('contractHoldLabel');
  const cheapestCityFor = extractFromMain('cheapestCityFor');
  const MULTS = {
    valdenmere: { grain: 1.10, ore: 1.20 },
    ashport:    { grain: 1.05, ore: 1.05 },
    crosshaven: { grain: 0.90, ore: 1.00 },
    ironholt:   { grain: 1.15, ore: 0.65 },
  };

  console.log('\n=== Contract board hints ===');
  test('contractHoldLabel exists in src/main.js', () => {
    assert(typeof contractHoldLabel === 'function', 'contractHoldLabel not found in src/main.js');
  });
  test('cheapestCityFor exists in src/main.js', () => {
    assert(typeof cheapestCityFor === 'function', 'cheapestCityFor not found in src/main.js');
  });
  test('holdings under the requirement are not met', () => {
    const l = contractHoldLabel({ ore: 3 }, { want: 'ore', qty: 5 });
    assertEqual(l.have, 3); assertEqual(l.need, 5); assertEqual(l.met, false);
  });
  test('holdings at or above the requirement are met', () => {
    assertEqual(contractHoldLabel({ ore: 5 }, { want: 'ore', qty: 5 }).met, true);
    assertEqual(contractHoldLabel({ ore: 9 }, { want: 'ore', qty: 5 }).met, true);
  });
  test('no holdings reads zero, not NaN', () => {
    const l = contractHoldLabel({}, { want: 'ore', qty: 5 });
    assertEqual(l.have, 0); assertEqual(l.met, false);
  });
  test('cheapestCityFor returns the lowest-multiplier city', () => {
    assertEqual(cheapestCityFor('grain', MULTS), 'crosshaven');
    assertEqual(cheapestCityFor('ore', MULTS), 'ironholt');
  });
  test('cheapestCityFor returns null for an unknown item', () => {
    assertEqual(cheapestCityFor('mithril', MULTS), null);
  });
}

// ─── Pack sell-value (extracted live from src/main.js) ───────────────────────
// The market footer shows what the pack would fetch at the current city's sell
// quotes, so the player can judge sell-here vs. carry-on. packSellValue sums
// qty × sell-price via an injected price lookup (pure; no game state).
{
  const packSellValue = extractFromMain('packSellValue');
  const ITEMS3 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const prices = { a: 10, b: 5, c: 40 };
  const sellOf = (it) => prices[it.id];

  console.log('\n=== Pack sell-value ===');
  test('packSellValue exists in src/main.js', () => {
    assert(typeof packSellValue === 'function', 'packSellValue not found in src/main.js');
  });
  test('sums qty × sell price across held items', () => {
    assertEqual(packSellValue({ a: 2, b: 3 }, ITEMS3, sellOf), 35);
  });
  test('ignores items the player does not hold', () => {
    assertEqual(packSellValue({ c: 1 }, ITEMS3, sellOf), 40);
  });
  test('empty pack is worth zero', () => {
    assertEqual(packSellValue({}, ITEMS3, sellOf), 0);
  });
  test('a zero/absent sell price contributes nothing', () => {
    assertEqual(packSellValue({ a: 2 }, ITEMS3, () => 0), 0);
  });
}

// Run async tests
console.log('\n=== DB layer (fetch-mocked) ===');
for (const { name, fn } of _asyncTests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
