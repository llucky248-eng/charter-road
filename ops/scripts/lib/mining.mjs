/**
 * Mining economy — deterministic, offline, browser-free core.
 *
 * Models the redesigned mining feature as a pure function of world state so an
 * AI agent can run it headlessly (see ops/scripts/mining_report.mjs):
 *
 *   - 2 mining sites, each producing a different metal variant
 *   - NPC miners + the player produce metal into a per-site warehouse
 *   - traders + the player ship metal from the site hub to cities for profit
 *   - rarity drives price: rarer metal is scarcer to mine and dearer to sell
 *
 * Pricing constants (METALS, METAL_CITY_MULTS) and the site table (MINE_SITES)
 * are mirrored into src/main.js and ops/scripts/world_service.mjs. The sync is
 * enforced by tests: economy_parity_test.mjs checks main.js <-> world_service,
 * and mining_tests.mjs checks mining.mjs <-> world_service (metal prices) and
 * mining.mjs <-> main.js (site coordinates/hubs). Update all copies together.
 */

export const CITIES = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];

// Rarity tiers: rarer => fewer units per miner per day, and (via base price) dearer.
export const RARITY = {
  common:    { rank: 0, yieldPerMiner: 6 },
  rare:      { rank: 1, yieldPerMiner: 2 },
  legendary: { rank: 2, yieldPerMiner: 1 },
};

// The mineable metal variants. base price reflects rarity (copper < silver < gold).
export const METALS = [
  { id: 'copper', name: 'Copper Ore', rarity: 'common',    base: 14,  weight: 2 },
  { id: 'silver', name: 'Silver Ore', rarity: 'rare',      base: 58,  weight: 1 },
  { id: 'gold',   name: 'Gold Ore',   rarity: 'legendary', base: 140, weight: 1 },
];

// Three mining sites, each tied to one metal and a nearby hub city (warehouse +
// market). x/y are map-tile coordinates used by src/main.js to carve the site.
export const MINE_SITES = [
  { id: 'coppervein_hollow', name: 'Coppervein Hollow', metal: 'copper', hub: 'crosshaven', npcMiners: 3, x: 82,  y: 140 },
  { id: 'argent_reach',      name: 'Argent Reach',      metal: 'silver', hub: 'ironholt',   npcMiners: 2, x: 116, y: 30  },
  { id: 'sunwell_shaft',     name: 'Sunwell Shaft',     metal: 'gold',   hub: 'valdenmere', npcMiners: 1, x: 40,  y: 60  },
];

// Per-city price multipliers for each metal. Each metal is cheapest at its mine
// hub (the source) and dearer in distant cities, creating shipping margin.
export const METAL_CITY_MULTS = {
  valdenmere: { copper: 1.20, silver: 0.98, gold: 0.90 },
  ashport:    { copper: 1.22, silver: 1.10, gold: 1.08 },
  crosshaven: { copper: 0.68, silver: 1.16, gold: 1.03 },
  ironholt:   { copper: 1.05, silver: 0.90, gold: 0.95 },
};

// Logistics tuning (deterministic).
const TRADER_DAILY_CAP = 10; // units a site's trader crew hauls out per day
const PLAYER_PER_SWING  = 1; // metal mined per player swing
const PLAYER_SHIP_UNITS = 8; // extra haul capacity per player ship run

function seeded01(a, b, c = 0) {
  let n = (a * 374761393 + b * 668265263 + c * 362437) >>> 0;
  n = (n ^ (n >> 13)) >>> 0;
  n = (n * 1274126177) >>> 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

export function metalById(id) {
  return METALS.find(m => m.id === id) || null;
}

export function rarityRank(metalId) {
  const m = metalById(metalId);
  return m ? RARITY[m.rarity].rank : -1;
}

function hubForMetal(metalId) {
  const site = MINE_SITES.find(s => s.metal === metalId);
  return site ? site.hub : null;
}

/** Deterministic mid price for one unit of metal in a city (drift-free baseline). */
export function unitMidPrice(metalId, cityId) {
  const m = metalById(metalId);
  if (!m) return 0;
  const mult = METAL_CITY_MULTS[cityId]?.[metalId] ?? 1;
  return Math.max(1, Math.round(m.base * mult));
}

/**
 * Units of metal produced at a site on a given day: NPC crew + player swings,
 * with occasional deterministic "rich vein" days (+50% from the NPC crew).
 * Player swings are scaled by `yieldMult` (pickaxe gear tier, default 1.0).
 */
export function dailyProduction(site, { day = 1, seed = 1, playerSwings = 0, yieldMult = 1 } = {}) {
  const metal = metalById(site.metal);
  const perMiner = RARITY[metal.rarity].yieldPerMiner;
  let base = site.npcMiners * perMiner;
  if (seeded01(hashStr(site.id) ^ (seed >>> 0), day | 0) > 0.8) {
    base = Math.round(base * 1.5);
  }
  const playerOutput = Math.round((playerSwings | 0) * PLAYER_PER_SWING * yieldMult);
  return base + playerOutput;
}

/** Best ship-out route for a metal: buy at its mine hub, sell in the dearest city. */
export function bestRoute(metalId) {
  const fromId = hubForMetal(metalId);
  const buy = unitMidPrice(metalId, fromId);
  let toId = null;
  let bestSell = -Infinity;
  for (const city of CITIES) {
    if (city === fromId) continue;
    const sell = unitMidPrice(metalId, city);
    if (sell > bestSell) { bestSell = sell; toId = city; }
  }
  return { metal: metalId, fromId, toId, buy, sell: bestSell, unitProfit: bestSell - buy };
}

/** Profit from shipping qty units of a metal from one city to another (mid-to-mid). */
export function shipProfit(metalId, qty, fromId, toId) {
  return (qty | 0) * (unitMidPrice(metalId, toId) - unitMidPrice(metalId, fromId));
}

/**
 * Simulate the mining economy for N days and return a JSON-serialisable report.
 * Deterministic in (days, seed, player). This is the headless milestone surface.
 *
 * @param {object}  opts
 * @param {number}  opts.days   number of game-days to simulate
 * @param {number}  opts.seed   world seed (controls rich-vein days)
 * @param {?object} opts.player { minesAt: siteId, swingsPerDay, shipsPerDay, yieldMult? } or null
 */
export function simulateMiningEconomy({ days = 30, seed = 1, player = null } = {}) {
  const warehouse = {};
  const mined = {};
  const shipped = {};
  const revenue = {};
  for (const m of METALS) {
    warehouse[m.id] = 0; mined[m.id] = 0; shipped[m.id] = 0; revenue[m.id] = 0;
  }

  const siteStats = {};
  for (const s of MINE_SITES) {
    siteStats[s.id] = { metal: s.metal, hub: s.hub, npcMiners: s.npcMiners, produced: 0 };
  }

  // Routes depend only on constant pricing — compute once, not per day.
  const routes = {};
  for (const m of METALS) routes[m.id] = bestRoute(m.id);

  for (let day = 1; day <= days; day++) {
    for (const site of MINE_SITES) {
      const metal = site.metal;
      const playerHere = !!(player && player.minesAt === site.id);
      const playerSwings = playerHere ? (player.swingsPerDay | 0) : 0;
      const yieldMult = playerHere ? (Number.isFinite(player.yieldMult) ? player.yieldMult : 1) : 1;

      const produced = dailyProduction(site, { day, seed, playerSwings, yieldMult });
      warehouse[metal] += produced;
      mined[metal] += produced;
      siteStats[site.id].produced += produced;

      const cap = TRADER_DAILY_CAP + (playerHere ? (player.shipsPerDay | 0) * PLAYER_SHIP_UNITS : 0);
      const move = Math.min(warehouse[metal], cap);
      warehouse[metal] -= move;
      shipped[metal] += move;
      revenue[metal] += move * routes[metal].unitProfit;
    }
  }

  const metals = {};
  let totalRevenue = 0;
  for (const m of METALS) {
    metals[m.id] = {
      rarity: m.rarity,
      mined: mined[m.id],
      shipped: shipped[m.id],
      stockRemaining: warehouse[m.id],
      revenue: revenue[m.id],
      bestRoute: routes[m.id],
    };
    totalRevenue += revenue[m.id];
  }

  const sortedByRank = [...METALS].sort((a, b) => rarityRank(a.id) - rarityRank(b.id));
  let raritySorted = true;
  for (let i = 1; i < sortedByRank.length; i++) {
    if (sortedByRank[i].base <= sortedByRank[i - 1].base) raritySorted = false;
  }

  return {
    days,
    seed,
    metals,
    sites: siteStats,
    totalRevenue,
    rarityCheck: {
      order: sortedByRank.map(m => ({ id: m.id, rarity: m.rarity, base: m.base })),
      raritySorted,
    },
  };
}
