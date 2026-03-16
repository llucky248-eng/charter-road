#!/usr/bin/env node
/**
 * Gameplay simulation: how long to reach "endgame":
 *   - All 3 gear slots maxed (total cost: 1920g)
 *   - Rep ≥ 7 in all 4 cities (tier 2 contracts everywhere)
 *   - Gold ≥ 500 remaining after all upgrades
 *
 * Uses only the __QA.api surface.
 * Each "cycle" = 1 trade route (buy in city A → travel 1 day → sell in city B).
 * 1 cycle ≈ 90 seconds real play time.
 */

import { chromium } from 'playwright';

function die(msg) { console.error('QA_FAIL:', msg); process.exit(1); }

const url = process.argv[2] || process.env.QA_URL || 'http://127.0.0.1:8080/?qa=1';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__QA && typeof window.__QA.api?.snapState === 'function',
    { timeout: 30_000 }
  );

  const result = await page.evaluate(() => {
    const api = window.__QA.api;
    const CITIES = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];

    const GEAR_UPGRADES = [
      { slot: 'pack',  tier: 1, cost: 120 },
      { slot: 'boots', tier: 1, cost: 150 },
      { slot: 'tool',  tier: 1, cost: 200 },
      { slot: 'pack',  tier: 2, cost: 350 },
      { slot: 'boots', tier: 2, cost: 500 },
      { slot: 'tool',  tier: 2, cost: 600 },
    ];

    function isDone(s) {
      return (s.gear.pack  ?? 0) >= 2 &&
             (s.gear.boots ?? 0) >= 2 &&
             (s.gear.tool  ?? 0) >= 2 &&
             CITIES.every(c => (s.rep[c] ?? 0) >= 7) &&
             s.gold >= 500;
    }

    function addRep(cityId, amt) {
      const s = api.snapState();
      api.setRep(cityId, Math.min(20, (s.rep[cityId] || 0) + amt));
    }

    // ── Reset to fresh start ────────────────────────────────────────
    api.setPlayer({ gold: 160, capacity: 18, inv: {} });
    CITIES.forEach(c => api.setRep(c, 0));
    // Reset gear via buyGear is impossible at tier 0 — use setPlayer
    api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0 } });
    // Ensure applyGearStats runs
    api.buyGear('pack', 0, 0); // no-op but harmless

    const gearLog = [];
    const snapshots = [];
    let cycle = 0;
    const MAX_CYCLES = 1500;

    const TRADE_ROUTES = [
      { from: 'valdenmere', to: 'ashport',    item: 'grain' },
      { from: 'ashport',    to: 'crosshaven', item: 'fish'  },
      { from: 'crosshaven', to: 'ironholt',   item: 'cloth' },
      { from: 'ironholt',   to: 'valdenmere', item: 'iron'  },
    ];

    while (!isDone(api.snapState()) && cycle < MAX_CYCLES) {
      const route = TRADE_ROUTES[cycle % TRADE_ROUTES.length];

      // Trade cycle
      api.marketBuy(route.item, 999, route.from);
      api.travelDays(1);
      api.marketSell(route.item, 999, route.to);

      // Rep gains
      addRep(route.from, 0.3);
      addRep(route.to,   0.7);
      CITIES.filter(c => c !== route.from && c !== route.to).forEach(c => addRep(c, 0.05));

      // Contract bonus every 3 cycles
      if (cycle % 3 === 0) {
        addRep(route.to, 2);
        const s = api.snapState();
        api.setPlayer({ gold: s.gold + 50 });
      }

      // Gear purchases (one per cycle, cheapest first)
      const s = api.snapState();
      for (const g of GEAR_UPGRADES) {
        const cur = s.gear[g.slot] ?? 0;
        if (cur < g.tier && s.gold >= g.cost) {
          const r = api.buyGear(g.slot, g.tier, g.cost);
          if (r.ok) {
            const ns = api.snapState();
            gearLog.push(`Cycle ${cycle}: ${g.slot} T${g.tier} (-${g.cost}g) → ${Math.round(ns.gold)}g | cap=${ns.capacity} spd=${ns.speed}`);
          }
          break;
        }
      }

      cycle++;

      if (cycle % 50 === 0) {
        const s = api.snapState();
        snapshots.push({
          cycle,
          day: Math.round(s.day),
          gold: Math.round(s.gold),
          repMin: Math.round(Math.min(...CITIES.map(c => s.rep[c] || 0)) * 10) / 10,
          gear: `p${s.gear?.pack||0}b${s.gear?.boots||0}t${s.gear?.tool||0}`,
          cap: s.capacity,
          spd: s.speed,
        });
      }
    }

    const final = api.snapState();
    return {
      done: isDone(final),
      cycles: cycle,
      finalDay: Math.round(final.day),
      finalGold: Math.round(final.gold),
      finalRep: Object.fromEntries(CITIES.map(c => [c, Math.round((final.rep[c]||0)*10)/10])),
      finalGear: final.gear,
      gearLog,
      snapshots,
    };
  });

  console.log('\n══ GAMEPLAY SIMULATION REPORT ════════════════════════════════');
  console.log(`Completed endgame: ${result.done ? '✅ YES' : '❌ NO (hit cycle limit)'}`);
  console.log(`Trade cycles:      ${result.cycles}`);
  console.log(`In-game days:      ${result.finalDay}`);

  const realMin = Math.round(result.cycles * 1.5);
  const hrs = (realMin / 60).toFixed(1);
  console.log(`Est. real play time: ~${realMin} min  (${hrs} hrs)`);

  console.log(`\nFinal state:`);
  console.log(`  Gold: ${result.finalGold}g`);
  console.log(`  Gear: pack=${result.finalGear?.pack||0}/2  boots=${result.finalGear?.boots||0}/2  tool=${result.finalGear?.tool||0}/2`);
  console.log(`  Rep:  ${Object.entries(result.finalRep).map(([c,r])=>`${c}=${r}`).join('  ')}`);

  console.log('\nGear upgrades purchased:');
  if (result.gearLog.length) result.gearLog.forEach(l => console.log('  ' + l));
  else console.log('  (none purchased)');

  console.log('\nProgress (every 50 cycles):');
  result.snapshots.forEach(s => {
    console.log(`  Cycle ${String(s.cycle).padStart(4)} | ${String(s.gold).padStart(5)}g | rep_min=${s.repMin} | gear ${s.gear} | cap ${s.cap} spd ${s.spd}`);
  });

  console.log('\n════════════════════════════════════════════════════════════════');

  if (!result.done) die(`Did not reach endgame in ${result.cycles} cycles`);
  if (realMin < 15)  die(`Game too short (~${realMin} min) — tune costs/rewards`);
  if (realMin > 300) die(`Game too long (~${realMin} min) — tune costs/rewards`);

  console.log(`\nQA_PASS: gameplay-sim  (~${realMin} min / ${hrs} hrs estimated)`);
  await browser.close();
})();
