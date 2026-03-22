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

const CAPACITY = 12;
const SPREAD   = 0.10;
const MAX_TICK = 1800; // cap elapsed seconds to avoid huge jumps (allow up to 6 trips per tick)

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
      const units = Math.floor(CAPACITY / item.weight);
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

function reviewStrategy(trader) {
  const history = Array.isArray(trader.profit_history) ? trader.profit_history : [];
  const trips   = trader.trips_completed || 0;

  // Compute recent profit rate (last 3 trips)
  const recentWindow = history.slice(-3);
  const recentProfit = recentWindow.reduce((s, e) => s + (e.profit || 0), 0);
  const recentRate   = recentWindow.length > 0 ? recentProfit / recentWindow.length : 0;

  // Best item by profit across all cities from current location
  const fromId = trader.to_id || trader.from_id || 'valdenmere';
  const itemProfits = {};
  for (const toId of CITIES) {
    if (toId === fromId) continue;
    for (const item of ITEMS) {
      const p = (sellPrice(toId, item) - buyPrice(fromId, item)) * Math.floor(CAPACITY / item.weight);
      if (p > 0) itemProfits[item.id] = (itemProfits[item.id] || 0) + p;
    }
  }
  const bestItem = Object.entries(itemProfits).sort((a, b) => b[1] - a[1])[0];

  const oldStrategy = {
    preferred_item: trader.preferred_item || null,
    personality: trader.personality,
  };

  let decision = 'no_change';
  let reason   = '';
  let newPreferredItem = trader.preferred_item || null;
  let nextReviewAt = trips + 3;

  if (recentRate === 0 && trips === 0) {
    // First review — just pick the best item
    decision = 'init_strategy';
    newPreferredItem = bestItem?.[0] || null;
    reason = `First strategy set. Best item from ${fromId}: ${newPreferredItem} (score ${bestItem?.[1] || 0}g).`;
    nextReviewAt = trips + 3;
  } else if (recentRate < 20) {
    // Poor recent performance — switch to best item
    decision = 'switch_item';
    newPreferredItem = bestItem?.[0] || null;
    reason = `Recent avg profit ${recentRate.toFixed(0)}g/trip is low. Switching focus to ${newPreferredItem} (projected score ${bestItem?.[1] || 0}g).`;
    nextReviewAt = trips + 2; // check again sooner
  } else if (recentRate > 60) {
    // Strong — stay the course but review later
    decision = 'stay_course';
    reason   = `Recent avg profit ${recentRate.toFixed(0)}g/trip is strong. Keeping strategy: ${newPreferredItem || 'flexible'}.`;
    nextReviewAt = trips + 4; // review less often when thriving
  } else {
    // Medium — try diversifying if preferred item is set
    if (trader.preferred_item) {
      const currentItemScore = itemProfits[trader.preferred_item] || 0;
      const bestScore        = bestItem?.[1] || 0;
      if (bestScore > currentItemScore * 1.3) {
        decision = 'upgrade_item';
        const oldItem = trader.preferred_item;
        newPreferredItem = bestItem[0];
        reason = `${oldItem} score ${currentItemScore}g < ${newPreferredItem} score ${bestScore}g (+${Math.round((bestScore/currentItemScore - 1)*100)}%). Upgrading focus.`;
      } else {
        decision = 'stay_course';
        reason   = `${trader.preferred_item} still competitive (score ${currentItemScore}g). No change needed.`;
      }
    } else {
      decision = 'set_focus';
      newPreferredItem = bestItem?.[0] || null;
      reason = `No preferred item set. Picking ${newPreferredItem} (score ${bestItem?.[1] || 0}g) as new focus.`;
    }
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
            Math.floor(CAPACITY / item.weight),
            t.gold > 0 ? Math.floor(t.gold / buy) : 0
          );
          if (units > 0) {
            t.gold -= buy * units;
            t.inv = { [route.itemId]: units };
          } else {
            t.inv = {};
          }
        }

        t.state    = 'traveling';
        t.progress = 0;
        console.log(`[${t.name}] Departing ${t.from_id} → ${t.to_id} with ${JSON.stringify(t.inv)}`);
      }
    } else if (t.state === 'traveling') {
      const routeKey = `${t.from_id}→${t.to_id}`;
      const duration = ROUTE_DURATION[routeKey] || 240;
      t.progress = Math.min(1, t.progress + dt / duration);

      if (t.progress >= 1) {
        // Arrive — sell cargo
        let revenue = 0;
        for (const [itemId, qty] of Object.entries(t.inv || {})) {
          if (!qty) continue;
          const item = ITEMS.find(i => i.id === itemId);
          if (item) { revenue += sellPrice(t.to_id, item) * qty; }
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
  await callAggregateEconomy();
  console.log('[WORLD SIM] Tick complete');
}

main().catch(err => {
  console.error('[WORLD SIM] Fatal error:', err);
  process.exit(1);
});
