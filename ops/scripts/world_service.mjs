#!/usr/bin/env node
/**
 * Charter Road — World Simulation Service
 * Runs as a GitHub Actions cron job every 5 minutes.
 * Ticks AI traders (travel, trade, profit) in Supabase, independent of the browser.
 *
 * No npm dependencies — uses Node 18+ built-in fetch.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycjhcsxxtinipwailbjb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljamhjc3h4dGluaXB3YWlsYmpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTc1MDAsImV4cCI6MjA4OTIzMzUwMH0.cBEiiVExRAnWVeUV3v6ZLYmcPe1hnPc4wdmKSvkRahY';

// ── Constants (mirrors main.js) ────────────────────────────────────────────

const TRADER_DEFS = [
  { id: 'olt_the_bold',    name: 'Olt the Bold',      personality: 'aggressive',  color: '#ef4444', startGold: 80  },
  { id: 'mira_silvertong', name: 'Mira Silvertongue', personality: 'opportunist', color: '#a78bfa', startGold: 100 },
  { id: 'cargo_dom',       name: 'Cargo Dom',         personality: 'cautious',    color: '#f59e0b', startGold: 120 },
  { id: 'wren_the_swift',  name: 'Wren the Swift',    personality: 'aggressive',  color: '#34d399', startGold: 140 },
];

const ITEMS = [
  { id: 'grain',  name: 'Grain',         base: 6,  weight: 1 },
  { id: 'food',   name: 'Dried Rations', base: 12, weight: 1 },
  { id: 'ore',    name: 'Iron Ore',      base: 18, weight: 2 },
  { id: 'herbs',  name: 'Moon Herbs',    base: 16, weight: 1 },
  { id: 'potion', name: 'Minor Potion',  base: 34, weight: 1 },
  { id: 'relic',  name: 'Old Relic',     base: 55, weight: 2 },
  { id: 'ink',    name: 'Demon Ink',     base: 70, weight: 1 },
];

const CITIES = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];

// Travel durations in seconds (at 5-min ticks, progress advances each tick)
const ROUTE_DURATION = {
  'valdenmere→ashport': 300, 'ashport→valdenmere': 300,
  'valdenmere→crosshaven': 240, 'crosshaven→valdenmere': 240,
  'valdenmere→ironholt': 180, 'ironholt→valdenmere': 180,
  'ashport→crosshaven': 180, 'crosshaven→ashport': 180,
  'ashport→ironholt': 720, 'ironholt→ashport': 720,
  'crosshaven→ironholt': 240, 'ironholt→crosshaven': 240,
};

const BASE_CAPACITY = 12;
const SPREAD        = 0.10;

// ── Gear upgrade tiers ────────────────────────────────────────────────────
const GEAR_TIERS = [
  { tier: 0, name: 'Mule & Pack',      capacity: 12,  cost: 0    },
  { tier: 1, name: 'Reinforced Cart',  capacity: 18,  cost: 500  },
  { tier: 2, name: 'Merchant Wagon',   capacity: 26,  cost: 1500 },
  { tier: 3, name: 'Trade Galleon',    capacity: 36,  cost: 3500 },
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

  if (paybackTrips <= 10) {
    trader.gold      -= nextTier.cost;
    trader.gear_tier  = nextTier.tier;
    console.log(`[${trader.name}] 🔧 Upgraded to ${nextTier.name} (${nextTier.capacity} capacity) for ${nextTier.cost}g — payback in ~${paybackTrips.toFixed(1)} trips`);
  }
}
const MAX_TICK = 1800; // cap elapsed seconds to avoid huge jumps (allow up to 6 trips per tick)

// ── Taxation & Trading Permits ────────────────────────────────────────────

// Tax rate on every sale (fraction of revenue)
const CITY_TAX = {
  valdenmere: 0.12,  // capital — high tax
  ashport:    0.08,  // merchant hub — moderate
  crosshaven: 0.05,  // free port — low tax
  ironholt:   0.15,  // military — heaviest tax
};

// Premium items that require a trading permit to sell
const PERMIT_ITEMS = new Set(['ink', 'relic', 'potion', 'cloth']);

// Permit cost and duration (in trips)
const PERMIT_COST  = 300;
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

// ── Price model (mirrors main.js seeded hash) ──────────────────────────────

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h;
}
function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}
function basePrice(cityId, itemId, itemBase) {
  const seed = hashStr(cityId + ':' + itemId);
  const rng = seededRand(seed);
  return Math.round(itemBase * (0.80 + rng() * 0.40));
}
function buyPrice(cityId, item)  {
  const mid = basePrice(cityId, item.id, item.base);
  return Math.round(mid * (1 + SPREAD / 2));
}
function sellPrice(cityId, item) {
  const mid = basePrice(cityId, item.id, item.base);
  return Math.max(1, Math.round(mid * (1 - SPREAD / 2)));
}

// ── Route picking (mirrors main.js, extended with preferred_item bias) ────

function decideRoute(trader) {
  const fromId = trader.to_id || trader.from_id || 'valdenmere';
  const candidates = [];
  for (const toId of CITIES) {
    if (toId === fromId) continue;
    for (const item of ITEMS) {
      const buy  = buyPrice(fromId, item);
      const sell = sellPrice(toId, item);
      const profit = sell - buy;
      if (profit <= 0) continue;
      const units = Math.floor(traderCapacity(trader) / item.weight);
      let score = profit * units;
      // Bias toward preferred item if strategy review selected one
      if (trader.preferred_item && item.id === trader.preferred_item) score *= 1.25;
      candidates.push({ fromId, toId, itemId: item.id, profit: profit * units, score });
    }
  }
  if (!candidates.length) {
    const others = CITIES.filter(c => c !== fromId);
    return { fromId, toId: others[Math.floor(Math.random() * others.length)], itemId: 'ore' };
  }
  candidates.sort((a, b) => b.score - a.score);
  let pick;
  if (trader.personality === 'aggressive') {
    pick = candidates[0];
  } else if (trader.personality === 'cautious') {
    pick = candidates[Math.floor(candidates.length * 0.4)] || candidates[0];
  } else {
    pick = candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];
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

  // Best item by profit from current location
  const fromId = trader.to_id || trader.from_id || 'valdenmere';
  const itemProfits = {};
  for (const toId of CITIES) {
    if (toId === fromId) continue;
    for (const item of ITEMS) {
      const p = (sellPrice(toId, item) - buyPrice(fromId, item)) * Math.floor(traderCapacity(trader) / item.weight);
      if (p > 0) itemProfits[item.id] = (itemProfits[item.id] || 0) + p;
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
const CITY_TREASURY = {
  valdenmere: { gold: 0, tax_collected: 0, permit_collected: 0, spent: 0, invest_log: [] },
  ashport:    { gold: 0, tax_collected: 0, permit_collected: 0, spent: 0, invest_log: [] },
  crosshaven: { gold: 0, tax_collected: 0, permit_collected: 0, spent: 0, invest_log: [] },
  ironholt:   { gold: 0, tax_collected: 0, permit_collected: 0, spent: 0, invest_log: [] },
};

// City investment projects — what a city can spend its treasury on
const CITY_INVESTMENTS = [
  { id: 'road_repair',    name: 'Road Repair',       cost: 300,  effect: 'Reduces travel time to/from this city by 10%',   type: 'route_speed'  },
  { id: 'market_subsidy', name: 'Market Subsidy',    cost: 500,  effect: 'Lowers buy prices in this city by 8% for 20 trips', type: 'price_discount' },
  { id: 'guard_patrol',   name: 'Guard Patrol',      cost: 200,  effect: 'Protects traders from bandit events near this city', type: 'safety'       },
  { id: 'trade_fair',     name: 'Trade Fair',        cost: 800,  effect: 'Raises sell prices in this city by 12% for 15 trips', type: 'price_boost' },
  { id: 'warehouse',      name: 'Public Warehouse',  cost: 400,  effect: 'Traders can store goods here (coming soon)',      type: 'storage'      },
];

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
  // Spend: pick an affordable investment if treasury has enough
  if (t.gold >= 200) {
    const affordable = CITY_INVESTMENTS.filter(inv => inv.cost <= t.gold);
    if (affordable.length > 0) {
      const pick = affordable[Math.floor(Math.random() * affordable.length)];
      t.gold  -= pick.cost;
      t.spent += pick.cost;
      const entry = { day: new Date().toISOString(), project: pick.name, effect: pick.effect, cost: pick.cost };
      t.invest_log.push(entry);
      if (t.invest_log.length > 10) t.invest_log.shift();
      console.log(`[TREASURY][${cityId}] Invested ${pick.cost}g in ${pick.name}: ${pick.effect}`);
    }
  }
}

async function fetchTreasuries() {
  try {
    return await sbFetch('/rest/v1/city_treasury?select=*') || [];
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
        t.gold            += revenue;
        t.total_profit     = (t.total_profit || 0) + revenue;
        t.trips_completed  = (t.trips_completed || 0) + 1;
        // Track per-trip profit history (keep last 10)
        const history = Array.isArray(t.profit_history) ? t.profit_history : [];
        history.push({ trip: t.trips_completed, profit: revenue, item: t.item_id, to: t.to_id, at: new Date().toISOString() });
        if (history.length > 10) history.splice(0, history.length - 10);
        t.profit_history   = history;
        t.inv              = {};
        t.from_id          = t.to_id;
        t.state            = 'in_city';
        t.city_timer       = 30 + Math.random() * 60;
        t.progress         = 0;
        console.log(`[${t.name}] Arrived at ${t.to_id}, sold for ${revenue}g. Total profit: ${t.total_profit}g`);

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

  let traders = await fetchTraders();
  const treasuryRows = await fetchTreasuries();
  // Pre-load DB treasury balances into in-memory state
  for (const row of treasuryRows) {
    if (CITY_TREASURY[row.city_id]) {
      CITY_TREASURY[row.city_id].gold             = row.gold || 0;
      CITY_TREASURY[row.city_id].tax_collected    = row.tax_collected || 0;
      CITY_TREASURY[row.city_id].permit_collected = row.permit_collected || 0;
      CITY_TREASURY[row.city_id].spent            = row.spent || 0;
      CITY_TREASURY[row.city_id].invest_log       = row.invest_log || [];
    }
  }

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
  // Run city investment decisions then persist
  for (const cityId of CITIES) {
    tickCityTreasury(cityId);
  }
  await upsertTreasuries();
  await callAggregateEconomy();
  console.log('[WORLD SIM] Tick complete');
}

main().catch(err => {
  console.error('[WORLD SIM] Fatal error:', err);
  process.exit(1);
});
