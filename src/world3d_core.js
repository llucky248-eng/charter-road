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

// ── City life: non-slot buildings, street decor, townsfolk ─────────────────
// All pure + deterministic (hash-driven); the renderer only draws the results.
// `rect` is a city's wall ring in tiles: { x0, y0, x1, y1 } (inclusive).

const ROOM_TILES = new Set([6, 7, 8, 13, 14, 15, 16, 19]);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Building rooms the map carves out of walls but that are not cityBuildings
// slots (e.g. a bank): flood-fill each cluster of building tiles, then take
// its wall ring as the footprint. Returns [{ x, y, w, h, tileType, doorSide }].
export function findTileRooms(rect, tileAt, isFootprint) {
  const seen = new Set(), rooms = [];
  const inRect = (x, y) => x > rect.x0 && x < rect.x1 && y > rect.y0 && y < rect.y1;
  for (let y = rect.y0 + 1; y < rect.y1; y++) {
    for (let x = rect.x0 + 1; x < rect.x1; x++) {
      const k0 = y * 100000 + x;
      if (seen.has(k0) || !ROOM_TILES.has(tileAt(x, y)) || isFootprint(x, y)) continue;
      let minX = x, maxX = x, minY = y, maxY = y;
      const counts = new Map(), stack = [[x, y]];
      seen.add(k0);
      while (stack.length) {
        const [cx, cy] = stack.pop();
        const t = tileAt(cx, cy);
        counts.set(t, (counts.get(t) || 0) + 1);
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (const [dx, dy] of N4) {
          const nx = cx + dx, ny = cy + dy, k = ny * 100000 + nx;
          if (seen.has(k) || !inRect(nx, ny) || !ROOM_TILES.has(tileAt(nx, ny)) || isFootprint(nx, ny)) continue;
          seen.add(k); stack.push([nx, ny]);
        }
      }
      const rx = minX - 1, ry = minY - 1, rw = maxX - minX + 3, rh = maxY - minY + 3;
      let ring = 0, walls = 0, door = null;
      for (let yy = ry; yy < ry + rh; yy++) for (let xx = rx; xx < rx + rw; xx++) {
        if (xx !== rx && xx !== rx + rw - 1 && yy !== ry && yy !== ry + rh - 1) continue;
        ring++;
        if (tileAt(xx, yy) === 3) { walls++; continue; }
        const corner = (xx === rx || xx === rx + rw - 1) && (yy === ry || yy === ry + rh - 1);
        if (!door && !corner) {
          door = xx === rx ? 'west' : xx === rx + rw - 1 ? 'east' : yy === ry ? 'north' : 'south';
        }
      }
      if (walls / ring < 0.6) continue; // not a walled room (e.g. a loose POI tile)
      const tileType = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      rooms.push({ x: rx, y: ry, w: rw, h: rh, tileType, doorSide: door || 'south' });
    }
  }
  return rooms;
}

// Street furniture for one city. `blocked(x,y)` = inside a building footprint
// (slot or room). Items: { kind, x, z, rot, s, v } in world units (tile centre
// + small jitter), kinds: pennant (on the city wall), fountain, bench (plaza),
// lamp, stall, crates, barrel, tree, flowers (city floor). Never on roads,
// gates, the contracts board, footprints, or a door's front step.
export function planCityDecor(rect, tileAt, blocked, hash) {
  const items = [], taken = new Set();
  const key = (x, y) => y * 100000 + x;
  const T = (x, y) => tileAt(x, y);
  const isFloor = (x, y) => T(x, y) === 4 && !blocked(x, y);
  const adj4 = (x, y, f) => N4.some(([dx, dy]) => f(x + dx, y + dy));
  const adj8 = (x, y, f) => N8.some(([dx, dy]) => f(x + dx, y + dy));
  const interior = [];
  for (let y = rect.y0 + 1; y < rect.y1; y++) for (let x = rect.x0 + 1; x < rect.x1; x++) interior.push([x, y]);

  // Keep clear: a door's front step — any non-wall tile of a footprint that
  // touches the street (built doors are floor 4, vacant lots paint theirs 16,
  // so a whole vacant lot keeps its rim clear) — and around gate and board.
  const reserved = new Set();
  for (const [x, y] of interior) {
    if (blocked(x, y) && T(x, y) !== 3) for (const [dx, dy] of N4) if (!blocked(x + dx, y + dy)) reserved.add(key(x + dx, y + dy));
    if (T(x, y) === 12 || adj8(x, y, (a, b) => T(a, b) === 5 || T(a, b) === 12)) reserved.add(key(x, y));
  }
  const free = (x, y) => !taken.has(key(x, y)) && !reserved.has(key(x, y));
  const jit = (x, y, k) => (hash(x * 3 + k, y * 7 - k) - 0.5) * 0.4;
  const put = (kind, x, y, extra = {}) => {
    taken.add(key(x, y));
    items.push({ kind, x: x + 0.5 + jit(x, y, 1), z: y + 0.5 + jit(x, y, 2), rot: hash(x + 13, y + 29) * Math.PI * 2, s: 0.85 + hash(x + 5, y + 11) * 0.3, v: hash(x + 71, y + 3), ...extra });
  };
  const near = (kind, x, y, d) => items.some(it => it.kind === kind && Math.hypot(it.x - (x + 0.5), it.z - (y + 0.5)) < d);

  // Pennants along the city wall (not beside the gate).
  for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
    const onRing = x === rect.x0 || x === rect.x1 || y === rect.y0 || y === rect.y1;
    if (!onRing || T(x, y) !== 3 || (x + y) % 8 !== 0 || adj8(x, y, (a, b) => T(a, b) === 5)) continue;
    items.push({ kind: 'pennant', x: x + 0.5, z: y + 0.5, rot: 0, s: 1, v: hash(x, y) });
  }

  // Fountain: the plaza tile farthest from the roads and the contracts board.
  const plaza = interior.filter(([x, y]) => T(x, y) === 9 && !blocked(x, y));
  const busy = interior.filter(([x, y]) => T(x, y) === 1 || T(x, y) === 12);
  let fountain = null, best = -1;
  for (const [x, y] of plaza) {
    let d = Infinity;
    for (const [bx, by] of busy) d = Math.min(d, Math.hypot(bx - x, by - y));
    if (d > best) { best = d; fountain = [x, y]; }
  }
  // Its basin overhangs its tile, so it needs a full tile of clearance.
  if (fountain && plaza.length >= 6 && best >= 2 && free(fountain[0], fountain[1])) put('fountain', fountain[0], fountain[1], { x: fountain[0] + 0.5, z: fountain[1] + 0.5 });

  // Benches on the plaza's rim.
  for (const [x, y] of plaza) {
    if (items.filter(i => i.kind === 'bench').length >= 4) break;
    if (!free(x, y) || !adj4(x, y, isFloor) || hash(x + 3, y + 17) > 0.35) continue;
    if (near('bench', x, y, 3) || near('fountain', x, y, 1.5)) continue;
    put('bench', x, y);
  }

  // Street lamps on the floor beside roads, ≥4 tiles apart, nudged to the kerb.
  for (const [x, y] of interior) {
    if (!isFloor(x, y) || !free(x, y) || !adj4(x, y, (a, b) => T(a, b) === 1)) continue;
    if (hash(x + 101, y + 7) > 0.55 || near('lamp', x, y, 4)) continue;
    const [dx, dy] = N4.find(([ax, ay]) => T(x + ax, y + ay) === 1);
    put('lamp', x, y, { x: x + 0.5 + dx * 0.32, z: y + 0.5 + dy * 0.32 });
  }

  // Market stalls around the plaza, facing it.
  for (const [x, y] of interior) {
    if (items.filter(i => i.kind === 'stall').length >= 4) break;
    if (!isFloor(x, y) || !free(x, y) || !adj8(x, y, (a, b) => T(a, b) === 9)) continue;
    if (adj4(x, y, (a, b) => T(a, b) === 1) || near('stall', x, y, 2.5)) continue;
    const p = N8.find(([dx, dy]) => T(x + dx, y + dy) === 9);
    put('stall', x, y, { rot: Math.atan2(-p[1], p[0]) });
  }

  // Crates and barrels stacked against walls and buildings, off the street.
  for (const [x, y] of interior) {
    if (!isFloor(x, y) || !free(x, y) || adj4(x, y, (a, b) => T(a, b) === 1)) continue;
    if (!adj4(x, y, (a, b) => blocked(a, b) || T(a, b) === 3)) continue;
    const h = hash(x + 41, y + 59);
    if (h < 0.07) put('barrel', x, y); else if (h < 0.16) put('crates', x, y);
  }

  // Trees and flower beds in the open squares, away from the roads.
  const open = (x, y) => isFloor(x, y) && N8.every(([dx, dy]) => isFloor(x + dx, y + dy))
    && !N8.some(([dx, dy]) => T(x + 2 * dx, y + 2 * dy) === 1);
  for (const [x, y] of interior) {
    if (!free(x, y) || !open(x, y)) continue;
    const h = hash(x + 7, y + 3);
    if (h < 0.1 && !near('tree', x, y, 3)) put('tree', x, y);
    else if (h >= 0.1 && h < 0.16 && !near('flowers', x, y, 2.5)) put('flowers', x, y);
  }
  return items;
}

// Ambient townsfolk walk straight road runs inside the city. Each route is a
// sub-stretch of a run (so walkers spread out), with its own pace and phase.
export function townsfolkRoutes(rect, tileAt, n, hash) {
  const runs = [];
  const scan = (horizontal) => {
    for (let o = horizontal ? rect.y0 + 1 : rect.x0 + 1; o <= (horizontal ? rect.y1 - 1 : rect.x1 - 1); o++) {
      let start = null;
      const lo = horizontal ? rect.x0 + 1 : rect.y0 + 1, hi = horizontal ? rect.x1 - 1 : rect.y1 - 1;
      for (let i = lo; i <= hi + 1; i++) {
        const isRoad = i <= hi && (horizontal ? tileAt(i, o) : tileAt(o, i)) === 1;
        if (isRoad && start === null) start = i;
        if (!isRoad && start !== null) {
          if (i - start >= 6) runs.push(horizontal ? { ax: start, az: o, bx: i - 1, bz: o } : { ax: o, az: start, bx: o, bz: i - 1 });
          start = null;
        }
      }
    }
  };
  scan(true); scan(false);
  if (!runs.length) return [];
  runs.sort((a, b) => (Math.abs(b.bx - b.ax) + Math.abs(b.bz - b.az)) - (Math.abs(a.bx - a.ax) + Math.abs(a.bz - a.az)));
  const routes = [];
  for (let k = 0; k < n; k++) {
    const r = runs[k % runs.length];
    const h1 = hash(k * 31 + r.ax, r.az + 17), h2 = hash(r.bx + 3, k * 13 + r.bz), h3 = hash(k + 99, k * 7 + 5);
    const len = Math.abs(r.bx - r.ax) + Math.abs(r.bz - r.az);
    const seg = Math.min(len, Math.max(5, Math.round(len * (0.45 + 0.5 * h1))));
    const off = Math.floor(h2 * (len - seg + 1));
    const ux = Math.sign(r.bx - r.ax), uz = Math.sign(r.bz - r.az);
    const sx = r.ax + ux * off, sz = r.az + uz * off;
    routes.push({
      ax: sx + 0.5, az: sz + 0.5, bx: sx + ux * seg + 0.5, bz: sz + uz * seg + 0.5,
      // style is a raw index; the painter takes it modulo its wardrobe size.
      speed: 0.8 + 0.5 * h3, pause: 1 + 2 * h1, phase: h2 * 100, style: Math.floor(hash(k * 17 + 3, k * 5 + 11) * 9973), id: k,
    });
  }
  return routes;
}

// Position of a townsfolk walker at time tSec: a → b, pause, b → a, pause.
// fx/fy = heading in the 2D game's axes (x right, y down) for the painter.
export function walkerAt(route, tSec) {
  const L = Math.hypot(route.bx - route.ax, route.bz - route.az);
  const leg = L / route.speed, cycle = 2 * (leg + route.pause);
  const u = (((tSec + route.phase) % cycle) + cycle) % cycle;
  const dx = (route.bx - route.ax) / (L || 1), dz = (route.bz - route.az) / (L || 1);
  if (u < leg) { const k = u / leg; return { x: route.ax + (route.bx - route.ax) * k, z: route.az + (route.bz - route.az) * k, fx: dx, fy: dz, moving: true }; }
  if (u < leg + route.pause) return { x: route.bx, z: route.bz, fx: dx, fy: dz, moving: false };
  if (u < 2 * leg + route.pause) { const k = (u - leg - route.pause) / leg; return { x: route.bx + (route.ax - route.bx) * k, z: route.bz + (route.az - route.bz) * k, fx: -dx, fy: -dz, moving: true }; }
  return { x: route.ax, z: route.az, fx: -dx, fy: -dz, moving: false };
}

// ── Characters ─────────────────────────────────────────────────────────────
// One rig for the player, NPCs and townsfolk: same body, same size; only the
// look (colours, hat, the player's merchant kit) differs. Units are tiles,
// feet at y=0, facing +X, left = +Z. Limb parts are relative to their group's
// pivot (CHAR_PIVOTS) so the renderer can swing them for the walk cycle.
// Part: { part, group, shape: box|sphere|cyl|cone, p:[x,y,z], s:[w,h,d], color, r? }.
export const CHAR_HEIGHT = 1.35;
export const CHAR_PIVOTS = {
  legL: [0, 0.5, 0.1], legR: [0, 0.5, -0.1],
  armL: [0, 0.96, 0.24], armR: [0, 0.96, -0.24],
};
const HATS = {
  straw: (P) => {
    P('hatBrim', 'cyl', [0, 1.3, 0], [0.64, 0.03, 0.64], '#e8c87a');
    P('hatCrown', 'cyl', [0, 1.39, 0], [0.3, 0.16, 0.3], '#e8c87a');
    P('hatBand', 'cyl', [0, 1.34, 0], [0.31, 0.04, 0.31], '#c0504d');
  },
  travelhat: (P) => {
    P('hatBrim', 'cyl', [0, 1.31, 0], [0.58, 0.03, 0.58], '#6b4a2c');
    P('hatCrown', 'cyl', [0, 1.42, 0], [0.32, 0.2, 0.32], '#7d5230');
    P('hatBand', 'cyl', [0, 1.35, 0], [0.33, 0.04, 0.33], '#d4a020');
    P('hatFeather', 'box', [-0.06, 1.47, 0.15], [0.2, 0.03, 0.05], '#e57389', [0, 0, 0.6]);
  },
  tophat: (P) => {
    P('hatBrim', 'cyl', [0, 1.31, 0], [0.5, 0.03, 0.5], '#2a2230');
    P('hatCrown', 'cyl', [0, 1.5, 0], [0.3, 0.36, 0.3], '#2a2230');
    P('hatBand', 'cyl', [0, 1.37, 0], [0.31, 0.05, 0.31], '#d4a020');
  },
  helm: (P) => {
    P('hatDome', 'sphere', [0, 1.24, 0], [0.46, 0.3, 0.46], '#9aa4ae');
    P('hatRidge', 'box', [0, 1.37, 0], [0.38, 0.04, 0.05], '#7a8590');
    P('hatPlume', 'cone', [-0.02, 1.48, 0], [0.09, 0.2, 0.09], '#c0504d');
  },
  hood: (P) => {
    P('hatHood', 'sphere', [-0.08, 1.18, 0], [0.48, 0.44, 0.48], '#5b5561');
    P('hatPeak', 'cone', [-0.14, 1.42, 0], [0.16, 0.12, 0.16], '#5b5561');
  },
  scribeHood: (P) => {
    P('hatHood', 'sphere', [-0.08, 1.18, 0], [0.48, 0.44, 0.48], '#7a5a3a');
    P('hatTassel', 'sphere', [-0.2, 1.38, 0], [0.08, 0.08, 0.08], '#d4a020');
  },
  cap: (P) => {
    P('hatCrown', 'sphere', [0, 1.28, 0], [0.43, 0.2, 0.43], '#4a5a6a');
    P('hatVisor', 'box', [0.2, 1.27, 0], [0.16, 0.025, 0.26], '#3a4652');
  },
  bakerCap: (P) => {
    P('hatBand', 'cyl', [0, 1.34, 0], [0.36, 0.1, 0.36], '#ffffff');
    P('hatPuff', 'sphere', [0, 1.45, 0], [0.44, 0.2, 0.44], '#fbfbf6');
  },
  sailor: (P) => {
    P('hatCrown', 'cyl', [0, 1.33, 0], [0.42, 0.09, 0.42], '#ffffff');
    P('hatBand', 'cyl', [0, 1.3, 0], [0.43, 0.035, 0.43], '#2f5a8a');
  },
};

export function characterParts(look) {
  const parts = [];
  const P = (part, shape, p, s, color, r) => parts.push(r ? { part, group: 'body', shape, p, s, color, r } : { part, group: 'body', shape, p, s, color });
  const L = (group, part, shape, p, s, color) => parts.push({ part, group, shape, p, s, color });
  const skin = look.skin || '#f0c9a0', hair = look.hair || '#4a3320', shirt = look.shirt || '#c7b9a5';
  const pants = look.pants || '#4f3b2a', boots = look.boots || '#5a3d28';

  // Body: torso, hips, neck, head with hair and a simple storybook face.
  P('hips', 'cyl', [0, 0.52, 0], [0.32, 0.12, 0.36], pants);
  P('torso', 'cyl', [0, 0.74, 0], [0.34, 0.46, 0.4], shirt);
  P('collar', 'cyl', [0, 0.96, 0], [0.26, 0.04, 0.3], mixHex(shirt, '#ffffff', 0.25));
  P('neck', 'cyl', [0, 1.0, 0], [0.12, 0.08, 0.12], skin);
  P('head', 'sphere', [0, 1.14, 0], [0.4, 0.42, 0.4], skin);
  P('hair', 'sphere', [-0.04, 1.18, 0], [0.4, 0.34, 0.42], hair);
  for (const z of [0.075, -0.075]) {
    P('eye', 'sphere', [0.18, 1.15, z], [0.05, 0.07, 0.05], '#2a1a10');
    P('brow', 'box', [0.185, 1.215, z], [0.02, 0.02, 0.075], mixHex(hair, '#000000', 0.2));
    P('cheek', 'sphere', [0.16, 1.085, z * 1.45], [0.04, 0.03, 0.05], '#f2a0a0');
  }
  P('nose', 'sphere', [0.2, 1.12, 0], [0.05, 0.05, 0.05], mixHex(skin, '#c07050', 0.25));
  P('mouth', 'box', [0.195, 1.06, 0], [0.012, 0.016, 0.06], '#8a4030');

  // Limbs (relative to their pivots).
  for (const g of ['legL', 'legR']) {
    L(g, 'leg', 'cyl', [0, -0.2, 0], [0.13, 0.36, 0.13], pants);
    L(g, 'boot', 'box', [0.03, -0.44, 0], [0.2, 0.12, 0.14], boots);
  }
  for (const g of ['armL', 'armR']) {
    L(g, 'sleeve', 'cyl', [0, -0.15, 0], [0.11, 0.3, 0.11], shirt);
    L(g, 'hand', 'sphere', [0, -0.34, 0], [0.1, 0.1, 0.1], skin);
  }

  // The player's merchant kit: vest, belt, coin pouch, satchel on a strap.
  if (look.merchantKit) {
    P('vest', 'cyl', [0, 0.76, 0], [0.37, 0.38, 0.43], mixHex(shirt, '#000000', 0.35));
    P('belt', 'cyl', [0, 0.54, 0], [0.36, 0.05, 0.42], '#6b4a2c');
    P('pouch', 'sphere', [0.06, 0.48, 0.21], [0.1, 0.12, 0.08], '#d4a020');
    P('strap', 'box', [0, 0.78, 0], [0.38, 0.05, 0.45], '#6b4a2c', [0.65, 0, 0]);
    P('satchel', 'box', [-0.08, 0.6, -0.24], [0.16, 0.16, 0.07], '#7d5230');
  }

  const hat = HATS[look.hat] ? look.hat : 'straw';
  HATS[hat](P);
  return { parts, hat, height: CHAR_HEIGHT };
}

// ── World map: organic terrain, mountains, bridges, wilderness ─────────────
// Visual only: the tile map (what is walkable, where roads and cities are) is
// untouched; these turn it into terrain colours, heights and props.

const ih = (x, y, seed) => {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
// Smooth 2D value noise in [0,1].
export function vnoise(x, y, seed = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = ih(x0, y0, seed), b = ih(x0 + 1, y0, seed), c = ih(x0, y0 + 1, seed), d = ih(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

// For each hill tile (17), how many tiles deep into its range it sits
// (Chebyshev distance to the nearest non-hill tile; 0 off the range).
export function hillDepthMap(tileAt, W, H, cap = 8) {
  const depth = new Uint8Array(W * H);
  let frontier = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (tileAt(x, y) === 17) depth[y * W + x] = 255; else frontier.push([x, y]);
  }
  for (let d = 1; d <= cap && frontier.length; d++) {
    const next = [];
    for (const [x, y] of frontier) for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || depth[ny * W + nx] !== 255) continue;
      depth[ny * W + nx] = d; next.push([nx, ny]);
    }
    frontier = next;
  }
  for (let i = 0; i < depth.length; i++) if (depth[i] === 255) depth[i] = cap;
  return depth;
}

// Height of the terrain at tile corner (cx, cz): 0 wherever any of its four
// tiles is off the range (so everything walkable stays flat), rising with
// depth into a mountain, with noise for ridges.
export function cornerHeight(cx, cz, depthAt, seed = 7) {
  const d = Math.min(depthAt(cx - 1, cz - 1), depthAt(cx, cz - 1), depthAt(cx - 1, cz), depthAt(cx, cz));
  if (d <= 0) return 0;
  const ridge = vnoise(cx * 0.23, cz * 0.23, seed) * 0.8 + vnoise(cx * 0.61, cz * 0.61, seed + 1) * 0.35;
  // Capped low: the camera looks north, and taller ridges would hide the
  // roads (and the player) just beyond them.
  return Math.min(3, (0.45 * d + 0.12 * d * d) * (0.75 + ridge * 0.5));
}

// Road tile carrying the road across water → { axis: 'ns'|'ew', railN/S/E/W }.
// A crossing has water on both sides of the road band along one line (a road
// merely running along a river bank only has water on one side).
export function bridgeAt(tx, ty, tileAt) {
  if (tileAt(tx, ty) !== 1) return null;
  const waterAcross = (dx, dy) => {
    for (let k = 1; k <= 16; k++) {        // roads can be a ford-wide band
      const t = tileAt(tx + dx * k, ty + dy * k);
      if (t === 2) return true;
      if (t !== 1) return false;
    }
    return false;
  };
  const ns = waterAcross(-1, 0) && waterAcross(1, 0);   // river runs E–W across a N–S road
  const ew = waterAcross(0, -1) && waterAcross(0, 1);
  if (!ns && !ew) return null;
  const w = (dx, dy) => tileAt(tx + dx, ty + dy) === 2;
  return { axis: ns ? 'ns' : 'ew', railN: w(0, -1), railS: w(0, 1), railE: w(1, 0), railW: w(-1, 0) };
}

const isCityTile = (t) => t === 3 || t === 4 || t === 5 || t === 9 || t === 12 || (t >= 6 && t <= 8) || (t >= 13 && t <= 16) || t === 19;
const fieldPatch = (tx, ty, tileAt, env) => {
  if (tileAt(tx, ty) !== 0) return null;
  const d = env.cityDist(tx, ty);
  if (d < 2 || d > 9) return null;
  if (N4.some(([dx, dy]) => tileAt(tx + dx, ty + dy) === 1)) return null;
  const px = Math.floor(tx / 4), py = Math.floor(ty / 3);
  const h = env.hash(px * 31 + 7, py * 17 + 3);
  return h < 0.55 ? Math.floor(env.hash(px + 11, py + 5) * 4) : null; // crop type 0..3
};

// Terrain paint category for a tile (city tiles keep their own 2D art).
export function terrainCategory(tx, ty, tileAt, env) {
  if (env.cityDist(tx, ty) === 0) return 'city';   // inside the walls: the city's own art
  const t = tileAt(tx, ty);
  switch (t) {
    case 0: case 18: return fieldPatch(tx, ty, tileAt, env) !== null ? 'field' : 'grass';
    case 1: return 'road';
    case 2: return 'sand';
    case 10: return 'forest';
    case 11: return 'swamp';
    case 17: { const d = env.depthAt(tx, ty); return d >= 5 ? 'snow' : d >= 3 ? 'rock' : 'hill'; }
    case 8: case 13: return env.cityDist(tx, ty) > 0 ? 'road' : 'city';
    // Lone floor/POI tiles out in the wilds (we are outside every city here)
    // read as part of the road rather than as stray cobble squares.
    default: return isCityTile(t) && t !== 3 ? 'road' : 'grass';
  }
}

const TERRAIN_PAL = {
  grass: ['#9fd585', '#b8e39c'], forest: ['#6aa85a', '#80bb69'], road: ['#d6b47a', '#e8cb92'],
  sand: ['#e3d29e', '#f1e3b8'], swamp: ['#6e8a55', '#809b62'], hill: ['#86bb6c', '#9ac97e'],
  rock: ['#958f84', '#b2ac9e'], snow: ['#e6ecf1', '#ffffff'], field: ['#a7804d', '#c49b63'], city: ['#ecdebc', '#f0e2c4'],
};
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const PAL_RGB = Object.fromEntries(Object.entries(TERRAIN_PAL).map(([k, v]) => [k, v.map(rgbOf)]));
// Colour for a category: n1 picks along the palette, n2 = secondary pattern
// (swamp puddles, field rows), grain = fine per-pixel jitter. → [r,g,b]
export function terrainColor(cat, n1, n2, grain) {
  const [a, b] = PAL_RGB[cat] || PAL_RGB.grass;
  let k = n1;
  if (cat === 'field') k = n2;                       // crop rows
  let c = [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  if (cat === 'swamp' && n2 > 0.62) c = [79, 110, 94]; // still pools
  const g = 1 + (grain - 0.5) * 0.08;
  return c.map(v => clamp(Math.round(v * g), 0, 255));
}

// Wilderness props for one tile: { kind, x, z, rot, s, v } in world units.
// env = { hash, depthAt, cityDist }. Never on roads, water, walls or cities.
export function wildDecorFor(tx, ty, tileAt, env) {
  if (env.cityDist(tx, ty) === 0) return [];       // cities have their own decor
  const t = tileAt(tx, ty), h = env.hash;
  const out = [];
  const at = (kind, k, extra = {}) => out.push({
    kind, x: tx + 0.2 + h(tx * 3 + k, ty * 5 - k) * 0.6, z: ty + 0.2 + h(ty * 7 + k, tx * 11 + k) * 0.6,
    rot: h(tx + 13 * k, ty + 29) * Math.PI * 2, s: 0.8 + h(tx + 5, ty + 11 * k) * 0.4, v: h(tx + 71, ty + 3 + k), ...extra,
  });
  const nb4 = (id) => N4.some(([dx, dy]) => tileAt(tx + dx, ty + dy) === id);
  const nb8 = (id) => N8.some(([dx, dy]) => tileAt(tx + dx, ty + dy) === id);
  const r = h(tx * 13 + 1, ty * 7 + 2);

  if (t === 17) {
    const d = env.depthAt(tx, ty);
    // Windmills are landmarks: each 14×14 block nominates one tile, which
    // gets a mill only if it is a foothill near a city.
    const bx = Math.floor(tx / 14), by = Math.floor(ty / 14);
    const pick = (ax, ay) => [bx * 14 + Math.floor(h(ax, ay) * 14), by * 14 + Math.floor(h(ay + 3, ax + 7) * 14)];
    const [mx, my] = pick(bx * 7 + 1, by * 5 + 2);
    if (tx === mx && ty === my && d === 1 && env.cityDist(tx, ty) <= 24) at('windmill', 1);
    else if (d >= 1 && d <= 3 && r < 0.4) at('pine', 2);
    else if (d >= 2 && r < 0.5) at('boulder', 3);
    else if (d <= 2) at('mound', 14, { x: tx + 0.5, z: ty + 0.5 }); // grassy knoll keeps thin ranges hilly
  } else if (t === 0) {
    const crop = fieldPatch(tx, ty, tileAt, env);
    if (crop !== null) { at('crop', 4, { v: crop, x: tx + 0.5, z: ty + 0.5, rot: 0 }); return out; }
    if (nb4(2) && r < 0.6) at('reeds', 5);
    else if (nb8(10) && r < 0.35) at('edgeTree', 6);
    else if (nb8(10) && r < 0.45) at('mushrooms', 7);
    else if (r < 0.03) at('flowers', 8);
    else if (r < 0.045) at('rock', 9);
    else if (r < 0.09) at('tuft', 10);
  } else if (t === 11) {
    if (r < 0.3) at('reeds', 11);
    else if (r < 0.55) at('lily', 12);
    else if (r < 0.6) at('snag', 13);
  }
  return out;
}

// ── Carriage struggle (visual only) ──────────────────────────────────────
// How the 3D carriage moves over slow terrain at time t (seconds):
//   sink    — wagon pushed down into the ground (world units)
//   roll    — side-to-side rock of the wagon (radians, |roll| ≤ 0.1)
//   bobAmp  — trot bounce height; legAmp / legRate — horse leg swing size / speed
// Swamp: wheels sink and the wagon rocks slowly while the horse high-steps.
// Forest: no sink, a jerky lurch over roots and a bouncier ride.
export function carriageStruggle(kind, t) {
  const s = Number.isFinite(t) ? t : 0;
  if (kind === 'swamp') {
    return { sink: 0.12, roll: Math.sin(s * 1.7) * 0.07, bobAmp: 0.02, legAmp: 0.8, legRate: 0.5 };
  }
  if (kind === 'forest') {
    return { sink: 0, roll: Math.sin(s * 5.3) * 0.035 + Math.sin(s * 2.1) * 0.02, bobAmp: 0.08, legAmp: 0.6, legRate: 0.7 };
  }
  return { sink: 0, roll: 0, bobAmp: 0.04, legAmp: 0.5, legRate: 1 };
}
