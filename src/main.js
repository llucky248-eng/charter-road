/* The Charter Road — web prototype (tiles + free roam)
   Step goal: tile engine + collision + 2 city zones with different rules.
*/

(() => {
  const canvas = document.getElementById('game');
  if (!canvas) throw new Error('Missing canvas');

  // Mobile readability: use a smaller internal resolution so UI appears bigger when scaled to screen.
  const IS_MOBILE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const BASE_W = IS_MOBILE ? 640 : 960;
  const BASE_H = Math.round(BASE_W * 9 / 16);
  canvas.width = BASE_W;
  canvas.height = BASE_H;

  const ctx = canvas.getContext('2d');

  const VIEW_W = canvas.width;
  const VIEW_H = canvas.height;

  const TILE = 16;
  const UI_SCALE = IS_MOBILE ? 1.9 : 1.0;
  const HUD_H = Math.round((IS_MOBILE ? 72 : 56) * UI_SCALE);
  const MAP_W = 140;
  const MAP_H = 90;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;

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

  // --- Tiles
  // 0 grass, 1 road, 2 water, 3 wall/rock, 4 city-floor, 5 gate, 6 market
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
      // simple wall border
      for (let xx = c.x; xx < c.x + c.w; xx++) {
        m[(c.y-1)*MAP_W + xx] = 3;
        m[(c.y+c.h)*MAP_W + xx] = 3;
      }
      for (let yy = c.y; yy < c.y + c.h; yy++) {
        m[yy*MAP_W + (c.x-1)] = 3;
        m[yy*MAP_W + (c.x+c.w)] = 3;
      }
      // gate (road entry)
      const gx = c.x + Math.floor(c.w/2);
      const gy = c.y + c.h;
      m[gy*MAP_W + gx] = 5;
      // connect road to gate
      m[(gy+1)*MAP_W + gx] = 1;
      return { gx, gy };
    };

    const gateA = paintCity(cityA);
    const gateB = paintCity(cityB);

    carveRoad(gateA.gx, gateA.gy+1, 70, 12);
    carveRoad(70, 12, gateB.gx, gateB.gy+1);

    // scatter a few rocks for flavor
    for (let i = 0; i < 420; i++) {
      const x = 1 + (Math.random() * (MAP_W-2) | 0);
      const y = 1 + (Math.random() * (MAP_H-2) | 0);
      const idx = y*MAP_W + x;
      if (m[idx] === 0 && Math.random() < 0.06) m[idx] = 3;
    }

    return { m, cityA, cityB };
  }

  const world = makeMap();

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

  // --- UI / time
  let stateTime = 0;

  // Iteration notes (rendered into the bottom textbox)
      const ITERATION = {
    version: 'v0.0.9',
    whatsNew: [
      'UI fix: toast messages no longer overlap gameplay (rendered inside HUD).',
      'UI polish: cleaner HUD layout + coin/bag icons; parchment popups (carryover).',
      'Map polish: storybook tile variation + water shimmer (carryover).',
    ],
    whatsNext: [
      'Validate Market/Event popups on mobile (no clipping) + tune spacing.',
      'Restrict encounters to road tiles + richer outcomes (rep/permits).',
      'Contracts board + basic reputation.',
    ],
  };

  const ui = {
    marketOpen: false,
    toast: 'Walk into a city. Find the market tile and press E.',
    toastT: 6,
    selection: 0,
    mode: 'buy', // buy|sell
    navT: 0,

    eventOpen: false,
    eventTitle: '',
    eventText: '',
    eventChoices: [], // {label, run:()=>void}
    eventSel: 0,
    eventNavT: 0,
  };

  // Render iteration notes into the bottom textbox (if present)
  const devlogBody = document.getElementById('devlog-body');
  if (devlogBody) {
    const v = ITERATION.version ? ` ${ITERATION.version}` : '';
    devlogBody.textContent =
      `Version:${v}\n\nWhat’s new:\n- ${ITERATION.whatsNew.join('\n- ')}\n\nWhat’s coming:\n- ${ITERATION.whatsNext.join('\n- ')}`;
  }

  // --- Player
  const player = {
    x: (world.cityA.x + world.cityA.w/2) * TILE,
    y: (world.cityA.y + world.cityA.h + 4) * TILE,
    r: 6,
    vx: 0,
    vy: 0,
    speed: 120,

    gold: 120,
    capacity: 18,
    inv: Object.fromEntries(ITEMS.map(it => [it.id, 0])),

    lastCityId: null,
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
    return Math.max(1, Math.round(item.base * mult * wob));
  }

  function isSolidAt(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    return SOLID.has(tileAt(tx, ty));
  }

  function moveWithCollision(dt) {
    if (ui.marketOpen || ui.eventOpen) return;
    const ax = (isDown('KeyD') || isDown('ArrowRight') ? 1 : 0) - (isDown('KeyA') || isDown('ArrowLeft') ? 1 : 0);
    const ay = (isDown('KeyS') || isDown('ArrowDown') ? 1 : 0) - (isDown('KeyW') || isDown('ArrowUp') ? 1 : 0);
    const mag = Math.hypot(ax, ay);
    const nx = mag > 0 ? ax / mag : 0;
    const ny = mag > 0 ? ay / mag : 0;

    player.vx = nx * player.speed;
    player.vy = ny * player.speed;

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
      for (let ox = -1; ox <= 1; ox++) {
        if (tileAt(tx + ox, ty + oy) === 6) return true;
      }
    }
    return false;
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

  // --- Road encounters
  const road = {
    travel: 0,
    cooldown: 0,
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

  function maybeTriggerRoadEvent() {
    const c = currentCity();
    if (c) return; // only on the road
    if (road.cooldown > 0) return;
    if (road.travel < 520) return; // threshold; tuned for feel

    road.travel = 0;
    road.cooldown = 6.0;

    const kind = randChoice(['bandits', 'toll', 'storm']);

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
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') {
      const c = currentCity();
      if (c && nearMarketTile()) {
        ui.marketOpen = !ui.marketOpen;
        ui.selection = 0;
        ui.mode = 'buy';
        toast(ui.marketOpen ? `Market opened in ${c.name}` : 'Market closed', 2);
      } else {
        toast('Find the market stall inside a city (tan tile).', 2.5);
      }
    }

    if (ui.marketOpen) {
      if (e.code === 'Escape') { ui.marketOpen = false; toast('Market closed', 2); }
      if (e.code === 'Tab') { e.preventDefault(); ui.mode = ui.mode === 'buy' ? 'sell' : 'buy'; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') ui.selection = (ui.selection + ITEMS.length - 1) % ITEMS.length;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') ui.selection = (ui.selection + 1) % ITEMS.length;
      if (e.code === 'Enter' || e.code === 'Space') {
        const c = currentCity();
        if (!c) return;
        const it = ITEMS[ui.selection];
        const p = priceFor(c.id, it);
        if (ui.mode === 'buy') {
          const w = invWeight();
          if (w + it.weight > player.capacity) { toast('No space in pack.', 2); return; }
          if (player.gold < p) { toast('Not enough gold.', 2); return; }
          player.gold -= p;
          player.inv[it.id] = (player.inv[it.id] || 0) + 1;
          toast(`Bought 1 ${it.name} (-${p}g)`, 2);
        } else {
          const have = player.inv[it.id] || 0;
          if (have <= 0) { toast('You have none to sell.', 2); return; }
          const gross = p;
          const net = Math.max(1, Math.round(gross * (1 - CITY_RULES[c.id].taxRate)));
          player.inv[it.id] = have - 1;
          player.gold += net;
          toast(`Sold 1 ${it.name} (+${net}g after tax)`, 2);
        }
      }
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
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);
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
      return;
    }

    if (id === 3) {
      ctx.fillStyle = '#3b3f4a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x+2, y+2, TILE-4, TILE-4);
      return;
    }

    if (id === 4) {
      ctx.fillStyle = '#5b4b3a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);
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
    ctx.ellipse(x, y + 6, 8, 4, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // body
    ctx.fillStyle = '#2a1f14';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI*2);
    ctx.fill();

    // cloak
    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.arc(x, y+2, 6, 0, Math.PI*2);
    ctx.fill();

    // eyes
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(x-3, y-2, 2, 2);
    ctx.fillRect(x+1, y-2, 2, 2);
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
    const line1 = Math.round(22 * UI_SCALE);
    const line2 = Math.round(44 * UI_SCALE);

    // Title (city/road)
    ctx.fillStyle = '#e8edf2';
    ctx.font = `700 ${Math.round(16 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(c ? c.name : 'On the road', pad, line1);

    // icons + stats (right side)
    const rightX = VIEW_W - pad;

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

    // second line: rules + hint
    ctx.fillStyle = 'rgba(138,160,179,0.95)';
    ctx.font = `${Math.round(13 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

    if (rules) {
      const hint = nearMarketTile() ? 'E: Market' : 'Find market (gold tile)';
      ctx.fillText(
        `Tax ${Math.round(rules.taxRate*100)}% · Inspect ${Math.round(rules.inspectionChance*100)}% · Contraband: ${rules.contraband.join(', ')} · ${hint}`,
        pad,
        line2
      );
    } else {
      ctx.fillText('Follow the road between cities. Encounters may trigger while traveling.', pad, line2);
    }

    // toast (inside HUD; never overlaps gameplay)
    if (ui.toastT > 0) {
      const toastY = Math.min(HUD_H - Math.round(8 * UI_SCALE), line2 + Math.round(18 * UI_SCALE));
      ctx.fillStyle = 'rgba(200, 230, 255, 0.95)';
      ctx.fillText(ui.toast, pad, toastY);
    }
  }

  function drawMarket() {
    if (!ui.marketOpen) return;
    const c = currentCity();
    if (!c) return;
    const rules = CITY_RULES[c.id];

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, HUD_H, VIEW_W, VIEW_H - HUD_H);

    const boxW = 520;
    const boxH = 360;
    const bx = Math.floor((VIEW_W - boxW) / 2);
    const by = Math.floor((VIEW_H - boxH) / 2);

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

    ctx.fillStyle = '#4a3b2a';
    ctx.font = `${Math.round(13*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(`${rules.vibe}  ·  Tab: switch Buy/Sell  ·  Enter/Space: confirm  ·  Esc: close`, bx + 18, by + 56);

    ctx.fillStyle = ui.mode === 'buy' ? '#38bdf8' : '#cbd5e1';
    ctx.font = `700 ${Math.round(14*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(ui.mode.toUpperCase(), bx + 18, by + 82);

    const startY = by + 110;
    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      const y = startY + i * 32;
      const selected = i === ui.selection;

      if (selected) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.fillRect(bx + 12, y - 18, boxW - 24, 28);
      }

      const p = priceFor(c.id, it);
      const have = player.inv[it.id] || 0;
      const contra = it.contrabandName && rules.contraband.includes(it.contrabandName);

      ctx.fillStyle = selected ? '#e8edf2' : '#cbd5e1';
      ctx.font = selected ? `600 ${Math.round(14*UI_SCALE)}px system-ui` : `${Math.round(14*UI_SCALE)}px system-ui`;
      ctx.fillText(it.name, bx + 22, y);

      ctx.fillStyle = '#4a3b2a';
      ctx.fillText(`w${it.weight}`, bx + 260, y);

      ctx.fillStyle = '#2a1f14';
      ctx.fillText(`${p}g`, bx + 310, y);

      ctx.fillStyle = '#4a3b2a';
      ctx.fillText(`you: ${have}`, bx + 380, y);

      if (contra) {
        ctx.fillStyle = '#f97316';
        ctx.fillText('CONTRABAND', bx + 450, y);
      }
    }

    // footer
    const w = invWeight();
    ctx.fillStyle = '#2a1f14';
    ctx.font = `600 ${Math.round(14*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(`Gold: ${player.gold}g`, bx + 18, by + boxH - 22);
    ctx.fillStyle = '#4a3b2a';
    ctx.fillText(`Pack: ${w}/${player.capacity}`, bx + 140, by + boxH - 22);
  }


  function drawEvent() {
    if (!ui.eventOpen) return;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, HUD_H, VIEW_W, VIEW_H - HUD_H);

    const boxW = 560;
    const boxH = 260;
    const bx = Math.floor((VIEW_W - boxW) / 2);
    const by = Math.floor((VIEW_H - boxH) / 2);

    ctx.fillStyle = 'rgba(235, 219, 185, 0.96)'; // parchment
    ctx.strokeStyle = 'rgba(120, 92, 60, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, 14);
    else ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2a1f14';
    ctx.font = `700 ${Math.round(18*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(ui.eventTitle, bx + 18, by + 34);

    ctx.fillStyle = '#3a2a1a';
    ctx.font = `${Math.round(13*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    // wrap text roughly
    const words = (ui.eventText || '').split(/\s+/);
    let line = '';
    let yy = by + 62;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > boxW - 36) {
        ctx.fillText(line, bx + 18, yy);
        yy += 18;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, bx + 18, yy);

    const startY = by + 140;
    for (let i = 0; i < ui.eventChoices.length; i++) {
      const y = startY + i * 30;
      const selected = i === ui.eventSel;
      if (selected) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.fillRect(bx + 12, y - 18, boxW - 24, 26);
      }
      ctx.fillStyle = selected ? '#e8edf2' : '#cbd5e1';
      ctx.font = selected ? `600 ${Math.round(14*UI_SCALE)}px system-ui` : `${Math.round(14*UI_SCALE)}px system-ui`;
      ctx.fillText(ui.eventChoices[i].label, bx + 22, y);
    }

    ctx.fillStyle = '#4a3b2a';
    ctx.font = `${Math.round(13*UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText('Use ↑/↓ to choose · Enter to confirm · Esc to close', bx + 18, by + boxH - 20);
  }

  // --- Game loop
  let last = performance.now();
  function tick() {
    const now = performance.now();
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    stateTime += dt * 1000;
    if (ui.toastT > 0) ui.toastT -= dt;

    // City entry inspection (runs when crossing into a city region)
    {
      const cNow = currentCity();
      const nowId = cNow ? cNow.id : null;
      if (nowId && player.lastCityId !== nowId) {
        const rules = CITY_RULES[nowId];
        if (rules) {
          const roll = Math.random();
          if (roll < rules.inspectionChance) {
            const contraN = contrabandCountForCity(nowId);
            if (contraN > 0) {
              const removed = confiscateContraband(nowId);
              const fine = rules.fineBase + removed * rules.finePerItem;
              const paid = Math.min(player.gold, fine);
              player.gold -= paid;
              toast(`Inspection! Contraband confiscated (${removed}). Fine: ${paid}g`, 3.2);
            } else {
              toast('Gate inspection: cleared.', 2.2);
            }
          } else {
            toast('You slip through the gate uninspected.', 2.2);
          }
        }
      }
      player.lastCityId = nowId;
    }

    // Virtual (touch) button actions
    if (consumeVKey('KeyE')) {
      const c = currentCity();
      if (c && nearMarketTile()) {
        ui.marketOpen = !ui.marketOpen;
        ui.selection = 0;
        ui.mode = 'buy';
        toast(ui.marketOpen ? `Market opened in ${c.name}` : 'Market closed', 2);
      } else {
        toast('Find the market stall inside a city (gold tile).', 2.5);
      }
    }

    if (ui.marketOpen) {
      if (consumeVKey('Escape')) { ui.marketOpen = false; toast('Market closed', 2); }
      if (consumeVKey('Tab')) { ui.mode = ui.mode === 'buy' ? 'sell' : 'buy'; }

      // selection via touch/hold arrows
      ui.navT -= dt;
      if (ui.navT <= 0) {
        if (isDown('ArrowUp') || isDown('KeyW')) { ui.selection = (ui.selection + ITEMS.length - 1) % ITEMS.length; ui.navT = 0.14; }
        else if (isDown('ArrowDown') || isDown('KeyS')) { ui.selection = (ui.selection + 1) % ITEMS.length; ui.navT = 0.14; }
      }

      if (consumeVKey('Enter') || consumeVKey('Space')) {
        const c = currentCity();
        if (c) {
          const it = ITEMS[ui.selection];
          const p = priceFor(c.id, it);
          if (ui.mode === 'buy') {
            const w = invWeight();
            if (w + it.weight > player.capacity) toast('No space in pack.', 2);
            else if (player.gold < p) toast('Not enough gold.', 2);
            else { player.gold -= p; player.inv[it.id] = (player.inv[it.id] || 0) + 1; toast(`Bought 1 ${it.name} (-${p}g)`, 2); }
          } else {
            const have = player.inv[it.id] || 0;
            if (have <= 0) toast('You have none to sell.', 2);
            else {
              const net = Math.max(1, Math.round(p * (1 - CITY_RULES[c.id].taxRate)));
              player.inv[it.id] = have - 1;
              player.gold += net;
              toast(`Sold 1 ${it.name} (+${net}g after tax)`, 2);
            }
          }
        }
      }

      // allow touch selection via holding arrows too (handled in key checks below)
    }

    // Road travel tracking + encounters
    const cityNow = currentCity();
    if (!cityNow && !ui.eventOpen) {
      // distance traveled on the road
      const dx = player.x - (player._px ?? player.x);
      const dy = player.y - (player._py ?? player.y);
      road.travel += Math.hypot(dx, dy);
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
      }
      if (consumeVKey('Escape')) { closeEvent(); toast('You move on.', 2); }
      if (consumeVKey('Enter') || consumeVKey('Space')) {
        const ch = ui.eventChoices[ui.eventSel]
        if (ch && typeof ch.run === 'function') ch.run();
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

    // draw
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    drawWorld();
    drawPlayer();
    drawHUD();
    drawMarket();
    drawEvent();

    requestAnimationFrame(tick);
  }

  tick();
})();
