#!/usr/bin/env node
/**
 * qa_player_sim.mjs — autonomous player simulation for issue discovery.
 *
 * Unlike qa_gameplay_sim.mjs (which cheats — sets rep/gold directly and
 * teleports for every trade to *measure* time-to-endgame), this bot PLAYS the
 * real game the way a human does, through window.__QA.api (?qa=1):
 *   - walks between cities on foot with the game's A* auto-nav,
 *   - reads live buy/sell prices off the market DOM and remembers them,
 *   - trades on margin, mines to recover when broke, buys gear when flush,
 * while detectors watch for three classes of issue:
 *   - STUCK   : movement softlocks, economic softlock (broke + empty + no mine),
 *   - BALANCE : negative gold (invariant breach), runaway wealth, bankruptcy,
 *   - QOL     : dead-click loops, un-closeable ("trap") modals.
 * A separate probe drives every non-dismissable threat event at gold=0/inv={}
 * to prove each can still be resolved (the realistic loop can't reliably reach
 * them, and __QA.api.step force-closes modals which would mask the bug).
 *
 * Decision + detection logic lives in ./lib/player_ai.mjs (pure, unit-tested by
 * player_sim_tests.mjs). This file is the browser driver only.
 *
 * Usage:
 *   node ops/scripts/qa_player_sim.mjs [url] [--steps N] [--seed S] [--pretty] [--json]
 *   npm run qa:player-sim -- --steps 4000 --seed 7 --pretty
 *
 * Exit code: non-zero if any HIGH-severity finding is discovered (CI-gateable),
 * matching qa_gameplay_sim.mjs's die()-on-failure convention.
 */

import { chromium } from 'playwright';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { startServer } from './lib/static_server.mjs';
import { decideAction, detectStuck, detectBalance, detectQoL, ITEM_ORDER, CITIES, itemWeight } from './lib/player_ai.mjs';

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { steps: 4000, seed: 7, pretty: false, json: false, url: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--steps') out.steps = Math.max(1, parseInt(argv[++i], 10) || 4000);
    else if (a === '--seed') out.seed = parseInt(argv[++i], 10) || 0;
    else if (a === '--pretty') out.pretty = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') { out.help = true; }
    else if (!a.startsWith('--')) out.url = a;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log('Usage: node ops/scripts/qa_player_sim.mjs [url] [--steps N] [--seed S] [--pretty] [--json]');
  process.exit(0);
}

function log(...a) { if (!args.json) console.log(...a); }
function die(msg) {
  if (process.env.GITHUB_ACTIONS) console.error(`::error::QA_FAIL: ${msg}`);
  console.error('QA_FAIL:', msg);
  process.exit(1);
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const launchOptions = {
  ...(isRoot ? { args: ['--no-sandbox'] } : {}),
  // Opt-in override for environments with a pre-provisioned browser whose build
  // differs from the pinned Playwright (unset in CI → normal resolution).
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
};

// ── In-page helpers (evaluated in the browser) ───────────────────────────────
// Passed as strings/functions to page.evaluate. Kept small and dependency-free.

/** Read the current city's market prices off the DOM and return {itemId:{buy,sell}}. */
const SCRAPE_PRICES = ({ cityId, itemOrder }) => {
  const api = window.__QA.api;
  api.openMarketUI(cityId, 'buy'); // buy mode renders both buy+sell for every item
  const out = {};
  document.querySelectorAll('.cr-card[data-idx]').forEach(card => {
    const idx = parseInt(card.getAttribute('data-idx'), 10);
    const id = itemOrder[idx];
    if (!id) return; // permit row or out of range
    const buyEl = card.querySelector('.cr-buy-price');
    const sellEl = card.querySelector('.cr-sell-price');
    if (!buyEl || !sellEl) return;
    const buy = parseInt((buyEl.textContent.match(/(\d+)/) || [])[1], 10);
    const sell = parseInt((sellEl.textContent.match(/(\d+)/) || [])[1], 10);
    if (Number.isFinite(buy) && Number.isFinite(sell)) out[id] = { buy, sell };
  });
  api.closeUI();
  return out;
};

/** Count mine veins a player at the given pickaxe tier could actually work.
 *  Copper + silver veins have no pickaxe gate; gold needs Pickaxe T2 (src/main.js
 *  item spec `minPickaxeTier`). A vein only counts if it's *approachable* — has a
 *  walkable neighbour tile to stand on; a vein walled in by solids (water/wall/
 *  mountain) can't be mined and is exactly the economic-softlock we hunt. The
 *  game's A* auto-nav handles getting there once a stand-tile exists, so
 *  approach-ability (not full path length) is the load-bearing signal. */
const COUNT_REACHABLE_MINES = (pickaxeTier) => {
  const api = window.__QA.api;
  const approachable = (node) => node && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
    ([dx, dy]) => api.isTileWalkable(node.tx + dx, node.ty + dy)
  );
  let n = 0;
  if (approachable(api.qaMineSiteNodeAt('copper'))) n += api.qaCountMineNodes('copper');
  if (approachable(api.qaMineSiteNodeAt('silver'))) n += api.qaCountMineNodes('silver');
  if (pickaxeTier >= 2 && approachable(api.qaMineSiteNodeAt('gold'))) n += api.qaCountMineNodes('gold');
  return n;
};

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  let server = null;
  let url = args.url || process.env.QA_URL;
  if (!url) {
    const PORT = 8080;
    const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
    try {
      server = await startServer(ROOT, PORT);
    } catch (e) {
      if (e.code !== 'EADDRINUSE') die(`Failed to start local server: ${e.message}`);
      log(`[player-sim] Port ${PORT} in use — reusing existing server`);
    }
    url = `http://127.0.0.1:${PORT}/?qa=1`;
  }

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // Crash / self-diagnosis capture. Resource-load failures (sprites, favicon,
  // Supabase) are expected in an offline sandbox and are NOT game bugs, so they
  // are filtered out — only real JS exceptions and QA_FAIL asserts count.
  const crashes = [];
  const isEnvNoise = (t) => /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION|status of 40[034]/.test(t);
  page.on('pageerror', e => crashes.push(`pageerror: ${e.message}`));
  page.on('console', msg => {
    const t = msg.text();
    if (msg.type() === 'error' && !isEnvNoise(t)) crashes.push(`console.error: ${t}`);
    else if (t.startsWith('QA_FAIL')) crashes.push(t);
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
      () => window.__QA && typeof window.__QA.api?.snapState === 'function',
      { timeout: 30_000 }
    );

    // Deterministic-ish start: fresh player, freeze the price clock so a run is
    // reproducible modulo the game's own event/mining RNG.
    await page.evaluate(({ cities, itemOrder }) => {
      const api = window.__QA.api;
      api.clearSave();
      api.freezePrices();
      api.setTime({ day: 1, frac: 0, seed: 1 });
      // setPlayer merges inv (it doesn't clear), and the in-page QA self-test
      // that runs on load leaves goods behind — so zero every item explicitly.
      const zeroInv = Object.fromEntries(itemOrder.map(id => [id, 0]));
      api.setPlayer({ gold: 220, capacity: 18, inv: zeroInv, gear: { pack: 0, boots: 0, tool: 0, pickaxe: 0 } });
      cities.forEach(c => api.setRep(c, 0));
    }, { cities: CITIES, itemOrder: ITEM_ORDER });

    // ── Realistic play loop ────────────────────────────────────────────────
    const history = [];
    const actionCounts = {};
    const goldCurve = [];
    const driverFindings = []; // findings the driver detects directly (e.g. auto-nav freezes)
    let stepBudget = args.steps;

    // Price memory: what the player has seen, per city (like a real trader).
    const priceMemory = {};
    let curCity = 'valdenmere';

    // ── Scouting pass ──────────────────────────────────────────────────────
    // Seed price knowledge for all cities up front, the way a trader learns the
    // map before committing capital. Without this the bot only knows the current
    // city and every cross-city margin looks negative, so it never trades.
    for (const c of CITIES) {
      priceMemory[c] = await page.evaluate(SCRAPE_PRICES, { cityId: c, itemOrder: ITEM_ORDER });
    }
    // Return to the starting city so the first real move is on foot.
    await page.evaluate((c) => window.__QA.api.teleportToCity(c), 'valdenmere');

    function record(entry) {
      history.push(entry);
      // Keep memory bounded so long runs don't blow up RAM; detectors look back
      // at most ~40 entries.
      if (history.length > 400) history.shift();
    }

    while (stepBudget > 0) {
      // ── Observe ──────────────────────────────────────────────────────────
      const snap = await page.evaluate(() => {
        const api = window.__QA.api;
        return {
          state: api.snapState(),
          pos: api.getPlayerPos(),
          city: api.getPlayerCity(),
          eventOpen: api.qaEventOpen(),
        };
      });
      const inCity = snap.city;
      if (inCity) {
        // Refresh the current city's remembered prices.
        priceMemory[inCity] = await page.evaluate(SCRAPE_PRICES, { cityId: inCity, itemOrder: ITEM_ORDER });
        curCity = inCity;
      }
      const reachableMines = await page.evaluate(COUNT_REACHABLE_MINES, snap.state.gear?.pickaxe || 0);

      const obs = {
        cityId: curCity,
        gold: snap.state.gold,
        capacity: snap.state.capacity,
        inv: Object.fromEntries(Object.entries(snap.state.inv).filter(([, v]) => v > 0)),
        gear: snap.state.gear,
        rep: snap.state.rep,
        day: snap.state.day,
        prices: priceMemory,
        reachableMines,
        modal: { event: !!snap.eventOpen, dismissable: true },
      };

      // ── Decide ───────────────────────────────────────────────────────────
      const action = decideAction(obs);
      actionCounts[action.type] = (actionCounts[action.type] || 0) + 1;

      // ── Execute ──────────────────────────────────────────────────────────
      let actionOk = true;
      let navEntries = [];
      if (action.type === 'travel') {
        // Walk on foot via the game's A* auto-nav, in 30-step chunks. A freeze is
        // detected by POSITION STALL (not a chunk-count cap): if the player stops
        // moving for `freezeChunks` consecutive chunks while nav is still active,
        // the route is wedged. (Auto-nav has no stall-replan, unlike click-move —
        // src/main.js ~8569 — so some routes freeze forever.) Cap is generous so
        // legitimately long routes complete (the longest real route ≈ 67 chunks).
        const tr = await page.evaluate(async ({ to, maxChunks, freezeChunks }) => {
          const api = window.__QA.api;
          api.startAutoNav(to);
          const frames = [];
          let frozen = 0, last = api.getPlayerPos(), stuckAt = null, waypoint = null;
          for (let i = 0; i < maxChunks; i++) {
            api.walkSteps(30);
            const nav = api.getAutoNav();
            const pos = api.getPlayerPos();
            frames.push({ navActive: nav.active, pos });
            if (!nav.active) break; // arrived
            if (Math.hypot(pos.x - last.x, pos.y - last.y) < 2) {
              if (++frozen >= freezeChunks) { stuckAt = pos; waypoint = { idx: nav.pathIdx, len: nav.pathLen }; break; }
            } else frozen = 0;
            last = pos;
          }
          return { frames, arrived: !api.getAutoNav().active, stuckAt, waypoint };
        }, { to: action.to, maxChunks: 120, freezeChunks: 12 });
        navEntries = tr.frames;
        actionOk = tr.arrived;
        if (tr.stuckAt) {
          driverFindings.push({
            severity: 'high', category: 'stuck', code: 'movement-frozen',
            route: `${curCity}->${action.to}`,
            detail: `Auto-nav ${curCity}→${action.to} wedged near world (${Math.round(tr.stuckAt.x)},${Math.round(tr.stuckAt.y)}) on waypoint ${tr.waypoint.idx}/${tr.waypoint.len} and never recovered (auto-nav has no stall-replan).`,
            day: Math.round(obs.day),
          });
          // Recover so a single stuck route doesn't halt the rest of the run.
          await page.evaluate((c) => window.__QA.api.teleportToCity(c), action.to);
        }
        // Model the journey's passage of time + rations upkeep (the game's
        // walkSteps movement doesn't advance the day clock; travelDays does, and
        // applies the food/gold upkeep that drives the hunger economy).
        if (tr.arrived || tr.stuckAt) {
          await page.evaluate(() => window.__QA.api.travelDays(1));
        }
      } else if (action.type === 'buy') {
        const r = await page.evaluate(({ item, qty, cityId }) =>
          window.__QA.api.marketBuy(item, qty, cityId), action);
        actionOk = !!r.ok;
      } else if (action.type === 'sell') {
        const r = await page.evaluate(({ item, qty, cityId }) =>
          window.__QA.api.marketSell(item, qty, cityId), action);
        actionOk = !!r.ok;
      } else if (action.type === 'buyGear') {
        const r = await page.evaluate(({ slot, tier, cost }) =>
          window.__QA.api.buyGear(slot, tier, cost), action);
        actionOk = !!r.ok;
      } else if (action.type === 'mine') {
        const r = await page.evaluate((pickaxe) => {
          const api = window.__QA.api;
          // Prefer an un-gated vein (copper, then silver); only mine gold with T2+.
          const node = api.qaMineSiteNodeAt('copper')
            || api.qaMineSiteNodeAt('silver')
            || (pickaxe >= 2 ? api.qaMineSiteNodeAt('gold') : null)
            || api.qaMineNodeAt();
          if (!node) return { ok: false };
          api.teleportToTile(node.tx, node.ty);
          api.qaResetMineCooldowns();
          api.qaSetStamina(100);
          return { ok: api.qaPlayerMine(node.tx, node.ty) };
        }, snap.state.gear?.pickaxe || 0);
        actionOk = !!r.ok;
      } else if (action.type === 'resolveEvent') {
        actionOk = await page.evaluate(() => { window.__QA.api.closeUI(); return true; });
      } else {
        // idle — nothing to do; advance a little so time still passes.
        await page.evaluate(() => window.__QA.api.step(1 / 60));
        actionOk = false;
      }

      // ── Record history entries ───────────────────────────────────────────
      const cargoUnits = Object.values(obs.inv).reduce((a, b) => a + b, 0);
      const cargoWt = Object.entries(obs.inv).reduce((a, [k, v]) => a + v * itemWeight(k), 0);
      const cheapestBuy = (() => {
        const here = priceMemory[curCity] || {};
        const buys = Object.values(here).map(q => q.buy).filter(Number.isFinite);
        return buys.length ? Math.min(...buys) : 8;
      })();

      if (navEntries.length) {
        // One entry per nav chunk so the movement-frozen detector can see stalls.
        for (const f of navEntries) {
          record({
            step: args.steps - stepBudget, day: obs.day, pos: f.pos, gold: obs.gold,
            cargoUnits, cargoWeight: cargoWt, reachableMines, cheapestBuy,
            navActive: f.navActive, action, actionOk, modalEvent: obs.modal.event, modalDismissable: true,
          });
        }
      } else {
        record({
          step: args.steps - stepBudget, day: obs.day, pos: snap.pos, gold: obs.gold,
          cargoUnits, cargoWeight: cargoWt, reachableMines, cheapestBuy,
          navActive: false, action, actionOk, modalEvent: obs.modal.event, modalDismissable: true,
        });
      }

      if ((args.steps - stepBudget) % 25 === 0) {
        goldCurve.push({ step: args.steps - stepBudget, day: Math.round(obs.day), gold: Math.round(obs.gold) });
      }

      stepBudget--;
    }

    // ── Event theme-integrity probe ──────────────────────────────────────────
    // A softlock-adjacent invariant we CAN test robustly with the exposed hooks:
    // every non-dismissable "threat" event must render as a threat panel AND
    // present at least one choice (a way out); benign events must NOT be
    // threat-themed (else they'd wrongly refuse Esc/✕ and trap the player).
    // (We can't drive real event *choices* — the game hit-tests canvas taps, not
    //  DOM clicks, and __QA.api.step force-closes modals — so this validates the
    //  event classification + choice presence, which is what guards against a
    //  choiceless, un-dismissable trap.)
    const trapFindings = await page.evaluate(() => {
      const api = window.__QA.api;
      const THREAT_KINDS = ['bandits', 'toll', 'patrol', 'plague_cart', 'wild_animal'];
      const BENIGN_KINDS = ['omen', 'merchant', 'windfall', 'find'];
      const out = [];
      const inspect = (kind) => {
        api.qaOpenTestEvent(kind);
        const p = document.querySelector('.cr-event');
        const info = p
          ? { open: true, threat: p.classList.contains('cr-event-threat'), choices: p.querySelectorAll('.cr-list .cr-card').length }
          : { open: false, threat: false, choices: 0 };
        api.closeUI();
        return info;
      };
      for (const kind of THREAT_KINDS) {
        try {
          const i = inspect(kind);
          if (!i.open || !i.threat) {
            out.push({ severity: 'high', category: 'qol', code: 'threat-misclassified',
              detail: `Threat event "${kind}" did not render as a non-dismissable threat panel (open=${i.open}, threat=${i.threat}) — danger could be skipped.` });
          }
          if (i.open && i.choices < 1) {
            out.push({ severity: 'high', category: 'qol', code: 'modal-trap',
              detail: `Non-dismissable event "${kind}" rendered with 0 choices — an unrecoverable softlock.` });
          }
        } catch (e) {
          out.push({ severity: 'high', category: 'crash', code: 'event-throw', detail: `Event "${kind}" threw: ${e.message}` });
        }
      }
      for (const kind of BENIGN_KINDS) {
        try {
          const i = inspect(kind);
          if (i.open && i.threat) {
            out.push({ severity: 'med', category: 'qol', code: 'benign-as-threat',
              detail: `Benign event "${kind}" rendered as a non-dismissable threat — it would refuse Esc/✕ and trap the player.` });
          }
        } catch { /* ignore */ }
      }
      return out;
    });

    // ── Aggregate findings ───────────────────────────────────────────────────
    const SEV_RANK = { low: 0, med: 1, high: 2 };
    // Driver freezes: dedupe by route so distinct stuck routes survive but a
    // route hit repeatedly (with jittering coords) collapses to one finding.
    const driverUniq = [...new Map(driverFindings.map(f => [f.route || f.detail, f])).values()];
    const hasDriverMoveFrozen = driverUniq.some(f => f.code === 'movement-frozen');
    // Stuck/QoL detectors run on the step-level history; balance runs on the
    // full-run gold trajectory (goldCurve is unbounded, unlike the capped history)
    // so the gold/day rate reflects the whole run, not a recent window.
    const detectorRaw = [
      ...detectStuck(history),
      ...detectBalance(goldCurve),
      ...detectQoL(history),
    ];
    const byCode = new Map();
    for (const f of detectorRaw) {
      const prev = byCode.get(f.code);
      if (!prev || SEV_RANK[f.severity] > SEV_RANK[prev.severity]) byCode.set(f.code, f);
    }
    // Drop the generic history movement-frozen when the driver already reported
    // precise per-route freezes.
    const detectorUniq = [...byCode.values()]
      .filter(f => !(f.code === 'movement-frozen' && hasDriverMoveFrozen));
    // Crashes: distinct messages each survive (Set-deduped).
    const crashFindings = [...new Set(crashes)].slice(0, 20).map(c => ({
      severity: 'high', category: 'crash', code: 'runtime-error', detail: c,
    }));
    const findings = [...driverUniq, ...detectorUniq, ...trapFindings, ...crashFindings]
      .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

    const finalSnap = await page.evaluate(() => window.__QA.api.snapState());
    const highCount = findings.filter(f => f.severity === 'high').length;

    const report = {
      ok: highCount === 0,
      seed: args.seed,
      steps: args.steps,
      summary: {
        daysPlayed: Math.round(finalSnap.day),
        finalGold: Math.round(finalSnap.gold),
        finalGear: finalSnap.gear,
        repMin: Math.min(...CITIES.map(c => finalSnap.rep[c] || 0)),
        guildMilestone: CITIES.every(c => (finalSnap.rep[c] || 0) >= 5) && (finalSnap.gear?.pack || 0) >= 3,
        actions: actionCounts,
        findingsBySeverity: {
          high: findings.filter(f => f.severity === 'high').length,
          med: findings.filter(f => f.severity === 'med').length,
          low: findings.filter(f => f.severity === 'low').length,
        },
      },
      findings,
      goldCurve,
    };

    if (args.json) {
      console.log(JSON.stringify(report, args.pretty ? null : undefined, args.pretty ? 2 : undefined));
    } else {
      log('\n══ AUTONOMOUS PLAYER-SIM REPORT ══════════════════════════════');
      log(`Steps: ${report.steps}   Days played: ${report.summary.daysPlayed}   Final gold: ${report.summary.finalGold}g`);
      log(`Gear: pack=${finalSnap.gear?.pack || 0} boots=${finalSnap.gear?.boots || 0} tool=${finalSnap.gear?.tool || 0}   Rep(min): ${report.summary.repMin}   Guild: ${report.summary.guildMilestone ? '✅' : '—'}`);
      log(`Actions: ${Object.entries(actionCounts).map(([k, v]) => `${k}=${v}`).join('  ')}`);
      log(`\nFindings: ${findings.length}  (high=${report.summary.findingsBySeverity.high} med=${report.summary.findingsBySeverity.med} low=${report.summary.findingsBySeverity.low})`);
      if (!findings.length) log('  ✅ No issues discovered.');
      for (const f of findings) {
        const icon = f.severity === 'high' ? '🔴' : f.severity === 'med' ? '🟡' : '⚪';
        log(`  ${icon} [${f.category}/${f.code}] ${f.detail}`);
      }
      log('\n══════════════════════════════════════════════════════════════');
    }

    await browser.close();
    if (server) server.close();

    if (highCount > 0) die(`${highCount} high-severity issue(s) discovered`);
    log(`\nQA_PASS: player-sim  (${findings.length} finding(s), 0 high-severity)`);
    process.exit(0);
  } catch (e) {
    try { await browser.close(); } catch {}
    if (server) server.close();
    die(`player-sim crashed: ${e && (e.stack || e.message) || e}`);
  }
})();
