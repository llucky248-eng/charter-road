# Charter Road — Claude Code Memory

## Long-term goal

Charter Road is designed to be a **fully autonomous, self-running world simulation**. Markets, cities, AI traders, economy, events, hunger, and banking must operate without a human player present. This enables AI agents to play the game for testing, balance tuning, and emergent-behaviour research.

**Next headless milestone (not yet reached):** an AI agent can run a single local command (no browser, no remote DB) and receive a JSON economy report for N simulated game-days. This path does not yet exist — see below.

## Headless constraint

Every mechanic added must be expressible as a **deterministic function of world state**:
- No `prompt()` or modal-blocking UI required to advance the simulation
- No `Date.now()` in core game logic (pass time as a parameter)
- Player UI is a layer on top; the simulation layer beneath must be browser-free

Current headless infrastructure:
- `ops/scripts/world_service.mjs` — cron-style world ticker (**Supabase-backed**: requires `SUPABASE_URL` + `SUPABASE_KEY` env vars and network egress; cannot run in an offline container). Hardcoded anon key at line 13 — verify RLS is enabled on the Supabase project before treating this as safe to commit.
- `ops/scripts/trade_sim.mjs` — AI trader simulation (also Supabase-backed)
- `ops/scripts/qa_gameplay_sim.mjs` — automated player sim

**What's missing for the milestone:** an in-memory simulation path that accepts `--days N` and writes a JSON report without touching a remote DB. `world_service.mjs` would need a local-state mode (e.g. a JSON file as the state store) to get there.

## Test-first rule

Every feature must have a **failing test written before implementation** (red → green → ship).

**Test placement:**
| What to test | File |
|---|---|
| Pure logic (math, data transforms) | `ops/scripts/unit_tests.mjs` |
| Economy / balance / price curves | `ops/scripts/economy_parity_test.mjs` |
| UI / interaction / visual | `ops/scripts/qa_selftest.mjs` |

## Review-before-done rule

**Run `/code-review` on the current diff before reporting ANY task as done**, then
address the findings. This applies to every kind of change, not just game features:

- **Game logic** (`src/main.js`, economy, simulation) — also write the failing test first, then implement until green (see Test-first rule above)
- **Harness / ops / tooling** (`ops/scripts/**`, `.github/workflows/**`, `deploy.sh`, git hooks, `package.json`) — these have no game-logic test to catch regressions, so the review is the only safety net. Review with the same rigor as a feature.
- **Docs / config** (`CLAUDE.md`, `RUNBOOK.md`) — a lighter review still applies: check the claims are accurate and not stale.

The review is not optional and not a formality: if it surfaces a real issue, fix it before closing the task.

## Workflow quick reference

```
npm run setup        # install pre-commit version-guard hook (first time)
npm run smoke        # local smoke check (no python3 needed)
npm run deploy       # bump version + commit + push + verify Pages
npm run test:unit    # unit + parity tests only (fast, no browser)
npm run qa:selftest  # Playwright end-to-end
```

See `ops/RUNBOOK.md` for the full 8-step TDD loop and emergency rollback.

## Version source of truth

`NPC_DIAG_BUILD` in `src/main.js:37` is the authoritative version.
`ops/scripts/bump_version.mjs` updates all three locations atomically:
- `src/main.js` — `NPC_DIAG_BUILD` + `version:`
- `index.html` — `HTML build:` tag + dynamic loader fallback `'?v=X.Y.Z'`

Never edit versions manually.
