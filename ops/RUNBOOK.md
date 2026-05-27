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

