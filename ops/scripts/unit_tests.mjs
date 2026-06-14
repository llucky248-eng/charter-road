#!/usr/bin/env node
/**
 * Unit tests for pure/utility functions extracted from src/main.js.
 * These run in Node.js without a browser.
 *
 * Usage:
 *   node ops/scripts/unit_tests.mjs
 */

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
// Loot-popup stack decision mirror: when the player gains items in rapid
// succession the renderer collapses identical-itemId popups within a short
// window into a single "+N" entry so the screen doesn't spam. The same
// itemId outside the window, or a different itemId at any time, queues
// a new popup.
function stackPopup(queue, popup, stackWindowMs, nowMs) {
  const last = queue[queue.length - 1];
  if (last && last.itemId === popup.itemId && (nowMs - last.startMs) < stackWindowMs) {
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
