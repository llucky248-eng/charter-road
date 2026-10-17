#!/usr/bin/env node
// Self-tests for harness tooling: bump_version, pre-commit sed patterns, read_expected_version.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT    = resolve(SCRIPTS, '../..');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}
function assert(cond, msg)    { if (!cond) throw new Error(msg); }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? 'assertEqual'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// Creates a minimal temp project with version-stamped stub files.
function makeTempProject(version) {
  const dir = mkdtempSync(join(tmpdir(), 'charter-road-harness-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'index.html'),
    `<!-- HTML build: v${version} -->\n` +
    `<script src="./src/main.js?v=${version}"></script>\n` +
    `<!-- '?v=${version}' -->\n`);
  writeFileSync(join(dir, 'src', 'main.js'),
    `const NPC_DIAG_BUILD = 'v${version}';\nconst version = 'v${version}';\n`);
  return dir;
}

// ---------------------------------------------------------------------------
console.log('\nbump_version.mjs');

test('+patch increments patch in both files', () => {
  const dir = makeTempProject('1.2.3');
  try {
    const r = spawnSync('node', [join(SCRIPTS, 'bump_version.mjs'), '+patch'], { cwd: dir, encoding: 'utf8' });
    assertEqual(r.status, 0, 'exit code');
    assert(readFileSync(join(dir, 'src', 'main.js'), 'utf8').includes("'v1.2.4'"), 'src/main.js version');
    assert(readFileSync(join(dir, 'index.html'),     'utf8').includes('v1.2.4'),   'index.html version');
  } finally { rmSync(dir, { recursive: true }); }
});

test('explicit version sets exact value', () => {
  const dir = makeTempProject('0.0.1');
  try {
    const r = spawnSync('node', [join(SCRIPTS, 'bump_version.mjs'), 'v9.9.9'], { cwd: dir, encoding: 'utf8' });
    assertEqual(r.status, 0, 'exit code');
    assert(readFileSync(join(dir, 'src', 'main.js'), 'utf8').includes("'v9.9.9'"), 'explicit version');
  } finally { rmSync(dir, { recursive: true }); }
});

test('invalid arg exits 1', () => {
  const dir = makeTempProject('1.0.0');
  try {
    const r = spawnSync('node', [join(SCRIPTS, 'bump_version.mjs'), 'not-a-version'], { cwd: dir, encoding: 'utf8' });
    assertEqual(r.status, 1, 'should exit 1 on bad arg');
  } finally { rmSync(dir, { recursive: true }); }
});

// ---------------------------------------------------------------------------
console.log('\npre-commit hook sed patterns');

test('JS pattern extracts NPC_DIAG_BUILD version', () => {
  const r = spawnSync('bash', ['-c',
    `printf '%s' "const NPC_DIAG_BUILD = 'v3.14.15';" | sed -n "s/.*NPC_DIAG_BUILD *= *'v\\([0-9.]*\\)'.*/\\1/p"`
  ], { encoding: 'utf8' });
  assertEqual(r.stdout.trim(), '3.14.15', 'JS sed pattern');
});

test('HTML pattern extracts HTML build version', () => {
  const r = spawnSync('bash', ['-c',
    `printf '%s' "<!-- HTML build: v3.14.15 -->" | sed -n "s/.*HTML build: v\\([0-9.]*\\).*/\\1/p"`
  ], { encoding: 'utf8' });
  assertEqual(r.stdout.trim(), '3.14.15', 'HTML sed pattern');
});

test('JS pattern returns empty when version absent (no false match)', () => {
  const r = spawnSync('bash', ['-c',
    `printf '%s' "no version here" | sed -n "s/.*NPC_DIAG_BUILD *= *'v\\([0-9.]*\\)'.*/\\1/p"`
  ], { encoding: 'utf8' });
  assertEqual(r.stdout.trim(), '', 'should produce no output when pattern absent');
});

// ---------------------------------------------------------------------------
console.log('\npre-commit hook whatsNew extraction');

// The hook pipes src/main.js to a node -e that extracts the whatsNew array
// content via regex. Test the regex directly so we catch drift.
const EXTRACT_WN = `let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const m=s.match(/whatsNew:\\s*\\[([\\s\\S]*?)\\],\\s*whatsNext:/);process.stdout.write(m?m[1]:"")})`;

function extractWhatsNew(input) {
  const r = spawnSync('node', ['-e', EXTRACT_WN], { input, encoding: 'utf8' });
  return r.stdout;
}

test('extracts whatsNew array content from canonical block', () => {
  const src = `const ITERATION = {\n  version: 'v1.0.0',\n  whatsNew: [\n    'first thing',\n    'second thing',\n  ],\n  whatsNext: [\n    'future',\n  ],\n};\n`;
  const out = extractWhatsNew(src);
  assert(out.includes('first thing'),  'first entry present');
  assert(out.includes('second thing'), 'second entry present');
  assert(!out.includes('future'),      'whatsNext content not bled in');
});

test('different whatsNew content produces different extraction', () => {
  const a = `whatsNew: [\n  'a',\n],\nwhatsNext: [],\n`;
  const b = `whatsNew: [\n  'b',\n],\nwhatsNext: [],\n`;
  assert(extractWhatsNew(a) !== extractWhatsNew(b), 'hook would detect change');
});

test('empty output when whatsNew block absent (no false match)', () => {
  assertEqual(extractWhatsNew('const X = 1;'), '', 'no whatsNew → empty extraction');
});

test('extracts whatsNew from real src/main.js', () => {
  const src = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
  const out = extractWhatsNew(src);
  assert(out.length > 0, 'real file has a non-empty whatsNew block');
});

// ---------------------------------------------------------------------------
console.log('\nread_expected_version.mjs');

test('outputs semver from repo root src/main.js', () => {
  const r = spawnSync('node', [join(SCRIPTS, 'read_expected_version.mjs')], { cwd: ROOT, encoding: 'utf8' });
  assertEqual(r.status, 0, 'exit code');
  assert(/^\d+\.\d+\.\d+$/.test(r.stdout), `output should be semver, got: "${r.stdout}"`);
});

// ---------------------------------------------------------------------------
console.log('\nworld_service trader reset (makeSeedTrader)');

const { TRADER_DEFS, makeSeedTrader } = await import('./world_service.mjs');

test('seeds every trader def to a fresh, fully-reset state', () => {
  assert(TRADER_DEFS.length > 0, 'expected at least one trader def');
  TRADER_DEFS.forEach((def, i) => {
    const t = makeSeedTrader(def, i);
    // Identity preserved from the def
    assertEqual(t.id, def.id, `id for ${def.id}`);
    assertEqual(t.name, def.name, `name for ${def.id}`);
    assertEqual(t.personality, def.personality, `personality for ${def.id}`);
    assertEqual(t.gold, def.startGold, `gold reset to startGold for ${def.id}`);
    // Accumulated fields must be zeroed so a reset upsert can't inherit stale state
    assertEqual(t.total_profit, 0, `total_profit for ${def.id}`);
    assertEqual(t.trips_completed, 0, `trips_completed for ${def.id}`);
    assertEqual(t.gear_tier, 0, `gear_tier for ${def.id}`);
    assertEqual(t.preferred_item, null, `preferred_item for ${def.id}`);
    assert(Array.isArray(t.profit_history) && t.profit_history.length === 0, `profit_history empty for ${def.id}`);
    assert(t.permits && typeof t.permits === 'object' && Object.keys(t.permits).length === 0, `permits empty for ${def.id}`);
    assertEqual(t.state, 'in_city', `state for ${def.id}`);
  });
});

test('seed carries no accumulated numeric field left non-zero', () => {
  const t = makeSeedTrader(TRADER_DEFS[0], 0);
  // Guard against a future field addition that forgets to reset: any field whose
  // name implies accumulation must start at 0 / empty.
  const CONFIG_FIELDS = new Set(['start_gold', 'review_at_trips']); // config, not accumulators
  for (const [k, v] of Object.entries(t)) {
    if (/profit|trips|tier|spent|collected|deposits/.test(k) && !CONFIG_FIELDS.has(k)) {
      assert(v === 0 || (Array.isArray(v) && v.length === 0),
        `accumulated field "${k}" should seed to 0/[], got ${JSON.stringify(v)}`);
    }
  }
});

// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
