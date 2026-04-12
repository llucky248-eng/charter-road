#!/usr/bin/env node
/**
 * Offline NPC dialogue generator.
 *
 * Static-site model:
 * - Generates assets/npc_dialogue.json for the game to fetch at runtime.
 * - Intended to be run manually or by cron/CI (commit + push the updated JSON).
 * - Do NOT call this from the browser/client.
 *
 * Usage:
 *   node ops/scripts/generate_npc_dialogue.mjs [--date YYYY-MM-DD] [--out assets/npc_dialogue.json]
 *
 * Env:
 *   OPENAI_API_KEY (required for live generation)
 *   NPC_MODEL (default: gpt-5.2-mini)
 */

import fs from 'node:fs';
import path from 'node:path';

function die(msg) {
  console.error('NPC_GEN_FAIL:', msg);
  process.exit(1);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseArgs(argv) {
  const out = { date: todayISO(), outPath: 'assets/npc_dialogue.json' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') out.date = String(argv[++i] || '');
    else if (a === '--out') out.outPath = String(argv[++i] || '');
    else die(`Unknown arg: ${a}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) die(`Bad --date (expected YYYY-MM-DD): ${out.date}`);
  return out;
}

const CITY_NPCS = {
  valdenmere: [
    { id: 'valdenmere_scribe', name: 'Archivist Rowen', role: 'scribe' },
    { id: 'valdenmere_baker', name: 'Mara the Baker', role: 'baker' },
    { id: 'valdenmere_guard', name: 'Captain Venn', role: 'guard' },
  ],
  ashport: [
    { id: 'ashport_fisher', name: 'Old Maren', role: 'fisher' },
    { id: 'ashport_smuggler', name: 'Lira of the Docks', role: 'smuggler' },
    { id: 'ashport_broker', name: 'Brusk the Broker', role: 'broker' },
  ],
  crosshaven: [
    { id: 'crosshaven_innkeeper', name: 'Bram the Innkeeper', role: 'innkeeper' },
    { id: 'crosshaven_peddler', name: 'Syla the Peddler', role: 'peddler' },
    { id: 'crosshaven_guard', name: 'Pel the Guard', role: 'guard' },
  ],
  ironholt: [
    { id: 'ironholt_miner', name: 'Dag the Miner', role: 'miner' },
    { id: 'ironholt_foreman', name: 'Boss Kira', role: 'foreman' },
    { id: 'ironholt_smith', name: 'Torven the Smith', role: 'smith' },
  ],
};

function validate(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.date !== 'string') return false;
  if (!data.cities || typeof data.cities !== 'object') return false;
  for (const cityId of Object.keys(CITY_NPCS)) {
    const city = data.cities[cityId];
    if (!city || typeof city !== 'object') return false;
    if (!city.npcs || typeof city.npcs !== 'object') return false;
    for (const npc of CITY_NPCS[cityId]) {
      const lines = city.npcs[npc.id];
      if (!Array.isArray(lines) || lines.length !== 10) return false;
      if (lines.some(s => typeof s !== 'string' || !s.trim())) return false;
      // Keep roughly short & punchy.
      if (lines.some(s => s.length > 180)) return false;
    }
  }
  return true;
}

const CITY_NAMES = {
  valdenmere: 'Valdenmere',
  ashport: 'Ashport',
  crosshaven: 'Crosshaven',
  ironholt: 'Ironholt',
};

function fallbackLines(cityId, npc) {
  const cityName = CITY_NAMES[cityId] || cityId;
  const name = npc.name.split(' ')[0] || npc.name;
  const pool = [
    `${name}: ${cityName} keeps its own kind of order.`,
    `${name}: Prices shift—watch your timing.`,
    `${name}: Keep your pack light and your story lighter.`,
    `${name}: Rumors sell better than goods some days.`,
    `${name}: Coin talks; trouble listens.`,
    `${name}: The road between cities is never truly quiet.`,
    `${name}: A permit can save you a headache here.`,
    `${name}: Don’t show relics unless you mean it.`,
    `${name}: If you’re trading, count twice.`,
    `${name}: Safe travels—if such a thing exists.`,
  ];
  return pool.slice(0, 10);
}

async function openaiGenerateLines({ apiKey, model, cityId, cityName, npc, date }) {
  const sys = [
    'You write NPC dialogue for a medieval fantasy trade game.',
    'Return ONLY valid JSON with shape: {"lines": ["...10 strings..."]}.',
    'Each line must be 80-140 characters when possible; max 180.',
    'No profanity; keep it grounded and merchant-y.',
    'Avoid repeating the NPC name in every line; occasional is fine.',
  ].join(' ');

  const user = [
    `Date: ${date}`,
    `City: ${cityName} (id=${cityId})`,
    `NPC: ${npc.name} (id=${npc.id}, role=${npc.role})`,
    'Task: Generate exactly 10 short, punchy lines of ambient chatter the player can read in the city hub.',
    'Make them feel city-specific (scholarly/trade for Valdenmere; docks/lawless for Ashport; crossroads/rustic for Crosshaven; mining/industrial for Ironholt).',
  ].join('\n');

  const body = {
    model,
    input: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.8,
    max_output_tokens: 450,
  };

  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) throw new Error(`openai responses error ${r.status}`);
  const j = await r.json();

  // Attempt to extract text.
  const outText = (j.output_text || '').trim();
  if (!outText) throw new Error('no output_text');

  // Parse JSON strictly; also allow code fences.
  const cleaned = outText.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error('model output not valid JSON'); }

  const lines = parsed?.lines;
  if (!Array.isArray(lines)) throw new Error('missing lines[]');
  return lines.map(s => String(s).trim()).filter(Boolean).slice(0, 10);
}

(async () => {
  const args = parseArgs(process.argv);
  const model = process.env.NPC_MODEL || 'gpt-5.2-mini';
  const apiKey = process.env.OPENAI_API_KEY || '';

  const out = { date: args.date, cities: {} };

  for (const cityId of Object.keys(CITY_NPCS)) {
    const cityName = CITY_NAMES[cityId] || cityId;
    out.cities[cityId] = { npcs: {} };

    for (const npc of CITY_NPCS[cityId]) {
      let lines = null;
      if (apiKey) {
        try {
          lines = await openaiGenerateLines({ apiKey, model, cityId, cityName, npc, date: args.date });
        } catch (e) {
          console.warn(`NPC_GEN_WARN: ${cityId}/${npc.id}: ${String(e && (e.message || e))}`);
        }
      }
      if (!lines || lines.length < 10) lines = fallbackLines(cityId, npc);
      if (lines.length !== 10) lines = (lines.concat(fallbackLines(cityId, npc))).slice(0, 10);
      out.cities[cityId].npcs[npc.id] = lines;
    }
  }

  if (!validate(out)) die('generated output failed validation');

  const repoRoot = process.cwd();
  const outPath = path.resolve(repoRoot, args.outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

  console.log(`NPC_GEN_OK: wrote ${args.outPath} (date=${args.date}, model=${model}${apiKey ? '' : ', fallback-only'})`);
})();
