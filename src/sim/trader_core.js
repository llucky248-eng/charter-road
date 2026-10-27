// AI trader brain, shared by the server ticker (ops/scripts/world_service.mjs)
// and the browser's offline fallback (src/main.js).
//
// Pure: no DOM, no network, no clock, no Math.random. Callers pass prices and a
// seeded rng in, so the same world state always gives the same decision.
// Unit-tested by ops/scripts/trader_tests.mjs.

// FNV-1a over the string form of every part → uint32 seed.
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  const s = parts.map(String).join('\u0001');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// mulberry32: small, fast seeded PRNG returning floats in [0, 1).
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A trader's rng for one decision. Seeded from a salt (world seed + day), its id
// and trip count, so it needs no stored state and a replay from the same
// snapshot makes the same choice.
export function traderRng(trader, salt, purpose) {
  return makeRng(hashSeed(salt ?? 0, trader.id, trader.trips_completed || 0, purpose));
}

// Seconds a trader rests in a city after arriving.
export function cityDwellSeconds(rng) {
  return 30 + rng() * 60;
}

/**
 * Pick the next trip for a trader standing in a city.
 *
 * trader: { id, from_id, to_id, personality, preferred_item?, profit_history? }
 * ctx: {
 *   cities:   city ids,
 *   items:    [{ id, weight, sourceCities? }],
 *   capacity: cart capacity (weight units),
 *   buy(cityId, item)     → price to buy one unit,
 *   sellNet(cityId, item) → price received for one unit after tax,
 *   pressure(cityId, itemId) → market pressure (optional, default 0),
 *   crowd: { itemId: number of OTHER traders carrying it } (optional) — items
 *          with 2+ are skipped unless nothing else is profitable,
 *   rng: () => [0, 1),
 * }
 * Returns { fromId, toId, itemId, profit?, score? }.
 */
export function decideRoute(trader, ctx) {
  const fromId = trader.to_id || trader.from_id || ctx.cities[0];
  const pressure = ctx.pressure || (() => 0);
  const candidates = [];

  for (const toId of ctx.cities) {
    if (toId === fromId) continue;
    for (const item of ctx.items) {
      if (item.sourceCities && !item.sourceCities.includes(fromId)) continue;

      const profit = ctx.sellNet(toId, item) - ctx.buy(fromId, item);
      if (profit <= 0) continue;

      const units = Math.floor(ctx.capacity / item.weight);
      if (units === 0) continue;

      let score = profit * units;

      // Focus item from the strategy review gets a strong bias.
      if (trader.preferred_item && item.id === trader.preferred_item) score *= 2.0;

      // Avoid oversupplied sell markets.
      const sellPressure = pressure(toId, item.id) || 0;
      if (sellPressure >= 0.4) score *= 0.3;
      else if (sellPressure >= 0.25) score *= 0.6;

      // Prefer buying where the source market is oversupplied.
      const buyPressure = pressure(fromId, item.id) || 0;
      if (buyPressure <= -0.3) score *= 1.4;

      candidates.push({ fromId, toId, itemId: item.id, profit: profit * units, score });
    }
  }

  if (!candidates.length) {
    const others = ctx.cities.filter(c => c !== fromId);
    return { fromId, toId: others[Math.floor(ctx.rng() * others.length)], itemId: 'grain' };
  }

  // Stable sort: ties keep city/item order, so the pick never depends on engine quirks.
  candidates.sort((a, b) => b.score - a.score);

  // Optional anti-herding: skip items already carried by 2+ other traders.
  let pool = candidates;
  if (ctx.crowd) {
    const open = candidates.filter(c => (ctx.crowd[c.itemId] || 0) < 2);
    if (open.length) pool = open;
  }

  if (trader.personality === 'aggressive') return pool[0];
  if (trader.personality === 'cautious') return pickCautious(trader, pool);
  return pickOpportunist(pool, ctx.rng);
}

// Cautious: among the top 5, prefer routes with steady past profit.
function pickCautious(trader, candidates) {
  const history = Array.isArray(trader.profit_history) ? trader.profit_history : [];
  if (history.length < 3) return candidates[Math.min(2, candidates.length - 1)];

  const routeProfit = {};
  for (const e of history) {
    const k = `${e.to}:${e.item}`;
    (routeProfit[k] ||= []).push(e.profit || 0);
  }
  let best = null, bestScore = -Infinity;
  for (const c of candidates.slice(0, 5)) {
    const hist = routeProfit[`${c.toId}:${c.itemId}`] || [];
    const mean = hist.length > 0 ? hist.reduce((a, b) => a + b, 0) / hist.length : c.score * 0.5;
    const variance = hist.length > 1
      ? hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length
      : mean * mean; // unknown route = high variance
    const consistency = mean - Math.sqrt(variance) * 0.3;
    if (consistency > bestScore) { bestScore = consistency; best = c; }
  }
  return best || candidates[0];
}

// Opportunist: score-weighted random pick among the top 5.
function pickOpportunist(candidates, rng) {
  const pool = candidates.slice(0, 5);
  const total = pool.reduce((s, c) => s + c.score, 0);
  let r = rng() * total;
  for (const c of pool) { r -= c.score; if (r <= 0) return c; }
  return pool[pool.length - 1];
}
