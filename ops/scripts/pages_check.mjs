#!/usr/bin/env node
import fs from 'node:fs';

function die(msg){ console.error('FAIL:', msg); process.exit(1); }

const expected = (process.argv[2] || '').replace(/^v/,'');
if (!/^\d+\.\d+\.\d+$/.test(expected)) die('Usage: node ops/scripts/pages_check.mjs v0.0.54');

const url = `https://llucky248-eng.github.io/charter-road/?v=${expected}`;
const res = await fetch(url);
if (!res.ok) die(`HTTP ${res.status} fetching ${url}`);
const html = await res.text();

if (!html.includes(`HTML build: v${expected}`)) die(`HTML build mismatch (expected v${expected})`);
if (!html.includes(`./src/main.js?v=${expected}`)) die(`loader main.js?v mismatch (expected ${expected})`);

console.log('PASS:', url);
