# Iteration Log — The Charter Road

## v0.2.1 — 2026-03-14
- Buildings: full pixel-art redraw for all city tile types.
- Market stall (tile 6): amber awning, display counter, colored goods, sign.
- Inn/Tavern (tile 7): timber-frame walls, thatched roof, animated warm window glow, door.
- Warehouse (tile 8 in city): stone blocks, flat slate roof, double loading doors.
- Camp (tile 8 on road): tent with door + animated campfire.
- Contracts board (tile 12): wooden post, parchment notices with text lines, official green seal.
- City floor (tile 4): cobblestone with mortar grid lines and stone highlights.
- Cobblestone plaza (tile 9): 3×3 large-block pattern with individual stone shading.
- Stone wall (tile 3): battlements on top edge, horizontal mortar, block highlights.
- Gate (tile 5): stone arch with portcullis bars and dark passage.

## v0.2.0 — 2026-03-14
- **Rebrand**: "The Charter Road" → "The Amber Road".
- **4 cities** (was 2): Valdenmere (large capital), Ashport (port), Crosshaven (small crossroads), Ironholt (mining town).
- **Different city sizes**: Valdenmere 28×20, Ashport 24×16, Crosshaven 14×10, Ironholt 20×14.
- **More buildings per city**: inn/tavern (tile 7), warehouse (tile 8), cobblestone variety (tile 9) — larger cities get more.
- **Road network**: all 4 cities connected; N + S rivers with bridges.
- **Biomes**: 5 forest/swamp patches spread across the new map.
- **Price system**: each city has unique multipliers (Ironholt ore cheap, Crosshaven food cheap, etc).
- **10 wild events** (was 5): added wandering merchant, wounded soldier, plague cart, abandoned crate, wolf pack.
- **New NPCs**: Crosshaven innkeeper+peddler; Ironholt miner+foreman+smith (all with role-based movement).
- **Save migration**: old sunspire/gloomwharf saves auto-migrate to new city IDs.
- QA: all tests updated to new city IDs, all passing.

## v0.1.15 — 2026-03-14
- NPCs: role-based purposeful movement (guard patrol, scribe routine, baker schedule, fisher dock, smuggler lurk, broker pace).
- NPCs: waypoint system with arrival pauses — each role follows a defined multi-point route.
- NPCs: staggered start waypoints so NPCs don't all converge simultaneously.
- NPCs: pause-at-waypoint with repulsion still active while idle.

## v0.1.10 — 2026-03-14
- Intelligence Market: NPCs now offer to sell trade tips (5g each).
- Intel cards added to player ledger: predicted item price in other city, expiry in 4 days.
- Intel sell: sell stale tips to merchants in the other city for 3g.
- Intel verification: if a tip was accurate (within 12%), +4g bonus on expiry.
- HUD: shows 🕵️ badge with active intel count (desktop).
- Every-other NPC interaction prompts for intel; second E opens the full Intel Market modal.
- Intel persisted in save/load (intelLedger + intelSells).

## v0.0.129 — 2026-03-04
- Mobile Market: DOM modal uses single-column cards + big action button.
- Mobile Market: auto-switch/hide empty SELL tab.
- QA: mobile market DOM assertions added.

## v0.0.127 — 2026-03-04
- Cleanup: removed mobile HUD tap debug overlay.
- Mobile: tap-to-expand remains enabled.

## v0.0.126 — 2026-03-04
- Mobile: debounce HUD tap (avoid double toggle).
- Mobile: ignore pointerdown for touch to prevent duplicates.

## v0.0.125 — 2026-03-04
- Fix: mobile HUD debug overlay moved into HUD render (prevents runtime error).
- Mobile: set top bar height for tap logic.

## v0.0.124 — 2026-03-04
- Debug: mobile HUD tap overlay (temporary).
- Mobile: logs tap coords + hit state.

## v0.0.123 — 2026-03-04
- Mobile: global capture for HUD tap (Safari reliability).
- Mobile: top bar tap toggles HUD even if canvas misses events.

## v0.0.122 — 2026-03-04
- Mobile: tap anywhere on top bar (left side) to expand HUD.
- Mobile: city-name tap still works.

## v0.0.121 — 2026-03-04
- Mobile: compact HUD (Gold + Cargo + City).
- Mobile: tap City name to expand Day/Time + rules.
- QA: added mobile HUD tap/expand tests.

## v0.0.120 — 2026-03-03
- Diag: PASS triggers whenever delta ≥ 5.5 (fixes false fails).

## v0.0.119 — 2026-03-03
- Diag: auto-moves to nearest open tile before testing movement.
- Diag: isolates NPC blocking vs wall blocking.

## v0.0.118 — 2026-03-02
- Diag: overlay shows passCheck + raw delta + state.

## v0.0.117 — 2026-03-02
- Diag: passCheck computed explicitly after movement.
- Diag: overlay shows passCheck flag.

## v0.0.116 — 2026-03-02
- Diag: PASS threshold set to delta ≥ 5.5.
- Diag: overlay shows raw delta value.

## v0.0.115 — 2026-03-02
- Diag: PASS threshold set to delta ≥ 6.

## v0.0.114 — 2026-03-02
- Diag: movement delta now measured after moveWithCollision.
- Diag: added post-move evaluation phase.

## v0.0.113 — 2026-03-02
- Mobile: extended ghost window after NPC talk.
- Mobile: movement watchdog nudges if stuck.

## v0.0.112 — 2026-03-02
- Diag: movement now simulates ArrowRight input (real path).
- Diag: npcdiag runs before moveWithCollision.

## v0.0.111 — 2026-03-02
- Diag: waits for bubble before movement (real input path).
- Diag: shows market/contracts flags in overlay.

## v0.0.110 — 2026-03-02
- Fix: animation loop now schedules next frame at tick start (prevents stall).
- Diag: lastTick updates even if errors occur mid-frame.

## v0.0.109 — 2026-03-02
- Diag: npcdiag now starts in init state (auto-teleport works).

## v0.0.108 — 2026-03-02
- Diag: added DOM overlay so npcdiag shows even if canvas stalls.
- Diag: overlay includes build stamp + last tick age.

## v0.0.107 — 2026-03-02
- Diag: npcdiag now prioritizes NPC talk over market/contract.
- Overlay: reports action (npc/market/contract).

## v0.0.106 — 2026-03-02
- Diagnostics: npcdiag now simulates real KeyE input path.
- Overlay: shows last input + action for mobile debugging.

## v0.0.105 — 2026-03-01
- Diagnostics: added ?npcdiag=1 automated NPC interaction test overlay.
- Mobile: diag reports bubble + movement delta on device.

## v0.0.104 — 2026-03-01
- Fix: NPC collision only ignores the NPCs you are overlapping.
- Movement: no longer tunnels through other NPCs when overlapped.

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

## v0.3.22 — 2026-03-17
- Fix: notification banner now renders inside the panel (not as a fixed-viewport overlay blocking the game).
- Fix: PEOPLE panel (NPC chatter) now starts below the HUD instead of overlapping it.
- Tweak: market list max-height increased 56vh → 62vh on desktop; card padding tightened for denser layout.

## v0.3.23 — 2026-03-17
- Fix: active market tab (BUY/SELL/GEAR) now clearly highlighted — dark brown fill, light text, subtle shadow.
- Fix: selected item card border + shadow ring for clear focus.
- Fix: building glow rings now only appear when player is within discovery range (not on all visible tiles).

## v0.3.24 — 2026-03-17
- Fix: building glow rings now draw outside the tile boundary (sx-0.5, TILE+1) — building art fully visible underneath.
- Glow is purely an outer halo, not an overlay on the art.

## v0.3.25 — 2026-03-17
- Fix: player carriage redrawn as clean top-down 4-directional sprite.
- No more ctx.rotate — each direction (UP/DOWN/LEFT/RIGHT) drawn explicitly.
- Horse visibly in front of wagon relative to travel direction; harness line connects them.
- Tier visuals preserved: donkey → road horse → chestnut → warhorse → phantom mare.
- Leg animation, shadow, player identity stripe on wagon roof.

## v0.3.26 — 2026-03-17
- Fix: building label pills are now color-tinted (matching building accent color) instead of opaque black.
- Text shadow keeps labels readable over any background.
- "E/Tap" hint pill also color-tinted, no longer a black box.

## v0.3.27 — 2026-03-17
- Fix: building floating icon was an emoji (🛒/📋 etc.) drawn on canvas — renders as black box on mobile Safari.
  Replaced with a simple colored dot indicator (same color as building accent, with glow).

## v0.3.28 — 2026-03-17
- Removed "Tap" / "E" hint pill that appeared above building labels when standing next to a building.

## v0.3.29 — 2026-03-17
- Fix: wagon tier upgrades now visually distinct at 16px scale.
  T0: plain dark cart. T1+: tan/cream roof strip. T2+: window dots. T3+: gold trim + golden roof. T4: gilded side panels + glow.
- Player identity stripe moved to wagon bottom for better visibility.
- Note: saves are localStorage-only (per-browser); gear doesn't sync between Mac and mobile — that's by design (player ID system).
