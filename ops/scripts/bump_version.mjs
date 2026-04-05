#!/usr/bin/env node
import fs from 'node:fs';

function die(msg){ console.error('ERROR:', msg); process.exit(1); }

const arg = process.argv[2] || '+patch';

const INDEX='index.html';
const MAIN='src/main.js';

const indexHtml = fs.readFileSync(INDEX,'utf8');
const mainJs = fs.readFileSync(MAIN,'utf8');

const m = mainJs.match(/NPC_DIAG_BUILD\s*=\s*'v(\d+\.\d+\.\d+)'/) ||
           mainJs.match(/version\s*:\s*'v(\d+\.\d+\.\d+)'/);
if (!m) die('Could not find NPC_DIAG_BUILD or ITERATION.version in src/main.js');
const cur = m[1];

function parse(v){ const mm=String(v).match(/^(\d+)\.(\d+)\.(\d+)$/); return mm?{a:+mm[1],b:+mm[2],c:+mm[3]}:null; }
function fmt(o){ return `${o.a}.${o.b}.${o.c}`; }
function bumpPatch(v){ const o=parse(v); if(!o) return null; o.c++; return fmt(o); }

let next;
if (arg === '+patch') next = bumpPatch(cur);
else if (arg.startsWith('v')) next = arg.slice(1);
else next = arg;
if (!parse(next)) die(`Invalid version arg: ${arg}`);

// No-op bump is OK (useful when re-running validation for the same version)
if (next === cur) {
  console.log(`Version unchanged: ${cur}`);
  process.exit(0);
}

let idx = indexHtml;
let js = mainJs;

// Update the script tag cache-buster (static form)
idx = idx.replace(/(\.\/src\/main\.js\?v=)(\d+\.\d+\.\d+)/g, `$1${next}`);

// Update the dynamic loader fallback that hardcodes a default version: ('?v=0.0.81')
// Matches both ('?v=0.3.3') and ('?v=0.3.3&t=' + Date.now())
idx = idx.replace(/'\?v=\d+\.\d+\.\d+([^']*?)'/g, `'?v=${next}$1'`);

idx = idx.replace(/HTML build:\s*v\d+\.\d+\.\d+/g, `HTML build: v${next}`);
js = js.replace(/NPC_DIAG_BUILD\s*=\s*'v\d+\.\d+\.\d+'/m, `NPC_DIAG_BUILD = 'v${next}'`);
js = js.replace(/version\s*:\s*'v\d+\.\d+\.\d+'/m, `version: 'v${next}'`);
js = js.replace(/buildVersion\s*:\s*'v\d+\.\d+\.\d+'/m, `buildVersion: 'v${next}'`);

if (idx===indexHtml) die('index.html not updated (no matches)');
// main.js may have one or both patterns — just verify something changed
if (js===mainJs) die('src/main.js not updated (no matches)');

fs.writeFileSync(INDEX, idx);
fs.writeFileSync(MAIN, js);

console.log(`Bumped version: ${cur} -> ${next}`);
