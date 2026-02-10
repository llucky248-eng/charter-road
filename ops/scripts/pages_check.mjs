#!/usr/bin/env node
import https from 'node:https';

function fetch(url){
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function die(msg){
  console.error('FAIL:', msg);
  process.exit(1);
}

const expected = process.argv[2];
if (!expected || !/^v\d+\.\d+\.\d+$/.test(expected)) {
  die('Usage: node ops/scripts/pages_check.mjs <expectedVersion>  (e.g., v0.0.54)');
}

const url = `https://llucky248-eng.github.io/charter-road/?v=${expected.replace(/^v/,'')}`;
const {status, body} = await fetch(url);
if (status !== 200) die(`HTTP ${status} fetching ${url}`);

// Check HTML build tag and loader query
const q = expected.replace(/^v/,'');
if (!body.includes(`HTML build: v${q}`)) {
  die(`HTML build tag mismatch (expected v${q})`);
}
if (!body.includes(`./src/main.js?v=${q}`)) {
  die(`Loader script mismatch (expected main.js?v=${q})`);
}

console.log('PASS: Pages HTML contains expected build + loader');
console.log(url);
