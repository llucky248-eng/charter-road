/* The Charter Road — web prototype (tiles + free roam)
   Step goal: tile engine + collision + 2 city zones with different rules.
*/

(() => {
  window.__BOOT_OK = true;
  const canvas = document.getElementById('game');
  if (!canvas) throw new Error('Missing canvas');

  // Mobile readability: use a smaller internal resolution so UI appears bigger when scaled to screen.
    const IS_MOBILE = (window.innerWidth <= 760) || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const BASE_W = IS_MOBILE ? 640 : 960;
  const BASE_H = IS_MOBILE ? 460 : Math.round(BASE_W * 9 / 16);
  canvas.width = BASE_W;
  canvas.height = BASE_H;

  const ctx = canvas.getContext('2d');


  // Crash guard: never fail silently (prevents blank screen reports)
  window.__crash = { msg: null };
  window.addEventListener('error', (e) => {
    const err = e?.error || e;
    window.__crash.msg = String(err && (err.stack || err.message) || err);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const err = e?.reason || e;
    window.__crash.msg = String(err && (err.stack || err.message) || err);
  });

  const VIEW_W = canvas.width;
  const VIEW_H = canvas.height;

  // --- QA harness (used by Playwright CI)
  const __QA = {
    enabled: new URLSearchParams(location.search).get('qa') === '1',
    status: 'pending',
    details: '',
  };
  // @ts-ignore
  window.__QA = __QA;

  function qaPass(details = '') {
    if (!__QA.enabled) return;
    __QA.status = 'pass';
    __QA.details = details;
    console.log('QA_PASS', details);
  }
  function qaFail(details = '') {
    if (!__QA.enabled) return;
    __QA.status = 'fail';
    __QA.details = details;
    console.error('QA_FAIL', details);
  }

  const TILE = IS_MOBILE ? 12 : 16;
  const UI_SCALE = IS_MOBILE ? 1.9 : 1.0;
      const HUD_H = Math.round((IS_MOBILE ? 48 : 56) * UI_SCALE);
  const MAP_W = 140;
  const MAP_H = 90;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function ellipsizeText(str, maxW) {
    if (!str) return '';
    if (ctx.measureText(str).width <= maxW) return str;
    const ell = '…';
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = str.slice(0, mid) + ell;
      if (ctx.measureText(s).width <= maxW) lo = mid + 1;
      else hi = mid;
    }
    const cut = Math.max(0, lo - 1);
    return str.slice(0, cut) + ell;
  }

  function max(a, b) { return a > b ? a : b; }

  function hash2(x, y) {
    // deterministic 0..1
    let n = (x * 374761393 + y * 668265263) >>> 0;
    n = (n ^ (n >> 13)) >>> 0;
    n = (n * 1274126177) >>> 0;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }

  // --- Input
  const keys = new Set();
  const vkeys = new Set(); // virtual keys (touch UI)
  const isDown = (code) => keys.has(code) || vkeys.has(code);

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(e.code)) e.preventDefault();


    // Event controls (keyboard)
    if (ui.eventOpen) {
      if (e.code === 'Escape') { closeEvent(); toast('You move on.', 2); }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') ui.eventSel = (ui.eventSel + ui.eventChoices.length - 1) % ui.eventChoices.length;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') ui.eventSel = (ui.eventSel + 1) % ui.eventChoices.length;
      if (e.code === 'Enter' || e.code === 'Space') {
        const ch = ui.eventChoices[ui.eventSel];
        if (ch && typeof ch.run === 'function') ch.run();
      }
    }
  }, { passive: false });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  const consumeVKey = (code) => {
    if (!vkeys.has(code)) return false;
    vkeys.delete(code);
    return true;
  };

  

  function handleMarketTap(sx, sy) {
    if (!ui.marketOpen) return false;

    // close
    const C = ui._marketClose;
    if (C && sx >= C.x && sx <= C.x + C.w && sy >= C.y && sy <= C.y + C.h) {
      ui.marketOpen = false;
      toast('Market closed', 1.6);
      return true;
    }

    // tabs
    const T = ui._marketTabs;
    if (T) {
      if (sx >= T.buy.x && sx <= T.buy.x + T.buy.w && sy >= T.buy.y && sy <= T.buy.y + T.buy.h) {
        ui.mode = 'buy';
        toast('BUY', 0.7);
        return true;
      }
      if (sx >= T.sell.x && sx <= T.sell.x + T.sell.w && sy >= T.sell.y && sy <= T.sell.y + T.sell.h) {
        ui.mode = 'sell';
        toast('SELL', 0.7);
        return true;
      }
    }



    // list: tap to select item (does not auto-confirm)
    const L = ui._marketList;
    if (L && sx >= L.x && sx <= L.x + L.w && sy >= L.y && sy <= L.y + L.h) {
      const vi = Math.floor((sy - L.y) / L.rowH);
      const i = clamp(ui.marketScroll + vi, 0, ITEMS.length); // includes permit row
      ui.selection = i;
      toast('Selected', 0.6);
      return true;
    }
    return false;
  }
// Touch UI -> virtual keys
  const touchUi = document.getElementById('touch-ui');
  if (touchUi) {
    // Prevent iOS/Android long-press selection/callout + context menu
    touchUi.addEventListener('contextmenu', (e) => e.preventDefault());
    const press = (code) => {
      vkeys.add(code);
      // auto-release for "tap" keys
      if (['KeyE','Tab','Enter','Escape','Space'].includes(code)) {
        setTimeout(() => vkeys.delete(code), 60);
      }
    };
    const holdStart = (code) => vkeys.add(code);
    const holdEnd = (code) => vkeys.delete(code);

    for (const btn of touchUi.querySelectorAll('[data-vkey]')) {
      const code = btn.getAttribute('data-vkey');
      if (!code) continue;

      const isHold = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(code);

      const onDown = (e) => {
        e.preventDefault();
        if (isHold) holdStart(code);
        else press(code);
      };
      const onUp = (e) => {
        e.preventDefault();
        if (isHold) holdEnd(code);
      };

      btn.addEventListener('pointerdown', onDown);
      btn.addEventListener('pointerup', onUp);
      btn.addEventListener('pointercancel', onUp);
      btn.addEventListener('pointerleave', onUp);
    }
  }



  

  function dragScrollMove(dy) {
    if (!ui._drag) return;
    if (ui._drag.kind !== 'market' && ui._drag.kind !== 'event') return;
    ui._drag.acc += dy;

    const L = ui._drag.kind === 'market' ? ui._marketList : ui._eventList;
    if (!L) return;

    const step = L.rowH;
    if (Math.abs(ui._drag.acc) >= step) {
      const n = (ui._drag.acc / step) | 0;
      if (ui._drag.kind === 'market') ui.marketScroll = clamp(ui.marketScroll - n, 0, L.scrollMax);
      else ui.eventScroll = clamp(ui.eventScroll - n, 0, L.scrollMax);
      ui._drag.acc -= n * step;
    }
  }
// Canvas touch drag for scrolling lists (mobile popups)
  canvas.addEventListener('pointerdown', (e) => {
    if (!IS_MOBILE) return;
    if (!ui.marketOpen && !ui.eventOpen) return;
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (VIEW_W / r.width);
    const sy = (e.clientY - r.top) * (VIEW_H / r.height);

    if (handleMarketTap(sx, sy)) { e.preventDefault(); return; }
    const kind = ui.marketOpen ? 'market' : 'event';
    const L = kind === 'market' ? ui._marketList : ui._eventList;
    if (!L) return;
    if (sx >= L.x && sx <= L.x + L.w && sy >= L.y && sy <= L.y + L.h) {
      ui._drag = { kind, lastY: sy, acc: 0 };
      canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }

    // event choices drag
    if (ui.eventOpen) {
      const E = ui._eventList;
      if (E && sx >= E.x && sx <= E.x + E.w && sy >= E.y && sy <= E.y + E.h) {
        ui._drag = { kind: 'event', lastY: sy, acc: 0 };
        canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }
    }

  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    if (!ui._drag) return;
    if (ui._drag.kind !== 'market' && ui._drag.kind !== 'event') return;
    const r = canvas.getBoundingClientRect();
    const sy = (e.clientY - r.top) * (VIEW_H / r.height);
    const dy = sy - ui._drag.lastY;
    ui._drag.lastY = sy;
    ui._drag.acc += dy;

    const L = ui._drag.kind === 'market' ? ui._marketList : ui._eventList;
    if (!L) return;
    const step = L.rowH;
    if (Math.abs(ui._drag.acc) >= step) {
      const n = (ui._drag.acc / step) | 0;
      if (ui._drag.kind === 'market') ui.marketScroll = clamp(ui.marketScroll - n, 0, L.scrollMax);
      else ui.eventScroll = clamp(ui.eventScroll - n, 0, L.scrollMax);
      ui._drag.acc -= n * step;
    }
    e.preventDefault();
  }, { passive: false });

  const endDrag = (e) => {
    if (!ui._drag) return;
    ui._drag = null;
    e.preventDefault?.();
  };
  canvas.addEventListener('pointerup', endDrag, { passive: false });
  canvas.addEventListener('pointercancel', endDrag, { passive: false });

  // iOS Safari fallback: Touch events (some WebViews are flaky with PointerEvents)
  const getTouchPos = (t) => {
    const r = canvas.getBoundingClientRect();
    const sx = (t.clientX - r.left) * (VIEW_W / r.width);
    const sy = (t.clientY - r.top) * (VIEW_H / r.height);
    return { sx, sy };
  };

  canvas.addEventListener('touchstart', (e) => {
    if (!IS_MOBILE) return;
    if (!ui.marketOpen && !ui.eventOpen) return;

    const t = e.touches && e.touches[0];
    if (!t) return;
    const { sx, sy } = getTouchPos(t);


    if (handleMarketTap(sx, sy)) { e.preventDefault(); return; }

    const kind = ui.marketOpen ? 'market' : 'event';
    const L = kind === 'market' ? ui._marketList : ui._eventList;
    if (!L) return;

    if (sx >= L.x && sx <= L.x + L.w && sy >= L.y && sy <= L.y + L.h) {
      ui._drag = { kind, lastY: sy, acc: 0 };
      e.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!ui._drag) return;
    if (ui._drag.kind !== 'market' && ui._drag.kind !== 'event') return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const { sy } = getTouchPos(t);
    const dy = sy - ui._drag.lastY;
    ui._drag.lastY = sy;
    dragScrollMove(dy);
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', () => { ui._drag = null; }, { passive: true });
  canvas.addEventListener('touchcancel', () => { ui._drag = null; }, { passive: true });


  // --- Tiles
  // 0 grass, 1 road, 2 water, 3 wall/rock, 4 city-floor, 5 gate, 6 market, 7 shrine, 8 camp, 9 ruins, 10 forest, 11 swamp, 12 contracts
  const SOLID = new Set([2, 3]);

  function makeMap() {
    const m = new Uint8Array(MAP_W * MAP_H);
    // base grass
    for (let i = 0; i < m.length; i++) m[i] = 0;

    // add water band (north river)
    for (let y = 10; y < 14; y++) {
      for (let x = 0; x < MAP_W; x++) m[y * MAP_W + x] = 2;
    }
    // bridges
    for (let y = 10; y < 14; y++) {
      for (let x = 68; x < 72; x++) m[y * MAP_W + x] = 1;
    }

    // rocks/walls border
    for (let x = 0; x < MAP_W; x++) { m[x] = 3; m[(MAP_H-1) * MAP_W + x] = 3; }
    for (let y = 0; y < MAP_H; y++) { m[y * MAP_W] = 3; m[y * MAP_W + (MAP_W-1)] = 3; }

    // roads between cities
    const carveRoad = (x0,y0,x1,y1) => {
      let x=x0, y=y0;
      while (x !== x1) { m[y*MAP_W + x] = 1; x += x < x1 ? 1 : -1; }
      while (y !== y1) { m[y*MAP_W + x] = 1; y += y < y1 ? 1 : -1; }
      m[y*MAP_W + x] = 1;
    };

    // City A region (Sunspire)
    const cityA = { id:'sunspire', name:'Sunspire', x: 18, y: 26, w: 22, h: 16 };
    // City B region (Gloomwharf)
    const cityB = { id:'gloomwharf', name:'Gloomwharf', x: 96, y: 54, w: 26, h: 18 };

    const paintCity = (c) => {
      for (let yy = c.y; yy < c.y + c.h; yy++) {
        for (let xx = c.x; xx < c.x + c.w; xx++) {
          m[yy*MAP_W + xx] = 4;
        }
      }

      // market stall (simple interaction point)
      const mx = c.x + 4;
      const my = c.y + 4;
      m[my*MAP_W + mx] = 6;
      m[my*MAP_W + (mx+1)] = 6;

      // contracts board
      const cx = c.x + 10;
      const cy = c.y + 4;
      m[cy*MAP_W + cx] = 12;

      // simple wall border
      for (let xx = c.x; xx < c.x + c.w; xx++) {
        m[(c.y-1)*MAP_W + xx] = 3;
        m[(c.y+c.h)*MAP_W + xx] = 3;
      }
      for (let yy = c.y; yy < c.y + c.h; yy++) {
        m[yy*MAP_W + (c.x-1)] = 3;
        m[yy*MAP_W + (c.x+c.w)] = 3;
      }
      // gate (road entry) — wider for easier access
      const gx = c.x + Math.floor(c.w/2);
      const gy = c.y + c.h;
      for (let ox = -2; ox <= 2; ox++) {
        m[gy*MAP_W + (gx + ox)] = 5;
        m[(gy+1)*MAP_W + (gx + ox)] = 1;
      }
      return { gx, gy };
    };

    const gateA = paintCity(cityA);
    const gateB = paintCity(cityB);

    carveRoad(gateA.gx, gateA.gy+1, 70, 12);

    // biome patches (visual variety)
    const paintPatch = (cx, cy, r, tileId, density=0.9) => {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 1 || y < 1 || x >= MAP_W-1 || y >= MAP_H-1) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d > r) continue;
          const falloff = 1 - (d / r);
          if (Math.random() < falloff * density) {
            const idx = y*MAP_W + x;
            if (m[idx] === 0) m[idx] = tileId;
          }
        }
      }
    };

    // place forests mostly in NW and SE, swamp near river lowlands
    paintPatch(26, 18, 16, 10, 0.85);
    paintPatch(108, 70, 18, 10, 0.80);
    paintPatch(56, 18, 12, 11, 0.80);
    paintPatch(86, 16, 10, 11, 0.75);

    carveRoad(70, 12, gateB.gx, gateB.gy+1);

    // scatter a few rocks for flavor
    for (let i = 0; i < 650; i++) {
      const x = 1 + (Math.random() * (MAP_W-2) | 0);
      const y = 1 + (Math.random() * (MAP_H-2) | 0);
      const idx = y*MAP_W + x;
      if (m[idx] === 0 && Math.random() < 0.08) m[idx] = 3;
    }



    // map landmarks between cities (non-solid POIs)
    // 7 shrine, 8 camp, 9 ruins, 10 forest, 11 swamp, 12 contracts
    const placePOI = (wantId, tries=800) => {
      for (let t = 0; t < tries; t++) {
        const x = 2 + (Math.random() * (MAP_W - 4) | 0);
        const y = 2 + (Math.random() * (MAP_H - 4) | 0);
        const i = y * MAP_W + x;
        if (m[i] !== 0) continue;

        // prefer near roads
        const nearRoad = (
          m[i-1] === 1 || m[i+1] === 1 || m[i-MAP_W] === 1 || m[i+MAP_W] === 1 ||
          m[i-MAP_W-1] === 1 || m[i-MAP_W+1] === 1 || m[i+MAP_W-1] === 1 || m[i+MAP_W+1] === 1
        );
        if (!nearRoad) continue;

        // avoid city rectangles (with padding)
        const inA = (x >= cityA.x-3 && x < cityA.x + cityA.w + 3 && y >= cityA.y-3 && y < cityA.y + cityA.h + 3);
        const inB = (x >= cityB.x-3 && x < cityB.x + cityB.w + 3 && y >= cityB.y-3 && y < cityB.y + cityB.h + 3);
        if (inA || inB) continue;

        m[i] = wantId;
        return;
      }
    };

    for (let i = 0; i < 8; i++) placePOI(7);
    for (let i = 0; i < 6; i++) placePOI(8);
    for (let i = 0; i < 4; i++) placePOI(9);

    return { m, cityA, cityB };
  }

  const world = makeMap();


  // --- Mini-map (precomputed)
  const mini = {
    canvas: document.createElement('canvas'),
    w: MAP_W,
    h: MAP_H,
    scale: IS_MOBILE ? 1 : 1, // internal scale (1px per tile)
  };
  mini.canvas.width = mini.w;
  mini.canvas.height = mini.h;
  const miniCtx = mini.canvas.getContext('2d');

  function rebuildMiniMap() {
    const img = miniCtx.createImageData(mini.w, mini.h);
    const d = img.data;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const id = world.m[y * MAP_W + x];
        let r=18, g=22, b=28; // default dark
        if (id === 0) { r=28; g=92; b=52; }         // grass
        else if (id === 1) { r=170; g=122; b=76; }  // road
        else if (id === 2) { r=30; g=96; b=180; }   // water
        else if (id === 3) { r=70; g=76; b=86; }    // rock
        else if (id === 4) { r=120; g=98; b=74; }   // city floor
        else if (id === 5) { r=240; g=220; b=180; } // gate
        else if (id === 6) { r=234; g=179; b=8; }   // market
        else if (id === 7) { r=167; g=139; b=250; } // shrine
        else if (id === 8) { r=217; g=119; b=6; }   // camp
        else if (id === 9) { r=156; g=163; b=175; } // ruins
        const i = (y * mini.w + x) * 4;
        d[i+0]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
      }
    }
    miniCtx.putImageData(img, 0, 0);
  }

  rebuildMiniMap();

  const PERMIT_PRICE = 45;

  const CITY_RULES = {
    sunspire: {
      taxRate: 0.18,
      inspectionChance: 0.65,
      contraband: ['Cursed Relics', 'Demon Ink'],
      fineBase: 18,
      finePerItem: 6,
      vibe: 'Orderly. Safe. Expensive.'
    },
    gloomwharf: {
      taxRate: 0.05,
      inspectionChance: 0.15,
      contraband: ['Blessed Water'],
      fineBase: 8,
      finePerItem: 3,
      vibe: 'Lawless. Profitable. Risky.'
    }
  };



  const ITEMS = [
    { id: 'food', name: 'Dried Rations', base: 12, weight: 1 },
    { id: 'ore', name: 'Iron Ore', base: 18, weight: 2 },
    { id: 'herbs', name: 'Moon Herbs', base: 16, weight: 1 },
    { id: 'potion', name: 'Minor Potion', base: 34, weight: 1 },
    { id: 'relic', name: 'Old Relic', base: 55, weight: 2 },
    { id: 'ink', name: 'Demon Ink', base: 70, weight: 1, contrabandName: 'Demon Ink' },
  ];

  // --- Market model (minimal, deterministic)
  // Goals:
  // - Per-town price differences that persist for a run (seeded by city+item).
  // - Avoid degenerate buy->sell loops in the same town (spread).
  // - Provide profit clarity via “reference/base” and “last seen” prices.
  const MARKET = {
    spread: 0.14,          // buy price = mid*(1+spread/2), sell price = mid*(1-spread/2)
    lastSeen: {
      // cityId: { itemId: { buy:number, sell:number, t:number } }
    },
  };

  function citySeed(cityId) {
    // Keep stable across reloads within a run; if a global seed exists, incorporate later.
    // 1..1e9-ish.
    const a = cityId === 'sunspire' ? 1337 : 7331;
    return a;
  }

  function seeded01(a, b, c = 0) {
    // deterministic 0..1 based on 3 ints
    let n = (a * 374761393 + b * 668265263 + c * 362437) >>> 0;
    n = (n ^ (n >> 13)) >>> 0;
    n = (n * 1274126177) >>> 0;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }

  function townItemModifier(cityId, itemId) {
    const cs = citySeed(cityId);
    // ~ +/-18% persistent skew per item per city
    const u = seeded01(cs, itemId.length, itemId.charCodeAt(0) || 0);
    const skew = (u * 2 - 1) * 0.18;

    // A tiny city-wide tilt as well (keeps towns feeling distinct even if per-item skews coincide)
    const v = seeded01(cs, 999, 42);
    const cityTilt = (v * 2 - 1) * 0.06;
    return 1 + skew + cityTilt;
  }

  function referencePrice(item) {
    // The “fair” reference the UI can compare against.
    return Math.max(1, Math.round(item.base));
  }

  function midPriceFor(cityId, item) {
    // persistent town differences + tiny time wobble
    const mod = townItemModifier(cityId, item.id);
    const wob = 0.97 + (Math.sin((item.base + stateTime) * 0.001) + 1) * 0.03;
    return Math.max(1, Math.round(item.base * mod * wob));
  }

  function quoteFor(cityId, item) {
    const mid = midPriceFor(cityId, item);
    const half = MARKET.spread / 2;
    const buy = Math.max(1, Math.round(mid * (1 + half)));
    const sell = Math.max(1, Math.round(mid * (1 - half)));
    return { mid, buy, sell };
  }

  function rememberLastSeen(cityId, itemId, q) {
    if (!MARKET.lastSeen[cityId]) MARKET.lastSeen[cityId] = {};
    MARKET.lastSeen[cityId][itemId] = { buy: q.buy, sell: q.sell, t: stateTime };
  }

  function lastSeenFor(cityId, itemId) {
    return MARKET.lastSeen?.[cityId]?.[itemId] || null;
  }

  function fmtDeltaPct(cur, ref) {
    if (!ref) return '';
    const d = (cur - ref) / ref;
    const pct = Math.round(d * 100);
    return (pct >= 0 ? `+${pct}%` : `${pct}%`);
  }


  const CONTRACT_ITEMS = ['food','ore','herbs','potion','relic'];


  function rewardForContract(want, qty) {
    const it = ITEMS.find(x => x.id === want);
    const base = it ? it.base : 20;
    // Scale with item value and quantity; add a small premium so contracts feel worthwhile.
    const premium = want === 'relic' ? 22 : (want === 'potion' ? 10 : 6);
    const r = 10 + premium + Math.round(base * qty * 0.85);
    return clamp(r, 18, 160);
  }

  function makeContract(fromId) {
    const want = randChoice(CONTRACT_ITEMS);
    const qty = 1 + (Math.random()*2|0);
    const toId = fromId === 'sunspire' ? 'gloomwharf' : 'sunspire';
    const reward = rewardForContract(want, qty);
    return { fromId, toId, want, qty, reward };
  }

  const contracts = {
    byCity: {
      sunspire: [makeContract('sunspire'), makeContract('sunspire'), makeContract('sunspire')],
      gloomwharf: [makeContract('gloomwharf'), makeContract('gloomwharf'), makeContract('gloomwharf')],
    },
    active: null,
  };


  // --- Time / travel pressure
  let stateTime = 0;

  const time = {
    day: 1,
    frac: 0, // fractional day progress [0,1)
    seed: 1,
  };

  // Deterministic PRNG for travel events & market drift (stable for testing)
  function rand01() {
    time.seed = (time.seed * 1664525 + 1013904223) >>> 0;
    return time.seed / 4294967296;
  }

  // Simple, slow market drift by day (small per-item per-city multipliers)
  const marketDrift = {
    sunspire: Object.fromEntries(ITEMS.map(it => [it.id, 1])),
    gloomwharf: Object.fromEntries(ITEMS.map(it => [it.id, 1])),
  };

  function advanceDays(days, reason = '') {
    if (!Number.isFinite(days) || days <= 0) return;
    time.frac += days;
    let advanced = 0;
    while (time.frac >= 1) {
      time.frac -= 1;
      time.day += 1;
      advanced += 1;
      // tiny drift; mean ~0 over time; clamp to keep prices sane
      for (const cityId of Object.keys(marketDrift)) {
        for (const it of ITEMS) {
          const r = rand01();
          const delta = (r - 0.5) * 0.04; // +/-2% per day
          marketDrift[cityId][it.id] = clamp(marketDrift[cityId][it.id] * (1 + delta), 0.85, 1.20);
        }
      }
    }

    if (advanced > 0) {
      toast(reason ? `Day +${advanced} (${reason}).` : `Day +${advanced}.`, 1.8);
    }
  }

  // Iteration notes (rendered into the bottom textbox)
                                                                                                                  const ITERATION = {
    version: 'v0.0.82',
    whatsNew: [
      'Travel time: moving on roads consumes days; each day consumes 1 rations (or 3g penalty).',
      'Market drift: prices slowly drift day-by-day (small +/- changes per city/item).',
      'Road events: added Good Omen (+5-12g) and Merchant Escort (+8g) encounters.',
      'UI: Active contract pinned on mobile HUD; minimap compass arrow to destination.',
    ],
    whatsNext: [
      'Checkpoint/patrol encounters outside cities (rep/permit consequences).',
      'Contracts: tune rewards + add accept/abandon UX.',
      'Balance: tune travel speed, food upkeep, and event frequency.',
    ],
  };

  const ui = {
    marketOpen: false,
    toast: 'Walk into a city. Find the market tile and press E.',
    toastT: 6,
    selection: 0,
    marketScroll: 0, // first visible item index
    _marketList: null,
    _marketTabs: null,
    _marketClose: null,
    _drag: null,
    mode: 'buy', // buy|sell
    navT: 0,

    eventOpen: false,

    contractsOpen: false,
    contractsCityId: null,
    eventTitle: '',
    eventText: '',
    eventChoices: [], // {label, run:()=>void}
    eventSel: 0,
    eventScroll: 0, // first visible choice index
    _eventList: null,
    eventNavT: 0,

    contractsSel: 0,
    contractsNavT: 0,
  };

  // Render iteration notes into the bottom textbox (if present)
  const devlogBody = document.getElementById('devlog-body');
  if (devlogBody) {
    const v = ITERATION.version ? ` ${ITERATION.version}` : '';
    devlogBody.textContent =
      `Version:${v}\n\nWhat’s new:\n- ${ITERATION.whatsNew.join('\n- ')}\n\nWhat’s coming:\n- ${ITERATION.whatsNext.join('\n- ')}`;
  }

  // --- HTML UI overlay (Market / Contracts / Event)
  const USE_DOM_MODALS = true;
  const uiRoot = document.getElementById('ui-root');
  const dom = {
    kind: null,
    key: null,
  };

  function domCloseAll() {
    if (!uiRoot) return;
    document.body.classList.remove('ui-open');
    uiRoot.setAttribute('aria-hidden', 'true');
    uiRoot.innerHTML = '';
    dom.kind = null;
    dom.key = null;
  }

  function domEnsureOpen() {
    if (!uiRoot) return;
    document.body.classList.add('ui-open');
    uiRoot.setAttribute('aria-hidden', 'false');
  }

  function htmlEscape(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function marketTryTrade(index, qty = 1) {
    const c = currentCity();
    if (!c) return;

    const q = Math.max(1, Math.floor(Number(qty) || 1));

    const isPermitRow = index === ITEMS.length;
    if (isPermitRow) {
      // permit only supports qty=1
      if (player.permits[c.id]) { toast('Permit already owned.', 2); return; }
      if (player.gold < PERMIT_PRICE) { toast(`Not enough gold (need ${PERMIT_PRICE}g).`, 2); return; }
      player.gold -= PERMIT_PRICE;
      if (player.gold < 0) { player.gold = 0; toast('Trade blocked (gold would go negative).', 2); return; }
      player.permits[c.id] = true;
      toast('Purchased city permit.', 2.2);
      return;
    }

    const it = ITEMS[index];
    if (!it) return;
    const p = priceFor(c.id, it);

    if (ui.mode === 'buy') {
      const w = invWeight();
      const free = Math.max(0, player.capacity - w);
      const maxBySpace = it.weight > 0 ? Math.floor(free / it.weight) : 0;
      const maxByGold = p > 0 ? Math.floor(player.gold / p) : 0;
      const can = Math.max(0, Math.min(maxBySpace, maxByGold));
      if (can <= 0) {
        if (maxBySpace <= 0) toast('No space in pack.', 2);
        else toast('Not enough gold.', 2);
        return;
      }
      const buyN = Math.min(q, can);
      const cost = buyN * p;
      if (cost <= 0 || player.gold < cost) { toast('Not enough gold.', 2); return; }
      if (w + buyN * it.weight > player.capacity) { toast('No space in pack.', 2); return; }

      player.gold -= cost;
      if (player.gold < 0) { player.gold += cost; toast('Trade blocked (gold would go negative).', 2); return; }
      player.inv[it.id] = (player.inv[it.id] || 0) + buyN;
      toast(`Bought ${buyN} ${it.name} (-${cost}g)`, 2);
      return;
    }

    // sell
    const have = player.inv[it.id] || 0;
    if (have <= 0) { toast('You have none to sell.', 2); return; }
    const sellN = Math.min(q, have);
    if (sellN <= 0) { toast('Invalid quantity.', 2); return; }
    const netEach = Math.max(1, Math.round(p * (1 - CITY_RULES[c.id].taxRate)));
    const gain = sellN * netEach;

    player.inv[it.id] = have - sellN;
    if (player.inv[it.id] < 0) { player.inv[it.id] = have; toast('Trade blocked (qty would go negative).', 2); return; }
    player.gold += gain;
    if (player.gold < 0) { player.gold -= gain; player.inv[it.id] = have; toast('Trade blocked (gold would go negative).', 2); return; }
    toast(`Sold ${sellN} ${it.name} (+${gain}g after tax)`, 2);
  }

  function contractsAccept(idx) {
    const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
    if (!c) return;
    const jobs = contracts.byCity[c.id] || [];
    const job = jobs[idx];
    if (!job) return;

    contracts.active = { ...job };
    toast('Accepted contract.', 2);

    // QA hook: accepting a contract must not crash and should activate a job.
    if (__QA.enabled && !contracts.active) qaFail('accept: contracts.active not set');

    // Close both UI systems (DOM overlay + canvas fallback) to avoid “stuck modal” / null-city crashes.
    ui.contractsOpen = false;
    domCloseAll();
  }

  function domRender() {
    if (!USE_DOM_MODALS || !uiRoot) return;

    const kind = ui.eventOpen ? 'event' : (ui.marketOpen ? 'market' : (ui.contractsOpen ? 'contracts' : null));
    if (!kind) { domCloseAll(); return; }

    // NOTE: keep render keys small but sufficient; rebuild modal when state changes.
    let key = kind;
    if (kind === 'market') {
      const c = currentCity();
      key += `|${c ? c.id : 'none'}|${ui.mode}|${ui.selection}|${ui.marketScroll}|${player.gold}|${invWeight()}|${player.permits[c?.id] ? 1 : 0}`;
      for (const it of ITEMS) key += `|${player.inv[it.id] || 0}`;
    } else if (kind === 'contracts') {
      const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
      key += `|${c ? c.id : 'none'}|${ui.contractsSel}|${contracts.active ? (contracts.active.want+contracts.active.toId+contracts.active.qty) : 'none'}`;
    } else if (kind === 'event') {
      key += `|${ui.eventTitle}|${ui.eventText}|${ui.eventSel}|${ui.eventChoices.length}`;
    }

    if (dom.key === key) return;
    dom.key = key;
    dom.kind = kind;
    domEnsureOpen();

    if (kind === 'market') {
      const c = currentCity();
      if (!c) { domCloseAll(); return; }
      const rules = CITY_RULES[c.id];
      const hasPermit = !!player.permits[c.id];

      const totalN = ITEMS.length + 1;
      const rows = [];
      for (let i = 0; i < totalN; i++) {
        const selected = i === ui.selection;
        const isPermitRow = i === ITEMS.length;
        const it = isPermitRow ? null : ITEMS[i];
        const price = isPermitRow ? PERMIT_PRICE : priceFor(c.id, it);
        const have = isPermitRow ? 0 : (player.inv[it.id] || 0);
        const contra = (!isPermitRow) && it.contrabandName && rules.contraband.includes(it.contrabandName);

        const title = isPermitRow ? (hasPermit ? 'City Permit (owned)' : 'City Permit') : it.name;
        const sub = isPermitRow ? 'Reduces inspections in this city' : `You have: ${have} · Weight: ${it.weight}`;
        const right = isPermitRow ? (hasPermit ? 'Owned' : `${price}g`) : `${price}g`;
        const badge = contra ? '<span class="cr-badge">CONTRABAND</span>' : '';

        if (isPermitRow) {
          const actionLabel = hasPermit ? 'Owned' : 'Buy';
          const actionDisabled = hasPermit ? 'disabled' : '';
          rows.push(`
            <div class="cr-card" role="button" tabindex="0" data-idx="${i}" aria-current="${selected}">
              <div>
                <div class="cr-card-title">${htmlEscape(title)}</div>
                <div class="cr-card-sub">${htmlEscape(sub)}</div>
                ${badge}
              </div>
              <div class="cr-right">
                <div class="cr-price">${htmlEscape(right)}</div>
                <button class="cr-tab" style="margin-top:10px; padding:10px 10px;" data-action="trade" data-idx="${i}" data-qty="1" ${actionDisabled}>${htmlEscape(actionLabel)}</button>
              </div>
            </div>
          `);
        } else {
          // Quick actions for regular items
          const w = invWeight();
          const free = Math.max(0, player.capacity - w);
          const maxBySpace = it.weight > 0 ? Math.floor(free / it.weight) : 0;
          const maxByGold = price > 0 ? Math.floor(player.gold / price) : 0;
          const maxBuy = ui.mode === 'buy' ? Math.max(0, Math.min(maxBySpace, maxByGold)) : have;

          const btnBase = 'style="margin-top:6px;padding:6px 8px;font-size:12px;"';
          const mkBtn = (label, qty, disabled) => `<button class="cr-tab" ${btnBase} data-action="trade" data-idx="${i}" data-qty="${qty}" ${disabled ? 'disabled' : ''}>${label}</button>`;

          const q1 = mkBtn('±1', 1, false);
          const q5 = mkBtn('±5', 5, maxBuy < 5);
          const qMax = mkBtn(ui.mode === 'buy' ? 'MAX' : 'ALL', maxBuy > 0 ? maxBuy : 1, maxBuy <= 0);

          rows.push(`
            <div class="cr-card" role="button" tabindex="0" data-idx="${i}" aria-current="${selected}">
              <div>
                <div class="cr-card-title">${htmlEscape(title)}</div>
                <div class="cr-card-sub">${htmlEscape(sub)}</div>
                ${badge}
              </div>
              <div class="cr-right">
                <div class="cr-price">${htmlEscape(right)}</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;">
                  ${q1}${q5}${qMax}
                </div>
              </div>
            </div>
          `);
        }
      }

      const w = invWeight();
      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Market">
          <div class="cr-panel">
            <div class="cr-head">
              <div>
                <div class="cr-title">${htmlEscape(c.name)} Market</div>
                <div class="cr-sub">${htmlEscape(rules.vibe)}</div>
              </div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>
            <div class="cr-tabs" role="tablist" aria-label="Buy or sell">
              <button class="cr-tab" role="tab" aria-selected="${ui.mode === 'buy'}" data-action="mode" data-mode="buy">BUY</button>
              <button class="cr-tab" role="tab" aria-selected="${ui.mode === 'sell'}" data-action="mode" data-mode="sell">SELL</button>
            </div>
            <div class="cr-body">
              <div class="cr-list" aria-label="Items">
                ${rows.join('')}
              </div>
            </div>
            <div class="cr-foot">
              <div><strong>Gold:</strong> ${player.gold}g &nbsp; <strong>Pack:</strong> ${w}/${player.capacity}</div>
              <div class="cr-hint">Esc close · Tab switch · Enter trade</div>
            </div>
          </div>
        </div>
      `;

      // Bind events (re-bound on re-render)
      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.marketOpen = false; toast('Market closed', 2); }));
      uiRoot.querySelectorAll('[data-action="mode"]').forEach(el => el.addEventListener('click', () => { ui.mode = el.getAttribute('data-mode'); toast(ui.mode.toUpperCase(), 0.7); }));
      uiRoot.querySelectorAll('[data-idx]').forEach(el => {
        el.addEventListener('click', (ev) => {
          const idx = Number(el.getAttribute('data-idx'));
          if (Number.isFinite(idx)) ui.selection = idx;
        });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            const idx = Number(el.getAttribute('data-idx'));
            if (Number.isFinite(idx)) { ui.selection = idx; marketTryTrade(idx, 1); }
          }
        });
      });

      // quick quantity actions
      uiRoot.querySelectorAll('[data-action="trade"]').forEach(el => el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = Number(el.getAttribute('data-idx'));
        const qty = Number(el.getAttribute('data-qty') || '1');
        if (Number.isFinite(idx)) { ui.selection = idx; marketTryTrade(idx, qty); }
      }));

      return;
    }

    if (kind === 'contracts') {
      const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
      if (!c) { domCloseAll(); return; }
      const jobs = contracts.byCity[c.id] || [];

      const rows = jobs.map((job, i) => {
        const it = ITEMS.find(x => x.id === job.want);
        const selected = i === ui.contractsSel;
        return `
          <div class="cr-card" role="button" tabindex="0" data-cidx="${i}" aria-current="${selected}">
            <div>
              <div class="cr-card-title">Deliver ${job.qty}× ${htmlEscape(it ? it.name : job.want)} → ${htmlEscape(job.toId)}</div>
              <div class="cr-card-sub">Reward: ${job.reward}g</div>
            </div>
            <div class="cr-right">
              <div class="cr-price">${job.reward}g</div>
              <button class="cr-tab" style="margin-top:10px; padding:10px 10px;" data-action="accept" data-cidx="${i}">Accept</button>
            </div>
          </div>
        `;
      });

      const activeLine = contracts.active
        ? (() => {
            const it = ITEMS.find(x=>x.id===contracts.active.want);
            const prog = activeContractProgressLabel();
            return `Active: Deliver ${contracts.active.qty} ${htmlEscape(it ? it.name : contracts.active.want)} (${htmlEscape(prog)}) → ${htmlEscape(contracts.active.toId)} for ${contracts.active.reward}g`;
          })()
        : 'Pick a job. Deliver to the other city for gold + rep.';

      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Contracts">
          <div class="cr-panel">
            <div class="cr-head">
              <div>
                <div class="cr-title">${htmlEscape(c.name)} Contracts</div>
                <div class="cr-sub">${activeLine}</div>
              </div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>
            <div class="cr-body">
              <div class="cr-list" aria-label="Jobs">
                ${rows.join('') || '<div class="cr-sub">No jobs posted.</div>'}
              </div>
            </div>
            <div class="cr-foot">
              <div class="cr-hint">Esc close · ↑/↓ select</div>
              <div class="cr-hint">Enter accept</div>
            </div>
          </div>
        </div>
      `;

      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.contractsOpen = false; toast('Contracts board closed', 2); }));
      uiRoot.querySelectorAll('[data-cidx]').forEach(el => {
        el.addEventListener('click', () => { const idx = Number(el.getAttribute('data-cidx')); if (Number.isFinite(idx)) ui.contractsSel = idx; });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            const idx = Number(el.getAttribute('data-cidx'));
            if (Number.isFinite(idx)) { ui.contractsSel = idx; contractsAccept(idx); }
          }
        });
      });
      uiRoot.querySelectorAll('[data-action="accept"]').forEach(el => el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = Number(el.getAttribute('data-cidx'));
        if (Number.isFinite(idx)) { ui.contractsSel = idx; contractsAccept(idx); }
      }));
      return;
    }

    if (kind === 'event') {
      const rows = ui.eventChoices.map((ch, i) => {
        const selected = i === ui.eventSel;
        return `
          <div class="cr-card" role="button" tabindex="0" data-eidx="${i}" aria-current="${selected}">
            <div>
              <div class="cr-card-title">${htmlEscape(ch.label)}</div>
            </div>
            <div class="cr-right">
              <button class="cr-tab" style="padding:10px 10px;" data-action="choose" data-eidx="${i}">Choose</button>
            </div>
          </div>
        `;
      });

      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Event">
          <div class="cr-panel">
            <div class="cr-head">
              <div>
                <div class="cr-title">${htmlEscape(ui.eventTitle || 'On the road')}</div>
                <div class="cr-sub">${htmlEscape(ui.eventText || '')}</div>
              </div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>
            <div class="cr-body">
              <div class="cr-list" aria-label="Choices">
                ${rows.join('')}
              </div>
            </div>
            <div class="cr-foot">
              <div class="cr-hint">Esc close · ↑/↓ select · Enter choose</div>
            </div>
          </div>
        </div>
      `;

      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { closeEvent(); toast('You move on.', 2); }));
      uiRoot.querySelectorAll('[data-eidx]').forEach(el => {
        el.addEventListener('click', () => { const idx = Number(el.getAttribute('data-eidx')); if (Number.isFinite(idx)) ui.eventSel = idx; });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            const idx = Number(el.getAttribute('data-eidx'));
            if (Number.isFinite(idx)) {
              ui.eventSel = idx;
              const ch = ui.eventChoices[idx];
              if (ch && typeof ch.run === 'function') ch.run();
            }
          }
        });
      });
      uiRoot.querySelectorAll('[data-action="choose"]').forEach(el => el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = Number(el.getAttribute('data-eidx'));
        if (Number.isFinite(idx)) {
          ui.eventSel = idx;
          const ch = ui.eventChoices[idx];
          if (ch && typeof ch.run === 'function') ch.run();
        }
      }));
      return;
    }
  }

  // --- Player
  // Sprite sheet (8-direction, animated). Falls back to the old marker if not loaded.
  // Sheet layout (assets/player_adventurer.png):
  // - 32x32 frames
  // - 8 columns allocated
  // - 16 rows total:
  //   - rows 0..7: idle (4 frames used: cols 0..3)
  //   - rows 8..15: walk (8 frames used: cols 0..7)
  // Direction row order: N, NE, E, SE, S, SW, W, NW
  const playerSprite = (() => {
    const img = new Image();
    img.src = 'assets/player_adventurer.png';
    const s = {
      img,
      ready: false,

      frameW: 32,
      frameH: 32,
      cols: 8,
      rows: 16,

      walkFrames: 8,
      idleFrames: 4,
      walkRowBase: 8,
      idleRowBase: 0,

      // 8 dirs mapped to rows: 0..7 in the order below
      dirOrder: ['N','NE','E','SE','S','SW','W','NW'],
      dir: 4, // start facing S
      anim: 'idle', // 'idle' | 'walk'
      frame: 0,
      t: 0,
      fpsWalk: 12,
      fpsIdle: 4,

      _loggedError: false,
    };
    img.onload = () => { s.ready = true; };
    img.onerror = () => {
      s.ready = false;
      if (!s._loggedError) {
        s._loggedError = true;
        console.warn('Player sprite failed to load: assets/player_adventurer.png');
      }
    };
    return s;
  })();

  const player = {
    x: (world.cityA.x + world.cityA.w/2) * TILE,
    y: (world.cityA.y + world.cityA.h + 4) * TILE,
    r: 8,
    vx: 0,
    vy: 0,
    speed: 120,

    // Movement-derived facing/anim
    facing: { x: 0, y: 1 },

    gold: 120,
    capacity: 18,
    inv: Object.fromEntries(ITEMS.map(it => [it.id, 0])),

    lastCityId: null,

    rep: { sunspire: 0, gloomwharf: 0 },
    permits: { sunspire: false, gloomwharf: false },

  };

  const camera = { x: player.x - VIEW_W/2, y: player.y - VIEW_H/2 };

  function tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 3;
    return world.m[ty * MAP_W + tx];
  }

  function invWeight() {
    let w = 0;
    for (const it of ITEMS) w += (player.inv[it.id] || 0) * it.weight;
    return w;
  }

  function priceFor(cityId, item) {
    // Simple city multipliers (data-driven later)
    const mult = cityId === 'sunspire'
      ? (item.id === 'potion' ? 0.8 : item.id === 'ore' ? 1.2 : 1.0)
      : (item.id === 'relic' ? 1.25 : item.id === 'food' ? 0.85 : 1.05);
    // tiny wobble so it feels alive
    const wob = 0.95 + (Math.sin((item.base + stateTime) * 0.001) + 1) * 0.04;
    const drift = (marketDrift[cityId] && marketDrift[cityId][item.id]) ? marketDrift[cityId][item.id] : 1;
    return Math.max(1, Math.round(item.base * mult * wob * drift));
  }

  function isSolidAt(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    return SOLID.has(tileAt(tx, ty));
  }

  function moveWithCollision(dt) {
    if (ui.marketOpen || ui.eventOpen || ui.contractsOpen) return;
    const ax = (isDown('KeyD') || isDown('ArrowRight') ? 1 : 0) - (isDown('KeyA') || isDown('ArrowLeft') ? 1 : 0);
    const ay = (isDown('KeyS') || isDown('ArrowDown') ? 1 : 0) - (isDown('KeyW') || isDown('ArrowUp') ? 1 : 0);
    const mag = Math.hypot(ax, ay);
    const nx = mag > 0 ? ax / mag : 0;
    const ny = mag > 0 ? ay / mag : 0;

    player.vx = nx * player.speed;
    player.vy = ny * player.speed;

    // Track last facing direction from input (for 8-way sprite)
    if (mag > 0) player.facing = { x: nx, y: ny };

    const stepX = player.vx * dt;
    const stepY = player.vy * dt;

    // X axis collision
    let nxPos = player.x + stepX;
    if (!isSolidAt(nxPos - player.r, player.y - player.r) &&
        !isSolidAt(nxPos + player.r, player.y - player.r) &&
        !isSolidAt(nxPos - player.r, player.y + player.r) &&
        !isSolidAt(nxPos + player.r, player.y + player.r)) {
      player.x = nxPos;
    }

    // Y axis collision
    let nyPos = player.y + stepY;
    if (!isSolidAt(player.x - player.r, nyPos - player.r) &&
        !isSolidAt(player.x + player.r, nyPos - player.r) &&
        !isSolidAt(player.x - player.r, nyPos + player.r) &&
        !isSolidAt(player.x + player.r, nyPos + player.r)) {
      player.y = nyPos;
    }

    // clamp to map
    player.x = clamp(player.x, TILE, MAP_W*TILE - TILE);
    player.y = clamp(player.y, TILE, MAP_H*TILE - TILE);
  }



  function getCityById(id) {
    if (id === world.cityA.id) return world.cityA;
    if (id === world.cityB.id) return world.cityB;
    return null;
  }
  function currentCity() {
    const px = player.x / TILE;
    const py = player.y / TILE;
    const cA = world.cityA;
    const cB = world.cityB;
    if (px >= cA.x && px < cA.x + cA.w && py >= cA.y && py < cA.y + cA.h) return cA;
    if (px >= cB.x && px < cB.x + cB.w && py >= cB.y && py < cB.y + cB.h) return cB;
    return null;
  }

  function nearMarketTile() {
    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        if (tileAt(tx + ox, ty + oy) === 6) return true;
      }
    }
    return false;
  }

  function nearContractsTile() {
    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (tileAt(tx + ox, ty + oy) === 12) return true;
      }
    }
    return false;
  }


  function nearPOITile() {
    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const id = tileAt(tx + ox, ty + oy);
        if (id >= 7 && id <= 9) return id;
      }
    }
    return null;
  }


  function contrabandCountForCity(cityId) {
    const rules = CITY_RULES[cityId];
    if (!rules) return 0;
    let n = 0;
    for (const it of ITEMS) {
      if (!it.contrabandName) continue;
      if (!rules.contraband.includes(it.contrabandName)) continue;
      n += (player.inv[it.id] || 0);
    }
    return n;
  }

  function confiscateContraband(cityId) {
    const rules = CITY_RULES[cityId];
    if (!rules) return 0;
    let removed = 0;
    for (const it of ITEMS) {
      if (!it.contrabandName) continue;
      if (!rules.contraband.includes(it.contrabandName)) continue;
      const have = player.inv[it.id] || 0;
      if (have > 0) {
        removed += have;
        player.inv[it.id] = 0;
      }
    }
    return removed;
  }

  function toast(msg, seconds = 3) {
    ui.toast = msg;
    ui.toastT = seconds;
  }

  function activeContractProgressLabel() {
    if (!contracts.active) return '';
    try {
      const want = contracts.active.want;
      const qty = contracts.active.qty;
      const have = player.inv[want] || 0;
      return `${Math.min(have, qty)}/${qty}`;
    } catch (e) {
      console.warn('activeContractProgressLabel error', e);
      contracts.active = null;
      return '';
    }
  }

  // --- Road encounters
  const road = {
    travel: 0,
    cooldown: 0,
    dayCarry: 0, // accumulates fractional day progress from movement
  };

  function randChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function totalCargoCount() {
    let n = 0;
    for (const it of ITEMS) n += (player.inv[it.id] || 0);
    return n;
  }

  function dropRandomCargo(maxDrop = 2) {
    const pool = ITEMS.filter(it => (player.inv[it.id] || 0) > 0);
    if (pool.length === 0) return 0;
    let dropped = 0;
    for (let i = 0; i < maxDrop; i++) {
      const options = ITEMS.filter(it => (player.inv[it.id] || 0) > 0);
      if (options.length === 0) break;
      const it = randChoice(options);
      player.inv[it.id] -= 1;
      dropped += 1;
    }
    return dropped;
  }

  function openEvent({ title, text, choices }) {
    ui.marketOpen = false;
    ui.contractsOpen = false;
    ui.eventOpen = true;
    ui.eventTitle = title;
    ui.eventText = text;
    ui.eventChoices = choices;
    ui.eventSel = 0;
    ui.eventNavT = 0;
  }

  function closeEvent() {
    ui.eventOpen = false;
    ui.eventChoices = [];
  }



  function triggerPOIEvent(poiId) {
    if (ui.eventOpen || ui.marketOpen) return;

    if (poiId === 7) {
      ui.eventOpen = true;
      ui.eventTitle = 'Roadside Shrine';
      ui.eventText = 'A small shrine flickers with candlelight. Offer a coin, or move on?';
      ui.eventChoices = [
        { label: 'Offer 1g (chance of blessing)', run: () => {
            if (player.gold <= 0) { toast('No coin to offer.', 2); closeEvent(); return; }
            player.gold -= 1;
            if (Math.random() < 0.6) { player.gold += 4; toast('Blessing! +4g', 2); }
            else toast('The wind answers in silence.', 2);
            closeEvent();
          }
        },
        { label: 'Rest (+short calm)', run: () => { toast('You catch your breath.', 2); closeEvent(); } },
        { label: 'Leave', run: closeEvent },
      ];
      ui.eventSel = 0;

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (poiId === 8) {
      ui.eventOpen = true;
      ui.eventTitle = 'Traveler Camp';
      ui.eventText = 'A few travelers share a fire. They might trade, for a price.';
      ui.eventChoices = [
        { label: 'Buy supplies (3g → +1 rations)', run: () => {
            if (player.gold < 3) { toast('Not enough gold.', 2); closeEvent(); return; }
            player.gold -= 3;
            player.inv['food'] = (player.inv['food'] || 0) + 1;
            toast('Bought 1 Dried Rations.', 2);
            closeEvent();
          }
        },
        { label: 'Ask for directions', run: () => { toast('They warn: stay on the road.', 2); closeEvent(); } },
        { label: 'Move on', run: closeEvent },
      ];
      ui.eventSel = 0;

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (poiId === 9) {
      ui.eventOpen = true;
      ui.eventTitle = 'Old Ruins';
      ui.eventText = 'Broken stones and mossy pillars. Something might be worth taking.';
      ui.eventChoices = [
        { label: 'Search', run: () => {
            const r = Math.random();
            if (r < 0.45) { const g = 2 + (Math.random()*6|0); player.gold += g; toast(`Found ${g}g`, 2); }
            else if (r < 0.75) { player.inv['herbs'] = (player.inv['herbs']||0)+1; toast('Found 1 Moon Herbs', 2); }
            else toast('Nothing but dust.', 2);
            closeEvent();
          }
        },
        { label: 'Leave it', run: closeEvent },
      ];
      ui.eventSel = 0;

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }
  }
  function maybeTriggerRoadEvent() {
    const c = currentCity();
    if (c) return; // only on the road

    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    if (tileAt(tx, ty) !== 1) return; // encounters only while on road tiles
    if (road.cooldown > 0) return;
    if (road.travel < 520) return; // threshold; tuned for feel

    road.travel = 0;
    road.cooldown = 6.0;

    const kind = randChoice(['bandits', 'toll', 'storm', 'omen', 'escort']);

    if (kind === 'bandits') {
      openEvent({
        title: 'Bandits!',
        text: 'A masked crew steps onto the road. They want your cargo.',
        choices: [
          { label: 'Pay 20g', run: () => { const paid = Math.min(player.gold, 20); player.gold -= paid; toast(`Paid ${paid}g to avoid trouble.`, 2.6); closeEvent(); } },
          { label: 'Flee (drop cargo)', run: () => { const d = dropRandomCargo(3); toast(d ? `You escaped, but dropped ${d} item(s).` : 'You escaped, barely. No cargo to drop.', 3); closeEvent(); } },
          { label: 'Fight (risk)', run: () => {
              const roll = Math.random();
              if (roll < 0.58) {
                const loot = 12 + Math.floor(Math.random() * 18);
                player.gold += loot;
                toast(`You won! Looted ${loot}g.`, 2.8);
              } else {
                const d = dropRandomCargo(2);
                const fine = 10 + Math.floor(Math.random() * 15);
                const paid = Math.min(player.gold, fine);
                player.gold -= paid;
                toast(`You lost. Dropped ${d} item(s) and paid ${paid}g.`, 3.2);
              }
              closeEvent();
            }
          },
        ],
      });

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (kind === 'toll') {
      openEvent({
        title: 'Toll Checkpoint',
        text: 'A petty lord has stationed guards here. Pay the toll or detour through rough terrain.',
        choices: [
          { label: 'Pay 12g', run: () => { const paid = Math.min(player.gold, 12); player.gold -= paid; toast(`Paid ${paid}g toll.`, 2.4); closeEvent(); } },
          { label: 'Detour (slow)', run: () => { road.cooldown = 12.0; toast('You detour. No toll, but it wastes time.', 3); closeEvent(); } },
        ],
      });

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    // storm
    openEvent({
      title: 'Sudden Storm',
      text: 'Wind and rain hammer the road. Your pack gets soaked.',
      choices: [
        { label: 'Push through', run: () => {
            road.cooldown = 10.0;
            // 40% chance lose 1 fragile item
            const fragile = ['herbs', 'potion'];
            if (Math.random() < 0.4) {
              const id = randChoice(fragile);
              if ((player.inv[id] || 0) > 0) { player.inv[id] -= 1; toast('A fragile item was ruined by the storm.', 3); }
              else toast('You weather the storm.', 2.4);
            } else {
              toast('You weather the storm.', 2.4);
            }
            closeEvent();
          }
        },
        { label: 'Take shelter (-5g)', run: () => { const paid = Math.min(player.gold, 5); player.gold -= paid; toast(`Sheltered at a roadside inn (-${paid}g).`, 2.8); closeEvent(); } },
      ],
    });

    if (kind === 'omen') {
      // Good omen: small windfall
      const g = 5 + Math.floor(rand01() * 8);
      player.gold += g;
      toast(`Good omen on the road! Found ${g}g.`, 2.4);
      closeEvent();
      return;
    }

    if (kind === 'escort') {
      openEvent({
        title: 'Merchant Escort',
        text: 'A nervous merchant asks for protection through a rough stretch. Tip: 8g.',
        choices: [
          { label: 'Escort (+8g)', run: () => {
              player.gold += 8;
              toast('You escort the merchant safely. (+8g)', 2.4);
              closeEvent();
            }
          },
          { label: 'Decline', run: () => { toast('The merchant finds others.', 2); closeEvent(); } },
        ],
      });
      return;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') {
      const c = currentCity();
      if (c && nearMarketTile()) {
        ui.contractsOpen = false;
        ui.marketOpen = !ui.marketOpen;
        ui.selection = 0;
        ui.mode = 'buy';
        toast(ui.marketOpen ? `Market opened in ${c.name}` : 'Market closed', 2);
      } else if (c && nearContractsTile()) {
        ui.marketOpen = false;
        ui.contractsOpen = !ui.contractsOpen;
        ui.contractsSel = 0;
        ui.contractsCityId = c.id;
        toast(ui.contractsOpen ? 'Contracts board opened' : 'Contracts board closed', 2);
      } else {
        toast('Find the market stall (tan) or contracts board (green) inside a city.', 2.5);
      }
    }



    if (ui.marketOpen) {
      const totalN = ITEMS.length + 1; // +1 permit row
      if (e.code === 'Escape') { ui.marketOpen = false; toast('Market closed', 2); }
      if (e.code === 'Tab') { e.preventDefault(); ui.mode = ui.mode === 'buy' ? 'sell' : 'buy'; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') ui.selection = (ui.selection + totalN - 1) % totalN;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') ui.selection = (ui.selection + 1) % totalN;
      if (e.code === 'Enter' || e.code === 'Space') {
        marketTryTrade(ui.selection);
      }
    }

    if (ui.contractsOpen) {
      const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
      const jobs = c ? (contracts.byCity[c.id] || []) : [];
      const n = Math.max(1, jobs.length);
      if (e.code === 'Escape') { ui.contractsOpen = false; toast('Contracts board closed', 2); }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') ui.contractsSel = (ui.contractsSel + n - 1) % n;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') ui.contractsSel = (ui.contractsSel + 1) % n;
      if (e.code === 'Enter' || e.code === 'Space') contractsAccept(ui.contractsSel);
    }


    // Event controls (keyboard)
    if (ui.eventOpen) {
      if (e.code === 'Escape') { closeEvent(); toast('You move on.', 2); }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') ui.eventSel = (ui.eventSel + ui.eventChoices.length - 1) % ui.eventChoices.length;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') ui.eventSel = (ui.eventSel + 1) % ui.eventChoices.length;
      if (e.code === 'Enter' || e.code === 'Space') {
        const ch = ui.eventChoices[ui.eventSel];
        if (ch && typeof ch.run === 'function') ch.run();
      }
    }
  }, { passive: false });

  // --- Render

  function drawTile(id, x, y, tx, ty) {
    // storybook fantasy palette + subtle variation
    if (id === 0) {
      const n = hash2(tx, ty);
      const g = n < 0.33 ? '#1f7a3a' : (n < 0.66 ? '#237f3e' : '#1c7436');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, TILE, TILE);
      if (n > 0.86) {
        ctx.fillStyle = 'rgba(255, 230, 160, 0.18)';
        ctx.fillRect(x + 3, y + 4, 2, 2);
        ctx.fillRect(x + 10, y + 9, 1, 1);
      }

      // bushes / flowers (non-colliding detail)
      if (n < 0.08) {
        ctx.fillStyle = 'rgba(16, 80, 40, 0.45)';
        ctx.fillRect(x + 4, y + 8, 8, 5);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.22)';
        ctx.fillRect(x + 5, y + 9, 6, 3);
      } else if (n > 0.92) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(x + 7, y + 6, 1, 1);
        ctx.fillStyle = 'rgba(244, 114, 182, 0.12)';
        ctx.fillRect(x + 9, y + 10, 1, 1);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 1) {
      ctx.fillStyle = '#7a5a2f';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#a77b45';
      ctx.fillRect(x + 3, y + 2, TILE - 6, TILE - 4);

      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      if (tileAt(tx, ty-1) !== 1) ctx.fillRect(x, y, TILE, 2);
      if (tileAt(tx, ty+1) !== 1) ctx.fillRect(x, y + TILE - 2, TILE, 2);
      if (tileAt(tx-1, ty) !== 1) ctx.fillRect(x, y, 2, TILE);
      if (tileAt(tx+1, ty) !== 1) ctx.fillRect(x + TILE - 2, y, 2, TILE);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 2) {
      ctx.fillStyle = '#1b5fae';
      ctx.fillRect(x, y, TILE, TILE);

      const nearLand = (tileAt(tx, ty-1) !== 2) || (tileAt(tx, ty+1) !== 2) || (tileAt(tx-1, ty) !== 2) || (tileAt(tx+1, ty) !== 2);
      if (nearLand) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(x+1, y+1, TILE-2, 1);
      }

      const phase = (stateTime * 0.004 + (tx*7 + ty*11)) % 6;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y + Math.floor(phase), TILE, 2);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 3) {
      ctx.fillStyle = '#3b3f4a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x+2, y+2, TILE-4, TILE-4);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 4) {
      const n = hash2(tx, ty);
      ctx.fillStyle = n < 0.5 ? '#5b4b3a' : '#5f4f3d';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);

      // cobble accents
      if (n > 0.78) {
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(x + 3, y + 3, 4, 3);
        ctx.fillRect(x + 9, y + 9, 3, 4);
      }

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 5) {
      ctx.fillStyle = '#5b4b3a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#c7a36a';
      ctx.fillRect(x+2, y+4, TILE-4, TILE-8);
      ctx.fillStyle = '#2a1f14';
      ctx.fillRect(x+5, y+6, TILE-10, TILE-12);
      ctx.fillStyle = 'rgba(56,189,248,0.18)';
      ctx.fillRect(x+6, y+4, TILE-12, 2);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 6) {
      ctx.fillStyle = '#5b4b3a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(x+2, y+2, TILE-4, TILE-4);
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(x+4, y+6, TILE-8, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x+3, y+3, TILE-6, 1);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 7) { // shrine
      ctx.fillStyle = '#5b4b3a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#a78bfa';
      ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x + 5, y + 4, TILE - 10, 2);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 8) { // camp
      ctx.fillStyle = '#5b4b3a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#d97706';
      ctx.beginPath();
      ctx.moveTo(x + TILE/2, y + 3);
      ctx.lineTo(x + 3, y + TILE - 3);
      ctx.lineTo(x + TILE - 3, y + TILE - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 5, y + TILE - 6, TILE - 10, 2);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 9) { // ruins
      ctx.fillStyle = '#5b4b3a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(x + 2, y + 2, 4, 4);
      ctx.fillRect(x + TILE - 6, y + 3, 4, 4);
      ctx.fillRect(x + 5, y + TILE - 6, 6, 4);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }


    if (id === 10) { // forest
      const n = hash2(tx, ty);
      ctx.fillStyle = n < 0.5 ? '#175e2f' : '#1a6433';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(6, 95, 70, 0.32)';
      ctx.fillRect(x + 2, y + 3, TILE - 4, 2);
      if (n > 0.72) {
        ctx.fillStyle = 'rgba(16, 80, 40, 0.60)';
        ctx.fillRect(x + 3, y + 7, TILE - 6, 5);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 11) { // swamp
      const n = hash2(tx, ty);
      ctx.fillStyle = n < 0.5 ? '#2a4b3a' : '#274636';
      ctx.fillRect(x, y, TILE, TILE);
      if (n > 0.6) {
        ctx.fillStyle = 'rgba(56,189,248,0.12)';
        ctx.fillRect(x + 2, y + 9, TILE - 4, 2);
      }
      if (n < 0.22) {
        ctx.fillStyle = 'rgba(34,197,94,0.25)';
        ctx.fillRect(x + 3, y + 3, 1, TILE - 6);
        ctx.fillRect(x + 7, y + 4, 1, TILE - 7);
        ctx.fillRect(x + 11, y + 5, 1, TILE - 8);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    if (id === 12) { // contracts board
      ctx.fillStyle = '#5b4b3a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(x+2, y+2, TILE-4, TILE-4);
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(x+4, y+5, TILE-8, 2);
      ctx.fillRect(x+4, y+9, TILE-8, 2);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

  }

  function drawWorld() {
    const camX = Math.floor(camera.x);
    const camY = Math.floor(camera.y);

    const startX = Math.floor(camX / TILE);
    const startY = Math.floor(camY / TILE);
    const endX = Math.ceil((camX + VIEW_W) / TILE);
    const endY = Math.ceil((camY + VIEW_H) / TILE);

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const id = tileAt(tx, ty);
        const x = tx * TILE - camX;
        const y = ty * TILE - camY;
        drawTile(id, x, y, tx, ty);
      }
    }

    // highlight city zones lightly
    const c = currentCity();
    if (c) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.06)';
      const x = c.x*TILE - camX;
      const y = c.y*TILE - camY;
      ctx.fillRect(x, y, c.w*TILE, c.h*TILE);
    }
  }

  function drawPlayer() {
    const x = player.x - camera.x;
    const y = player.y - camera.y;

    // shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y + 8, 10, 5, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Sprite draw (preferred)
    if (playerSprite && playerSprite.ready) {
      // Map facing vector -> 8-way direction index in the order:
      // 0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW
      const fx = player.facing?.x ?? 0;
      const fy = player.facing?.y ?? 1;
      const ang = Math.atan2(fy, fx); // -pi..pi
      const step = Math.PI / 4;
      // Compute E-based index, then rotate to make 0=N.
      const eBased = ((Math.round(ang / step) % 8) + 8) % 8; // 0=E,1=SE,2=S,3=SW,4=W,5=NW,6=N,7=NE
      const dir = (eBased + 6) % 8; // rotate so 0=N
      playerSprite.dir = dir;

      const moving = Math.hypot(player.vx, player.vy) > 0.01;
      playerSprite.anim = moving ? 'walk' : 'idle';

      const frames = (playerSprite.anim === 'walk') ? playerSprite.walkFrames : playerSprite.idleFrames;
      const fw = playerSprite.frameW;
      const fh = playerSprite.frameH;
      const col = clamp(playerSprite.frame, 0, Math.max(0, frames - 1));
      const row = clamp((playerSprite.anim === 'walk' ? playerSprite.walkRowBase : playerSprite.idleRowBase) + playerSprite.dir, 0, playerSprite.rows - 1);

      const sx = col * fw;
      const sy = row * fh;

      // Draw scaled to match old marker size; keep pixel crisp.
      const scale = (TILE >= 16) ? 1 : 0.75;
      const dw = Math.round(fw * scale);
      const dh = Math.round(fh * scale);
      const dx = Math.round(x - dw / 2);
      const dy = Math.round(y - dh + 10); // feet near shadow

      const prevSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      try {
        ctx.drawImage(playerSprite.img, sx, sy, fw, fh, dx, dy, dw, dh);
      } catch (e) {
        // If drawImage fails for any reason, fall back to marker.
        playerSprite.ready = false;
      }
      ctx.imageSmoothingEnabled = prevSmooth;
      return;
    }

    // Fallback: old marker
    // outline
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI*2);
    ctx.fill();

    // body
    ctx.fillStyle = '#2a1f14';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI*2);
    ctx.fill();

    // cloak
    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.arc(x, y+3, 7, 0, Math.PI*2);
    ctx.fill();

    // headband
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x-6, y-6, 12, 2);

    // eyes
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(x-3, y-2, 2, 2);
    ctx.fillRect(x+1, y-2, 2, 2);
  }





  function drawCompassArrowOnMinimap(mmX, mmY, mmSize) {
    if (!contracts.active) return;
    const dest = getCityById(contracts.active.toId);
    if (!dest) {
      // Defensive: clear invalid contract if city doesn't exist (prevents crash on mobile)
      console.warn('drawCompass: contract target city not found, clearing active contract');
      contracts.active = null;
      return;
    }

    const tx = (dest.x + dest.w/2) * TILE;
    const ty = (dest.y + dest.h/2) * TILE;
    const dx = tx - player.x;
    const dy = ty - player.y;
    const ang = Math.atan2(dy, dx); // world angle


    // dest city marker (highlight on minimap)
    const cx2 = mmX + ( (dest.x + dest.w/2) / MAP_W ) * mmSize;
    const cy2 = mmY + ( (dest.y + dest.h/2) / MAP_H ) * mmSize;
    ctx.save();
    ctx.fillStyle = 'rgba(96,165,250,0.20)';
    ctx.beginPath();
    ctx.arc(cx2, cy2, Math.round(7 * UI_SCALE), 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(96,165,250,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx2, cy2, Math.round(3.5 * UI_SCALE), 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();

    // draw arrow near top-right inside minimap
    const cx = mmX + mmSize - Math.round(14 * UI_SCALE);
    const cy = mmY + Math.round(14 * UI_SCALE);
    const r = Math.round(8 * UI_SCALE);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);

    // outline
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r*0.65, r*0.65);
    ctx.lineTo(-r*0.65, -r*0.65);
    ctx.closePath();
    ctx.fill();

    // inner
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.moveTo(r-1, 0);
    ctx.lineTo(-r*0.55, r*0.55);
    ctx.lineTo(-r*0.55, -r*0.55);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
  function drawMobileOverlay() {
    if (!IS_MOBILE) return;

    // bottom-left minimap + mini hud overlay on gameplay
    const pad = Math.round(10 * UI_SCALE);
    const size = Math.round(86 * UI_SCALE);
    const x = pad;
    const y = VIEW_H - size - pad;

    // panel
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 6, y - 6, size + 12, size + 12, 12);
    else ctx.rect(x - 6, y - 6, size + 12, size + 12);
    ctx.fill();

    // minimap
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mini.canvas, 0, 0, mini.w, mini.h, x, y, size, size);

    // player marker
    const px = (player.x / (MAP_W * TILE)) * size;
    const py = (player.y / (MAP_H * TILE)) * size;
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(x + Math.floor(px) - 1, y + Math.floor(py) - 1, 3, 3);

    // contract compass
    drawCompassArrowOnMinimap(x, y, size);

    // tiny stats strip above minimap
    ctx.fillStyle = 'rgba(10, 14, 20, 0.72)';
    ctx.fillRect(x - 6, y - Math.round(30 * UI_SCALE) - 6, size + 12, Math.round(30 * UI_SCALE));
    ctx.fillStyle = '#cfe6ff';
    ctx.font = `800 ${Math.round(13 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`${player.gold}g`, x, y - Math.round(12 * UI_SCALE));
    ctx.textAlign = 'right';
    ctx.fillText(`${invWeight()}/${player.capacity}`, x + size, y - Math.round(12 * UI_SCALE));
    ctx.textAlign = 'left';
  }
  function drawHUD() {
    ctx.fillStyle = 'rgba(10, 14, 20, 0.82)';
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    ctx.strokeStyle = 'rgba(30, 42, 54, 1)';
    ctx.beginPath();
    ctx.moveTo(0, HUD_H + 0.5);
    ctx.lineTo(VIEW_W, HUD_H + 0.5);
    ctx.stroke();

    const c = currentCity();
    const rules = c ? CITY_RULES[c.id] : null;
    const w = invWeight();

    const pad = Math.round(14 * UI_SCALE);

    // MOBILE HUD (minimal; minimap + stats are overlayed on gameplay)
    if (IS_MOBILE) {
      const topH = Math.round((contracts.active ? 62 : 44) * UI_SCALE);
      ctx.fillStyle = 'rgba(10, 14, 20, 0.78)';
      ctx.fillRect(0, 0, VIEW_W, topH);
      ctx.strokeStyle = 'rgba(30, 42, 54, 1)';
      ctx.beginPath();
      ctx.moveTo(0, topH + 0.5);
      ctx.lineTo(VIEW_W, topH + 0.5);
      ctx.stroke();

      ctx.fillStyle = '#e8edf2';
      ctx.font = `800 ${Math.round(15 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      const title = c ? c.name : 'On the road';
      ctx.fillText(ellipsizeText(title, VIEW_W - Math.round(12 * UI_SCALE)), Math.round(10 * UI_SCALE), Math.round(22 * UI_SCALE));

      // small detail line
      ctx.fillStyle = 'rgba(160,184,203,0.92)';
      ctx.font = `${Math.round(12 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      const detail = rules ? `${rules.vibe}` : 'Travel the road. E interacts.';
      ctx.fillText(ellipsizeText(detail, VIEW_W - Math.round(12 * UI_SCALE)), Math.round(10 * UI_SCALE), Math.round(40 * UI_SCALE));

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    const line1 = Math.round(22 * UI_SCALE);
    const line2 = Math.round(44 * UI_SCALE);
    const line3 = Math.round(66 * UI_SCALE);
    const line4 = Math.round(88 * UI_SCALE);

    // Title (city/road)
    ctx.fillStyle = '#e8edf2';
    ctx.font = `700 ${Math.round((IS_MOBILE ? 14 : 16) * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    // mini-map + title
    const mmPad = pad;
    const mmSize = Math.round((IS_MOBILE ? 72 : 72) * UI_SCALE);
    const mmX = IS_MOBILE ? pad : mmPad;
    const mmY = IS_MOBILE ? Math.round(78 * UI_SCALE) : Math.round(6 * UI_SCALE);
    const hudLeft = mmX + mmSize + Math.round(18 * UI_SCALE);

    const titleX = IS_MOBILE ? pad : (mmX + mmSize + Math.round(18 * UI_SCALE));

    // compute max text width
    const maxTextW = IS_MOBILE
      ? Math.max(80, VIEW_W - pad - titleX)
      : (() => {
  window.__BOOT_OK = true;
          const rightX = VIEW_W - pad;
          const coinX = rightX - Math.round(180 * UI_SCALE);
          const textRight = coinX - Math.round(18 * UI_SCALE);
          return Math.max(80, textRight - titleX);
        })();

    const title = c ? c.name : 'On the road';
    ctx.fillText(ellipsizeText(title, maxTextW), titleX, line1);

    if (IS_MOBILE) {
      ctx.fillStyle = 'rgba(138,160,179,0.65)';
      ctx.font = `${Math.round(10 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText('MODE: mobile', VIEW_W - pad - Math.round(70 * UI_SCALE), line1);
    }

    // mobile row 2: city details / hint
    if (IS_MOBILE) {
      ctx.fillStyle = 'rgba(138,160,179,0.95)';
      ctx.font = `${Math.round(12 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      const detail = rules ? `${rules.vibe} · Tax ${Math.round(rules.taxRate*100)}% · Inspect ${Math.round(rules.inspectionChance*100)}%` : 'Follow the road between cities. Interact with landmarks (E).';
      ctx.fillText(ellipsizeText(detail, maxTextW), titleX, line2);
    }


    // mini-map (top-left, inside HUD)
    // background
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(mmX - 4, mmY - 4, mmSize + 8, mmSize + 8, 10);
    else ctx.rect(mmX - 4, mmY - 4, mmSize + 8, mmSize + 8);
    ctx.fill();
    // map image
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mini.canvas, 0, 0, mini.w, mini.h, mmX, mmY, mmSize, mmSize);
    // player marker
    const px = (player.x / (MAP_W * TILE)) * mmSize;
    const py = (player.y / (MAP_H * TILE)) * mmSize;
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(mmX + Math.floor(px) - 1, mmY + Math.floor(py) - 1, 3, 3);
    // contract compass
    drawCompassArrowOnMinimap(mmX, mmY, mmSize);
    // camera viewport box
    const vx = (camera.x / (MAP_W * TILE)) * mmSize;
    const vy = (camera.y / (MAP_H * TILE)) * mmSize;
    const vw = (VIEW_W / (MAP_W * TILE)) * mmSize;
    const vh = (VIEW_H / (MAP_H * TILE)) * mmSize;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX + vx, mmY + vy, vw, vh);

    // stats (right side)
    const rightX = VIEW_W - pad;
    ctx.textAlign = 'right';
    if (IS_MOBILE) {
      // align stats with minimap block (vertical stack)
      const statsY1 = mmY + Math.round(22 * UI_SCALE);
      const statsY2 = mmY + Math.round(44 * UI_SCALE);
      ctx.fillStyle = '#cfe6ff';
      ctx.font = `700 ${Math.round(13 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`${player.gold}g`, rightX, statsY1);
      ctx.fillText(`${w}/${player.capacity}`, rightX, statsY2);
    } else {
      // coin icon
      const coinR = Math.round(6 * UI_SCALE);
      const coinX = rightX - Math.round(180 * UI_SCALE);
      const coinY = line1 - Math.round(6 * UI_SCALE);
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(coinX, coinY, coinR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.arc(coinX-2, coinY-2, coinR*0.55, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#cfe6ff';
      ctx.font = `700 ${Math.round(14 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`${player.gold}g`, coinX + Math.round(10 * UI_SCALE), line1);

      // bag icon
      const bagX = rightX - Math.round(80 * UI_SCALE);
      const bagY = line1 - Math.round(10 * UI_SCALE);
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(bagX, bagY, Math.round(12*UI_SCALE), Math.round(12*UI_SCALE));
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(bagX, bagY + Math.round(8*UI_SCALE), Math.round(12*UI_SCALE), Math.round(4*UI_SCALE));

      ctx.fillStyle = '#cfe6ff';
      ctx.fillText(`${w}/${player.capacity}`, bagX + Math.round(18 * UI_SCALE), line1);
      ctx.textAlign = 'left';
    }

    // second line: rules + hint
    ctx.fillStyle = 'rgba(138,160,179,0.95)';
    ctx.font = `${Math.round(13 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    if (!IS_MOBILE) {

    if (rules) {
      const hint = nearMarketTile() ? 'E: Market' : 'Find market (gold tile)';
      const shortHint = IS_MOBILE ? `${hint}` : hint;
      const contraTxt = IS_MOBILE ? rules.contraband.join(', ').slice(0, 18) + (rules.contraband.join(', ').length>18?'…':'') : rules.contraband.join(', ');
      const ruleLine = IS_MOBILE ? `Tax ${Math.round(rules.taxRate*100)}% · Inspect ${Math.round(rules.inspectionChance*100)}% · ${shortHint}` : `Tax ${Math.round(rules.taxRate*100)}% · Inspect ${Math.round(rules.inspectionChance*100)}% · Contraband: ${contraTxt} · ${hint}`;
      ctx.fillText(
        ellipsizeText(ruleLine, maxTextW),
        titleX,
        line2
      );
    } else {
      ctx.fillText(ellipsizeText('Follow the road between cities. Encounters may trigger while traveling.', maxTextW), titleX, line2);
    }
    }

    // toast (inside HUD; never overlaps gameplay)
    if (ui.toastT > 0) {
      const toastY = Math.min(HUD_H - Math.round(8 * UI_SCALE), line2 + Math.round(18 * UI_SCALE));
      ctx.fillStyle = 'rgba(200, 230, 255, 0.95)';
      ctx.fillText(ellipsizeText(ui.toast, maxTextW), titleX, toastY);


    }
  }

  function drawMarket() {
    if (USE_DOM_MODALS) return;
    if (!ui.marketOpen) return;
    const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
    if (!c) return;
    const rules = CITY_RULES[c.id];


    // MOBILE MARKET SHEET (full-screen)
    if (IS_MOBILE) {
      const T_SCALE = UI_SCALE * 0.86;
      const pad = 0;

      // Full-screen modal (no reserved safe area).
      const sheetX = 0;
      const sheetTop = 0;
      const sheetW = VIEW_W;
      const sheetH = VIEW_H;

      // dim backdrop
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      // parchment panel
      ctx.fillStyle = 'rgba(235, 219, 185, 0.98)';
      ctx.strokeStyle = 'rgba(120, 92, 60, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(sheetX, sheetTop, sheetW, sheetH, 18);
      else ctx.rect(sheetX, sheetTop, sheetW, sheetH);
      ctx.fill();
      ctx.stroke();

      
      // header
      const headerH = 94;
      const innerX = sheetX + 16;
      const innerW = sheetW - 32;

      ctx.fillStyle = '#2a1f14';
      ctx.font = `900 ${Math.round(20*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`${c.name} Market`, innerX, sheetTop + Math.round(28 * UI_SCALE));

      ctx.fillStyle = '#4a3b2a';
      ctx.font = `${Math.round(13*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(rules.vibe, innerX, sheetTop + Math.round(50 * UI_SCALE));


      // close button (tap)
      const closeW = Math.round(72 * UI_SCALE);
      const closeH = Math.round(30 * UI_SCALE);
      const closeX = sheetX + sheetW - closeW - Math.round(10 * UI_SCALE);
      const closeY = sheetTop + Math.round(14 * UI_SCALE);
      ui._marketClose = { x: closeX, y: closeY, w: closeW, h: closeH };
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.strokeStyle = 'rgba(120, 92, 60, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(closeX, closeY, closeW, closeH, 10);
      else ctx.rect(closeX, closeY, closeW, closeH);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2a1f14';
      ctx.font = `900 ${Math.round(13*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText('CLOSE', closeX + Math.round(12*T_SCALE), closeY + Math.round(20*T_SCALE));

      // BUY/SELL tabs (tap friendly)
      const tabY = sheetTop + 58;
      const tabH = 40;
      const tabW = Math.round((innerW - Math.round(12 * UI_SCALE)) / 2);
      const tabGap = Math.round(12 * UI_SCALE);
      const buyX = innerX;
      const sellX = innerX + tabW + tabGap;

      ui._marketTabs = { buy: { x: buyX, y: tabY, w: tabW, h: tabH }, sell: { x: sellX, y: tabY, w: tabW, h: tabH } };

      const drawTab = (x, label, active) => {
        ctx.fillStyle = active ? 'rgba(120, 92, 60, 0.22)' : 'rgba(0,0,0,0.06)';
        ctx.strokeStyle = active ? 'rgba(120, 92, 60, 0.85)' : 'rgba(120, 92, 60, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, tabY, tabW, tabH, 12);
        else ctx.rect(x, tabY, tabW, tabH);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#2a1f14';
        ctx.font = `900 ${Math.round(15*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, x + (tabW - tw) / 2, tabY + Math.round(29 * UI_SCALE));
      };

      drawTab(buyX, 'BUY', ui.mode === 'buy');
      drawTab(sellX, 'SELL', ui.mode === 'sell');

      // list viewport
      const footerH = 84;
      const listTop = sheetTop + headerH;
      const listBottom = sheetTop + sheetH - 12 - footerH;
      const listH = Math.max(40, listBottom - listTop);
      const rowH = 62; // card height
      const visibleN = Math.max(2, Math.floor(listH / rowH));

      const totalN = ITEMS.length + 1; // +1 permit row
      const scrollMax = Math.max(0, totalN - visibleN);
      ui.marketScroll = clamp(ui.marketScroll, 0, scrollMax);

      // expose list rect for touch scrolling
      ui._marketList = { x: sheetX, y: listTop, w: sheetW, h: listH, rowH, scrollMax };

      // clip list viewport so cards never draw outside the modal
      ctx.save();
      ctx.beginPath();
      ctx.rect(sheetX, listTop, sheetW, listH);
      ctx.clip();

      for (let vi = 0; vi < visibleN; vi++) {
        const i = ui.marketScroll + vi;
        if (i >= totalN) break;

        const isPermitRow = i === ITEMS.length;
        const it = isPermitRow ? null : ITEMS[i];
        const y = listTop + vi * rowH;
        const selected = i === ui.selection;

        // card background (keep fully inside the list viewport)
        const cardY = y + 6;
        const cardH = rowH - 12;
        ctx.fillStyle = selected ? 'rgba(120, 92, 60, 0.16)' : 'rgba(0,0,0,0.05)';
        ctx.strokeStyle = selected ? 'rgba(120, 92, 60, 0.75)' : 'rgba(120, 92, 60, 0.30)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(sheetX + 12, cardY, sheetW - 24, cardH, 14);
        else ctx.rect(sheetX + 12, cardY, sheetW - 24, cardH);
        ctx.fill();
        ctx.stroke();

        const price = isPermitRow ? PERMIT_PRICE : priceFor(c.id, it);
        const have = isPermitRow ? 0 : (player.inv[it.id] || 0);
        const contra = (!isPermitRow) && it.contrabandName && rules.contraband.includes(it.contrabandName);
        const hasPermit = !!player.permits[c.id];

        // name
        ctx.fillStyle = '#2a1f14';
        ctx.font = `900 ${Math.round(15*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.fillText(isPermitRow ? (hasPermit ? 'City Permit (owned)' : 'City Permit') : it.name, innerX, cardY + 20);

        // price (right)
        ctx.textAlign = 'right';
        ctx.fillText(isPermitRow ? (hasPermit ? 'Owned' : `${price}g`) : `${price}g`, sheetX + sheetW - 16, cardY + 20);
        ctx.textAlign = 'left';

        // subline
        ctx.fillStyle = '#4a3b2a';
        ctx.font = `${Math.round(12*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.fillText(isPermitRow ? 'Reduces inspections in this city' : `You have: ${have} · Weight: ${it.weight}`, innerX, cardY + 42);

        if (contra) {
          ctx.fillStyle = 'rgba(249,115,22,0.18)';
          ctx.strokeStyle = 'rgba(249,115,22,0.55)';
          ctx.beginPath();
          const bx = sheetX + sheetW - 16 - Math.round(86 * UI_SCALE);
          const byy = cardY + 30;
          const bw = Math.round(86 * UI_SCALE);
          const bh = Math.round(22 * UI_SCALE);
          if (ctx.roundRect) ctx.roundRect(bx, byy, bw, bh, 10);
          else ctx.rect(bx, byy, bw, bh);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#9a3412';
          ctx.font = `900 ${Math.round(11*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
          ctx.fillText('CONTRABAND', bx + Math.round(12 * UI_SCALE), byy + Math.round(15 * UI_SCALE));
        }
      }

      ctx.restore();

      // scrollbar indicator
      if (scrollMax > 0) {
        const trackX = sheetX + sheetW - Math.round(10 * UI_SCALE);
        const trackY = listTop;
        const trackH = visibleN * rowH;
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(trackX, trackY, Math.round(4 * UI_SCALE), trackH);
        const thumbH = Math.max(Math.round(24 * UI_SCALE), Math.round(trackH * (visibleN / totalN)));
        const t = scrollMax > 0 ? (ui.marketScroll / scrollMax) : 0;
        const thumbY = trackY + Math.round((trackH - thumbH) * t);
        ctx.fillStyle = 'rgba(120, 92, 60, 0.55)';
        ctx.fillRect(trackX, thumbY, Math.round(4 * UI_SCALE), thumbH);
      }

      // pinned footer
      ctx.fillStyle = 'rgba(10, 14, 20, 0.10)';
      ctx.fillRect(sheetX, sheetTop + sheetH - 12 - footerH, sheetW, footerH);

      const w = invWeight();
      ctx.fillStyle = '#2a1f14';
      ctx.font = `900 ${Math.round(15*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`Gold: ${player.gold}g`, innerX, sheetTop + sheetH - 12 - 56);
      ctx.fillText(`Pack: ${w}/${player.capacity}`, innerX, sheetTop + sheetH - 12 - 28);

      ctx.fillStyle = '#4a3b2a';
      ctx.font = `${Math.round(12*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText('Drag list to scroll · ↑/↓ select · Enter confirm · Esc close', innerX, sheetTop + sheetH - 12 - 10);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure
      return;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const boxW = IS_MOBILE ? VIEW_W : Math.min(640, VIEW_W - Math.round(24 * UI_SCALE));
    const boxH = IS_MOBILE ? Math.round(VIEW_H * 0.68) : Math.min(420, VIEW_H - HUD_H - Math.round(24 * UI_SCALE));
    const bx = IS_MOBILE ? 0 : Math.floor((VIEW_W - boxW) / 2);
    const by = IS_MOBILE ? (VIEW_H - boxH) : Math.floor((VIEW_H - boxH) / 2);

    ctx.fillStyle = 'rgba(235, 219, 185, 0.96)'; // parchment
    ctx.strokeStyle = 'rgba(120, 92, 60, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect?.(bx, by, boxW, boxH, 14);
    if (!ctx.roundRect) {
      // fallback
      ctx.rect(bx, by, boxW, boxH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2a1f14';
    ctx.font = `700 ${Math.round(18*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(`${c.name} Market`, bx + 18, by + 34);



    // scrollbar indicator
    if (maxScroll > 0) {
      const trackX = bx + boxW - Math.round(10 * UI_SCALE);
      const trackY = startY;
      const trackH = visibleN * choiceRowH;
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(trackX, trackY, Math.round(4 * UI_SCALE), trackH);
      const thumbH = Math.max(Math.round(18 * UI_SCALE), Math.round(trackH * (visibleN / ui.eventChoices.length)));
      const t = ui.eventScroll / maxScroll;
      const thumbY = trackY + Math.round((trackH - thumbH) * t);
      ctx.fillStyle = 'rgba(120, 92, 60, 0.55)';
      ctx.fillRect(trackX, thumbY, Math.round(4 * UI_SCALE), thumbH);
    }
    ctx.fillStyle = '#4a3b2a';
    ctx.font = `${Math.round(13*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(`${rules.vibe}  ·  Tab: switch Buy/Sell  ·  Enter/Space: confirm  ·  Esc: close`, bx + 18, by + 56);

    ctx.fillStyle = '#2a1f14';
    ctx.font = `700 ${Math.round(14*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(ui.mode.toUpperCase(), bx + 18, by + 82);
    const headerH = Math.round((IS_MOBILE ? 120 : 110) * UI_SCALE);
    const footerH = Math.round((IS_MOBILE ? 64 : 52) * UI_SCALE);
    const startY = by + headerH;
    const rowH = Math.round(30 * UI_SCALE);
    const listH = boxH - headerH - footerH;
    const visibleN = Math.max(3, Math.floor(listH / rowH));

    const colName = bx + 22;
    const colW = bx + Math.round(boxW * 0.56);
    const colPrice = bx + Math.round(boxW * 0.66);
    const colHave = bx + Math.round(boxW * 0.78);
    const colFlag = bx + Math.round(boxW * 0.90);

    const scrollMax = Math.max(0, ITEMS.length - visibleN);
    ui.marketScroll = clamp(ui.marketScroll, 0, scrollMax);

    for (let vi = 0; vi < visibleN; vi++) {
      const i = ui.marketScroll + vi;
      if (i >= ITEMS.length) break;
      const it = ITEMS[i];
      const y = startY + vi * rowH;
      const selected = i === ui.selection;

      if (selected) {
        ctx.fillStyle = 'rgba(120, 92, 60, 0.14)';
        ctx.fillRect(bx + 12, y - Math.round(18 * UI_SCALE), boxW - 24, Math.round(Math.min(28 * UI_SCALE, rowH)));
      }

      const p = priceFor(c.id, it);
      const have = player.inv[it.id] || 0;
      const contra = it.contrabandName && rules.contraband.includes(it.contrabandName);

      ctx.fillStyle = selected ? '#1f2937' : '#2a1f14';
      ctx.font = selected ? `600 ${Math.round(14*UI_SCALE)}px system-ui` : `${Math.round(14*UI_SCALE)}px system-ui`;
      ctx.fillText(it.name, colName, y);

      ctx.fillStyle = '#4a3b2a';
      ctx.fillText(`w${it.weight}`, colW, y);

      ctx.fillStyle = '#2a1f14';
      ctx.fillText(`${p}g`, colPrice, y);

      ctx.fillStyle = '#4a3b2a';
      ctx.fillText(`you: ${have}`, colHave, y);

      if (contra) {
        ctx.fillStyle = '#f97316';
        ctx.fillText('CONTRABAND', colFlag, y);
      }
    }

    // footer (pinned)
    const w = invWeight();
    ctx.fillStyle = '#2a1f14';
    ctx.font = `600 ${Math.round(14*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    const fy = by + boxH - Math.round(18 * UI_SCALE);
    ctx.fillText(`Gold: ${player.gold}g`, bx + 18, fy);
    ctx.fillText(`Pack: ${w}/${player.capacity}`, bx + Math.round(boxW * 0.45), fy);

    // scroll hint
    if (ITEMS.length > visibleN) {
      ctx.fillStyle = '#4a3b2a';
      ctx.font = `${Math.round(12*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`Items ${ui.marketScroll+1}-${Math.min(ITEMS.length, ui.marketScroll+visibleN)} / ${ITEMS.length}`, bx + 18, by + boxH - Math.round(40 * UI_SCALE));
    }
  }


  

  function drawContracts() {
    if (USE_DOM_MODALS) return;
    const T_SCALE = UI_SCALE * 0.88;
    if (!ui.contractsOpen) return;
    const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
    if (!c) return;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const pad = Math.round(14 * UI_SCALE);
    const boxW = IS_MOBILE ? VIEW_W : Math.min(720, VIEW_W - Math.round(24 * UI_SCALE));
    const boxH = IS_MOBILE ? VIEW_H : Math.min(420, VIEW_H - Math.round(24 * UI_SCALE));
    const bx = IS_MOBILE ? 0 : Math.floor((VIEW_W - boxW) / 2);
    const by = IS_MOBILE ? 0 : Math.floor((VIEW_H - boxH) / 2);

    ctx.fillStyle = 'rgba(235, 219, 185, 0.98)';
    ctx.strokeStyle = 'rgba(120, 92, 60, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx + pad, by + pad, boxW - pad*2, boxH - pad*2, 18);
    else ctx.rect(bx + pad, by + pad, boxW - pad*2, boxH - pad*2);
    ctx.fill();
    ctx.stroke();

    const innerX = bx + pad + 16;
    const innerW = boxW - pad*2 - 32;

    ctx.fillStyle = '#2a1f14';
    ctx.font = `900 ${Math.round(20*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(`${c.name} Contracts`, innerX, by + pad + 34);

    ctx.fillStyle = '#4a3b2a';
    ctx.font = `${Math.round(12*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    if (contracts.active) {
      const it = ITEMS.find(x=>x.id===contracts.active.want);
      const prog = activeContractProgressLabel();
      ctx.fillText(`Active: Deliver ${contracts.active.qty} ${htmlEscape(it ? it.name : contracts.active.want)} (${htmlEscape(prog)}) → ${htmlEscape(contracts.active.toId)} for ${contracts.active.reward}g`, innerX, by + pad + 56);
    } else {
      ctx.fillText('Pick a job. Deliver to the other city for gold + rep.', innerX, by + pad + 56);
    }

    const listTop = by + pad + Math.round(90 * UI_SCALE);
    const rowH = Math.round(48 * UI_SCALE);
    const jobs = contracts.byCity[c.id];

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const it = ITEMS.find(x=>x.id===job.want);
      const y = listTop + i * rowH;
      const selected = i === ui.contractsSel;

      ctx.fillStyle = selected ? 'rgba(120, 92, 60, 0.16)' : 'rgba(0,0,0,0.05)';
      ctx.strokeStyle = selected ? 'rgba(120, 92, 60, 0.75)' : 'rgba(120, 92, 60, 0.30)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(innerX, y - Math.round(28*T_SCALE), innerW, Math.round(40*T_SCALE), 14);
      else ctx.rect(innerX, y - Math.round(28*T_SCALE), innerW, Math.round(40*T_SCALE));
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#2a1f14';
      ctx.font = `800 ${Math.round(14*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`Deliver ${job.qty}× ${it.name} → ${job.toId}`, innerX + 12, y - Math.round(6*T_SCALE));

      ctx.textAlign = 'right';
      ctx.fillText(`${job.reward}g`, innerX + innerW - 12, y - Math.round(6*T_SCALE));
      ctx.textAlign = 'left';
    }

    // footer
    ctx.fillStyle = '#4a3b2a';
    ctx.font = `${Math.round(12*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText('Enter: accept · Esc: close', innerX, by + boxH - pad - 18);
  }
function drawEvent() {
    if (USE_DOM_MODALS) return;
    const T_SCALE = UI_SCALE * 0.88;
    if (!ui.eventOpen) return;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const boxW = IS_MOBILE ? VIEW_W : Math.min(720, VIEW_W - Math.round(24 * UI_SCALE));
    const boxH = IS_MOBILE ? Math.round(VIEW_H * 0.70) : Math.min(360, VIEW_H - HUD_H - Math.round(24 * UI_SCALE));
    const bx = IS_MOBILE ? 0 : Math.floor((VIEW_W - boxW) / 2);
    const by = IS_MOBILE ? (VIEW_H - boxH) : Math.floor((VIEW_H - boxH) / 2);

    ctx.fillStyle = 'rgba(235, 219, 185, 0.96)'; // parchment
    ctx.strokeStyle = 'rgba(120, 92, 60, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, 14);
    else ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2a1f14';
    ctx.font = `700 ${Math.round(18*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(ui.eventTitle, bx + 18, by + 34);


    // wrap text
    const bodyFont = `${Math.round(13*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillStyle = '#3a2a1a';
    ctx.font = bodyFont;

    const words = (ui.eventText || '').split(/\s+/);
    let line = '';
    let yy = by + 62;
    const lineH = Math.round(18 * UI_SCALE);
    const maxW = boxW - 36;

    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW) {
        ctx.fillText(line, bx + 18, yy);
        yy += lineH;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) { ctx.fillText(line, bx + 18, yy); yy += lineH; }

    // choices start after body text (with padding)
    const startY = Math.max(by + Math.round(140 * UI_SCALE), yy + Math.round(12 * UI_SCALE));
    const choiceRowH = Math.round(30 * UI_SCALE);
    const footerPad = Math.round(34 * UI_SCALE);
    const listH = (by + boxH - footerPad) - startY;
    const visibleN = Math.max(1, Math.floor(listH / choiceRowH));
    const maxScroll = Math.max(0, ui.eventChoices.length - visibleN);
    ui.eventScroll = clamp(ui.eventScroll, 0, maxScroll);

    // expose choice rect for touch scrolling
    ui._eventList = { x: bx + 12, y: startY - Math.round(18 * UI_SCALE), w: boxW - 24, h: visibleN * choiceRowH, rowH: choiceRowH, scrollMax: maxScroll };


    for (let vi = 0; vi < visibleN; vi++) {
      const i = ui.eventScroll + vi;
      if (i >= ui.eventChoices.length) break;
      const y = startY + vi * choiceRowH;
      const selected = i === ui.eventSel;
      if (selected) {
        ctx.fillStyle = 'rgba(120, 92, 60, 0.14)';
        ctx.fillRect(bx + 12, y - Math.round(18 * UI_SCALE), boxW - 24, Math.round(26 * UI_SCALE));
      }
      ctx.fillStyle = selected ? '#1f2937' : '#2a1f14';
      ctx.font = selected ? `600 ${Math.round(14*T_SCALE)}px system-ui` : `${Math.round(14*T_SCALE)}px system-ui`;
      ctx.fillText(ui.eventChoices[i].label, bx + 22, y);
    }



    // scrollbar indicator
    if (maxScroll > 0) {
      const trackX = bx + boxW - Math.round(10 * UI_SCALE);
      const trackY = startY;
      const trackH = visibleN * choiceRowH;
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(trackX, trackY, Math.round(4 * UI_SCALE), trackH);
      const thumbH = Math.max(Math.round(18 * UI_SCALE), Math.round(trackH * (visibleN / ui.eventChoices.length)));
      const t = ui.eventScroll / maxScroll;
      const thumbY = trackY + Math.round((trackH - thumbH) * t);
      ctx.fillStyle = 'rgba(120, 92, 60, 0.55)';
      ctx.fillRect(trackX, thumbY, Math.round(4 * UI_SCALE), thumbH);
    }
    ctx.fillStyle = '#4a3b2a';
    ctx.font = `${Math.round(13*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText('Use ↑/↓ to choose · Enter to confirm · Esc to close', bx + 18, by + boxH - Math.round(20 * UI_SCALE));
  }

  // --- Game loop
  let last = performance.now();
  function tick() {
    const now = performance.now();
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    stateTime += dt * 1000;
    if (ui.toastT > 0) ui.toastT -= dt;

    // Player animation timer (kept independent of render)
    {
      const moving = Math.hypot(player.vx, player.vy) > 1e-3;
      const anim = moving ? 'walk' : 'idle';
      if (playerSprite && playerSprite.ready) {
        if (playerSprite.anim !== anim) {
          playerSprite.anim = anim;
          playerSprite.frame = 0;
          playerSprite.t = 0;
        }
        const fps = (playerSprite.anim === 'walk') ? playerSprite.fpsWalk : playerSprite.fpsIdle;
        const frames = (playerSprite.anim === 'walk') ? playerSprite.walkFrames : playerSprite.idleFrames;
        if (frames > 1 && fps > 0) {
          playerSprite.t += dt;
          const frameDur = 1 / fps;
          while (playerSprite.t >= frameDur) {
            playerSprite.t -= frameDur;
            playerSprite.frame = (playerSprite.frame + 1) % frames;
          }
        } else {
          playerSprite.frame = 0;
        }
      }
    }

    try {

    // City entry inspection (runs when crossing into a city region)
    {
      const cNow = currentCity();
      const nowId = cNow ? cNow.id : null;
      if (nowId && player.lastCityId !== nowId) {
        const rules = CITY_RULES[nowId];
        if (rules) {
          const roll = Math.random();
          const permit = !!player.permits[nowId];
          const inspChance = permit ? Math.max(0.05, rules.inspectionChance * 0.45) : rules.inspectionChance;
          if (roll < inspChance) {
            const contraN = contrabandCountForCity(nowId);
            if (contraN > 0) {
              const removed = confiscateContraband(nowId);
              const fine = rules.fineBase + removed * rules.finePerItem;
              const paid = Math.min(player.gold, fine);
              player.gold -= paid;
              player.rep[nowId] = (player.rep[nowId] || 0) - (2 + removed);
              toast(`Inspection! Contraband confiscated (${removed}). Fine: ${paid}g (Rep -${2 + removed})`, 3.2);
            } else {
              player.rep[nowId] = (player.rep[nowId] || 0) + 1;
              toast('Gate inspection: cleared. (Rep +1)', 2.2);
            }
          } else {
            toast('You slip through the gate uninspected.', 2.2);
          }
        }
      }


      // contract delivery on city entry
      if (nowId && contracts.active && contracts.active.toId === nowId) {
        const want = contracts.active.want;
        const qty = contracts.active.qty;
        const have = player.inv[want] || 0;
        if (have >= qty) {
          player.inv[want] = have - qty;
          player.gold += contracts.active.reward;
          player.rep[nowId] = (player.rep[nowId] || 0) + 2;
          toast(`Contract complete! +${contracts.active.reward}g (Rep +2)`, 3.2);
          contracts.active = null;
        } else {
          toast('You arrived for delivery, but lack the required goods.', 3.0);
        }
      }
      player.lastCityId = nowId;
    }

    // Virtual (touch) button actions
    if (consumeVKey('KeyE')) {
      const c = currentCity();
      if (c && nearMarketTile()) {
        ui.contractsOpen = false;
        ui.marketOpen = !ui.marketOpen;
        ui.selection = 0;
        ui.mode = 'buy';
        toast(ui.marketOpen ? `Market opened in ${c.name}` : 'Market closed', 2);
      } else if (c && nearContractsTile()) {
        ui.marketOpen = false;
        ui.contractsOpen = !ui.contractsOpen;
        ui.contractsSel = 0;
        ui.contractsCityId = c.id;
        toast(ui.contractsOpen ? 'Contracts board opened' : 'Contracts board closed', 2);
      } else {
        const poi = nearPOITile();
        if (poi) triggerPOIEvent(poi);
        else toast('Find the market stall (tan) or contracts board (green) inside a city.', 2.5);
      }
    }

    if (ui.marketOpen) {
      const totalN = ITEMS.length + 1;
      if (consumeVKey('Escape')) { ui.marketOpen = false; toast('Market closed', 2); }
      if (consumeVKey('Tab')) { ui.mode = ui.mode === 'buy' ? 'sell' : 'buy'; }

      // selection via touch/hold arrows
      ui.navT -= dt;
      if (ui.navT <= 0) {
        if (isDown('ArrowUp') || isDown('KeyW')) { ui.selection = (ui.selection + totalN - 1) % totalN; ui.navT = 0.14; }
        else if (isDown('ArrowDown') || isDown('KeyS')) { ui.selection = (ui.selection + 1) % totalN; ui.navT = 0.14; }

        // auto-scroll selection into view (legacy canvas list; keep state consistent)
        const visibleN = Math.max(3, Math.floor((Math.min(420, VIEW_H - HUD_H - Math.round(24 * UI_SCALE)) - Math.round(110 * UI_SCALE) - Math.round(52 * UI_SCALE)) / Math.round(28 * UI_SCALE)));
        ui.marketScroll = clamp(ui.marketScroll, 0, Math.max(0, totalN - visibleN));
        if (ui.selection < ui.marketScroll) ui.marketScroll = ui.selection;
        if (ui.selection >= ui.marketScroll + visibleN) ui.marketScroll = ui.selection - visibleN + 1;
      }

      if (consumeVKey('Enter') || consumeVKey('Space')) {
        marketTryTrade(ui.selection);
      }
    }

    // Road travel tracking + encounters + day consumption
    const cityNow = currentCity();
    if (!cityNow && !ui.eventOpen) {
      const tx = Math.floor(player.x / TILE);
      const ty = Math.floor(player.y / TILE);
      const onRoad = tileAt(tx, ty) === 1;
      if (onRoad) {
        const dx = player.x - (player._px ?? player.x);
        const dy = player.y - (player._py ?? player.y);
        const dist = Math.hypot(dx, dy);
        road.travel += dist;
        // Travel consumes time: ~1 day per 1200px (tune for feel)
        road.dayCarry += dist / 1200;
        if (road.dayCarry >= 1) {
          const days = Math.floor(road.dayCarry);
          road.dayCarry -= days;
          advanceDays(days, 'travel');
          // Upkeep: consume 1 food per day if carrying any
          if (player.inv['food'] > 0) {
            player.inv['food'] -= 1;
            toast('Consumed 1 rations.', 1.4);
          } else {
            // No food: small gold penalty (starvation/hire help)
            const penalty = 3;
            player.gold = Math.max(0, player.gold - penalty);
            toast(`No rations! Paid ${penalty}g for supplies.`, 1.8);
          }
        }
      }
    }
    player._px = player.x;
    player._py = player.y;
    if (road.cooldown > 0) road.cooldown -= dt;
    if (!ui.eventOpen) maybeTriggerRoadEvent();

    // Event navigation + confirm
    if (ui.eventOpen) {
      ui.eventNavT -= dt;
      if (ui.eventNavT <= 0) {
        if (isDown('ArrowUp') || isDown('KeyW')) { ui.eventSel = (ui.eventSel + ui.eventChoices.length - 1) % ui.eventChoices.length; ui.eventNavT = 0.14; }
        else if (isDown('ArrowDown') || isDown('KeyS')) { ui.eventSel = (ui.eventSel + 1) % ui.eventChoices.length; ui.eventNavT = 0.14; }

        // NOTE: event list scrolling is handled by the DOM overlay; keep selection only.
      }
      if (consumeVKey('Escape')) { closeEvent(); toast('You move on.', 2); }
      if (consumeVKey('Enter') || consumeVKey('Space')) {
        const ch = ui.eventChoices[ui.eventSel]
        if (ch && typeof ch.run === 'function') ch.run();
      }
    }

    // Contracts navigation
    if (ui.contractsOpen) {
      const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
      const jobs = c ? (contracts.byCity[c.id] || []) : [];
      const n = Math.max(1, jobs.length);

      if (consumeVKey('Escape')) { ui.contractsOpen = false; toast('Contracts board closed', 2); }
      if (consumeVKey('Enter') || consumeVKey('Space')) contractsAccept(ui.contractsSel);

      ui.contractsNavT -= dt;
      if (ui.contractsNavT <= 0) {
        if (isDown('ArrowUp') || isDown('KeyW')) { ui.contractsSel = (ui.contractsSel + n - 1) % n; ui.contractsNavT = 0.14; }
        else if (isDown('ArrowDown') || isDown('KeyS')) { ui.contractsSel = (ui.contractsSel + 1) % n; ui.contractsNavT = 0.14; }
      }
    }
    moveWithCollision(dt);

    // camera follow
    const targetX = player.x - VIEW_W / 2;
    const targetY = player.y - VIEW_H / 2;
    camera.x = lerp(camera.x, targetX, 1 - Math.exp(-10 * dt));
    camera.y = lerp(camera.y, targetY, 1 - Math.exp(-10 * dt));
    camera.x = clamp(camera.x, 0, MAP_W*TILE - VIEW_W);
    camera.y = clamp(camera.y, 0, MAP_H*TILE - VIEW_H);

    // Sync HTML overlay UI (modals)
    domRender();

    // draw
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    drawWorld();
    drawPlayer();
    drawMobileOverlay();
    drawHUD();
    drawMarket();
    drawContracts();
    drawEvent();


    } catch (err) {
      console.error(err);
      window.__crash.msg = String(err && (err.stack || err.message) || err);
    }

    if (window.__crash.msg) {
      ctx.save();
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = '#fecaca';
      ctx.font = `${Math.round(14 * UI_SCALE)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      const rawLines = String(window.__crash.msg).split('\n');
      // Wrap long lines so mobile screenshots capture the important part (error type + first frames).
      const wrapChars = IS_MOBILE ? 46 : 120;
      const lines = [];
      for (const ln of rawLines) {
        if (!ln) { lines.push(''); continue; }
        for (let i = 0; i < ln.length; i += wrapChars) lines.push(ln.slice(i, i + wrapChars));
      }
      const shown = lines.slice(0, IS_MOBILE ? 18 : 12);

      let y = Math.round(28 * UI_SCALE);
      ctx.fillText('Runtime error (screenshot this):', Math.round(12 * UI_SCALE), y);
      y += Math.round(22 * UI_SCALE);
      for (const ln of shown) {
        ctx.fillText(ln, Math.round(12 * UI_SCALE), y);
        y += Math.round(18 * UI_SCALE);
      }
      // hint so people know how to report it
      ctx.fillStyle = 'rgba(254,202,202,0.75)';
      ctx.font = `${Math.round(12 * UI_SCALE)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      ctx.fillText('Tip: send this screenshot + the top line above.', Math.round(12 * UI_SCALE), y + Math.round(10 * UI_SCALE));
      ctx.restore();
    }

    requestAnimationFrame(tick);
  }

  // If QA enabled, run a deterministic self-test (no input required).
  if (__QA.enabled) {
    try {
      // Put player inside Sunspire near contracts tile (id 12) and open contracts.
      const c = world.cityA;
      player.x = (c.x + Math.floor(c.w / 2)) * TILE;
      player.y = (c.y + Math.floor(c.h / 2)) * TILE;
      ui.contractsCityId = 'sunspire';
      ui.contractsOpen = true;
      ui.contractsSel = 0;

      // Render once so DOM exists, then accept.
      domRender();
      contractsAccept(0);

      if (!contracts.active) throw new Error('QA: contracts.active not set after accept');

      // Basic render sanity: ensure progress label computes.
      activeContractProgressLabel();

      qaPass('contracts accept + render');
    } catch (e) {
      qaFail(String(e && (e.stack || e.message) || e));
    }
  }

  tick();
})();
