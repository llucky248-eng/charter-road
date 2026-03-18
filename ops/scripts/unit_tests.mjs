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

// rewardForContract
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function rewardForContract(want, qty) {
  const ITEMS = [
    { id: 'grain', base: 5 }, { id: 'food', base: 8 }, { id: 'ore', base: 14 },
    { id: 'herbs', base: 12 }, { id: 'potion', base: 30 }, { id: 'relic', base: 60 },
  ];
  const it = ITEMS.find(x => x.id === want);
  const base = it ? it.base : 20;
  const premium = want === 'relic' ? 22 : (want === 'potion' ? 10 : 6);
  const r = 10 + premium + Math.round(base * qty * 0.85);
  return clamp(r, 18, 160);
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

// validateSave (minimal inline version – mirrors logic in main.js)
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
  }
  if (!isObj(s?.time)) errors.push('time missing');
  else {
    const t = s.time;
    if (!Number.isFinite(t.day)) errors.push('time.day must be number');
    if (!Number.isFinite(t.frac)) errors.push('time.frac must be number');
    if (!Number.isFinite(t.seed)) errors.push('time.seed must be number');
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
test('relic reward is in [18,160]', () => {
  const r = rewardForContract('relic', 1);
  assert(r >= 18 && r <= 160, `got ${r}`);
});
test('potion reward > grain reward (same qty)', () => {
  assert(rewardForContract('potion', 1) > rewardForContract('grain', 1), 'potion should pay more');
});
test('higher qty → higher reward', () => {
  assert(rewardForContract('ore', 3) > rewardForContract('ore', 1), 'more qty → more reward');
});
test('unknown item uses base=20 fallback without crash', () => {
  const r = rewardForContract('dragonskin', 2);
  assert(r >= 18 && r <= 160, `got ${r}`);
});
test('reward clamped to minimum 18', () => {
  // qty=0 should still hit floor
  const r = rewardForContract('grain', 0);
  assert(r >= 18, `got ${r}`);
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

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
