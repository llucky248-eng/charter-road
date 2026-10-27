#!/usr/bin/env node
/**
 * Headless AI-trader report.
 *
 * Runs every AI trader for N game-days in memory (world_service.simulateTraders)
 * and prints a JSON report: per-trader gold/profit/trips, item shares, top
 * routes and diversity metrics. No browser, no remote DB, no clock.
 *
 * Usage:
 *   node ops/scripts/trader_report.mjs [--days N] [--seed S] [--pretty]
 */

import { simulateTraders } from './world_service.mjs';

function parseArgs(argv) {
  const out = { days: 30, seed: 1, pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--days':   out.days = Number(argv[++i]); break;
      case '--seed':   out.seed = Number(argv[++i]); break;
      case '--pretty': out.pretty = true; break;
      case '--help':
      case '-h':       out.help = true; break;
      default:         console.error(`Unknown argument: ${a}`); out.error = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.error) {
  console.error('Usage: node ops/scripts/trader_report.mjs [--days N] [--seed S] [--pretty]');
  process.exit(args.error ? 2 : 0);
}
if (!Number.isInteger(args.days) || args.days < 1 || args.days > 3650) {
  console.error('--days must be an integer from 1 to 3650'); process.exit(2);
}
if (!Number.isInteger(args.seed)) {
  console.error('--seed must be an integer'); process.exit(2);
}

const report = simulateTraders({ days: args.days, seed: args.seed });
process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0) + '\n');
