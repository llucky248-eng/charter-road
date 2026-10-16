// Pure helpers for the three.js 3D world renderer (src/world3d.js).
// No three.js, no DOM, no Date.now — unit-tested by ops/scripts/world3d_tests.mjs.
//
// Coordinate convention shared with world3d.js: one world unit = one map tile.
// Map tile (tx, ty) covers X ∈ [tx, tx+1], Z ∈ [ty, ty+1]; +Y is up, so the
// 2D game's "down the screen" (+y) is +Z (south).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Tile id → the flat tile art painted on the ground texture underneath it.
// Anything that becomes a 3D mesh (walls, buildings, trees, hills, rocks)
// gets the floor it stands on instead of its old top-down sprite.
export function groundTileFor(id, { inCity }) {
  switch (id) {
    case 0: case 1: case 2: case 4: case 9: case 11: return id;
    case 10: return 0;                      // forest: 3D trees stand on grass
    case 3: return inCity ? 4 : 0;          // wall
    case 5: return 1;                       // gate → road under the arch
    case 8: case 13: return inCity ? 4 : 1; // warehouse/bank in town; camp/cache on roads
    case 6: case 7: case 12: case 14: case 15: case 16: case 19: return 4;
    default: return 0;                      // 17 hill, 18 ore vein, unknown → grass
  }
}

// Tile id → kind of standalone 3D prop to place on it (null = ground only).
// City buildings are not per-tile props: they are built from cityBuildings slots.
export function propKindFor(id, { inCity }) {
  switch (id) {
    case 3: return 'wall';
    case 5: return 'gate';
    case 10: return 'tree';
    case 17: return 'hill';
    case 18: return 'ore';
    case 12: return 'board';
    case 8: return inCity ? null : 'camp';
    case 13: return inCity ? null : 'cache';
    default: return null;
  }
}

// Perspective camera placement. The camera sits south of (+Z) and above the
// view centre, pitched down by pitchDeg, at the distance where the ground
// visible across the screen at the target is viewTilesW tiles wide — so the
// 3D view frames roughly the same area the 2D camera did.
export function cameraRig({ centerX, centerZ, viewTilesW, aspect, pitchDeg, fovDeg }) {
  const halfFov = (fovDeg * Math.PI) / 360;
  const dist = viewTilesW / (2 * Math.tan(halfFov) * aspect);
  const pitch = (pitchDeg * Math.PI) / 180;
  return {
    dist,
    target: { x: centerX, y: 0, z: centerZ },
    pos: { x: centerX, y: dist * Math.sin(pitch), z: centerZ + dist * Math.cos(pitch) },
  };
}

// 2D facing vector (x right, y down) → rotation.y for a model whose forward is +X.
export function facingToYaw(fx, fy) {
  if (!fx && !fy) return 0;
  return Math.atan2(-fy, fx);
}

// Interpolate angles along the shortest arc.
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p, s) => (p >> s) & 255;
  const c = (s) => Math.round(lerp(ch(pa, s), ch(pb, s), t));
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
}

// Game hour (any real number; wraps) → sun/sky parameters. Night is moonlit
// and stays readable: it is a mood, not a gameplay obstacle.
export function sunForHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const s = Math.sin((Math.PI * (h - 6)) / 12);          // +1 noon, -1 midnight
  const day = clamp((s + 0.35) / 0.45, 0, 1);            // 1 = full day; dusk lingers past 18:00
  const dusk = clamp(1 - Math.abs(s) / 0.35, 0, 1) * (s > -0.35 ? 1 : 0); // warm band at sunrise/sunset
  // Stylised arc: never steeper than ~55° so buildings and trees always
  // throw readable shadows (a true overhead noon sun hides them).
  const sunElev = 0.45 + 0.5 * Math.max(0, s);
  const elevation = day > 0 ? lerp(0.6, sunElev, day) : 0.6;
  const azimuth = day > 0 ? (Math.PI * (h - 6)) / 12 : Math.PI * 0.35; // east → west; moon fixed
  const sunCol = mixHex('#fff1d6', '#ffb070', dusk);
  return {
    night: Math.round((1 - day) * 1000) / 1000,
    elevation,
    azimuth,
    intensity: lerp(0.45, 2.4, day),
    color: mixHex('#9fb4ff', sunCol, day),
    ambient: lerp(0.55, 1.15, day),
    sky: mixHex('#26324f', mixHex('#bfe3f2', '#f6c99a', dusk * 0.6), day),
    ground: mixHex('#1d2233', '#a08a62', day),
  };
}

// Plumberry palette per building tileType — mirrors _drawCityBuildingSprites
// in src/main.js (world3d_tests.mjs checks the roofs stay in sync).
const BUILDING_PALETTE = {
  7:  { roof: '#a8485e', roofFace: '#c66479', wall: '#fffaef', wallDark: '#e6d8be', glow: '#f0a830' },
  14: { roof: '#a8485e', roofFace: '#c66479', wall: '#fffaef', wallDark: '#e6d8be', glow: '#f0a830' },
  6:  { roof: '#d18816', roofFace: '#f0a830', wall: '#fffaef', wallDark: '#e8d5a8', glow: '#ffdc64' },
  8:  { roof: '#7d5230', roofFace: '#a87a3e', wall: '#fdecc4', wallDark: '#e0c890', glow: '#b48c50' },
  15: { roof: '#8a5aa3', roofFace: '#b07ec3', wall: '#fffaef', wallDark: '#e6d8be', glow: '#b07ec3' },
  12: { roof: '#4f9e5b', roofFace: '#7fbf83', wall: '#fffaef', wallDark: '#e6d8be', glow: '#7fbf83' },
  13: { roof: '#2f8f96', roofFace: '#48b0b8', wall: '#fdecc4', wallDark: '#e0c890', glow: '#48b0b8' },
  4:  { roof: '#5b6b78', roofFace: '#7a8a96', wall: '#fffaef', wallDark: '#d8d2c4', glow: '#7fbf83' },
  19: { roof: '#3a322a', roofFace: '#5c5247', wall: '#c8a878', wallDark: '#9a7a4a', glow: '#f0a830' },
};
const DEFAULT_PALETTE = { roof: '#8a5aa3', roofFace: '#b07ec3', wall: '#fffaef', wallDark: '#e6d8be', glow: '#ffdc8c' };

// cityBuildings slot → 3D dimensions (tile units) + palette.
export function buildingSpec(slot) {
  const lv = clamp(Number(slot.level) || 1, 1, 3);
  const w = slot.tileW, d = slot.tileH;
  const wallH = 1.15 + 0.4 * (lv - 1) + 0.08 * Math.min(w, d);
  const roofH = clamp(0.38 * Math.min(w, d), 0.8, 1.6);
  const pal = BUILDING_PALETTE[slot.tileType] || DEFAULT_PALETTE;
  return { w, d, wallH, roofH, level: lv, door: slot.doorSide || 'south', ...pal };
}

// WebGL normalised device coords → 2D game canvas pixels (VIEW_W × VIEW_H).
export function ndcToCanvas(nx, ny, viewW, viewH) {
  return { x: ((nx + 1) / 2) * viewW, y: ((1 - ny) / 2) * viewH };
}

// Which renderer to boot. `?r=2d` / `?r=3d` win; otherwise a stored choice; else 3D.
export function rendererPreference(search, stored) {
  const m = /[?&]r=(2d|3d)\b/.exec(search || '');
  if (m) return m[1];
  return stored === '2d' ? '2d' : '3d';
}

// Ore gem colours per metal — mirror the vein colours in drawTile (main.js).
export const ORE_COLORS = { copper: '#c47a3a', silver: '#cfcfd6', gold: '#fde047' };

// Player carriage palettes by gear tier — mirror drawPlayerCarriage in main.js
// (world3d_tests.mjs checks parity). glow = phantom-mare tier.
export const HORSE_PAL = [
  { body: '#d6b27e', mane: '#5a3818' }, { body: '#8c6238', mane: '#1f0e04' },
  { body: '#d05a28', mane: '#3a1008' }, { body: '#2a2a3a', mane: '#e8c040' },
  { body: '#e8f6ff', mane: '#ffffff', glow: true },
];
export const WAGON_PAL = [
  { body: '#b08358', roof: '#c9a578', trim: '#7a5230', wheel: '#7a5230' },
  { body: '#c89464', roof: '#fff5d6', trim: '#b07ec3', wheel: '#8a5aa3' },
  { body: '#c87a2c', roof: '#f0a830', trim: '#d18816', wheel: '#7a4810' },
  { body: '#6e4824', roof: '#fdecc4', trim: '#b07ec3', wheel: '#8a5aa3' },
  { body: '#c89464', roof: '#f0c040', trim: '#d18816', wheel: '#806010' },
];

// Ease the lit hour toward the game clock so a clock wrap (dusk → next
// morning, a forward jump of ≤14h) plays out as a quick night instead of a
// one-frame flash, while a small backward correction (e.g. a server time sync)
// just eases back. rate = fraction of the gap closed per second.
export function advanceHour(cur, target, dt, rate) {
  let gap = (((target - cur) % 24) + 24) % 24;   // forward distance
  if (gap > 14) gap -= 24;                         // short step back instead
  const k = Math.min(1, Math.max(0, dt) * rate);
  if (k >= 1 || Math.abs(gap) < 1e-4) return ((target % 24) + 24) % 24;
  return (((cur + gap * k) % 24) + 24) % 24;
}
