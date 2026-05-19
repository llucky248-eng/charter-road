#!/usr/bin/env node
/**
 * Charter Road — World Simulation Service
 * Runs as a GitHub Actions cron job every 5 minutes.
 * Ticks AI traders (travel, trade, profit) in Supabase, independent of the browser.
 *
 * No npm dependencies — uses Node 18+ built-in fetch.
 */

import { pathToFileURL } from 'node:url';

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

const ITEMS = [
  { id: 'grain',  name: 'Grain',         base: 10, weight: 1 },
  { id: 'food',   name: 'Dried Rations', base: 16, weight: 1 },
  { id: 'ore',    name: 'Iron Ore',      base: 22, weight: 2 },
  { id: 'herbs',  name: 'Moon Herbs',    base: 24, weight: 1 },
  { id: 'potion', name: 'Minor Potion',  base: 40, weight: 1 },
  { id: 'relic',  name: 'Old Relic',     base: 60, weight: 2 },
  { id: 'ink',    name: 'Demon Ink',     base: 75, weight: 1, sourceCities: ['ironholt', 'crosshaven'] },
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

// Travel durations in seconds (at 5-min ticks, progress advances each tick)
const ROUTE_DURATION = {
  'valdenmere→ashport': 300, 'ashport→valdenmere': 300,
  'valdenmere→crosshaven': 240, 'crosshaven→valdenmere': 240,
  'valdenmere→ironholt': 180, 'ironholt→valdenmere': 180,
  'ashport→crosshaven': 180, 'crosshaven→ashport': 180,
  'ashport→ironholt': 360, 'ironholt→ashport': 360,   // FIX: reduced from 720s — ashport was completely isolated
  'crosshaven→ironholt': 240, 'ironholt→crosshaven': 240,
};

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

function tryGearUpgrade(trader) {
  const currentTier = trader.gear_tier || 0;
  const nextTier    = GEAR_TIERS[currentTier + 1];
  if (!nextTier) return; // already maxed

  if ((trader.gold || 0) < nextTier.cost) return; // can't afford

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

  if (paybackTrips <= 15 || (nextTier.tier === 1 && (trader.gold || 0) >= nextTier.cost)) {
    // Always upgrade to tier 1 if affordable — minimum ROI check waived for first upgrade
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
  valdenmere: { grain: 1.10, food: 1.10, ore: 1.20, herbs: 1.05, potion: 0.85, relic: 1.15, ink: 1.05 },
  ashport:    { grain: 1.05, food: 0.90, ore: 1.05, herbs: 1.10, potion: 1.15, relic: 1.20, ink: 1.20 },
  crosshaven: { grain: 0.90, food: 0.85, ore: 1.00, herbs: 1.15, potion: 1.25, relic: 1.10, ink: 1.00 },
  ironholt:   { grain: 1.15, food: 1.30, ore: 0.65, herbs: 1.20, potion: 1.10, relic: 0.85, ink: 0.90 },
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
      '/rest/v1/world_state?id=eq.main&select=day,frac,seed,active_events,next_event_day,market_drift,market_drift_day'
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

// ── Route picking (mirrors main.js, extended with preferred_item bias) ────

function decideRoute(trader) {
  const fromId = trader.to_id || trader.from_id || 'valdenmere';
  const candidates = [];

  // FIX: evaluate ALL city pairs so distant routes (ironholt, ashport) are always considered
  for (const toId of CITIES) {
    if (toId === fromId) continue;
    for (const item of ITEMS) {
      if (item.sourceCities && !item.sourceCities.includes(fromId)) continue;

      const buy = buyPrice(fromId, item);
      const sellNet = netSellPrice(toId, item);
      const profit = sellNet - buy;
      if (profit <= 0) continue;

      const units = Math.floor(traderCapacity(trader) / item.weight);
      if (units === 0) continue;

      let score = profit * units;

      // FIX: stronger preferred_item bias (2× instead of 1.25×) so focus can beat saturated routes
      if (trader.preferred_item && item.id === trader.preferred_item) score *= 2.0;

      // FIX: penalise routes where sell pressure is at saturation (≥ 0.4 = heavily oversupplied)
      const sellPressure = PRESSURE_MAP[`${toId}:${item.id}`] || 0;
      if (sellPressure >= 0.4) score *= 0.3;        // heavily depressed sell market
      else if (sellPressure >= 0.25) score *= 0.6;  // moderately depressed

      // Bonus for routes where the source city is oversupplied, matching client pressure behavior.
      const buyPressure = PRESSURE_MAP[`${fromId}:${item.id}`] || 0;
      if (buyPressure <= -0.3) score *= 1.4;

      candidates.push({ fromId, toId, itemId: item.id, profit: profit * units, score });
    }
  }

  if (!candidates.length) {
    const others = CITIES.filter(c => c !== fromId);
    return { fromId, toId: others[Math.floor(Math.random() * others.length)], itemId: 'grain' };
  }

  candidates.sort((a, b) => b.score - a.score);

  let pick;
  if (trader.personality === 'aggressive') {
    // Always takes best opportunity
    pick = candidates[0];
  } else if (trader.personality === 'cautious') {
    // FIX: cautious picks the route with the most consistent (lowest variance) recent profit,
    // not just 40th percentile by score. Fallback to top-3 if no history.
    const history = Array.isArray(trader.profit_history) ? trader.profit_history : [];
    if (history.length >= 3) {
      const top5 = candidates.slice(0, Math.min(5, candidates.length));
      // Score consistency: prefer routes the trader has done before with stable returns
      const routeProfit = {};
      for (const e of history) {
        const k = `${e.to}:${e.item}`;
        if (!routeProfit[k]) routeProfit[k] = [];
        routeProfit[k].push(e.profit || 0);
      }
      let bestConsistent = null, bestConsistencyScore = -Infinity;
      for (const c of top5) {
        const k = `${c.toId}:${c.itemId}`;
        const hist = routeProfit[k] || [];
        const mean = hist.length > 0 ? hist.reduce((a, b) => a + b, 0) / hist.length : c.score * 0.5;
        const variance = hist.length > 1
          ? hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length
          : mean * mean; // unknown route = high variance
        const consistencyScore = mean - Math.sqrt(variance) * 0.3;
        if (consistencyScore > bestConsistencyScore) {
          bestConsistencyScore = consistencyScore;
          bestConsistent = c;
        }
      }
      pick = bestConsistent || candidates[0];
    } else {
      pick = candidates[Math.min(2, candidates.length - 1)]; // top-3 until enough history
    }
  } else {
    // Opportunist: random among top 5 with score weighting
    const pool = candidates.slice(0, Math.min(5, candidates.length));
    const totalScore = pool.reduce((s, c) => s + c.score, 0);
    let r = Math.random() * totalScore;
    pick = pool[pool.length - 1];
    for (const c of pool) { r -= c.score; if (r <= 0) { pick = c; break; } }
  }
  return pick;
}

// ── Strategy review (triggered every N trips) ─────────────────────────────

const STRATEGY_LOG_BATCH = []; // collect log entries, upsert at end of tick
const TRADE_EVENTS_BATCH = []; // collect trade events, upsert at end of tick

// allTraders is injected by the tick loop so each trader can see peers
let ALL_TRADERS_SNAPSHOT = [];

function reviewStrategy(trader) {
  const history = Array.isArray(trader.profit_history) ? trader.profit_history : [];
  const trips   = trader.trips_completed || 0;

  // Compute recent profit rate (last 3 trips)
  const recentWindow = history.slice(-3);
  const recentProfit = recentWindow.reduce((s, e) => s + (e.profit || 0), 0);
  const recentRate   = recentWindow.length > 0 ? recentProfit / recentWindow.length : 0;

  // FIX: evaluate item profitability across ALL city pairs (not just from current city)
  // and apply pressure penalty so saturated routes rank lower
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
  const bestItem = Object.entries(itemProfits).sort((a, b) => b[1] - a[1])[0];

  // ── Peer comparison ───────────────────────────────────────────────────
  const peers = ALL_TRADERS_SNAPSHOT.filter(p => p.id !== trader.id);
  const peerRates = peers.map(p => {
    const ph = Array.isArray(p.profit_history) ? p.profit_history : [];
    const w  = ph.slice(-3);
    return w.length > 0 ? w.reduce((s, e) => s + (e.profit || 0), 0) / w.length : 0;
  });
  const bestPeerRate = peerRates.length > 0 ? Math.max(...peerRates) : 0;
  const avgPeerRate  = peerRates.length > 0 ? peerRates.reduce((a, b) => a + b, 0) / peerRates.length : 0;

  // Count how many peers share the same preferred item (saturation)
  const competingPeers = peers.filter(p => p.preferred_item === trader.preferred_item && trader.preferred_item).length;

  // Find item no other trader is focusing on (niche opportunity)
  const takenItems = new Set(peers.map(p => p.preferred_item).filter(Boolean));
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
      // Copy the leader's item
      decision = 'copy_leader';
      newPreferredItem = bestPeer?.preferred_item || bestItem?.[0] || null;
      reason = `Trailing best peer ${bestPeer?.name} (${bestPeerRate.toFixed(0)}g vs my ${recentRate.toFixed(0)}g/trip). Copying their focus: ${newPreferredItem}.`;
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

  trader.preferred_item  = newPreferredItem;
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
    created_at:   new Date().toISOString(),
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

function tickTrader(t, elapsed) {
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

        // Buy cargo
        const item = ITEMS.find(i => i.id === route.itemId);
        if (item) {
          const buy = buyPrice(route.fromId, item);
          const units = Math.min(
            Math.floor(traderCapacity(t) / item.weight),
            t.gold > 0 ? Math.floor(t.gold / buy) : 0
          );
          if (units > 0) {
            t.gold -= buy * units;
            t.inv = { [route.itemId]: units };
            // Record buy event for market pressure
            TRADE_EVENTS_BATCH.push({
              city_id:   route.fromId,
              item_id:   route.itemId,
              direction: 'buy',
              qty:       units,
              created_at: new Date().toISOString(),
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
      const routeKey = `${t.from_id}→${t.to_id}`;
      const duration = ROUTE_DURATION[routeKey] || 240;
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
            created_at: new Date().toISOString(),
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
        // FIX: gold floor — traders always keep at least 30g so they can buy basic cargo
        if (t.gold < 30) {
          console.log(`[${t.name}] ⚠️ Gold floor applied (${t.gold}g → 30g)`);
          t.gold = 30;
        }
        t.total_profit     = (t.total_profit || 0) + tripProfit;
        t.trips_completed  = (t.trips_completed || 0) + 1;
        // Track per-trip realized profit history (keep last 10)
        const history = Array.isArray(t.profit_history) ? t.profit_history : [];
        history.push({ trip: t.trips_completed, profit: tripProfit, item: t.item_id, to: t.to_id, at: new Date().toISOString() });
        if (history.length > 10) history.splice(0, history.length - 10);
        t.profit_history   = history;
        t.inv              = {};
        t.from_id          = t.to_id;
        t.state            = 'in_city';
        t.city_timer       = 30 + Math.random() * 60;
        t.progress         = 0;
        console.log(`[${t.name}] Arrived at ${t.to_id}, revenue ${revenue}g, trip profit ${tripProfit}g. Total profit: ${t.total_profit}g`);

        // Gear upgrade check (every trip)
        tryGearUpgrade(t);

        // Strategy review every N trips
        const reviewAt = t.review_at_trips || 3;
        if (t.trips_completed >= reviewAt) {
          reviewStrategy(t);
        }
      }
    }
  }
  t.updated_at = new Date().toISOString();
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[WORLD SIM] Tick starting at ${new Date().toISOString()}`);

  await loadWorldState();
  // Load market pressure before ticking so prices respond to supply/demand.
  await loadPressureMap();

  let traders = await fetchTraders();
  // fetchTreasuries() already merges DB state into CITY_TREASURY in-memory — no second loop needed
  const treasuryRows = await fetchTreasuries();

  if (!traders || traders.length === 0) {
    // Seed initial state
    console.log('[WORLD SIM] No traders found — seeding initial state');
    traders = TRADER_DEFS.map(def => ({
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
      city_timer:      10 + TRADER_DEFS.indexOf(def) * 15,
      preferred_item:  null,
      review_at_trips: 3,
      profit_history:  [],
      updated_at:      new Date().toISOString(),
    }));
  } else {
    // Compute elapsed since last tick
    const now = Date.now();
    // Snapshot all traders before ticking so strategy reviews can compare peers
    ALL_TRADERS_SNAPSHOT = traders.map(t => ({ ...t }));
    traders = traders.map(t => {
      const lastTick = t.updated_at ? new Date(t.updated_at).getTime() : now;
      const elapsed  = Math.min(MAX_TICK, (now - lastTick) / 1000);
      tickTrader(t, elapsed);
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

  // Tick world state: drift, hunger, bank solvency, events — then save all back
  tickMarketDrift();
  tickHunger();
  tickBankSolvency();
  generateWorldEvents();
  try {
    await sbFetch('/rest/v1/world_state?id=eq.main', {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        active_events:    WORLD_EVENTS,
        next_event_day:   WORLD_STATE.next_event_day,
        market_drift:     MARKET_DRIFT,
        market_drift_day: MARKET_DRIFT_DAY,
      }),
    });
    console.log(`[WORLD_STATE] Saved drift (day ${MARKET_DRIFT_DAY}), ${WORLD_EVENTS.length} event(s)`);
  } catch (e) {
    console.warn('[WORLD_STATE] Failed to save world state (non-fatal):', e.message);
  }

  console.log('[WORLD SIM] Tick complete');
}

export {
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
};

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch(err => {
    console.error('[WORLD SIM] Fatal error:', err);
    process.exit(1);
  });
}
