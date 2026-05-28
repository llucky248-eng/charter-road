#!/usr/bin/env node
/**
 * Local smoke test — no python3 required.
 * Starts an embedded static server, fetches index.html, verifies:
 *   1. HTML build tag matches the version in src/main.js
 *   2. Loader references the expected version (static or dynamic form)
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { startServer } from './lib/static_server.mjs';

function die(msg) { console.error('SMOKE FAIL:', msg); process.exit(1); }

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const PORT = Number(process.env.PORT) || 4173;

const mainJs = readFileSync(`${ROOT}/src/main.js`, 'utf8');
const vm = mainJs.match(/NPC_DIAG_BUILD\s*=\s*'v(\d+\.\d+\.\d+)'/) ||
           mainJs.match(/version\s*:\s*'v(\d+\.\d+\.\d+)'/);
if (!vm) die('Could not read expected version from src/main.js');
const expected = vm[1];

let server;
try {
  server = await startServer(ROOT, PORT);
} catch (e) {
  die(`Failed to start server on port ${PORT}: ${e.message}`);
}

try {
  const res = await fetch(`http://127.0.0.1:${PORT}/index.html`);
  if (!res.ok) die(`HTTP ${res.status} from local server`);
  const html = await res.text();

  if (!html.includes(`HTML build: v${expected}`))
    die(`HTML build tag mismatch (expected v${expected})`);

  // Accept static form (./src/main.js?v=X) or dynamic form (encodeURIComponent + '?v=X fallback)
  const staticForm  = html.includes(`./src/main.js?v=${expected}`);
  const dynamicForm = html.includes(`encodeURIComponent(v)`) && html.includes(`'?v=${expected}`);
  if (!staticForm && !dynamicForm)
    die(`loader main.js?v mismatch (expected v${expected})`);

  console.log(`SMOKE OK: HTML build v${expected} and loader ok`);
} finally {
  server.close();
}
