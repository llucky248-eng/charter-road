#!/usr/bin/env node
/**
 * Unit tests for the pure helpers behind the three.js 3D world renderer
 * (src/world3d_core.js). No browser, no WebGL, no three.js.
 *
 * src/ is served as plain browser ES modules while package.json is
 * "type":"commonjs", so the module is loaded through a data: URL import
 * instead of a bare path.
 *
 * Usage:
 *   node ops/scripts/world3d_tests.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const coreSrc = readFileSync(join(ROOT, 'src/world3d_core.js'), 'utf8');
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSrc).toString('base64'));
const mainSrc = readFileSync(join(ROOT, 'src/main.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function assert(c, msg = 'assertion failed') { if (!c) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function close(a, b, tol = 1e-6, msg) { if (Math.abs(a - b) > tol) throw new Error(msg || `expected ~${b}, got ${a}`); }

const { groundTileFor, propKindFor, cameraRig, facingToYaw, lerpAngle,
        sunForHour, buildingSpec, ndcToCanvas, rendererPreference,
        advanceHour, ORE_COLORS, HORSE_PAL, WAGON_PAL,
        findTileRooms, planCityDecor, townsfolkRoutes, walkerAt,
        characterParts, CHAR_HEIGHT, CHAR_PIVOTS } = core;

console.log('\n=== world3d_core: ground substitution ===');
test('flat terrain keeps its own art', () => {
  for (const id of [0, 1, 2, 4, 9, 11]) eq(groundTileFor(id, { inCity: false }), id, `id ${id}`);
});
test('forest floor is grass — the 3D trees provide the canopy', () => eq(groundTileFor(10, { inCity: false }), 0));
test('walls sit on city floor inside a city, grass outside', () => {
  eq(groundTileFor(3, { inCity: true }), 4);
  eq(groundTileFor(3, { inCity: false }), 0);
});
test('gate is a road under the arch', () => eq(groundTileFor(5, { inCity: true }), 1));
test('building tiles become city floor (3D building drawn on top)', () => {
  for (const id of [6, 7, 12, 14, 15, 16, 19]) eq(groundTileFor(id, { inCity: true }), 4, `id ${id}`);
});
test('warehouse/bank tiles outside a city are road POIs (camp/cache)', () => {
  eq(groundTileFor(8, { inCity: false }), 1);
  eq(groundTileFor(13, { inCity: false }), 1);
  eq(groundTileFor(8, { inCity: true }), 4);
});
test('hills and ore veins stand on grass', () => {
  eq(groundTileFor(17, { inCity: false }), 0);
  eq(groundTileFor(18, { inCity: false }), 0);
});
test('unknown ids fall back to grass, never throw', () => eq(groundTileFor(99, { inCity: false }), 0));

console.log('\n=== world3d_core: 3D prop kinds ===');
test('prop kinds per tile', () => {
  eq(propKindFor(3, { inCity: true }), 'wall');
  eq(propKindFor(5, { inCity: true }), 'gate');
  eq(propKindFor(10, { inCity: false }), 'tree');
  eq(propKindFor(17, { inCity: false }), 'hill');
  eq(propKindFor(18, { inCity: false }), 'ore');
  eq(propKindFor(12, { inCity: true }), 'board');
  eq(propKindFor(8, { inCity: false }), 'camp');
  eq(propKindFor(13, { inCity: false }), 'cache');
  eq(propKindFor(8, { inCity: true }), null, 'city warehouse tiles are covered by the slot building');
  eq(propKindFor(0, { inCity: false }), null);
});

console.log('\n=== world3d_core: camera rig ===');
test('camera looks at the view centre', () => {
  const r = cameraRig({ centerX: 100, centerZ: 50, viewTilesW: 60, aspect: 16 / 9, pitchDeg: 55, fovDeg: 32 });
  close(r.target.x, 100); close(r.target.z, 50); close(r.target.y, 0);
});
test('camera sits south of and above the target at the requested pitch', () => {
  const r = cameraRig({ centerX: 0, centerZ: 0, viewTilesW: 60, aspect: 16 / 9, pitchDeg: 55, fovDeg: 32 });
  assert(r.pos.y > 0, 'above ground');
  assert(r.pos.z > 0, 'south (+Z) of target');
  close(Math.atan2(r.pos.y, r.pos.z) * 180 / Math.PI, 55, 1e-6);
  close(r.pos.x, 0);
});
test('visible ground width at the target matches viewTilesW', () => {
  const fov = 32, aspect = 16 / 9;
  const r = cameraRig({ centerX: 0, centerZ: 0, viewTilesW: 60, aspect, pitchDeg: 55, fovDeg: fov });
  const d = Math.hypot(r.pos.y, r.pos.z);
  const w = 2 * d * Math.tan(fov * Math.PI / 360) * aspect;
  close(w, 60, 1e-6);
});

console.log('\n=== world3d_core: heading ===');
test('facing east is yaw 0, south (+Z) is -90°, north is +90°', () => {
  close(facingToYaw(1, 0), 0);
  close(facingToYaw(0, 1), -Math.PI / 2);
  close(facingToYaw(0, -1), Math.PI / 2);
});
test('zero facing vector keeps a finite yaw', () => assert(Number.isFinite(facingToYaw(0, 0))));
test('lerpAngle takes the short way round', () => {
  const a = Math.PI - 0.1, b = -Math.PI + 0.1;
  const m = lerpAngle(a, b, 0.5);
  close(Math.abs(Math.cos(m) + 1), 0, 1e-6, `midpoint ${m} should be ±π`);
  close(lerpAngle(0, 1, 0.25), 0.25);
});

console.log('\n=== world3d_core: sun / day-night ===');
test('noon is brighter than midnight, but night stays readable', () => {
  const noon = sunForHour(12), night = sunForHour(0);
  assert(noon.intensity > night.intensity, 'noon brighter');
  assert(night.intensity >= 0.25, `night too dark: ${night.intensity}`);
  assert(noon.night === 0 && night.night === 1, 'night factor endpoints');
  assert(noon.elevation > night.elevation, 'sun higher at noon');
});
test('sun never climbs past ~55° (shadows stay visible at noon)', () => {
  for (let h = 0; h < 24; h += 0.5) assert(sunForHour(h).elevation <= 0.96, `hour ${h}: ${sunForHour(h).elevation}`);
});
test('sunForHour wraps hours and is deterministic', () => {
  eq(JSON.stringify(sunForHour(26)), JSON.stringify(sunForHour(2)));
  eq(JSON.stringify(sunForHour(-1)), JSON.stringify(sunForHour(23)));
  eq(JSON.stringify(sunForHour(9.5)), JSON.stringify(sunForHour(9.5)));
});

console.log('\n=== world3d_core: buildings ===');
test('building footprint matches its slot and grows with level', () => {
  const base = { tileW: 4, tileH: 3, tileType: 6, level: 1, doorSide: 'west', built: true };
  const s1 = buildingSpec(base), s3 = buildingSpec({ ...base, level: 3 });
  eq(s1.w, 4); eq(s1.d, 3);
  assert(s3.wallH > s1.wallH, 'level 3 taller than level 1');
  assert(s1.roofH > 0, 'has a roof');
});
test('building palette mirrors the 2D roofs in src/main.js', () => {
  // Each roofTop in _drawCityBuildingSprites must reach the 3D renderer
  // unchanged, so the bank/market/inn stay recognisable across renderers.
  const re = /case ([0-9: case]+):[^\n]*\n\s*roofTop\s*=\s*'(#[0-9a-f]{6})'/gi;
  let m, n = 0;
  while ((m = re.exec(mainSrc))) {
    for (const t of m[1].split(/:\s*case\s*/).map(Number)) {
      eq(buildingSpec({ tileW: 3, tileH: 3, tileType: t, level: 1 }).roof.toLowerCase(), m[2].toLowerCase(), `tileType ${t}`);
      n++;
    }
  }
  assert(n >= 7, `expected to check ≥7 building types, checked ${n}`);
});

console.log('\n=== world3d_core: palette parity with src/main.js ===');
test('ore gem colours match the 2D vein colours in drawTile', () => {
  for (const metal of ['copper', 'silver', 'gold']) {
    const m = new RegExp(`metalId === '${metal}'\\s*\\?\\s*'(#[0-9a-f]{6})'`, 'i').exec(mainSrc);
    assert(m, `no 2D colour for ${metal}`);
    eq(ORE_COLORS[metal].toLowerCase(), m[1].toLowerCase(), metal);
  }
});
function palFromMain(name) {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(mainSrc);
  assert(block, `${name} not found in main.js`);
  return [...block[1].matchAll(/\{([^}]*)\}/g)].map(m => Object.fromEntries(
    [...m[1].matchAll(/(\w+):'(#[0-9a-f]{6})'/gi)].map(x => [x[1], x[2].toLowerCase()])));
}
test('3D carriage horse palette mirrors drawPlayerCarriage HORSE_PAL', () => {
  const main = palFromMain('HORSE_PAL');
  eq(HORSE_PAL.length, main.length);
  HORSE_PAL.forEach((h, i) => { eq(h.body, main[i].body, `tier ${i} body`); eq(h.mane, main[i].mane, `tier ${i} mane`); });
});
test('3D carriage wagon palette mirrors drawPlayerCarriage WAGON_PAL', () => {
  const main = palFromMain('WAGON_PAL');
  eq(WAGON_PAL.length, main.length);
  WAGON_PAL.forEach((w, i) => { for (const k of ['body', 'roof', 'trim', 'wheel']) eq(w[k], main[i][k], `tier ${i} ${k}`); });
});

console.log('\n=== world3d_core: hour easing ===');
test('advanceHour only moves forward (dusk → next morning passes through night)', () => {
  const h = advanceHour(18.5, 7, 0.1, 4);
  assert(h > 18.5 && h < 24, `expected to move forward past 18.5, got ${h}`);
});
test('advanceHour steps back a little when the clock does (no detour through the night)', () => {
  const h = advanceHour(14, 13.3, 0.1, 4);
  assert(h < 14 && h > 13.3, `expected to ease back toward 13.3, got ${h}`);
});
test('advanceHour converges without overshooting', () => {
  let h = 10;
  for (let i = 0; i < 200; i++) h = advanceHour(h, 11, 1 / 60, 4);
  close(h, 11, 1e-3);
  eq(advanceHour(10, 11, 100, 4), 11, 'huge dt lands exactly on target');
});
test('advanceHour result stays in [0, 24)', () => {
  const h = advanceHour(23.9, 0.5, 0.05, 4);
  assert(h >= 0 && h < 24, `${h}`);
});

// ── Synthetic walled city (mirrors makeMap's shapes) ──────────────────────
//  walls ring x0..x1/y0..y1, a N–S road (x 14–15) and an E–W road (y 12),
//  a plaza (9) around the crossing with a contracts board (12), a gate (5)
//  in the south wall, one slot footprint, and a wall-ringed bank room (13).
const CITY = { x0: 0, y0: 0, x1: 29, y1: 23 };
const W = 30, H = 24;
const grid = new Array(W * H).fill(4);
const setT = (x, y, v) => { grid[y * W + x] = v; };
for (let x = 0; x < W; x++) { setT(x, 0, 3); setT(x, H - 1, 3); }
for (let y = 0; y < H; y++) { setT(0, y, 3); setT(W - 1, y, 3); }
for (let y = 1; y < H - 1; y++) { setT(14, y, 1); setT(15, y, 1); }
for (let x = 1; x < W - 1; x++) setT(x, 12, 1);
for (let y = 9; y <= 11; y++) for (let x = 10; x <= 19; x++) if (x < 14 || x > 15) setT(x, y, 9);
setT(16, 11, 12);
setT(14, H - 1, 5); setT(15, H - 1, 5);
for (let y = 16; y <= 18; y++) for (let x = 3; x <= 7; x++) setT(x, y, (y === 16 || y === 18 || x === 3 || x === 7) ? 3 : 13);
setT(7, 17, 4); // bank door (east)
const tileAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 3 : grid[y * W + x];
const SLOT = { x: 3, y: 3, w: 5, h: 3 };
const inSlot = (x, y) => x >= SLOT.x && x < SLOT.x + SLOT.w && y >= SLOT.y && y < SLOT.y + SLOT.h;
const hash = (x, y) => { let n = (x * 374761393 + y * 668265263) >>> 0; n = (n ^ (n >> 13)) >>> 0; n = (n * 1274126177) >>> 0; return ((n ^ (n >> 16)) >>> 0) / 4294967295; };

console.log('\n=== world3d_core: wall-ringed rooms (non-slot buildings) ===');
test('finds the bank room with its wall ring, type and door side', () => {
  const rooms = findTileRooms(CITY, tileAt, inSlot);
  eq(rooms.length, 1, JSON.stringify(rooms));
  const r = rooms[0];
  eq(JSON.stringify([r.x, r.y, r.w, r.h]), JSON.stringify([3, 16, 5, 3]));
  eq(r.tileType, 13); eq(r.doorSide, 'east');
});
test('slot footprints are not reported as rooms', () => {
  setT(4, 4, 6); // a market tile inside the slot footprint
  const rooms = findTileRooms(CITY, tileAt, inSlot);
  setT(4, 4, 4);
  assert(rooms.every(r => !(r.x <= 4 && 4 < r.x + r.w && r.y <= 4 && 4 < r.y + r.h)), 'slot reported as room');
});

console.log('\n=== world3d_core: city decor plan ===');
const rooms = findTileRooms(CITY, tileAt, inSlot);
const inRoom = (x, y) => rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
const blocked = (x, y) => inSlot(x, y) || inRoom(x, y);
const decor = planCityDecor(CITY, tileAt, blocked, hash);
const at = (it) => [Math.floor(it.x), Math.floor(it.z)];
test('decor is deterministic', () => eq(JSON.stringify(planCityDecor(CITY, tileAt, blocked, hash)), JSON.stringify(decor)));
test('nothing on roads, gates, footprints or rooms; only pennants on walls; only fountain/bench on the plaza', () => {
  for (const it of decor) {
    const [x, y] = at(it), t = tileAt(x, y);
    assert(t !== 1 && t !== 5, `${it.kind} on road/gate at ${x},${y}`);
    assert(!blocked(x, y), `${it.kind} inside a building at ${x},${y}`);
    if (t === 3) eq(it.kind, 'pennant', `${it.kind} on a wall at ${x},${y}`);
    if (it.kind === 'pennant') eq(t, 3, `pennant off-wall at ${x},${y}`);
    if (t === 9) assert(it.kind === 'fountain' || it.kind === 'bench', `${it.kind} on the plaza at ${x},${y}`);
    if (t === 12) assert(false, `${it.kind} on the contracts board`);
  }
});
test('street lamps line the roads and are spaced out', () => {
  const lamps = decor.filter(d => d.kind === 'lamp');
  assert(lamps.length >= 4, `only ${lamps.length} lamps`);
  for (const l of lamps) {
    const [x, y] = at(l);
    assert([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(x + dx, y + dy) === 1), `lamp at ${x},${y} not beside a road`);
  }
  for (const a of lamps) for (const b of lamps) if (a !== b) assert(Math.hypot(a.x - b.x, a.z - b.z) >= 3, 'lamps too close');
});
test('exactly one fountain, on the plaza', () => {
  const f = decor.filter(d => d.kind === 'fountain');
  eq(f.length, 1); eq(tileAt(...at(f[0])), 9);
});
test('open squares get trees/flowers; walls of buildings get crates', () => {
  assert(decor.some(d => d.kind === 'tree' || d.kind === 'flowers'), 'no greenery');
  assert(decor.some(d => d.kind === 'crates' || d.kind === 'barrel'), 'no crates/barrels');
  assert(decor.some(d => d.kind === 'stall'), 'no market stalls');
});
test('door fronts stay clear (no decor on the tile outside a room door)', () => {
  assert(!decor.some(d => at(d)[0] === 8 && at(d)[1] === 17), 'decor blocks the bank door');
});

test('unbuilt lots (tile 16, door included) keep their door step clear', () => {
  // A walled vacant lot whose door tile is 16, like initCityBuildingSlots paints.
  const g2 = grid.slice();
  const T2 = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 3 : g2[y * W + x];
  for (let y = 3; y <= 6; y++) for (let x = 20; x <= 25; x++) g2[y * W + x] = (y === 3 || y === 6 || x === 20 || x === 25) ? 3 : 16;
  g2[5 * W + 25] = 16; // east door
  const lot = (x, y) => x >= 20 && x <= 25 && y >= 3 && y <= 6;
  // hash ≡ 0 places decor everywhere it is allowed, so only the rule keeps the step clear.
  const plan = planCityDecor(CITY, T2, (x, y) => lot(x, y) || blocked(x, y), () => 0);
  assert(!plan.some(d => Math.floor(d.x) === 26 && Math.floor(d.z) === 5), 'decor on the vacant lot door step');
  eq(findTileRooms(CITY, T2, (x, y) => lot(x, y) || inSlot(x, y)).filter(r => r.x === 20).length, 0, 'walled slot reported as a room');
});
test('fountain never sits beside a road or the contracts board', () => {
  const f = decor.find(d => d.kind === 'fountain');
  const [x, y] = at(f);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert(![1, 12].includes(tileAt(x + dx, y + dy)), `fountain at ${x},${y} touches road/board`);
  // A plaza that is all road-side gets no fountain at all.
  const g3 = grid.slice();
  for (let y = 9; y <= 11; y++) for (let x = 10; x <= 19; x++) if (g3[y * W + x] === 9) g3[y * W + x] = 4;
  for (const x of [10, 11, 12, 13, 17, 18, 19]) g3[11 * W + x] = 9;
  const T3 = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H) ? 3 : g3[yy * W + xx];
  eq(planCityDecor(CITY, T3, blocked, hash).filter(d => d.kind === 'fountain').length, 0);
});

console.log('\n=== world3d_core: townsfolk ===');
const routes = townsfolkRoutes(CITY, tileAt, 6, hash);
test('routes follow straight road runs inside the city', () => {
  assert(routes.length >= 1, 'no routes');
  for (const r of routes) {
    assert(r.ax === r.bx || r.az === r.bz, 'route not axis-aligned');
    const n = Math.round(Math.hypot(r.bx - r.ax, r.bz - r.az));
    assert(n >= 5, 'route too short');
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = Math.floor(r.ax + (r.bx - r.ax) * k), z = Math.floor(r.az + (r.bz - r.az) * k);
      assert([1, 9].includes(tileAt(x, z)), `route leaves the road at ${x},${z}`);
    }
  }
});
test('walkers stay on their route, are deterministic and face their heading', () => {
  const r = routes[0];
  let prev = null;
  for (let t = 0; t < 60; t += 0.25) {
    const p = walkerAt(r, t);
    eq(JSON.stringify(p), JSON.stringify(walkerAt(r, t)));
    const minX = Math.min(r.ax, r.bx) - 1e-9, maxX = Math.max(r.ax, r.bx) + 1e-9;
    const minZ = Math.min(r.az, r.bz) - 1e-9, maxZ = Math.max(r.az, r.bz) + 1e-9;
    assert(p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ, `off route at t=${t}`);
    if (prev && p.moving && prev.moving) {
      const dx = p.x - prev.x, dz = p.z - prev.z;
      if (Math.hypot(dx, dz) > 1e-6) assert(dx * p.fx + dz * p.fy >= 0, `facing opposes motion at t=${t}`);
    }
    prev = p;
  }
});
test('walker looks are a raw index, so every look in any wardrobe size gets used', () => {
  const looks = new Set(townsfolkRoutes(CITY, tileAt, 40, hash).map(r => r.style % 8));
  assert(looks.size >= 7, `only ${looks.size} of 8 looks used`);
});
test('walkers turn around at the ends (both ends get visited)', () => {
  const r = routes[0];
  let nearA = false, nearB = false;
  for (let t = 0; t < 200; t += 0.5) {
    const p = walkerAt(r, t);
    if (Math.hypot(p.x - r.ax, p.z - r.az) < 0.6) nearA = true;
    if (Math.hypot(p.x - r.bx, p.z - r.bz) < 0.6) nearB = true;
  }
  assert(nearA && nearB, 'walker never reached both ends');
});

console.log('\n=== world3d_core: characters (player + NPCs share one rig) ===');
const PLAYER_LOOK = { skin: '#f0c9a0', hair: '#4a3320', shirt: '#b07ec3', hat: 'travelhat', boots: '#8a5a30', merchantKit: true };
const GUARD_LOOK = { skin: '#e6c08a', hair: '#3b2a1d', shirt: '#7a8a96', hat: 'helm' };
const top = (p) => p.p[1] + (CHAR_PIVOTS[p.group] ? CHAR_PIVOTS[p.group][1] : 0) + p.s[1] / 2;
const bottom = (p) => p.p[1] + (CHAR_PIVOTS[p.group] ? CHAR_PIVOTS[p.group][1] : 0) - p.s[1] / 2;
const body = (look) => characterParts(look).parts.filter(p => !p.part.startsWith('hat') && !['vest', 'belt', 'satchel', 'pouch', 'strap'].includes(p.part));
test('player and NPCs share the exact same body (size, proportions, limbs)', () => {
  const geo = (look) => JSON.stringify(body(look).map(p => [p.part, p.group, p.shape, p.p, p.s]));
  eq(geo(PLAYER_LOOK), geo(GUARD_LOOK));
  eq(geo(PLAYER_LOOK), geo({ skin: '#fff', hair: '#000', shirt: '#123456', hat: 'straw' }));
});
test('the head tops out at CHAR_HEIGHT and feet stand on the ground', () => {
  const parts = characterParts(GUARD_LOOK).parts;
  close(Math.max(...body(GUARD_LOOK).map(top)), CHAR_HEIGHT, 1e-6);
  close(Math.min(...parts.map(bottom)), 0, 1e-6);
});
test('hats sit on the head and stay modest', () => {
  for (const hat of ['straw', 'travelhat', 'tophat', 'helm', 'hood', 'scribeHood', 'cap', 'bakerCap', 'sailor']) {
    const r = characterParts({ ...GUARD_LOOK, hat });
    eq(r.hat, hat, `hat ${hat} fell back`);
    const hats = r.parts.filter(p => p.part.startsWith('hat'));
    assert(hats.length >= 1, `no parts for ${hat}`);
    const t = Math.max(...hats.map(top));
    assert(t > CHAR_HEIGHT - 0.1 && t <= CHAR_HEIGHT + 0.42, `${hat} top ${t.toFixed(2)} out of range`);
  }
});
test('every hat the game uses is a real 3D hat (no silent fallback)', () => {
  const used = new Set([...mainSrc.matchAll(/hat:\s*'(\w+)'/g)].map(m => m[1]));
  for (const t of mainSrc.matchAll(/'(\w+)'\s*:\s*packTier/g)) used.add(t[1]);
  for (const h of ['straw', 'travelhat', 'tophat']) used.add(h);
  for (const hat of used) eq(characterParts({ ...GUARD_LOOK, hat }).hat, hat, `hat '${hat}' from main.js unsupported`);
});
test('unknown hats fall back to straw rather than throwing', () => eq(characterParts({ ...GUARD_LOOK, hat: 'crown?' }).hat, 'straw'));
test('only the merchant kit look gets vest, belt, satchel and coin pouch', () => {
  const kit = (look) => characterParts(look).parts.filter(p => ['vest', 'belt', 'satchel', 'pouch'].includes(p.part)).map(p => p.part);
  for (const k of ['vest', 'belt', 'satchel', 'pouch']) assert(kit(PLAYER_LOOK).includes(k), `player missing ${k}`);
  eq(kit(GUARD_LOOK).length, 0, 'NPC wears the merchant kit');
});
test('look colours reach the right parts; face looks forward (+X)', () => {
  const parts = characterParts(PLAYER_LOOK).parts;
  eq(parts.find(p => p.part === 'torso').color, PLAYER_LOOK.shirt);
  eq(parts.find(p => p.part === 'head').color, PLAYER_LOOK.skin);
  assert(parts.filter(p => p.part === 'boot').every(p => p.color === PLAYER_LOOK.boots), 'boot colour');
  const eyes = parts.filter(p => p.part === 'eye');
  eq(eyes.length, 2);
  const head = parts.find(p => p.part === 'head');
  assert(eyes.every(e => e.p[0] > head.p[0]), 'eyes not on the front of the head');
});
test('limbs live in their pivot groups (so they can swing)', () => {
  const parts = characterParts(GUARD_LOOK).parts;
  for (const g of ['legL', 'legR', 'armL', 'armR']) assert(parts.some(p => p.group === g), `no ${g} parts`);
  assert(parts.filter(p => p.group === 'legL').every(p => p.p[1] <= 0), 'leg parts must hang below the hip pivot');
});
test('2D fallback: player and NPC figures are drawn at one shared scale', () => {
  // The function's own body: from its declaration to the closing brace at the
  // same indentation (drawPlayer is nested two spaces deep, drawNpcEntity isn't).
  const body = (name) => {
    const m = new RegExp(`\\n( *)function ${name}\\(`).exec(mainSrc);
    assert(m, `${name} not found`);
    const end = mainSrc.indexOf(`\n${m[1]}}`, m.index + 1);
    return mainSrc.slice(m.index, end);
  };
  for (const fn of ['drawPlayer', 'drawNpcEntity']) {
    const src = body(fn);
    assert(/_drawFigure\([^,]+,\s*FIGURE_SCALE\s*,/.test(src), `${fn} must draw with FIGURE_SCALE, not its own scale`);
  }
});
test('characterParts is deterministic and pure', () => {
  eq(JSON.stringify(characterParts(PLAYER_LOOK)), JSON.stringify(characterParts(PLAYER_LOOK)));
});

console.log('\n=== world3d_core: projection + preference ===');
test('ndcToCanvas maps the NDC square onto the 2D canvas', () => {
  const a = ndcToCanvas(-1, 1, 960, 540), b = ndcToCanvas(1, -1, 960, 540), c = ndcToCanvas(0, 0, 960, 540);
  close(a.x, 0); close(a.y, 0); close(b.x, 960); close(b.y, 540); close(c.x, 480); close(c.y, 270);
});
test('renderer preference: 3D by default, ?r=2d or stored 2d opts out', () => {
  eq(rendererPreference('', null), '3d');
  eq(rendererPreference('?r=2d', null), '2d');
  eq(rendererPreference('?qa=1&r=3d', '2d'), '3d', 'query beats storage');
  eq(rendererPreference('', '2d'), '2d');
  eq(rendererPreference('?r=bogus', null), '3d');
});

console.log(`\n${'─'.repeat(40)}\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
