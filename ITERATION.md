# Iteration Log — The Charter Road

## v0.0.89 — 2026-02-21
- QA: added `window.__QA.api` to make autosave tests deterministic (no 2s waits).
- QA: now verifies autosave triggers for buy/sell/travel and persists expected state.
- Travel: upkeep now applies per day when multiple travel days elapse at once.

## v0.0.88 — 2026-02-21
- Save/Load: added save schema versioning (`saveVersion`) + migration from legacy saves.
- Save/Load: added validation + clearer load failure toasts (corrupt/incompatible save).
- QA: expanded `?qa=1` harness to cover save missing/malformed/partial cases.

## v0.0.87 — 2026-02-21
- Code style: fixed a stray unindented comment near pointer events (no functional change).

## v0.0.86 — 2026-02-20
- HUD: desktop Save/Load buttons added (mouse/touchpad friendly).
- HUD: shows last saved day after saving.

## v0.0.85 — 2026-02-20
- Save/Load: localStorage-based persistence (Ctrl/Cmd+S save, Ctrl/Cmd+L load).
- Auto-save: after buying, selling, and travel day advancement.
- Persists: player state (gold, inv, position, rep, permits), time (day, frac, seed), market drift, active contract.
- QA: added `QA_URL` env var support for flexible test URLs.

## v0.0.84 — 2026-02-19
- Cleanup: removed unused `max()` helper from `src/main.js` (use `Math.max` directly).


## v0.0.83 — 2026-02-18
- Travel time: moving on roads consumes days (~1 day per 1200px travel).
- Upkeep: each day consumes 1 rations; if none, pay 3g penalty.
- Market drift: prices drift slightly per day per city/item (+/-2% daily, clamped 0.85-1.20x).
- Road events: added Good Omen (+5-12g instant) and Merchant Escort (+8g choice).
- Deterministic PRNG for drift/events (seeded, reproducible for testing).
- Cleanup: fixed inconsistent indentation in `src/main.js` (no functional change).

## v0.0.77 — 2026-02-16
- Fix: `ellipsizeText` used `max()` (non-existent) instead of `Math.max()`, which could crash HUD text rendering in edge cases.
