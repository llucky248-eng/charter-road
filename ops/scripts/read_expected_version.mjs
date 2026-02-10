#!/usr/bin/env node
import fs from 'node:fs';
const s = fs.readFileSync('src/main.js','utf8');
const m = s.match(/version\s*:\s*'v(\d+\.\d+\.\d+)'/);
if (!m) process.exit(1);
process.stdout.write(m[1]);
