#!/usr/bin/env node
function die(msg){ console.error('FAIL:', msg); process.exit(1); }

const expected = (process.argv[2] || '').replace(/^v/,'');
if (!/^\d+\.\d+\.\d+$/.test(expected)) die('Usage: node ops/scripts/pages_check.mjs v0.0.54');

const url = `https://llucky248-eng.github.io/charter-road/?v=${expected}`;
const res = await fetch(url);
if (!res.ok) die(`HTTP ${res.status} fetching ${url}`);
const html = await res.text();

if (!html.includes(`HTML build: v${expected}`)) die(`HTML build mismatch (expected v${expected})`);

// Accept static loader form (./src/main.js?v=X) OR dynamic form
// (encodeURIComponent(v) + hardcoded fallback '?v=X... in index.html)
const staticForm  = html.includes(`./src/main.js?v=${expected}`);
const dynamicForm = html.includes(`encodeURIComponent(v)`) && html.includes(`'?v=${expected}`);
if (!staticForm && !dynamicForm) die(`loader main.js?v mismatch (expected ${expected})`);

console.log("PASS:", url);
console.log(`Next: node ops/scripts/screenshot_pages.mjs v${expected}`);
