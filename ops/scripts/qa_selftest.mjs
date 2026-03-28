#!/usr/bin/env node
/**
 * Lightweight self-test runner.
 *
 * Usage:
 *   node ops/scripts/qa_selftest.mjs [url]
 *
 * Default URL: starts its own server on port 8080 if none provided.
 * If a custom URL is passed as argv[2], uses that directly (no server started).
 */

import { chromium, devices } from 'playwright';
import { spawn, execSync } from 'child_process';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join, resolve } from 'path';

// ── Embedded static server (no python3 dependency) ────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function startServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        let p = req.url.split('?')[0];
        if (p === '/' || p === '') p = '/index.html';
        const file = join(root, p);
        if (!existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
        const ext = extname(file);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(file));
      } catch { res.writeHead(500); res.end('Error'); }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function die(msg) {
  console.error('QA_FAIL:', msg);
  process.exit(1);
}

let activeUrl = process.argv[2] || process.env.QA_URL || 'http://127.0.0.1:8080/?qa=1';

async function runOnce({ name, contextOptions }) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && (e.stack || e.message) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for the QA harness to report pass/fail.
  const result = await page.waitForFunction(() => {
    // @ts-ignore
    return window.__QA && window.__QA.status && (window.__QA.status === 'pass' || window.__QA.status === 'fail');
  }, { timeout: 30_000 }).then(() => page.evaluate(() => {
    // @ts-ignore
    return window.__QA;
  }));

  await browser.close();

  if (!result || result.status !== 'pass') {
    const msg = result?.details || 'unknown failure';
    die(`${name}: ${msg}`);
  }
  if (errors.length) {
    // Non-fatal console noise can be normal, but for QA we treat it as a failure.
    die(`${name}: console/page errors:\n- ${errors.join('\n- ')}`);
  }

  console.log('QA_PASS:', name);
}

(async () => {
  let server = null;

  // Auto-start embedded server when no custom URL given
  // This makes `npm test` self-contained — no need for a separate `npm run serve`
  if (!process.argv[2] && !process.env.QA_URL) {
    const PORT = 8080;
    // Resolve repo root: ops/scripts/qa_selftest.mjs → ../../.. = repo root
    const ROOT = resolve(new URL(import.meta.url).pathname, '../../..');
    try {
      server = await startServer(ROOT, PORT);
    } catch (e) {
      if (e.code === 'EADDRINUSE') {
        console.log(`[QA] Port ${PORT} already in use — using existing server`);
      } else {
        die(`Failed to start local server: ${e.message}`);
      }
    }
    activeUrl = `http://127.0.0.1:${PORT}/?qa=1`;
  }

  try {
    await runOnce({
      name: 'desktop',
      contextOptions: { viewport: { width: 1280, height: 720 } },
    });

    await runOnce({
      name: 'mobile-iphone',
      contextOptions: { ...devices['iPhone 12'] },
    });

    console.log('QA_PASS: all');
  } finally {
    if (server) server.close();
  }
})();
