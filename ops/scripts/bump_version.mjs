#!/usr/bin/env node
import fs from 'node:fs';

const repoRoot = new URL('../../', import.meta.url).pathname;

function die(msg){
  console.error('ERROR:', msg);
  process.exit(1);
}

const next = process.argv[2];
if (!next) die('Usage: node ops/scripts/bump_version.mjs <version>  (e.g., v0.0.54)');
if (!/^v\d+\.\d+\.\d+$/.test(next)) die('Version must look like v0.0.54');
const q = next.replace(/^v/, '');

const mainPath = repoRoot + 'src/main.js';
const htmlPath = repoRoot + 'index.html';

let main = fs.readFileSync(mainPath, 'utf8');
let html = fs.readFileSync(htmlPath, 'utf8');

// 1) Update ITERATION.version
main = main.replace(/version:\s*'v\d+\.\d+\.\d+'/m, `version: '${next}'`);

// 2) Update loader main.js?v=...
html = html.replace(/\.\/src\/main\.js\?v=\d+\.\d+\.\d+/g, `./src/main.js?v=${q}`);

// 3) Update HTML build tag if present
html = html.replace(/HTML build:\s*v\d+\.\d+\.\d+/g, `HTML build: v${q}`);

fs.writeFileSync(mainPath, main);
fs.writeFileSync(htmlPath, html);

console.log(`Bumped to ${next} (main.js?v=${q})`);
