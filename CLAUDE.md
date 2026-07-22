# Charter Road — Claude Code Memory

## Long-term goal

Charter Road is designed to be a **fully autonomous, self-running world simulation**. Markets, cities, AI traders, economy, events, hunger, and banking must operate without a human player present. This enables AI agents to play the game for testing, balance tuning, and emergent-behaviour research.

**Next headless milestone (partially reached):** an AI agent can run a single local command (no browser, no remote DB) and receive a JSON economy report for N simulated game-days. A first deterministic slice now exists for the **mining economy** — `npm run mining:report -- --days N` (built on the pure `ops/scripts/lib/mining.mjs` module). The full world economy (traders, hunger, banking in `world_service.mjs`) still needs an offline local-state path — see below.

## Headless constraint

Every mechanic added must be expressible as a **deterministic function of world state**:
- No `prompt()` or modal-blocking UI required to advance the simulation
- No `Date.now()` in core game logic (pass time as a parameter)
- Player UI is a layer on top; the simulation layer beneath must be browser-free

Current headless infrastructure:
- `ops/scripts/world_service.mjs` — cron-style world ticker (**Supabase-backed**: requires `SUPABASE_URL` + `SUPABASE_KEY` env vars and network egress; cannot run in an offline container). Hardcoded anon key (the `SUPABASE_KEY` default near the top of the file) — verify RLS is enabled on the Supabase project before treating this as safe to commit.
- `ops/scripts/trade_sim.mjs` — AI trader simulation (also Supabase-backed)
- `ops/scripts/qa_gameplay_sim.mjs` — automated player sim

**What's missing for the milestone:** a *whole-world* in-memory simulation path that accepts `--days N` and writes a JSON report without touching a remote DB. The **mining economy already does this** offline via `ops/scripts/mining_report.mjs`; bringing the rest along (traders, hunger, banking) would need `world_service.mjs` to gain a local-state mode (e.g. a JSON file as the state store).

## Test-first rule

Every feature must have a **failing test written before implementation** (red → green → ship).

**Test placement:**
| What to test | File |
|---|---|
| Pure logic (math, data transforms) | `ops/scripts/unit_tests.mjs` |
| Economy / balance / price curves | `ops/scripts/economy_parity_test.mjs` |
| Mining sim (sites, metal variants, rarity pricing, production, shipping) | `ops/scripts/mining_tests.mjs` |
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
| `ops/scripts/qa_selftest.mjs` | Playwright: desktop (1280×720) + mobile (iPhone 12), waits for `window.__QA.status='pass'` | Requires Playwright + chromium; auto-starts server on port 8080; `QA_URL` env overrides |
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

### Simulation (Supabase-backed — requires network)

These scripts **cannot run in an offline container**. All require `SUPABASE_URL` + `SUPABASE_KEY` env vars.

| Script | What it does |
|---|---|
| `ops/scripts/world_service.mjs` | Cron world ticker: ticks AI traders, market drift, hunger, bank solvency, events, contracts. Exports economy constants consumed by `economy_parity_test.mjs`. **Hardcoded anon key (`SUPABASE_KEY` default near the top of the file) — confirm RLS is on before committing.** |
| `ops/scripts/trade_sim.mjs` | Tests trading strategies over N days, finds profitable routes, flags balance issues |

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
