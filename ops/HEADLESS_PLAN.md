# Headless Simulation — Implementation Plan

_Context file. If the session is lost, resume from the last checked-off step._

---

## Long-term goal (from CLAUDE.md)

Charter Road must be a **fully autonomous, self-running world simulation** — markets,
cities, AI traders, economy, events, hunger, and banking — operating **without a human
player and without a browser**.

This enables AI agents to play the game for testing, balance tuning, and emergent-
behaviour research.

---

## Milestone target

> An AI agent runs a single local command (no browser, no remote DB) and receives a
> JSON economy report for N simulated game-days.

Command shape:
```
node ops/scripts/headless_sim.mjs --days 30 --out report.json
```

Output shape (one JSON file):
```json
{
  "days": 30,
  "final_day": 30,
  "cities": { "<cityId>": { "gold", "population", "hunger", "bank_reserve", "buildings" } },
  "traders": [ { "id", "name", "gold", "trips_completed", "profit_history" } ],
  "events": [ { "type", "city", "item", "start_day", "end_day" } ],
  "contracts": { "<cityId>": [ { "item", "qty", "reward", "expires" } ] },
  "market_drift": { "<cityId>": { "<itemId>": <multiplier> } },
  "trade_log": [ { "day", "trader", "city", "item", "qty", "gold", "action" } ]
}
```

---

## Architecture overview

```
world_service.mjs          (current — Supabase only)
  └─ loadWorldState()        → fetch from DB
  └─ fetchTraders()          → fetch from DB
  └─ tickTrader() × 6        → pure logic ✓
  └─ tickMarketDrift()       → pure logic ✓
  └─ tickHunger()            → pure logic ✓
  └─ tickBankSolvency()      → pure logic ✓
  └─ generateWorldEvents()   → pure logic ✓
  └─ regenerateContracts()   → pure logic ✓
  └─ save*()                 → upsert to DB

headless_sim.mjs            (to be built)
  └─ parseArgs(argv)         → { days, outPath, seedState }
  └─ loadState(jsonPath?)    → in-memory object (or fresh defaults)
  └─ for day 1..N:
  |    tick()                → calls all pure tick functions
  |    appendTradeLog()      → accumulates events
  └─ writeReport(outPath)    → JSON file
```

All pure tick functions are **already deterministic** (no Date.now(), seeded RNG).
The only work is **wiring them together without Supabase**.

---

## What already exists (reuse, don't re-implement)

| Symbol | File | Status |
|---|---|---|
| `ITEMS`, `CITIES`, `CITY_MULTS`, `SPREAD` | world_service.mjs | Exported ✓ |
| `CITY_FOOD_RULES`, `GEAR_TIERS`, `TRADER_DEFS` | world_service.mjs | Exported ✓ |
| `seeded01`, `citySeed`, `dayWobble` | world_service.mjs | Exported ✓ |
| `midPriceFor`, `buyPrice`, `sellPrice` | world_service.mjs | Exported ✓ |
| `tickMarketDrift` | world_service.mjs | Internal — needs export |
| `tickHunger` | world_service.mjs | Internal — needs export |
| `tickBankSolvency` | world_service.mjs | Internal — needs export |
| `generateWorldEvents` | world_service.mjs | Internal — needs export |
| `regenerateContracts` | world_service.mjs | Internal — needs export |
| `tickTrader` | world_service.mjs | Internal — needs export |
| `initDefaultState` | (missing) | New — initialize world state |

---

## Implementation steps

Each step = one failing test + implementation + `/code-review`. Never skip tests.

---

### STEP 1 — Export tick functions from world_service.mjs

**What:** Add the internal tick functions to the module's export block so
`headless_sim.mjs` can import them without duplicating code.

**Functions to export:**
- `tickMarketDrift(worldState, cities)`
- `tickHunger(cityTreasuries, worldState)`
- `tickBankSolvency(cityTreasuries, worldState)`
- `generateWorldEvents(worldState)`
- `regenerateContracts(worldState, day)`
- `tickTrader(trader, worldState, cityTreasuries, tradeLog)`

**Test file:** `ops/scripts/unit_tests.mjs`
**Test:** Import each function from world_service.mjs and assert it exists and is callable.

**Files changed:** `ops/scripts/world_service.mjs`
**Status:** [ ] not started

---

### STEP 2 — Pure default-state initializer

**What:** Add an exported `initDefaultState()` function to `world_service.mjs` that
returns a fresh, valid in-memory world state (no DB required).

```js
// Returns { worldState, cityTreasuries, traders, marketDrift, contractBoards }
export function initDefaultState(seed = 42) { ... }
```

Uses existing `TRADER_DEFS`, `CITIES`, `CITY_FOOD_RULES`, `GEAR_TIERS`.
Sets day=1, frac=0, hunger=0, bank_reserve=starting amount, empty events/drift.

**Test file:** `ops/scripts/unit_tests.mjs`
**Test:** `initDefaultState()` returns an object with all required keys; traders have
names and start positions; each city has non-null treasury fields.

**Files changed:** `ops/scripts/world_service.mjs`
**Status:** [ ] not started

---

### STEP 3 — Single deterministic tick function

**What:** Add an exported `tickWorld(state, tradeLog)` function to `world_service.mjs`
that runs one full simulation step (one cron-tick worth of in-game time) on a plain
JS object, mutates it in-place, and returns it. No Supabase calls.

```js
export function tickWorld(state, tradeLog = []) {
  // state = { worldState, cityTreasuries, traders, marketDrift, contractBoards }
  // advances state by TICK_SECONDS (300s) of in-game time
  // appends { day, trader, city, item, qty, gold, action } to tradeLog
  return state;
}
```

**Test file:** `ops/scripts/unit_tests.mjs`
**Test:** Call `tickWorld(initDefaultState())` 10 times; assert day advances, traders
move (gold changes), no exception thrown.

**Files changed:** `ops/scripts/world_service.mjs`
**Status:** [ ] not started

---

### STEP 4 — Day-loop helper

**What:** Add an exported `simulateDays(n, initialState?)` function in a new file
`ops/scripts/headless_sim.mjs`. Calls `tickWorld()` enough times to advance N
game-days (1 day = 288 ticks × 300s), returns final state + trade log.

```js
export async function simulateDays(n, initialState = null) {
  const state = initialState ?? initDefaultState();
  const tradeLog = [];
  const TICKS_PER_DAY = 288; // 86400s / 300s
  for (let i = 0; i < n * TICKS_PER_DAY; i++) tickWorld(state, tradeLog);
  return { state, tradeLog };
}
```

**Test file:** `ops/scripts/unit_tests.mjs`
**Test:** `simulateDays(2)` returns state where `worldState.day === 2` (or 3 depending
on tick count math). Assert trade log is non-empty.

**Files changed:** `ops/scripts/headless_sim.mjs` (new file)
**Status:** [ ] not started

---

### STEP 5 — JSON report serializer

**What:** Add an exported `buildReport(days, state, tradeLog)` function in
`ops/scripts/headless_sim.mjs` that returns the flat JSON report object described in
the milestone target above.

**Test file:** `ops/scripts/unit_tests.mjs`
**Test:** `buildReport(3, state, tradeLog)` returns an object with keys `days`,
`final_day`, `cities`, `traders`, `events`, `contracts`, `market_drift`, `trade_log`.
Assert `cities` has entries for all 4 cities; `traders` has ≥1 entry.

**Files changed:** `ops/scripts/headless_sim.mjs`
**Status:** [ ] not started

---

### STEP 6 — CLI entry point

**What:** Add a `main()` guard at the bottom of `ops/scripts/headless_sim.mjs` so it
can be run directly:

```
node ops/scripts/headless_sim.mjs --days 30
node ops/scripts/headless_sim.mjs --days 30 --out ops/artifacts/report.json
node ops/scripts/headless_sim.mjs --days 30 --seed-state ops/artifacts/state.json
```

Print report to stdout (pretty JSON) or write to `--out` path.

**Test file:** `ops/scripts/unit_tests.mjs`
**Test:** `parseArgs(['--days','5','--out','report.json'])` returns
`{ days: 5, outPath: 'report.json', seedStatePath: null }`.

**Files changed:** `ops/scripts/headless_sim.mjs`
**Status:** [ ] not started

---

### STEP 7 — Smoke integration test

**What:** Add a test to `ops/scripts/unit_tests.mjs` that runs the full pipeline
end-to-end: `simulateDays(3)` → `buildReport()` → validate report schema. This is the
acceptance test for the milestone.

**Test file:** `ops/scripts/unit_tests.mjs`
**Test (acceptance):** Run 3-day simulation; verify report JSON schema; assert no
NaN/Infinity in numeric fields; assert hunger > 0 for at least one city; assert at
least one trade event in trade_log.

**Files changed:** `ops/scripts/unit_tests.mjs`
**Status:** [ ] not started

---

### STEP 8 — Economy parity

**What:** Extend `ops/scripts/economy_parity_test.mjs` to also validate that price
outputs from the headless simulation match what `src/main.js` would calculate for the
same inputs (day=1, no events, no drift). This prevents the simulation from silently
diverging from the game client.

**Test file:** `ops/scripts/economy_parity_test.mjs`
**Test:** For each city × item, compare `midPriceFor(cityId, item, state)` from
`world_service.mjs` against the same formula extracted from `src/main.js`. Assert
all prices are within 0.01% of each other.

**Files changed:** `ops/scripts/economy_parity_test.mjs`
**Status:** [ ] not started

---

### STEP 9 — Wire into npm scripts

**What:** Add convenience scripts to `package.json`:
```json
"sim:headless": "node ops/scripts/headless_sim.mjs --days 30",
"sim:report":   "node ops/scripts/headless_sim.mjs --days 30 --out ops/artifacts/latest_report.json"
```

Also verify `npm run test:unit` still runs the new unit tests (it should, they're in
the same file).

**Files changed:** `package.json`
**Status:** [ ] not started

---

## Constraints to respect throughout

- No `Date.now()` in tick logic — pass time as parameter or counter
- No `prompt()` or any browser-only API
- No Supabase calls in headless path (import only pure exports from world_service.mjs)
- Every step: failing test first, then implementation, then `/code-review`
- Never edit version numbers manually — use `bump_version.mjs`

---

## Files to touch (summary)

| File | Change |
|---|---|
| `ops/scripts/world_service.mjs` | Export tick functions + `initDefaultState` + `tickWorld` |
| `ops/scripts/headless_sim.mjs` | New — `simulateDays`, `buildReport`, CLI main() |
| `ops/scripts/unit_tests.mjs` | New tests for each step |
| `ops/scripts/economy_parity_test.mjs` | Extend with headless price parity check |
| `package.json` | Add sim:headless + sim:report scripts |

---

## Resume checklist

```
[ ] Step 1 — Export tick functions
[ ] Step 2 — initDefaultState()
[ ] Step 3 — tickWorld()
[ ] Step 4 — simulateDays()
[ ] Step 5 — buildReport()
[ ] Step 6 — CLI parseArgs + main()
[ ] Step 7 — Smoke integration test (acceptance)
[ ] Step 8 — Economy parity extension
[ ] Step 9 — npm script wiring
```
