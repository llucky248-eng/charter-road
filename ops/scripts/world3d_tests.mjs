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
        advanceHour, ORE_COLORS, HORSE_PAL, WAGON_PAL } = core;

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
