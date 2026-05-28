---
description: Test-first development loop (red → green → smoke). Pass a one-sentence goal.
allowed-tools: Bash, Read, Edit, Write
argument-hint: <goal sentence>
---

# TDD Loop

**Goal:** $ARGUMENTS

Follow the 8-step TDD loop from `ops/RUNBOOK.md`. Work through each step in order. Stop and fix before advancing if any step fails.

## Step 1 — Define

Restate the goal in one sentence. Write a concrete success check (how will you know the test is green?). Write a one-line rollback plan (which file to revert if this breaks things).

## Step 2 — Choose test file and write a failing test

| What you're testing | File |
|---|---|
| Pure logic (math, data transforms, price calculations, save/load) | `ops/scripts/unit_tests.mjs` |
| Economy, balance, market constants, parity between client and server | `ops/scripts/economy_parity_test.mjs` |
| UI, player interaction, visual behavior | `ops/scripts/qa_selftest.mjs` |

If `qa_selftest.mjs`: warn that Playwright + chromium are required. If not installed, stop and ask user to run `npm i -D playwright && npx playwright install chromium`.

Add a new `test(...)` block to the chosen file. The test must fail before any implementation change. Do not touch `src/main.js` yet.

## Step 3 — Confirm RED

Run the chosen test file:
- `node ops/scripts/unit_tests.mjs`
- `node ops/scripts/economy_parity_test.mjs`
- `node ops/scripts/qa_selftest.mjs`

Expected: exit non-zero and a ✗ line for the new test. If exit 0, the test already passes — it is not testing the right thing. Stop and rewrite it.

## Step 4 — Implement

Edit `src/main.js` (and other files as needed) until the test should logically pass. Do not run tests yet.

## Step 5 — Confirm GREEN

Run the same test script from Step 3.

Expected: exit 0 and a ✓ line for the new test. All prior tests must still pass. Fix any regressions before continuing.

## Step 6 — Smoke check

Run: `node ops/scripts/smoke_local.mjs`

Embedded Node server — no Python, no separate serve step required. Verifies `index.html` build tag + loader `?v=` match the version in `src/main.js`.

On failure: STOP. Most failures after editing `src/main.js` mean `index.html` was not updated. Run `node ops/scripts/bump_version.mjs +patch` to sync them.

## Step 7 — Code review

Run `/code-review` on the current diff. Address any real findings before marking done. Mandatory per the review-before-done rule in `CLAUDE.md`.

## Step 8 — Deploy and screenshot

Run `/ship` to bump, commit, push, poll Pages, and take screenshots.
