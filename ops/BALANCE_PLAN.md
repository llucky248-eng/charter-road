# System Balance Plan — driven by how the NPCs did

Audit date: 2026-07-30 · Branch: `claude/system-balance-npc-plan-a5tv28` ·
Baseline: `git rev-parse HEAD` at audit time. Line refs are
`ops/scripts/world_service.mjs` unless noted.

## How to read this

Every item lists the **problem** (with code / sim evidence), the **fix**, an
**acceptance metric**, and the **test to write first** (red → green, per the
Test-first rule in `CLAUDE.md`). Economy constants live in **three** mirrored
copies that must be edited together: `src/main.js`, `ops/scripts/world_service.mjs`,
and `ops/scripts/lib/mining.mjs`. Any commit touching `src/main.js` needs a
version bump (`node ops/scripts/bump_version.mjs +patch`) before staging.

---

## Diagnosis — what the NPC data shows

Reproduce with two offline commands:

```
node ops/scripts/economy_parity_test.mjs   # 22/22 pass — constants are in sync
node ops/scripts/trade_sim.mjs             # the balance signal
node ops/scripts/mining_report.mjs --days 30 --seed 7 --pretty
```

**Finding 1 — the NPC-facing economy is net-negative.**
`trade_sim.mjs` models the same prices, tax, upkeep, and travel the AI traders
face. All four strategies go bankrupt:

| Strategy | End gold | Day bankrupt | g/day | Upkeep paid |
|---|---|---|---|---|
| Full Circuit (4 cities) | 0g | 41 | −4.0 | 78g |
| Food Arbitrage | 0g | 36 | −4.6 | 93g |
| High-Value (Relic/Potion) | 0g | 35 | −4.7 | 69g |
| Ore Loop | 0g | 32 | −5.2 | 69g |

**Finding 2 — the live traders only survive on a band-aid.** `tickTrader`
applies a hard **30g gold floor** (line ~1043: *"traders always keep at least
30g"*). Without it, NPC traders would drain to zero exactly like the sim
strategies. The floor masks the negative margin instead of fixing it — the same
is true of the already-reduced `PERMIT_COST` (line 233, 300 → 150) and the tier-1
gear cost (line 176). These are patches over a margin problem.

**Finding 3 — one route dominates.** Balance analysis reports a **15.0x spread
ratio**: best route `valdenmere → ironholt` (Minor Potion) = +45g/day vs. the
weakest profitable route +3g/day. `trade_sim.mjs` flags this: *"Dominant route —
needs rebalancing."* A single dominant lane funnels every trader (and player)
into one market, saturating it and flattening the rest of the map.

**Finding 4 — mining is NOT the problem.** `mining_report.mjs` shows copper /
silver / gold all mined, shipped, and net-positive with sane spreads (silver
+37g/unit, gold +91g/unit). The imbalance is confined to the six general trade
goods. **This plan does not touch metal pricing.**

**Root cause.** Cross-city margins on trade goods are 3–13g/unit, but each trip
pays: 10% sell tax (`CITY_TAX`, line ~220), ~9g upkeep over a 3-day trip
(`UPKEEP`, trade_sim line 34), and the 6% within-city bid/ask spread (`SPREAD`,
line 173). Median net per trip is ≈0 or negative, so capital erodes every loop.

**Targets for "balanced":**
- A competent 30-day run ends **net-positive without the gold floor** (all four
  sim strategies ≥ +0g, best strategy ≥ +2g/day).
- Route **spread ratio < 5x** (no single dominant lane).
- Economy parity stays **22/22**; mining report unchanged.

---

## P1 — Make competent trading net-positive

### 1. Trip sinks exceed trip margins — P1

**Problem.** Per Finding 1, every strategy loses money. The three sinks (tax,
upkeep, spread) sum to more than the median route earns. Evidence: Ore Loop pays
69g upkeep and still ends at 0g; the "Upkeep as % of top-route profit: 7% ✅"
line in the sim is misleading because it measures only the single *best* route,
not the median route a trader actually runs.

**Fix (tune, don't guess).** Reduce the stacked drag so the **median** profitable
route clears its trip cost, in this priority order (cheapest blast radius first):
1. Lower `CITY_TAX` from 0.10 toward ~0.06–0.07 (mirror in all three files).
2. If still negative, reduce upkeep drag: either `UPKEEP` cadence or the food
   penalty (trade_sim line 34/127), and/or nudge the base food price so upkeep
   isn't a compounding sink.
3. Leave `SPREAD` (0.06) last — it also shapes the player market feel.

Re-run `trade_sim.mjs` after each nudge; stop when the median strategy is ≥ +0g.

**Acceptance.** All four sim strategies end ≥ 0g over 30 days; best ≥ +2g/day.

**Test first.** New assertion block in `trade_sim.mjs` (or a dedicated
`balance_regression_test.mjs`): run all four strategies with the gold floor
disabled and assert `end >= START_GOLD` for the top two and `end > 0` for all
four. Write it red against today's numbers first.

### 2. Retire the gold-floor band-aid once margins are real — P1

**Problem.** The `t.gold < 30 → 30` floor (line ~1043) means a trader that would
have gone bankrupt keeps trading on money the economy never gave it — free gold
injected every loop, quietly inflating the money supply.

**Fix.** After item 1 lands and traders survive on merit, remove the floor (or
lower its threshold to a genuine "stranded, can't afford any cargo" rescue, e.g.
one minimum cargo unit, logged as a rare event). Do this as its own commit so the
before/after trader solvency is visible in the diff.

**Acceptance.** A world tick over the equivalent of 30 game-days leaves the AI
traders' **total** gold stable-or-growing without the floor firing on a healthy
trader (the floor may still fire only for a genuinely stranded trader).

**Test first.** Unit test in `economy_parity_test.mjs` style: drive `tickTrader`
through several loops on the best route with the floor disabled and assert the
trader's gold is monotonically non-negative from its own earnings.

---

## P2 — Compress route dominance (15x → < 5x)

### 3. Nerf the dominant Minor-Potion lane, lift the floor routes — P2

**Problem.** Finding 3: `valdenmere → ironholt` Minor Potion is 15x the weakest
route. It comes from the potion city multipliers (valdenmere 0.85 buy-side,
ironholt 1.10 sell-side, line ~267–270) combined with potion's 18-unit cargo.

**Fix.** Compress the potion multiplier gap (e.g. raise valdenmere's potion
multiplier and/or trim ironholt's) so the Minor-Potion lane drops toward the
pack, and lift the weakest lanes (Iron Ore / Moon Herbs cross-city margins) by a
small multiplier nudge so ≥ 3 items have a viable top route. Mirror across all
three files; keep `economy_parity_test.mjs` green.

**Acceptance.** `trade_sim.mjs` spread ratio < 5x; still "all cities have a
profitable outbound route"; no item becomes NEVER PROFITABLE.

**Test first.** Assertion in the balance test: parse the top-route table and
assert `bestRoute.profitPerDay / worstProfitable.profitPerDay < 5`.

### 4. Guard item diversity so no good is dead weight — P2

**Problem.** Once the dominant lane is nerfed, the risk is over-correcting an item
into "never profitable" (the sim already flags this class of issue).

**Fix.** After the item-3 nudges, confirm every one of the six trade goods still
has ≥ 1 positive cross-city route, and at least three have a top route within 2x
of the best. Tune multipliers until true.

**Acceptance.** `trade_sim.mjs` "Item max cross-city profit" list shows all six
items with a positive max and no ⚠️.

**Test first.** Extend the balance test to assert each item's max cross-city
profit > 0.

---

## P3 — Lock it in

### 5. Add a standing balance-regression test — P2

**Problem.** Nothing today fails CI when the economy tips back into net-negative;
`trade_sim.mjs` always exits 0 and only prints. A future price tweak could silently
re-break solvency.

**Fix.** Promote the assertions from items 1/3/4 into a real test file wired into
`npm run test:unit` (add to `.github/workflows/test.yml`'s unit job). It must be
fully offline and deterministic (fixed seed, no `Date.now`/`Math.random`).

**Acceptance.** `npm run test:unit` runs the balance regression and fails if any
strategy goes net-negative or the spread ratio ≥ 5x.

**Test first.** The test file *is* the deliverable — write the failing assertions
against today's bankrupt numbers, then implement P1–P4 until green.

---

## Suggested order

1. Item 5 scaffold (write the failing balance test) — defines "done" for the rest.
2. Item 1 (tax/upkeep) → strategies go green.
3. Item 3 → item 4 (compress spread, protect diversity).
4. Item 2 (remove the gold-floor band-aid) last, once merit-solvency holds.

Each item is one commit. Items touching `src/main.js` bump the version. Run
`/code-review` on the diff before reporting done (Review-before-done rule), then
re-run `economy_parity_test.mjs`, `trade_sim.mjs`, and `mining_report.mjs` to
confirm parity holds and mining is untouched.
