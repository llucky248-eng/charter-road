#!/usr/bin/env node
/**
 * Balance regression test — economy health guardrails.
 *
 * Runs against the REAL economy model the AI traders use (world_service.mjs):
 * the same buyPrice / sellPrice / netSellPrice / CITY_MULTS / CITY_TAX / SPREAD.
 * Stochastic layers (market drift, world events, trade pressure, treasury
 * discounts) are neutralised so the check is deterministic and measures the
 * *base* economy — the ground truth a trader sees on a calm day.
 *
 * Guardrails (see ops/BALANCE_PLAN.md — items 1, 3, 4):
 *   1. No dead trade goods — every general good has ≥1 positive cross-city net route.
 *   2. Route dominance is bounded — the best item-lane earns < 5× the worst item-lane
 *      (per-item best profit/day; the honest "is one lane running away" measure).
 *   3. Diversity — ≥3 items have a best lane within 2× of the top lane.
 *   4. Solvency — a focused trader running the single best route is net-positive
 *      over 30 game-days on merit alone (no gold-floor band-aid, no upkeep).
 *
 * Fully offline, deterministic; no browser, no network, no Date.now/Math.random.
 */

import {
  ITEMS, CITIES, buyPrice, netSellPrice,
  WORLD_STATE, WORLD_EVENTS, PRESSURE_MAP, CITY_TREASURY, initMarketDrift,
} from './world_service.mjs';

// ── Guardrail thresholds ────────────────────────────────────────────────────
const MAX_ITEM_SPREAD = 5.0;  // best item-lane / worst item-lane (dominance ceiling)
const MIN_WITHIN_2X   = 3;    // items whose best lane is within 2× of the top lane
const CAPACITY        = 18;   // tier-1 cart, matches trade_sim + qa player-sim

// Metals are a separate, healthy economy (see mining_report) — this guardrail
// covers the six general trade goods only.
const METALS = new Set(['copper', 'silver', 'gold']);
const TRADE_GOODS = ITEMS.filter(i => !METALS.has(i.id));

// Road distances in days (mirrors trade_sim.mjs TRAVEL_DAYS).
const TRAVEL_DAYS = {
  valdenmere: { ashport: 4, crosshaven: 3, ironholt: 2 },
  ashport:    { valdenmere: 4, crosshaven: 2, ironholt: 3 },
  crosshaven: { valdenmere: 3, ashport: 2, ironholt: 4 },
  ironholt:   { valdenmere: 2, ashport: 3, crosshaven: 4 },
};

// ── Neutralise stochastic layers for a deterministic base-economy read ───────
function neutralize() {
  WORLD_STATE.day = 1;
  WORLD_EVENTS.length = 0;                                   // no active events
  for (const k of Object.keys(PRESSURE_MAP)) delete PRESSURE_MAP[k]; // no trade pressure
  initMarketDrift();                                         // drift = 1.0 everywhere
  for (const t of Object.values(CITY_TREASURY)) {
    if (t.city_bonus) t.city_bonus.marketDiscount = 0;       // no treasury discount
  }
}

// ── Enumerate every profitable cross-city route on the base economy ──────────
function allRoutes() {
  const routes = [];
  for (const from of CITIES) {
    for (const to of CITIES) {
      if (from === to) continue;
      for (const item of TRADE_GOODS) {
        if (item.sourceCities && !item.sourceCities.includes(from)) continue;
        const buy = buyPrice(from, item);
        const net = netSellPrice(to, item);
        const unit = net - buy;
        if (unit <= 0) continue;
        const units = Math.floor(CAPACITY / item.weight);
        const days  = TRAVEL_DAYS[from][to];
        routes.push({ from, to, item: item.id, buy, net, unit, units, days, ppd: (unit * units) / days });
      }
    }
  }
  return routes.sort((a, b) => b.ppd - a.ppd);
}

// Best profit/day lane for each trade good (0 if the item has no profitable route).
function itemBestPpd(routes) {
  const best = {};
  for (const it of TRADE_GOODS) best[it.id] = 0;
  for (const r of routes) if (r.ppd > best[r.item]) best[r.item] = r.ppd;
  return best;
}

// Focused trader: repeat the single best route (loaded out, empty return) for 30 game-days.
function solvency(routes, days = 30, startGold = 160) {
  const best = routes[0];
  const item = TRADE_GOODS.find(i => i.id === best.item);
  let gold = startGold, day = 1;
  while (day < days) {
    const units = Math.min(Math.floor(CAPACITY / item.weight), Math.floor(gold / best.buy));
    gold -= units * best.buy;
    day  += best.days;
    gold += units * best.net;
    day  += TRAVEL_DAYS[best.to][best.from]; // empty return leg
  }
  return gold;
}

// ── Test harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('\n=== balance regression ===');
neutralize();
const routes  = allRoutes();
const bestPpd = itemBestPpd(routes);
const lanes   = Object.entries(bestPpd);
const profitable = lanes.filter(([, p]) => p > 0).map(([, p]) => p);
const dead    = lanes.filter(([, p]) => p <= 0).map(([id]) => id);
const topPpd  = Math.max(...profitable);
const lowPpd  = Math.min(...profitable);
const spread  = topPpd / lowPpd;
const within2x = profitable.filter(p => p >= topPpd / 2).length;
const endGold = solvency(routes);

const laneStr = lanes.map(([id, p]) => `${id}:${p.toFixed(1)}`).join(' ');
console.log(`  (item-lane profit/day: ${laneStr})`);
console.log(`  (item-spread ${spread.toFixed(2)}x · within-2x ${within2x} · solvency 160→${endGold})`);

test('no dead trade goods — every general good has a profitable cross-city route', () => {
  assert(dead.length === 0, `dead items with no profitable route: [${dead.join(', ')}]`);
});

test(`route dominance bounded — best item-lane < ${MAX_ITEM_SPREAD}× worst`, () => {
  assert(spread < MAX_ITEM_SPREAD,
    `item-lane spread ${spread.toFixed(2)}x ≥ ${MAX_ITEM_SPREAD}x (top ${topPpd.toFixed(1)}/day, low ${lowPpd.toFixed(1)}/day)`);
});

test(`item diversity — ≥${MIN_WITHIN_2X} items within 2× of the top lane`, () => {
  assert(within2x >= MIN_WITHIN_2X,
    `only ${within2x} item(s) within 2× of the top lane (need ${MIN_WITHIN_2X})`);
});

test('focused trader is net-positive over 30 game-days (no gold floor, no upkeep)', () => {
  assert(endGold > 160, `best-route trader ended at ${endGold}g, not above the 160g start`);
});

console.log('\n────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
