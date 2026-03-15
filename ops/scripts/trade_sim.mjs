/**
 * Amber Road — Trade Route Simulator
 * Simulates multiple trade strategies over N days, reports gold earned,
 * finds dominant routes, and flags balance issues.
 */

// ── GAME CONSTANTS (mirrored from main.js) ─────────────────────────────────

const ITEMS = [
  { id: 'food',   name: 'Dried Rations', base: 12, weight: 1 },
  { id: 'ore',    name: 'Iron Ore',      base: 18, weight: 2 },
  { id: 'herbs',  name: 'Moon Herbs',    base: 16, weight: 1 },
  { id: 'potion', name: 'Minor Potion',  base: 34, weight: 1 },
  { id: 'relic',  name: 'Old Relic',     base: 55, weight: 2 },
  { id: 'ink',    name: 'Demon Ink',     base: 70, weight: 1 },
];

const CITIES = [
  { id: 'valdenmere', name: 'Valdenmere' },
  { id: 'ashport',    name: 'Ashport'    },
  { id: 'crosshaven', name: 'Crosshaven' },
  { id: 'ironholt',   name: 'Ironholt'   },
];

const PRICE_MULTS = {
  valdenmere: { food: 1.05, ore: 1.15, herbs: 1.0,  potion: 0.85, relic: 1.15, ink: 1.0  },
  ashport:    { food: 0.90, ore: 1.05, herbs: 1.1,  potion: 1.05, relic: 1.20, ink: 1.08 },
  crosshaven: { food: 0.78, ore: 1.0,  herbs: 0.88, potion: 1.0,  relic: 0.95, ink: 0.98 },
  ironholt:   { food: 1.22, ore: 0.72, herbs: 1.18, potion: 1.08, relic: 0.88, ink: 0.92 },
};

const SPREAD    = 0.10;   // buy = mid*(1+0.05), sell = mid*(1-0.05)
const CAPACITY  = 18;     // max cargo weight
const UPKEEP    = 1;      // rations consumed per day; 3g penalty if none
const START_GOLD = 160;

// Travel time between cities (days, approximate based on road distance)
const TRAVEL_DAYS = {
  valdenmere: { ashport: 4, crosshaven: 3, ironholt: 2 },
  ashport:    { valdenmere: 4, crosshaven: 2, ironholt: 3 },
  crosshaven: { valdenmere: 3, ashport: 2, ironholt: 4 },
  ironholt:   { valdenmere: 2, ashport: 3, crosshaven: 4 },
};

// ── PRICE FUNCTIONS ────────────────────────────────────────────────────────

function midPrice(cityId, item) {
  const m = PRICE_MULTS[cityId]?.[item.id] ?? 1;
  return Math.max(1, Math.round(item.base * m));
}

function buyPrice(cityId, item)  { return Math.max(1, Math.round(midPrice(cityId, item) * (1 + SPREAD/2))); }
function sellPrice(cityId, item) { return Math.max(1, Math.round(midPrice(cityId, item) * (1 - SPREAD/2))); }

// ── FIND ALL PROFITABLE ROUTES ─────────────────────────────────────────────

function findAllRoutes() {
  const routes = [];
  for (const from of CITIES) {
    for (const to of CITIES) {
      if (from.id === to.id) continue;
      const days = TRAVEL_DAYS[from.id][to.id];
      for (const item of ITEMS) {
        const buy  = buyPrice(from.id, item);
        const sell = sellPrice(to.id, item);
        const profit = sell - buy;
        if (profit <= 0) continue;
        // Max units we can carry
        const maxUnits = Math.floor(CAPACITY / item.weight);
        const totalProfit = profit * maxUnits;
        const profitPerDay = totalProfit / days;
        routes.push({ from: from.id, to: to.id, item: item.id, itemName: item.name,
          buy, sell, profit, maxUnits, totalProfit, days, profitPerDay });
      }
    }
  }
  routes.sort((a, b) => b.profitPerDay - a.profitPerDay);
  return routes;
}

// ── SIMULATE A TRADE STRATEGY ──────────────────────────────────────────────

function simulate(strategy, days = 30) {
  let gold = START_GOLD;
  let day = 1;
  let city = 'valdenmere';
  let inv = {};  // itemId → qty
  const log = [];
  let totalBought = 0, totalSold = 0, upkeepPaid = 0;

  function invWeight() {
    return Object.entries(inv).reduce((s, [id, q]) => {
      const item = ITEMS.find(i => i.id === id);
      return s + (item ? item.weight * q : 0);
    }, 0);
  }

  function buy(itemId, qty) {
    const item = ITEMS.find(i => i.id === itemId);
    if (!item) return 0;
    const space = Math.floor((CAPACITY - invWeight()) / item.weight);
    qty = Math.min(qty, space, Math.floor(gold / buyPrice(city, item)));
    if (qty <= 0) return 0;
    const cost = buyPrice(city, item) * qty;
    gold -= cost;
    inv[itemId] = (inv[itemId] || 0) + qty;
    totalBought += cost;
    return qty;
  }

  function sell(itemId) {
    const qty = inv[itemId] || 0;
    if (!qty) return 0;
    const item = ITEMS.find(i => i.id === itemId);
    const revenue = sellPrice(city, item) * qty;
    gold += revenue;
    totalSold += revenue;
    inv[itemId] = 0;
    return revenue;
  }

  function travel(dest) {
    const d = TRAVEL_DAYS[city]?.[dest] ?? 1;
    // Upkeep: consume rations or pay penalty
    for (let i = 0; i < d; i++) {
      if ((inv['food'] || 0) > 0) { inv['food']--; }
      else { gold = Math.max(0, gold - 3); upkeepPaid += 3; }
    }
    day += d;
    city = dest;
  }

  // Run the strategy
  strategy({ buy, sell, travel, getCity: () => city, getDay: () => day,
             getGold: () => gold, getInv: () => ({...inv}), log });

  return { gold, day, totalBought, totalSold, upkeepPaid,
           profit: gold - START_GOLD, profitPerDay: (gold - START_GOLD) / Math.max(1, day-1) };
}

// ── STRATEGIES ─────────────────────────────────────────────────────────────

// Strategy 1: Best single route loop (Ironholt ore → Valdenmere)
function strategyOreLoop({ buy, sell, travel, getDay }) {
  while (getDay() < 30) {
    // Buy ore at Ironholt (cheapest), sell at Valdenmere (1.2x)
    if (getDay() > 1) sell('ore');
    // Buy food for upkeep before traveling
    buy('food', 4);
    buy('ore', 99);
    travel('valdenmere');
    sell('ore');
    buy('food', 4);
    buy('potion', 99); // Valdenmere sells potion cheap (0.8x), Ashport at 1.0x
    travel('ironholt');
  }
}

// Strategy 2: Full circuit (all 4 cities)
function strategyCircuit({ buy, sell, travel, getCity, getDay }) {
  const route = ['valdenmere', 'crosshaven', 'ashport', 'ironholt'];
  let idx = 0;
  while (getDay() < 40) {
    const city = getCity();
    // Sell everything
    for (const item of ITEMS) sell(item.id);
    // Buy 2 food for upkeep
    buy('food', 3);
    // Buy best items for next city
    const next = route[(route.indexOf(city) + 1) % route.length];
    // Find best item to buy here and sell at next
    const best = ITEMS
      .filter(i => i.id !== 'food')
      .map(i => ({ i, profit: sellPrice(next, i) - buyPrice(city, i) }))
      .filter(x => x.profit > 0)
      .sort((a,b) => (b.profit/b.i.weight) - (a.profit/a.i.weight));
    if (best.length) buy(best[0].i.id, 99);
    if (best.length > 1) buy(best[1].i.id, 99);
    travel(next);
  }
}

// Strategy 3: Relic/ink focus — high-value items
function strategyHighValue({ buy, sell, travel, getDay }) {
  while (getDay() < 35) {
    sell('relic'); sell('ink'); sell('potion');
    buy('food', 3);
    // Ashport has cheap food + high relic price; Crosshaven has cheap herbs
    if (getDay() < 10) {
      buy('relic', 99);
      travel('ashport');
    } else {
      buy('potion', 99); // Valdenmere 0.8x → sell anywhere else
      travel('ironholt');
      sell('potion');
      buy('food', 2);
      buy('ore', 99); // Ironholt ore cheap → Valdenmere
      travel('valdenmere');
    }
  }
}

// Strategy 4: Crosshaven food arbitrage (food 0.75x → anywhere)
function strategyFoodArb({ buy, sell, travel, getDay }) {
  // Start at valdenmere, go to crosshaven, load food, sell at ironholt
  travel('crosshaven');
  while (getDay() < 35) {
    sell('food'); sell('herbs');
    buy('food', 18); // max out on cheap food
    travel('ironholt'); // ironholt food 1.3x
    sell('food');
    buy('ore', 99); // cheap ore
    travel('crosshaven'); // via direct
  }
}

// ── RUN ALL STRATEGIES ─────────────────────────────────────────────────────

const strategies = [
  { name: 'Ore Loop (Ironholt↔Valdenmere)', fn: strategyOreLoop },
  { name: 'Full Circuit (4 cities)',         fn: strategyCircuit },
  { name: 'High-Value (Relic/Potion)',       fn: strategyHighValue },
  { name: 'Food Arbitrage (Crosshaven→Ironholt)', fn: strategyFoodArb },
];

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  THE AMBER ROAD — Trade Route Simulation');
console.log('═══════════════════════════════════════════════════════════\n');

// ── PRINT ALL PROFITABLE ROUTES ────────────────────────────────────────────
console.log('📊 TOP 10 PROFITABLE ROUTES (per day, full cargo):\n');
const allRoutes = findAllRoutes();
allRoutes.slice(0, 10).forEach((r, i) => {
  console.log(`  ${i+1}. ${r.from.padEnd(12)} → ${r.to.padEnd(12)} | ${r.itemName.padEnd(14)} | buy ${String(r.buy).padStart(3)}g → sell ${String(r.sell).padStart(3)}g | +${r.profit}g/unit | ${r.maxUnits} units | +${Math.round(r.profitPerDay)}g/day`);
});

// ── PRINT FULL PRICE TABLE ─────────────────────────────────────────────────
console.log('\n📋 FULL PRICE TABLE (buy / sell):\n');
const header = '  Item'.padEnd(18) + CITIES.map(c => c.name.padEnd(24)).join('');
console.log(header);
console.log('  ' + '─'.repeat(header.length - 2));
for (const item of ITEMS) {
  let row = `  ${item.name.padEnd(16)}`;
  for (const city of CITIES) {
    const b = buyPrice(city.id, item);
    const s = sellPrice(city.id, item);
    row += `buy:${String(b).padStart(3)}  sell:${String(s).padStart(3)}    `;
  }
  console.log(row);
}

// ── RUN STRATEGIES ─────────────────────────────────────────────────────────
console.log('\n💰 STRATEGY SIMULATION RESULTS:\n');
const results = strategies.map(s => {
  const r = simulate(s.fn);
  return { ...s, ...r };
});

results.sort((a, b) => b.profitPerDay - a.profitPerDay);
results.forEach(r => {
  const emoji = r.profitPerDay > 15 ? '🟢' : r.profitPerDay > 8 ? '🟡' : '🔴';
  console.log(`  ${emoji} ${r.name}`);
  console.log(`     Start: ${START_GOLD}g  →  End: ${r.gold}g  |  Day ${r.day}  |  Net: +${r.profit}g  |  ${r.profitPerDay.toFixed(1)}g/day`);
  console.log(`     Upkeep paid: ${r.upkeepPaid}g\n`);
});

// ── BALANCE ANALYSIS ───────────────────────────────────────────────────────
console.log('🔍 BALANCE ANALYSIS:\n');

// 1. Spread check — is every route profitable or is there a dominant exploit?
const topRoute = allRoutes[0];
const worstRoute = allRoutes[allRoutes.length - 1];
console.log(`  Best route: ${topRoute.from} → ${topRoute.to} (${topRoute.itemName}) = +${Math.round(topRoute.profitPerDay)}g/day`);
console.log(`  Worst profitable: ${worstRoute.from} → ${worstRoute.to} (${worstRoute.itemName}) = +${Math.round(worstRoute.profitPerDay)}g/day`);
const ratio = topRoute.profitPerDay / worstRoute.profitPerDay;
console.log(`  Spread ratio: ${ratio.toFixed(1)}x  ${ratio > 5 ? '⚠️  Dominant route — needs rebalancing' : '✅  Healthy spread'}\n`);

// 2. Dead routes (no profit from a city)
const deadCities = {};
for (const city of CITIES) {
  const outbound = allRoutes.filter(r => r.from === city.id);
  if (outbound.length === 0) deadCities[city.id] = true;
}
if (Object.keys(deadCities).length) {
  console.log(`  ⚠️  Cities with NO profitable outbound routes: ${Object.keys(deadCities).join(', ')}`);
} else {
  console.log('  ✅  All cities have at least one profitable outbound route');
}

// 3. Item always-buy check — any item never worth buying anywhere?
const itemProfit = {};
for (const item of ITEMS) {
  let maxProfit = 0;
  for (const from of CITIES) {
    for (const to of CITIES) {
      if (from.id === to.id) continue;
      const p = sellPrice(to.id, item) - buyPrice(from.id, item);
      if (p > maxProfit) maxProfit = p;
    }
  }
  itemProfit[item.id] = maxProfit;
}
console.log('\n  Item max cross-city profit:');
for (const [id, p] of Object.entries(itemProfit)) {
  const item = ITEMS.find(i => i.id === id);
  const flag = p <= 0 ? '⚠️  NEVER PROFITABLE' : p < 3 ? '⚠️  very low margin' : '✅';
  console.log(`    ${item.name.padEnd(16)} max profit: +${p}g/unit  ${flag}`);
}

// 4. Starting capital check — can a new player afford anything?
console.log(`\n  Starting gold: ${START_GOLD}g`);
const affordable = ITEMS.filter(i => buyPrice('valdenmere', i) <= START_GOLD);
const cheapest = ITEMS.reduce((a, b) => buyPrice('valdenmere', a) < buyPrice('valdenmere', b) ? a : b);
console.log(`  Cheapest item at Valdenmere: ${cheapest.name} at ${buyPrice('valdenmere', cheapest)}g`);
console.log(`  Items affordable at start: ${affordable.map(i => i.name).join(', ')}`);
if (affordable.length === 0) console.log('  ⚠️  Player cannot afford ANYTHING at start!');

// 5. Upkeep pressure
const avgTravelDays = Object.values(TRAVEL_DAYS).flatMap(v => Object.values(v));
const avgDays = avgTravelDays.reduce((a,b)=>a+b,0)/avgTravelDays.length;
const upkeepPerTrip = avgDays * UPKEEP * 1; // 1 ration per day, food costs ~9g
console.log(`\n  Avg travel time: ${avgDays.toFixed(1)} days/trip`);
console.log(`  Upkeep per trip: ~${upkeepPerTrip.toFixed(0)} rations consumed`);
console.log(`  Upkeep cost (if no food): ~${(upkeepPerTrip * 3).toFixed(0)}g penalty`);
const upkeepPct = (upkeepPerTrip * 3) / topRoute.profitPerDay / avgDays * 100;
console.log(`  Upkeep as % of top-route profit: ${upkeepPct.toFixed(0)}%  ${upkeepPct > 30 ? '⚠️  High pressure' : '✅'}`);

// 6. Identify best starter route (affordable with 120g)
console.log('\n  🎯 BEST STARTER ROUTE (with 120g start):');
const starterRoutes = allRoutes.filter(r => {
  const item = ITEMS.find(i => i.id === r.item);
  return buyPrice(r.from, item) <= 30 && r.from === 'valdenmere'; // start at Valdenmere
}).slice(0, 3);
starterRoutes.forEach(r => {
  const units = Math.floor(100 / buyPrice(r.from, ITEMS.find(i=>i.id===r.item)));
  const netProfit = r.profit * Math.min(units, r.maxUnits);
  console.log(`    ${r.from} → ${r.to}: ${r.itemName}  buy ${r.buy}g → sell ${r.sell}g  net ~+${netProfit}g/trip`);
});

console.log('\n═══════════════════════════════════════════════════════════\n');
