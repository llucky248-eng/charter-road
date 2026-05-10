# Iteration Log — The Charter Road

## v0.4.47 — 2026-05-10 (Ironholt Layout Fix)
- **Bank + Guild Hall now visible**: removed the two static ore-yard `placeBuilding` calls in `paintCity` for Ironholt that were clipping Bank's and Guild's south wall rows. Both buildings now render at full 4×3 footprint with proper labels.
- **Mine has its own tile type**: introduced tile id `19` (`mine-floor`) with `INTERACT[19] = 'Mine'`. Built mines no longer mislabel as "Warehouse". Distinct dark-stone interior render with lantern/ore hint.
- **Slot layout shift**: `cityBuildings.ironholt.granary` and `.warehouse` moved from `y=39` → `y=40` (out from under Bank/Guild's south walls); `.mine` moved from `y=42, h=4, doorSide:south` → `y=43, h=3, doorSide:east` so its east door opens onto the city floor instead of the south wall.
- **Auto-invest still builds the warehouses**: removing the static placements does not change gameplay — the slot system paints the same tile-8 warehouse once treasury auto-invests (cheapest unbuilt first).
- **Tap-built mine**: tapping inside a built mine building now toasts mine level + a status reminder.

## v0.4.46 — 2026-05-09 (Mining System)
- **Mining hybrid system**: Ironholt now has a mine building slot. Funded mines auto-produce ore/coal and (rarely) gems each day, depositing the proceeds into the city treasury and nudging local supply pressure down.
- **New items**: Coal (base 8g, weight 2 — bulk fuel, cheap at Ironholt) and Gemstones (base 80g, weight 1, rare drop — best price at Crosshaven).
- **Player-active mining**: 6 ore-vein tiles (id 18) spawn deterministically on grass adjacent to mountains in the Ironholt vicinity. Tap/walk-up + tap to mine — drops 2–4 ore (10% +1 coal, 5% +1 gem). Costs 15 stamina (regens 1/sec, max 100). 30s per-vein cooldown.
- **Contracts**: Ironholt-origin contracts can now request `coal` or `gem` (weighted pool); other cities still draw from the base pool.
- **CITY_MULTS**: Ironholt sources coal 0.55× / gem 0.70×; Ashport pays premium for coal (1.30×); Crosshaven pays premium for gem (1.40×).
- **HUD/world**: ⛏️ Mine FAB action when adjacent to a vein; mine status surfaced in the world.html dashboard for live cities.
- **Save**: player.mineCooldown + mineStamina now persisted; older saves auto-default and pick up new inv slots.
- **NPC dialogue**: Ironholt miner/foreman occasionally speak a live mine-status line based on built level.
- **QA**: new helpers `qaForceBuildMine`, `qaMineNodeAt`, `qaPlayerMine`, `qaCityMineTick`, `qaSetStamina`, `qaGetMiningState`.

## v0.2.3 — 2026-03-27 (Balance Pass)
- **Price variance fix**: `townItemModifier` skew increased from ±18% to ±35% + city tilt ±10% — every route now has viable margins
- **Market spread**: reduced from 10% to 6% — spread no longer eats all profit on low-price items
- **Item base prices rebalanced**: grain 10, food 16, ore 22, herbs 24, potion 40, relic 60, ink 75
- **Starting gold**: 220g (was 160g) — enough to buy a real first load
- **City treasury seed gold**: 60/40/30/45g per city — first building appears within a few days
- **Contract rewards**: delivery bonus raised (14–28g per item type) + higher qty multipliers → contracts clearly beat free trading
- **No-food penalty**: 5g/day (was 8g) — better balanced vs ration cost

## v0.2.2 — 2026-03-27
- **City Building Slots**: each city now has named investable building slots (market, barracks, granary, guild, warehouse, inn — per-city availability).
- **Vacant lots (tile 16)**: unbuilt slots appear on the map as rubble patches with a red stake marker. Walkable and tappable.
- **Auto-invest rewrite**: city treasury auto-invests in building slots (cheapest available first) instead of the old flat project system. Buildings physically appear on the map when funded.
- **Player donation modal**: tap a vacant lot → see build cost, city treasury, your donations; donate 10g / 50g / all. If player fully funds a slot it builds immediately.
- **guardDiscount effect**: barracks buildings reduce inspection chance proportionally per level.
- **Save/load**: cityBuildings state (level, built, playerFunded) persists and rebuilds map tiles on load.

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

## v0.3.30 — 2026-03-17
- Fix: player character in city is now a proper top-down merchant figure.
  Purple cloak, brown hat, skin-toned face, walking legs — 4-directional, facing-aware.
- Disabled broken sprite sheet (was a palette catalog, not animation sheet — caused invisible white dot fallback).

## v0.3.31 — 2026-03-17
- Fix: carriage gear tiers now dramatically more distinct.
  Wagon grows larger per tier (10→22px width). Roof strip colors: cream→orange→gold→bright gold.
  Horse colors: pale donkey → dark bay → bright chestnut → jet black → phantom blue-white.
  Warhorse (T3) is now jet black, immediately obvious vs lower tiers.

## v0.3.32 — 2026-03-17
- New: world.html — live world status dashboard.
  - Reads local save: gold, cargo, speed, gear, inventory, rep bars, active contract.
  - Fetches Supabase for global economy pressure (heatmap: red=demand, green=oversupply).
  - City market cards: buy/sell prices for all 6 items, color-coded delta badges.
  - Auto-refreshes every 30s. Available at /world.html alongside the game.

## v0.3.33 — 2026-03-17
- New: Grain trade item (base 6g, weight 2) — bulk cheap food, available in all cities, included in contracts.
- New: City populations — Valdenmere 8k, Ashport 4k, Ironholt 2.5k, Crosshaven 1.5k.
- New: Dynamic hunger system — population eats food/grain daily; hunger builds up and drives prices.
  Selling food or grain to a city relieves hunger (each unit = -2% hunger).
- New: Population can grow (well-fed) or shrink (starving) dynamically.
- HUD shows: Pop: 8.2k · Tax 18% · Inspect 65% · Hunger: 23%
- Save/Load persists cityPop state.
- world.html: City Populations section with hunger progress bars.

## v0.3.34 — 2026-03-17
- New: Population migration system.
  - Each day, people flee hungry + high-tax cities toward comfortable ones.
  - Attractiveness = (1 - hunger) × (1 - taxRate).
  - Up to 0.06% of a city's pop migrates per day under stress.
  - Destinations weighted by relative attractiveness.
  - Cities cap at 2× base population; floor at 30% base.
  - Toast notification when player is in a city receiving/losing 50+ migrants.

## v0.3.35 — 2026-03-17
- New: City tax treasury system.
  - Every sell trade deposits tax gold into the city treasury.
  - Every 7 days, cities auto-invest treasury into upgrades (biased by city type):
    * Market Expansion (-4% buy prices, max -30%) — Valdenmere/Ashport
    * Road Improvements (+5% travel speed, max +25%) — Ashport/Ironholt
    * Food Subsidy (-10% hunger growth, max -50%) — Crosshaven/Ironholt
    * Population Incentive (+5% migrant attraction, max +30%) — Valdenmere/Crosshaven
  - Toast notification when player is present during an investment.
  - HUD shows treasury balance alongside hunger.
  - world.html: treasury balance, active upgrades, recent investment log per city.

## v0.3.36 — 2026-03-18
- New: Bank (tile 13) — deposit gold (2%/day interest), take loans (200g max, 10% interest, 7-day due, 20g/day overdue penalty).
- New: Inn (tile 14) — Rest 8h (5g), buy price rumors/intel (10g), sleep till morning (15g).
- New: Guild Hall (tile 15) — join merchant guild (50g→Apprentice +5% sell, 150g+rep5→Journeyman +10%, 300g+rep15→Master +18%).
- New: Warehouse (tile 8, now interactive) — stash goods in any city, retrieve on return visit.
- All 4 buildings placed in all city layouts. All state saved/loaded.
