---
description: Economy parity audit + trade route simulation. Fully offline. Reports mismatches, top routes, and balance flags.
allowed-tools: Bash
---

# Balance Check

Both scripts are fully offline — no network, no Playwright, no browser.

## Step 1 — Economy parity test

Run: `node ops/scripts/economy_parity_test.mjs`

Each test prints `✓ <name>` (pass) or `✗ <name>` + error (fail). Record pass/fail count and any ✗ lines.

If exit non-zero: record the failures but continue to Step 2 (trade sim is independent).

## Step 2 — Trade simulation

Run: `node ops/scripts/trade_sim.mjs`

Always exits 0. Captures: TOP 10 PROFITABLE ROUTES table, STRATEGY SIMULATION RESULTS (🟢/🟡/🔴), BALANCE ANALYSIS flags.

## Step 3 — Structured report

Produce a markdown report with these sections in order:

### Parity Status
Pass or fail. If failed, list each ✗ test name and its error.

### Balance Flags
Every ⚠️ warning from the trade sim. If none: "No flags raised."
Priority items to surface: spread ratio > 5x, cities with no profitable outbound route, items marked NEVER PROFITABLE, upkeep > 30% of top-route profit.

### Top 3 Profitable Routes
From the TOP 10 table: route (from → to), item, buy price, sell price, profit/day.

### Strategy Ranking
All 4 strategies ranked best-first: 🟢/🟡/🔴, name, end gold, day reached, g/day.

### Starter Viability
Starting gold, cheapest item at Valdenmere, best starter routes.

### Upkeep Pressure
Upkeep per trip as % of top-route profit, with ✅ or ⚠️ flag.
