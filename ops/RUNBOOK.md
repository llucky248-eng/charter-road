# Charter Road — Runbook (shipping + recovery)

This runbook is optimized for **fast iteration without breaking GitHub Pages**.
Rule: **No change ships without closing the loop**.

## The Gated Loop (every change)
1) **Define** (1–3 min)
   - Goal (1 sentence)
   - Success check (what proves it worked)
   - Rollback plan (what version to revert to)
2) **Implement**
3) **Validate locally** (Gate)
   - `bash ops/scripts/smoke_local.sh`
4) **Deploy** (Gate)
   - bump version + cache-bust
   - commit + push
5) **Verify Pages** (Gate)
   - open Pages (mobile + desktop)
   - confirm Iteration Notes shows expected version

If any gate fails: **stop and fix** (or rollback).

## Local smoke test (minimum)
- `node -c src/main.js`
- Load `index.html` locally (optional) and confirm:
  - canvas renders
  - Iteration Notes is not stuck on “Loading…”

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

