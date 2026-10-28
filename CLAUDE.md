# Charter Road — Claude Code Memory

## Long-term goal

Charter Road is designed to be a **fully autonomous, self-running world simulation**. Markets, cities, AI traders, economy, events, hunger, and banking must operate without a human player present. This enables AI agents to play the game for testing, balance tuning, and emergent-behaviour research.

**Next headless milestone (partially reached):** an AI agent can run a single local command (no browser, no remote DB) and receive a JSON economy report for N simulated game-days. Deterministic slices exist for the **mining economy** — `npm run mining:report -- --days N` (pure `ops/scripts/lib/mining.mjs`) — and for **AI traders with market-pressure feedback** — `npm run traders:report -- --days N` (`simulateTraders` in `world_service.mjs`). Hunger, banking and events still need an offline path — see below.

## Headless constraint

Every mechanic added must be expressible as a **deterministic function of world state**:
- No `prompt()` or modal-blocking UI required to advance the simulation
- No `Date.now()` in core game logic (pass time as a parameter)
- Player UI is a layer on top; the simulation layer beneath must be browser-free

Current headless infrastructure:
- `ops/scripts/world_service.mjs` — cron-style world ticker (**Supabase-backed**: requires `SUPABASE_URL` + `SUPABASE_KEY` env vars and network egress; cannot run in an offline container). Hardcoded anon key (the `SUPABASE_KEY` default near the top of the file) — verify RLS is enabled on the Supabase project before treating this as safe to commit.
- `ops/scripts/trade_sim.mjs` — AI trader simulation (also Supabase-backed)
- `ops/scripts/qa_gameplay_sim.mjs` — automated player sim

**What's missing for the milestone:** a *whole-world* in-memory simulation path that accepts `--days N` and writes a JSON report without touching a remote DB. **Mining** (`mining_report.mjs`) and **AI traders** (`trader_report.mjs`, including market pressure via `aggregatePressure`, the offline mirror of SQL `aggregate_economy`) already do this offline. Hunger, banking and events would need `world_service.mjs` to gain a local-state mode too.

## Test-first rule

Every feature must have a **failing test written before implementation** (red → green → ship).

**Test placement:**
| What to test | File |
|---|---|
| Pure logic (math, data transforms) | `ops/scripts/unit_tests.mjs` |
| Economy / balance / price curves | `ops/scripts/economy_parity_test.mjs` |
| Mining sim (sites, metal variants, rarity pricing, production, shipping) | `ops/scripts/mining_tests.mjs` |
| 3D renderer pure helpers (ground/prop mapping, camera rig, sun, building specs) | `ops/scripts/world3d_tests.mjs` |
| AI trader brain (route picking, seeded RNG, `tickTrader` determinism) | `ops/scripts/trader_tests.mjs` |
| UI / interaction / visual | `ops/scripts/qa_selftest.mjs` |

## Version-bump rule

**Any commit that touches `src/main.js` must include a version bump.** Run before staging:

```
node ops/scripts/bump_version.mjs +patch
git add src/main.js index.html
```

The pre-commit hook enforces this: it blocks if `src/main.js` is staged but the version hasn't changed from the last commit. `npm run deploy` calls `bump_version.mjs` automatically — use it for releases to main. For feature-branch commits, bump manually before `git add`.

## Review-before-done rule

**Run `/code-review` on the current diff before reporting ANY task as done**, then
address the findings. This applies to every kind of change, not just game features:

- **Game logic** (`src/main.js`, economy, simulation) — also write the failing test first, then implement until green (see Test-first rule above)
- **Harness / ops / tooling** (`ops/scripts/**`, `.github/workflows/**`, `deploy.sh`, git hooks, `package.json`) — these have no game-logic test to catch regressions, so the review is the only safety net. Review with the same rigor as a feature.
- **Docs / config** (`CLAUDE.md`, `RUNBOOK.md`) — a lighter review still applies: check the claims are accurate and not stale.

The review is not optional and not a formality: if it surfaces a real issue, fix it before closing the task.

## Harness

### Quick reference

```
npm run setup        # install pre-commit version-guard hook (one-time)
npm run smoke        # local smoke check — no Python, no browser
npm run test:unit    # unit + parity tests (fast, offline, no browser)
npm run qa:selftest  # Playwright end-to-end (desktop + mobile)
npm run qa:player-sim -- --steps 4000 --seed 7 --pretty  # autonomous bot; discovers stuck/balance/qol issues
npm run deploy       # bump version + commit + push + poll Pages live
```

See `ops/RUNBOOK.md` for the full 8-step TDD loop and emergency rollback.

### Local dev

| Script | What it does | Constraints |
|---|---|---|
| `ops/scripts/serve_local.sh` | Starts static HTTP server, writes PID to `.server.pid` | Requires Python 3; reads `PORT`/`HOST` env (defaults 8080 / 127.0.0.1) |
| `ops/scripts/kill_local_server.sh` | Kills server from `.server.pid` | Needs `.server.pid` to exist |
| `ops/scripts/smoke_local.sh` | Starts server, validates HTML build tag + loader match `src/main.js` version | Requires Python 3 + curl |
| `ops/scripts/smoke_local.mjs` | Same smoke check, embedded Node server | **Offline, no Python** — this is what `npm run smoke` calls |
| `ops/scripts/iterate.sh` | Bumps patch, runs smoke, prints next steps | Calls bump_version + smoke_local.mjs |

### Version management

| Script | What it does |
|---|---|
| `ops/scripts/bump_version.mjs` | Atomically updates version in `src/main.js` (`NPC_DIAG_BUILD`, `version:`) and `index.html` (`HTML build:`, `?v=` loader). Arg: `+patch` (default) or explicit `vX.Y.Z`. **Never edit versions manually.** |
| `ops/scripts/read_expected_version.mjs` | Reads current version from `src/main.js`, prints to stdout. Used by deploy pipeline. |

### Testing

| Script | What it does | Constraints |
|---|---|---|
| `ops/scripts/unit_tests.mjs` | Pure-function unit tests: hash, price, save validation/migration, DB mock, smoothing | **Fully offline, no browser** |
| `ops/scripts/economy_parity_test.mjs` | Validates client (`src/main.js`) and server (`world_service.mjs`) economy constants match | Imports `world_service.mjs`; offline but reads both files |
| `ops/scripts/mining_tests.mjs` | Mining redesign: 2 sites, metal variants, rarity-based pricing, NPC+player production, warehouse conservation, trader+player shipping, deterministic report | Imports `lib/mining.mjs`; **fully offline, no browser** |
| `ops/scripts/player_sim_tests.mjs` | Unit tests for the autonomous player-sim brain (`lib/player_ai.mjs`): `decideAction` policy + `detectStuck`/`detectBalance`/`detectQoL` detectors | Imports `lib/player_ai.mjs`; **fully offline, no browser** |
| `ops/scripts/balance_regression_test.mjs` | Economy health guardrails on the **real** `world_service` model (neutralised drift/events/pressure): no dead trade goods, item-lane dominance <5×, ≥3 goods within 2× of the top lane, focused trader net-positive over 30 days. Fails CI if a price tweak re-breaks route balance. | Imports `world_service.mjs`; **fully offline, no browser** |
| `ops/scripts/trader_tests.mjs` | AI trader brain: seeded RNG, `decideRoute` personalities, a multi-tick `tickTrader` run that must replay identically with `Math.random`/`Date` trapped, a guard that route picking exists only in `src/sim/trader_core.js`, and `simulateTraders` checks (replay, report shape, everyone trades, diversity guardrail: ≥6 items, top item ≤40%, HHI ≤0.25 over 30 days, ≤10% empty-cart trips over 30 days, every trader richer after 120 days with no rescues, upgrade reserve, module state restored, CLI output; `aggregatePressure` behaviour + SQL constant parity; pressure builds and replays deterministically) | **Fully offline, no browser** |
| `ops/scripts/world3d_tests.mjs` | Pure helpers of the three.js renderer (`src/world3d_core.js`): tile→ground/prop mapping, camera rig framing, sun arc, building palette parity with `main.js`, renderer preference | **Fully offline, no browser** (loads the module via a `data:` import) |
| `ops/scripts/qa_selftest.mjs` | Playwright: desktop (1280×720) + mobile (iPhone 12), waits for `window.__QA.status='pass'`. Also `renderer-3d` (3D boots on SwiftShader, non-blank frame, w2s↔s2w round trip, real click paths to the clicked tile) and `renderer-2d-optout` (`?r=2d`) | Requires Playwright + chromium; auto-starts server on port 8080; `QA_URL` env overrides |
| `ops/scripts/qa_city_walk.mjs` | Teleports player into cities, performs random click-move sequences, checks bounds | Requires Playwright + `window.__QA.api` |
| `ops/scripts/qa_gameplay_sim.mjs` | Measures trade cycles to reach endgame (gear maxed + rep 7 + 500g) | Requires Playwright + `window.__QA.api` |
| `ops/scripts/qa_mobile_dialog_layout.mjs` | Checks modal proportions on iPhone 12; saves screenshots to `ops/screenshots/` | Requires Playwright |
| `ops/scripts/qa_player_speed.mjs` | Verifies player move speed ≈90 px/sec ±20%, faster than fastest trader | Requires Playwright |
| `ops/scripts/qa_player_sim.mjs` | **Autonomous player simulation for issue discovery.** Plays the real game like a human through `window.__QA.api` — walks city-to-city with the game's A* auto-nav, reads live market prices off the DOM, trades on margin, mines to recover when broke, buys gear when flush — while detectors flag **stuck** (auto-nav freezes, economic softlock), **balance** (negative gold, runaway wealth, bankruptcy), and **qol** (dead-click loops, event theme-integrity) issues. Emits a grouped findings report; exits non-zero on any high-severity find. `npm run qa:player-sim -- --steps 4000 --seed 7 [--pretty] [--json]`. Decision/detector logic is the offline-tested `lib/player_ai.mjs`. | Requires Playwright + `window.__QA.api`; auto-starts server on 8080; `QA_URL`/argv override; `PW_EXECUTABLE_PATH` env picks a pre-provisioned browser |
| `ops/scripts/lib/player_ai.mjs` | Pure brain for the player-sim: `decideAction(obs)` (human-greedy trade/mine/gear policy), `detectStuck`/`detectBalance`/`detectQoL`/`runDetectors`, and `ITEM_ORDER`/`CITIES` mirrored from `src/main.js`. Deterministic; no browser. | **Fully offline** — unit-tested by `player_sim_tests.mjs` |

### Deploy pipeline

| Script | What it does | Constraints |
|---|---|---|
| `ops/scripts/deploy.sh` | `bump_version` → commit → `git push -u origin <branch>` (3-retry backoff) → poll `pages_check` up to 90s | Requires network + git push access |
| `ops/scripts/pages_check.mjs` | Fetches live GitHub Pages, validates version in HTML build tag + loader. Arg: version string (required). | Requires network; queries `https://llucky248-eng.github.io/charter-road/` |
| `ops/scripts/screenshot_pages.mjs` | Takes desktop + mobile screenshots of live Pages → `ops/artifacts/v<version>/` | Requires Playwright + network; arg: version string (required) |

### Mining simulation (offline, deterministic)

The redesigned mining economy is a pure function of world state — no browser, no DB.

| Script | What it does | Constraints |
|---|---|---|
| `ops/scripts/lib/mining.mjs` | Pure module: 2 mining sites (`MINE_SITES`), metal variants (`METALS`: copper/silver) with rarity-based prices, per-city multipliers (`METAL_CITY_MULTS`), NPC+player production, trader+player shipping, and `simulateMiningEconomy({days,seed,player})`. **Pricing + site constants mirror `src/main.js` + `world_service.mjs`. `mining_tests.mjs` checks `mining.mjs` against `world_service.mjs` (metal prices) and `src/main.js` (site coords/hubs); `economy_parity_test.mjs` checks `main.js`↔`world_service`. Edit all copies together.** | **Fully offline; no `Date.now`/`Math.random`** |
| `ops/scripts/mining_report.mjs` | Headless `--days N` JSON economy report. `npm run mining:report -- --days 30 --seed 7 [--pretty] [--player <siteId> --swings K --ships K]` | **Fully offline, no browser** |

In the live game (`src/main.js`): the two sites are carved onto the map as taggable
ore veins, `playerMineNode` drops the site's metal variant, and copper/silver are
real market goods (cheapest at their hub city, dearer elsewhere) so server traders
and the player both ship them for profit.

### 3D world renderer (three.js)

The world (terrain, walls, buildings, trees, water, carriages, characters) is drawn by
three.js; the HUD, minimap and menus stay on the 2D canvas, which sits transparent on top.

| File | What it does |
|---|---|
| `src/world3d.js` | ES module, dynamically imported by `main.js` (`boot3D`). `createWorld3D(host, core)` (main.js passes the `?v=`-versioned `world3d_core.js`, so there is one copy per build) → `{render(frame), project, projectBillboard, unproject, stats, dispose}`. Ground is painted lazily per 32×32-tile chunk **with `main.js`'s own `drawTile` art**; walls/trees/hills are instanced props; buildings come from `cityBuildings` slots; people are cel-shaded 3D characters built from `characterParts` (other online players are still billboards). |
| `src/world3d_core.js` | Pure helpers (no three/DOM) — unit-tested by `world3d_tests.mjs`. City life is planned here too: `findTileRooms` (walled rooms that aren't slots, e.g. the bank → real 3D buildings), `planCityDecor` (lamps, fountain, stalls, benches, trees, flowers, crates, pennants — never on roads/gates/footprints/door steps), `townsfolkRoutes`/`walkerAt` (decorative walkers on city roads; not tappable, not game entities). `characterParts(look)` is the one 3D character rig for the player, NPCs and townsfolk (same body/size for everyone; hats per role; merchant kit only for the player) — `main.js` sends looks (`_playerChibiOpts`, `_NPC_STYLE_OPTS`), not painters. In 2D both are drawn at the shared `FIGURE_SCALE`. The overworld is dressed here too, visual only (the tile map is never changed): `terrainCategory`/`terrainColor`/`vnoise` drive the organic ground painter (wilderness painted per pixel with noise-blended borders; city tiles keep `drawTile` art), `hillDepthMap`/`cornerHeight` raise hill ranges into terrain (corners touching any walkable tile stay at 0, so nothing walkable changes height), `bridgeAt` finds river crossings, `wildDecorFor` places wilderness props (fields, reeds, lilies, forest-edge trees, pines, knolls, boulders, rare windmills). `carriageStruggle(kind, t)` makes the 3D carriage sink and rock in swamp and lurch in forest (main.js sends `frame.player.struggle`; the 2D overlay adds the mud/leaf particles). Building palette, ore colours and carriage `HORSE_PAL`/`WAGON_PAL` mirror `main.js` (tests enforce parity — edit both together). |
| `vendor/three/r170/three.module.min.js` | three.js r170, vendored (no CDN at runtime). The revision is in the path so an upgrade is a new URL — put a new version in a new folder. |

Rules: world-anchored overlays and tap input must go through `w2s`/`w2sLift`/`s2w` in `main.js`,
never `x - camera.x`, or they drift in 3D. `?r=2d` opts out (remembered in `localStorage`
`cr_renderer`; `?r=3d` restores); missing WebGL2 or a runtime three.js error falls back to 2D.
`__QA.renderer()` reports `pending|active|off|failed` + scene stats. Keep `#world3d`, `#game` and `#ui-root`
without z-index: as positioned siblings they stack in DOM order, so HTML dialogs stay clickable
(`renderer-3d` QA checks this). CI syntax-checks these modules (and `src/sim/trader_core.js`) with `node --input-type=module --check`.

### AI trader brain (shared, deterministic)

| File | What it does |
|---|---|
| `src/sim/trader_core.js` | The one route-picker for AI traders (`decideRoute` with aggressive / cautious / opportunist personalities, optional `crowd` anti-herding filter — only the browser fallback passes it today). Routes are scored in **gold per minute** (travel + mean city rest) with units capped by the trader's `gold`, so traders never pick cargo they can't afford. Also `ROUTE_SECONDS`/`routeSeconds` (the one travel-time table), `makeRng`/`hashSeed`/`traderRng` (seeded RNG) and `cityDwellSeconds`. Pure: callers pass prices, market pressure and an rng in. Used by `world_service.mjs` (real routes) and by `main.js`'s offline fallback (dynamic `import`, `?v=`-versioned; until it loads the fallback waits, and the QA trader check awaits `TRADER_CORE_READY`). `src/sim/package.json` marks the folder as ES modules so Node can import it. |
| `ops/scripts/trader_report.mjs` | Headless `--days N` JSON trader report: per-trader gold/profit/trips/gear, item trip shares, top routes, diversity (`distinctItems`, `topItemShare`, `hhi` — loaded trips only), stranded `rescues` and `emptyTrips` per trader. `npm run traders:report -- --days 30 --seed 7 [--pretty] [--no-pressure]`. Wraps `simulateTraders({days, seed, pressure})` in `world_service.mjs`: neutral start (no events/pressure/drift/discount), 90 simulated seconds per game-day, module state restored afterwards. Market pressure is on by default: every 300 simulated seconds (the live world-cron cadence; browsers also trigger it about hourly, which offline ignores) trade events are folded in by `aggregatePressure` — a pure mirror of SQL `aggregate_economy()` in `ops/supabase_schema.sql` (constants in `PRESSURE_AGG`; `trader_tests` checks them against the SQL). The report's `market` block gives the pressure range. The trader health guardrails in `trader_tests` run with `pressure: false` (base economy). |

Gear upgrades (`tryGearUpgrade`) require cost + `upgradeReserve(tier)` — enough gold left to fill the new cart with the cheapest goods — so an upgrade never strands a trader.

`world_service.mjs`'s `tickTrader(t, elapsed, { nowIso, peers })` is exported and deterministic: random choices come from `traderRng` (world seed + day + trader id + trip count), timestamps from `nowIso`, and `main()` is the only place that reads the clock. Other world systems (events, treasury) still use `Math.random`/`new Date()`.

### Simulation (Supabase-backed — requires network)

These scripts **cannot run in an offline container**. All require `SUPABASE_URL` + `SUPABASE_KEY` env vars.

| Script | What it does |
|---|---|
| `ops/scripts/world_service.mjs` | Cron world ticker: ticks AI traders, market drift, hunger, bank solvency, events, contracts. Exports economy constants consumed by `economy_parity_test.mjs`. **Hardcoded anon key (`SUPABASE_KEY` default near the top of the file) — confirm RLS is on before committing.** Run once with `RESET_TRADERS=1` (or `--reset-traders`) to re-seed every AI trader to a fresh state (`makeSeedTrader`) — use after an economy rebalance so traders re-learn routes instead of carrying stale gold/gear/strategy state. |
| `ops/scripts/trade_sim.mjs` | Tests trading strategies over N days, finds profitable routes, flags balance issues. Mirrors trade-goods economy from `src/main.js`; dominance verdict uses the same item-lane metric as `balance_regression_test.mjs`. |

### Code generation (optional network)

| Script | What it does | Constraints |
|---|---|---|
| `ops/scripts/generate_npc_dialogue.mjs` | Generates `assets/npc_dialogue.json` via OpenAI API; falls back to hardcoded lines if no key. Args: `--date YYYY-MM-DD`, `--out <path>`. | `OPENAI_API_KEY` env optional; `NPC_MODEL` env (default `gpt-5.2-mini`) |

### CI workflows

| File | Triggers | Jobs |
|---|---|---|
| `.github/workflows/test.yml` | `push` (all branches), `pull_request` | **test**: Node 24, lint + `npm run test:unit`; **enforce-test-first**: PR-only, blocks merge if `src/main.js` changed without touching a test file; **qa**: PR + main, Playwright chromium |
| `.github/workflows/world-sim.yml` | Cron every 5 min + manual dispatch | **tick**: runs `world_service.mjs` with Supabase secrets |

### Git hook

`ops/scripts/hooks/pre-commit` — blocks a commit where `src/main.js` is staged but `index.html` version doesn't match. Install once with `npm run setup`. Uses POSIX `sed` (works on macOS + Linux).

## Version source of truth

`NPC_DIAG_BUILD` in `src/main.js` is the authoritative version.
`ops/scripts/bump_version.mjs` updates all three locations atomically:
- `src/main.js` — `NPC_DIAG_BUILD` + `version:`
- `index.html` — `HTML build:` tag + dynamic loader fallback `'?v=X.Y.Z'`

Never edit versions manually.
