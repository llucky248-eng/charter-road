# Charter Road — Claude Code Memory

## Long-term goal

Charter Road is designed to be a **fully autonomous, self-running world simulation**. Markets, cities, AI traders, economy, events, hunger, and banking must operate without a human player present. This enables AI agents to play the game for testing, balance tuning, and emergent-behaviour research.

**Next headless milestone:** an AI agent can run `node ops/scripts/world_service.mjs --days 30` and receive a JSON economy report — no browser required.

## Headless constraint

Every mechanic added must be expressible as a **deterministic function of world state**:
- No `prompt()` or modal-blocking UI required to advance the simulation
- No `Date.now()` in core game logic (pass time as a parameter)
- Player UI is a layer on top; the simulation layer beneath must be browser-free

Current headless infrastructure:
- `ops/scripts/world_service.mjs` — cron-style world ticker
- `ops/scripts/trade_sim.mjs` — AI trader simulation
- `ops/scripts/qa_gameplay_sim.mjs` — automated player sim

## Test-first rule

Every feature must have a **failing test written before implementation** (red → green → ship).

**Test placement:**
| What to test | File |
|---|---|
| Pure logic (math, data transforms) | `ops/scripts/unit_tests.mjs` |
| Economy / balance / price curves | `ops/scripts/economy_parity_test.mjs` |
| UI / interaction / visual | `ops/scripts/qa_selftest.mjs` |

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
