#!/usr/bin/env node
import fs from 'node:fs';

function die(msg){ console.error('ERROR:', msg); process.exit(1); }

const arg = process.argv[2] || '+patch';

const INDEX='index.html';
const MAIN='src/main.js';

const indexHtml = fs.readFileSync(INDEX,'utf8');
const mainJs = fs.readFileSync(MAIN,'utf8');

const m = mainJs.match(/version\s*:\s*'v(\d+\.\d+\.\d+)'/);
if (!m) die('Could not find ITERATION.version in src/main.js');
const cur = m[1];

function parse(v){ const mm=String(v).match(/^(\d+)\.(\d+)\.(\d+)$/); return mm?{a:+mm[1],b:+mm[2],c:+mm[3]}:null; }
function fmt(o){ return `${o.a}.${o.b}.${o.c}`; }
function bumpPatch(v){ const o=parse(v); if(!o) return null; o.c++; return fmt(o); }

let next;
if (arg === '+patch') next = bumpPatch(cur);
else if (arg.startsWith('v')) next = arg.slice(1);
else next = arg;
if (!parse(next)) die(`Invalid version arg: ${arg}`);

let idx = indexHtml;
let js = mainJs;

idx = idx.replace(/(\.\/src\/main\.js\?v=)(\d+\.\d+\.\d+)/g, `$1${next}`);
idx = idx.replace(/HTML build:\s*v\d+\.\d+\.\d+/g, `HTML build: v${next}`);
js = js.replace(/version\s*:\s*'v\d+\.\d+\.\d+'/m, `version: 'v${next}'`);

if (idx===indexHtml) die('index.html not updated (no matches)');
if (js===mainJs) die('src/main.js not updated (no matches)');

fs.writeFileSync(INDEX, idx);
fs.writeFileSync(MAIN, js);

console.log(`Bumped version: ${cur} -> ${next}`);
