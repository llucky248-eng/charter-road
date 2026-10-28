#!/usr/bin/env node
/**
 * Charter Road — World Simulation Service
 * Runs as a GitHub Actions cron job every 5 minutes.
 * Ticks AI traders (travel, trade, profit) in Supabase, independent of the browser.
 *
 * No npm dependencies — uses Node 18+ built-in fetch.
 */

import { pathToFileURL } from 'node:url';
import { decideRoute as coreDecideRoute, traderRng, cityDwellSeconds, routeSeconds, ROUTE_SECONDS, DEFAULT_ROUTE_SECONDS } from '../../src/sim/trader_core.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycjhcsxxtinipwailbjb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljamhjc3h4dGluaXB3YWlsYmpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTc1MDAsImV4cCI6MjA4OTIzMzUwMH0.cBEiiVExRAnWVeUV3v6ZLYmcPe1hnPc4wdmKSvkRahY';

// ── Constants (mirrors main.js) ────────────────────────────────────────────

const TRADER_DEFS = [
  { id: 'olt_the_bold',    name: 'Olt the Bold',      personality: 'aggressive',  color: '#ef4444', startGold: 80  },
  { id: 'mira_silvertong', name: 'Mira Silvertongue', personality: 'opportunist', color: '#a78bfa', startGold: 100 },
  { id: 'cargo_dom',       name: 'Cargo Dom',         personality: 'cautious',    color: '#f59e0b', startGold: 120 },
  { id: 'wren_the_swift',  name: 'Wren the Swift',    personality: 'aggressive',  color: '#34d399', startGold: 140 },
  { id: 'pilgrim_bex',     name: 'Bex the Pilgrim',   personality: 'opportunist', color: '#86efac', startGold: 90  },
  { id: 'iron_marek',      name: 'Iron Marek',        personality: 'aggressive',  color: '#fb923c', startGold: 110 },
];

// Fresh trader state from a definition. Every field that a tick accumulates
// (gold, gear_tier, permits, preferred_item, profit_history, trip counters…) is
// reset here to its starting value so a RESET_TRADERS re-seed genuinely wipes
// strategy state — upsertTraders merges by id, so any accumulated field NOT set
// here would survive the reset. Keep this exhaustive when adding trader fields.
function makeSeedTrader(def, index = 0, nowIso) {
  if (typeof nowIso !== 'string') throw new Error('makeSeedTrader needs nowIso');
  return {
    id:              def.id,
    name:            def.name,
    personality:     def.personality,
    color:           def.color,
    state:           'in_city',
    from_id:         'valdenmere',
    to_id:           'valdenmere',
    item_id:         'ore',
    inv:             {},
    gold:            def.startGold,
    start_gold:      def.startGold,
    total_profit:    0,
    trips_completed: 0,
    progress:        0,
    city_timer:      10 + index * 15,
    preferred_item:  null,
    review_at_trips: 3,
    profit_history:  [],
    gear_tier:       0,   // explicit so a reset upsert clears any accumulated tier
    permits:         {},  // explicit so a reset upsert clears any accumulated permits
    updated_at:      nowIso,
  };
}

const ITEMS = [
  { id: 'grain',  name: 'Grain',         base: 10, weight: 1 },
  { id: 'food',   name: 'Dried Rations', base: 16, weight: 1 },
  { id: 'ore',    name: 'Iron Ore',      base: 22, weight: 2 },
  { id: 'herbs',  name: 'Moon Herbs',    base: 24, weight: 1 },
  { id: 'potion', name: 'Minor Potion',  base: 40, weight: 1 },
  { id: 'relic',  name: 'Old Relic',     base: 60, weight: 2 },
  { id: 'ink',    name: 'Demon Ink',     base: 75, weight: 1, sourceCities: ['ironholt', 'crosshaven'] },
  { id: 'copper', name: 'Copper Ore',    base: 14,  weight: 2, rarity: 'common',    sourceCities: ['crosshaven'] },
  { id: 'silver', name: 'Silver Ore',    base: 58,  weight: 1, rarity: 'rare',      sourceCities: ['ironholt']   },
  { id: 'gold',   name: 'Gold Ore',      base: 140, weight: 1, rarity: 'legendary', sourceCities: ['valdenmere'] },
];

const CITIES = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];

// City food demand + base population (mirrors CITY_RULES in main.js)
const CITY_FOOD_RULES = {
  valdenmere: { foodDemand: 0.0010, population: 8000,  taxRate: 0.08 },
  ashport:    { foodDemand: 0.0007, population: 4000,  taxRate: 0.05 },
  crosshaven: { foodDemand: 0.0005, population: 1500,  taxRate: 0.03 },
  ironholt:   { foodDemand: 0.0008, population: 2500,  taxRate: 0.10 },
};

// ── World Events ──────────────────────────────────────────────────────────
// Schema migration required (run once):
//   ALTER TABLE world_state ADD COLUMN IF NOT EXISTS active_events JSONB DEFAULT '[]';
//   ALTER TABLE world_state ADD COLUMN IF NOT EXISTS next_event_day INT DEFAULT 0;

const WORLD_EVENT_TEMPLATES = [
  { id: 'harvest',      name: 'Bumper Harvest',    cities: ['crosshaven'],           items: ['grain','food'],   effect: 0.75, minDur: 5, maxDur: 8 },
  { id: 'drought',      name: 'Summer Drought',    cities: null,                     items: ['grain'],          effect: 1.45, minDur: 4, maxDur: 6 },
  { id: 'trade_fair',   name: 'Ashport Trade Fair',cities: ['ashport'],              items: null,               effect: 1.20, minDur: 3, maxDur: 5 },
  { id: 'mining_boom',  name: 'Iron Rush',         cities: ['ironholt'],             items: ['ore','coal'],     effect: 0.80, minDur: 5, maxDur: 7 },
  { id: 'pirate_raid',  name: 'Pirate Raids',      cities: ['ashport'],              items: ['relic','ink'],    effect: 1.55, minDur: 3, maxDur: 5 },
  { id: 'plague_scare', name: 'Plague Rumours',    cities: null,                     items: ['potion','herbs'], effect: 1.65, minDur: 3, maxDur: 5 },
  { id: 'gem_rush',     name: 'Gem Discovery',     cities: ['ironholt'],             items: ['relic'],          effect: 0.70, minDur: 4, maxDur: 6 },
  { id: 'herb_bloom',   name: 'Herb Bloom',        cities: ['crosshaven','ashport'], items: ['herbs','potion'], effect: 0.80, minDur: 4, maxDur: 7 },
];

// Active world events; loaded from DB at tick start, saved back at end
const WORLD_EVENTS = [];

// Market drift: world-authoritative ±20% daily price drift, ticked by cron
// Mirrors client marketDrift — clients load this instead of running their own RNG
const MARKET_DRIFT     = {};
let   MARKET_DRIFT_DAY = 0;

function initMarketDrift() {
  for (const cityId of CITIES) {
    if (!MARKET_DRIFT[cityId]) MARKET_DRIFT[cityId] = {};
    for (const item of ITEMS) {
      if (!Number.isFinite(MARKET_DRIFT[cityId][item.id])) MARKET_DRIFT[cityId][item.id] = 1.0;
    }
  }
}

function tickMarketDrift() {
  const fromDay = MARKET_DRIFT_DAY;
  const toDay   = Math.floor(WORLD_STATE.day);
  if (fromDay >= toDay) return;
  for (let d = fromDay + 1; d <= toDay; d++) {
    for (const cityId of CITIES) {
      if (!MARKET_DRIFT[cityId]) MARKET_DRIFT[cityId] = {};
      for (const item of ITEMS) {
        const cs    = citySeed(cityId);
        const u     = seeded01(cs ^ (d * 7919), item.id.charCodeAt(0), d);
        const delta = (u - 0.5) * 0.04; // ±2% per day
        const cur   = MARKET_DRIFT[cityId][item.id] ?? 1.0;
        MARKET_DRIFT[cityId][item.id] = Math.max(0.85, Math.min(1.20, cur * (1 + delta)));
      }
    }
  }
  MARKET_DRIFT_DAY = toDay;
  if (toDay > fromDay) console.log(`[DRIFT] Ticked day ${fromDay}→${toDay}`);
}

// Tick each city's bank vault: collapse when reserve can't cover 30% of total deposits,
// reopen after BANK_BANKRUPTCY_REOPEN_DAYS. Mirrors client checkBankSolvency at main.js:3392.
// Also funnels 20% of treasury gold into the vault every 7 game-days (cityInvestTick parity).
function tickBankSolvency() {
  const day = Math.floor(WORLD_STATE.day);
  for (const cityId of CITIES) {
    const t = CITY_TREASURY[cityId];
    if (!t) continue;
    // Treasury → vault: 20% of treasury gold every 7 days (mirrors client cityInvestTick)
    if (day > 0 && day % 7 === 0 && (t._lastVaultFundingDay !== day)) {
      const share = Math.floor((t.gold || 0) * 0.20);
      if (share > 0) {
        t.gold         -= share;
        t.bank_reserve += share;
        t._lastVaultFundingDay = day;
        console.log(`[BANK][${cityId}] Treasury funded vault +${share}g (reserve=${t.bank_reserve})`);
      }
    }
    // Reopen check
    if (t.bankrupt_day !== null && day >= t.bankrupt_day + BANK_BANKRUPTCY_REOPEN_DAYS) {
      console.log(`[BANK][${cityId}] Reopening after bankruptcy (day ${t.bankrupt_day} → ${day})`);
      t.bankrupt_day = null;
      t.bank_reserve = Math.max(t.bank_reserve, 20); // re-seed with small reserve
    }
    // Solvency check
    if (t.bankrupt_day === null && t.total_deposits > 0 && t.bank_reserve < t.total_deposits * 0.30) {
      console.log(`[BANK][${cityId}] BANKRUPT — reserve=${t.bank_reserve} owed=${t.total_deposits}`);
      t.bankrupt_day   = day;
      t.total_deposits = 0;        // depositors get whatever they can scrape; client handles per-uid cleanup
      t.bank_reserve   = 0;
    }
  }
}

// Tick city hunger once per game-day elapsed (mirrors populationTick() in main.js).
// Hunger rises from foodDemand * (pop / basePop) * subsidyReduction each day.
// Clamped [0, 1]. Written to city_treasury.hunger so all clients read the same value.
function tickHunger() {
  const toDay   = Math.floor(WORLD_STATE.day);
  const fromDay = MARKET_DRIFT_DAY; // hunger advances on the same cadence as drift
  if (fromDay >= toDay) return;
  const days = toDay - fromDay;
  for (const cityId of CITIES) {
    const t    = CITY_TREASURY[cityId];
    const rule = CITY_FOOD_RULES[cityId];
    if (!t || !rule) continue;
    const subsidyReduction = 1 - (t.city_bonus?.foodSubsidy || 0);
    for (let i = 0; i < days; i++) {
      t.hunger = Math.min(1, (t.hunger || 0) + rule.foodDemand * (t.population / rule.population) * subsidyReduction);
    }
    // Population growth/decline driven by hunger (same thresholds as client)
    if (t.hunger < 0.2) {
      t.population = Math.min(t.population * 1.002, rule.population * 1.5);
    } else if (t.hunger > 0.7) {
      t.population = Math.max(t.population * 0.998, rule.population * 0.5);
    }
    if (days > 0) console.log(`[HUNGER][${cityId}] day ${fromDay}→${toDay} hunger=${t.hunger.toFixed(3)}`);
  }
}

const BASE_CAPACITY = 12;
const SPREAD        = 0.06; // matches main.js balance pass

// ── Gear upgrade tiers ────────────────────────────────────────────────────
// FIX: lower tier 1 cost so traders can upgrade after ~10 profitable trips
const GEAR_TIERS = [
  { tier: 0, name: 'Mule & Pack',      capacity: 12,  cost: 0    },
  { tier: 1, name: 'Reinforced Cart',  capacity: 18,  cost: 200  },
  { tier: 2, name: 'Merchant Wagon',   capacity: 26,  cost: 800  },
  { tier: 3, name: 'Trade Galleon',    capacity: 36,  cost: 2000 },
];

function traderCapacity(trader) {
  const tier = GEAR_TIERS[trader.gear_tier || 0] || GEAR_TIERS[0];
  return tier.capacity;
}

// Cheapest buy price on today's market, over every item a city sells (all
// cities when cityId is omitted). perWeight: price per weight unit instead.
function cheapestBuy({ cityId = null, perWeight = false } = {}) {
  let cheapest = Infinity;
  for (const item of ITEMS) {
    for (const c of cityId ? [cityId] : CITIES) {
      if (item.sourceCities && !item.sourceCities.includes(c)) continue;
      cheapest = Math.min(cheapest, buyPrice(c, item) / (perWeight ? item.weight : 1));
    }
  }
  return cheapest;
}

// Gold needed to buy one unit of the cheapest item that is profitable to carry
// from cityId to somewhere (Infinity when nothing from here is profitable).
function stuckRescueGold(cityId) {
  let need = Infinity;
  for (const item of ITEMS) {
    if (item.sourceCities && !item.sourceCities.includes(cityId)) continue;
    const buy = buyPrice(cityId, item);
    if (CITIES.some(to => to !== cityId && netSellPrice(to, item) > buy)) need = Math.min(need, buy);
  }
  return need;
}

// Gold a trader must still hold after buying a cart of `tier` in `cityId`:
// enough to fill it with that city's cheapest goods (per weight unit). Without
// it an upgrade can leave the trader too broke to load even its old cart.
function upgradeReserve(tier, cityId) {
  return Math.ceil(GEAR_TIERS[tier].capacity * cheapestBuy({ cityId, perWeight: true }));
}

function tryGearUpgrade(trader) {
  const currentTier = trader.gear_tier || 0;
  const nextTier    = GEAR_TIERS[currentTier + 1];
  if (!nextTier) return; // already maxed

  // Upgrades happen on arrival, so the next cargo is bought where the trader stands.
  const here = trader.to_id || trader.from_id || 'valdenmere';
  if ((trader.gold || 0) < nextTier.cost + upgradeReserve(nextTier.tier, here)) return; // can't afford and still trade

  // Check ROI: extra capacity × avg profit per unit × payback in <10 trips
  const history = Array.isArray(trader.profit_history) ? trader.profit_history : [];
  const recent  = history.slice(-3);
  const avgProfit = recent.length > 0
    ? recent.reduce((s, e) => s + (e.profit || 0), 0) / recent.length
    : 0;
  const currentCap = GEAR_TIERS[currentTier].capacity;
  const extraCap   = nextTier.capacity - currentCap;
  const profitPerUnit = currentCap > 0 ? avgProfit / currentCap : 0;
  const extraProfitPerTrip = profitPerUnit * extraCap;
  const paybackTrips = extraProfitPerTrip > 0 ? nextTier.cost / extraProfitPerTrip : Infinity;

  if (paybackTrips <= 15 || nextTier.tier === 1) {
    // First upgrade skips the ROI check (still needs cost + reserve, checked above)
    trader.gold      -= nextTier.cost;
    trader.gear_tier  = nextTier.tier;
    console.log(`[${trader.name}] 🔧 Upgraded to ${nextTier.name} (${nextTier.capacity} capacity) for ${nextTier.cost}g — payback in ~${paybackTrips.toFixed(1)} trips`);
  }
}
const MAX_TICK = 1800; // cap elapsed seconds to avoid huge jumps (allow up to 6 trips per tick)

// ── Taxation & Trading Permits ────────────────────────────────────────────

// Tax rate on every sale (fraction of revenue)
const CITY_TAX = {
  valdenmere: 0.08,
  ashport:    0.05,
  crosshaven: 0.03,
  ironholt:   0.10,
};

// AI traders now follow the same economy model as the client.
// The old server-only premium-item permit system created routes and taxes the
// player could never see, so it is disabled for parity.
const PERMIT_ITEMS = new Set();

// Permit cost and duration (in trips)
const PERMIT_COST  = 150;  // FIX: reduced from 300 — was unaffordable for early traders (80-120g start)
const PERMIT_TRIPS = 6;

function hasValidPermit(trader, cityId) {
  const permits = trader.permits || {};
  const p = permits[cityId];
  if (!p) return false;
  return (trader.trips_completed || 0) < p.expires_at_trip;
}

function buyPermitIfNeeded(trader, cityId, itemId) {
  if (!PERMIT_ITEMS.has(itemId)) return; // basic item, no permit needed
  if (hasValidPermit(trader, cityId)) return; // already has one

  // Check if it's worth buying — will we profit even after permit cost?
  // Amortize cost over PERMIT_TRIPS trips
  const item = ITEMS.find(i => i.id === itemId);
  if (!item) return;
  const grossPerTrip = sellPrice(cityId, item) * Math.floor(traderCapacity(trader) / item.weight);
  const permitCostPerTrip = PERMIT_COST / PERMIT_TRIPS;
  if (grossPerTrip > permitCostPerTrip * 2 && (trader.gold || 0) >= PERMIT_COST) {
    trader.gold -= PERMIT_COST;
    if (!trader.permits) trader.permits = {};
    trader.permits[cityId] = {
      expires_at_trip: (trader.trips_completed || 0) + PERMIT_TRIPS,
    };
    console.log(`[${trader.name}] Bought ${cityId} permit for ${PERMIT_COST}g (valid ${PERMIT_TRIPS} trips)`);
    addTaxRevenue(cityId, PERMIT_COST, 'permit');
  }
}

// ── Price model (mirrors main.js) ───────────────────────────────────────────

const CITY_MULTS = {
  valdenmere: { grain: 1.15, food: 1.10, ore: 1.20, herbs: 1.12, potion: 0.90, relic: 1.15, ink: 1.08, copper: 1.20, silver: 0.98, gold: 0.90 },
  ashport:    { grain: 1.05, food: 0.90, ore: 1.05, herbs: 0.90, potion: 1.10, relic: 1.20, ink: 1.12, copper: 1.22, silver: 1.10, gold: 1.08 },
  crosshaven: { grain: 0.80, food: 0.85, ore: 1.00, herbs: 1.15, potion: 1.18, relic: 1.10, ink: 1.00, copper: 0.68, silver: 1.16, gold: 1.03 },
  ironholt:   { grain: 1.32, food: 1.30, ore: 0.65, herbs: 1.20, potion: 1.08, relic: 0.85, ink: 0.95, copper: 1.05, silver: 0.90, gold: 0.95 },
};

const WORLD_STATE = {
  day: 1,
  frac: 0,
  seed: 1,
};

// Same seeded functions as main.js
function seeded01(a, b, c = 0) {
  let n = (a * 374761393 + b * 668265263 + c * 362437) >>> 0;
  n = (n ^ (n >> 13)) >>> 0;
  n = (n * 1274126177) >>> 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}
function citySeed(cityId) {
  return ({ valdenmere: 1337, ashport: 7331, crosshaven: 4219, ironholt: 9901 })[cityId] || 5555;
}

function dayWobble(cityId, item) {
  const day = Math.max(1, Math.floor(WORLD_STATE.day || 1));
  const cs = citySeed(cityId);
  const u = seeded01(cs ^ (item.base * 7), day, item.id.charCodeAt(0) || 0);
  return 0.97 + u * 0.06;
}

function eventModifier(cityId, itemId) {
  let mult = 1.0;
  for (const ev of WORLD_EVENTS) {
    if (ev.cities && !ev.cities.includes(cityId)) continue;
    if (ev.items  && !ev.items.includes(itemId))  continue;
    mult *= ev.effect;
  }
  return mult;
}

function midPriceFor(cityId, item) {
  const mult  = CITY_MULTS[cityId]?.[item.id] ?? 1;
  const drift = MARKET_DRIFT[cityId]?.[item.id] ?? 1;
  const wob   = dayWobble(cityId, item);
  const econ  = 1 + (PRESSURE_MAP[`${cityId}:${item.id}`] || 0);
  const evMod = eventModifier(cityId, item.id);
  return Math.max(1, Math.round(item.base * mult * drift * wob * econ * evMod));
}

function generateWorldEvents() {
  const day = WORLD_STATE.day;
  if (day < (WORLD_STATE.next_event_day || 0)) return false;

  // Expire old events
  for (let i = WORLD_EVENTS.length - 1; i >= 0; i--) {
    if (WORLD_EVENTS[i].endDay <= day) {
      console.log(`[WORLD_EVENT] "${WORLD_EVENTS[i].name}" expired on day ${day}`);
      WORLD_EVENTS.splice(i, 1);
    }
  }

  // Cap at 2 simultaneous events; 50% roll for new event
  if (WORLD_EVENTS.length >= 2) return false;
  if (Math.random() > 0.5) return false;

  const activeIds = new Set(WORLD_EVENTS.map(e => e.templateId));
  const available = WORLD_EVENT_TEMPLATES.filter(t => !activeIds.has(t.id));
  if (!available.length) return false;

  const tmpl = available[Math.floor(Math.random() * available.length)];
  const dur  = tmpl.minDur + Math.floor(Math.random() * (tmpl.maxDur - tmpl.minDur + 1));
  WORLD_EVENTS.push({
    templateId: tmpl.id,
    name:       tmpl.name,
    cities:     tmpl.cities ? [...tmpl.cities] : null,
    items:      tmpl.items  ? [...tmpl.items]  : null,
    effect:     tmpl.effect,
    startDay:   day,
    endDay:     day + dur,
  });
  WORLD_STATE.next_event_day = day + 7 + Math.floor(Math.random() * 7);
  const ev = WORLD_EVENTS[WORLD_EVENTS.length - 1];
  console.log(`[WORLD_EVENT] "${ev.name}" started day ${ev.startDay}–${ev.endDay} ×${ev.effect}`);
  return true;
}

// Live market pressure snapshot loaded at tick start — keyed as "cityId:itemId"
const PRESSURE_MAP = {};

async function loadWorldState() {
  try {
    const rows = await sbFetch(
      '/rest/v1/world_state?id=eq.main&select=day,frac,seed,active_events,next_event_day,market_drift,market_drift_day,contract_boards,contract_regen'
    ) || [];
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && typeof row === 'object') {
      WORLD_STATE.day            = Number.isFinite(row.day)            ? row.day            : WORLD_STATE.day;
      WORLD_STATE.frac           = Number.isFinite(row.frac)           ? row.frac           : WORLD_STATE.frac;
      WORLD_STATE.seed           = Number.isFinite(row.seed)           ? row.seed           : WORLD_STATE.seed;
      WORLD_STATE.next_event_day = Number.isFinite(row.next_event_day) ? row.next_event_day : 0;
      // Restore active events
      if (Array.isArray(row.active_events)) {
        WORLD_EVENTS.length = 0;
        for (const ev of row.active_events) WORLD_EVENTS.push(ev);
        console.log(`[WORLD_EVENT] Loaded ${WORLD_EVENTS.length} active event(s)`);
      }
      // Restore market drift
      MARKET_DRIFT_DAY = Number.isFinite(row.market_drift_day) ? row.market_drift_day : 0;
      if (row.market_drift && typeof row.market_drift === 'object') {
        for (const [cid, items] of Object.entries(row.market_drift)) {
          MARKET_DRIFT[cid] = { ...items };
        }
      }
      initMarketDrift(); // fill any cities/items missing from stored blob

      // Restore contract boards + regen tracking
      if (row.contract_boards && typeof row.contract_boards === 'object') {
        for (const [cid, board] of Object.entries(row.contract_boards)) {
          if (Array.isArray(board)) CONTRACT_BOARDS[cid] = board;
        }
      }
      if (row.contract_regen && typeof row.contract_regen === 'object') {
        for (const [cid, lastDay] of Object.entries(row.contract_regen)) {
          if (Number.isFinite(lastDay)) CONTRACT_REGEN_DAY[cid] = lastDay;
        }
      }
    }
  } catch (e) {
    console.warn('[WORLD_STATE] Failed to load (non-fatal):', e.message);
  }
}

async function loadPressureMap() {
  try {
    for (const key of Object.keys(PRESSURE_MAP)) delete PRESSURE_MAP[key];
    const rows = await sbFetch('/rest/v1/market_economy?select=city_id,item_id,pressure') || [];
    for (const r of rows) PRESSURE_MAP[`${r.city_id}:${r.item_id}`] = r.pressure;
    console.log(`[PRESSURE] Loaded ${rows.length} pressure entries`);
  } catch (e) {
    console.warn('[PRESSURE] Failed to load (non-fatal):', e.message);
  }
}

const PRESSURE_EFFECT = 1;

// Offline mirror of the SQL aggregate_economy() in ops/supabase_schema.sql
// (trader_tests checks the constants against it). Live, the world cron calls it
// after every ~5-min tick (and each browser client about hourly); simulateTraders
// runs it every 300 simulated seconds, i.e. the cron cadence only.
const PRESSURE_AGG = { decay: 0.85, drop: 0.001, perUnit: 0.02, clamp: 0.5 };

// Pure: returns the next { 'city:item': pressure } map. Same order as the SQL:
// decay, drop near-zero rows, fold in buy (+) / sell (−) volume, clamp.
function aggregatePressure(prev, events) {
  const next = {};
  for (const [k, v] of Object.entries(prev)) {
    // SQL: UPDATE … WHERE ABS(pressure) > drop (decay), then DELETE … WHERE ABS(pressure) < drop.
    const d = Math.abs(v) > PRESSURE_AGG.drop ? v * PRESSURE_AGG.decay : v;
    if (Math.abs(d) < PRESSURE_AGG.drop) continue;
    next[k] = d;
  }
  const delta = {};
  for (const e of events) {
    const k = `${e.city_id}:${e.item_id}`;
    delta[k] = (delta[k] || 0) + (e.direction === 'buy' ? e.qty : -e.qty);
  }
  for (const [k, q] of Object.entries(delta)) next[k] = (next[k] || 0) + q * PRESSURE_AGG.perUnit;
  const c = PRESSURE_AGG.clamp;
  for (const k of Object.keys(next)) next[k] = Math.max(-c, Math.min(c, next[k]));
  return next;
}

function marketDiscountFor(cityId) {
  return CITY_TREASURY[cityId]?.city_bonus?.marketDiscount || 0;
}

function buyPrice(cityId, item) {
  const mid = midPriceFor(cityId, item);
  const discount = marketDiscountFor(cityId);
  return Math.max(1, Math.round(mid * (1 + (SPREAD / 2)) * (1 - discount)));
}
function sellPrice(cityId, item) {
  const mid = midPriceFor(cityId, item);
  return Math.max(1, Math.round(mid * (1 - (SPREAD / 2))));
}

function netSellPrice(cityId, item) {
  const gross = sellPrice(cityId, item);
  return Math.max(1, Math.round(gross * (1 - (CITY_TAX[cityId] || 0))));
}

// ── Route picking ───────────────────────────────────────────────────────
// The picker itself lives in src/sim/trader_core.js and is shared with the
// browser fallback. This wrapper feeds it the server's prices, market pressure
// and a seeded rng (from world seed + day + trader id + trip count), so a replay
// picks the same trip.

const rngSalt = () => `${WORLD_STATE.seed}:${WORLD_STATE.day}`;

function decideRoute(trader, rng = traderRng(trader, rngSalt(), 'route')) {
  return coreDecideRoute(trader, {
    cities:   CITIES,
    items:    ITEMS,
    capacity: traderCapacity(trader),
    buy:      buyPrice,
    sellNet:  netSellPrice,
    pressure: (cityId, itemId) => PRESSURE_MAP[`${cityId}:${itemId}`] || 0,
    gold:     trader.gold || 0,
    rng,
  });
}

// ── Strategy review (triggered every N trips) ─────────────────────────────

const STRATEGY_LOG_BATCH = []; // collect log entries, upsert at end of tick
const TRADE_EVENTS_BATCH = []; // collect trade events, upsert at end of tick

// How attractive each item is as a trader's focus: profit over every city pair
// (saturated sell markets skipped), weighted up where the source is the trader's
// current city. Same units as before the extraction; used by reviewStrategy.
function focusScores(trader) {
  const fromId = trader.to_id || trader.from_id || 'valdenmere';
  const itemProfits = {};
  for (const srcId of CITIES) {
    for (const toId of CITIES) {
      if (toId === srcId) continue;
      for (const item of ITEMS) {
        if (item.sourceCities && !item.sourceCities.includes(srcId)) continue;
        const sellPressure = PRESSURE_MAP[`${toId}:${item.id}`] || 0;
        if (sellPressure >= 0.4) continue; // skip saturated sell markets entirely
        const p = (netSellPrice(toId, item) - buyPrice(srcId, item)) * Math.floor(traderCapacity(trader) / item.weight);
        if (p > 0) {
          // Weight by how close the source city is to the trader's current position
          const distWeight = srcId === fromId ? 1.5 : 1.0;
          itemProfits[item.id] = (itemProfits[item.id] || 0) + p * distWeight;
        }
      }
    }
  }
  return itemProfits;
}

// A niche pivot must score this much better than the current focus to happen
// (not when the current item is crowded). Stops the every-review churn.
const FOCUS_SWITCH_MARGIN = 1.25;

// peers: a snapshot of every trader taken before this tick, so each trader can
// compare itself with the others. nowIso stamps the log entry.
// focus: live { traderId: preferred_item } board shared by every review in one
// tick, so a trader sees the picks peers made earlier in the same tick instead
// of all diving into the same "uncontested" item from the pre-tick snapshot.
function reviewStrategy(trader, { nowIso, peers: allPeers = [], focus = null }) {
  const history = Array.isArray(trader.profit_history) ? trader.profit_history : [];
  const trips   = trader.trips_completed || 0;

  // Compute recent profit rate (last 3 trips)
  const recentWindow = history.slice(-3);
  const recentProfit = recentWindow.reduce((s, e) => s + (e.profit || 0), 0);
  const recentRate   = recentWindow.length > 0 ? recentProfit / recentWindow.length : 0;

  const itemProfits = focusScores(trader);
  const bestItem = Object.entries(itemProfits).sort((a, b) => b[1] - a[1])[0];

  // ── Peer comparison ───────────────────────────────────────────────────
  const peers = allPeers.filter(p => p.id !== trader.id);
  const peerRates = peers.map(p => {
    const ph = Array.isArray(p.profit_history) ? p.profit_history : [];
    const w  = ph.slice(-3);
    return w.length > 0 ? w.reduce((s, e) => s + (e.profit || 0), 0) / w.length : 0;
  });
  const bestPeerRate = peerRates.length > 0 ? Math.max(...peerRates) : 0;
  const avgPeerRate  = peerRates.length > 0 ? peerRates.reduce((a, b) => a + b, 0) / peerRates.length : 0;

  // Count how many peers share the same preferred item (saturation)
  const peerFocus = p => (focus && p.id in focus ? focus[p.id] : p.preferred_item);
  const competingPeers = peers.filter(p => peerFocus(p) === trader.preferred_item && trader.preferred_item).length;

  // Find item no other trader is focusing on (niche opportunity)
  const takenItems = new Set(peers.map(peerFocus).filter(Boolean));
  const nicheItems = Object.entries(itemProfits)
    .filter(([id]) => !takenItems.has(id))
    .sort((a, b) => b[1] - a[1]);
  const nicheItem = nicheItems[0];

  const oldStrategy = {
    preferred_item: trader.preferred_item || null,
    personality: trader.personality,
  };

  let decision = 'no_change';
  let reason   = '';
  let newPreferredItem = trader.preferred_item || null;
  let nextReviewAt = trips + 3;

  if (recentRate === 0 && trips === 0) {
    // First review — pick best uncrowded item
    decision = 'init_strategy';
    newPreferredItem = nicheItem?.[0] || bestItem?.[0] || null;
    reason = `First strategy. Picked ${newPreferredItem} (score ${itemProfits[newPreferredItem] || 0}g, uncrowded).`;
    nextReviewAt = trips + 3;
  } else if (recentRate < bestPeerRate * 0.75) {
    // Significantly behind the best peer — need a shake-up
    const bestPeer = peers[peerRates.indexOf(bestPeerRate)];
    if (nicheItem && nicheItem[1] > bestPeerRate * 0.5 && nicheItem[1] > (itemProfits[newPreferredItem] || 0) * 0.9) {
      // Pivot to an uncontested niche only if its score is worth it (>50% of leader rate)
      decision = 'pivot_niche';
      const oldItem = newPreferredItem;
      newPreferredItem = nicheItem[0];
      reason = `Trailing best peer ${bestPeer?.name} (${bestPeerRate.toFixed(0)}g vs my ${recentRate.toFixed(0)}g/trip). Pivoting to uncontested ${newPreferredItem} (score ${nicheItem[1]}g).`;
    } else {
      // Copy the leader's item — unless 2+ traders already focus on it (live
      // board), which would just pile everyone onto one market.
      const leaderItem = (bestPeer && peerFocus(bestPeer)) || bestItem?.[0] || null;
      const holders = peers.filter(p => peerFocus(p) === leaderItem).length;
      if (leaderItem && leaderItem !== trader.preferred_item && holders >= 2) {
        decision = 'hold';
        reason = `Trailing best peer ${bestPeer?.name}, but ${holders} traders already focus on ${leaderItem}. Holding ${newPreferredItem || 'flexible'}.`;
      } else {
        decision = 'copy_leader';
        newPreferredItem = leaderItem;
        reason = `Trailing best peer ${bestPeer?.name} (${bestPeerRate.toFixed(0)}g vs my ${recentRate.toFixed(0)}g/trip). Copying their focus: ${newPreferredItem}.`;
      }
    }
    nextReviewAt = trips + 2;
  } else if (recentRate >= bestPeerRate && recentRate > avgPeerRate * 1.2) {
    // Leading the pack — stay course
    decision = 'stay_course';
    reason   = `Leading peers (${recentRate.toFixed(0)}g/trip vs avg ${avgPeerRate.toFixed(0)}g). Staying on ${newPreferredItem || 'flexible'}.`;
    nextReviewAt = trips + 4;
  } else if (competingPeers >= 2 && nicheItem) {
    // Too crowded on current item — find a niche
    decision = 'find_niche';
    const oldItem = newPreferredItem;
    newPreferredItem = nicheItem[0];
    reason = `${competingPeers} peers competing on ${oldItem}. Moving to uncontested ${newPreferredItem} (score ${nicheItem[1]}g).`;
    nextReviewAt = trips + 3;
  } else if (trader.preferred_item) {
    const currentScore = itemProfits[trader.preferred_item] || 0;
    const bestScore    = bestItem?.[1] || 0;
    if (bestScore > currentScore * 1.3 && !takenItems.has(bestItem[0])) {
      decision = 'upgrade_item';
      newPreferredItem = bestItem[0];
      reason = `${trader.preferred_item} (${currentScore}g) < ${newPreferredItem} (${bestScore}g, uncrowded). Upgrading.`;
    } else {
      decision = 'stay_course';
      reason   = `Performing near peer avg (${recentRate.toFixed(0)}g vs avg ${avgPeerRate.toFixed(0)}g). Holding ${newPreferredItem}.`;
    }
  } else {
    decision = 'set_focus';
    newPreferredItem = nicheItem?.[0] || bestItem?.[0] || null;
    reason = `No focus set. Picking ${newPreferredItem} — ${takenItems.has(newPreferredItem) ? 'contested' : 'uncontested'} (score ${itemProfits[newPreferredItem] || 0}g).`;
  }

  // Hysteresis: a niche pivot must clearly beat the current focus on paper.
  // copy_leader is exempt (it follows realised results); so is a crowded item.
  const prevItem = trader.preferred_item || null;
  if (prevItem && newPreferredItem !== prevItem && decision === 'pivot_niche' && competingPeers < 2
      && (itemProfits[newPreferredItem] || 0) < (itemProfits[prevItem] || 0) * FOCUS_SWITCH_MARGIN) {
    reason = `Would ${decision} to ${newPreferredItem} (${itemProfits[newPreferredItem] || 0}g) but ${prevItem} (${itemProfits[prevItem] || 0}g) is within ${Math.round((FOCUS_SWITCH_MARGIN - 1) * 100)}%. Holding.`;
    decision = 'hold';
    newPreferredItem = prevItem;
  }

  trader.preferred_item  = newPreferredItem;
  if (focus) focus[trader.id] = newPreferredItem;
  trader.review_at_trips = nextReviewAt;

  const logEntry = {
    trader_id:    trader.id,
    trader_name:  trader.name,
    trips_at:     trips,
    decision,
    reason,
    profit_rate:  recentRate,
    old_strategy: JSON.stringify(oldStrategy),
    new_strategy: JSON.stringify({ preferred_item: newPreferredItem, personality: trader.personality }),
    created_at:   nowIso,
  };
  STRATEGY_LOG_BATCH.push(logEntry);
  console.log(`[STRATEGY][${trader.name}] ${decision}: ${reason}`);
}

async function flushStrategyLog() {
  if (STRATEGY_LOG_BATCH.length === 0) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trader_strategy_log`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify(STRATEGY_LOG_BATCH),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[STRATEGY] Log insert failed:', body);
    } else {
      console.log(`[STRATEGY] Logged ${STRATEGY_LOG_BATCH.length} decision(s)`);
    }
  } catch (e) {
    console.warn('[STRATEGY] Log flush error (non-fatal):', e.message);
  }
  STRATEGY_LOG_BATCH.length = 0;
}

async function flushTradeEvents() {
  if (TRADE_EVENTS_BATCH.length === 0) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trade_events`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify(TRADE_EVENTS_BATCH),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[TRADE_EVENTS] Insert failed:', body);
    } else {
      console.log(`[TRADE_EVENTS] Logged ${TRADE_EVENTS_BATCH.length} event(s)`);
    }
  } catch (e) {
    console.warn('[TRADE_EVENTS] Flush error (non-fatal):', e.message);
  }
  TRADE_EVENTS_BATCH.length = 0;
}

// ── Supabase helpers ───────────────────────────────────────────────────────

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
};

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers: HEADERS, ...opts });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status} ${path}: ${body}`);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : null;
}

// ── City Treasury ─────────────────────────────────────────────────────────

// In-memory treasury accumulates within a tick, flushed at end
// Blank bonus/buildings — merged from DB on load
function blankBonus() { return { marketDiscount:0, roadSpeed:0, foodSubsidy:0, popIncentive:0, guardDiscount:0 }; }
// Per-city building slot availability
const CITY_BUILDING_SLOTS = {
  valdenmere: ['market','barracks','granary','guild','warehouse','inn'],
  ashport:    ['market','warehouse','inn','guild'],
  crosshaven: ['granary','inn','market'],
  ironholt:   ['barracks','warehouse','granary','market'],
};

// All building definitions (used to construct per-city sets)
const ALL_BUILDING_DEFS = {
  market:    { level:0, maxLevel:3, costPerLevel:[80,160,300],  effect:'marketDiscount', gain:0.05, built:false, playerFunded:0 },
  barracks:  { level:0, maxLevel:2, costPerLevel:[100,200],     effect:'guardDiscount',  gain:0.10, built:false, playerFunded:0 },
  granary:   { level:0, maxLevel:2, costPerLevel:[60,120],      effect:'foodSubsidy',    gain:0.10, built:false, playerFunded:0 },
  guild:     { level:0, maxLevel:1, costPerLevel:[200],         effect:'popIncentive',   gain:0.10, built:false, playerFunded:0 },
  warehouse: { level:0, maxLevel:2, costPerLevel:[90,180],      effect:'roadSpeed',      gain:0.05, built:false, playerFunded:0 },
  inn:       { level:0, maxLevel:1, costPerLevel:[70],          effect:'roadSpeed',      gain:0.05, built:false, playerFunded:0 },
};

// Build blank buildings object containing ONLY the allowed slots for a city (fix: was all 6 for every city)
function blankBuildings(cityId) {
  const allowed = CITY_BUILDING_SLOTS[cityId] || [];
  return Object.fromEntries(allowed.map(k => [k, { ...ALL_BUILDING_DEFS[k] }]));
}

const CITY_TREASURY = {
  valdenmere: { gold:60, tax_collected:0, permit_collected:0, spent:0, invest_log:[], population:8000, hunger:0, bank_reserve:120, total_deposits:0, bankrupt_day:null, city_bonus:blankBonus(), buildings:blankBuildings('valdenmere') },
  ashport:    { gold:40, tax_collected:0, permit_collected:0, spent:0, invest_log:[], population:4000, hunger:0, bank_reserve:80,  total_deposits:0, bankrupt_day:null, city_bonus:blankBonus(), buildings:blankBuildings('ashport')    },
  crosshaven: { gold:30, tax_collected:0, permit_collected:0, spent:0, invest_log:[], population:1500, hunger:0, bank_reserve:40,  total_deposits:0, bankrupt_day:null, city_bonus:blankBonus(), buildings:blankBuildings('crosshaven') },
  ironholt:   { gold:45, tax_collected:0, permit_collected:0, spent:0, invest_log:[], population:2500, hunger:0, bank_reserve:60,  total_deposits:0, bankrupt_day:null, city_bonus:blankBonus(), buildings:blankBuildings('ironholt')   },
};

const BANK_BANKRUPTCY_REOPEN_DAYS = 5; // mirrors client constant

// ── Contract boards (shared listings per city) ─────────────────────────────
const CONTRACT_REGEN_DAYS = 3;
const CONTRACT_ITEMS          = ['grain','food','ore','herbs','potion','relic'];
const CONTRACT_ITEMS_IRONHOLT = ['grain','food','ore','herbs','potion','relic','coal','coal','gem'];
const CONTRACT_BOARDS    = {}; // { cityId: [contracts] }
const CONTRACT_REGEN_DAY = {}; // { cityId: lastRegenDay }

// Mirrors rewardForContract() in src/main.js — both must stay in sync (asserted by tests)
function rewardForContract(want, qty) {
  const it = ITEMS.find(x => x.id === want);
  const base = it ? it.base : 20;
  const bestMarginRef = {
    grain: 7, food: 5, ore: 9, herbs: 7, potion: 10, relic: 18, ink: 13, coal: 4, gem: 22,
  }[want] || 5;
  const buyCostRef       = Math.round(base * 0.88);
  const deliveryPremium  = Math.round(bestMarginRef * 1.2);
  const perUnit          = buyCostRef + deliveryPremium;
  const qtyMult          = qty === 1 ? 1.0 : qty === 2 ? 1.75 : 2.35;
  const r = Math.round(perUnit * qtyMult);
  return Math.max(18, Math.min(280, r));
}

function makeContract(fromId, tier, daySeed, slotIdx) {
  const pool = (fromId === 'ironholt') ? CONTRACT_ITEMS_IRONHOLT : CONTRACT_ITEMS;
  // Deterministic per (city, day, slot)
  const seedA = citySeed(fromId);
  const wIdx  = Math.floor(seeded01(seedA, daySeed, slotIdx * 13 + tier) * pool.length);
  const want  = pool[Math.min(wIdx, pool.length - 1)];
  const qty   = 1 + Math.floor(seeded01(seedA, daySeed + 7919, slotIdx * 19 + tier) * (2 + tier));
  const others = CITIES.filter(id => id !== fromId);
  const toIdx = Math.floor(seeded01(seedA, daySeed + 1009, slotIdx * 31 + tier) * others.length);
  const toId  = others[Math.min(toIdx, others.length - 1)];
  return { fromId, toId, want, qty, reward: rewardForContract(want, qty), tier };
}

function regenerateContracts() {
  const day = Math.floor(WORLD_STATE.day);
  let regenerated = 0;
  for (const cityId of CITIES) {
    const lastRegen = CONTRACT_REGEN_DAY[cityId] || 0;
    if (day > 0 && day - lastRegen >= CONTRACT_REGEN_DAYS) {
      CONTRACT_BOARDS[cityId] = [
        makeContract(cityId, 0, day, 0),
        makeContract(cityId, 0, day, 1),
        makeContract(cityId, 1, day, 2),
        makeContract(cityId, 2, day, 3),
      ];
      CONTRACT_REGEN_DAY[cityId] = day;
      regenerated++;
    }
  }
  if (regenerated > 0) console.log(`[CONTRACTS] Regenerated ${regenerated} board(s) on day ${day}`);
}

function addTaxRevenue(cityId, amount, type = 'tax') {
  const t = CITY_TREASURY[cityId];
  if (!t) return;
  t.gold += amount;
  if (type === 'permit') t.permit_collected += amount;
  else t.tax_collected += amount;
}

function tickCityTreasury(cityId) {
  const t = CITY_TREASURY[cityId];
  if (!t) return;

  // Invest in building slots (mirrors main.js cityInvestTick)
  const allowedSlots = CITY_BUILDING_SLOTS[cityId] || [];
  const candidates = allowedSlots
    .map(key => ({ key, slot: t.buildings[key] }))
    .filter(({ slot }) => {
      if (!slot) return false;
      const nextCost = slot.costPerLevel[slot.level];
      return nextCost !== undefined && slot.level < slot.maxLevel &&
             t.gold >= (nextCost - (slot.playerFunded || 0));
    })
    .sort((a, b) => (a.slot.costPerLevel[a.slot.level]||999) - (b.slot.costPerLevel[b.slot.level]||999));

  if (candidates.length > 0) {
    const { key, slot } = candidates[0];
    const nextCost = slot.costPerLevel[slot.level];
    const cityPay  = Math.max(0, nextCost - (slot.playerFunded || 0));
    t.gold  -= cityPay;
    t.spent += cityPay;
    slot.playerFunded = 0;
    slot.level += 1;
    slot.built  = true;

    // Apply bonus
    if (slot.effect && t.city_bonus[slot.effect] !== undefined) {
      t.city_bonus[slot.effect] = Math.min(
        (t.city_bonus[slot.effect] || 0) + slot.gain,
        slot.gain * slot.maxLevel
      );
    }

    const label = key.charAt(0).toUpperCase() + key.slice(1);
    const entry = { day: new Date().toISOString(), project: `${label} Lv${slot.level}`, effect: slot.effect, cost: cityPay };
    t.invest_log.push(entry);
    if (t.invest_log.length > 10) t.invest_log.shift();
    console.log(`[TREASURY][${cityId}] Built ${label} Lv${slot.level} for ${cityPay}g → ${slot.effect} now ${t.city_bonus[slot.effect]}`);
  }
}

async function fetchTreasuries() {
  try {
    const rows = await sbFetch('/rest/v1/city_treasury?select=*') || [];
    // Merge DB state into in-memory CITY_TREASURY
    for (const row of rows) {
      const t = CITY_TREASURY[row.city_id];
      if (!t) continue;
      t.gold             = row.gold || 0;
      t.tax_collected    = row.tax_collected || 0;
      t.permit_collected = row.permit_collected || 0;
      t.spent            = row.spent || 0;
      t.invest_log       = row.invest_log || [];
      if (row.population) t.population = row.population;
      if (Number.isFinite(row.hunger))         t.hunger         = row.hunger;
      if (Number.isFinite(row.bank_reserve))   t.bank_reserve   = row.bank_reserve;
      if (Number.isFinite(row.total_deposits)) t.total_deposits = row.total_deposits;
      t.bankrupt_day = Number.isFinite(row.bankrupt_day) ? row.bankrupt_day : null;
      // Restore city_bonus from DB
      if (row.city_bonus && typeof row.city_bonus === 'object') {
        Object.assign(t.city_bonus, row.city_bonus);
      }
      // Restore buildings from DB
      if (row.buildings && typeof row.buildings === 'object') {
        for (const [key, saved] of Object.entries(row.buildings)) {
          if (!t.buildings[key]) continue;
          t.buildings[key].level       = saved.level       ?? t.buildings[key].level;
          t.buildings[key].built       = saved.built       ?? t.buildings[key].built;
          t.buildings[key].playerFunded = saved.playerFunded ?? t.buildings[key].playerFunded;
        }
      }
    }
    return rows;
  } catch { return []; }
}

async function upsertTreasuries() {
  const rows = Object.entries(CITY_TREASURY).map(([cityId, t]) => ({
    city_id:          cityId,
    gold:             Math.max(0, t.gold),
    tax_collected:    t.tax_collected,
    permit_collected: t.permit_collected,
    spent:            t.spent,
    invest_log:       t.invest_log,
    population:       t.population,
    hunger:           Math.max(0, Math.min(1, t.hunger || 0)),
    bank_reserve:     Math.max(0, t.bank_reserve || 0),
    total_deposits:   Math.max(0, t.total_deposits || 0),
    bankrupt_day:     t.bankrupt_day ?? null,
    city_bonus:       t.city_bonus || {},
    buildings:        Object.fromEntries(
      Object.entries(t.buildings || {}).map(([k, s]) => [k, {
        level: s.level, built: s.built, playerFunded: s.playerFunded
      }])
    ),
    updated_at:       new Date().toISOString(),
  }));
  try {
    await sbFetch('/rest/v1/city_treasury', {
      method: 'POST',
      body: JSON.stringify(rows),
    });
    console.log(`[TREASURY] Upserted ${rows.length} city treasuries`);
  } catch (e) {
    console.warn('[TREASURY] Upsert failed (non-fatal):', e.message);
  }
}

async function fetchTraders() {
  return sbFetch('/rest/v1/world_traders?select=*');
}

async function upsertTraders(traders) {
  return sbFetch('/rest/v1/world_traders', {
    method: 'POST',
    body: JSON.stringify(traders),
  });
}

async function callAggregateEconomy() {
  try {
    await sbFetch('/rest/v1/rpc/aggregate_economy', { method: 'POST', body: '{}' });
    console.log('[ECONOMY] aggregate_economy() called');
  } catch (e) {
    console.warn('[ECONOMY] aggregate_economy failed (non-fatal):', e.message);
  }
}

// ── Tick logic ────────────────────────────────────────────────────────────

// Copy of every trader for strategy reviews, taken before a tick. profit_history
// is copied too, so a peer never sees trips finished during the same tick.
function snapshotPeers(traders) {
  return traders.map(t => ({
    ...t,
    profit_history: Array.isArray(t.profit_history) ? t.profit_history.slice() : [],
  }));
}

// Advance one trader by `elapsed` seconds. Deterministic: the time stamp comes
// from nowIso and every random choice from a seeded rng, so the same snapshot
// always replays the same way. peers = pre-tick snapshot for strategy reviews.
function tickTrader(t, elapsed, { nowIso, peers = [], onRescue, focus = null } = {}) {
  if (typeof nowIso !== 'string') throw new Error('tickTrader needs { nowIso }');
  // Process elapsed time in micro-steps so multiple trips can complete in one tick
  const STEP = 60; // seconds per micro-step
  let remaining = elapsed;
  while (remaining > 0) {
    const dt = Math.min(STEP, remaining);
    remaining -= dt;

    if (t.state === 'in_city') {
      t.city_timer -= dt;
      if (t.city_timer <= 0) {
        // Depart
        const route = decideRoute(t);
        t.from_id = route.fromId;
        t.to_id   = route.toId;
        t.item_id = route.itemId;

        // Buy exactly what the route was scored on. The fallback trip (nothing
        // affordable and profitable) has no units: travel on with an empty cart.
        const item = ITEMS.find(i => i.id === route.itemId);
        if (item) {
          const buy = buyPrice(route.fromId, item);
          const units = route.units || 0;
          if (units > 0) {
            t.gold -= buy * units;
            t.inv = { [route.itemId]: units };
            // Record buy event for market pressure
            TRADE_EVENTS_BATCH.push({
              city_id:   route.fromId,
              item_id:   route.itemId,
              direction: 'buy',
              qty:       units,
              created_at: nowIso,
            });
          } else {
            t.inv = {};
          }
        }

        // Buy permit if needed for destination
        buyPermitIfNeeded(t, route.toId, route.itemId);

        t.state    = 'traveling';
        t.progress = 0;
        console.log(`[${t.name}] Departing ${t.from_id} → ${t.to_id} with ${JSON.stringify(t.inv)}`);
      }
    } else if (t.state === 'traveling') {
      const duration = routeSeconds(t.from_id, t.to_id);
      t.progress = Math.min(1, t.progress + dt / duration);

      if (t.progress >= 1) {
        // Arrive — sell cargo (with tax + permit enforcement)
        let revenue = 0;
        let taxPaid = 0;
        const taxRate = CITY_TAX[t.to_id] || 0.10;
        for (const [itemId, qty] of Object.entries(t.inv || {})) {
          if (!qty) continue;
          const item = ITEMS.find(i => i.id === itemId);
          if (!item) continue;
          // Permit check — can't sell premium items without a permit
          if (PERMIT_ITEMS.has(itemId) && !hasValidPermit(t, t.to_id)) {
            console.log(`[${t.name}] No permit for ${itemId} in ${t.to_id} — selling as contraband at 50% price`);
            revenue += Math.round(sellPrice(t.to_id, item) * qty * 0.5);
          } else {
            const gross = sellPrice(t.to_id, item) * qty;
            const tax   = Math.round(gross * taxRate);
            revenue  += gross - tax;
            taxPaid  += tax;
          }
          // Record sell event for market pressure
          TRADE_EVENTS_BATCH.push({
            city_id:   t.to_id,
            item_id:   itemId,
            direction: 'sell',
            qty,
            created_at: nowIso,
          });
        }
        if (taxPaid > 0) {
          console.log(`[${t.name}] Paid ${taxPaid}g tax (${Math.round(taxRate*100)}%) to ${t.to_id}`);
          addTaxRevenue(t.to_id, taxPaid, 'tax');
        }
        const cargoCost = Object.entries(t.inv || {}).reduce((sum, [itemId, qty]) => {
          if (!qty) return sum;
          const item = ITEMS.find(i => i.id === itemId);
          if (!item) return sum;
          return sum + (buyPrice(t.from_id, item) * qty);
        }, 0);
        const tripProfit = revenue - cargoCost;
        t.gold += revenue;
        // Anti-softlock rescue (NOT a per-trip subsidy): only fires when a trader
        // can't afford the single cheapest cargo unit anywhere and would otherwise
        // be stranded with an empty cart forever. After the economy rebalance a
        // healthy trader stays well above this, so it should rarely trigger — if it
        // fires often, the base economy has regressed (see balance_regression_test).
        // The bar is one unit of the cheapest *profitable* cargo from this
        // city: a trader holding only the global cheapest unit's price can
        // still be unable to buy anything worth carrying here and shuttle with
        // an empty cart forever (seen live). No rescue when nothing from here
        // is profitable at all: the fallback trip moves the trader on instead.
        const minCargoCost = stuckRescueGold(t.to_id);
        if (Number.isFinite(minCargoCost) && t.gold < minCargoCost) {
          console.log(`[${t.name}] ⚠️ Stranded rescue (${t.gold}g → ${minCargoCost}g — couldn't afford any profitable cargo here)`);
          if (onRescue) onRescue({ trader: t.id, from: t.gold, to: minCargoCost });
          t.gold = minCargoCost;
        }
        t.total_profit     = (t.total_profit || 0) + tripProfit;
        t.trips_completed  = (t.trips_completed || 0) + 1;
        // Track per-trip realized profit history (keep last 10)
        const history = Array.isArray(t.profit_history) ? t.profit_history : [];
        history.push({ trip: t.trips_completed, profit: tripProfit, item: t.item_id, to: t.to_id, at: nowIso });
        if (history.length > 10) history.splice(0, history.length - 10);
        t.profit_history   = history;
        t.inv              = {};
        t.from_id          = t.to_id;
        t.state            = 'in_city';
        t.city_timer       = cityDwellSeconds(traderRng(t, rngSalt(), 'dwell'));
        t.progress         = 0;
        console.log(`[${t.name}] Arrived at ${t.to_id}, revenue ${revenue}g, trip profit ${tripProfit}g. Total profit: ${t.total_profit}g`);

        // Gear upgrade check (every trip)
        tryGearUpgrade(t);

        // Strategy review every N trips
        const reviewAt = t.review_at_trips || 3;
        if (t.trips_completed >= reviewAt) {
          reviewStrategy(t, { nowIso, peers, focus });
        }
      }
    }
  }
  t.updated_at = nowIso;
}

// ── Offline trader simulation (headless report) ─────────────────────────
// Runs every AI trader for N game-days entirely in memory: no DB, no clock, no
// Math.random. Starts from a neutral world (day 1, no events, no pressure,
// drift 1.0, no treasury discount) and restores this module's state afterwards.
// With pressure (default) trades move prices through aggregatePressure, as the
// live DB does; pressure: false reports the base economy instead.
//
// SIM_SECONDS_PER_DAY ≈ ROUTE_SECONDS / trade_sim TRAVEL_DAYS (180s ≈ 2 days).
const SIM_SECONDS_PER_DAY = 90;
const SIM_STEP_SECONDS    = 60;
const SIM_AGGREGATE_SECONDS = 300; // live: aggregate_economy() runs after each ~5-min cron tick
const SIM_NOW_ISO         = '2000-01-01T00:00:00.000Z'; // fixed stamp for offline runs

// Trip bookkeeping below needs every trip to span at least one step boundary.
const MIN_ROUTE_SECONDS = Math.min(DEFAULT_ROUTE_SECONDS, ...Object.values(ROUTE_SECONDS));
if (MIN_ROUTE_SECONDS <= SIM_STEP_SECONDS) {
  throw new Error(`SIM_STEP_SECONDS (${SIM_STEP_SECONDS}) must be shorter than the shortest route (${MIN_ROUTE_SECONDS}s)`);
}

function simulateTraders({ days = 30, seed = 1, pressure = true } = {}) {
  const saved = {
    world: { ...WORLD_STATE },
    events: WORLD_EVENTS.slice(),
    pressure: { ...PRESSURE_MAP },
    drift: JSON.parse(JSON.stringify(MARKET_DRIFT)),
    treasury: JSON.parse(JSON.stringify(CITY_TREASURY)),
    tradeEvents: TRADE_EVENTS_BATCH.length,
    strategyLog: STRATEGY_LOG_BATCH.length,
  };
  const log = console.log;
  console.log = () => {};
  try {
    WORLD_STATE.day = 1;
    WORLD_STATE.frac = 0;
    WORLD_STATE.seed = seed;
    WORLD_EVENTS.length = 0;
    for (const k of Object.keys(PRESSURE_MAP)) delete PRESSURE_MAP[k];
    for (const cityId of CITIES) {
      MARKET_DRIFT[cityId] = {};
      for (const item of ITEMS) MARKET_DRIFT[cityId][item.id] = 1.0;
    }
    for (const t of Object.values(CITY_TREASURY)) {
      if (t.city_bonus) t.city_bonus.marketDiscount = 0;
    }

    const traders = TRADER_DEFS.map((def, i) => makeSeedTrader(def, i, SIM_NOW_ISO));
    const trips = []; // every completed trip: { trader, from, to, item, profit, empty }
    const lastTrip = Object.fromEntries(traders.map(t => [t.id, 0]));
    const rescues = Object.fromEntries(traders.map(t => [t.id, 0]));
    const onRescue = ({ trader }) => { rescues[trader] += 1; };
    const market = { maxPressure: 0, minPressure: 0 };
    const strategy = { switches: 0, herds: 0 }; // focus changes; herds = 2+ switching to one item in a live-tick window
    const switchedTo = {};
    // Live focus board for the whole run (kept current after every review), like main()'s per tick.
    const focus = Object.fromEntries(traders.map(t => [t.id, t.preferred_item || null]));
    const totalSeconds = days * SIM_SECONDS_PER_DAY;

    for (let elapsed = 0; elapsed < totalSeconds; elapsed += SIM_STEP_SECONDS) {
      WORLD_STATE.day = 1 + Math.floor(elapsed / SIM_SECONDS_PER_DAY);
      // Market pressure: fold this period's trades in, like the live DB does.
      if (pressure && elapsed > 0 && elapsed % SIM_AGGREGATE_SECONDS === 0) {
        // Consume the events, as the SQL does by DELETE (keeps memory bounded).
        const next = aggregatePressure(PRESSURE_MAP, TRADE_EVENTS_BATCH.slice(saved.tradeEvents));
        TRADE_EVENTS_BATCH.length = saved.tradeEvents;
        for (const k of Object.keys(PRESSURE_MAP)) delete PRESSURE_MAP[k];
        Object.assign(PRESSURE_MAP, next);
        for (const v of Object.values(next)) {
          market.maxPressure = Math.max(market.maxPressure, v);
          market.minPressure = Math.min(market.minPressure, v);
        }
      }
      const peers = snapshotPeers(traders);
      // Herds are counted per live-tick window (MAX_TICK), where live reviews share a board.
      if (elapsed % MAX_TICK === 0) {
        for (const n of Object.values(switchedTo)) if (n >= 2) strategy.herds += 1;
        for (const k of Object.keys(switchedTo)) delete switchedTo[k];
      }
      for (const t of traders) {
        const focusBefore = t.preferred_item;
        // Routes take ≥ 180s and a step is 60s, so a trip that ends in this step
        // was already on the road when the step began: its origin is from_id now.
        const fromBefore = t.state === 'traveling' ? t.from_id : null;
        const cargoBefore = Object.values(t.inv || {}).reduce((a, q) => a + (q || 0), 0);
        tickTrader(t, Math.min(SIM_STEP_SECONDS, totalSeconds - elapsed), { nowIso: SIM_NOW_ISO, peers, onRescue, focus });
        if (focusBefore && t.preferred_item !== focusBefore) { // a first pick is not a switch
          strategy.switches += 1;
          if (t.preferred_item) switchedTo[t.preferred_item] = (switchedTo[t.preferred_item] || 0) + 1;
        }
        focus[t.id] = t.preferred_item || null;
        for (const h of t.profit_history) {
          if (h.trip > lastTrip[t.id]) {
            trips.push({ trader: t.id, from: fromBefore, to: h.to, item: h.item, profit: h.profit, empty: cargoBefore === 0 });
            lastTrip[t.id] = h.trip;
          }
        }
      }
    }
    for (const n of Object.values(switchedTo)) if (n >= 2) strategy.herds += 1;
    return buildTraderReport({ days, seed, traders, trips, rescues, pressure, market, strategy });
  } finally {
    console.log = log;
    for (const k of Object.keys(WORLD_STATE)) delete WORLD_STATE[k];
    Object.assign(WORLD_STATE, saved.world);
    WORLD_EVENTS.length = 0; WORLD_EVENTS.push(...saved.events);
    for (const k of Object.keys(PRESSURE_MAP)) delete PRESSURE_MAP[k];
    Object.assign(PRESSURE_MAP, saved.pressure);
    for (const k of Object.keys(MARKET_DRIFT)) delete MARKET_DRIFT[k];
    Object.assign(MARKET_DRIFT, saved.drift);
    for (const k of Object.keys(CITY_TREASURY)) delete CITY_TREASURY[k];
    Object.assign(CITY_TREASURY, saved.treasury);
    TRADE_EVENTS_BATCH.length = saved.tradeEvents;
    STRATEGY_LOG_BATCH.length = saved.strategyLog;
  }
}

function buildTraderReport({ days, seed, traders, trips, rescues, pressure, market, strategy }) {
  const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
  const items = {};
  const routes = {};
  const loaded = trips.filter(tr => !tr.empty);
  const emptyBy = {};
  for (const tr of trips) if (tr.empty) emptyBy[tr.trader] = (emptyBy[tr.trader] || 0) + 1;
  // Item shares, routes and diversity count only trips that carried cargo.
  for (const tr of loaded) {
    const it = (items[tr.item] ||= { trips: 0, profit: 0, share: 0 });
    it.trips += 1; it.profit += tr.profit;
    const key = `${tr.from ?? '?'}→${tr.to}:${tr.item}`;
    const r = (routes[key] ||= { from: tr.from, to: tr.to, item: tr.item, trips: 0, profit: 0 });
    r.trips += 1; r.profit += tr.profit;
  }
  const n = loaded.length || 1;
  let hhi = 0, topShare = 0;
  for (const it of Object.values(items)) {
    it.share = it.trips / n;
    hhi += it.share * it.share;
    topShare = Math.max(topShare, it.share);
  }
  const routeList = Object.values(routes).sort((a, b) => b.trips - a.trips || b.profit - a.profit);

  return {
    days, seed,
    secondsPerDay: SIM_SECONDS_PER_DAY,
    pressureFeedback: pressure,
    market: { maxPressure: round(market.maxPressure), minPressure: round(market.minPressure) },
    strategy,
    traders: traders.map(t => ({
      id: t.id, name: t.name, personality: t.personality,
      startGold: t.start_gold, endGold: t.gold,
      profit: t.total_profit, trips: t.trips_completed,
      gearTier: t.gear_tier || 0, preferredItem: t.preferred_item,
      rescues: rescues[t.id] || 0, emptyTrips: emptyBy[t.id] || 0,
    })),
    items,
    routes: routeList.slice(0, 10),
    diversity: {
      distinctItems: Object.keys(items).length,
      distinctRoutes: routeList.length,
      topItemShare: round(topShare),
      hhi: round(hhi), // Herfindahl index of item trip shares: 1 = one item only
    },
    totals: {
      trips: trips.length,
      emptyTrips: trips.length - loaded.length,
      rescues: Object.values(rescues).reduce((a, b) => a + b, 0),
      profit: traders.reduce((s, t) => s + (t.total_profit || 0), 0),
      goldStart: traders.reduce((s, t) => s + t.start_gold, 0),
      goldEnd: traders.reduce((s, t) => s + t.gold, 0),
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[WORLD SIM] Tick starting at ${new Date().toISOString()}`);

  await loadWorldState();
  // Load market pressure before ticking so prices respond to supply/demand.
  await loadPressureMap();

  // Fixed order: reviews share a live focus board, so who reviews first matters.
  let traders = (await fetchTraders() || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // fetchTreasuries() already merges DB state into CITY_TREASURY in-memory — no second loop needed
  const treasuryRows = await fetchTreasuries();

  // Reset path: RESET_TRADERS=1 (env) or --reset-traders (argv) re-seeds every
  // trader to a fresh state, discarding gold/gear/preferred_item/profit_history
  // accumulated under the previous economy. Use it once after an economy
  // rebalance so the AI traders re-learn routes against the new prices instead
  // of carrying stale, now-wrong strategy state. upsertTraders overwrites by id,
  // so this is a clean reset without deleting rows. A normal tick (no flag)
  // resumes as usual.
  const RESET_TRADERS = process.env.RESET_TRADERS === '1' || process.argv.includes('--reset-traders');

  // The one place the wall clock is read; everything below gets it passed in.
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (RESET_TRADERS || !traders || traders.length === 0) {
    // Seed initial state
    console.log(RESET_TRADERS
      ? `[WORLD SIM] RESET_TRADERS set — re-seeding ${TRADER_DEFS.length} trader(s) to a fresh post-rebalance state`
      : '[WORLD SIM] No traders found — seeding initial state');
    traders = TRADER_DEFS.map((def, i) => makeSeedTrader(def, i, nowIso));
  } else {
    // Snapshot all traders before ticking so strategy reviews can compare peers
    const peers = snapshotPeers(traders);
    const focus = Object.fromEntries(traders.map(t => [t.id, t.preferred_item || null]));
    traders = traders.map(t => {
      const lastTick = t.updated_at ? new Date(t.updated_at).getTime() : now;
      const elapsed  = Math.min(MAX_TICK, (now - lastTick) / 1000);
      tickTrader(t, elapsed, { nowIso, peers, focus });
      return t;
    });
  }

  await upsertTraders(traders);
  console.log(`[WORLD SIM] Upserted ${traders.length} traders`);

  await flushStrategyLog();
  await flushTradeEvents();

  // Population growth: cities grow proportional to THIS tick's tax revenue only
  // (CITY_TREASURY was pre-loaded from DB at start; delta_tax = what was added this tick)
  for (const cityId of CITIES) {
    const t = CITY_TREASURY[cityId];
    if (!t) continue;
    const dbRow = treasuryRows.find(r => r.city_id === cityId);
    const prevTax = dbRow?.tax_collected || 0;
    const thisTick = t.tax_collected - prevTax; // only new tax from this tick
    // Grow by 1 resident per 50g of tax collected this tick (capped at +100/tick)
    const growth = Math.min(100, Math.floor(thisTick / 50));
    if (growth > 0) t.population += growth;
  }
  for (const cityId of CITIES) tickCityTreasury(cityId);
  await upsertTreasuries();

  await callAggregateEconomy();

  // Tick world state: drift, hunger, bank solvency, events, contracts — then save all back
  tickMarketDrift();
  tickHunger();
  tickBankSolvency();
  generateWorldEvents();
  regenerateContracts();
  try {
    await sbFetch('/rest/v1/world_state?id=eq.main', {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        active_events:    WORLD_EVENTS,
        next_event_day:   WORLD_STATE.next_event_day,
        market_drift:     MARKET_DRIFT,
        market_drift_day: MARKET_DRIFT_DAY,
        contract_boards:  CONTRACT_BOARDS,
        contract_regen:   CONTRACT_REGEN_DAY,
      }),
    });
    console.log(`[WORLD_STATE] Saved drift (day ${MARKET_DRIFT_DAY}), ${WORLD_EVENTS.length} event(s), ${Object.keys(CONTRACT_BOARDS).length} contract board(s)`);
  } catch (e) {
    console.warn('[WORLD_STATE] Failed to save world state (non-fatal):', e.message);
  }

  console.log('[WORLD SIM] Tick complete');
}

export {
  TRADER_DEFS,
  makeSeedTrader,
  ITEMS,
  CITIES,
  CITY_MULTS,
  CITY_TAX,
  SPREAD,
  PRESSURE_EFFECT,
  WORLD_STATE,
  WORLD_EVENTS,
  WORLD_EVENT_TEMPLATES,
  PRESSURE_MAP,
  CITY_TREASURY,
  seeded01,
  citySeed,
  dayWobble,
  midPriceFor,
  buyPrice,
  sellPrice,
  netSellPrice,
  decideRoute,
  tickTrader,
  reviewStrategy,
  focusScores,
  stuckRescueGold,
  cheapestBuy,
  aggregatePressure,
  PRESSURE_AGG,
  tryGearUpgrade,
  upgradeReserve,
  snapshotPeers,
  simulateTraders,
  traderCapacity,
  eventModifier,
  generateWorldEvents,
  MARKET_DRIFT,
  tickMarketDrift,
  initMarketDrift,
  CITY_FOOD_RULES,
  tickHunger,
  tickBankSolvency,
  BANK_BANKRUPTCY_REOPEN_DAYS,
  CONTRACT_BOARDS,
  CONTRACT_REGEN_DAY,
  CONTRACT_REGEN_DAYS,
  CONTRACT_ITEMS,
  CONTRACT_ITEMS_IRONHOLT,
  rewardForContract,
  makeContract,
  regenerateContracts,
};

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch(err => {
    console.error('[WORLD SIM] Fatal error:', err);
    process.exit(1);
  });
}
