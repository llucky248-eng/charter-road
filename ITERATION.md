# Iteration Log — The Charter Road

## v0.0.103 — 2026-03-01
- Fix: allow movement to escape NPC overlap (no lockups).
- Collision: auto-extends ghost window if still overlapping.

## v0.0.102 — 2026-03-01
- Fix: NPC talk sets a short ghost window so movement never locks.
- Safety: bubble render guarded to avoid crash on mobile.
- QA: added ghost-cooldown assertion after NPC talk.

## v0.0.101 — 2026-03-01
- Fix: interacting with NPCs no longer traps the player (auto nudge away).
- Collision: resolves player/NPC overlap after movement.
- QA: added overlap assertion after NPC talk.

## v0.0.100 — 2026-03-01
- Mobile: NPC speech bubbles now clamp to screen + HUD (readable on phones).
- Bubble text: single-line ellipsize for small screens.
- QA: added mobile bubble bounds checks.

## v0.0.99 — 2026-03-01
- City Hub: added 3 walking NPCs per city (wander + collision + distinct silhouettes).
- Interaction: press E near a local to show a speech bubble.
- QA: deterministic tests for NPC walkers + bubble lifecycle.

## v0.0.98 — 2026-03-01
- City Hub: added NPC chatter panel (3 locals per city, rotates lines).
- Dialogue: loads from static assets/npc_dialogue.json (no runtime API calls).
- QA: extended deterministic ?qa=1 self-test for NPC dialogue cache invariants.

## v0.0.90 — 2026-02-21
- HUD: added brief “Saved (Day X)” toast when saves complete (autosave + manual save).
- Fix: removed accidental `window.__BOOT_OK` stray injection inside HUD layout calc.

## v0.0.97 — 2026-02-27
- Market: added “Rumors” (price intel) to the Market header (2 lines per city, always true).
- UI: tweaked Rumors spacing/typography for small screens (better legibility).
- QA: added deterministic rumor checks (stable same day/seed; changes when day advances).

## v0.0.95 — 2026-02-26
- Contracts UI: added a completion banner (stacks, max 3) with reward details.
- Contracts: completion now triggers an animated top banner; auto-dismisses after a short time.
- QA: extended deterministic contract completion QA to assert banner appears and auto-dismisses.

## v0.0.93 — 2026-02-25
- Map: added a branching detour road route (time vs profit).
- POI: added hidden cache tiles (single-use) with rewards/costs; persists via Save/Load.
- QA: deterministic cache tests (single-use + persistence).

## v0.0.91 — 2026-02-22
- Contracts: rep tiers now gate which jobs appear (T0<3, T1 3–6, T2 7+), with [T0]/[T1]/[T2] tags.
- Contracts: reward scales with tier + reputation, and city permit gives +10% payout bonus.
- QA: added deterministic checks for tier visibility and permit reward bonus.

## v0.0.90 — 2026-02-21
- Contracts: auto-complete on entering destination city (deliver goods, gain gold + rep, clear contract, autosave).
- QA: added deterministic contract completion tests via `__QA.api`.

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
