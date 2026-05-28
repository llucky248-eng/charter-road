---
description: Full deploy cycle: smoke → deploy → read version → screenshot. Stops on any failure.
allowed-tools: Bash
---

# Ship

Run each step in order. Stop immediately on any failure.

## Step 1 — Smoke check

Run: `node ops/scripts/smoke_local.mjs`

On exit non-zero: STOP. Print the error verbatim.

## Step 2 — Deploy

Run: `npm run deploy`

This bumps the patch version, commits `src/main.js` + `index.html`, pushes with up to 3 retries, and polls GitHub Pages for 90 seconds.

**Do NOT call `node ops/scripts/bump_version.mjs` before this step** — `deploy.sh` already bumps as its first action. A separate bump would double-increment the version.

On exit non-zero: STOP. Print the error. If a Pages timeout, note that `deploy.sh` printed the rollback command. Tell the user to run `/rollback` with the last known good version.

## Step 3 — Read version

Run: `node ops/scripts/read_expected_version.mjs`

Captures the bare `X.Y.Z` string (no `v` prefix, no newline). The deployed tag is `v{output}`.

## Step 4 — Screenshot (best-effort)

Run: `node ops/scripts/screenshot_pages.mjs v{version}`

Exit code meanings:
- 0: saved to `ops/artifacts/v{version}/pages-desktop.png` and `pages-mobile.png` — print both paths.
- 2: Playwright not installed — print "Screenshots skipped. Install: `npm i -D playwright && npx playwright install chromium`". Not a failure.
- 1: real error — print it. Warning only; deploy already succeeded.

## Done

Report: "Shipped v{version}. GitHub Pages is live."
