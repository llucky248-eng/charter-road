# QoL Improvement Plan — 10 items

Audit date: 2026-07-20 · Baseline: `e842a01` · All line refs are `src/main.js` unless noted.

Each item lists the problem (with code evidence), the planned fix, and the test to
write **first** (red → green, per the Test-first rule). Items touching `src/main.js`
need a version bump before staging (`node ops/scripts/bump_version.mjs +patch`).

Suggested order: ship P1 items first (small, high-friction fixes), then P2.

---

## 1. Mobile market only trades 1 unit at a time — P1

**Problem.** The desktop market card renders ±1 / ±5 / MAX quantity buttons
(`mkBtn` block, ~line 6903), but the mobile branch renders a single BUY/SELL
button hardcoded to `data-qty="1"` (~line 6886). Moving a full pack of 20 grain
on a phone takes 20 taps + 20 re-renders.

**Fix.** In the mobile card branch of `domRender`, render two compact buttons per
row: `BUY/SELL 1` and `MAX/ALL` (qty already computed as `maxBuy` / `have`).
Reuse the existing `data-action="trade"` delegation — no new handler needed.
Keep the row height within the current card CSS so `qa_mobile_dialog_layout.mjs`
still passes.

**Test first.** `qa_selftest.mjs` (mobile pass): assert the sell tab card for a
held item exposes a button with `data-qty` > 1, click it, assert inventory goes
to 0 in one tap.

## 2. Market keyboard navigation lands on invisible rows on the SELL tab — P1

**Problem.** The market keydown handler cycles `ui.selection` over
`ITEMS.length + 1` indices regardless of tab (~line 9818), but the SELL tab
renders only held items and skips the permit row (`continue` at ~line 6838).
With 2 held items, ArrowDown steps through ~7 invisible rows; Enter on one just
toasts "You have none to sell."

**Fix.** Build the list of visible indices for the current mode (same filter the
renderer uses), and make ArrowUp/Down cycle within that list. Enter stays
`marketTryTrade(ui.selection)`. On tab switch, snap `ui.selection` to the first
visible index.

**Test first.** `unit_tests.mjs`: extract the visible-index computation into a
pure helper `marketVisibleIndices(mode, inv, items)` and test it (sell tab: only
held items; buy tab: all + permit). Then wire keyboard nav through it.

## 3. Mining stamina is invisible — P1

**Problem.** Stamina is a real resource (0–100, 8–15/swing per pickaxe tier
~line 8443, regen 1/s ~line 12951) but is never drawn anywhere. The player only
discovers it exists when a swing fails with a toast. The one-shot vein tutorial
(~line 11789) mentions stamina, but there's no meter.

**Fix.** In `drawHUD`, draw a small stamina bar (label ⛏ + fill 0–100) whenever
`nearMineTile()` is truthy OR `player.mineStamina < 100`. Desktop: under the
minimap; mobile: right end of the slim top bar. Color ramp green→amber→red below
one swing's cost.

**Test first.** `qa_selftest.mjs`: expose `qaGetMiningState().stamina` (already
exists, line 722); after `qaSetStamina(40)`, assert a new QA hook
`__QA.api.qaHudShowsStamina()` reports the bar visible with fraction 0.4.

## 4. Accepting a contract silently discards the active one — P1

**Problem.** `contractsAccept` does `contracts.active = { ...job }` (~line 6752)
with no warning. A player mid-delivery who taps Accept on a new job loses the
old contract (and any cargo bought for it) with zero feedback. There is also no
way to abandon a contract deliberately — the word "abandon" appears nowhere in
the codebase.

**Fix.**
- If `contracts.active` exists when accepting, open a confirm step (reuse the
  event-modal plumbing or a two-tap "Tap again to replace" state on the button)
  showing what will be lost.
- Add an "Abandon" button next to the active-contract line in the contracts
  modal header; abandoning clears `contracts.active`, no rep penalty (v1).

**Test first.** `unit_tests.mjs`: extract accept/replace decision into a pure
helper (`contractAcceptAction(active, job) → 'accept' | 'confirm-replace'`) and
test both branches; `qa_selftest.mjs`: accept job A, accept job B, assert A is
still active until confirm; abandon, assert `contracts.active === null`.

## 5. Toasts overwrite each other — P1

**Problem.** `toast()` is a single slot: `ui.toast = msg` (~line 8886). A sell
(`Sold 5 Grain +60g`) followed within a frame by a guild milestone or autosave
note erases the earlier message before it can be read.

**Fix.** Replace the slot with a small queue (max 3, FIFO): `ui.toasts = [{msg,
t}]`. Render stacked from the bottom, each with its own timer; drop oldest when
full. Keep the `toast(msg, seconds)` signature so all ~100 call sites are
untouched.

**Test first.** `unit_tests.mjs`: extract queue push/expire logic into a pure
helper (`toastQueuePush(q, msg, s, max)` / `toastQueueTick(q, dt)`) and test
overflow-drops-oldest and independent expiry.

## 6. No price memory across cities — P2

**Problem.** Route planning requires memorizing prices. The game already leaks
partial info (rumors ~line 8739, paid intel ~line 5461, market pulse), but the
player can't see "what did grain cost in Ashport when I was there yesterday."

**Fix.** Record a snapshot when a market is opened: `player.priceLedger[cityId] =
{ day, quotes: {itemId: {buy, sell}} }`. Add a read-only "📒 PRICES" tab to the
market modal listing last-seen quotes per visited city with a "Day N" staleness
stamp. No omniscience: only cities the player has actually opened a market in.
Persist in the save (extend `validateSave`/`migrateSave` with a defaulted
field).

**Test first.** `unit_tests.mjs`: snapshot helper is pure (given cityId + quotes
→ ledger entry); save round-trip preserves it; migration defaults it to `{}` on
old saves.

## 7. Bank quick-amounts don't scale with wealth — P2

**Problem.** Deposit buttons are fixed +10/+50/+100 (~line 7330) and loans
50/100/200. With late-game gear costing 175,000g, depositing meaningful gold is
hundreds of taps. Withdraw already has "all", deposit doesn't.

**Fix.** Replace fixed deposit buttons with +10% / +half / MAX of current gold
(rounded, min 10g), labels showing the computed amount. Keep the bank RPC
signatures unchanged (amounts are already parameters).

**Test first.** `unit_tests.mjs`: pure helper `bankQuickAmounts(gold) →
[a,b,c]` — test rounding, min clamp, and that MAX equals gold.

## 8. Navigate picker shows no distance or ETA — P2

**Problem.** `showNavPicker` (~line 1007) shows pop/treasury/hunger per city but
not how far the trip is. Boots tiers change speed, so the player can't judge a
trip's cost before committing.

**Fix.** For each destination, compute the path via the existing
`buildTraderPath(fromId, toId)` (~line 3977), sum segment lengths, and show
`~N tiles · ~Ms Ss at current boots` using the player's effective speed. Cache
per (from,to) pair — paths are static.

**Test first.** `unit_tests.mjs`: pure helper `pathLengthPx(path)` +
`etaSeconds(lengthPx, speed)`; feed a synthetic 3-waypoint path and assert exact
values.

## 9. Contract board rows don't show what you already hold — P2

**Problem.** Board rows render "Deliver 5× Ore → ironholt · Reward Ng"
(~line 7148) with no indication that the player already holds 3 ore, and no hint
where the item is cheap. The have/need progress label exists
(`activeContractProgressLabel`, line 9009) but only for the already-accepted
contract.

**Fix.** On each board row add `You hold X/N` (green when X ≥ N) using
`player.inv[job.want]`, plus a one-line source hint (`cheapest at <city>` from
the static `CITY_MULTS` — public knowledge, not live prices).

**Test first.** `unit_tests.mjs`: pure helper `contractHoldLabel(inv, job)` and
`cheapestCityFor(itemId)` (static-mults argmin) with fixed fixtures.

## 10. No pack-value readout — P2

**Problem.** Deciding whether to sell here or carry on requires opening the sell
tab and summing rows mentally. `cargoMarketValue(inv, items)` already exists
(~line 9044) but is only used for road-event stakes.

**Fix.** In the market footer (`cr-foot`, ~line 7050) show `Pack value here:
~Ng` computed from the current city's *sell* quotes (net of spread; before tax,
labelled as such). On the road, show base-value in the desktop HUD gold line.

**Test first.** `economy_parity_test.mjs` or `unit_tests.mjs`: assert the
footer value equals the sum of `quoteFor(city, item).sell × qty` for a fixture
inventory (guards against accidentally using buy-side quotes).

---

## Cross-cutting rules for every item

1. Red test first, then implement to green (`npm run test:unit`, Playwright
   items via `npm run qa:selftest`).
2. `node ops/scripts/bump_version.mjs +patch` before staging any commit that
   touches `src/main.js`.
3. `/code-review` on the diff before calling the item done.
4. One item per commit/PR — each is independently shippable; none depend on
   each other except that #2 and #1 both touch the market card renderer (land
   #1 first to avoid rebase churn).
5. Headless constraint: all new logic must be pure functions of state (no
   `Date.now()`; timers keyed off `stateTime` like the existing stamina regen).
