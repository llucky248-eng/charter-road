# Charter Road — Runbook (shipping + recovery)

This runbook is optimized for **fast iteration without breaking GitHub Pages**.
Rule: **No change ships without closing the loop**.

## Setup (first time)

```
npm run setup   # installs the pre-commit version-guard hook
```

## The TDD Loop (every change)

```
1) Define       — goal (1 sentence), success check, rollback plan
2) Write test   — add a failing test BEFORE editing src/main.js
3) Run test     — confirm it fails (red); commit test file alone
4) Implement    — edit src/main.js until the test goes green
5) Run test     — confirm it passes (green)
6) Validate     — npm run smoke
7) Deploy       — npm run deploy   ← bump + commit + push + pages check
8) Screenshot   — node ops/scripts/screenshot_pages.mjs vX.Y.Z (best-effort)
```

**Test placement guide:**
- Pure logic → `ops/scripts/unit_tests.mjs`
- Economy / balance → `ops/scripts/economy_parity_test.mjs`
- UI / interaction → `ops/scripts/qa_selftest.mjs`

If any step fails: **stop and fix** (or rollback).

`npm run deploy` prints the rollback command automatically if `pages_check` fails.

## Local smoke test (minimum)
- `npm run smoke` — starts embedded Node server, checks build tag + loader form
- No python3 required; no separate serve step needed

## Screenshot validation (required)
After deploy + Pages verification:
- Run automated screenshot capture (best-effort):
  - `node ops/scripts/screenshot_pages.mjs vX.Y.Z`
  - Artifacts saved under `ops/artifacts/vX.Y.Z/`
- If Playwright is not installed, take screenshots manually (mobile preferred).
- If a fatal overlay appears, screenshot it (it contains the stack trace).
- Save/attach screenshots in the chat log for quick regression comparisons.

## GitHub Pages cache rules (critical)
- Always load JS as `./src/main.js?v=<number>`.
- When shipping, bump `v=` every time.
- If iPhone shows old behavior:
  - open `https://…/charter-road/?v=<same number>`
  - refresh

## Emergency rollback
When the live build is broken (black screen / Loading… / fatal overlay):
1) Identify last known good version (Iteration Notes screenshot or git log).
2) `git revert` the breaking commit(s) or `git checkout <good-commit> -- src/main.js index.html`.
3) Bump cache-bust query.
4) Push.
5) Verify Pages.

## Known failure modes
- **Iteration Notes stuck on Loading…** → main.js not running (cached HTML, loader broken, blocked script).
- **Black canvas + fatal overlay with stack** → JS runtime error; fix line referenced.

## Security notes — persistence trust model (KNOWN GAPS, not yet closed)

The multiplayer backend identifies players only by a **client-asserted Player
ID** (typed in, not authenticated). There is no login/auth layer yet, so the
committed RLS policies and bank RPCs trust the client. Before relying on
persistent shared progress, close these — all require introducing
authenticated identities (e.g. Supabase Auth, anon or email):

- **Player saves are world-writable/deletable.** `player_saves` (and the shared
  `world_*` / `city_treasury` tables) grant `FOR ALL USING (true)` to `anon`
  (`ops/supabase_schema.sql`, `ops/multiplayer_migration.sql`). Anyone who
  knows or reads a Player ID can overwrite or delete that save. *Fix:* switch to
  authenticated identities and owner-scoped policies (`uid = auth.uid()`), and
  scope the shared tables to server-only writes (writes via `SECURITY DEFINER`
  RPCs, not blanket `anon` `FOR ALL`).
- **Bank withdrawals don't verify the caller's balance.** `bank_withdraw` takes
  only a city + amount and pays from the shared vault without identifying the
  caller or checking their own deposit (`ops/multiplayer_migration.sql`). The
  row lock stops concurrent SQL from colliding, not unauthorized withdrawals.
  The per-player deposit/loan ledger lives *client-side* in `playerBank`
  (`src/main.js`), so the server cannot enforce it. *Fix:* store per-player bank
  balances server-side and move the ledger + vault update into one authenticated
  transaction. The single-loan rule (see below) needs the same server authority.

Client-side hardening already applied (mitigations, not full fixes — they still
depend on the client being honest):
- **Loan double-grant race** (`takeLoan`, `src/main.js`): a `_bankLoanPending`
  set de-bounces rapid clicks in one tab so two loans can't be granted while one
  debt is recorded. Two tabs sharing a Player ID can still race — needs
  server-side single-loan enforcement (the auth work above).
- **Optimistic bank changes on network failure** (`bankRPC`, `src/main.js`): a
  rejected `fetch()` now resolves to a failure envelope so deposit/repay reverts
  run instead of leaving dangling local state. Residual: a committed-but-unacked
  write still reverts locally and desyncs until the next world sync — closing it
  needs server-issued transaction IDs to reconcile against.
- **Market aggregation double-counting** (`aggregate_economy`,
  `ops/supabase_schema.sql`): fixed by consuming events with `DELETE ...
  RETURNING` so each trade folds into pressure exactly once regardless of run
  frequency, with no double-count and no skip race (concurrent runs delete
  disjoint sets; uncommitted inserts stay for the next run). `trade_events` is an
  append-only feed consumed by deletion, which also bounds its growth. Residual:
  the *decay* term (`pressure *= 0.85`) still runs once per invocation, so how
  fast pressure normalizes still tracks aggregation cadence (dominated by the
  ~5-min world cron; each extra online client adds at most one hourly call).
  Fully decoupling that needs time-proportional decay keyed off a last-run
  timestamp — deferred; the reported re-counting bug (the accumulation side) is
  fixed. **One-time upgrade step:** an existing project may hold a large
  un-consumed `trade_events` backlog (the old aggregator never deleted); the new
  consume-by-DELETE folds all of it into pressure on its first run (a clamp-
  bounded but economy-wide price jolt). Before the first aggregation after
  deploying the new function, run once by hand to cap that to recent activity:
  `DELETE FROM trade_events WHERE created_at < NOW() - INTERVAL '1 hour';`. It is
  intentionally NOT in `supabase_schema.sql`, which stays idempotent (a bare
  DELETE would fire on every re-application).

