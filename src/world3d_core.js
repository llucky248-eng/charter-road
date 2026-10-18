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
