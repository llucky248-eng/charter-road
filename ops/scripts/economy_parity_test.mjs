#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  ITEMS,
  CITY_MULTS,
  CITY_TAX,
  SPREAD,
  WORLD_STATE,
  PRESSURE_MAP,
  CITY_TREASURY,
  seeded01,
  citySeed,
  buyPrice,
  sellPrice,
  netSellPrice,
  decideRoute,
} from './world_service.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

function assertEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function extractNumber(source, regex, label) {
  const match = source.match(regex);
  if (!match) throw new Error(`Could not find ${label}`);
  return Number(match[1]);
}

function extractCityTaxes(source) {
  const cities = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];
  return Object.fromEntries(cities.map(city => [
    city,
    extractNumber(source, new RegExp(`${city}:\\s*{[^}]*?taxRate:\\s*([0-9.]+)`, 's'), `${city} taxRate`),
  ]));
}

function extractCityMults(source) {
  const cities = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];
  const itemIds = ITEMS.map(item => item.id);
  return Object.fromEntries(cities.map(city => {
    const cityEntry = [city, Object.fromEntries(itemIds.map(itemId => [
      itemId,
      extractNumber(source, new RegExp(`${city}:\\s*{[^}]*?${itemId}:\\s*([0-9.]+)`, 's'), `${city}.${itemId}`),
    ]))];
    return cityEntry;
  }));
}

function dayWobble(day, cityId, item) {
  const cs = citySeed(cityId);
  const u = seeded01(cs ^ (item.base * 7), day, item.id.charCodeAt(0) || 0);
  return 0.97 + u * 0.06;
}

function resetMutableState() {
  WORLD_STATE.day = 499;
  WORLD_STATE.frac = 0.26;
  WORLD_STATE.seed = 42;
  for (const key of Object.keys(PRESSURE_MAP)) delete PRESSURE_MAP[key];
  Object.assign(PRESSURE_MAP, {
    'ashport:herbs': -0.23291400000812,
    'ashport:ore': 0.13289679,
    'ashport:ink': -0.0158535200154136,
    'crosshaven:potion': -0.155943554131912,
    'crosshaven:herbs': 0.0983264820507627,
    'ironholt:ore': 0.0698945995544325,
    'ironholt:ink': 0.00304847597263016,
    'valdenmere:ore': -0.235225,
    'valdenmere:potion': 0.0655596119872381,
  });
  for (const [cityId, treasury] of Object.entries(CITY_TREASURY)) {
    treasury.city_bonus.marketDiscount = 0;
  }
  CITY_TREASURY.valdenmere.city_bonus.marketDiscount = 0.15;
  CITY_TREASURY.ashport.city_bonus.marketDiscount = 0.15;
  CITY_TREASURY.crosshaven.city_bonus.marketDiscount = 0.05;
  CITY_TREASURY.ironholt.city_bonus.marketDiscount = 0.15;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src/main.js'), 'utf8');

const clientSpread = extractNumber(mainSource, /spread:\s*([0-9.]+)/, 'MARKET.spread');
const clientTaxes = extractCityTaxes(mainSource);
const clientMults = extractCityMults(mainSource);
const grainWeight = extractNumber(mainSource, /id:\s*'grain'[^\n]*weight:\s*(\d+)/, 'grain weight');
const sellBonusCap = extractNumber(mainSource, /Math\.min\(toolBonus \+ guildBonus,\s*([0-9.]+)\)/, 'sell bonus cap');

console.log('\n=== economy parity ===');

test('grain weight matches client balance table', () => {
  assertEqual(grainWeight, 1);
  assertEqual(ITEMS.find(item => item.id === 'grain')?.weight, grainWeight);
});

test('server tax table matches client tax table', () => {
  assertEqual(CITY_TAX, clientTaxes);
});

test('server city multipliers match client city multipliers', () => {
  assertEqual(CITY_MULTS, clientMults);
});

test('server spread matches client spread', () => {
  assertEqual(SPREAD, clientSpread);
});

test('sell bonus cap is 40%', () => {
  assertEqual(sellBonusCap, 0.40);
});

test('ink source restriction matches the client economy', () => {
  assertEqual(ITEMS.find(item => item.id === 'ink')?.sourceCities, ['ironholt', 'crosshaven']);
});

test('server buy/sell quotes match client formula for representative markets', () => {
  resetMutableState();
  const cases = [
    ['ashport', 'herbs'],
    ['valdenmere', 'potion'],
    ['ironholt', 'ore'],
    ['crosshaven', 'potion'],
    ['ironholt', 'ink'],
  ];

  for (const [cityId, itemId] of cases) {
    const item = ITEMS.find(entry => entry.id === itemId);
    const mult = clientMults[cityId][itemId];
    const pressure = PRESSURE_MAP[`${cityId}:${itemId}`] || 0;
    const discount = CITY_TREASURY[cityId]?.city_bonus?.marketDiscount || 0;
    const mid = Math.max(1, Math.round(item.base * mult * dayWobble(WORLD_STATE.day, cityId, item) * (1 + pressure)));
    const expectedBuy = Math.max(1, Math.round(mid * (1 + clientSpread / 2) * (1 - discount)));
    const expectedSell = Math.max(1, Math.round(mid * (1 - clientSpread / 2)));
    const expectedNetSell = Math.max(1, Math.round(expectedSell * (1 - clientTaxes[cityId])));

    assertEqual(buyPrice(cityId, item), expectedBuy, `${cityId}/${itemId} buy mismatch`);
    assertEqual(sellPrice(cityId, item), expectedSell, `${cityId}/${itemId} sell mismatch`);
    assertEqual(netSellPrice(cityId, item), expectedNetSell, `${cityId}/${itemId} net sell mismatch`);
  }
});

test('route chooser respects source-city restrictions for ink', () => {
  resetMutableState();
  const route = decideRoute({
    from_id: 'valdenmere',
    to_id: 'valdenmere',
    personality: 'aggressive',
    preferred_item: 'ink',
    gear_tier: 0,
    gold: 500,
    profit_history: [],
  });
  assert(route.itemId !== 'ink', `ink should not be sourced from valdenmere, got ${JSON.stringify(route)}`);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
