#!/usr/bin/env node
/**
 * Headless mining-economy report.
 *
 * Runs the deterministic mining simulation for N game-days and prints a JSON
 * economy report — no browser, no remote DB. This is the kind of single local
 * command the "next headless milestone" in CLAUDE.md calls for.
 *
 * Usage:
 *   node ops/scripts/mining_report.mjs [--days N] [--seed S] [--pretty]
 *                                      [--player <siteId>] [--swings K] [--ships K]
 *
 * Examples:
 *   node ops/scripts/mining_report.mjs --days 30 --seed 7 --pretty
 *   node ops/scripts/mining_report.mjs --days 60 --player coppervein_hollow --swings 4 --ships 1
 */

import { simulateMiningEconomy, MINE_SITES } from './lib/mining.mjs';

function parseArgs(argv) {
  const out = { days: 30, seed: 1, pretty: false, player: null, swings: 4, ships: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--days':   out.days = Number(next()); break;
      case '--seed':   out.seed = Number(next()); break;
      case '--pretty': out.pretty = true; break;
      case '--player': out.player = next(); break;
      case '--swings': out.swings = Number(next()); break;
      case '--ships':  out.ships = Number(next()); break;
      case '--help':
      case '-h':       out.help = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        out.error = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log('Usage: node ops/scripts/mining_report.mjs [--days N] [--seed S] [--pretty]');
  console.log('                                          [--player <siteId>] [--swings K] [--ships K]');
  console.log(`\nSites: ${MINE_SITES.map(s => s.id).join(', ')}`);
  process.exit(0);
}

if (args.error || !Number.isFinite(args.days) || args.days <= 0 || !Number.isFinite(args.seed)) {
  console.error('Invalid arguments. Try --help.');
  process.exit(1);
}

if (args.player && !MINE_SITES.some(s => s.id === args.player)) {
  console.error(`Unknown site "${args.player}". Valid: ${MINE_SITES.map(s => s.id).join(', ')}`);
  process.exit(1);
}

const player = args.player
  ? { minesAt: args.player, swingsPerDay: args.swings, shipsPerDay: args.ships }
  : null;

const report = simulateMiningEconomy({ days: args.days, seed: args.seed, player });

console.log(JSON.stringify(report, null, args.pretty ? 2 : 0));
