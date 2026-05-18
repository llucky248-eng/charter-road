# Charter Road — BACKLOG

Ordering principle: smallest, safest, highest player value first.
Items within a tier are roughly ordered; tiers are strict.

---

## TIER 0 — Ship immediately (tiny, unblocking)

### 1. Boot self-test overlay
**Why now:** "Loading…" stuck is the top failure mode on iPhone. A self-test that
detects a broken canvas or missing script and shows an actionable fatal overlay
with a hard refresh link would eliminate silent black screens.
- Acceptance: if canvas is not writable or devlog never fills, show overlay with
  "Reload" button and version string. Must not fire during normal play.

### 2. Food-penalty visibility
**Why now:** Players silently lose 5g/day with no food in inventory. This is
punishing without being legible — new players don't know food exists.
- Acceptance: when player has zero food and the day ticks, show a brief HUD
  toast "No rations — 5g penalty" (same style as existing toasts). No
  other changes to the food mechanic.

---

## TIER 1 — Core loop (improve the moment-to-moment feel)

### 3. Intel system polish
**What it is:** The intel market (buy a tip for 5g, sell stale tips for 3g) is
fully implemented but rough. NPCs offer tips every other interaction. Players
rarely understand the value.
- Acceptance: intel cards shown in a dedicated ledger screen (tap 📒 in HUD);
  each card shows item, predicted city, predicted price, days remaining.
  Expired cards are greyed out and sellable. No changes to buy/sell logic.

### 4. Market price trend indicator
**Why:** marketDrift shifts prices ±20% per city per item over time. This is the
main reason to use the intel system, but players can't see trends at all.
- Acceptance: in the market modal, each item's price shows a small ▲/▼ or
  color tint when drift is >5% above/below its base. No numbers needed —
  just directional signal. Must not add visual clutter on mobile.

### 5. Active contract HUD completeness
**What's done:** Compass arrow + destination ring on minimap + text indicator
`📦 → city (progress)` are all shipped (v0.4.50).
**What's missing:** Tapping the HUD contract line should auto-navigate to the
destination city (same as tapping the minimap city dot).
- Acceptance: tap the `📦 → …` line on the mobile HUD → autoNav starts toward
  contract destination city. Desktop: clicking it also triggers autoNav.

### 6. Road checkpoint / patrol encounter
**Why:** Currently rep/permits have no on-road consequence — they only affect
market inspect chance inside cities. Road patrols make rep decisions feel real.
- Acceptance: rare random encounter (not more than once per 3 days) on road
  tiles; outcome branches on rep + permit (waved through / fine / confiscation).
  Uses existing event modal pattern. Must fire only on road tile (id 1).

---

## TIER 2 — World depth (make the world feel alive)

### 7. Session milestone: Merchant Guild rank
**Why:** There is no win condition or progression milestone. The gear ladder
goes to 1.2M gold with no meaningful checkpoint. A mid-game milestone gives
players something to aim for.
- Acceptance: reaching rep ≥ 5 in all cities + owning a Cargo Wagon (T3 pack)
  unlocks "Merchant Guild member" badge in the HUD. No mechanical changes yet —
  this is a recognition moment, not a gate.

### 8. Market drift player-controlled reset
**Why:** After many days, drift can compound to extremes (±20%). Players who
pause the game for real-world days return to stale prices with no way to reset.
- Acceptance: loading a save normalises drift toward 1.0 by 50% — a "market
  corrects while you were away" effect. No gameplay impact on active sessions.

### 9. 2–3 more roadside POIs
- Acceptance: deterministic spawn (seeded by world constants); minimap shows
  POI markers; E-interact triggers a brief event (flavour or small reward).
  No new tile types — reuse ruins (9) or camp (8).

### 10. Biome density pass (forest / swamp variety)
- Acceptance: travel through forest/swamp feels meaningfully slower;
  biome patches appear on minimap; no performance regression on mobile
  (frame time must stay ≤ 16ms on a mid-range phone, measured by qa_player_speed).

---

## TIER 3 — UX polish (mobile-first, no new mechanics)

### 11. Market: explicit Close + Confirm buttons
- Acceptance: no keyboard needed for core market actions on mobile;
  buttons large enough for thumb tap (≥ 44px target).

### 12. Event modal: tap target + selection feedback
- Acceptance: clear highlight on selected choice; no accidental double-tap
  triggers; works with one-thumb reach.

### 13. HUD: no overlap on small phones (375px wide)
- Acceptance: qa_mobile_dialog_layout screenshot shows no element overlapping
  another on a 375×667 viewport.

---

## TECH

### T1. Pages version-checker automation
- `ops/scripts/pages_check.mjs` fetches the live URL, reads the version string
  from the devlog, and exits non-zero if it doesn't match the expected version.
- Acceptance: runnable as `node ops/scripts/pages_check.mjs vX.Y.Z` from CI or
  manually after deploy.

### T2. Playwright CI (qa_selftest in GitHub Actions)
- Add `npx playwright install --with-deps chromium` step before `npm test` in a
  separate `qa` CI job. Keep `test` job (unit-only) fast; `qa` job runs on
  push to main only.
- Acceptance: qa_selftest passes green on a PR targeting main.

### T3. Lint step in CI
- Add `node --check src/main.js` (syntax only) as a pre-step in the test job.
  Catches malformed JS before Playwright even runs.
- Acceptance: lint step runs in < 5s; a deliberate syntax error causes red CI.

---

## DONE (reference)

- ✅ Contracts v1: accept/deliver delivery contracts
- ✅ Contract reward scaling (qty + rarity, tested in unit_tests.mjs)
- ✅ Contracts v2: compass arrow to destination (minimap + HUD indicator) — v0.4.50
- ✅ CI unit + parity tests on every push — v0.4.50
- ✅ Mining system (Ironholt mine, stamina, ore/coal/gem) — v0.4.46
- ✅ 3D building sprites (Plumberry style) — v0.4.49
- ✅ Market drift (per-city per-item, ±20%, daily tick)
- ✅ Intel market (buy/sell trade tips via NPC interaction)
- ✅ Auto-nav (tap minimap city → pathfind and walk)
- ✅ Rep + permit system (city entry, inspection chance, permit discount)
