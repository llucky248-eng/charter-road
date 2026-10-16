// three.js 3D world renderer for Charter Road.
//
// The simulation, input and HUD stay in src/main.js (a classic script). main.js
// dynamically imports this module, calls createWorld3D(host) once, then each
// frame calls api.render(frame) instead of its 2D drawWorld()/entity passes and
// keeps drawing the HUD/menus on its own (now transparent) 2D canvas on top.
//
// Units: 1 world unit = 1 map tile; tile (tx,ty) spans X∈[tx,tx+1], Z∈[ty,ty+1].
// The 2D game's pixel coords convert with x/TILE, y/TILE. +Y is up.
// The three.js path carries its revision so an upgrade is a new URL (no stale
// cache). The pure helpers (world3d_core.js) are passed in by main.js, which
// imports them with its build's ?v= — one copy, always matching this build.
import * as THREE from '../vendor/three/r170/three.module.min.js';

const CHUNK = 32;          // tiles per ground/prop chunk edge
const PITCH_DEG = 52;
const FOV_DEG = 30;
const WALL_H = 1.25;
const FIGURE_SCALE = 1.25; // characters read a touch larger among 3D buildings

const SLOT_ICONS = { 6: '🛒', 7: '🍺', 14: '🛏️', 8: '📦', 15: '⚒️', 12: '📜', 13: '💰', 4: '🛡️', 19: '⛏️' };

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return c;
}

export function createWorld3D(host, core) {
  const { MAP_W, MAP_H, TILE, VIEW_W, VIEW_H, IS_MOBILE, tileAt, hash2 } = host;
  const {
    groundTileFor, propKindFor, cameraRig, facingToYaw, lerpAngle,
    sunForHour, buildingSpec, ndcToCanvas, advanceHour, ORE_COLORS, HORSE_PAL, WAGON_PAL,
  } = core;
  const stage = host.canvas2d.parentElement;
  // Probe first: without WebGL2 three.js would log a console error; the
  // caller treats this throw as "stay on the 2D renderer".
  if (!document.createElement('canvas').getContext('webgl2')) throw new Error('WebGL2 unavailable');

  // ── Renderer + canvas (sits under the transparent 2D HUD canvas) ─────────
  const glCanvas = document.createElement('canvas');
  glCanvas.id = 'world3d';
  glCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(glCanvas.style, {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
    boxShadow: 'none', background: 'transparent', pointerEvents: 'none',
  });
  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas, antialias: true, alpha: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: !!host.preserveDrawingBuffer,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.insertBefore(glCanvas, host.canvas2d);
  let contextLost = false;
  glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; });
  // No z-index anywhere: as positioned z-auto siblings they paint in DOM order,
  // world3d < #game (HUD) < #ui-root (HTML dialogs), so dialogs keep the clicks.
  host.canvas2d.style.position = 'relative';
  host.canvas2d.style.background = 'transparent';

  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  function resize() {
    const w = Math.max(1, host.canvas2d.clientWidth);
    const h = Math.max(1, host.canvas2d.clientHeight);
    renderer.setSize(w, h, false);
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(host.canvas2d);

  // ── Scene, camera, lights ────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe3f2');
  scene.fog = new THREE.Fog('#bfe3f2', 60, 160);

  const camera = new THREE.PerspectiveCamera(FOV_DEG, VIEW_W / VIEW_H, 1, 600);
  const viewTilesW = (VIEW_W / TILE) * 0.92;

  const hemi = new THREE.HemisphereLight('#dff1ff', '#a08a62', 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
  sc.updateProjectionMatrix();
  scene.add(sun, sun.target);

  // Night-time glow materials register here so emissive strength follows the hour.
  const nightGlow = new Map(); // material → { day, night }
  const glowMat = (color, day = 0.15, night = 1.4, own = null) => {
    const m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: day });
    nightGlow.set(m, { day, night });
    own?.push(m);
    return m;
  };

  // ── Shared geometry / materials ──────────────────────────────────────────
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    ico: new THREE.IcosahedronGeometry(0.5, 0),
    ico1: new THREE.IcosahedronGeometry(0.5, 1),
    cone4: new THREE.ConeGeometry(0.5, 1, 4),
    cone7: new THREE.ConeGeometry(0.5, 1, 7),
    dome: new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    dodec: new THREE.DodecahedronGeometry(0.5, 0),
    octa: new THREE.OctahedronGeometry(0.5, 0),
    wheel: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
    canopy: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false, 0, Math.PI),
  };
  const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const M = {
    white: lam('#ffffff'),
    flatWhite: lam('#ffffff', { flatShading: true }),
    trunk: lam('#7a5230', { flatShading: true }),
    rock: lam('#8a8178', { flatShading: true }),
    rockSpent: lam('#4a4540', { flatShading: true }),
    wood: lam('#8b6a44'),
    darkWood: lam('#5a3a1d'),
    door: lam('#3b2a1d'),
    parchment: lam('#f3e3bf'),
    stone: lam('#9a8a6a'),
    tent: lam('#e9d6a6', { flatShading: true }),
    gold: lam('#d4a020'),
    fire: glowMat('#ff9a3c', 1.0, 2.2),
  };

  // ── Ground: lazily painted chunks using the game's own tile art ──────────
  const cityRects = host.cities.map(c => ({ x0: c.x - 1, y0: c.y - 1, x1: c.x + c.w + 1, y1: c.y + c.h + 1 }));
  const inCityAt = (tx, ty) => cityRects.some(r => tx >= r.x0 && tx < r.x1 && ty >= r.y0 && ty < r.y1);
  const texScale = IS_MOBILE ? 1.5 : 2;

  // Backdrop beyond the map edge so the tilted camera never sees a void.
  {
    const back = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W + 400, MAP_H + 400), lam('#7fae6a'));
    back.rotation.x = -Math.PI / 2;
    back.position.set(MAP_W / 2, -0.02, MAP_H / 2);
    back.receiveShadow = true;
    scene.add(back);
  }

  const chunks = new Map(); // key → { group, tex, cx, cy }
  const pickables = new Set();
  const oreNodes = [];      // { tx, ty, rocks:[], gems:[], spent }

  function paintChunk(cx, cy, w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * TILE * texScale);
    cv.height = Math.round(h * TILE * texScale);
    const g = cv.getContext('2d');
    g.setTransform(texScale, 0, 0, texScale, 0, 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tx = cx + x, ty = cy + y;
        const id = groundTileFor(tileAt(tx, ty), { inCity: inCityAt(tx, ty) });
        host.drawTileInto(g, id, x * TILE, y * TILE, tx, ty);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  // Collect per-chunk prop transforms, then emit one InstancedMesh per part.
  function buildChunkProps(group, cx, cy, w, h) {
    const parts = new Map(); // name → { geo, mat, items:[{p,s,r,c}], shadow }
    const add = (name, geo, mat, p, s, r = 0, c = null, shadow = true) => {
      let e = parts.get(name);
      if (!e) { e = { geo, mat, items: [], shadow }; parts.set(name, e); }
      e.items.push({ p, s, r, c });
    };
    const gateNear = (tx, ty) => tileAt(tx - 1, ty) === 5 || tileAt(tx + 1, ty) === 5 || tileAt(tx, ty - 1) === 5 || tileAt(tx, ty + 1) === 5;

    for (let ty = cy; ty < cy + h; ty++) {
      for (let tx = cx; tx < cx + w; tx++) {
        const id = tileAt(tx, ty);
        const inCity = inCityAt(tx, ty);
        const n = hash2(tx, ty), n2 = hash2(tx + 911, ty + 37);
        const X = tx + 0.5, Z = ty + 0.5;
        // Building footprints are wall-ringed rooms in the tile map; the slot's
        // 3D building (or construction site) stands there instead.
        const kind = host.buildingTiles?.has(ty * MAP_W + tx) ? null : propKindFor(id, { inCity });

        if (kind === 'wall') {
          if (gateNear(tx, ty)) {
            add('tower', G.box, M.flatWhite, [X, 1.0, Z], [1.12, 2.0, 1.12], 0, shade('#8a7a5a', (n - 0.5) * 0.06));
            add('towerRoof', G.cone4, M.flatWhite, [X, 2.45, Z], [1.6, 0.9, 1.6], Math.PI / 4, new THREE.Color('#a8485e'));
          } else {
            add('wall', G.box, M.white, [X, WALL_H / 2, Z], [1, WALL_H, 1], 0, new THREE.Color(n < 0.5 ? '#8a7a5a' : '#7a6b4e'));
            if (((tx + ty) & 1) === 0) add('merlon', G.box, M.white, [X, WALL_H + 0.15, Z], [0.5, 0.3, 0.5], 0, new THREE.Color('#6e604a'));
          }
        } else if (kind === 'gate') {
          const ew = tileAt(tx - 1, ty) === 3 || tileAt(tx + 1, ty) === 3;
          add('lintel', G.box, M.white, [X, 1.6, Z], ew ? [1.05, 0.4, 0.9] : [0.9, 0.4, 1.05], 0, new THREE.Color('#c8b08a'));
          add('lintelTrim', G.box, M.white, [X, 1.38, Z], ew ? [1.05, 0.08, 0.95] : [0.95, 0.08, 1.05], 0, new THREE.Color('#d18816'), false);
        } else if (kind === 'tree') {
          // Two trees per forest tile, jittered, mixed pines and broadleaf.
          for (let k = 0; k < 2; k++) {
            const a = hash2(tx * 2 + k, ty * 3 - k), b = hash2(ty * 2 - k, tx * 5 + k);
            const ox = (k ? 0.22 : -0.22) + (a - 0.5) * 0.3, oz = (k ? -0.18 : 0.2) + (b - 0.5) * 0.3;
            const s = 0.75 + b * 0.55;
            const pine = a > 0.5;
            add('trunk', G.cyl6, M.trunk, [X + ox, 0.3 * s, Z + oz], [0.15 * s, 0.6 * s, 0.15 * s]);
            const leaf = shade(pine ? '#2f7a45' : '#4f9e5b', (b - 0.5) * 0.14);
            if (pine) add('pine', G.cone7, M.flatWhite, [X + ox, 1.15 * s, Z + oz], [0.9 * s, 1.5 * s, 0.9 * s], a * 6, leaf);
            else add('crown', G.ico, M.flatWhite, [X + ox, 0.9 * s, Z + oz], [1.0 * s, 0.9 * s, 1.0 * s], a * 6, leaf);
          }
        } else if (kind === 'hill') {
          const s = 1.5 + n * 0.5;
          add('hill', G.dome, M.flatWhite, [X, 0, Z], [s, (0.9 + n2 * 0.7), s], n * 6, shade('#8fca78', (n2 - 0.5) * 0.1));
        } else if (kind === 'board') {
          add('post', G.box, M.darkWood, [X - 0.3, 0.45, Z], [0.08, 0.9, 0.08]);
          add('post', G.box, M.darkWood, [X + 0.3, 0.45, Z], [0.08, 0.9, 0.08]);
          add('boardFace', G.box, M.parchment, [X, 0.75, Z], [0.8, 0.5, 0.06]);
          add('seal', G.cyl, M.white, [X + 0.22, 0.65, Z + 0.04], [0.1, 0.02, 0.1], 0, new THREE.Color('#4f9e5b'), false);
        } else if (kind === 'camp') {
          add('tent', G.cone4, M.tent, [X - 0.12, 0.35, Z - 0.1], [0.9, 0.7, 0.9], Math.PI / 4);
          add('log', G.cyl6, M.trunk, [X + 0.25, 0.05, Z + 0.25], [0.08, 0.35, 0.08]);
          add('fire', G.cone4, M.fire, [X + 0.25, 0.14, Z + 0.25], [0.18, 0.28, 0.18], 0, null, false);
        } else if (kind === 'cache') {
          add('chest', G.box, M.wood, [X, 0.18, Z], [0.55, 0.36, 0.38]);
          add('chestBand', G.box, M.gold, [X, 0.3, Z], [0.57, 0.06, 0.4], 0, null, false);
        } else if (id === 0 && n < 0.06) {
          add('bush', G.ico, M.flatWhite, [X + (n2 - 0.5) * 0.4, 0.14, Z], [0.5, 0.36, 0.5], n2 * 6, shade('#6faa66', (n2 - 0.5) * 0.12));
        } else if (id === 11 && n < 0.25) {
          add('reed', G.cyl6, M.white, [X + (n2 - 0.5) * 0.5, 0.2, Z], [0.04, 0.4, 0.04], 0, new THREE.Color('#5f8a4a'), false);
        }

        if (kind === 'ore') buildOre(group, tx, ty);
      }
    }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const [, e] of parts) {
      const im = new THREE.InstancedMesh(e.geo, e.mat, e.items.length);
      e.items.forEach((it, i) => {
        q.setFromAxisAngle(up, it.r);
        m4.compose(new THREE.Vector3(...it.p), q, new THREE.Vector3(...it.s));
        im.setMatrixAt(i, m4);
        if (it.c) im.setColorAt(i, it.c);
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = e.shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  const gemMats = new Map(); // shared per metal so rebuilt chunks don't leak materials
  function buildOre(group, tx, ty) {
    const color = ORE_COLORS[host.mineMetal(tx, ty)] || '#c0a060';
    if (!gemMats.has(color)) gemMats.set(color, glowMat(color, 0.35, 0.9));
    const gemMat = gemMats.get(color);
    const node = { tx, ty, rocks: [], gems: [], spent: false };
    for (let i = 0; i < 3; i++) {
      const a = hash2(tx * 3 + i, ty * 7 - i), b = hash2(ty * 5 + i, tx * 11 + i);
      const rock = new THREE.Mesh(G.dodec, M.rock);
      const s = 0.42 + a * 0.26;
      rock.position.set(tx + 0.25 + a * 0.5, s * 0.35, ty + 0.25 + b * 0.5);
      rock.scale.set(s, s * 0.8, s);
      rock.rotation.set(a * 3, b * 3, 0);
      rock.castShadow = true; rock.receiveShadow = true;
      group.add(rock); node.rocks.push(rock);
      const gem = new THREE.Mesh(G.octa, gemMat);
      gem.scale.setScalar(0.12 + b * 0.06);
      gem.position.set(rock.position.x + (a - 0.5) * 0.12, s * 0.62, rock.position.z + 0.06);
      group.add(gem); node.gems.push(gem);
      rock.userData.pick = true; pickables.add(rock);
    }
    oreNodes.push(node);
  }

  function ensureChunk(cx, cy) {
    const key = cx + ',' + cy;
    if (chunks.has(key)) return false;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const w = Math.min(CHUNK, MAP_W - x0), h = Math.min(CHUNK, MAP_H - y0);
    const group = new THREE.Group();
    const tex = paintChunk(x0, y0, w, h);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(x0 + w / 2, 0, y0 + h / 2);
    ground.receiveShadow = true;
    group.add(ground);
    buildChunkProps(group, x0, y0, w, h);
    scene.add(group);
    chunks.set(key, { group, tex, cx, cy });
    return true;
  }

  function dropChunk(key) {
    const c = chunks.get(key);
    if (!c) return;
    scene.remove(c.group);
    c.group.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      if (o.isMesh && o.parent === c.group && o.geometry?.type === 'PlaneGeometry') { o.geometry.dispose(); o.material.dispose(); }
      if (o.userData.pick) pickables.delete(o);
    });
    c.tex.dispose();
    for (let i = oreNodes.length - 1; i >= 0; i--) {
      const n = oreNodes[i];
      if (Math.floor(n.tx / CHUNK) === c.cx && Math.floor(n.ty / CHUNK) === c.cy) oreNodes.splice(i, 1);
    }
    chunks.delete(key);
  }

  // ── Water: animated, shoreline-foamed overlay driven by a per-tile mask ──
  const waterMask = new Uint8Array(MAP_W * MAP_H * 4);
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const i = (ty * MAP_W + tx) * 4;
    const v = tileAt(tx, ty) === 2 ? 255 : 0;
    waterMask[i] = v; waterMask[i + 3] = 255;
  }
  const maskTex = new THREE.DataTexture(waterMask, MAP_W, MAP_H, THREE.RGBAFormat);
  maskTex.magFilter = THREE.LinearFilter; maskTex.minFilter = THREE.LinearFilter;
  maskTex.flipY = false; maskTex.needsUpdate = true;
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uMask: { value: maskTex }, uTime: { value: 0 }, uMap: { value: new THREE.Vector2(MAP_W, MAP_H) },
      uDeep: { value: new THREE.Color('#4fa6c8') }, uShallow: { value: new THREE.Color('#9ad6e8') },
      uLight: { value: new THREE.Color(1, 1, 1) },
    }]),
    vertexShader: `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D uMask; uniform float uTime; uniform vec2 uMap;
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uLight;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        float m = texture2D(uMask, vWorld.xz / uMap).r;
        if (m < 0.04) discard;
        vec2 p = vWorld.xz;
        float w = sin(p.x * 1.7 + uTime * 1.3) * sin(p.y * 1.3 - uTime * 1.1)
                + 0.5 * sin((p.x + p.y) * 3.1 + uTime * 2.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.55, 1.0, m));
        col += 0.05 * w;
        float glint = pow(max(0.0, sin(p.x * 2.3 + p.y * 1.9 + uTime * 1.7) * sin(p.y * 2.9 - uTime * 1.2)), 12.0);
        col += glint * 0.35;
        float foam = (1.0 - smoothstep(0.3, 0.62, m)) * (0.65 + 0.35 * sin(uTime * 2.2 + p.x * 2.0 + p.y));
        col = mix(col, vec3(1.0), foam * 0.6);
        gl_FragColor = vec4(col * uLight, mix(0.6, 0.92, smoothstep(0.3, 0.8, m)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(MAP_W / 2, 0.03, MAP_H / 2);
  water.renderOrder = 1;
  scene.add(water);

  // ── City buildings (from cityBuildings slots) ────────────────────────────
  const buildings = new Map(); // slotKey → { sig, group, smoke:[] }

  function plaqueTexture(icon, ribbon, level) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(59,42,29,0.35)';
    g.beginPath(); g.roundRect ? g.roundRect(8, 10, 80, 80, 14) : g.rect(8, 10, 80, 80); g.fill();
    g.fillStyle = '#fffaef';
    g.beginPath(); g.roundRect ? g.roundRect(6, 6, 80, 80, 14) : g.rect(6, 6, 80, 80); g.fill();
    g.fillStyle = ribbon;
    g.fillRect(6, 6, 80, 16);
    g.fillStyle = level >= 3 ? '#d4a020' : 'rgba(255,255,255,0.9)';
    for (let p = 0; p < level; p++) { g.beginPath(); g.arc(76 - p * 12, 14, 4, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#3b2a1d'; g.lineWidth = 4;
    g.beginPath(); g.roundRect ? g.roundRect(6, 6, 80, 80, 14) : g.rect(6, 6, 80, 80); g.stroke();
    g.font = '44px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(icon, 46, 56);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function addPlaque(group, icon, ribbon, level, y) {
    const mat = new THREE.SpriteMaterial({ map: plaqueTexture(icon, ribbon, level), depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(1.15, 1.15, 1);
    s.position.set(0, y, 0);
    s.renderOrder = 3;
    group.add(s);
    return s;
  }

  function mesh(geo, mat, x, y, z, sx, sy, sz, cast = true) {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z); o.scale.set(sx, sy, sz);
    o.castShadow = cast; o.receiveShadow = true;
    return o;
  }

  function gableRoof(width, height, length, wallMat, roofMat) {
    const s = new THREE.Shape();
    s.moveTo(-width / 2, 0); s.lineTo(width / 2, 0); s.lineTo(0, height); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
    geo.translate(0, 0, -length / 2);
    const o = new THREE.Mesh(geo, [wallMat, roofMat]); // group 0 = gable caps, 1 = slopes
    o.castShadow = true; o.receiveShadow = true;
    return o;
  }

  function buildBuilding(slot) {
    const group = new THREE.Group();
    const own = [];  // per-building materials/textures, freed in disposeBuilding
    const lam = (color, extra = {}) => { const m = new THREE.MeshLambertMaterial({ color, ...extra }); own.push(m); return m; };
    const spec = buildingSpec(slot);
    const { w, d } = spec;
    group.position.set(slot.tileX + w / 2, 0, slot.tileY + d / 2);
    const smoke = [];
    const icon = slot.built ? (SLOT_ICONS[slot.tileType] || '🏠') : '🔨';

    if (!slot.built) {
      // Construction site: blueprint slab, scaffold poles + beams, plank stack.
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff5d8'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(208,136,22,0.45)'; g.lineWidth = 2;
      for (let i = 16; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(w / 2, d / 2);
      own.push(tex);
      const slab = mesh(G.box, lam('#ffffff', { map: tex }), 0, 0.05, 0, w - 0.2, 0.1, d - 0.2, false);
      slab.userData.pick = true; pickables.add(slab);
      group.add(slab);
      const hx = w / 2 - 0.25, hz = d / 2 - 0.25;
      for (const [px, pz] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) group.add(mesh(G.cyl6, M.wood, px, 0.9, pz, 0.1, 1.8, 0.1));
      group.add(mesh(G.box, M.wood, 0, 1.5, -hz, w - 0.5, 0.08, 0.08));
      group.add(mesh(G.box, M.wood, 0, 1.5, hz, w - 0.5, 0.08, 0.08));
      group.add(mesh(G.box, M.wood, -hx, 1.0, 0, 0.08, 0.08, d - 0.5));
      group.add(mesh(G.box, M.wood, hx, 1.0, 0, 0.08, 0.08, d - 0.5));
      for (let i = 0; i < 3; i++) group.add(mesh(G.box, M.wood, -w / 4, 0.16 + i * 0.09, d / 6, 1.2, 0.08, 0.28));
      const bob = addPlaque(group, icon, '#f0a830', 0, 2.3);
      return { group, smoke, own, bob };
    }

    const wallMat = lam(spec.wall), wallDark = lam(spec.wallDark), roofMat = lam(spec.roof, { flatShading: true });
    const roofFace = lam(spec.roofFace);
    const bw = w - 0.3, bd = d - 0.3;
    group.add(mesh(G.box, wallDark, 0, 0.08, 0, bw + 0.14, 0.16, bd + 0.14));       // plinth
    const body = mesh(G.box, wallMat, 0, spec.wallH / 2 + 0.08, 0, bw, spec.wallH, bd);
    body.userData.pick = true; pickables.add(body);
    group.add(body);
    // Timber corner posts (cottage-core accent)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      group.add(mesh(G.box, M.darkWood, sx * bw / 2, spec.wallH / 2 + 0.08, sz * bd / 2, 0.12, spec.wallH, 0.12));
    }

    const alongX = w >= d;
    const span = (alongX ? bd : bw) + 0.4, len = (alongX ? bw : bd) + 0.4;
    const roof = gableRoof(span, spec.roofH, len, wallMat, roofMat);
    roof.position.y = spec.wallH + 0.08;
    if (alongX) roof.rotation.y = Math.PI / 2;
    roof.userData.pick = true; pickables.add(roof);
    group.add(roof);
    const ridge = mesh(G.box, roofFace, 0, spec.wallH + 0.08 + spec.roofH, 0, alongX ? len : 0.12, 0.1, alongX ? 0.12 : len);
    group.add(ridge);

    // Door + awning on the door side; windows along the walls.
    const winMat = glowMat(spec.glow, 0.25, 1.3, own);
    const door = slot.doorSide || 'south';
    const dirs = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] };
    const [dx, dz] = dirs[door] || dirs.south;
    const faceOff = (dx ? bw : bd) / 2 + 0.03;
    const doorH = Math.min(0.85, spec.wallH * 0.7);
    group.add(mesh(G.box, M.door, dx * faceOff, 0.16 + doorH / 2, dz * faceOff, dx ? 0.06 : 0.55, doorH, dz ? 0.06 : 0.55, false));
    group.add(mesh(G.box, roofFace, dx * (faceOff + 0.14), 0.16 + doorH + 0.12, dz * (faceOff + 0.14), dx ? 0.34 : 0.8, 0.07, dz ? 0.34 : 0.8));
    const winY = 0.16 + spec.wallH * 0.62;
    for (const [fx, fz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const faceLen = fx ? bd : bw;
      const off = (fx ? bw : bd) / 2 + 0.02;
      const n = Math.max(1, Math.floor(faceLen / 1.25));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const along = t * faceLen;
        if (fx === dx && fz === dz && Math.abs(along) < 0.55) continue; // keep the door clear
        const px = fx ? fx * off : along, pz = fz ? fz * off : along;
        group.add(mesh(G.box, winMat, px, winY, pz, fx ? 0.04 : 0.32, 0.36, fz ? 0.04 : 0.32, false));
      }
      for (let lv = 2; lv <= spec.level; lv++) {   // upper-floor windows on taller buildings
        const py = winY + 0.4 * (lv - 1);
        if (py > spec.wallH - 0.1) break;
        group.add(mesh(G.box, winMat, fx * off, py, fz * off, fx ? 0.04 : 0.28, 0.24, fz ? 0.04 : 0.28, false));
      }
    }

    // Per-type flourishes
    const T = slot.tileType;
    if (T === 13) { // bank columns
      for (const k of [-0.6, 0, 0.6]) {
        const cx2 = dx ? dx * (faceOff + 0.22) : k, cz2 = dz ? dz * (faceOff + 0.22) : k;
        group.add(mesh(G.cyl, wallMat, cx2, 0.16 + spec.wallH / 2, cz2, 0.18, spec.wallH, 0.18));
      }
    }
    if (T === 6) { // market crates by the door
      for (let i = 0; i < 3; i++) {
        const off2 = faceOff + 0.35, lat = (i - 1) * 0.42;
        group.add(mesh(G.box, M.wood, dx ? dx * off2 : lat + (dz ? 0.9 : 0), 0.16, dz ? dz * off2 : lat + (dx ? 0.9 : 0), 0.3, 0.3, 0.3));
      }
    }
    if (T === 7 || T === 14 || T === 8 || T === 19 || T === 4 || T === 15) { // chimney + smoke
      const cxp = alongX ? len * 0.22 : span * 0.18, czp = alongX ? span * 0.18 : len * 0.22;
      const ch = mesh(G.box, M.stone, cxp, spec.wallH + spec.roofH * 0.7, czp, 0.28, spec.roofH * 0.9, 0.28);
      group.add(ch);
      for (let i = 0; i < 3; i++) {
        const p = mesh(G.ico1, lam('#f4efe6', { transparent: true, opacity: 0.5, depthWrite: false }), cxp, 0, czp, 0.3, 0.3, 0.3, false);
        p.userData.base = new THREE.Vector3(cxp, spec.wallH + spec.roofH * 1.15, czp);
        p.userData.phase = i / 3;
        group.add(p); smoke.push(p);
      }
    }

    addPlaque(group, icon, spec.roofFace, spec.level, spec.wallH + spec.roofH + 0.85);
    return { group, smoke, own };
  }

  function disposeBuilding(b) {
    scene.remove(b.group);
    b.group.traverse(o => {
      if (o.userData.pick) pickables.delete(o);
      if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
      if (o.isMesh && o.geometry?.type === 'ExtrudeGeometry') o.geometry.dispose();
    });
    for (const r of b.own) { nightGlow.delete(r); r.dispose(); }
  }

  function syncBuildings(slots) {
    const seen = new Set();
    for (const { key, slot: s } of slots) {
      if (!s || s.tileX <= 0) continue;
      seen.add(key);
      const cur = buildings.get(key);
      // Only built/level change at runtime; the footprint is fixed per slot.
      if (cur && cur.built === !!s.built && cur.level === s.level) continue;
      if (cur) disposeBuilding(cur);
      const b = buildBuilding(s);
      b.built = !!s.built; b.level = s.level;
      scene.add(b.group);
      buildings.set(key, b);
    }
    for (const [k, b] of buildings) if (!seen.has(k)) { disposeBuilding(b); buildings.delete(k); }
  }

  // ── Carriages (player on the road + AI traders) ──────────────────────────
  function makeCarriage(pal) {
    const root = new THREE.Group();
    const own = [];
    const lam = (color, extra = {}) => { const m = new THREE.MeshLambertMaterial({ color, ...extra }); own.push(m); return m; };
    const bodyMat = lam(pal.body), roofMat = lam(pal.roof, { side: THREE.DoubleSide }), trimMat = lam(pal.trim);
    const wheelMat = lam(pal.wheel), horseMat = lam(pal.horse, { flatShading: true }), maneMat = lam(pal.mane);
    if (pal.glow) { horseMat.emissive = new THREE.Color('#a0d8ff'); horseMat.emissiveIntensity = 0.35; }
    const wagon = new THREE.Group();
    wagon.add(mesh(G.box, bodyMat, 0, 0.5, 0, 1.3, 0.42, 0.82));
    wagon.add(mesh(G.box, trimMat, 0, 0.73, 0, 1.34, 0.06, 0.86));
    // Half-cylinder canopy: rotating Y→X lays its axis along the wagon and
    // turns the x≥0 half into the arch over the bed (scale x = arch height).
    const canopy = mesh(G.canopy, roofMat, -0.05, 0.76, 0, 0.8, 1.15, 0.84);
    canopy.rotation.set(0, 0, Math.PI / 2);
    wagon.add(canopy);
    root.add(wagon);
    const wheels = [];
    for (const [wx, wz] of [[-0.42, 0.45], [0.42, 0.45], [-0.42, -0.45], [0.42, -0.45]]) {
      const wh = mesh(G.wheel, wheelMat, wx, 0.28, wz, 0.56, 0.08, 0.56);
      wh.rotation.x = Math.PI / 2;
      root.add(wh); wheels.push(wh);
    }
    root.add(mesh(G.box, M.darkWood, 0.95, 0.42, 0, 0.6, 0.04, 0.04));       // shaft
    const horse = new THREE.Group();
    horse.position.set(1.45, 0, 0);
    horse.add(mesh(G.box, horseMat, 0, 0.62, 0, 0.78, 0.32, 0.28));
    const neck = mesh(G.box, horseMat, 0.38, 0.86, 0, 0.18, 0.4, 0.18); neck.rotation.z = -0.5; horse.add(neck);
    horse.add(mesh(G.box, horseMat, 0.55, 1.02, 0, 0.3, 0.16, 0.16));
    horse.add(mesh(G.box, maneMat, 0.3, 0.92, 0, 0.26, 0.1, 0.06));
    horse.add(mesh(G.box, maneMat, -0.42, 0.62, 0, 0.12, 0.26, 0.06));
    const legs = [];
    for (const [lx, lz] of [[-0.3, 0.1], [-0.3, -0.1], [0.3, 0.1], [0.3, -0.1]]) {
      const pivot = new THREE.Group(); pivot.position.set(lx, 0.5, lz);
      pivot.add(mesh(G.box, horseMat, 0, -0.25, 0, 0.08, 0.5, 0.08));
      horse.add(pivot); legs.push(pivot);
    }
    root.add(horse);
    root.userData = { wagon, wheels, legs, horse, own, anchor: true, yaw: 0, dist: 0, lastX: null, lastZ: null };
    root.scale.setScalar(1.6); // ~2 tiles long, matching the 2D carriage's visual weight
    return root;
  }

  const carriages = new Map(); // id → { obj, sig }
  function dropCarriage(c) {
    scene.remove(c.obj);
    for (const m of c.obj.userData.own) m.dispose();
  }
  function syncCarriage(id, sig, pal, x, z, facing, moving, parked, t, dt) {
    let c = carriages.get(id);
    if (!c || c.sig !== sig) {
      if (c) dropCarriage(c);
      c = { obj: makeCarriage(pal), sig };
      carriages.set(id, c);
      scene.add(c.obj);
      c.obj.userData.yaw = facingToYaw(facing.x, facing.y);
    }
    const o = c.obj, u = o.userData;
    o.visible = true; u.seen = true;
    if (u.lastX !== null) u.dist += Math.hypot(x - u.lastX, z - u.lastZ);
    u.lastX = x; u.lastZ = z;
    const want = facingToYaw(facing.x, facing.y);
    u.yaw = lerpAngle(u.yaw, want, 1 - Math.exp(-12 * dt)); // frame-rate independent turn
    o.position.set(x, 0, z);
    o.rotation.y = u.yaw;
    for (const wh of u.wheels) wh.rotation.y = -u.dist / 0.28;
    const ph = t * 0.012;
    u.wagon.position.y = moving ? Math.abs(Math.sin(ph * 2)) * 0.04 : 0;
    u.legs.forEach((l, i) => { l.rotation.z = moving ? Math.sin(ph * 2 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.5 : 0; });
    u.horse.visible = !parked;
  }

  // ── Billboard characters (reuse main.js's painterly 2D figure art) ───────
  const billboards = new Map(); // key → { sprite, cv, g, tex, w, h }
  const bbScale = Math.min(window.devicePixelRatio || 1, 2) * FIGURE_SCALE * 1.6;
  const frustum = new THREE.Frustum(), projView = new THREE.Matrix4(), figSphere = new THREE.Sphere(new THREE.Vector3(), 2.5);
  function syncBillboard(f) {
    // Off-screen figures keep their sprite hidden and skip the repaint/upload.
    figSphere.center.set(f.x / TILE, 1, f.y / TILE);
    if (!frustum.intersectsSphere(figSphere)) return;
    let b = billboards.get(f.key);
    if (!b || b.w !== f.w || b.h !== f.h) {
      if (b) { scene.remove(b.sprite); b.tex.dispose(); b.sprite.material.dispose(); }
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(f.w * bbScale); cv.height = Math.ceil(f.h * bbScale);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.02 }));
      sprite.renderOrder = 2;
      sprite.userData.anchor = true;
      scene.add(sprite);
      b = { sprite, cv, g: cv.getContext('2d', { willReadFrequently: true }), tex, w: f.w, h: f.h };
      sprite.userData.bb = b;
      billboards.set(f.key, b);
    }
    // Figures animate at a walk cycle; repainting + re-uploading every other
    // frame is visually identical and halves the canvas/texture traffic.
    if (b.paintedAt === undefined || frameNo - b.paintedAt >= 2) {
      b.paintedAt = frameNo;
      b.g.setTransform(1, 0, 0, 1, 0, 0);
      b.g.clearRect(0, 0, b.cv.width, b.cv.height);
      b.g.setTransform(bbScale, 0, 0, bbScale, 0, 0);
      f.paint(b.g);
      b.tex.needsUpdate = true;
    }
    const s = b.sprite;
    s.center.set(f.ox / f.w, 1 - f.fy / f.h);
    s.scale.set((f.w / TILE) * FIGURE_SCALE, (f.h / TILE) * FIGURE_SCALE, 1);
    s.position.set(f.x / TILE, 0.02, f.y / TILE);
    s.material.color.copy(spriteTint);
    s.visible = true; b.seen = true;
  }

  // ── Per-frame ────────────────────────────────────────────────────────────
  const tmpV = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let lastOreUpdate = -1e9;
  let litHour = null, lastT = 0;
  const spriteTint = new THREE.Color(1, 1, 1); // unlit sprites follow the scene's light
  let frameNo = 0;

  function placeCamera(camX, camY) {
    const rig = cameraRig({
      centerX: (camX + VIEW_W / 2) / TILE, centerZ: (camY + VIEW_H / 2) / TILE,
      viewTilesW, aspect: VIEW_W / VIEW_H, pitchDeg: PITCH_DEG, fovDeg: FOV_DEG,
    });
    camera.position.set(rig.pos.x, rig.pos.y, rig.pos.z);
    camera.lookAt(rig.target.x, rig.target.y, rig.target.z);
    camera.updateMatrixWorld();
    return rig;
  }

  // Ground-plane footprint of the view → which chunks to keep resident.
  function visibleChunkRange() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1]]) {
      ray.setFromCamera({ x: nx, y: ny }, camera);
      const hit = ray.ray.intersectPlane(groundPlane, tmpV);
      const p = hit || camera.position.clone().add(ray.ray.direction.clone().multiplyScalar(160));
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    const pad = 4;
    return {
      cx0: Math.max(0, Math.floor((x0 - pad) / CHUNK)), cx1: Math.min(Math.ceil(MAP_W / CHUNK) - 1, Math.floor((x1 + pad) / CHUNK)),
      cy0: Math.max(0, Math.floor((z0 - pad) / CHUNK)), cy1: Math.min(Math.ceil(MAP_H / CHUNK) - 1, Math.floor((z1 + pad) / CHUNK)),
    };
  }

  function render(frame) {
    if (contextLost) throw new Error('WebGL context lost'); // caller falls back to 2D
    frameNo++;
    const t = frame.time;
    const rig = placeCamera(frame.camX, frame.camY);

    // Chunks: build what is visible (all at once on the first frame, then
    // at most two per frame so walking never hitches), drop far-away ones.
    const r = visibleChunkRange();
    const want = [];
    for (let cy = r.cy0; cy <= r.cy1; cy++) for (let cx = r.cx0; cx <= r.cx1; cx++) want.push([cx, cy]);
    const tc = rig.target.x / CHUNK, tz = rig.target.z / CHUNK;
    want.sort((a, b) => Math.hypot(a[0] + 0.5 - tc, a[1] + 0.5 - tz) - Math.hypot(b[0] + 0.5 - tc, b[1] + 0.5 - tz));
    let budget = frameNo === 1 ? Infinity : 2;
    for (const [cx, cy] of want) { if (budget <= 0) break; if (ensureChunk(cx, cy)) budget--; }
    for (const [key, c] of chunks) {
      if (c.cx < r.cx0 - 2 || c.cx > r.cx1 + 2 || c.cy < r.cy0 - 2 || c.cy > r.cy1 + 2) dropChunk(key);
    }

    // Light follows the in-game hour, eased forward so clock jumps glide.
    const wantHour = frame.hour ?? 12;
    const frameDt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
    litHour = litHour === null ? wantHour : advanceHour(litHour, wantHour, frameDt, 1.5);
    lastT = t;
    const s = sunForHour(litHour);
    const sky = new THREE.Color(s.sky);
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    scene.fog.near = rig.dist * 0.9; scene.fog.far = rig.dist * 2.4;
    hemi.color.set(s.sky).lerp(new THREE.Color('#ffffff'), 0.45);
    hemi.groundColor.set(s.ground);
    hemi.intensity = s.ambient * 1.25;
    sun.color.set(s.color);
    sun.intensity = s.intensity * 1.15;
    const el = s.elevation, az = s.azimuth;
    // Sun sweeps east→west and sits a little south, so shadows fall back
    // and away from the camera instead of hiding under objects.
    const hz = Math.cos(el);
    sun.position.set(rig.target.x + Math.cos(az) * hz * 60, Math.sin(el) * 60, rig.target.z + 0.45 * hz * 60);
    sun.target.position.set(rig.target.x, 0, rig.target.z - 6);
    sun.target.updateMatrixWorld();
    for (const [m, g] of nightGlow) m.emissiveIntensity = g.day + (g.night - g.day) * s.night;
    waterMat.uniforms.uTime.value = t / 1000;
    const lightLevel = 0.55 + 0.45 * (1 - s.night);
    waterMat.uniforms.uLight.value.setRGB(lightLevel, lightLevel, lightLevel * (1 + 0.12 * s.night));
    spriteTint.set(s.color).lerp(new THREE.Color('#ffffff'), 0.6).multiplyScalar(lightLevel);
    M.fire.emissiveIntensity = 1.6 + Math.sin(t * 0.02) * 0.4 + s.night;

    // Ore veins: spent/active state (cheap; a handful of nodes)
    if (t - lastOreUpdate > 200 || t < lastOreUpdate) {
      lastOreUpdate = t;
      for (const n of oreNodes) {
        const spent = !!host.isMineSpent(n.tx, n.ty);
        if (spent === n.spent) continue;
        n.spent = spent;
        for (const rk of n.rocks) rk.material = spent ? M.rockSpent : M.rock;
        for (const gm of n.gems) gm.visible = !spent;
      }
    }

    syncBuildings(frame.slots || []);
    for (const [, b] of buildings) {
      for (const p of b.smoke) {
        const k = ((t / 2600) + p.userData.phase) % 1;
        p.position.copy(p.userData.base).add(tmpV.set(k * 0.3, k * 1.2, -k * 0.1));
        p.scale.setScalar(0.18 + k * 0.32);
        p.material.opacity = 0.55 * (1 - k);
      }
      if (b.bob) b.bob.position.y = 2.3 + Math.sin(t * 0.004) * 0.12;
    }

    // Carriages
    for (const [, c] of carriages) c.obj.userData.seen = false;
    const p = frame.player;
    if (p && p.onRoad) {
      const hp = HORSE_PAL[Math.min(p.bootsTier | 0, 4)], wp = WAGON_PAL[Math.min(p.packTier | 0, 4)];
      syncCarriage('__player', `${p.packTier}|${p.bootsTier}`, { ...wp, horse: hp.body, mane: hp.mane, glow: hp.glow },
        p.x / TILE, p.y / TILE, p.facing || { x: 0, y: 1 }, p.moving, false, t, frameDt);
    }
    for (const tr of frame.traders || []) {
      const col = tr.color || '#8b5e2a';
      syncCarriage(tr.id, col, { body: col, roof: shade(col, 0.28).getStyle(), trim: '#f0c060', wheel: '#5a3a15', horse: '#b09060', mane: '#5a3810' },
        tr.x / TILE, tr.y / TILE, tr.facing || { x: 1, y: 0 }, tr.moving, tr.parked, t, frameDt);
    }
    for (const [id, c] of carriages) {
      if (!c.obj.userData.seen) {
        c.obj.visible = false;
        if (!(frame.traders || []).some(tr => tr.id === id) && id !== '__player') { dropCarriage(c); carriages.delete(id); }
      }
    }

    // Billboards (player on foot, city NPCs, other players)
    for (const [, b] of billboards) b.seen = false;
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    for (const f of frame.figures || []) syncBillboard(f);
    for (const [k, b] of billboards) {
      if (!b.seen) {
        b.sprite.visible = false;
        if (frameNo % 120 === 0) { scene.remove(b.sprite); b.tex.dispose(); b.sprite.material.dispose(); billboards.delete(k); }
      }
    }

    renderer.render(scene, camera);
  }

  // World pixel position (+ height in tiles) → 2D canvas pixel coords.
  function project(wx, wy, hTiles = 0) {
    tmpV.set(wx / TILE, hTiles, wy / TILE).project(camera);
    const c = ndcToCanvas(tmpV.x, tmpV.y, VIEW_W, VIEW_H);
    c.behind = tmpV.z > 1;
    return c;
  }

  // A point `px` figure-canvas pixels above a billboard's feet, offset along
  // the camera's up vector exactly as the sprite itself is drawn.
  const camUp = new THREE.Vector3();
  function projectBillboard(wx, wy, px) {
    camUp.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar((px / TILE) * FIGURE_SCALE);
    tmpV.set(wx / TILE, 0, wy / TILE).add(camUp).project(camera);
    const c = ndcToCanvas(tmpV.x, tmpV.y, VIEW_W, VIEW_H);
    c.behind = tmpV.z > 1;
    return c;
  }

  // 2D canvas pixel → world pixel. Prefers what the tap visibly hit (a roof,
  // a wall, a rock) and falls back to the ground plane.
  function unproject(sx, sy) {
    ray.setFromCamera({ x: (sx / VIEW_W) * 2 - 1, y: 1 - (sy / VIEW_H) * 2 }, camera);
    // A tap on a character or wagon means that entity: answer with where it
    // stands (its anchor), which is what the NPC/trader tap radius expects.
    const actors = [];
    // (The player's own figure/wagon is never a tap target.)
    for (const [k, b] of billboards) if (b.sprite.visible && k !== '__player') actors.push(b.sprite);
    for (const [k, c] of carriages) if (c.obj.visible && k !== '__player') actors.push(c.obj);
    const hits = ray.intersectObjects([...pickables], false);
    const nearestStructure = hits.length ? hits[0].distance : Infinity;
    for (const h of ray.intersectObjects(actors, true)) {
      if (h.distance > nearestStructure) break;     // hidden behind a building/rock
      const bb = h.object.userData.bb;
      if (bb && h.uv) {                              // skip the billboard's transparent padding
        const px = bb.g.getImageData(Math.min(bb.cv.width - 1, h.uv.x * bb.cv.width) | 0,
          Math.min(bb.cv.height - 1, (1 - h.uv.y) * bb.cv.height) | 0, 1, 1).data;
        if (px[3] < 24) continue;
      }
      let o = h.object;
      while (o && !o.userData.anchor) o = o.parent;
      if (o) return { x: o.position.x * TILE, y: o.position.z * TILE, hit: true, actor: true };
    }
    if (hits.length) {
      const h = hits[0].point;
      return { x: h.x * TILE, y: h.z * TILE, hit: true };
    }
    const g = ray.ray.intersectPlane(groundPlane, tmpV);
    return g ? { x: g.x * TILE, y: g.z * TILE, hit: false } : null;
  }

  function dispose() {
    ro?.disconnect();
    renderer.dispose();
    glCanvas.remove();
    host.canvas2d.style.background = '';
    host.canvas2d.style.position = '';
  }

  if (host.debug) window.__R3D_DEBUG = { THREE, renderer, scene, camera, sun };
  // Prime the camera so project/unproject work before the first render.
  placeCamera(0, 0);

  return {
    ok: true, renderer: 'three', version: THREE.REVISION, render, project, projectBillboard, unproject, dispose,
    stats: () => ({ chunks: chunks.size, buildings: buildings.size, carriages: carriages.size, billboards: billboards.size, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  };
}

if (typeof window !== 'undefined') window.CR3D = { createWorld3D };
