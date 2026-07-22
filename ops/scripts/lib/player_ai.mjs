/**
 * player_ai.mjs — the pure, browser-free "brain" of the autonomous player-sim.
 *
 * Two responsibilities, both deterministic and offline-testable:
 *   1. decideAction(obs)  — a human-like policy: given what a player can *see*
 *      (gold, pack, market prices, reachable mines), pick the next action.
 *   2. detectStuck / detectBalance / detectQoL / runDetectors — issue detectors
 *      over a rolling history of observations, emitting typed Findings.
 *
 * The Playwright driver (qa_player_sim.mjs) builds `obs` from window.__QA.api,
 * executes the chosen action against the real game, records a history entry per
 * step, and runs the detectors. Keeping this logic pure means `npm test` can
 * cover it with no browser.
 *
 * Grounded in src/main.js mechanics (see the plan / source recon):
 *   - The player cannot die or starve and gold is hard-clamped ≥ 0, so a
 *     "balance failure" is the economic softlock (broke + empty + no reachable
 *     mine), not negative gold. negative gold, if it ever appears, is a real
 *     invariant breach and flagged high.
 *   - A broke player recovers by mining (no gold gate on basic veins), so
 *     `reachableMines === 0` is the load-bearing softlock signal.
 */

// Item weights/bases mirrored from src/main.js ITEMS (line ~2899). Used for
// cargo-capacity math; kept minimal (weight is what the policy needs).
export const ITEM_WEIGHT = {
  coal: 2, grain: 1, food: 1, ore: 2, herbs: 1, potion: 1,
  relic: 2, ink: 1, gem: 1, copper: 2, silver: 1, gold: 1,
};

export const CITIES = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];

// Item ids in catalogue order — mirrors src/main.js ITEMS (line ~2899). The
// market DOM cards carry only `data-idx` (the ITEMS index), so the driver maps
// a scraped price row back to its item id through this order.
export const ITEM_ORDER = [
  'coal', 'grain', 'food', 'ore', 'herbs', 'potion',
  'relic', 'ink', 'gem', 'copper', 'silver', 'gold',
];

// Cheapest raw item base in the catalogue (coal=8). Used as a floor when an
// observation doesn't carry a live cheapest-buy price.
const CHEAPEST_ITEM_BASE = 8;

export function itemWeight(id) {
  return ITEM_WEIGHT[id] ?? 1;
}

export function totalUnits(inv = {}) {
  let n = 0;
  for (const k of Object.keys(inv)) n += Math.max(0, inv[k] || 0);
  return n;
}

export function cargoWeight(inv = {}) {
  let w = 0;
  for (const k of Object.keys(inv)) w += Math.max(0, inv[k] || 0) * itemWeight(k);
  return w;
}

function firstHeld(inv = {}) {
  for (const k of Object.keys(inv)) if ((inv[k] || 0) > 0) return k;
  return null;
}

// Best (item, city) to SELL currently-held cargo, by sell price.
function bestSellPlan(obs) {
  let best = null;
  for (const item of Object.keys(obs.inv || {})) {
    if ((obs.inv[item] || 0) <= 0) continue;
    for (const cid of Object.keys(obs.prices || {})) {
      const q = obs.prices[cid]?.[item];
      if (!q || !Number.isFinite(q.sell)) continue;
      if (!best || q.sell > best.sell) best = { item, cityId: cid, sell: q.sell };
    }
  }
  return best;
}

// Best item to BUY at the current city: maximises expected cross-city margin
// (best sell elsewhere − buy here), constrained by gold and remaining capacity.
function bestBuyPlan(obs) {
  const here = obs.prices?.[obs.cityId] || {};
  const remCap = obs.capacity - cargoWeight(obs.inv);
  let best = null;
  for (const item of Object.keys(here)) {
    const buy = here[item]?.buy;
    if (!Number.isFinite(buy) || buy > obs.gold) continue;
    const w = itemWeight(item);
    if (w > remCap) continue;

    let bestSell = 0;
    for (const cid of Object.keys(obs.prices)) {
      if (cid === obs.cityId) continue;
      const s = obs.prices[cid]?.[item]?.sell;
      if (Number.isFinite(s) && s > bestSell) bestSell = s;
    }
    const expMargin = bestSell - buy;
    if (!best || expMargin > best.expMargin) {
      const maxByGold = Math.floor(obs.gold / buy);
      const maxByCap = Math.floor(remCap / w);
      const qty = Math.max(0, Math.min(maxByGold, maxByCap));
      best = { item, cityId: obs.cityId, buy, expMargin, qty };
    }
  }
  return best && best.qty > 0 ? best : null;
}

// Cheapest gear upgrade the player doesn't own yet and can afford. Mirrors the
// gameplay-sim's cheapest-first table (costs from qa_gameplay_sim.mjs).
const GEAR_UPGRADES = [
  { slot: 'pack', tier: 1, cost: 120 }, { slot: 'boots', tier: 1, cost: 150 },
  { slot: 'tool', tier: 1, cost: 200 }, { slot: 'pack', tier: 2, cost: 350 },
  { slot: 'boots', tier: 2, cost: 500 }, { slot: 'tool', tier: 2, cost: 600 },
  { slot: 'pack', tier: 3, cost: 900 },
];
// Only spend on gear when comfortably flush, so trading capital isn't starved.
const GEAR_FLUSH_GOLD = 400;

function nextGearBuy(obs) {
  if (obs.gold < GEAR_FLUSH_GOLD) return null;
  const gear = obs.gear || {};
  for (const g of GEAR_UPGRADES) {
    if ((gear[g.slot] ?? 0) < g.tier && obs.gold >= g.cost) {
      // Keep a trading buffer: don't drop below the flush threshold minus cost.
      return { type: 'buyGear', slot: g.slot, tier: g.tier, cost: g.cost };
    }
  }
  return null;
}

/**
 * decideAction(obs, memory) — the policy. Deterministic given `obs`.
 * Priority order (how a rational player behaves):
 *   0. Resolve an open event modal (a threat event blocks everything).
 *   1. Holding cargo → sell where it's dearest (sell here, or travel there).
 *   2. Flush + empty pack → buy the cheapest missing gear upgrade.
 *   3. Empty pack → buy the best-margin affordable trade good.
 *   4. Broke + empty + a mine is reachable → mine to recover.
 *   5. Otherwise → idle (this is the stuck state; detectStuck reports it).
 */
export function decideAction(obs, memory = {}) {
  if (obs.modal && obs.modal.event) {
    return { type: 'resolveEvent', dismissable: !!obs.modal.dismissable };
  }

  const units = totalUnits(obs.inv);

  if (units > 0) {
    const plan = bestSellPlan(obs);
    if (plan) {
      if (plan.cityId === obs.cityId) {
        return { type: 'sell', item: plan.item, qty: obs.inv[plan.item], cityId: obs.cityId };
      }
      return { type: 'travel', to: plan.cityId, reason: `sell ${plan.item}` };
    }
    // No known market for what we hold: dump it here to avoid wedging.
    const held = firstHeld(obs.inv);
    if (held) return { type: 'sell', item: held, qty: obs.inv[held], cityId: obs.cityId };
  }

  const gear = nextGearBuy(obs);
  if (gear) return gear;

  const buy = bestBuyPlan(obs);
  if (buy && buy.expMargin > 0) {
    return { type: 'buy', item: buy.item, qty: buy.qty, cityId: obs.cityId };
  }

  if ((obs.reachableMines || 0) > 0) {
    return { type: 'mine' };
  }

  return { type: 'idle', reason: 'no affordable action and no reachable mine' };
}

// ── Findings ──────────────────────────────────────────────────────────────────

function finding(severity, category, code, detail, entry) {
  return {
    severity, category, code, detail,
    day: entry?.day ?? null,
    step: entry?.step ?? null,
  };
}

function maxPosDelta(entries) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of entries) {
    const p = e.pos || { x: 0, y: 0 };
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/**
 * detectStuck — movement + economic softlocks.
 *   - economic-softlock (high): broke, empty pack, no reachable mine.
 *   - movement-frozen  (high): navigation active but position hasn't moved
 *     across the last `freezeSteps` entries.
 */
export function detectStuck(history, opts = {}) {
  const { freezeSteps = 30, posEps = 2 } = opts;
  const out = [];
  if (!history.length) return out;

  const last = history[history.length - 1];
  const cheapest = Number.isFinite(last.cheapestBuy) ? last.cheapestBuy : CHEAPEST_ITEM_BASE;
  if ((last.gold ?? 0) < cheapest && (last.cargoUnits ?? 0) === 0 && (last.reachableMines ?? 0) === 0) {
    out.push(finding('high', 'stuck', 'economic-softlock',
      `Broke (${last.gold}g < cheapest buy ${cheapest}g), empty pack, and no mine reachable — no way to earn.`, last));
  }

  if (history.length >= freezeSteps) {
    const window = history.slice(-freezeSteps);
    const navThroughout = window.every(e => e.navActive);
    if (navThroughout && maxPosDelta(window) < posEps) {
      out.push(finding('high', 'stuck', 'movement-frozen',
        `Navigation active for ${freezeSteps} steps but position moved < ${posEps}px — pathing softlock.`, last));
    }
  }

  return out;
}

/**
 * detectBalance — economy health.
 *   - negative-gold  (high): the gold ≥ 0 invariant broke — a real bug.
 *   - runaway-wealth (med):  sustained gold gain far above a sane cap → trivial.
 *   - bankruptcy-spiral (med): gold non-increasing for a long window, ending broke.
 */
export function detectBalance(history, opts = {}) {
  // 250g/day ⇒ the ~2000g of endgame gear+goal is reachable in <8 in-game days,
  // far faster than the intended pace (qa_gameplay_sim.mjs targets 15–300 min ≈
  // many in-game days), so sustained gain above it flags a too-generous economy.
  const { runawayGoldPerDay = 250, spiralSteps = 40, brokeFloor = 15 } = opts;
  const out = [];
  if (!history.length) return out;

  const breach = history.find(e => (e.gold ?? 0) < 0);
  if (breach) {
    out.push(finding('high', 'balance', 'negative-gold',
      `Gold went negative (${breach.gold}g) — the gold ≥ 0 invariant was violated.`, breach));
  }

  const first = history[0];
  const last = history[history.length - 1];
  const days = (last.day ?? 0) - (first.day ?? 0);
  if (days > 0) {
    const perDay = ((last.gold ?? 0) - (first.gold ?? 0)) / days;
    if (perDay > runawayGoldPerDay) {
      out.push(finding('med', 'balance', 'runaway-wealth',
        `Gold grew ${Math.round(perDay)}g/day (cap ${runawayGoldPerDay}) — economy may be trivially exploitable.`, last));
    }
  }

  if (history.length >= spiralSteps) {
    const window = history.slice(-spiralSteps);
    let nonIncreasing = true;
    for (let i = 1; i < window.length; i++) {
      if ((window[i].gold ?? 0) > (window[i - 1].gold ?? 0) + 1) { nonIncreasing = false; break; }
    }
    if (nonIncreasing && (last.gold ?? 0) <= brokeFloor) {
      out.push(finding('med', 'balance', 'bankruptcy-spiral',
        `Gold only fell for ${spiralSteps} steps, ending at ${last.gold}g — no recovery path is being found.`, last));
    }
  }

  return out;
}

/**
 * detectQoL — friction / dead-ends.
 *   - repeated-failure (med): same action failed `failRepeat` times in a row.
 *   - modal-stuck     (high): an event modal stayed open across `modalSteps` steps.
 */
export function detectQoL(history, opts = {}) {
  const { failRepeat = 5, modalSteps = 15 } = opts;
  const out = [];
  if (!history.length) return out;
  const last = history[history.length - 1];

  if (history.length >= failRepeat) {
    const tail = history.slice(-failRepeat);
    const type = tail[0].action?.type;
    const allSameFailed = tail.every(e => e.actionOk === false && e.action?.type === type);
    if (allSameFailed && type) {
      out.push(finding('med', 'qol', 'repeated-failure',
        `Action "${type}" failed ${failRepeat} times in a row — a dead-click / unaffordable loop.`, last));
    }
  }

  if (history.length >= modalSteps) {
    const tail = history.slice(-modalSteps);
    if (tail.every(e => e.modalEvent)) {
      out.push(finding('high', 'qol', 'modal-stuck',
        `An event modal stayed open for ${modalSteps} steps — it may be un-closeable (softlock).`, last));
    }
  }

  return out;
}

/**
 * runDetectors — run every detector and dedupe by finding code, keeping the
 * highest severity seen. A single persistent bad state (e.g. negative gold on
 * every frame) should surface as one finding, not thousands.
 */
export function runDetectors(history, opts = {}) {
  const all = [
    ...detectStuck(history, opts),
    ...detectBalance(history, opts),
    ...detectQoL(history, opts),
  ];
  const SEV_RANK = { low: 0, med: 1, high: 2 };
  const byCode = new Map();
  for (const f of all) {
    const prev = byCode.get(f.code);
    if (!prev || SEV_RANK[f.severity] > SEV_RANK[prev.severity]) byCode.set(f.code, f);
  }
  return [...byCode.values()].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}
