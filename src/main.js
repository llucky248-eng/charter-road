/* The Amber Road — web prototype (tiles + free roam)
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
  const NPC_DIAG_ENABLED = new URLSearchParams(location.search).get('npcdiag') === '1';

  const NPC_DIAG_BUILD = 'v0.3.43'; // single version — updated by ops/scripts/bump_version.mjs
  const __NPCDIAG_STATE = {
    enabled: NPC_DIAG_ENABLED,
    state: 'init',
    result: 'pending',
    tick: 0,
    delta: 0,
    bubble: false,
    note: '',
    npcId: null,
    t0: 0,
    pos0: null,
    lastAction: '',
    lastInput: '',
    forceNpc: true,
    lastTickAt: 0,
    build: NPC_DIAG_BUILD,
  };
  // expose for debugging
  window.__npcdiag = __NPCDIAG_STATE;

  function initNpcDiagOverlay() {
    if (!NPC_DIAG_ENABLED) return null;
    try {
      const el = document.createElement('div');
      el.id = 'npcdiag-overlay';
      el.style.position = 'fixed';
      el.style.left = '6px';
      el.style.top = '6px';
      el.style.zIndex = '9999';
      el.style.padding = '6px 8px';
      el.style.background = 'rgba(0,0,0,0.75)';
      el.style.color = '#e5e7eb';
      el.style.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      el.style.borderRadius = '6px';
      el.style.pointerEvents = 'none';
      el.textContent = `NPC DIAG LOADED (${NPC_DIAG_BUILD})`;
      document.body.appendChild(el);
      return el;
    } catch {
      return null;
    }
  }

  const __NPCDIAG_OVERLAY = initNpcDiagOverlay();
  if (NPC_DIAG_ENABLED && __NPCDIAG_OVERLAY) {
    setInterval(() => {
      try {
        const d = window.__npcdiag || __NPCDIAG_STATE;
        const age = d.lastTickAt ? ((performance.now() - d.lastTickAt) / 1000).toFixed(1) : 'n/a';
        const status = d.result === 'pending' ? d.state : d.result;
        const line1 = `NPC DIAG ${status} | build ${d.build}`;
        const line2 = `delta=${d.delta.toFixed(3)} bubble=${d.bubble ? 'yes' : 'no'} tick=${d.tick} lastTick=${age}s`;
        const line2b = `deltaRaw=${d.delta}`;

        const line3 = `input=${d.lastInput || '-'} action=${d.lastAction || '-'} note=${d.note || '-'}`;
        const line4 = `passCheck=${d.passCheck ? 'yes' : 'no'} state=${d.state}`;
        __NPCDIAG_OVERLAY.textContent = `${line1}
${line2}
${line2b}
${line3}
${line4}`;
        __NPCDIAG_OVERLAY.style.whiteSpace = 'pre';
      } catch {}
    }, 500);
  }

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
    // Use warn instead of error so Playwright doesn't fail the run just from logging.
    console.warn('QA_FAIL', details);
  }

  // --- QA API (exposed only when ?qa=1)
  // Defined here (early) for Playwright introspection, but wired to SAVE_KEY later
  // once Save/Load constants are declared.
  if (__QA.enabled) {
    // @ts-ignore
    __QA.api = {
      _getSaveKey: () => null,

      getSaveKey: () => __QA.api._getSaveKey() || '',
      clearSave: () => { const k = __QA.api._getSaveKey(); if (!k) return; try { localStorage.removeItem(k); } catch {} },
      readSaveRaw: () => { const k = __QA.api._getSaveKey(); if (!k) return null; try { return localStorage.getItem(k); } catch { return null; } },
      readSave: () => {
        const k = __QA.api._getSaveKey();
        if (!k) return null;
        try {
          const raw = localStorage.getItem(k);
          if (!raw) return null;
          return JSON.parse(raw);
        } catch { return null; }
      },

      snapshot: () => ({
        player: structuredClone(player),
        time: structuredClone(time),
        contracts: structuredClone(contracts),
        marketDrift: structuredClone(marketDrift),
        contractsByCity: structuredClone(contracts.byCity),
        ui: { mode: ui.mode },
      }),

      getRumors: (cityId) => {
        const id = String(cityId || '');
        return getMarketRumors(id);
      },

      getNpcLines: (cityId, npcId) => {
        const id = String(cityId || '');
        const npcKey = String(npcId || '');
        return getNpcLines(id, npcKey);
      },
      getNpcPanel: (cityId) => {
        const id = String(cityId || '');
        return getNpcPanelState(id);
      },
      getNpcCacheDay: () => npcLoadCache().day,
      getNpcEntities: () => entities.filter(e => e.kind === 'npc').map(e => ({
        id: e.id,
        role: e.role,
        cityId: e.cityId,
        x: e.x,
        y: e.y,
        radius: e.radius,
        bounds: e.bounds ? { ...e.bounds } : null,
        dialogueIdx: e.dialogueIdx,
      })),
      spawnCityNPCs: (cityId) => {
        spawnCityNPCs(String(cityId || ''));
        return true;
      },
      interactNpc: (npcId) => {
        const id = String(npcId || '');
        const npc = entities.find(e => e.kind === 'npc' && e.id === id);
        return !!triggerNpcTalk(npc);
      },
      getNpcBubble: () => (ui.npcBubble ? { ...ui.npcBubble } : null),
      getNpcBubbleRect: () => {
        const layout = computeNpcBubbleLayout();
        return layout ? { ...layout.rect } : null;
      },
      getNpcBubbleText: () => {
        const layout = computeNpcBubbleLayout();
        return layout ? layout.line : null;
      },
      clearNpcBubble: () => { ui.npcBubble = null; return true; },

      setRep: (cityId, val) => {
        const id = String(cityId || '');
        if (!id) return false;
        player.rep[id] = Math.floor(Number(val) || 0);
        return true;
      },
      setPermit: (cityId, on) => {
        const id = String(cityId || '');
        if (!id) return false;
        player.permits[id] = !!on;
        return true;
      },
      regenContracts: (cityId = null) => {
        if (cityId) {
          const id = String(cityId);
          contracts.byCity[id] = regenContractsForCity(id);
        } else {
          for (const cid of ['valdenmere','ashport','crosshaven','ironholt'])
            contracts.byCity[cid] = regenContractsForCity(cid);
        }
        return true;
      },
      listVisibleContracts: (cityId) => {
        const id = String(cityId || '');
        const repTier = contractTierForRep(player.rep?.[id] || 0);
        return (contracts.byCity[id] || []).filter(j => (j?.tier ?? 0) <= repTier);
      },

      findTile: (tileId) => {
        const id = Number(tileId);
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            if (tileAt(x, y) === id) return { x, y };
          }
        }
        return null;
      },
      teleportToTile: (tx, ty) => {
        const x = Number(tx), y = Number(ty);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        player.x = (x + 0.5) * TILE;
        player.y = (y + 0.5) * TILE;
        camera.x = player.x - VIEW_W/2;
        camera.y = player.y - VIEW_H/2;
        return true;
      },
      openCacheAt: (tx, ty) => {
        const x = Number(tx), y = Number(ty);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'bad coords' };
        if (tileAt(x, y) !== 13) return { ok: false, reason: 'not cache tile' };
        const key = cacheKey(x, y);
        if (openedCaches.has(key)) return { ok: false, reason: 'already opened' };

        openedCaches.add(key);
        const beforeGold = player.gold;

        const r = rand01();
        if (r < 0.55) {
          const g = 6 + Math.floor(rand01() * 15);
          player.gold += g;
        } else if (r < 0.85) {
          const pool = ['food','ore','herbs'];
          const itId = pool[Math.floor(rand01() * pool.length)];
          const n = 1 + (rand01() < 0.35 ? 1 : 0);
          player.inv[itId] = (player.inv[itId] || 0) + n;
        } else {
          advanceDays(1, 'cache');
        }

        scheduleAutoSave();
        return { ok: true, goldDelta: player.gold - beforeGold };
      },

      setTime: (p = {}) => {
        if (Number.isFinite(p.day)) time.day = p.day;
        if (Number.isFinite(p.frac)) time.frac = p.frac;
        if (Number.isFinite(p.seed)) time.seed = p.seed;
      },
      setPlayer: (p = {}) => {
        if (Number.isFinite(p.gold)) player.gold = p.gold;
        if (Number.isFinite(p.capacity)) player.capacity = p.capacity;
        if (Number.isFinite(p.x)) player.x = p.x;
        if (Number.isFinite(p.y)) player.y = p.y;
        if (p.inv && typeof p.inv === 'object') {
          for (const k of Object.keys(p.inv)) player.inv[k] = p.inv[k];
        }
      },

      teleportToCity: (cityId) => {
        const c = getCityById(cityId);
        if (!c) return false;
        player.x = (c.x + Math.floor(c.w / 2)) * TILE;
        player.y = (c.y + Math.floor(c.h / 2)) * TILE;
        camera.x = player.x - VIEW_W/2;
        camera.y = player.y - VIEW_H/2;
        return true;
      },

      freezePrices: () => { stateTime = 0; },

      // QA helper: set the active contract deterministically.
      // If null/undefined, clears active.
      setActiveContract: (c) => {
        if (!c) { contracts.active = null; return true; }
        if (typeof c !== 'object') return false;
        const want = String(c.want || '');
        const toId = String(c.toId || '');
        const fromId = String(c.fromId || '');
        const qty = Math.max(1, Math.floor(Number(c.qty) || 1));
        const reward = Math.max(0, Math.floor(Number(c.reward) || 0));
        if (!want || !toId) return false;
        contracts.active = { fromId, toId, want, qty, reward };
        return true;
      },

      // QA helper: force the game to process city-entry logic deterministically.
      // This emulates the tick block's entry transition checks (inspection + contract delivery)
      // without requiring a real animation-frame tick.
      forceCityEntry: (cityId) => {
        const cNow = getCityById(cityId);
        if (!cNow) return false;

        const nowId = cNow.id;

        // Pretend we just entered the city.
        player.lastCityId = null;
        __QA.api.teleportToCity(cityId);

        // Run the same contract delivery logic as the tick block.
        if (contracts.active && contracts.active.toId === nowId) {
          const want = contracts.active.want;
          const qty = contracts.active.qty;
          const have = player.inv[want] || 0;
          if (have >= qty) {
            player.inv[want] = have - qty;
            if (player.inv[want] < 0) player.inv[want] = 0;

            const reward = contracts.active.reward;
            player.gold += reward;

            const repGain = clamp(qty, 2, 4);
            player.rep[nowId] = (player.rep[nowId] || 0) + repGain;

            const it = ITEMS.find(x => x.id === want);
            const title = `Contract completed`;
            const text = `Delivered ${qty}× ${it ? it.name : want} → ${nowId} (${contractRewardLabel(reward, repGain)})`;
            showBanner(title, text);

            contracts.active = null;
            scheduleAutoSave();
          }
        }

        player.lastCityId = nowId;
        return true;
      },

      marketBuy: (itemId, qty = 1, cityId = 'valdenmere') => {
        __QA.api.teleportToCity(cityId);
        ui.mode = 'buy';
        const idx = ITEMS.findIndex(it => it.id === itemId);
        if (idx < 0) return { ok: false, reason: 'bad itemId' };
        const beforeGold = player.gold;
        const beforeQty = player.inv[itemId] || 0;
        marketTryTrade(idx, qty);
        const afterGold = player.gold;
        const afterQty = player.inv[itemId] || 0;
        const ok = afterQty > beforeQty;
        return { ok, cost: Math.max(0, beforeGold - afterGold) };
      },
      marketSell: (itemId, qty = 1, cityId = 'valdenmere') => {
        __QA.api.teleportToCity(cityId);
        ui.mode = 'sell';
        const idx = ITEMS.findIndex(it => it.id === itemId);
        if (idx < 0) return { ok: false, reason: 'bad itemId' };
        const beforeGold = player.gold;
        const beforeQty = player.inv[itemId] || 0;
        marketTryTrade(idx, qty);
        const afterGold = player.gold;
        const afterQty = player.inv[itemId] || 0;
        const ok = afterQty < beforeQty;
        return { ok, revenue: Math.max(0, afterGold - beforeGold) };
      },

      travelDays: (days = 1) => {
        // Deterministic travel equivalent: advance time + apply upkeep + schedule autosave.
        const n = Math.max(0, Math.floor(Number(days) || 0));
        if (n <= 0) return { ok: false, reason: 'bad days' };
        advanceDays(n, 'travel');
        for (let i = 0; i < n; i++) {
          if ((player.inv['food'] || 0) > 0) player.inv['food'] -= 1;
          else player.gold = Math.max(0, player.gold - 8); // matches live penalty (was 3g)
        }
        scheduleAutoSave();
        return { ok: true };
      },

      flushAutosave: () => {
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer);
          autoSaveTimer = null;
          saveGame();
          return true;
        }
        return false;
      },

      // QA helper: run a single simulation step without relying on requestAnimationFrame.
      step: (dt = 1/60) => {
        try {
          const now = performance.now();
    if (ui.npcDiag && ui.npcDiag.enabled) ui.npcDiag.lastTickAt = now;
          const d = clamp(Number(dt) || 0, 0, 0.05);
          stateTime += d * 1000;
          // QA: auto-close any blocking modals so movement tests work
          if (__QA.enabled) {
            ui.eventOpen = false; ui.marketOpen = false; ui.contractsOpen = false;
          }
          if (ui.toastT > 0) ui.toastT -= d;
          tickBanners(d);
          updateEntities(d);
          updateAutoNav(d);
          moveWithCollision(d);
          if (ui.npcBubble && stateTime > ui.npcBubble.untilMs) ui.npcBubble = null;
          // Run DOM render so any UI state updates don't throw.
          domRender();
          // Run the same city-entry + contract-delivery logic as tick().
          const cNow = currentCity();
          const nowId = cNow ? cNow.id : null;
          if (nowId !== player.lastCityId) {
            spawnCityNPCs(nowId);
          }
          if (nowId && player.lastCityId !== nowId) {
            const rules = CITY_RULES[nowId];
            if (rules) {
              const roll = 0.9999; // deterministic: avoid random inspection side-effects in QA.
              const permit = !!player.permits[nowId];
              const _guardDisc = cityBonus[nowId]?.guardDiscount || 0;
              const inspChance = (permit ? Math.max(0.05, rules.inspectionChance * 0.45) : rules.inspectionChance) * (1 - _guardDisc);
              if (roll < inspChance) {
                const contraN = contrabandCountForCity(nowId);
                if (contraN > 0) {
                  const removed = confiscateContraband(nowId);
                  const fine = rules.fineBase + removed * rules.finePerItem;
                  const paid = Math.min(player.gold, fine);
                  player.gold -= paid;
                  player.rep[nowId] = (player.rep[nowId] || 0) - (2 + removed);
                } else {
                  player.rep[nowId] = (player.rep[nowId] || 0) + 1;
                }
              }
            }

            if (contracts.active && contracts.active.toId === nowId) {
              const want = contracts.active.want;
              const qty = contracts.active.qty;
              const have = player.inv[want] || 0;
              if (have >= qty) {
                player.inv[want] = Math.max(0, have - qty);
                const reward = contracts.active.reward;
                player.gold += reward;
                const repGain = clamp(qty, 2, 4);
                player.rep[nowId] = (player.rep[nowId] || 0) + repGain;

                const it = ITEMS.find(x => x.id === want);
                const title = `Contract completed`;
                const text = `Delivered ${qty}× ${it ? it.name : want} → ${nowId} (${contractRewardLabel(reward, repGain)})`;
                showBanner(title, text);

                contracts.active = null;
                scheduleAutoSave();
              }
            }
            // Auto-save on city arrival so position + state always persists when entering a city
            scheduleAutoSave();
            player.lastCityId = nowId;
          }
          return true;
        } catch (e) {
          qaFail(String(e && (e.stack || e.message) || e));
          return false;
        }
      },

      /** QA helper: open the market DOM modal for a city and run a domRender pass.
       *  Returns true if .cr-panel is present in the DOM after the call. */
      openMarketUI: (cityId = 'ashport', mode = 'buy') => {
        try {
          __QA.api.forceCityEntry(cityId);
          ui.marketOpen = true;
          ui.mode = mode;
          ui.marketScroll = 0;
          ui.selection = 0;
          domRender();
          return !!document.querySelector('.cr-panel');
        } catch (e) {
          return false;
        }
      },

      /** QA helper: close any open modal and re-render. */
      closeUI: () => {
        ui.marketOpen = false;
        ui.contractsOpen = false;
        ui.eventOpen = false;
        domRender();
      },

      // ── City walking helpers ──────────────────────────────────────────
      /** Start a click-move to world pixel (wx, wy) — uses A* pathfinding */
      setClickMove: (wx, wy, tapAction = null) => {
        planClickPath(wx, wy, tapAction);
      },

      /** Get current clickMove state */
      getClickMove: () => ({ ...clickMove }),

      /** Start auto-nav to a city by id */
      startAutoNav: (cityId) => {
        startNavTo(cityId);
        return autoNav.active;
      },

      /** Get current autoNav state */
      getAutoNav: () => ({
        active: autoNav.active,
        destCityId: autoNav.destCityId,
        pathIdx: autoNav.pathIdx,
        pathLen: autoNav.path.length,
        path: autoNav.path.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      }),

      /** Get player world position */
      /** Full player + time snapshot for simulation/testing */
      snapState: () => ({
        gold: player.gold,
        rep: { ...player.rep },
        gear: { ...(player.gear || { pack: 0, boots: 0, tool: 0 }) },
        day: time.day,
        capacity: player.capacity,
        speed: player.speed,
        inv: { ...player.inv },
      }),

      /** Direct gear purchase for simulation */
      buyGear: (slot, tier, cost) => {
        if (!player.gear) player.gear = { pack: 0, boots: 0, tool: 0 };
        if (player.gold < cost) return { ok: false, reason: 'insufficient gold' };
        if ((player.gear[slot] ?? 0) >= tier) return { ok: false, reason: 'already owned' };
        player.gold -= cost;
        player.gear[slot] = tier;
        applyGearStats();
        return { ok: true };
      },

      getPlayerPos: () => ({ x: player.x, y: player.y }),

      /** Check if player is currently inside a city (returns city id or null) */
      getPlayerCity: () => currentCity()?.id || null,

      /** Check if tile at (tx,ty) is solid */
      isTileSolid: (tx, ty) => isSolidAt(tx * TILE, ty * TILE),

      /** Check if tile at (tx,ty) is walkable floor */
      isTileWalkable: (tx, ty) => {
        const t = tileAt(tx, ty);
        return !SOLID.has(t);
      },

      /** Get city layout info */
      getCityInfo: (cityId) => {
        const c = getCityById(cityId);
        if (!c) return null;
        return {
          id: c.id, name: c.name,
          x: c.x, y: c.y, w: c.w, h: c.h,
          centerX: (c.x + c.w/2) * TILE,
          centerY: (c.y + c.h/2) * TILE,
          gateX: (c.x + Math.floor(c.w/2)) * TILE,
          gateY: (c.y + c.h) * TILE,
        };
      },

      /** Find first tile of given id inside a city (with 3-tile padding) */
      findTileInCity: (cityId, tileId) => {
        const c = getCityById(cityId);
        if (!c) return null;
        const pad = 3;
        for (let ty = c.y - pad; ty < c.y + c.h + pad; ty++) {
          for (let tx = c.x - pad; tx < c.x + c.w + pad; tx++) {
            if (tileAt(tx, ty) === tileId) return { tx, ty };
          }
        }
        return null;
      },

      /** Run N steps of the click-move (calls step) and return final pos.
       *  Auto-closes any modals that pop up (events, etc.) to avoid blocking movement. */
      walkSteps: (n = 60) => {
        for (let i = 0; i < n; i++) {
          // Close any road events that pop up during travel
          if (ui.eventOpen || ui.marketOpen || ui.contractsOpen) {
            ui.eventOpen = false; ui.marketOpen = false; ui.contractsOpen = false;
          }
          __QA.api.step(1/60);
        }
        return __QA.api.getPlayerPos();
      },
    };
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

  // ── A* PATHFINDING ─────────────────────────────────────────────────────
  // Tile-based A* for click-to-move, runs on demand (not every frame).
  // Returns array of {x,y} tile coords from start to goal (inclusive),
  // or null if no path found within budget.

  function astar(sx, sy, gx, gy, maxNodes = 4000) {
    // Use 1px inset from actual player radius so A* finds paths through gaps
    // the player can navigate with the relaxed click-move collision tolerance.
    const PR = Math.max((player.r || 8) - 1, 1);
    function tileClear(tx, ty) {
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      return !isSolidAt(cx - PR, cy - PR) &&
             !isSolidAt(cx + PR, cy - PR) &&
             !isSolidAt(cx - PR, cy + PR) &&
             !isSolidAt(cx + PR, cy + PR);
    }

    if (!tileClear(gx, gy)) return null; // goal is blocked for player radius

    const key = (x, y) => y * MAP_W + x;
    const heuristic = (x, y) => Math.abs(x - gx) + Math.abs(y - gy); // Manhattan

    // 8-directional neighbors
    const DIRS = [
      [1,0],[-1,0],[0,1],[0,-1],
      [1,1],[1,-1],[-1,1],[-1,-1],
    ];
    const COSTS = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];

    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();
    const open = new Set();

    const startKey = key(sx, sy);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(sx, sy));
    open.add(startKey);

    // Simple priority queue (min-heap would be faster but this is sufficient for 4000 nodes)
    let iterations = 0;
    while (open.size > 0 && iterations++ < maxNodes) {
      // Find min f in open
      let currentKey = null, minF = Infinity;
      for (const k of open) {
        const f = fScore.get(k) ?? Infinity;
        if (f < minF) { minF = f; currentKey = k; }
      }
      if (currentKey === null) break;

      const cx = currentKey % MAP_W;
      const cy = (currentKey / MAP_W) | 0;

      if (cx === gx && cy === gy) {
        // Reconstruct path
        const path = [];
        let k = currentKey;
        while (k !== undefined) {
          const x = k % MAP_W, y = (k / MAP_W) | 0;
          path.push({ x, y });
          k = cameFrom.get(k);
        }
        path.reverse();
        return path;
      }

      open.delete(currentKey);

      for (let d = 0; d < DIRS.length; d++) {
        const [dx, dy] = DIRS[d];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;

        // For diagonals, check both cardinal neighbors to avoid cutting corners
        if (dx !== 0 && dy !== 0) {
          if (!tileClear(cx + dx, cy)) continue;
          if (!tileClear(cx, cy + dy)) continue;
        }
        if (!tileClear(nx, ny)) continue;

        const tentativeG = (gScore.get(currentKey) ?? Infinity) + COSTS[d];
        const nk = key(nx, ny);
        if (tentativeG < (gScore.get(nk) ?? Infinity)) {
          cameFrom.set(nk, currentKey);
          gScore.set(nk, tentativeG);
          fScore.set(nk, tentativeG + heuristic(nx, ny));
          open.add(nk);
        }
      }
    }
    return null; // no path found
  }

  // Path smoothing: remove redundant intermediate waypoints when LOS is clear
  function smoothPath(tilePath) {
    if (!tilePath || tilePath.length <= 2) return tilePath;
    const smooth = [tilePath[0]];
    let i = 0;
    while (i < tilePath.length - 1) {
      let j = tilePath.length - 1;
      while (j > i + 1) {
        if (hasLineClearance(tilePath[i], tilePath[j])) break;
        j--;
      }
      smooth.push(tilePath[j]);
      i = j;
    }
    return smooth;
  }

  // LOS check between two tile positions for path smoothing.
  // Samples N points along the line and checks a fattened corridor
  // (player radius = half a tile) so we don't smooth through gaps
  // the player physically can't fit through.
  function hasLineClearance(a, b) {
    const r = 0.45; // half-tile clearance radius (in tile units)
    const wx0 = a.x + 0.5, wy0 = a.y + 0.5;
    const wx1 = b.x + 0.5, wy1 = b.y + 0.5;
    const dist = Math.hypot(wx1 - wx0, wy1 - wy0);
    if (dist === 0) return true;
    const steps = Math.ceil(dist * 2) + 1; // ~2 samples per tile
    const nx = (wy1 - wy0) / dist; // perpendicular
    const ny = (wx0 - wx1) / dist;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = wx0 + (wx1 - wx0) * t;
      const cy = wy0 + (wy1 - wy0) * t;
      // Check center + both sides of corridor
      if (isSolidAt( cx        * TILE,  cy        * TILE)) return false;
      if (isSolidAt((cx + nx*r)* TILE, (cy + ny*r)* TILE)) return false;
      if (isSolidAt((cx - nx*r)* TILE, (cy - ny*r)* TILE)) return false;
    }
    return true;
  }

  // ── CLICK/TAP-TO-MOVE ──────────────────────────────────────────────────
  // Player moves by clicking/tapping the canvas. A click marker is shown.
  const clickMove = {
    active: false,
    tx: 0,   // target world x (pixels)
    ty: 0,   // target world y (pixels)
    path: [], // A* waypoints [{x,y} tile coords → converted to pixel centers]
    pathIdx: 0,
    markerX: 0, // screen coords for the ripple marker
    markerY: 0,
    markerT: 0, // stateTime when clicked (for fade animation)
    _tapAction: null,
    _tapTarget: null,
  };

  // Plan A* path and store in clickMove
  function planClickPath(worldX, worldY, tapAction = null, tapTarget = null) {
    const startTileX = Math.floor(player.x / TILE);
    const startTileY = Math.floor(player.y / TILE);
    const goalTileX  = Math.floor(worldX / TILE);
    const goalTileY  = Math.floor(worldY / TILE);

    // Snap goal to nearest walkable tile with enough clearance for the player.
    // Use 1px inset to match relaxed click-move collision tolerance.
    const PR = Math.max((player.r || 8) - 1, 1);
    function tileReachable(tx, ty) {
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      return !isSolidAt(cx - PR, cy - PR) &&
             !isSolidAt(cx + PR, cy - PR) &&
             !isSolidAt(cx - PR, cy + PR) &&
             !isSolidAt(cx + PR, cy + PR);
    }

    let gx = goalTileX, gy = goalTileY;
    if (!tileReachable(gx, gy)) {
      // Search in expanding ring for a reachable tile
      outer: for (let r = 1; r <= 6; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const nx = gx + dx, ny = gy + dy;
            if (tileReachable(nx, ny)) {
              gx = nx; gy = ny; break outer;
            }
          }
        }
      }
    }

    const tilePath = astar(startTileX, startTileY, gx, gy, 3000);
    // Skip smoothing — A* already gives a valid tile path; smoothing creates
    // straight-line shortcuts that cut through walls the player can't fit through.
    const smoothed = tilePath;

    if (!smoothed || smoothed.length === 0) {
      // Fall back to direct movement
      clickMove.active = true;
      clickMove.tx = worldX;
      clickMove.ty = worldY;
      clickMove.path = [];
      clickMove.pathIdx = 0;
    } else {
      // Convert tile path to pixel waypoints (center of each tile)
      clickMove.path = smoothed.map(t => ({
        x: (t.x + 0.5) * TILE,
        y: (t.y + 0.5) * TILE,
      }));
      clickMove.pathIdx = 1; // skip tile 0 (player's current tile)
      clickMove.tx = clickMove.path[clickMove.path.length - 1].x;
      clickMove.ty = clickMove.path[clickMove.path.length - 1].y;
      clickMove.active = true;
    }
    clickMove.markerT = stateTime;
    clickMove._tapAction = tapAction;
    clickMove._tapTarget = tapTarget;
  }

  // ── AUTO-NAVIGATE (follow a multi-waypoint road path to a city) ────────
  const autoNav = {
    active: false,
    destCityId: null,
    path: [],       // world-pixel waypoints
    pathIdx: 0,
    destMarkerT: 0,
  };

  function showNavPicker() {
    let el = document.getElementById('cr-nav-picker');
    if (el) { el.remove(); return; }
    el = document.createElement('div');
    el.id = 'cr-nav-picker';
    el.style.cssText = `
      position:fixed; inset:0; z-index:820; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.55); font-family:system-ui,sans-serif;
    `;
    const currentC = currentCity();
    const buttons = world.cities
      .filter(c2 => !currentC || c2.id !== currentC.id)
      .map(c2 => {
        const rules    = CITY_RULES[c2.id] || {};
        const _cpop    = cityPop[c2.id];
        const _tre     = cityTreasury[c2.id];
        const popVal   = _cpop
          ? (_cpop.pop >= 1000 ? (_cpop.pop / 1000).toFixed(1) + 'k' : Math.round(_cpop.pop).toString())
          : '–';
        const treVal   = (_tre && _tre.gold > 0) ? `${_tre.gold}g` : '–';
        const hungerPct= _cpop ? Math.round(_cpop.hunger * 100) : 0;
        const hungerCol= hungerPct >= 60 ? '#f87171' : hungerPct >= 30 ? '#fbbf24' : '#86efac';
        return `
          <button data-city="${c2.id}" style="
            display:flex; flex-direction:column; align-items:flex-start;
            background:#1a1408; border:1px solid #5a4a20; border-radius:8px;
            padding:10px 14px; cursor:pointer; color:#e0cfa0; text-align:left;
            width:100%; margin-bottom:6px; transition:border-color 0.15s;
          ">
            <span style="font-size:14px;font-weight:700;color:#f0d080">📍 ${htmlEscape(c2.name)}</span>
            <span style="font-size:11px;color:#888;margin-top:2px">${htmlEscape(rules.vibe || '')}</span>
            <span style="font-size:11px;color:#a09060;margin-top:4px">
              👥 Pop: <b style="color:#cfe6ff">${popVal}</b>
              &nbsp;·&nbsp;
              💰 Treasury: <b style="color:#cfe6ff">${treVal}</b>
              &nbsp;·&nbsp;
              Hunger: <b style="color:${hungerCol}">${hungerPct}%</b>
            </span>
          </button>`;
      }).join('');

    el.innerHTML = `
      <div style="background:#100e08;border:2px solid #8b6914;border-radius:12px;padding:16px;width:min(300px,90vw);color:#e0cfa0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-size:15px;font-weight:700">🗺️ Navigate To</span>
          <button id="cr-nav-close" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer">✕</button>
        </div>
        ${buttons}
        <div style="color:#555;font-size:11px;text-align:center;margin-top:6px">Or tap a city on the minimap</div>
      </div>`;

    el.querySelector('#cr-nav-close').onclick = () => el.remove();
    el.addEventListener('click', ev => { if (ev.target === el) el.remove(); });
    el.querySelectorAll('[data-city]').forEach(btn => {
      btn.addEventListener('pointerdown', ev => {
        ev.stopPropagation();
        startNavTo(btn.dataset.city);
        el.remove();
        _fabLastKey = ''; // force FAB refresh
      });
    });
    document.body.appendChild(el);
  }

  function startNavTo(cityId) {
    const fromCity = currentCity();
    const fromId = fromCity ? fromCity.id : _nearestCityId();
    if (!fromId || fromId === cityId) {
      toast('Already there.', 1.5);
      return;
    }
    const path = buildTraderPath(fromId, cityId);
    if (!path || path.length === 0) {
      toast('No route found.', 1.5);
      return;
    }

    // Cancel any existing nav cleanly before starting new one
    autoNav.active = false;
    clickMove.active = false;

    // If player is inside the origin city, snap them to the gate exit tile.
    // Cities have internal obstacles that block straight-south navigation.
    // The gate exit (path[0]) is just outside the south wall — safe to warp to.
    if (fromCity) {
      const gateExit = path[0];
      if (gateExit) {
        player.x = gateExit.x;
        player.y = gateExit.y;
      }
    }

    autoNav.active = true;
    autoNav.destCityId = cityId;
    autoNav.path = path;
    autoNav.pathIdx = 1; // skip gate exit (already there after snap)
    autoNav.destMarkerT = stateTime;
    // Reset ALL per-trip state so a re-navigate never resumes old tracking
    autoNav._blockedFrames = 0;
    // _startX/_startY must be set AFTER the snap so minTravelMet counts from new position
    autoNav._startX = player.x;
    autoNav._startY = player.y;
    autoNav._minTravelPx = 40; // reduced: 40px is enough to confirm we left the origin gate
    clickMove.active = false; // cancel any manual click-move
    const dest = getCityById(cityId);
    toast(`Navigating to ${dest?.name || cityId}…`, 2);
  }

  function _nearestCityId() {
    let best = null, bestD = Infinity;
    for (const c of world.cities) {
      const cx = (c.x + c.w/2) * TILE, cy = (c.y + c.h/2) * TILE;
      const d = Math.hypot(player.x - cx, player.y - cy);
      if (d < bestD) { bestD = d; best = c.id; }
    }
    return best;
  }

  function updateAutoNav(dt) {
    if (!autoNav.active) return;
    if (ui.marketOpen || ui.contractsOpen || ui.eventOpen) return;

    // Manual input cancels auto-nav
    if (isDown('ArrowUp') || isDown('ArrowDown') ||
        isDown('ArrowLeft') || isDown('ArrowRight') ||
        isDown('KeyW') || isDown('KeyA') || isDown('KeyS') || isDown('KeyD')) {
      autoNav.active = false;
      return;
    }

    // Track distance traveled so we don't fire arrival check before leaving origin
    if (!autoNav._startX) { autoNav._startX = player.x; autoNav._startY = player.y; }
    const traveledPx = Math.hypot(player.x - autoNav._startX, player.y - autoNav._startY);
    const minTravelMet = traveledPx >= (autoNav._minTravelPx || 80);

    // Check if already inside the destination city — done!
    const destC = getCityById(autoNav.destCityId);
    if (destC && minTravelMet) {
      const px = player.x / TILE, py = player.y / TILE;
      // Inside city bounds OR within 4 tiles of the south gate wall (wider margin)
      const nearGate = px >= destC.x - 1 && px <= destC.x + destC.w + 1 &&
                       py >= destC.y + destC.h - 1 && py <= destC.y + destC.h + 5;
      const insideCity = px >= destC.x && px < destC.x + destC.w && py >= destC.y && py < destC.y + destC.h;
      if (insideCity || nearGate) {
        // Snap to city center if not already inside
        if (!insideCity) {
          player.x = (destC.x + destC.w / 2) * TILE;
          player.y = (destC.y + destC.h / 2) * TILE;
        }
        autoNav.active = false;
        toast(`Arrived at ${destC.name}.`, 2);
        return;
      }
    }

    if (autoNav.pathIdx >= autoNav.path.length) {
      // Path exhausted — snap player into destination city
      if (destC) {
        player.x = (destC.x + destC.w / 2) * TILE;
        player.y = (destC.y + destC.h / 2) * TILE;
        toast(`Arrived at ${destC.name}.`, 2);
      }
      autoNav.active = false;
      return;
    }

    const wp = autoNav.path[autoNav.pathIdx];
    const dx = wp.x - player.x;
    const dy = wp.y - player.y;
    const dist = Math.hypot(dx, dy);

    // Arrival threshold — generous so player flows smoothly between waypoints
    if (dist < TILE * 2) {
      autoNav.pathIdx++;
      return;
    }

    const nx = dx / dist, ny = dy / dist;
    const stepX = nx * player.speed * dt;
    const stepY = ny * player.speed * dt;
    player.facing = { x: nx, y: ny };

    // Wall-slide movement
    const canX = !isSolidAt(player.x + stepX - player.r, player.y - player.r) &&
                 !isSolidAt(player.x + stepX + player.r, player.y - player.r) &&
                 !isSolidAt(player.x + stepX - player.r, player.y + player.r) &&
                 !isSolidAt(player.x + stepX + player.r, player.y + player.r);
    const canY = !isSolidAt(player.x - player.r, player.y + stepY - player.r) &&
                 !isSolidAt(player.x + player.r, player.y + stepY - player.r) &&
                 !isSolidAt(player.x - player.r, player.y + stepY + player.r) &&
                 !isSolidAt(player.x + player.r, player.y + stepY + player.r);


    if (canX) player.x += stepX;
    if (canY) player.y += stepY;

    // If fully blocked for too long, skip waypoints aggressively to escape
    if (!canX && !canY) {
      autoNav._blockedFrames = (autoNav._blockedFrames || 0) + 1;
      if (autoNav._blockedFrames > 20) {
        // Skip up to 3 waypoints at once to get past obstacle clusters
        autoNav.pathIdx = Math.min(autoNav.pathIdx + 3, autoNav.path.length - 1);
        autoNav._blockedFrames = 0;
      }
    } else {
      autoNav._blockedFrames = 0;
    }

    player.x = clamp(player.x, TILE, MAP_W*TILE - TILE);
    player.y = clamp(player.y, TILE, MAP_H*TILE - TILE);
  }

  function drawNavPath() {
    if (!autoNav.active || autoNav.path.length === 0) return;
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(251,191,36,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x - camera.x, player.y - camera.y);
    for (let i = autoNav.pathIdx; i < autoNav.path.length; i++) {
      const wp = autoNav.path[i];
      ctx.lineTo(wp.x - camera.x, wp.y - camera.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Destination marker (pulsing ring)
    const dest = autoNav.path[autoNav.path.length - 1];
    const pulse = 0.5 + 0.5 * Math.sin(stateTime * 0.004);
    ctx.strokeStyle = `rgba(251,191,36,${(0.5 + pulse * 0.4).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(dest.x - camera.x, dest.y - camera.y, 12 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Disable long-press context menu globally (mobile browsers).
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(e.code)) e.preventDefault();

    // Save/Load shortcuts (global, work even in modals)
    if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveGame();
      toast('Game saved.', 1.5);
      scheduleAutoSave();
    }
    if (e.code === 'KeyL' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (loadGame()) { /* toast already shown in loadGame */ }
      else toast('No save found.', 1.5);
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
      if (T.buy && sx >= T.buy.x && sx <= T.buy.x + T.buy.w && sy >= T.buy.y && sy <= T.buy.y + T.buy.h) {
        ui.mode = 'buy';
        toast('BUY', 0.7);
        return true;
      }
      if (T.sell && sx >= T.sell.x && sx <= T.sell.x + T.sell.w && sy >= T.sell.y && sy <= T.sell.y + T.sell.h) {
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
      // mobile: tap button area to trade
      if (IS_MOBILE && L.cardPad != null) {
        const rowY = L.y + vi * L.rowH;
        const cardY = rowY + L.cardPad;
        const btnY = cardY + L.cardH - L.btnH - L.btnPad;
        const btnX = L.x + L.btnInset;
        const btnW = L.w - L.btnInset * 2;
        if (sy >= btnY && sy <= btnY + L.btnH && sx >= btnX && sx <= btnX + btnW) {
          ui.selection = i;
          marketTryTrade(i, 1);
          return true;
        }
      }
      ui.selection = i;
      toast('Selected', 0.6);
      return true;
    }
    return false;
  }
// Touch UI -> virtual keys

// Mobile HUD tap: global capture (Safari reliability)
if (IS_MOBILE && !window.__npcGlobalTapListener) {
  window.__npcGlobalTapListener = true;
  window.addEventListener('touchstart', (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    handleGlobalHudTap(t.clientX, t.clientY, e);
  }, { passive: false, capture: true });
  window.addEventListener('pointerdown', (e) => {
    handleGlobalHudTap(e.clientX, e.clientY, e);
  }, { passive: false, capture: true });
}

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

function handleMobileHudTap(sx, sy) {
  if (!IS_MOBILE) return false;
  if (ui.marketOpen || ui.eventOpen || ui.contractsOpen || ui.bankOpen || ui.innOpen || ui.guildOpen || ui.warehouseOpen || ui.buildingDonateOpen) return false;
  const T = ui._hudCityTap;
  if (T && sx >= T.x && sx <= T.x + T.w && sy >= T.y && sy <= T.y + T.h) {
    ui.mobileHudExpanded = !ui.mobileHudExpanded;
    return true;
  }
  const topH = ui._hudTopH || 0;
  if (topH && sy <= topH && sx <= VIEW_W * 0.7) {
    ui.mobileHudExpanded = !ui.mobileHudExpanded;
    return true;
  }
  return false;
}

function handleGlobalHudTap(clientX, clientY, e) {
  if (!IS_MOBILE) return false;
  if (ui.marketOpen || ui.eventOpen || ui.contractsOpen || ui.bankOpen || ui.innOpen || ui.guildOpen || ui.warehouseOpen || ui.buildingDonateOpen) return false;
  const now = performance.now();
  if (now - (ui._hudTapLastTs || 0) < 280) return false;
  ui._hudTapLastTs = now;
  const r = canvas.getBoundingClientRect();
  const sx = (clientX - r.left) * (VIEW_W / r.width);
  const sy = (clientY - r.top) * (VIEW_H / r.height);
  const hit = handleMobileHudTap(sx, sy);
  if (hit) {
    e?.preventDefault?.();
    return true;
  }
  return false;
}


  // Canvas touch drag for scrolling lists (mobile popups)
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (VIEW_W / r.width);
    const sy = (e.clientY - r.top) * (VIEW_H / r.height);

    // ── HUD taps ────────────────────────────────────────────────────────
    if (handleMobileHudTap(sx, sy)) { e.preventDefault(); return; }

    // ── Minimap tap → navigate to city ─────────────────────────────────
    const mm = ui._minimapRect;
    if (mm && sx >= mm.x && sx <= mm.x + mm.w && sy >= mm.y && sy <= mm.y + mm.h) {
      // Convert tap to map tile coords
      const mapFx = (sx - mm.x) / mm.w;
      const mapFy = (sy - mm.y) / mm.h;
      const mapTileX = mapFx * MAP_W;
      const mapTileY = mapFy * MAP_H;
      // Find nearest city to tap
      let bestCity = null, bestDist = 999;
      for (const c2 of world.cities) {
        const cx2 = c2.x + c2.w/2, cy2 = c2.y + c2.h/2;
        const d = Math.hypot(cx2 - mapTileX, cy2 - mapTileY);
        if (d < bestDist) { bestDist = d; bestCity = c2; }
      }
      if (bestCity && bestDist < 8) {
        startNavTo(bestCity.id);
        e.preventDefault(); return;
      }
    }

    // HUD Save/Load buttons (desktop)
    if (!IS_MOBILE && sy <= HUD_H) {
      const S = ui._btnSave;
      const Lb = ui._btnLoad;
      if (S && sx >= S.x && sx <= S.x + S.w && sy >= S.y && sy <= S.y + S.h) {
        saveGame(); ui._lastSavedDay = time.day; toast('Game saved.', 1.6);
        e.preventDefault(); return;
      }
      if (Lb && sx >= Lb.x && sx <= Lb.x + Lb.w && sy >= Lb.y && sy <= Lb.y + Lb.h) {
        if (!loadGame()) toast('No save found.', 1.6);
        e.preventDefault(); return;
      }
    }

    // ── Cancel auto-nav on any canvas tap ──────────────────────────────
    if (autoNav.active && !ui.marketOpen && !ui.eventOpen && !ui.contractsOpen) {
      autoNav.active = false;
    }

    // ── Modal scroll (market/event/contracts) ──────────────────────────
    if (ui.marketOpen || ui.eventOpen || ui.contractsOpen) {
      if (handleMarketTap(sx, sy)) { e.preventDefault(); return; }
      const kind = ui.marketOpen ? 'market' : 'event';
      const L2 = kind === 'market' ? ui._marketList : ui._eventList;
      if (L2 && sx >= L2.x && sx <= L2.x + L2.w && sy >= L2.y && sy <= L2.y + L2.h) {
        ui._drag = { kind, lastY: sy, acc: 0 };
        canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault(); return;
      }
      if (ui.eventOpen) {
        const E = ui._eventList;
        if (E && sx >= E.x && sx <= E.x + E.w && sy >= E.y && sy <= E.y + E.h) {
          ui._drag = { kind: 'event', lastY: sy, acc: 0 };
          canvas.setPointerCapture?.(e.pointerId);
          e.preventDefault(); return;
        }
      }
      e.preventDefault(); return; // don't click-move when modal open
    }

    // ── Click/tap-to-move + smart tap detection ────────────────────────
    // Convert screen to world coords
    const worldX = sx + camera.x;
    const worldY = sy + camera.y;

    // Check if tap is on an NPC (interact)
    const nearbyNpc = findNearestNpc(worldX, worldY, NPC_INTERACT_RADIUS * 2);
    if (nearbyNpc) {
      const ndx = nearbyNpc.x - worldX, ndy = nearbyNpc.y - worldY;
      if (Math.hypot(ndx, ndy) < NPC_INTERACT_RADIUS * 2) {
        clickMove.markerX = sx; clickMove.markerY = sy;
        planClickPath(nearbyNpc.x, nearbyNpc.y, 'npc', nearbyNpc.id);
        e.preventDefault(); return;
      }
    }

    // Check if tap is on an AI trader
    const nearbyTrader = findNearestTrader(worldX, worldY);
    if (nearbyTrader) {
      openTraderUI(nearbyTrader);
      e.preventDefault(); return;
    }

    // Check tile at tap location
    const tapTileX = Math.floor(worldX / TILE);
    const tapTileY = Math.floor(worldY / TILE);
    let tapTile = tileAt(tapTileX, tapTileY);

    // Building tap-to-interact: open immediately if close enough + in city,
    // otherwise walk to the tile first then open on arrival.
    const TAP_BUILDING_ACTIONS = { 6: 'market', 12: 'contracts', 7: 'inn', 8: 'warehouse', 13: 'bank', 14: 'inn', 15: 'guild', 16: 'vacant' };

    // If the player tapped a wall tile (3), scan the 5×5 neighbourhood for the
    // nearest building interior tile so tapping on a building's visible art still works.
    let resolvedTileX = tapTileX, resolvedTileY = tapTileY;
    if (tapTile === 3 || TAP_BUILDING_ACTIONS[tapTile] === undefined) {
      let bestDist = 9999, bestTile = null;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = tapTileX + dx, ny = tapTileY + dy;
          const t = tileAt(nx, ny);
          if (TAP_BUILDING_ACTIONS[t] !== undefined) {
            const d = Math.abs(dx) + Math.abs(dy);
            if (d < bestDist) { bestDist = d; bestTile = { tx: nx, ty: ny, t }; }
          }
        }
      }
      if (bestTile && bestDist <= 4) {
        tapTile = bestTile.t;
        resolvedTileX = bestTile.tx;
        resolvedTileY = bestTile.ty;
      }
    }

    if (TAP_BUILDING_ACTIONS[tapTile] !== undefined) {
      const action = TAP_BUILDING_ACTIONS[tapTile];
      const playerTX = Math.floor(player.x / TILE), playerTY = Math.floor(player.y / TILE);
      const distTiles = Math.max(Math.abs(resolvedTileX - playerTX), Math.abs(resolvedTileY - playerTY));
      const c = currentOrNearestCity(8);
      if (c && distTiles <= 6) {
        // Close enough — open immediately
        if (action === 'market') { ui.contractsOpen = false; ui.marketOpen = true; ui.selection = 0; ui.mode = 'buy'; toast(`Market opened in ${c.name}`, 1.8); }
        else if (action === 'contracts') { ui.marketOpen = false; ui.contractsOpen = true; ui.contractsSel = 0; ui.contractsCityId = c.id; toast('Contracts board opened', 1.8); }
        else if (action === 'bank') { ui.bankOpen = true; ui.bankTab = 'deposit'; domEnsureOpen(); dom.key = ''; domRender(); toast(`Bank of ${c.name} opened.`, 2); }
        else if (action === 'inn') { ui.innOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast(`${c.name} Inn.`, 2); }
        else if (action === 'guild') { ui.guildOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast('Merchants Guild.', 2); }
        else if (action === 'warehouse') { ui.warehouseOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast('Warehouse opened.', 2); }
        else if (action === 'vacant') { showBuildingDonateModal(c.id, resolvedTileX, resolvedTileY); }
      } else {
        // Walk to building interior tile, open on arrival
        clickMove.markerX = sx; clickMove.markerY = sy;
        planClickPath((resolvedTileX + 0.5) * TILE, (resolvedTileY + 0.5) * TILE, action);
      }
      e.preventDefault(); return;
    }

    // Default: walk to tapped position (ignore solid tiles)
    if (tapTile !== 3 && tapTile !== 2) {
      clickMove.markerX = sx; clickMove.markerY = sy;
      planClickPath(worldX, worldY);
    }
    e.preventDefault();

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
    if (!ui.marketOpen && !ui.eventOpen && !ui.contractsOpen) {
      const t = e.touches && e.touches[0];
      if (!t) return;
      const { sx, sy } = getTouchPos(t);
      if (handleMobileHudTap(sx, sy)) {
        e.preventDefault();
        return;
      }

      return;
    }

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
  // 0 grass, 1 road, 2 water, 3 wall/rock, 4 city-floor, 5 gate, 6 market, 7 shrine, 8 camp, 9 ruins, 10 forest, 11 swamp, 12 contracts, 13 cache, 14 inn-alt, 15 guildhall, 16 vacant-lot (walkable)
  const SOLID = new Set([2, 3]);

  // Live reference to the map array — set by makeMap(), used by buildSlotOnMap()
  let mapData = null;

  function makeMap() {
    const m = new Uint8Array(MAP_W * MAP_H);
    // base grass
    for (let i = 0; i < m.length; i++) m[i] = 0;

    // North river (spans map east of Valdenmere, rows y=6-8)
    for (let y = 6; y < 9; y++) {
      for (let x = 38; x < MAP_W-1; x++) m[y * MAP_W + x] = 2;
    }
    // North river bridge at x:66-70 (road crosses here for Valdenmere→Ironholt)
    for (let y = 6; y < 9; y++) {
      for (let x = 66; x < 71; x++) m[y * MAP_W + x] = 1;
    }

    // South river (crosses near Crosshaven)
    for (let y = 60; y < 63; y++) {
      for (let x = 0; x < 52; x++) m[y * MAP_W + x] = 2;
    }
    // South river bridge at x:28-32
    for (let y = 60; y < 63; y++) {
      for (let x = 26; x < 32; x++) m[y * MAP_W + x] = 1;
    }

    // rocks/walls border
    for (let x = 0; x < MAP_W; x++) { m[x] = 3; m[(MAP_H-1) * MAP_W + x] = 3; }
    for (let y = 0; y < MAP_H; y++) { m[y * MAP_W] = 3; m[y * MAP_W + (MAP_W-1)] = 3; }

    // roads between cities
    const carveRoad = (x0,y0,x1,y1) => {
      // Carve 3-wide road so player (r=8px, TILE=16px) can navigate cleanly.
      // Horizontal leg: widen north+south. Vertical leg: widen east+west.
      // Paint a 3×3 patch at corners to avoid gaps at L-turns.
      const paint3h = (tx, ty) => { // horizontal — widen N/S
        for (let dy = -1; dy <= 1; dy++) {
          const ny = ty + dy;
          if (ny >= 0 && ny < MAP_H) m[ny*MAP_W + tx] = 1;
        }
      };
      const paint3v = (tx, ty) => { // vertical — widen E/W
        for (let dx = -1; dx <= 1; dx++) {
          const nx = tx + dx;
          if (nx >= 0 && nx < MAP_W) m[ty*MAP_W + nx] = 1;
        }
      };
      const paint3x3 = (tx, ty) => { // junction patch
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = tx+dx, ny = ty+dy;
          if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H) m[ny*MAP_W+nx] = 1;
        }
      };
      let x=x0, y=y0;
      while (x !== x1) { paint3h(x, y); x += x < x1 ? 1 : -1; }
      while (y !== y1) { paint3v(x, y); y += y < y1 ? 1 : -1; }
      paint3x3(x, y); // endpoint / corner — fill 3×3 to close gap
    };

    // ── CITIES ──────────────────────────────────────────────────────────────
    // Valdenmere: large capital (NW)
    const cityA = { id:'valdenmere', name:'Valdenmere', x: 8,  y: 8,  w: 28, h: 20 };
    // Ashport: medium fishing port (SE)
    const cityB = { id:'ashport',    name:'Ashport',    x: 96, y: 55, w: 24, h: 16 };
    // Crosshaven: small crossroads village (S-center)
    const cityC = { id:'crosshaven', name:'Crosshaven', x: 55, y: 65, w: 14, h: 10 };
    // Ironholt: medium mining town (NE)
    const cityD = { id:'ironholt',   name:'Ironholt',   x: 105, y: 14, w: 20, h: 14 };

    // Helper: place a building block — outer wall ring (tile 3) with interior tile
    // bx,by = top-left tile of block, bw,bh = size including walls
    // interiorTile = tile to fill inside (4=floor, 6=market, 7=inn, 8=warehouse, 12=contracts)
    const placeBuilding = (bx, by, bw, bh, interiorTile = 4, doorSide = 'south') => {
      // Walls (ring)
      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const isWall = dx === 0 || dx === bw-1 || dy === 0 || dy === bh-1;
          m[(by+dy)*MAP_W + (bx+dx)] = isWall ? 3 : interiorTile;
        }
      }
      // Door: clear one wall tile to floor on requested side
      if (doorSide === 'south' && bh > 1) m[(by+bh-1)*MAP_W + (bx + Math.floor(bw/2))] = 4;
      if (doorSide === 'north' && bh > 1) m[by*MAP_W + (bx + Math.floor(bw/2))] = 4;
      if (doorSide === 'east') m[(by + Math.floor(bh/2))*MAP_W + (bx+bw-1)] = 4;
      if (doorSide === 'west') m[(by + Math.floor(bh/2))*MAP_W + bx] = 4;
    };

    // Helper: carve a horizontal or vertical road stripe inside city
    const carveStreet = (x0, y0, x1, y1) => {
      // Only overwrite city floor (4) — don't carve through walls
      let x=x0, y=y0;
      while (x !== x1 || y !== y1) {
        if (m[y*MAP_W+x] === 4 || m[y*MAP_W+x] === 9) m[y*MAP_W+x] = 1;
        if (x !== x1) x += x < x1 ? 1 : -1;
        else y += y < y1 ? 1 : -1;
      }
      m[y*MAP_W+x] = 1;
    };

    // Helper: paint a plaza (cobblestone) area
    const paintPlaza = (px, py, pw, ph) => {
      for (let dy = 0; dy < ph; dy++)
        for (let dx = 0; dx < pw; dx++)
          if (m[(py+dy)*MAP_W+(px+dx)] === 4) m[(py+dy)*MAP_W+(px+dx)] = 9;
    };

    const paintCity = (c) => {
      const x0=c.x, y0=c.y, W=c.w, H=c.h;

      // 1. Fill with city floor
      for (let yy=y0; yy<y0+H; yy++)
        for (let xx=x0; xx<x0+W; xx++)
          m[yy*MAP_W+xx] = 4;

      // 2. Outer perimeter wall
      for (let xx=x0; xx<x0+W; xx++) {
        m[(y0-1)*MAP_W+xx] = 3;
        m[(y0+H)*MAP_W+xx] = 3;
      }
      for (let yy=y0; yy<y0+H; yy++) {
        m[yy*MAP_W+(x0-1)] = 3;
        m[yy*MAP_W+(x0+W)] = 3;
      }

      // 3. Gate (south center, wide) — 7 tiles wide to match 3-wide road + margin
      const gx = x0 + Math.floor(W/2);
      const gy = y0 + H;
      for (let ox=-3; ox<=3; ox++) {
        m[gy*MAP_W+(gx+ox)] = 5;           // gate tile (walkable)
        m[(gy+1)*MAP_W+(gx+ox)] = 1;       // road tile immediately outside
        m[(gy+2)*MAP_W+(gx+ox)] = 1;       // extra buffer row to join road network
      }

      // 4. LAYOUT by city identity
      if (c.id === 'valdenmere') {
        // Capital city: main N-S avenue + E-W cross street
        // Districts: NW=residential, NE=barracks/manor, SW=warehouse/trade, SE=residential
        // Center: grand town square with market, contracts, guildhall facing it
        const msX = gx;                            // main N-S avenue (gate center)
        const csY = y0 + Math.floor(H * 0.48);    // E-W cross street near mid

        carveStreet(msX, y0, msX, y0+H-1);
        carveStreet(x0, csY, x0+W-1, csY);

        // ── Town square (center of city, where streets cross) ──
        paintPlaza(msX-4, csY-3, 9, 7);   // large cobble square
        m[csY*MAP_W + (msX-5)] = 6;       // market stall west of square
        m[csY*MAP_W + (msX+5)] = 6;       // market stall east of square
        m[(csY-4)*MAP_W + msX] = 6;       // market stall north
        m[(csY-2)*MAP_W + msX] = 12;      // contracts board in square

        // ── Guildhall (faces south side of square — NE of crossing) ──
        placeBuilding(msX+2, csY-5, 5, 3, 15, 'south');

        // ── Bank (NW of square, easy access from main road) ──
        placeBuilding(x0+3, csY-6, 4, 4, 13, 'east');

        // ── Inn/Tavern (NW quarter, near bank) ──
        placeBuilding(x0+3, y0+2, 5, 4, 7, 'east');

        // ── Warehouse district (SW quarter, away from center) ──
        placeBuilding(x0+3, csY+3, 6, 3, 8, 'north');

        // ── Residence NE quarter ──
        placeBuilding(msX+3, y0+2, 5, 4, 4, 'south');

        // ── Barracks/manor SE quarter ──
        placeBuilding(msX+3, csY+3, 5, 4, 4, 'west');

      } else if (c.id === 'ashport') {
        // Port city: gate south → main road north; dock road east-west at south
        // Districts: north=residential/tavern, mid=market square, south=docks+warehouses
        const dockY = y0 + Math.floor(H * 0.70);   // dock road
        const mktY  = y0 + Math.floor(H * 0.40);   // market square row

        carveStreet(gx, y0, gx, y0+H-1);           // main N-S road from gate
        carveStreet(x0, dockY, x0+W-1, dockY);     // dock road E-W

        // ── Market square (mid-city, on main road) ──
        paintPlaza(gx-3, mktY-2, 7, 5);
        m[mktY*MAP_W+(gx-4)] = 6;
        m[mktY*MAP_W+(gx+4)] = 6;
        m[mktY*MAP_W+gx] = 12;

        // ── Inn/Tavern (NW, large for sailors) ──
        placeBuilding(x0+2, y0+2, 5, 5, 7, 'east');

        // ── Residence block NE ──
        placeBuilding(gx+3, y0+2, 5, 4, 4, 'south');

        // ── Bank (east of market square) ──
        placeBuilding(gx+3, mktY+1, 4, 3, 13, 'west');

        // ── Guild near docks (trade guild) ──
        placeBuilding(x0+2, dockY-5, 4, 3, 15, 'east');

        // ── Dock warehouses (south, generous gap between them) ──
        placeBuilding(x0+2, dockY+1, 5, 3, 8, 'north');
        placeBuilding(gx+3, dockY+1, 5, 3, 8, 'north');

      } else if (c.id === 'crosshaven') {
        // Tiny village: one N-S road only. Very open. A handful of buildings.
        const mktY = y0 + Math.floor(H * 0.45);   // market in middle

        carveStreet(gx, y0, gx, y0+H-1);

        // ── Small plaza + market (center of village) ──
        paintPlaza(gx-1, mktY-1, 3, 3);
        m[mktY*MAP_W+(gx-2)] = 6;
        m[mktY*MAP_W+gx] = 12;

        // ── Inn/Tavern (west side, near top — first building travelers see) ──
        placeBuilding(x0+1, y0+2, 4, 3, 7, 'east');

        // ── Warehouse (east side, small) ──
        placeBuilding(gx+2, y0+2, 3, 3, 8, 'west');

        // ── Bank (east side, south of warehouse) ──
        placeBuilding(gx+2, mktY+2, 3, 3, 13, 'north');

        // ── Inn building (west side, south section) ──
        placeBuilding(x0+1, mktY+2, 3, 3, 14, 'east');

        // No guild — village too small

      } else if (c.id === 'ironholt') {
        // Mining town: industrial feel
        // Districts: NW=foreman HQ, NE=workers lodge, S=ore yard+warehouses, center=market/contracts
        const yardY = y0 + Math.floor(H * 0.58);   // ore yard road
        const mktY  = y0 + Math.floor(H * 0.38);   // market intersection

        carveStreet(gx, y0, gx, y0+H-1);           // main N-S road
        carveStreet(x0, yardY, x0+W-1, yardY);     // yard road E-W

        // ── Market + contracts at road junction ──
        paintPlaza(gx-2, mktY-2, 5, 4);
        m[mktY*MAP_W+(gx-3)] = 6;
        m[mktY*MAP_W+gx] = 12;

        // ── Foreman HQ (NW, 5×4) ──
        placeBuilding(x0+2, y0+2, 5, 4, 4, 'east');

        // ── Workers lodge / Inn (NE, 5×4) ──
        placeBuilding(gx+2, y0+2, 5, 4, 7, 'west');

        // ── Bank (east of market, between lodge and plaza) ──
        placeBuilding(gx+2, mktY+1, 4, 3, 13, 'west');

        // ── Guild (west of main road, mid section) ──
        placeBuilding(x0+2, mktY+1, 4, 3, 15, 'east');

        // ── Ore yard: two large warehouses, wide open space between ──
        placeBuilding(x0+2, yardY+1, 6, 3, 8, 'north');
        placeBuilding(gx+3, yardY+1, 6, 3, 8, 'north');
      }

      return { gx, gy };
    };

    const gateA = paintCity(cityA);
    const gateB = paintCity(cityB);
    const gateC = paintCity(cityC);
    const gateD = paintCity(cityD);

    // ── ROAD NETWORK ────────────────────────────────────────────────────────
    // Design targets (1 day = 1200px = 75 tiles at TILE=16):
    //   Valdenmere ↔ Ironholt  : ~2.1 days  (157 tiles)
    //   Valdenmere ↔ Crosshaven: ~1.6 days  (120 tiles)
    //   Crosshaven ↔ Ashport   : ~1.5 days  (112 tiles)
    //   Ironholt   ↔ Ashport   : ~2.4 days  (180 tiles, long loop south)
    //   Valdenmere ↔ Ashport   : ~3.1 days  (via Crosshaven: 232 tiles)
    //   Crosshaven ↔ Ironholt  : ~2.6 days  (via shared roads: 195 tiles)

    // ── Valdenmere → Ironholt (N highway via bridge) ────────────────────
    // Gate(22,28) → junction(30,30) → east junction(68,30) → north(68,8) → east(115,8) → Ironholt
    carveRoad(gateA.gx, gateA.gy+1, 30, 30);    // 8+2 = 10 tiles
    carveRoad(30, 30, 68, 30);                    // 38 tiles
    carveRoad(68, 30, 68, 8);                     // 22 tiles N (crosses river via bridge)
    carveRoad(68, 8, 115, 8);                     // 47 tiles E
    carveRoad(115, 8, gateD.gx, gateD.gy+1);     // ~13 tiles → total ~130 tiles = 1.73 days

    // ── Valdenmere → Crosshaven (W road south) ──────────────────────────
    // Same junction(30,30) → south(30,55) → east to Crosshaven gate
    carveRoad(30, 30, 30, 55);                    // 25 tiles S
    carveRoad(30, 55, gateC.gx, gateC.gy+1);     // 32+10 = ~42 tiles → segment = 67 tiles
    // Total from Valdenmere: 10+67 = 77 tiles = 1.03 days — add extra loop for realism
    // Extra: road winds through valley before Crosshaven
    carveRoad(30, 55, 48, 55);                    // extra east segment (18 tiles)
    carveRoad(48, 55, 48, 70);                    // south (15 tiles)
    carveRoad(48, 70, gateC.gx, gateC.gy+1);     // east to gate (~16 tiles)
    // Total V→CH: 10+25+18+15+16 = 84 tiles = 1.12 days

    // ── Crosshaven → Ashport (S-E road, longer scenic route) ────────────
    // Gate(62,75) → south(62,82) → E loop → Ashport
    carveRoad(gateC.gx, gateC.gy+1, gateC.gx, 82);  // 7 tiles S
    carveRoad(gateC.gx, 82, 80, 82);                  // 18 tiles E
    carveRoad(80, 82, 80, 72);                         // 10 tiles N
    carveRoad(80, 72, gateB.gx, gateB.gy+1);          // 28+7 tiles = 35 tiles → total CH→A: 70 tiles = 0.93 days

    // ── Ironholt → Ashport (long loop east+south, NO shortcut) ─────────
    // Forces traders to travel far — long haul route for big margins
    // Gate(115,28) → SE(130,28) → south(130,55) → west(108,55) → south to Ashport
    carveRoad(gateD.gx, gateD.gy+1, 130, gateD.gy+1);  // E 15 tiles
    carveRoad(130, gateD.gy+1, 130, 55);                 // S ~27 tiles
    carveRoad(130, 55, gateB.gx+4, 55);                  // W ~18 tiles
    carveRoad(gateB.gx+4, 55, gateB.gx+4, gateB.gy+1);  // S ~16 tiles → total: ~76 tiles = 1.01 days

    // Detour cache route in NE highlands (off main roads)
    carveRoad(74, 14, 92, 26);
    carveRoad(92, 26, 104, 40);

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

    // Forests and swamp — spread across the new larger map
    paintPatch(46, 38, 14, 10, 0.85);  // central forest
    paintPatch(82, 72, 14, 10, 0.80);  // SE forest
    paintPatch(18, 50, 10, 10, 0.78);  // W forest
    paintPatch(90, 36, 10, 11, 0.75);  // NE swamp
    paintPatch(44, 70, 8, 11, 0.80);   // S swamp near Crosshaven

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

        // avoid all city rectangles (with padding)
        const inCity = [cityA, cityB, cityC, cityD].some(c =>
          x >= c.x-3 && x < c.x + c.w + 3 && y >= c.y-3 && y < c.y + c.h + 3);
        if (inCity) continue;

        m[i] = wantId;
        return;
      }
    };

    for (let i = 0; i < 8; i++) placePOI(7);
    for (let i = 0; i < 6; i++) placePOI(8);
    for (let i = 0; i < 4; i++) placePOI(9);

    // Place a few cache POIs (tile 13), preferring the detour region so the longer route can pay off.
    const placeCache = (tries=1200) => {
      for (let t = 0; t < tries; t++) {
        const x = 2 + (Math.random() * (MAP_W - 4) | 0);
        const y = 2 + (Math.random() * (MAP_H - 4) | 0);
        const i = y * MAP_W + x;
        if (m[i] !== 0) continue;

        // Prefer near roads
        const nearRoad = (
          m[i-1] === 1 || m[i+1] === 1 || m[i-MAP_W] === 1 || m[i+MAP_W] === 1 ||
          m[i-MAP_W-1] === 1 || m[i-MAP_W+1] === 1 || m[i+MAP_W-1] === 1 || m[i+MAP_W+1] === 1
        );
        if (!nearRoad) continue;

        // Prefer detour zone (NE-ish)
        if (!(x >= 74 && x <= 112 && y >= 14 && y <= 48)) continue;

        // Avoid all city rectangles
        const inCityC = [cityA, cityB, cityC, cityD].some(c =>
          x >= c.x-3 && x < c.x + c.w + 3 && y >= c.y-3 && y < c.y + c.h + 3);
        if (inCityC) continue;

        m[i] = 13;
        return true;
      }
      return false;
    };

    for (let i = 0; i < 3; i++) placeCache();

    // ── Assign building slot tile positions ──────────────────────────────
    // Valdenmere (x=8, y=8, w=28, h=20)
    cityBuildings.valdenmere.inn.tileX       = 8+3;  cityBuildings.valdenmere.inn.tileY       = 8+2;
    cityBuildings.valdenmere.granary.tileX   = 8+3;  cityBuildings.valdenmere.granary.tileY   = 8+8;
    cityBuildings.valdenmere.market.tileX    = 8+6;  cityBuildings.valdenmere.market.tileY    = 8+13;
    cityBuildings.valdenmere.barracks.tileX  = 8+16; cityBuildings.valdenmere.barracks.tileY  = 8+13;
    cityBuildings.valdenmere.warehouse.tileX = 8+3;  cityBuildings.valdenmere.warehouse.tileY = 8+14;
    cityBuildings.valdenmere.guild.tileX     = 8+16; cityBuildings.valdenmere.guild.tileY     = 8+2;

    // Ashport (x=96, y=55, w=24, h=16)
    cityBuildings.ashport.inn.tileX       = 96+2;  cityBuildings.ashport.inn.tileY       = 55+2;
    cityBuildings.ashport.market.tileX    = 96+3;  cityBuildings.ashport.market.tileY    = 55+7;
    cityBuildings.ashport.guild.tileX     = 96+2;  cityBuildings.ashport.guild.tileY     = 55+10;
    cityBuildings.ashport.warehouse.tileX = 96+12; cityBuildings.ashport.warehouse.tileY = 55+11;

    // Crosshaven (x=55, y=65, w=14, h=10)
    cityBuildings.crosshaven.granary.tileX = 55+2;  cityBuildings.crosshaven.granary.tileY = 65+2;
    cityBuildings.crosshaven.inn.tileX     = 55+2;  cityBuildings.crosshaven.inn.tileY     = 65+5;
    cityBuildings.crosshaven.market.tileX  = 55+8;  cityBuildings.crosshaven.market.tileY  = 65+2;

    // Ironholt (x=105, y=14, w=20, h=14)
    cityBuildings.ironholt.barracks.tileX  = 105+2;  cityBuildings.ironholt.barracks.tileY  = 14+2;
    cityBuildings.ironholt.market.tileX    = 105+12; cityBuildings.ironholt.market.tileY    = 14+2;
    cityBuildings.ironholt.granary.tileX   = 105+12; cityBuildings.ironholt.granary.tileY   = 14+9;
    cityBuildings.ironholt.warehouse.tileX = 105+2;  cityBuildings.ironholt.warehouse.tileY = 14+9;

    // ── Paint vacant lots (tile 16) for unbuilt slots ────────────────────
    for (const slots of Object.values(cityBuildings)) {
      for (const slot of Object.values(slots)) {
        if (!slot.built && slot.tileX > 0 && slot.tileY > 0) {
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const idx = (slot.tileY + dy) * MAP_W + (slot.tileX + dx);
              if (m[idx] === 4) m[idx] = 16; // only overwrite city floor
            }
        }
      }
    }

    // Expose map array for dynamic building placement
    mapData = m;

    return { m, cities: [cityA, cityB, cityC, cityD] };
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
        else if (id === 13) { r=246; g=196; b=74; } // cache
        else if (id === 16) { r=100; g=70;  b=30;  } // vacant lot
        const i = (y * mini.w + x) * 4;
        d[i+0]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
      }
    }
    miniCtx.putImageData(img, 0, 0);
  }

  rebuildMiniMap();

  const PERMIT_PRICE = 45;

  // ── GEAR SYSTEM ─────────────────────────────────────────────────────────────
  // Three upgrade slots: pack (capacity), boots (speed), tool (trade bonus)
  const GEAR = {
    // Pack — cargo capacity, carriage body grows
    pack: [
      { id: 'satchel',        name: 'Satchel',           icon: '🎒', desc: 'A worn cloth bag. Fits barely anything.',         cost: 0,    capacity: 18 },
      { id: 'traders_pack',   name: "Trader's Pack",     icon: '🗃️', desc: 'Leather-bound. Room to breathe.',                 cost: 120,  capacity: 28 },
      { id: 'merchant_cart',  name: 'Merchant Cart',     icon: '🛒', desc: 'A proper hand-cart. Serious haul.',               cost: 350,  capacity: 42 },
      { id: 'cargo_wagon',    name: 'Cargo Wagon',       icon: '🪵', desc: 'Reinforced wagon bed. Double the goods.',         cost: 800,  capacity: 60 },
      { id: 'royal_carriage', name: 'Royal Carriage',    icon: '👑', desc: 'Gold-trimmed. Built for a merchant lord.',        cost: 2000, capacity: 85 },
    ],
    // Boots — travel speed, horse quality
    boots: [
      { id: 'worn_boots',   name: 'Worn Boots',       icon: '👞', desc: 'Blistered feet. Gets the job done.',              cost: 0,    speed: 90  },
      { id: 'road_boots',   name: 'Road Boots',       icon: '👟', desc: 'Sturdy leather. Long-route ready.',              cost: 150,  speed: 115 },
      { id: 'swift_horse',  name: 'Swift Horse',      icon: '🐴', desc: 'A reliable road horse. Trots all day.',          cost: 500,  speed: 145 },
      { id: 'war_horse',    name: 'War Horse',        icon: '🏇', desc: 'Trained charger. Blazes any road.',              cost: 1200, speed: 185 },
      { id: 'phantom_mare', name: 'Phantom Mare',     icon: '⚡', desc: 'A legend on four hooves. Pure speed.',           cost: 3000, speed: 240 },
    ],
    // Tool — sell price bonus
    tool: [
      { id: 'bare_hands',       name: 'Bare Hands',       icon: '✋', desc: 'You bargain with a shrug.',                     cost: 0,    sellBonus: 0    },
      { id: 'merchant_ledger',  name: 'Merchant Ledger',  icon: '📒', desc: 'Track prices. Sell for more. +8%',             cost: 200,  sellBonus: 0.08 },
      { id: 'guild_seal',       name: 'Guild Seal',       icon: '🔖', desc: 'Guild-certified. They pay respect. +15%',      cost: 600,  sellBonus: 0.15 },
      { id: 'trade_charter',    name: 'Trade Charter',    icon: '📜', desc: 'Royal charter. No one lowballs you. +25%',     cost: 1500, sellBonus: 0.25 },
      { id: 'golden_abacus',    name: 'Golden Abacus',    icon: '🧮', desc: 'Legendary. Every deal tips your way. +40%',    cost: 4000, sellBonus: 0.40 },
    ],
  };

  // Returns current gear item for a slot
  function currentGear(slot) {
    const tier = player.gear?.[slot] ?? 0;
    return GEAR[slot][Math.min(tier, GEAR[slot].length - 1)];
  }

  // Apply gear effects to player stats (called after purchase + on load)
  function applyGearStats() {
    const pack  = currentGear('pack');
    const boots = currentGear('boots');
    player.capacity = pack.capacity;
    player.speed    = boots.speed;
  }

  const CITY_RULES = {
    valdenmere: {
      taxRate: 0.12,          // was 0.18 — reduced so big-city trading is rewarding, not punishing
      inspectionChance: 0.65,
      contraband: ['Demon Ink'],
      fineBase: 18,
      finePerItem: 6,
      vibe: 'Orderly. Taxed. Prestigious.',
      population: 8000,
      foodDemand: 0.0010,
    },
    ashport: {
      taxRate: 0.05,
      inspectionChance: 0.15,
      contraband: ['Blessed Water'],
      fineBase: 8,
      finePerItem: 3,
      vibe: 'Lawless. Profitable. Risky.',
      population: 4000,
      foodDemand: 0.0007,
    },
    crosshaven: {
      taxRate: 0.03,
      inspectionChance: 0.05,
      contraband: [],
      fineBase: 2,
      finePerItem: 1,
      vibe: 'Quiet. Dusty. Cheap.',
      population: 1500,
      foodDemand: 0.0005,
    },
    ironholt: {
      taxRate: 0.10,
      inspectionChance: 0.30,
      contraband: ['Demon Ink'],
      fineBase: 10,
      finePerItem: 4,
      vibe: 'Rough. Industrial. Busy.',
      population: 2500,
      foodDemand: 0.0008,
    },
  };

  const CITY_NPCS = {
    valdenmere: [
      { id: "valdenmere_guard1",  name: "Guard Aldric",        role: "guard_post" },
      { id: "valdenmere_guard2",  name: "Guard Mira",          role: "guard_post" },
      { id: "valdenmere_patrol",  name: "Captain Venn",        role: "guard" },
      { id: "valdenmere_merchant",name: "Mara the Merchant",   role: "merchant" },
      { id: "valdenmere_scribe",  name: "Archivist Rowen",     role: "scribe" },
    ],
    ashport: [
      { id: "ashport_guard1",   name: "Dockhand Bryn",       role: "guard_post" },
      { id: "ashport_fisher",   name: "Old Maren",           role: "fisher" },
      { id: "ashport_smuggler", name: "Lira of the Docks",   role: "smuggler" },
      { id: "ashport_broker",   name: "Brusk the Broker",    role: "broker" },
    ],
    crosshaven: [
      { id: "crosshaven_guard",     name: "Town Watch Pel",    role: "guard_post" },
      { id: "crosshaven_innkeeper", name: "Bram the Innkeeper",role: "innkeeper" },
      { id: "crosshaven_peddler",   name: "Syla the Peddler",  role: "peddler" },
    ],
    ironholt: [
      { id: "ironholt_guard1",  name: "Gate Warden Skor",    role: "guard_post" },
      { id: "ironholt_foreman", name: "Boss Kira",           role: "foreman" },
      { id: "ironholt_miner",   name: "Dag the Miner",       role: "miner" },
      { id: "ironholt_smith",   name: "Torven the Smith",    role: "smith" },
    ],
  };

const CITY_ENTITY_TEMPLATES = {
  valdenmere: [
    { id: 'valdenmere_guard1',   role: 'guard_post', style: 'guard',  speed: 0,  radius: 5 },
    { id: 'valdenmere_guard2',   role: 'guard_post', style: 'guard',  speed: 0,  radius: 5 },
    { id: 'valdenmere_patrol',   role: 'guard',      style: 'guard',  speed: 28, radius: 7 },
    { id: 'valdenmere_merchant', role: 'merchant',   style: 'baker',  speed: 22, radius: 6 },
    { id: 'valdenmere_scribe',   role: 'scribe',     style: 'scribe', speed: 25, radius: 6 },
  ],
  ashport: [
    { id: 'ashport_guard1',   role: 'guard_post', style: 'guard',    speed: 0,  radius: 5 },
    { id: 'ashport_fisher',   role: 'fisher',     style: 'fisher',   speed: 24, radius: 6 },
    { id: 'ashport_smuggler', role: 'smuggler',   style: 'smuggler', speed: 26, radius: 6 },
    { id: 'ashport_broker',   role: 'broker',     style: 'broker',   speed: 25, radius: 6 },
  ],
  crosshaven: [
    { id: 'crosshaven_guard',     role: 'guard_post', style: 'guard', speed: 0,  radius: 5 },
    { id: 'crosshaven_innkeeper', role: 'innkeeper',  style: 'baker', speed: 22, radius: 6 },
    { id: 'crosshaven_peddler',   role: 'peddler',    style: 'scribe',speed: 24, radius: 6 },
  ],
  ironholt: [
    { id: 'ironholt_guard1',  role: 'guard_post', style: 'guard',  speed: 0,  radius: 5 },
    { id: 'ironholt_foreman', role: 'foreman',    style: 'guard',  speed: 26, radius: 7 },
    { id: 'ironholt_miner',   role: 'miner',      style: 'fisher', speed: 25, radius: 6 },
    { id: 'ironholt_smith',   role: 'smith',      style: 'broker', speed: 22, radius: 6 },
  ],
};

const NPC_INTERACT_RADIUS = 18;


  const NPC_DIALOGUE_FIXTURE = {
  date: "fixture",
  cities: {
    valdenmere: {
      npcs: {
        valdenmere_scribe: [
          "Rowen: The archives are three days behind.",
          "Rowen: Taxes rose again after the last caravan.",
          "Rowen: A permit stamp can save you trouble.",
          "Rowen: Valdenmere keeps ledgers tighter than chains.",
          "Rowen: I can hear the market bell from here.",
          "Rowen: Merchants whisper about relics at dusk.",
          "Rowen: Every city has its price; ours is just honest.",
          "Rowen: The inspector counts twice, just in case.",
          "Rowen: A clean manifest keeps your wagon moving.",
          "Rowen: The road is quiet when ink runs dry.",
  ],
        valdenmere_baker: [
          "Mara: Fresh loaves for the road\u2014if you pay upfront.",
          "Mara: Flour is scarce, but rations still sell.",
          "Mara: Travelers love warm bread more than gold.",
          "Mara: Valdenmere ovens never sleep.",
          "Mara: Bring herbs and I\u2019ll trade you a crust.",
          "Mara: The guards eat first; everyone else waits.",
          "Mara: Markets buzz louder than my ovens.",
          "Mara: A pinch of salt keeps spirits steady.",
          "Mara: I saw a courier racing south to Crosshaven.",
          "Mara: Keep your pack light, keep your steps fast.",
  ],
        valdenmere_guard: [
          "Venn: Papers ready? We don\u2019t bend for excuses.",
          "Venn: Contraband earns a night in the cells.",
          "Venn: Valdenmere\u2019s gates close at the third bell.",
          "Venn: I\u2019ve seen more deals than duels.",
          "Venn: The road south is clear\u2014for now.",
          "Venn: Permits make inspections shorter.",
          "Venn: Don\u2019t flash relics in daylight.",
          "Venn: Keep your wagon straight and your story straighter.",
          "Venn: The market\u2019s honest when the sun\u2019s high.",
          "Venn: Trouble usually arrives with a smile.",
  ],
        valdenmere_guard1: [
          "Aldric: Papers.",
          "Aldric: State your business.",
          "Aldric: Move along.",
          "Aldric: No trouble in my watch.",
          "Aldric: Keep weapons sheathed in the city.",
          "Aldric: Curfew is at the third bell.",
          "Aldric: Contraband means the cells.",
          "Aldric: I\u2019ve been on this gate ten years. Don\u2019t test me.",
          "Aldric: Merchant or traveler?",
          "Aldric: The captain patrols every hour.",
  ],
        valdenmere_guard2: [
          "Mira: Halt. What\u2019s your cargo?",
          "Mira: Papers in order?",
          "Mira: Keep it moving.",
          "Mira: No loitering at the gate.",
          "Mira: Weapons stay sheathed. Always.",
          "Mira: The market closes at sundown.",
          "Mira: We check every wagon. No exceptions.",
          "Mira: First time in Valdenmere?",
          "Mira: Mind the curfew.",
          "Mira: Move on, nothing to see here.",
  ],
        valdenmere_patrol: [
          "Venn: Papers ready? We don\u2019t bend for excuses.",
          "Venn: Contraband earns a night in the cells.",
          "Venn: Valdenmere\u2019s gates close at the third bell.",
          "Venn: I\u2019ve seen more deals than duels.",
          "Venn: The road south is clear\u2014for now.",
          "Venn: Permits make inspections shorter.",
          "Venn: Don\u2019t flash relics in daylight.",
          "Venn: Keep your wagon straight and your story straighter.",
          "Venn: The market\u2019s honest when the sun\u2019s high.",
          "Venn: Trouble usually arrives with a smile.",
  ],
        valdenmere_merchant: [
          "Mara: Best prices in the city, I promise.",
          "Mara: Rations and herbs\u2014always in stock.",
          "Mara: The market bell rings twice at noon.",
          "Mara: I\u2019ve sold to every caravan on the road.",
          "Mara: Ironholt wants food. Ashport wants silk.",
          "Mara: Buy low here, sell high on the road.",
          "Mara: The guild takes a cut but it\u2019s worth the seal.",
          "Mara: Fresh stock from the south arrived this morning.",
          "Mara: Grain prices are up. Buy now.",
          "Mara: Treat your horse well and the road treats you better.",
  ],
      }
    },
    ashport: {
      npcs: {
        ashport_guard1: [
          "Bryn: Dock papers or step aside.",
          "Bryn: No crates without a manifest.",
          "Bryn: Keep it moving.",
          "Bryn: The dock master\u2019s rules, not mine.",
          "Bryn: Watched a smuggler try this gate last week. Cells.",
          "Bryn: Weapons peace-tied on the docks.",
          "Bryn: What\u2019s your tonnage?",
          "Bryn: Clear the gate. Others are waiting.",
          "Bryn: Trading or passing through?",
          "Bryn: Move along.",
  ],
        ashport_fisher: [
          "Maren: The tide brings profit and rot alike.",
          "Maren: Fish sells, if you can stomach the stink.",
          "Maren: Ashport taxes are light, but knives are not.",
          "Maren: The docks remember every debt.",
          "Maren: I trade rumors for a clean hook.",
          "Maren: Storms hide smugglers better than fog.",
          "Maren: The market here answers to coin, not law.",
          "Maren: Keep your boots dry or lose a toe.",
          "Maren: Valdenmere men count coins; we count favors.",
          "Maren: The sea doesn\u2019t care who you are.",
  ],
        ashport_smuggler: [
          "Lira: If it fits under a cloak, it fits the law.",
          "Lira: Ashport\u2019s best deals happen after dark.",
          "Lira: Don\u2019t ask where I found it.",
          "Lira: Contraband? That\u2019s just \u201crare stock\u201d here.",
          "Lira: The docks have eyes; pay them.",
          "Lira: I know a shortcut if you know a price.",
          "Lira: Valdenmere\u2019s rules make good black-market business.",
          "Lira: Keep moving\u2014guards hate still shadows.",
          "Lira: I trade whispers for weightless goods.",
          "Lira: The fog hides more than ships.",
  ],
        ashport_broker: [
          "Brusk: Prices swing like a pendulum\u2014watch it.",
          "Brusk: I can move ore faster than you can blink.",
          "Brusk: Contracts favor the bold, not the honest.",
          "Brusk: Ashport pays in silence.",
          "Brusk: Bring relics; I\u2019ll find a buyer.",
          "Brusk: Every deal leaves a footprint.",
          "Brusk: The road north bleeds profit if you rush.",
          "Brusk: Keep your numbers tight, your hands tighter.",
          "Brusk: I don\u2019t haggle\u2014time is the fee.",
          "Brusk: Markets here are sharp; come prepared.",
  ],
      }
    },
    crosshaven: {
      npcs: {
        crosshaven_guard: [
          "Pel: Just the one of me, but I\u2019m enough.",
          "Pel: Small town, clear rules.",
          "Pel: State your business.",
          "Pel: Crosshaven\u2019s quiet. Keep it that way.",
          "Pel: I know every face in this village.",
          "Pel: Trouble goes straight to the road.",
          "Pel: Move along.",
          "Pel: No weapons drawn inside.",
          "Pel: Merchant or traveler?",
          "Pel: The inn\u2019s that way if you need it.",
  ],
        crosshaven_innkeeper: [
          "Bram: Bed and board, no questions asked.",
          "Bram: The road north is clear today.",
          "Bram: Pay upfront. Always.",
          "Bram: Ironholt miners drink heavy but tip light.",
          "Bram: Crosshaven sees all roads. I see all deals.",
          "Bram: We\u2019re small, but we\u2019re on the map.",
          "Bram: Travelers come through here like the seasons.",
          "Bram: A warm hearth is worth more than a sword.",
          "Bram: The east road gets rough after the rains.",
          "Bram: Ask me anything; I won\u2019t remember telling you.",
  ],
        crosshaven_peddler: [
          "Syla: I buy anything, sell anything.",
          "Syla: Crosshaven sees all roads. I see all deals.",
          "Syla: Herbs are cheap here if you know who to ask.",
          "Syla: Valdenmere wants relics; Ironholt wants food.",
          "Syla: I once sold a broken compass for twelve gold.",
          "Syla: My cart is lighter than my secrets.",
          "Syla: The best deals happen at dusk here.",
          "Syla: Ashport\u2019s prices drop when the fleet returns.",
          "Syla: A peddler\u2019s life: always moving, always watching.",
          "Syla: Rations go fast when miners pass through.",
  ],
      }
    },
    ironholt: {
      npcs: {
        ironholt_guard1: [
          "Skor: Mine or merchant?",
          "Skor: No open flames near the shaft.",
          "Skor: Move along.",
          "Skor: Papers for the ore yard.",
          "Skor: Keep the gate clear.",
          "Skor: Ironholt\u2019s rules: work hard, cause no trouble.",
          "Skor: The foreman\u2019s word is law here.",
          "Skor: You\u2019re not on the roster. Stand aside.",
          "Skor: State your business.",
          "Skor: Weapons check at the gate.",
  ],
        ironholt_miner: [
          "Dag: Ten years underground, and still the sky surprises me.",
          "Dag: Ore flows east this season.",
          "Dag: Watch the shaft elevator \u2014 she sticks.",
          "Dag: We dig hard so you can trade soft.",
          "Dag: The seam goes deeper than the foreman admits.",
          "Dag: Iron is patient. So am I.",
          "Dag: They\u2019re hiring if your back is strong.",
          "Dag: Keep away from the east shaft after dark.",
          "Dag: Dust settles; debts don\u2019t.",
          "Dag: Food\u2019s worth more than ore some weeks.",
  ],
        ironholt_foreman: [
          "Boss Kira: Production is behind. Always behind.",
          "Boss Kira: You want ore? Pay market rate or move on.",
          "Boss Kira: No loitering near the smelter.",
          "Boss Kira: Bring food and herbs; our stores run thin.",
          "Boss Kira: The east vein is dry. Don\u2019t let that leave this yard.",
          "Boss Kira: Ironholt doesn\u2019t do charity.",
          "Boss Kira: Contracts are honored here, unlike Ashport.",
          "Boss Kira: The smelter burns day and night.",
          "Boss Kira: Lost two workers last week. Don\u2019t ask.",
          "Boss Kira: Valdenmere\u2019s traders know where the good ore is.",
  ],
        ironholt_smith: [
          "Torven: Steel remembers the hand that shaped it.",
          "Torven: Good iron, if you need it.",
          "Torven: The forge is always hungry.",
          "Torven: I\u2019ve shod horses from here to Valdenmere.",
          "Torven: Potions keep my hands from cracking in the cold.",
          "Torven: A blade holds secrets longer than a man.",
          "Torven: Ironholt ore is the finest on the road.",
          "Torven: The market pays well when the army passes.",
          "Torven: I don\u2019t sell\u2014I trade, if the metal\u2019s right.",
          "Torven: Keep your tools sharper than your tongue.",
  ],
      }
    },
  }
};

  const NPC_DIALOGUE_URL = 'assets/npc_dialogue.json';
  const NPC_CACHE_KEY = 'charterRoadNpcCache_v1';
  let npcDialogueData = __QA.enabled ? NPC_DIALOGUE_FIXTURE : null;
  let npcDialogueReady = !!npcDialogueData;
  let npcDialogueError = null;
  let npcCache = null;
  let npcDialogueLoadPromise = null;




  const ITEMS = [
    { id: 'grain',  name: 'Grain',         base: 8,  weight: 2 },  // up from 6 — now viable as bulk route
    { id: 'food',   name: 'Dried Rations', base: 14, weight: 1 },  // up from 12 — better early-game earner
    { id: 'ore',    name: 'Iron Ore',      base: 20, weight: 2 },  // up from 18 — small bump
    { id: 'herbs',  name: 'Moon Herbs',    base: 18, weight: 1 },  // up from 16 — stronger starter route
    { id: 'potion', name: 'Minor Potion',  base: 36, weight: 1 },  // up from 34 — mid-game tier
    { id: 'relic',  name: 'Old Relic',     base: 50, weight: 2 },  // down from 55 — reduced dominance
    { id: 'ink',    name: 'Demon Ink',     base: 80, weight: 1, contrabandName: 'Demon Ink' },  // up from 70 — contraband pays off
  ];

  // --- Market model (minimal, deterministic)
  // Goals:
  // - Per-town price differences that persist for a run (seeded by city+item).
  // - Avoid degenerate buy->sell loops in the same town (spread).
  // - Provide profit clarity via “reference/base” and “last seen” prices.
  const MARKET = {
    spread: 0.10,          // buy price = mid*(1+spread/2), sell price = mid*(1-spread/2)
    lastSeen: {
      // cityId: { itemId: { buy:number, sell:number, t:number } }
    },
  };

  // ── GLOBAL ECONOMY (Supabase) ────────────────────────────────────────────
  const ECONOMY = {
    url:    'https://ycjhcsxxtinipwailbjb.supabase.co',
    key:    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljamhjc3h4dGluaXB3YWlsYmpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTc1MDAsImV4cCI6MjA4OTIzMzUwMH0.cBEiiVExRAnWVeUV3v6ZLYmcPe1hnPc4wdmKSvkRahY',
    // Local cache: cityId → itemId → pressure (-0.5..+0.5)
    pressure: {},
    lastSync: 0,
    SYNC_INTERVAL_MS: 60_000, // fetch global state every 60s
    enabled: !__QA.enabled, // disable in QA mode to prevent noisy 4xx errors in tests
  };

  function economyHeaders() {
    return {
      'apikey': ECONOMY.key,
      'Authorization': `Bearer ${ECONOMY.key}`,
      'Content-Type': 'application/json',
    };
  }

  // Fetch latest market pressure from Supabase (called on city entry + periodic)
  async function economySync() {
    if (!ECONOMY.enabled) return;
    const now = Date.now();
    if (now - ECONOMY.lastSync < ECONOMY.SYNC_INTERVAL_MS) return;
    ECONOMY.lastSync = now;
    try {
      const res = await fetch(`${ECONOMY.url}/rest/v1/market_economy?select=city_id,item_id,pressure`, {
        headers: economyHeaders(),
      });
      if (!res.ok) return;
      const rows = await res.json();
      for (const row of rows) {
        if (!ECONOMY.pressure[row.city_id]) ECONOMY.pressure[row.city_id] = {};
        ECONOMY.pressure[row.city_id][row.item_id] = row.pressure || 0;
      }
    } catch (e) {
      // Network fail — degrade gracefully, local drift still works
    }
  }

  // Post a trade event to Supabase (fire-and-forget)
  function economyPostTrade(cityId, itemId, direction, qty) {
    if (!ECONOMY.enabled) return;
    // Optimistically update local cache immediately
    if (!ECONOMY.pressure[cityId]) ECONOMY.pressure[cityId] = {};
    const delta = (direction === 'buy' ? qty : -qty) * 0.02;
    ECONOMY.pressure[cityId][itemId] = Math.max(-0.5, Math.min(0.5,
      (ECONOMY.pressure[cityId][itemId] || 0) + delta
    ));
    // Push to server async
    fetch(`${ECONOMY.url}/rest/v1/trade_events`, {
      method: 'POST',
      headers: { ...economyHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ city_id: cityId, item_id: itemId, direction, qty }),
    }).catch(() => {});
  }

  // Get economy price modifier for a city/item (1.0 = no effect)
  function economyModifier(cityId, itemId) {
    const p = ECONOMY.pressure[cityId]?.[itemId] || 0;
    // pressure +0.5 → price ×1.5, pressure -0.5 → price ×0.67
    return 1 + p;
  }

  // Trigger economy aggregation on server (called hourly via stateTime)
  let _lastEconomyAggregate = 0;
  function maybeAggregateEconomy() {
    if (!ECONOMY.enabled) return;
    const now = Date.now();
    if (now - _lastEconomyAggregate < 3_600_000) return; // once per hour
    _lastEconomyAggregate = now;
    fetch(`${ECONOMY.url}/rest/v1/rpc/aggregate_economy`, {
      method: 'POST',
      headers: { ...economyHeaders(), 'Prefer': 'return=minimal' },
      body: '{}',
    }).catch(() => {});
  }

  // Initial sync on load
  economySync();

  function citySeed(cityId) {
    // Keep stable across reloads within a run; if a global seed exists, incorporate later.
    // 1..1e9-ish.
    const seeds = { valdenmere: 1337, ashport: 7331, crosshaven: 4219, ironholt: 9901 };
    const a = seeds[cityId] || 5555;
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

  function dayWobble(cityId, item) {
    // Deterministic wobble that changes once per in-game day, not every frame.
    // Produces a ±3% variation so prices feel alive without flickering.
    const day = Math.max(1, Math.floor(time?.day || 1));
    const cs = citySeed(cityId);
    const u = seeded01(cs ^ (item.base * 7), day, item.id.charCodeAt(0) || 0);
    return 0.97 + u * 0.06; // range [0.97, 1.03]
  }

  function midPriceFor(cityId, item) {
    const mod = townItemModifier(cityId, item.id);
    const wob = dayWobble(cityId, item);
    return Math.max(1, Math.round(item.base * mod * wob));
  }

  function quoteFor(cityId, item) {
    const mid = midPriceFor(cityId, item);
    const half = MARKET.spread / 2;
    const discount = cityBonus[cityId]?.marketDiscount || 0;
    const buy  = Math.max(1, Math.round(mid * (1 + half) * (1 - discount)));
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


  const CONTRACT_ITEMS = ['grain','food','ore','herbs','potion','relic'];


  function rewardForContract(want, qty) {
    const it = ITEMS.find(x => x.id === want);
    const base = it ? it.base : 20;
    // Premium per item type — ensures at least a small net positive vs buy cost
    const premium = want === 'relic' ? 18 : (want === 'potion' ? 12 : 8);
    // Diminishing multiplier on qty to prevent high-qty contracts going net-negative
    // (old formula scaled linearly and hit the 160g cap before covering costs)
    const qtyMult = qty === 1 ? 1.0 : qty === 2 ? 1.7 : 2.2;
    const r = Math.round((10 + premium + base * 0.9) * qtyMult);
    // Raised cap from 160 to 200 so high-value multi-item contracts are always worth taking
    return clamp(r, 20, 200);
  }

  const CONTRACT_TIER_THRESHOLDS = [3, 7]; // Tier0 <3, Tier1 3-6, Tier2 7+
  const CONTRACT_TIER_MULT = [1.00, 1.15, 1.30];
  const CONTRACT_PERMIT_BONUS = 0.10; // +10% if permit owned in posting city

  function contractTierForRep(rep) {
    const r = Number(rep) || 0;
    if (r >= CONTRACT_TIER_THRESHOLDS[1]) return 2;
    if (r >= CONTRACT_TIER_THRESHOLDS[0]) return 1;
    return 0;
  }

  function makeContract(fromId, tier = 0) {
    const want = randChoice(CONTRACT_ITEMS);
    // Higher tiers tend to request more goods.
    const qty = 1 + (Math.random() * (2 + tier) | 0);
    const allCities = ['valdenmere','ashport','crosshaven','ironholt'];
    const others = allCities.filter(id => id !== fromId);
    const toId = randChoice(others);
    const reward = rewardForContract(want, qty);
    return { fromId, toId, want, qty, reward, tier };
  }

  function regenContractsForCity(cityId) {
    // Generate a small mix of tiers; visibility is filtered by player rep at render time.
    const jobs = [
      makeContract(cityId, 0),
      makeContract(cityId, 0),
      makeContract(cityId, 1),
      makeContract(cityId, 2),
    ];
    return jobs;
  }

  const contracts = {
    byCity: {
      valdenmere:  regenContractsForCity('valdenmere'),
      ashport:     regenContractsForCity('ashport'),
      crosshaven:  regenContractsForCity('crosshaven'),
      ironholt:    regenContractsForCity('ironholt'),
    },
    active: null,
    lastRegenDay: { valdenmere: 1, ashport: 1, crosshaven: 1, ironholt: 1 },
  };

  const CONTRACT_REGEN_DAYS = 3; // boards refresh every 3 in-game days

  /** Remove a specific job from a city board and top it up to 4 slots */
  function removeContractFromBoard(cityId, job) {
    const board = contracts.byCity[cityId];
    if (!board) return;
    const idx = board.indexOf(job);
    if (idx !== -1) board.splice(idx, 1);
    // If board drops below 2 jobs, immediately top up
    while (board.length < 2) board.push(makeContract(cityId, Math.random() < 0.4 ? 1 : 0));
  }

  /** Regen a city's board if CONTRACT_REGEN_DAYS have passed since last regen */
  function maybeRegenCityContracts(cityId) {
    const day = Math.floor(time.day);
    const last = contracts.lastRegenDay[cityId] || 1;
    if (day - last >= CONTRACT_REGEN_DAYS) {
      contracts.byCity[cityId] = regenContractsForCity(cityId);
      contracts.lastRegenDay[cityId] = day;
      return true; // refreshed
    }
    return false;
  }


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
  const cityPop = {
    valdenmere: { pop: 8000, hunger: 0 },
    ashport:    { pop: 4000, hunger: 0 },
    crosshaven: { pop: 1500, hunger: 0 },
    ironholt:   { pop: 2500, hunger: 0 },
  };

  // City treasury — accumulates from player sell taxes, auto-invests every ~7 days
  const cityTreasury = {
    valdenmere: { gold: 0, investLog: [] }, // investLog: [{day, project, effect}]
    ashport:    { gold: 0, investLog: [] },
    crosshaven: { gold: 0, investLog: [] },
    ironholt:   { gold: 0, investLog: [] },
  };

  // Bank state — player deposits and loans per city
  const playerBank = {
    deposits: {}, // cityId -> { amount, depositDay }
    loans: {},    // cityId -> { amount, dueDay, interest }
  };

  // Bank vault — each city bank holds its own reserve
  // Fed by: player deposits + periodic city treasury contribution
  // Goes bankrupt when vault < total owed to depositors
  const bankVault = {
    valdenmere: { reserve: 120, bankruptDay: null }, // start with small seed reserves
    ashport:    { reserve: 80,  bankruptDay: null },
    crosshaven: { reserve: 40,  bankruptDay: null },
    ironholt:   { reserve: 60,  bankruptDay: null },
  };

  const BANK_BANKRUPTCY_REOPEN_DAYS = 5; // days until bank reopens after bankruptcy
  const BANK_INTEREST_RATE = 0.005;      // 0.5%/day deposit interest (down from broken 2%)
  const BANK_LOAN_RATE     = 0.10;       // 10% flat loan fee

  /** Total gold owed to all depositors at a city bank right now */
  function bankTotalOwed(cid) {
    const dep = playerBank.deposits[cid];
    if (!dep) return 0;
    const days = Math.max(0, Math.floor(time.day) - dep.depositDay);
    return dep.amount + Math.floor(dep.amount * BANK_INTEREST_RATE * days);
  }

  /** Is a city bank currently bankrupt (closed)? */
  function bankIsBankrupt(cid) {
    const v = bankVault[cid];
    if (!v) return false;
    if (v.bankruptDay !== null) {
      // Reopen after BANK_BANKRUPTCY_REOPEN_DAYS
      if (Math.floor(time.day) >= v.bankruptDay + BANK_BANKRUPTCY_REOPEN_DAYS) {
        v.bankruptDay = null; // reopened
        return false;
      }
      return true;
    }
    return false;
  }

  /** Check if a bank should go bankrupt; trigger if so */
  function checkBankSolvency(cid) {
    const v = bankVault[cid];
    if (!v || bankIsBankrupt(cid)) return;
    const owed = bankTotalOwed(cid);
    // Bankrupt if reserve can't cover even 30% of what's owed AND owed > 0
    if (owed > 0 && v.reserve < owed * 0.30) {
      v.bankruptDay = Math.floor(time.day);
      // Partial payout: player gets back what the vault can cover
      const dep = playerBank.deposits[cid];
      if (dep) {
        const payout = Math.min(v.reserve, owed);
        player.gold += payout;
        v.reserve = Math.max(0, v.reserve - payout);
        delete playerBank.deposits[cid];
        // Loans are forgiven in a bankruptcy
        delete playerBank.loans[cid];
        const cityObj = getCityById(cid);
        const haircut = owed - payout;
        const msg = haircut > 0
          ? `🏦 Bank of ${cityObj?.name || cid} BANKRUPT! Recovered ${payout}g of ${owed}g owed. Lost ${haircut}g.`
          : `🏦 Bank of ${cityObj?.name || cid} bankrupt — deposit fully recovered (${payout}g).`;
        toast(msg, 6);
        player.rep[cid] = (player.rep[cid] || 0) - 1; // slight rep hit from the chaos
      } else {
        const cityObj = getCityById(cid);
        toast(`🏦 Bank of ${cityObj?.name || cid} has gone bankrupt. Closed for ${BANK_BANKRUPTCY_REOPEN_DAYS} days.`, 5);
      }
      v.reserve = 0;
    }
  }

  // Guild membership state
  const playerGuild = { joined: false, tier: 0 }; // tier 0=none,1=apprentice,2=journeyman,3=master

  // Warehouse stash — items stored per city
  const warehouseStash = {}; // cityId -> { itemId: qty, ... }

  // City upgrades — multiplicative bonuses unlocked by investment
  const cityBonus = {
    valdenmere: { marketDiscount: 0, roadSpeed: 0, foodSubsidy: 0, popIncentive: 0, guardDiscount: 0 },
    ashport:    { marketDiscount: 0, roadSpeed: 0, foodSubsidy: 0, popIncentive: 0, guardDiscount: 0 },
    crosshaven: { marketDiscount: 0, roadSpeed: 0, foodSubsidy: 0, popIncentive: 0, guardDiscount: 0 },
    ironholt:   { marketDiscount: 0, roadSpeed: 0, foodSubsidy: 0, popIncentive: 0, guardDiscount: 0 },
  };

  // ── City Building Slots ───────────────────────────────────────────────────
  // Each slot: level (0=unbuilt), maxLevel, costPerLevel[], effect, gain, built flag,
  // tileX/Y (set after makeMap), tileW/H (building footprint), tileType, doorSide, playerFunded
  const cityBuildings = {
    valdenmere: {
      market:    { level:0, maxLevel:3, costPerLevel:[80,160,300],  effect:'marketDiscount', gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:3, tileType:6,  doorSide:'south', playerFunded:0 },
      barracks:  { level:0, maxLevel:2, costPerLevel:[100,200],     effect:'guardDiscount',  gain:0.10, built:false, tileX:0, tileY:0, tileW:5, tileH:4, tileType:4,  doorSide:'west',  playerFunded:0 },
      granary:   { level:0, maxLevel:2, costPerLevel:[60,120],      effect:'foodSubsidy',    gain:0.10, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:8,  doorSide:'south', playerFunded:0 },
      guild:     { level:0, maxLevel:1, costPerLevel:[200],         effect:'popIncentive',   gain:0.10, built:false, tileX:0, tileY:0, tileW:5, tileH:3, tileType:15, doorSide:'south', playerFunded:0 },
      warehouse: { level:0, maxLevel:2, costPerLevel:[90,180],      effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:6, tileH:3, tileType:8,  doorSide:'north', playerFunded:0 },
      inn:       { level:0, maxLevel:1, costPerLevel:[70],          effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:4, tileType:7,  doorSide:'east',  playerFunded:0 },
    },
    ashport: {
      market:    { level:0, maxLevel:2, costPerLevel:[80,160],      effect:'marketDiscount', gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:3, tileType:6,  doorSide:'south', playerFunded:0 },
      warehouse: { level:0, maxLevel:3, costPerLevel:[70,140,250],  effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:3, tileType:8,  doorSide:'north', playerFunded:0 },
      inn:       { level:0, maxLevel:2, costPerLevel:[60,120],      effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:5, tileType:7,  doorSide:'east',  playerFunded:0 },
      guild:     { level:0, maxLevel:1, costPerLevel:[150],         effect:'popIncentive',   gain:0.08, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:15, doorSide:'east',  playerFunded:0 },
    },
    crosshaven: {
      granary:   { level:0, maxLevel:2, costPerLevel:[50,100],      effect:'foodSubsidy',    gain:0.12, built:false, tileX:0, tileY:0, tileW:3, tileH:3, tileType:8,  doorSide:'west',  playerFunded:0 },
      inn:       { level:0, maxLevel:1, costPerLevel:[55],          effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:7,  doorSide:'east',  playerFunded:0 },
      market:    { level:0, maxLevel:1, costPerLevel:[70],          effect:'marketDiscount', gain:0.05, built:false, tileX:0, tileY:0, tileW:3, tileH:3, tileType:6,  doorSide:'south', playerFunded:0 },
    },
    ironholt: {
      barracks:  { level:0, maxLevel:2, costPerLevel:[90,180],      effect:'guardDiscount',  gain:0.10, built:false, tileX:0, tileY:0, tileW:5, tileH:4, tileType:4,  doorSide:'east',  playerFunded:0 },
      warehouse: { level:0, maxLevel:3, costPerLevel:[80,160,280],  effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:6, tileH:3, tileType:8,  doorSide:'north', playerFunded:0 },
      granary:   { level:0, maxLevel:1, costPerLevel:[60],          effect:'foodSubsidy',    gain:0.10, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:8,  doorSide:'south', playerFunded:0 },
      market:    { level:0, maxLevel:1, costPerLevel:[80],          effect:'marketDiscount', gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:3, tileType:6,  doorSide:'south', playerFunded:0 },
    },
  };

  // Keep INVEST_PROJECTS for legacy save compat (no longer drives auto-invest)
  const INVEST_PROJECTS = {
    market: { name: 'Market Expansion',    cost: 80, effect: 'marketDiscount', gain: 0.04, max: 0.30, desc: 'Goods cost 4% less to buy' },
    road:   { name: 'Road Improvements',   cost: 60, effect: 'roadSpeed',      gain: 0.05, max: 0.25, desc: '5% faster travel through city region' },
    food:   { name: 'Food Subsidy',        cost: 50, effect: 'foodSubsidy',    gain: 0.10, max: 0.50, desc: 'Slows daily hunger increase by 10%' },
    pop:    { name: 'Population Incentive',cost: 70, effect: 'popIncentive',   gain: 0.05, max: 0.30, desc: 'Boosts migrant attraction by 5%' },
  };

  const marketDrift = {
    valdenmere:  Object.fromEntries(ITEMS.map(it => [it.id, 1])),
    ashport:     Object.fromEntries(ITEMS.map(it => [it.id, 1])),
    crosshaven:  Object.fromEntries(ITEMS.map(it => [it.id, 1])),
    ironholt:    Object.fromEntries(ITEMS.map(it => [it.id, 1])),
  };

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function npcDayKey() {
  return Math.max(1, Math.floor(Number(time.day) || 1));
}

function npcValidateData(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.cities || typeof data.cities !== 'object') return false;
  for (const cityId of Object.keys(data.cities)) {
    const city = data.cities[cityId];
    if (!city || typeof city !== 'object') return false;
    const npcs = city.npcs;
    if (!npcs || typeof npcs !== 'object') return false;
    for (const npcId of Object.keys(npcs)) {
      const lines = npcs[npcId];
      if (!Array.isArray(lines) || !lines.length) return false;
      if (lines.some(line => typeof line !== 'string' || !line.trim())) return false;
    }
  }
  return true;
}

function npcLoadCache() {
  const day = npcDayKey();
  if (npcCache && npcCache.day === day) return npcCache;
  let cache = null;
  try {
    cache = JSON.parse(localStorage.getItem(NPC_CACHE_KEY) || '');
  } catch {}
  if (!cache || typeof cache !== 'object' || cache.day !== day || typeof cache.cities !== 'object') {
    cache = { day, cities: {} };
  }
  npcCache = cache;
  return cache;
}

function npcSaveCache(cache) {
  npcCache = cache;
  try { localStorage.setItem(NPC_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

function npcClearCache() {
  npcCache = null;
  try { localStorage.removeItem(NPC_CACHE_KEY); } catch {}
}

function npcFallbackLines(cityId, npc, count = 10) {
  const city = cityName(cityId);
  const name = npc?.name || 'Traveler';
  const pool = [
    `${name}: ${city} feels different each dawn.`,
    `${name}: The road remembers every deal.`,
    `${name}: Keep a light pack and a lighter story.`,
    `${name}: Markets favor the patient, not the rushed.`,
    `${name}: Coin speaks louder than steel here.`,
    `${name}: A clean manifest keeps guards calm.`,
    `${name}: Rumors travel faster than wagons.`,
    `${name}: Watch the tide of prices, not the tide of waves.`,
  ];
  const lines = [];
  const seed = hashStr(`${cityId}|${npc?.id || name}|${npcDayKey()}`);
  for (let i = 0; i < count; i++) {
    const idx = (seed + i) % pool.length;
    lines.push(pool[idx]);
  }
  return lines;
}

function npcNormalizeLines(lines, cityId, npc) {
  let out = Array.isArray(lines) ? lines.map(s => String(s).trim()).filter(Boolean) : [];
  if (out.length > 10) out = out.slice(0, 10);
  if (out.length < 10) out = out.concat(npcFallbackLines(cityId, npc, 10 - out.length));
  return out.slice(0, 10);
}

function getNpcById(cityId, npcId) {
  const list = CITY_NPCS[cityId] || [];
  return list.find(n => n.id === npcId) || null;
}

function getNpcLines(cityId, npcOrId) {
  const npc = typeof npcOrId === 'string' ? getNpcById(cityId, npcOrId) : npcOrId;
  if (!npc) return npcNormalizeLines([], cityId, { id: npcOrId || 'unknown', name: 'Traveler' });
  const cache = npcLoadCache();
  if (!cache.cities[cityId]) cache.cities[cityId] = {};
  if (!cache.cities[cityId][npc.id]) {
    const src = npcDialogueData?.cities?.[cityId]?.npcs?.[npc.id];
    cache.cities[cityId][npc.id] = npcNormalizeLines(src, cityId, npc);
    npcSaveCache(cache);
  }
  return cache.cities[cityId][npc.id];
}

function npcLineIndex(npcId, lines) {
  if (!lines || !lines.length) return 0;
  const seed = hashStr(`${npcId}|${npcDayKey()}`) % lines.length;
  const tick = Math.floor(stateTime / 4000);
  return (seed + tick) % lines.length;
}

function getNpcPanelState(cityId) {
  const list = CITY_NPCS[cityId] || [];
  return list.map(npc => {
    const lines = getNpcLines(cityId, npc);
    const idx = npcLineIndex(npc.id, lines);
    return { id: npc.id, name: npc.name, line: lines[idx], idx, total: lines.length };
  });
}

function loadNpcDialogue() {
  if (__QA.enabled) return Promise.resolve(npcDialogueData);
  if (npcDialogueLoadPromise) return npcDialogueLoadPromise;
  npcDialogueLoadPromise = fetch(NPC_DIALOGUE_URL, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(`npc dialogue fetch failed (${r.status})`);
      return r.json();
    })
    .then(data => {
      if (!npcValidateData(data)) throw new Error('npc dialogue invalid schema');
      npcDialogueData = data;
      npcDialogueReady = true;
      npcDialogueError = null;
      npcClearCache();
      return data;
    })
    .catch(err => {
      npcDialogueError = String(err && (err.message || err));
      return null;
    });
  return npcDialogueLoadPromise;
}

if (!__QA.enabled) loadNpcDialogue();


const entities = [];
let activeNpcCityId = null;

// ─────────────────────────────────────────────────────────────────────────────
// AI TRADER SYSTEM
// Merchants travel the roads between cities, buy low/sell high, visible on map.
// Player can intercept them to trade or watch them compete.
// ─────────────────────────────────────────────────────────────────────────────

const AI_TRADERS = [];

const TRADER_DEFS = [
  { id: 'olt_the_bold',    name: 'Olt the Bold',    style: 'guard',    personality: 'aggressive',  color: '#ef4444', speed: 75 },
  { id: 'mira_silvertong', name: 'Mira Silvertongue',style: 'scribe',   personality: 'opportunist', color: '#a78bfa', speed: 60 },
  { id: 'cargo_dom',       name: 'Cargo Dom',       style: 'broker',   personality: 'cautious',    color: '#f59e0b', speed: 50 },
  { id: 'wren_the_swift',  name: 'Wren the Swift',  style: 'smuggler', personality: 'aggressive',  color: '#34d399', speed: 85 },
];

// Road waypoint paths between cities (pixel coords)
// Each path is an array of {x,y} checkpoints the trader follows in order
// Cache so we only compute each route once per session
const _traderPathCache = {};

function buildTraderPath(fromId, toId) {
  const cacheKey = `${fromId}→${toId}`;
  // Only return cache if it's a real A* path (length > 2 = not a straight-line fallback)
  if (_traderPathCache[cacheKey] && _traderPathCache[cacheKey].length > 2) return _traderPathCache[cacheKey];

  const T = TILE;

  // Gate exit points: gx = x+floor(w/2), gy = y+h (wall row), road starts at gy+1
  // City layouts: valdenmere {x:8,y:8,w:28,h:20}, ashport {x:96,y:55,w:24,h:16},
  //               crosshaven {x:55,y:65,w:14,h:10}, ironholt {x:105,y:14,w:20,h:14}
  // Use A* to find a walkable tile path between city gate exits, then convert to world pixels.
  const getGateExit = (cityId) => {
    const c = world.cities.find(c => c.id === cityId);
    if (!c) return null;
    const gx = c.x + Math.floor(c.w / 2);
    // Scan downward from gate wall until we find a clear walkable tile (up to 5 tiles)
    for (let offset = 1; offset <= 5; offset++) {
      const gy = c.y + c.h + offset;
      const cx = (gx + 0.5) * TILE, cy = (gy + 0.5) * TILE;
      const r = (player && player.r) ? player.r : 8;
      const clear = !isSolidAt(cx - r, cy - r) && !isSolidAt(cx + r, cy - r) &&
                    !isSolidAt(cx - r, cy + r) && !isSolidAt(cx + r, cy + r);
      if (clear) return { tx: gx, ty: gy };
    }
    return { tx: gx, ty: c.y + c.h + 1 }; // fallback to original
  };

  const fromExit = getGateExit(fromId);
  const toExit   = getGateExit(toId);
  if (!fromExit || !toExit) {
    // Fallback: straight line
    const result = [
      { x: fromExit ? fromExit.tx * T + T/2 : 0, y: fromExit ? fromExit.ty * T + T/2 : 0 },
      { x: toExit   ? toExit.tx * T + T/2   : 0, y: toExit   ? toExit.ty * T + T/2   : 0 },
    ];
    _traderPathCache[cacheKey] = result;
    return result;
  }

  // Run A* between gate exits (high node limit for long routes)
  const tilePath = astar(fromExit.tx, fromExit.ty, toExit.tx, toExit.ty, 20000);

  let result;
  if (!tilePath || tilePath.length === 0) {
    // No path found — fallback straight line
    result = [
      { x: fromExit.tx * T + T/2, y: fromExit.ty * T + T/2 },
      { x: toExit.tx * T + T/2,   y: toExit.ty * T + T/2 },
    ];
  } else {
    // Reduce waypoints: keep only direction-change corners (collinear points removed).
    // This avoids micro-stuttering at every tile while still following the correct path.
    const corners = [tilePath[0]];
    for (let i = 1; i < tilePath.length - 1; i++) {
      const prev = tilePath[i - 1], cur = tilePath[i], next = tilePath[i + 1];
      const dx1 = cur.x - prev.x, dy1 = cur.y - prev.y;
      const dx2 = next.x - cur.x,  dy2 = next.y - cur.y;
      // Keep if direction changes (not collinear)
      if (dx1 !== dx2 || dy1 !== dy2) corners.push(cur);
    }
    corners.push(tilePath[tilePath.length - 1]);

    // Convert tile coords to world pixel centers
    result = corners.map(t => ({ x: t.x * T + T/2, y: t.y * T + T/2 }));

    // Add city center as final destination so player walks fully into the city
    const destCity = world.cities.find(c => c.id === toId);
    if (destCity) {
      result.push({ x: (destCity.x + destCity.w / 2) * T, y: (destCity.y + destCity.h / 2) * T });
    }
  }

  _traderPathCache[cacheKey] = result;
  return result;
}

/**
 * Decide the best route for a trader based on personality + current prices.
 * Returns { fromId, toId, itemId } — the trip they'll do.
 */
function traderDecideRoute(trader) {
  const fromId = trader.toId || trader.fromId || 'valdenmere';
  const candidates = [];
  for (const to of world.cities) {
    if (to.id === fromId) continue; // never stay in same city
    for (const it of ITEMS) {
      const buy  = quoteFor(fromId, it).buy;
      const sell = quoteFor(to.id, it).sell;
      const profit = sell - buy;
      if (profit <= 0) continue;
      const units = Math.floor(trader.capacity / it.weight);
      candidates.push({ from: fromId, to: to.id, itemId: it.id, profit: profit * units });
    }
  }

  if (!candidates.length) {
    // No profitable route — pick any other city
    const others = world.cities.filter(c => c.id !== fromId);
    const fallbackTo = others[Math.floor(Math.random() * others.length)]?.id || 'ashport';
    return { fromId, toId: fallbackTo, itemId: 'ore' };
  }

  candidates.sort((a, b) => b.profit - a.profit);

  let pick;
  if (trader.personality === 'aggressive') {
    pick = candidates[0];
  } else if (trader.personality === 'cautious') {
    pick = candidates[Math.floor(candidates.length * 0.4)] || candidates[0];
  } else {
    // Opportunist: random from top 5
    pick = candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];
  }
  return { fromId, toId: pick.to, itemId: pick.itemId };
}

function spawnAiTraders() {
  AI_TRADERS.length = 0;
  const startCities = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];
  for (let i = 0; i < TRADER_DEFS.length; i++) {
    const def = TRADER_DEFS[i];
    const startCity = startCities[i % startCities.length];
    const startC = getCityById(startCity);
    const startX = startC ? (startC.x + startC.w/2) * TILE : 400;
    const startY = startC ? (startC.y + startC.h/2) * TILE : 400;

    const trader = {
      ...def,
      capacity: 12,
      gold: 80 + i * 20,
      startGold: 80 + i * 20,
      totalProfit: 0,
      tripsCompleted: 0,
      inv: {},
      x: startX,
      y: startY,
      path: [],
      pathIdx: 0,
      fromId: startCity,
      toId: startCity,   // will be updated by traderDepart
      itemId: 'ore',
      state: 'in_city',
      cityTimer: i * 2,  // stagger departures so they don't all leave at once
      _lastX: startX,
      _lastY: startY,
      _stuckT: 0,
      radius: 7,
    };
    AI_TRADERS.push(trader);
  }
}

// Call after TRADER_DEFS and AI_TRADERS are initialized (world is available at this point)
spawnAiTraders();

// Sync AI trader state from Supabase world_traders (fire-and-forget, non-blocking)
async function syncTradersFromServer() {
  if (__QA.enabled) return; // skip in QA mode
  try {
    const res = await fetch(
      `${ECONOMY.url}/rest/v1/world_traders?select=*`,
      { headers: { apikey: ECONOMY.key, Authorization: `Bearer ${ECONOMY.key}` } }
    );
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return;

    for (const row of rows) {
      const t = AI_TRADERS.find(tr => tr.id === row.id);
      if (!t) continue;
      // Sync economy data
      t.gold           = row.gold;
      t.totalProfit    = row.total_profit;
      t.tripsCompleted = row.trips_completed;
      t.fromId         = row.from_id;
      t.toId           = row.to_id;
      t.itemId         = row.item_id;
      t.inv            = typeof row.inv === 'object' ? row.inv : {};

      // Sync travel state
      if (row.state === 'in_city') {
        t.state = 'in_city';
        t.path  = [];
        t.pathIdx = 0;
        const destC = getCityById(row.to_id);
        if (destC) {
          t.x = (destC.x + destC.w / 2) * TILE;
          t.y = (destC.y + destC.h / 2) * TILE;
        }
      } else if (row.state === 'traveling' && typeof row.progress === 'number') {
        t.state = 'traveling';
        const path = buildTraderPath(row.from_id, row.to_id);
        if (path && path.length > 0) {
          t.path    = path;
          t.pathIdx = Math.min(Math.floor(row.progress * path.length), path.length - 1);
          const wp  = path[t.pathIdx];
          if (wp) { t.x = wp.x; t.y = wp.y; }
        }
      }
    }
    console.log(`[SYNC] Synced ${rows.length} traders from server`);
  } catch (e) {
    // Non-fatal — game runs with local state
    console.warn('[SYNC] Trader sync failed (non-fatal):', e.message);
  }
}

// Call after world is ready — deferred slightly so world init completes first
setTimeout(syncTradersFromServer, 1500);

function traderArrive(t) {
  // Snap to city center
  const destC = getCityById(t.toId);
  if (destC) {
    t.x = (destC.x + destC.w/2) * TILE;
    t.y = (destC.y + destC.h/2) * TILE;
  }
  // Sell all cargo at destination
  let tripRevenue = 0;
  for (const [itemId, qty] of Object.entries(t.inv)) {
    if (!qty) continue;
    const it = ITEMS.find(i => i.id === itemId);
    if (it) { const q = quoteFor(t.toId, it); const earned = q.sell * qty; t.gold += earned; tripRevenue += earned; }
  }
  if (tripRevenue > 0) {
    t.totalProfit = (t.totalProfit || 0) + tripRevenue;
    t.tripsCompleted = (t.tripsCompleted || 0) + 1;
  }
  t.inv = {};
  t.path = [];       // clear path so stale idx can't re-trigger
  t.pathIdx = 0;
  t.state = 'in_city';
  t.cityTimer = 5 + Math.random() * 8;
}

function traderDepart(t) {
  const route = traderDecideRoute(t);
  // Never route to the same city
  if (route.toId === t.toId) {
    const others = world.cities.filter(c => c.id !== t.toId);
    if (others.length) route.toId = others[Math.floor(Math.random() * others.length)].id;
  }
  t.fromId = t.toId;
  t.toId = route.toId;
  t.itemId = route.itemId;
  // Buy cargo
  const it = ITEMS.find(i => i.id === route.itemId);
  if (it) {
    const buyQ = quoteFor(t.fromId, it);
    const units = Math.min(
      Math.floor(t.capacity / it.weight),
      t.gold > 0 ? Math.floor(t.gold / buyQ.buy) : 0
    );
    if (units > 0) {
      t.gold -= buyQ.buy * units;
      t.inv = { [route.itemId]: units };
    }
  }
  t.path = buildTraderPath(t.fromId, t.toId);
  t.pathIdx = 0;
  t.state = 'traveling';
  t._stuckT = stateTime;
  t._lastX = t.x;
  t._lastY = t.y;
}

function updateAiTraders(dt) {
  for (const t of AI_TRADERS) {
    // ── In city: wait then depart ─────────────────────────────────────
    if (t.state === 'in_city') {
      t.cityTimer -= dt;
      if (t.cityTimer <= 0) traderDepart(t);
      continue;
    }

    if (t.state !== 'traveling') continue;

    // ── Traveling: follow path waypoints ─────────────────────────────
    if (!t.path || t.path.length === 0) { traderArrive(t); continue; }

    // Guard: pathIdx out of range → arrive
    if (t.pathIdx >= t.path.length) { traderArrive(t); continue; }

    const target = t.path[t.pathIdx];
    if (!target) { traderArrive(t); continue; }

    const dx = target.x - t.x;
    const dy = target.y - t.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 12) {
      // Reached waypoint — advance
      t.pathIdx++;
      if (t.pathIdx >= t.path.length) { traderArrive(t); }
      continue; // re-evaluate next frame
    }

    // Move
    t.x += (dx / dist) * t.speed * dt;
    t.y += (dy / dist) * t.speed * dt;

    // Stuck detection — skip waypoint if blocked for 3s
    if (stateTime - (t._stuckT || 0) > 3000) {
      const moved = Math.hypot(t.x - (t._lastX || t.x), t.y - (t._lastY || t.y));
      if (moved < 8) {
        t.pathIdx = Math.min(t.pathIdx + 1, t.path.length);
        if (t.pathIdx >= t.path.length) { traderArrive(t); continue; }
      }
      t._stuckT = stateTime; t._lastX = t.x; t._lastY = t.y;
    }

    maybeFireTraderBubble(t, dt);
  }

  // Also tick in_city bubbles
  for (const t of AI_TRADERS) {
    if (t.state === 'in_city') maybeFireTraderBubble(t, dt);
  }
}

const TRADER_INTERACT_RADIUS = 40; // pixels — close enough to trade

function findNearestTrader(px, py) {
  let best = null, bestD = TRADER_INTERACT_RADIUS;
  for (const t of AI_TRADERS) {
    const d = Math.hypot(t.x - px, t.y - py);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function openTraderUI(trader) {
  // Show a quick trade modal — buy what they're carrying at a slight discount
  const cargoEntries = Object.entries(trader.inv).filter(([,q]) => q > 0);
  let content = '';
  if (cargoEntries.length === 0) {
    content = `<div style="color:#888;padding:10px 0">Their wagon is empty right now.</div>`;
  } else {
    content = cargoEntries.map(([itemId, qty]) => {
      const it = ITEMS.find(i => i.id === itemId);
      if (!it) return '';
      const marketBuy = quoteFor(trader.toId || trader.fromId, it).buy;
      const discountPrice = Math.max(1, Math.round(marketBuy * 0.88)); // 12% under market
      const canAfford = player.gold >= discountPrice;
      const hasSpace = invWeight() + it.weight <= player.capacity;
      return `
        <div style="background:#1a1508;border:1px solid #3a2e10;border-radius:6px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="color:#f0d080;font-weight:600">${it.name}</span>
            <span style="color:#888;font-size:11px;margin-left:6px">×${qty} available</span>
            <div style="color:#b0a060;font-size:11px">Market: ${marketBuy}g → Trader: <b style="color:#a0d060">${discountPrice}g</b></div>
          </div>
          <button data-buy="${itemId}" data-price="${discountPrice}" style="background:${canAfford&&hasSpace?'#2a4a10':'#2a2a2a'};border:1px solid ${canAfford&&hasSpace?'#4a8a20':'#444'};color:${canAfford&&hasSpace?'#90d040':'#666'};padding:4px 10px;border-radius:4px;cursor:${canAfford&&hasSpace?'pointer':'default'};font-size:12px">
            Buy 1
          </button>
        </div>`;
    }).join('');
  }

  let el = document.getElementById('cr-trader-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cr-trader-modal';
    el.style.cssText = `position:fixed;inset:0;z-index:810;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);font-family:system-ui,sans-serif`;
    document.body.appendChild(el);
  }

  const cargoLabel = cargoEntries.map(([id,q]) => {
    const it = ITEMS.find(i=>i.id===id);
    return it ? `${q}× ${it.name}` : '';
  }).filter(Boolean).join(', ') || 'empty wagon';

  el.innerHTML = `
    <div style="background:#100e08;border:2px solid #8b6914;border-radius:10px;padding:16px;width:min(340px,90vw);color:#e0cfa0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:15px;font-weight:700">🛒 ${htmlEscape(trader.name)}</span>
        <button id="cr-trader-close" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="color:#888;font-size:12px;margin-bottom:10px">
        ${trader.personality === 'aggressive' ? '⚔️ Aggressive trader' : trader.personality === 'cautious' ? '🛡️ Cautious merchant' : '🎲 Opportunist'}
        &nbsp;·&nbsp; Heading to <b style="color:#f0d080">${getCityById(trader.toId)?.name || trader.toId}</b>
        &nbsp;·&nbsp; Carrying: <span style="color:#b0c0a0">${cargoLabel}</span>
      </div>
      <div style="color:#666;font-size:11px;margin-bottom:8px">Items offered at 12% below market rate:</div>
      ${content}
      <div style="text-align:center;margin-top:8px">
        <button id="cr-trader-close2" style="background:none;border:1px solid #5a4a20;color:#888;padding:4px 16px;border-radius:5px;cursor:pointer;font-size:12px">Close [Esc]</button>
      </div>
    </div>`;

  el.querySelector('#cr-trader-close').onclick = closeTraderUI;
  el.querySelector('#cr-trader-close2').onclick = closeTraderUI;
  el.querySelectorAll('[data-buy]').forEach(btn => {
    btn.onclick = () => {
      const itemId = btn.dataset.buy;
      const price = Number(btn.dataset.price);
      const it = ITEMS.find(i => i.id === itemId);
      if (!it || player.gold < price) { toast('Not enough gold.', 2); return; }
      if (invWeight() + it.weight > player.capacity) { toast('No cargo space.', 2); return; }
      if ((trader.inv[itemId] || 0) <= 0) { toast('Sold out.', 2); return; }
      player.gold -= price;
      player.inv[itemId] = (player.inv[itemId] || 0) + 1;
      trader.inv[itemId]--;
      trader.gold += price;
      toast(`Bought 1 ${it.name} from ${trader.name} for ${price}g.`, 2.5);
      openTraderUI(trader); // refresh
    };
  });
}

function closeTraderUI() {
  const el = document.getElementById('cr-trader-modal');
  if (el) el.remove();
}

// ── Trader speech bubbles ("static") ─────────────────────────────────────────
const TRADER_STATIC = {
  aggressive: [
    'Out of my way!',
    'Time is gold.',
    'I\'ll cut you a deal — once.',
    'Move it or lose it.',
    'Profits don\'t wait.',
    'Faster than the tax man!',
  ],
  cautious: [
    'Steady trade, steady coin.',
    'Always check the road ahead.',
    'No rush — no losses.',
    'Is that bandit country?',
    'A safe route beats a fast one.',
    'Better safe than sorry.',
  ],
  opportunist: [
    'Where there\'s chaos, there\'s coin.',
    'I smell a bargain…',
    'The market never sleeps.',
    'Luck favours the prepared.',
    'Every trip\'s a gamble.',
    'Who needs a map?',
  ],
};

// Context-sensitive lines based on trader state
function getTraderContextLine(t) {
  const destName = getCityById(t.toId)?.name || t.toId;
  const fromName = getCityById(t.fromId)?.name || t.fromId;
  const it = ITEMS.find(i => i.id === t.itemId);
  const itemName = it ? it.name : 'goods';
  const cargoCount = Object.values(t.inv).reduce((a, b) => a + b, 0);

  if (t.state === 'in_city') {
    const lines = [
      `Restocking in ${fromName}…`,
      `${fromName} market is lively today.`,
      'Just arrived. Give me a moment.',
      `Looking for ${itemName} at a good price.`,
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }
  // Traveling
  if (cargoCount === 0) return `Heading to ${destName} empty — not ideal.`;
  const lines = [
    `Hauling ${cargoCount}× ${itemName} to ${destName}.`,
    `${destName} pays well for ${itemName}.`,
    `${Math.round(Math.hypot(t.x - (getCityById(t.toId)?.x||0)*TILE, t.y - (getCityById(t.toId)?.y||0)*TILE))}px to go…`,
    `${itemName} → ${destName}. Let's go.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

// Pick a line (mix context-sensitive + personality)
function pickTraderLine(t) {
  const useContext = Math.random() < 0.4;
  if (useContext) return getTraderContextLine(t);
  const pool = TRADER_STATIC[t.personality] || TRADER_STATIC.opportunist;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Active trader bubbles: Map<traderId, {text, untilMs}>
const _traderBubbles = new Map();

// Called from updateAiTraders to occasionally fire a quip
function maybeFireTraderBubble(t, dt) {
  // Don't fire if trader not visible
  const sx = t.x - camera.x, sy = t.y - camera.y;
  if (sx < -20 || sx > VIEW_W+20 || sy < -20 || sy > VIEW_H+20) return;

  // Timers stored on trader object
  if (t._bubbleTimer === undefined) t._bubbleTimer = 8 + Math.random() * 12 + (TRADER_DEFS.indexOf(TRADER_DEFS.find(d=>d.id===t.id))||0) * 3;
  t._bubbleTimer -= dt;
  if (t._bubbleTimer > 0) return;

  // Fire a bubble
  const text = pickTraderLine(t);
  _traderBubbles.set(t.id, { text, untilMs: stateTime + 2800 });

  // Next quip in 10–20s
  t._bubbleTimer = 10 + Math.random() * 10;
}

function drawTraderBubbles() {
  if (_traderBubbles.size === 0) return;

  const fontSize = Math.round(10 * UI_SCALE);
  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  for (const [traderId, bubble] of _traderBubbles) {
    if (stateTime > bubble.untilMs) { _traderBubbles.delete(traderId); continue; }
    const t = AI_TRADERS.find(tr => tr.id === traderId);
    if (!t) { _traderBubbles.delete(traderId); continue; }

    const sx = t.x - camera.x;
    const sy = t.y - camera.y;
    if (sx < -20 || sx > VIEW_W+40 || sy < -40 || sy > VIEW_H+20) continue;

    const maxW = IS_MOBILE ? Math.min(180, VIEW_W - 20) : 220;
    const pad = 9;
    const maxTextW = Math.max(40, maxW - pad * 2);
    const line = ellipsizeText(bubble.text, maxTextW);
    const tw = Math.min(maxW, ctx.measureText(line).width + pad * 2);
    const th = Math.round(17 * UI_SCALE);

    let bx = sx - tw / 2;
    let by = sy - t.radius - th - 14;
    if (IS_MOBILE && by < HUD_H + 6) by = sy + t.radius + 6;
    bx = clamp(bx, 8, VIEW_W - tw - 8);
    by = clamp(by, HUD_H + 6, VIEW_H - th - 8);

    // Alpha fade near end
    const remaining = bubble.untilMs - stateTime;
    const alpha = remaining < 400 ? remaining / 400 : 1;
    ctx.globalAlpha = alpha;

    // Bubble background — tinted by trader color
    ctx.fillStyle = 'rgba(12,10,6,0.88)';
    ctx.strokeStyle = t.color || 'rgba(200,160,60,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw, th, 8);
    else ctx.rect(bx, by, tw, th);
    ctx.fill();
    ctx.stroke();

    // Tail triangle
    const tx = clamp(sx, bx + 8, bx + tw - 8);
    ctx.fillStyle = 'rgba(12,10,6,0.88)';
    ctx.beginPath();
    ctx.moveTo(tx - 5, by + th);
    ctx.lineTo(tx + 5, by + th);
    ctx.lineTo(tx, by + th + 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = t.color || 'rgba(200,160,60,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.fillStyle = '#e8d89a';
    ctx.textBaseline = 'middle';
    ctx.fillText(line, bx + pad, by + th / 2);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawAiTrader(t) {
  const sx = t.x - camera.x;
  const sy = t.y - camera.y;
  if (sx < -20 || sx > VIEW_W+20 || sy < -20 || sy > VIEW_H+20) return;

  ctx.save();
  ctx.translate(sx, sy);
  const r = t.radius;

  // AI traders always appear as carriages (parked or traveling)
  const moving = t.state === 'traveling';
  const inCity = t.state === 'in_city';
  const facing = t.facing || { x: 1, y: 0 };
  const angle = Math.atan2(facing.y, facing.x);

  // Rotate toward movement direction
  ctx.rotate(angle - Math.PI / 2);

  const W = r * 1.4;
  const H = W * 1.5;

  // Shadow
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, H * 0.6, W * 1.2, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // ── Horse (only when traveling, not parked in city) ────────────────
  if (!inCity) {
    const horseY = -(H * 0.45 + W * 0.7);
    ctx.fillStyle = '#7a5c3a';
    ctx.fillRect(-W * 0.3, horseY - W * 0.35, W * 0.6, W * 0.75);
    ctx.fillStyle = '#6b4e2e';
    ctx.fillRect(-W * 0.12, horseY - W * 0.8, W * 0.24, W * 0.45);
    ctx.fillStyle = '#4a3020';
    ctx.fillRect(-W * 0.04, horseY - W * 0.85, W * 0.12, W * 0.3);
    const legSwing = moving ? Math.sin(stateTime * 0.015 + hashStr(t.id) * 0.5) * 2 : 0;
    ctx.fillStyle = '#5a4025';
    ctx.fillRect(-W * 0.22, horseY + W * 0.3 + legSwing, W * 0.1, W * 0.4);
    ctx.fillRect(-W * 0.06, horseY + W * 0.3 - legSwing, W * 0.1, W * 0.4);
    ctx.fillRect(W * 0.06, horseY + W * 0.3 + legSwing, W * 0.1, W * 0.4);
    // Harness
    ctx.strokeStyle = '#3a2510'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-W * 0.2, horseY + W * 0.15);
    ctx.lineTo(-W * 0.35, -H * 0.3);
    ctx.moveTo(W * 0.2, horseY + W * 0.15);
    ctx.lineTo(W * 0.35, -H * 0.3);
    ctx.stroke();
  }

  // ── Carriage body ──────────────────────────────────────────────────
  const bodyColor = t.color || '#8b5e2a';
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-W * 0.75, -H * 0.45, W * 1.5, H * 0.72);
  // Roof
  ctx.fillStyle = 'rgba(30,20,10,0.6)';
  ctx.fillRect(-W * 0.7, -H * 0.45, W * 1.4, H * 0.18);
  // Canvas cover (personality-colored)
  ctx.fillStyle = `${t.color || '#d97706'}44`;
  ctx.fillRect(-W * 0.62, -H * 0.45, W * 1.24, H * 0.2);
  // Trim
  ctx.strokeStyle = 'rgba(255,200,80,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-W * 0.75, -H * 0.45, W * 1.5, H * 0.72);
  // Cargo bump (if carrying goods)
  const hasGoods = Object.values(t.inv || {}).some(q => q > 0);
  if (hasGoods) {
    ctx.fillStyle = 'rgba(180,140,60,0.6)';
    ctx.fillRect(-W * 0.5, -H * 0.5, W, H * 0.08);
  }

  // Parked in city: draw a small merchant figure beside carriage
  if (inCity) {
    // Wheel chock (wooden block under wheel)
    ctx.fillStyle = '#5a3a15';
    ctx.fillRect(-W * 0.85, H * 0.28, W * 0.22, W * 0.2);
    ctx.fillRect(W * 0.62, H * 0.28, W * 0.22, W * 0.2);
    // Merchant standing beside
    ctx.fillStyle = t.color || '#d97706';
    ctx.fillRect(W * 0.85, -H * 0.2, W * 0.35, H * 0.5); // body
    ctx.fillStyle = '#c8a87a';
    ctx.beginPath(); ctx.arc(W * 1.02, -H * 0.28, W * 0.22, 0, Math.PI * 2); ctx.fill(); // head
  }

  // ── Wheels ─────────────────────────────────────────────────────────
  const wheelAngle = moving ? (stateTime * 0.01) : 0;
  const drawWheel = (wx, wy, wr) => {
    ctx.fillStyle = '#2a1808';
    ctx.beginPath(); ctx.arc(wx, wy, wr, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#5a3a15';
    ctx.beginPath(); ctx.arc(wx, wy, wr * 0.6, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 1.5;
    for (let s = 0; s < 4; s++) {
      const sa = wheelAngle + s * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(wx + Math.cos(sa) * wr * 0.55, wy + Math.sin(sa) * wr * 0.55);
      ctx.lineTo(wx - Math.cos(sa) * wr * 0.55, wy - Math.sin(sa) * wr * 0.55);
      ctx.stroke();
    }
    ctx.fillStyle = t.color || '#d97706';
    ctx.beginPath(); ctx.arc(wx, wy, wr * 0.16, 0, Math.PI*2); ctx.fill();
  };
  drawWheel(-W * 0.65, H * 0.24, W * 0.42);
  drawWheel(W * 0.65, H * 0.24, W * 0.42);

  // ── Name label ─────────────────────────────────────────────────────
  // Undo rotation for text so it's always readable
  ctx.restore();
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(-22, -r*2.2-10, 44, 12);
  ctx.fillStyle = t.color || '#f0d080';
  ctx.font = `bold ${Math.round(8*UI_SCALE)}px system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(t.name.split(' ')[0], 0, -r*2.2);
  ctx.textAlign = 'left';

  // Interact hint
  const dist = Math.hypot(t.x - player.x, t.y - player.y);
  if (dist < TRADER_INTERACT_RADIUS) {
    ctx.fillStyle = 'rgba(251,191,36,0.9)';
    ctx.font = `${Math.round(9*UI_SCALE)}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('[T] Trade', 0, -r*2.8);
    ctx.textAlign = 'left';
  }

  ctx.restore();
}

function npcCityBounds(city) {
  // Keep NPCs 1.5 tiles inside the perimeter walls (avoid wall edge)
  const pad = Math.round(TILE * 1.5);
  return {
    x1: city.x * TILE + pad,
    y1: city.y * TILE + pad,
    x2: (city.x + city.w) * TILE - pad,
    y2: (city.y + city.h) * TILE - pad,
  };
}

function npcSeed(id, salt = 0, salt2 = 0) {
  return seeded01(hashStr(id) + salt, salt2, npcDayKey());
}

// ─────────────────────────────────────────────
// NPC BEHAVIOR SYSTEM
// Each NPC has a role-based behavior with named waypoints (tile-relative to city origin).
// Behaviors: 'patrol', 'routine', 'pace', 'dock', 'lurk'
// ─────────────────────────────────────────────

/**
 * Build purposeful waypoints for an NPC based on role + city layout.
 * Waypoints are in world pixels.
 * Each waypoint: { x, y, pauseMs }  — pauseMs: how long to idle at this point.
 */
function buildNpcWaypoints(role, city) {
  const T = TILE;
  // city origin in pixels
  const cx = city.x * T;
  const cy = city.y * T;
  const cw = city.w * T;
  const ch = city.h * T;
  // key landmark offsets (relative to city pixel origin)
  const center   = { x: cx + cw * 0.50, y: cy + ch * 0.50 };
  const market   = { x: cx + cw * 0.35, y: cy + ch * 0.38 };
  const gate     = { x: cx + cw * 0.50, y: cy + ch * 0.92 }; // near bottom exit
  const wallNE   = { x: cx + cw * 0.82, y: cy + ch * 0.18 };
  const wallNW   = { x: cx + cw * 0.18, y: cy + ch * 0.18 };
  const wallSE   = { x: cx + cw * 0.82, y: cy + ch * 0.75 };
  const office   = { x: cx + cw * 0.22, y: cy + ch * 0.28 };
  const restArea = { x: cx + cw * 0.65, y: cy + ch * 0.70 };
  const oven     = { x: cx + cw * 0.30, y: cy + ch * 0.62 };
  const dockEdge = { x: cx + cw * 0.75, y: cy + ch * 0.85 };
  const dockMid  = { x: cx + cw * 0.60, y: cy + ch * 0.72 };
  const cornerSW = { x: cx + cw * 0.15, y: cy + ch * 0.80 };
  const cornerNE = { x: cx + cw * 0.80, y: cy + ch * 0.20 };
  const alley    = { x: cx + cw * 0.80, y: cy + ch * 0.60 };

  const wp = (pt, pauseMs = 800) => ({ x: pt.x, y: pt.y, pauseMs });

  switch (role) {
    case 'guard_post':
      // Stand at gate — one waypoint with very long pause. Slight jitter from NPC id separates them.
      return [ wp(gate, 30000) ];

    case 'guard':
      // Patrol: gate → wall NW → wall NE → market check → wall SE → gate
      return [
        wp(gate, 1200),
        wp(wallNW, 700),
        wp(wallNE, 700),
        wp(market, 1500),  // lingers at market
        wp(wallSE, 700),
        wp(gate, 1200),
      ];

    case 'scribe':
      // Routine: office → market (morning) → center (midday) → rest area (afternoon) → office
      return [
        wp(office, 2000),
        wp(market, 1800),
        wp(center, 1200),
        wp(restArea, 2500),
        wp(office, 1500),
      ];

    case 'baker':
      // Bakes in the morning (oven), sells at market midday, wanders back
      return [
        wp(oven, 3000),     // standing at oven a while
        wp(market, 2000),   // selling wares
        wp(center, 1000),
        wp(oven, 2500),
      ];

    case 'fisher':
      // Dock → city center → dock. Long pauses at water edge.
      return [
        wp(dockEdge, 3500),
        wp(dockMid, 1000),
        wp(center, 1500),
        wp(dockMid, 800),
        wp(dockEdge, 3000),
      ];

    case 'smuggler':
      // Skulks perimeter quickly, brief lurks at corners and alleys
      return [
        wp(cornerSW, 400),
        wp(alley, 300),
        wp(cornerNE, 400),
        wp(gate, 600),     // watches the gate
        wp(alley, 300),
        wp(cornerSW, 500),
      ];

    case 'merchant':
      // Paces back and forth near market stalls
      return [
        wp(market, 2000),
        wp({ x: market.x - 14, y: market.y + 8 }, 800),
        wp({ x: market.x + 14, y: market.y - 8 }, 800),
        wp(market, 1800),
      ];

    case 'broker':
      // Short pacing near market, occasional wander to center
      return [
        wp(market, 2500),
        wp({ x: market.x + 12, y: market.y + 20 }, 600),
        wp({ x: market.x - 16, y: market.y - 12 }, 600),
        wp(center, 1200),
        wp(market, 2000),
      ];

    case 'innkeeper':
      // Paces between inn and market, long pause at inn
      return [
        wp({ x: cx + cw * 0.65, y: cy + ch * 0.25 }, 3000), // at inn
        wp(market, 1200),
        wp(center, 800),
        wp({ x: cx + cw * 0.65, y: cy + ch * 0.25 }, 2500),
      ];

    case 'peddler':
      // Wanders all around city selling wares
      return [
        wp(market, 1500),
        wp(center, 800),
        wp({ x: cx + cw * 0.2, y: cy + ch * 0.7 }, 600),
        wp({ x: cx + cw * 0.75, y: cy + ch * 0.65 }, 600),
        wp(gate, 800),
        wp(market, 1200),
      ];

    case 'miner':
      // Short patrol: warehouse → gate → back
      return [
        wp({ x: cx + cw * 0.50, y: cy + ch * 0.60 }, 1500), // warehouse
        wp(gate, 600),
        wp(center, 700),
        wp({ x: cx + cw * 0.50, y: cy + ch * 0.60 }, 2000),
      ];

    case 'foreman':
      // Big patrol loop around the whole city
      return [
        wp(gate, 1000),
        wp(wallNW, 500),
        wp({ x: cx + cw * 0.50, y: cy + ch * 0.60 }, 800), // warehouse check
        wp(wallNE, 500),
        wp(wallSE, 500),
        wp(market, 1000),
        wp(gate, 800),
      ];

    case 'smith':
      // Stays near warehouse/forge, occasional market walk
      return [
        wp({ x: cx + cw * 0.50, y: cy + ch * 0.60 }, 3500), // forge
        wp({ x: cx + cw * 0.52, y: cy + ch * 0.62 }, 500),  // pacing
        wp(market, 1200),
        wp({ x: cx + cw * 0.50, y: cy + ch * 0.60 }, 3000),
      ];

    default:
      // Fallback: simple 4-corner wander
      return [
        wp(center, 1000),
        wp({ x: cx + cw * 0.3, y: cy + ch * 0.3 }, 800),
        wp({ x: cx + cw * 0.7, y: cy + ch * 0.7 }, 800),
      ];
  }
}

/**
 * Find the nearest passable pixel position to (tx, ty) within maxDist.
 * Searches in a spiral to avoid walls.
 */
function npcFindWalkable(tx, ty, radius, maxDist = TILE * 3) {
  if (!npcBlockedAt(tx, ty, radius)) return { x: tx, y: ty };
  for (let d = TILE; d <= maxDist; d += TILE) {
    const offsets = [
      [d, 0], [-d, 0], [0, d], [0, -d],
      [d, d], [-d, d], [d, -d], [-d, -d],
    ];
    for (const [ox, oy] of offsets) {
      if (!npcBlockedAt(tx + ox, ty + oy, radius)) return { x: tx + ox, y: ty + oy };
    }
  }
  return null; // totally blocked — caller will skip
}

function npcPickTarget(e) {
  // Role-based: advance to next waypoint
  if (e.waypoints && e.waypoints.length > 0) {
    e.waypointIdx = ((e.waypointIdx || 0) + 1) % e.waypoints.length;
    const wp = e.waypoints[e.waypointIdx];

    // Tiny jitter so NPCs on same route don't stack (much smaller than before)
    const jitter = TILE * 0.2;
    const jx = wp.x + (seeded01(hashStr(e.id), e.waypointIdx, 17) - 0.5) * 2 * jitter;
    const jy = wp.y + (seeded01(hashStr(e.id), e.waypointIdx, 31) - 0.5) * 2 * jitter;

    // Clamp to bounds first
    const cx = clamp(jx, e.bounds.x1, e.bounds.x2);
    const cy = clamp(jy, e.bounds.y1, e.bounds.y2);

    // Find nearest walkable point (avoids walls)
    const walkable = npcFindWalkable(cx, cy, e.radius);
    if (walkable) {
      e.target = walkable;
      e.pendingPauseMs = wp.pauseMs || 800;
    } else {
      // Can't reach this waypoint — skip to next one next frame
      e.target = { x: e.x, y: e.y };
      e.pendingPauseMs = 200;
    }
    e.nextWanderAt = stateTime + 99999; // set after arrival
    return;
  }

  // Fallback: pick a random walkable point within bounds
  const b = e.bounds;
  for (let attempt = 0; attempt < 8; attempt++) {
    const t = Math.floor(stateTime / 1000) + attempt;
    const rx = seeded01(hashStr(e.id), t, 11 + attempt);
    const ry = seeded01(hashStr(e.id), t, 37 + attempt);
    const tx = b.x1 + rx * (b.x2 - b.x1);
    const ty = b.y1 + ry * (b.y2 - b.y1);
    if (!npcBlockedAt(tx, ty, e.radius)) {
      e.target = { x: tx, y: ty };
      e.nextWanderAt = stateTime + 1600 + seeded01(hashStr(e.id), t, 99) * 1200;
      return;
    }
  }
  // Give up and stay put briefly
  e.target = { x: e.x, y: e.y };
  e.nextWanderAt = stateTime + 600;
}

function npcBlockedAt(px, py, r) {
  return (
    isSolidAt(px - r, py - r) ||
    isSolidAt(px + r, py - r) ||
    isSolidAt(px - r, py + r) ||
    isSolidAt(px + r, py + r)
  );
}

function spawnCityNPCs(cityId) {
  entities.length = 0;
  activeNpcCityId = cityId || null;
  if (!cityId) return;
  const city = getCityById(cityId);
  if (!city) return;
  const templates = CITY_ENTITY_TEMPLATES[cityId] || [];
  const b = npcCityBounds(city);
  // Gate pixel position: south-center of the city, just inside walls
  const gateWorldX = (city.x + Math.floor(city.w / 2)) * TILE;
  const gateWorldY = (city.y + city.h - 2) * TILE;  // 2 tiles from south wall inside
  let guardPostCount = 0; // track how many guard_posts placed for offset
  for (const tpl of templates) {
    let x, y;
    if (tpl.role === 'guard_post') {
      // Place guards flanking the gate — left/right of center, 3 tiles apart, inside city
      const side = guardPostCount === 0 ? -1 : 1;
      guardPostCount++;
      x = gateWorldX + side * TILE * 2.5;  // far enough left/right to not block the lane
      y = gateWorldY - TILE * 1.5;         // one step inside the city
      // Nudge inward if blocked
      for (let nudge = 0; nudge <= TILE * 4; nudge += TILE) {
        if (!npcBlockedAt(x, y - nudge, tpl.radius)) { y -= nudge; break; }
      }
    } else {
      x = (city.x + city.w / 2) * TILE;
      y = (city.y + city.h / 2) * TILE;
      for (let i = 0; i < 16; i++) {
        const rx = seeded01(hashStr(tpl.id), i, 7);
        const ry = seeded01(hashStr(tpl.id), i, 13);
        const nx = b.x1 + rx * (b.x2 - b.x1);
        const ny = b.y1 + ry * (b.y2 - b.y1);
        if (!npcBlockedAt(nx, ny, tpl.radius)) {
          x = nx; y = ny; break;
        }
      }
    }
    const waypoints = buildNpcWaypoints(tpl.role, city);
    // Stagger starting waypoint so NPCs don't all converge at once
    const startIdx = Math.floor(seeded01(hashStr(tpl.id), 77, 3) * waypoints.length);
    const e = {
      id: tpl.id,
      kind: 'npc',
      role: tpl.role,
      style: tpl.style,
      cityId,
      x,
      y,
      vx: 0,
      vy: 0,
      speed: tpl.speed,
      radius: tpl.radius,
      bounds: b,
      target: null,
      nextWanderAt: 0,
      waypoints,
      waypointIdx: startIdx,
      pauseUntil: 0,
      pendingPauseMs: 0,
      dialogueIdx: Math.floor(npcSeed(tpl.id, 3, 5) * 10) % 10,
      talkCooldown: 0,
    };
    // Set initial target to first waypoint
    const wp0 = waypoints[startIdx];
    e.target = { x: wp0.x, y: wp0.y };
    entities.push(e);
  }
}

const NPC_ARRIVAL_THRESHOLD = 10; // pixels — within this, NPC has "arrived" at waypoint
const NPC_STUCK_THRESHOLD = 12;   // pixels — if NPC barely moved in 1.5s, it's stuck

function updateEntities(dt) {
  if (!entities.length) return;
  for (const e of entities) {
    if (e.kind !== 'npc') continue;
    if (!e.bounds) continue;

    // ── Pausing at waypoint ──────────────────────────────────────────────
    if (e.pauseUntil > stateTime) {
      // Drift back to exact waypoint position while paused (looks more natural)
      if (e.target) {
        const pdrift = Math.hypot(e.target.x - e.x, e.target.y - e.y);
        if (pdrift > 2) {
          const ddx = (e.target.x - e.x) / pdrift;
          const ddy = (e.target.y - e.y) / pdrift;
          const snx = e.x + ddx * e.speed * 0.3 * dt;
          const sny = e.y + ddy * e.speed * 0.3 * dt;
          if (!npcBlockedAt(snx, e.y, e.radius)) e.x = snx;
          if (!npcBlockedAt(e.x, sny, e.radius)) e.y = sny;
        }
      }
      e.x = clamp(e.x, e.bounds.x1, e.bounds.x2);
      e.y = clamp(e.y, e.bounds.y1, e.bounds.y2);
      continue;
    }

    // ── Need new target? ─────────────────────────────────────────────────
    if (!e.target || stateTime >= e.nextWanderAt) npcPickTarget(e);

    const dx = e.target.x - e.x;
    const dy = e.target.y - e.y;
    const dist = Math.hypot(dx, dy);

    // Arrived at waypoint — start pause
    if (dist < NPC_ARRIVAL_THRESHOLD) {
      if (e.pendingPauseMs > 0) {
        e.pauseUntil = stateTime + e.pendingPauseMs;
        e.pendingPauseMs = 0;
        e.nextWanderAt = e.pauseUntil;
      } else {
        // No pause defined — go straight to next waypoint
        npcPickTarget(e);
      }
      continue;
    }

    // ── Stuck detection ──────────────────────────────────────────────────
    if (!e._stuckCheckT) { e._stuckCheckT = stateTime; e._stuckCheckX = e.x; e._stuckCheckY = e.y; }
    if (stateTime - e._stuckCheckT > 1500) {
      const moved = Math.hypot(e.x - e._stuckCheckX, e.y - e._stuckCheckY);
      if (moved < NPC_STUCK_THRESHOLD) {
        // Stuck — skip to next waypoint
        npcPickTarget(e);
        e._stuckCheckT = stateTime;
        e._stuckCheckX = e.x;
        e._stuckCheckY = e.y;
        continue;
      }
      e._stuckCheckT = stateTime;
      e._stuckCheckX = e.x;
      e._stuckCheckY = e.y;
    }

    // ── Movement with wall-sliding ───────────────────────────────────────
    let vx = dist > 0 ? (dx / dist) * e.speed : 0;
    let vy = dist > 0 ? (dy / dist) * e.speed : 0;

    // Soft repulsion from player
    const pdx = e.x - player.x;
    const pdy = e.y - player.y;
    const pd = Math.hypot(pdx, pdy);
    const pr = e.radius + player.r + 8;
    if (pd > 0 && pd < pr) {
      const push = (pr - pd) * 2.0;
      vx += (pdx / pd) * push;
      vy += (pdy / pd) * push;
    }

    // Soft repulsion from other NPCs
    for (const o of entities) {
      if (o === e || o.kind !== 'npc') continue;
      const odx = e.x - o.x;
      const ody = e.y - o.y;
      const od = Math.hypot(odx, ody);
      const or = e.radius + o.radius + 4;
      if (od > 0 && od < or) {
        const push = (or - od) * 1.4;
        vx += (odx / od) * push;
        vy += (ody / od) * push;
      }
    }

    // Normalise to max speed
    const spd = Math.hypot(vx, vy);
    if (spd > e.speed * 1.5) { vx = vx/spd * e.speed * 1.5; vy = vy/spd * e.speed * 1.5; }

    // Wall-sliding: try full move, then axis-only fallbacks
    const stepX = vx * dt;
    const stepY = vy * dt;
    const canX = !npcBlockedAt(e.x + stepX, e.y, e.radius);
    const canY = !npcBlockedAt(e.x, e.y + stepY, e.radius);
    if (canX && canY) { e.x += stepX; e.y += stepY; }
    else if (canX)    { e.x += stepX; }           // slide along X
    else if (canY)    { e.y += stepY; }           // slide along Y
    // else fully blocked this frame — stuck detection will handle it

    e.x = clamp(e.x, e.bounds.x1, e.bounds.x2);
    e.y = clamp(e.y, e.bounds.y1, e.bounds.y2);
  }
}

function findNearestNpc(px, py, radius = NPC_INTERACT_RADIUS) {
  let best = null;
  let bestD2 = radius * radius;
  for (const e of entities) {
    if (e.kind !== 'npc') continue;
    const dx = e.x - px;
    const dy = e.y - py;
    const d2 = dx*dx + dy*dy;
    if (d2 <= bestD2) { bestD2 = d2; best = e; }
  }
  return best;
}



function findNearestOpenTile(px, py, maxR = 5) {
  const cx = Math.floor(px / TILE);
  const cy = Math.floor(py / TILE);
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 1 || ty < 1 || tx >= MAP_W-1 || ty >= MAP_H-1) continue;
        const x = (tx + 0.5) * TILE;
        const y = (ty + 0.5) * TILE;
        if (!npcOverlapAt(x, y) && canPlacePlayer(x, y) && !isSolidAt(x, y)) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

function npcDiagTick(dt) {
  const d = ui.npcDiag;
  if (!d || !d.enabled) return;

  d.tick += 1;
  d.lastTickAt = performance.now();
  if (d.result !== 'pending') return;

  if (d.state === 'init') {
    ui.marketOpen = false; ui.contractsOpen = false; ui.eventOpen = false;
    const c = getCityById('valdenmere') || currentCity();
    if (!c) { d.note = 'no city'; return; }
    player.x = (c.x + Math.floor(c.w / 2)) * TILE;
    player.y = (c.y + Math.floor(c.h / 2)) * TILE;
    camera.x = player.x - VIEW_W/2;
    camera.y = player.y - VIEW_H/2;
    player.lastCityId = null;
    spawnCityNPCs(c.id);
    const open = findNearestOpenTile(player.x, player.y, 6);
    if (open) { player.x = open.x; player.y = open.y; camera.x = player.x - VIEW_W/2; camera.y = player.y - VIEW_H/2; }
    d.state = 'approach';
    d.t0 = stateTime;
    return;
  }

  if (d.state === 'approach') {
    const npc = entities.find(e => e.kind === 'npc');
    if (!npc) { d.result = 'fail'; d.note = 'no npc'; return; }
    d.npcId = npc.id;
    const minD = player.r + npc.radius + 2;
    player.x = npc.x + minD;
    player.y = npc.y;
    d.pos0 = { x: player.x, y: player.y };
    d.state = 'talk';
    return;
  }

  if (d.state === 'talk') {
    const npc = entities.find(e => e.kind === 'npc' && e.id === d.npcId);
    if (!npc) { d.result = 'fail'; d.note = 'npc missing'; return; }
    // simulate actual mobile input path
    vkeys.add('KeyE');
    d.lastInput = 'KeyE';
    d.pos0 = { x: player.x, y: player.y };
    d.t0 = stateTime;
    d.state = 'waitbubble';
    return;
  }

  if (d.state === 'waitbubble') {
    d.bubble = !!ui.npcBubble;
    if (d.bubble) {
      d.t0 = stateTime;
      d.state = 'move';

      return;
    }
    if (stateTime - d.t0 > 1.2) {
      d.result = 'fail';
      d.note = 'no bubble';
      d.state = 'done';
    }
    return;
  }

  if (d.state === 'move') {
    // diag-only: simulate real movement input (ArrowRight)
    vkeys.add('ArrowRight');
    d.lastInput = 'ArrowRight';
    player.npcGhostUntil = Math.max(player.npcGhostUntil || 0, stateTime + 800);
    return;
  }
}

function npcDiagPostMove() {
  const d = ui.npcDiag;
  if (!d || !d.enabled) return;
  if (d.state !== 'move') return;

  const dx = player.x - (d.pos0?.x ?? player.x);
  const dy = player.y - (d.pos0?.y ?? player.y);
  d.delta = Math.hypot(dx, dy);

  if (stateTime - d.t0 > 1.2) {
    vkeys.delete('ArrowRight');
    d.passCheck = (d.delta >= 5.5 && d.tick > 10);
    if (d.delta >= 5.5) {
      d.result = 'pass';
      d.note = '';
      d.passCheck = true;
    } else {
      d.result = 'fail';
      d.note = 'no movement';
    }
    d.state = 'done';
  }
}

function triggerNpcTalk(npc) {
  if (!npc) return false;
  if (npc.talkCooldown && stateTime < npc.talkCooldown) return false;
  resolvePlayerNpcOverlap();
  player.npcGhostUntil = stateTime + 800;
  if (IS_MOBILE) player.npcGhostUntil = Math.max(player.npcGhostUntil, stateTime + 1500);

  // Every other interaction, offer the intel market (skip in QA mode)
  if (!__QA.enabled) {
    npc.intelToggle = !npc.intelToggle;
    if (npc.intelToggle && npc.cityId) {
      const c = currentCity();
      if (c) {
        // Show brief intel prompt in bubble, then open modal after delay
        ui.npcBubble = { npcId: npc.id, text: `Psst... I know things. Want a tip? (${INTEL_BUY_COST}g) [E again]`, untilMs: stateTime + 3000 };
        npc.talkCooldown = stateTime + 400; // short cooldown so second E opens modal
        npc.pendingIntel = true;
        return true;
      }
    }

    if (npc.pendingIntel) {
      npc.pendingIntel = false;
      const c = currentCity();
      if (c) {
        openIntelUI(npc, c.id);
        npc.talkCooldown = stateTime + 2000;
        return true;
      }
    }
  }

  const lines = getNpcLines(npc.cityId, npc.id);
  npc.dialogueIdx = (npc.dialogueIdx + 1) % lines.length;
  const text = lines[npc.dialogueIdx];
  ui.npcBubble = { npcId: npc.id, text, untilMs: stateTime + 2400 };
  npc.talkCooldown = stateTime + 1200;
  return true;
}

// ─────────────────────────────────────────────
// INTELLIGENCE MARKET
// ─────────────────────────────────────────────

const INTEL_BUY_COST = 5;   // gold to buy a tip
const INTEL_SELL_PRICE = 3; // gold for selling stale intel to another city
const INTEL_EXPIRY_DAYS = 4; // intel is valid for 4 days

/** Generate an intel tip from npc at cityId */
function generateIntel(npc, cityId) {
  const otherCities = world.cities.filter(c => c.id !== cityId);
  const otherCity = (otherCities[Math.floor(rand01() * otherCities.length)] || world.cities[1]).id;
  // Pick a random item
  const item = ITEMS[Math.floor(rand01() * ITEMS.length)];
  const currentPrice = priceFor(otherCity, item);
  // Predict: reliable NPCs give exact price, unreliable ones add noise
  const reliable = rand01() > 0.35; // 65% chance of accurate intel
  let predicted = currentPrice;
  if (!reliable) {
    // Misleading ±20-40%
    const noiseDir = rand01() > 0.5 ? 1 : -1;
    predicted = Math.max(1, Math.round(currentPrice * (1 + noiseDir * (0.2 + rand01() * 0.2))));
  }
  const direction = predicted > currentPrice ? 'high' : predicted < currentPrice ? 'low' : 'stable';
  return {
    id: `intel_${Date.now()}_${Math.floor(rand01() * 9999)}`,
    item: item.id,
    itemName: item.name,
    cityId: otherCity,
    cityName: getCityById(otherCity)?.name || otherCity,
    predictedPrice: predicted,
    truePrice: currentPrice,
    direction,
    boughtDay: Math.floor(time.day),
    expiryDay: Math.floor(time.day) + INTEL_EXPIRY_DAYS,
    reliable,
    sold: false,
    verified: false,
    sourceNpcId: npc.id,
    sourceCityId: cityId,
  };
}

function buyIntel(npc, cityId) {
  if (player.gold < INTEL_BUY_COST) {
    toast(`Need ${INTEL_BUY_COST}g to buy intel.`, 2);
    return false;
  }
  // Limit ledger to 6 active tips
  const active = player.intelLedger.filter(c => !c.sold && c.expiryDay >= Math.floor(time.day));
  if (active.length >= 6) {
    toast('Intel ledger full! Sell or wait for tips to expire.', 2.5);
    return false;
  }
  player.gold -= INTEL_BUY_COST;
  const card = generateIntel(npc, cityId);
  player.intelLedger.push(card);
  saveGame();
  toast(`Intel bought: "${card.itemName}" in ${card.cityName} — ${INTEL_BUY_COST}g paid.`, 3);
  return card;
}

function sellIntel(cardId, buyerCityId) {
  const card = player.intelLedger.find(c => c.id === cardId);
  if (!card || card.sold) { toast('No such intel to sell.', 2); return false; }
  if (card.sourceCityId === buyerCityId) {
    toast('That merchant already knows this.', 2);
    return false;
  }
  card.sold = true;
  player.gold += INTEL_SELL_PRICE;
  player.intelSells = (player.intelSells || 0) + 1;
  saveGame();
  toast(`Sold intel for ${INTEL_SELL_PRICE}g.`, 2);
  return true;
}

/** Check intel on day advance — reward bonus if correct */
function verifyExpiredIntel() {
  const today = Math.floor(time.day);
  for (const card of player.intelLedger) {
    if (card.verified || card.sold) continue;
    if (card.expiryDay < today) {
      const actualPrice = priceFor(card.cityId, ITEMS.find(it => it.id === card.item) || ITEMS[0]);
      const diff = Math.abs(actualPrice - card.predictedPrice);
      const pct = diff / Math.max(1, card.truePrice);
      if (pct < 0.12) { // within 12% — intel was good
        card.verified = true;
        player.gold += 4;
        toast(`Intel verified: ${card.itemName} was ~correct! +4g bonus.`, 3);
      }
    }
  }
  // Prune old expired ledger (keep last 10)
  player.intelLedger = player.intelLedger.slice(-10);
}

// NPC Intel UI state
const intelUI = {
  open: false,
  npc: null,
  cityId: null,
  tab: 'buy', // 'buy' | 'ledger'
};

function openIntelUI(npc, cityId) {
  intelUI.open = true;
  intelUI.npc = npc;
  intelUI.cityId = cityId;
  intelUI.tab = 'buy';
  renderIntelModal();
}

function closeIntelUI() {
  intelUI.open = false;
  intelUI.npc = null;
  const el = document.getElementById('cr-intel-modal');
  if (el) el.remove();
}

function renderIntelModal() {
  let el = document.getElementById('cr-intel-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cr-intel-modal';
    el.style.cssText = `
      position:fixed; inset:0; z-index:800; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.55); font-family:system-ui,sans-serif;
    `;
    document.body.appendChild(el);
  }

  const today = Math.floor(time.day);
  const activeCards = player.intelLedger.filter(c => !c.sold && c.expiryDay >= today);
  const sellableCards = player.intelLedger.filter(c =>
    !c.sold && c.sourceCityId !== (intelUI.cityId || '') && c.expiryDay >= today
  );

  const dirIcon = d => d === 'high' ? '📈' : d === 'low' ? '📉' : '➡️';
  const dirLabel = d => d === 'high' ? 'Rising' : d === 'low' ? 'Falling' : 'Stable';

  const ledgerRows = activeCards.length === 0
    ? `<div style="color:#888;padding:12px 0;text-align:center">No intel in ledger. Buy some tips!</div>`
    : activeCards.map(c => {
      const daysLeft = c.expiryDay - today;
      const canSell = c.sourceCityId !== (intelUI.cityId || '');
      return `
        <div style="background:#1e1b14;border:1px solid #3a3420;border-radius:6px;padding:8px 10px;margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:600;color:#f0d080">${dirIcon(c.direction)} ${c.itemName}</span>
            <span style="color:#888;font-size:11px">${daysLeft}d left</span>
          </div>
          <div style="color:#b0a080;font-size:12px;margin-top:3px">
            In <b>${c.cityName}</b>: ~${c.predictedPrice}g (${dirLabel(c.direction)})
          </div>
          ${canSell ? `<button data-sell="${c.id}" style="margin-top:5px;background:#2a3a1a;border:1px solid #4a6a2a;color:#a0d060;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px">Sell for ${INTEL_SELL_PRICE}g</button>` : `<span style="font-size:10px;color:#555">Same city — can't sell here</span>`}
        </div>
      `;
    }).join('');

  el.innerHTML = `
    <div style="background:#14110c;border:2px solid #5a4a20;border-radius:10px;padding:16px;width:min(340px,90vw);max-height:80vh;overflow-y:auto;color:#e0cfa0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:15px;font-weight:700">🕵️ Intelligence Market</span>
        <button id="cr-intel-close" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <button data-tab="buy" style="flex:1;padding:5px;border-radius:5px;cursor:pointer;border:1px solid #5a4a20;background:${intelUI.tab==='buy'?'#3a2a0a':'#1a1508'};color:${intelUI.tab==='buy'?'#f0d080':'#a09060'}">Buy Tip (${INTEL_BUY_COST}g)</button>
        <button data-tab="ledger" style="flex:1;padding:5px;border-radius:5px;cursor:pointer;border:1px solid #5a4a20;background:${intelUI.tab==='ledger'?'#3a2a0a':'#1a1508'};color:${intelUI.tab==='ledger'?'#f0d080':'#a09060'}">Ledger (${activeCards.length})</button>
      </div>
      ${intelUI.tab === 'buy' ? `
        <div style="color:#b0a080;font-size:13px;margin-bottom:10px;line-height:1.5">
          Pay <b style="color:#f0d080">${INTEL_BUY_COST}g</b> to learn about price movements in the other city.
          Reliable tips come with a 12% accuracy bonus when verified.
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="color:#888;font-size:12px">Your gold: ${player.gold}g</span>
          <span style="color:#888;font-size:12px">Ledger slots: ${activeCards.length}/6</span>
        </div>
        <button id="cr-intel-buy" style="width:100%;padding:8px;background:${player.gold>=INTEL_BUY_COST?'#3a5a1a':'#2a2a2a'};border:1px solid ${player.gold>=INTEL_BUY_COST?'#6a9a2a':'#444'};color:${player.gold>=INTEL_BUY_COST?'#c0e080':'#666'};border-radius:6px;cursor:${player.gold>=INTEL_BUY_COST?'pointer':'default'};font-size:14px">
          🪙 Buy Intelligence (${INTEL_BUY_COST}g)
        </button>
      ` : `
        <div style="color:#888;font-size:12px;margin-bottom:8px">
          Sell tips to merchants in other cities for ${INTEL_SELL_PRICE}g each.
        </div>
        ${ledgerRows}
      `}
      <div style="text-align:center;margin-top:10px">
        <button id="cr-intel-close2" style="background:none;border:1px solid #5a4a20;color:#888;padding:4px 16px;border-radius:5px;cursor:pointer;font-size:12px">Close [Esc]</button>
      </div>
    </div>
  `;

  el.querySelector('#cr-intel-close').onclick = closeIntelUI;
  el.querySelector('#cr-intel-close2').onclick = closeIntelUI;

  const buyBtn = el.querySelector('#cr-intel-buy');
  if (buyBtn) buyBtn.onclick = () => {
    if (buyIntel(intelUI.npc, intelUI.cityId)) {
      intelUI.tab = 'ledger';
      renderIntelModal();
    }
  };

  el.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => { intelUI.tab = btn.dataset.tab; renderIntelModal(); };
  });

  el.querySelectorAll('[data-sell]').forEach(btn => {
    btn.onclick = () => {
      if (sellIntel(btn.dataset.sell, intelUI.cityId)) renderIntelModal();
    };
  });
}

function canPlacePlayer(px, py) {
  return !isSolidAt(px - player.r, py - player.r) &&
    !isSolidAt(px + player.r, py - player.r) &&
    !isSolidAt(px - player.r, py + player.r) &&
    !isSolidAt(px + player.r, py + player.r);
}



function getOverlappingNpcs(px, py) {
  const list = [];
  for (const e of entities) {
    if (e.kind !== 'npc') continue;
    const dx = px - e.x;
    const dy = py - e.y;
    const r = player.r + e.radius;
    if (dx*dx + dy*dy < r*r) list.push(e);
  }
  return list;
}

function npcOverlapAt(px, py) {
  return getOverlappingNpcs(px, py).length > 0;
}

function nudgePlayerFromNpc(npc) {
  if (!npc) return false;
  const minD = player.r + npc.radius + 1;
  let dx = player.x - npc.x;
  let dy = player.y - npc.y;
  let dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist >= minD) return false;
  if (dist < 1e-3) { dx = 1; dy = 0; dist = 1; }
  const tryPlace = (ux, uy) => {
    const px = npc.x + ux * minD;
    const py = npc.y + uy * minD;
    if (canPlacePlayer(px, py)) {
      player.x = px;
      player.y = py;
      return true;
    }
    return false;
  };
  if (tryPlace(dx / dist, dy / dist)) return true;
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    if (tryPlace(Math.cos(a), Math.sin(a))) return true;
  }
  return false;
}

function resolvePlayerNpcOverlap() {
  for (const e of entities) {
    if (e.kind !== 'npc') continue;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const r = player.r + e.radius;
    if (dx*dx + dy*dy < r*r) {
      const ok = nudgePlayerFromNpc(e);
      if (!ok) {
        // keep ghost window alive until we separate
        player.npcGhostUntil = Math.max(player.npcGhostUntil || 0, stateTime + 800);
      }
      return ok;
    }
  }
  return false;
}

function isNpcBlocking(px, py) {
  if (stateTime < (player.npcGhostUntil || 0)) return false;
  const overlaps = getOverlappingNpcs(player.x, player.y);
  const ignore = new Set(overlaps.map(e => e.id));
  for (const e of entities) {
    if (e.kind !== 'npc') continue;
    if (ignore.has(e.id)) continue;
    if (e.role === 'guard_post') continue; // guards are decorative — player passes through
    const dx = px - e.x;
    const dy = py - e.y;
    const r = player.r + e.radius;
    if (dx*dx + dy*dy < r*r) return true;
  }
  return false;
}

function drawNpcEntity(e) {
  const sx = e.x - camera.x;
  const sy = e.y - camera.y;
  const r = e.radius;
  ctx.save();
  ctx.translate(sx, sy);

  // base body
  ctx.fillStyle = 'rgba(220, 210, 190, 0.95)';
  ctx.beginPath();
  ctx.arc(0, -r, r * 0.7, 0, Math.PI * 2);
  ctx.fill();

  if (e.style === 'scribe') {
    ctx.fillStyle = '#c7a97a'; // robe
    ctx.fillRect(-r, -r * 0.2, r * 2, r * 2.2);
    ctx.fillStyle = '#f1e7c8'; // scroll
    ctx.fillRect(r * 0.4, r * 0.2, r * 0.9, r * 0.5);
  } else if (e.style === 'baker') {
    ctx.fillStyle = '#d9b38c';
    ctx.fillRect(-r, -r * 0.2, r * 2, r * 2.2);
    ctx.fillStyle = '#f4f1e8'; // cap
    ctx.fillRect(-r * 0.8, -r * 1.6, r * 1.6, r * 0.6);
    ctx.fillStyle = '#e0c4a8'; // apron
    ctx.fillRect(-r * 0.4, r * 0.4, r * 0.8, r * 1.2);
  } else if (e.style === 'guard') {
    ctx.fillStyle = '#9aa3b2';
    ctx.fillRect(-r, -r * 0.2, r * 2, r * 2.2);
    ctx.fillStyle = '#6b7280'; // helm
    ctx.fillRect(-r * 0.9, -r * 1.8, r * 1.8, r * 0.8);
    ctx.strokeStyle = '#cbd5e1'; // spear
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r * 1.2, r * 0.1);
    ctx.lineTo(r * 1.6, r * 1.8);
    ctx.stroke();
  } else if (e.style === 'fisher') {
    ctx.fillStyle = '#9ec5a1';
    ctx.fillRect(-r, -r * 0.2, r * 2, r * 2.2);
    ctx.fillStyle = '#6b8f9c'; // hat
    ctx.fillRect(-r, -r * 1.6, r * 2, r * 0.6);
    ctx.strokeStyle = '#d1d5db'; // hook
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 1.3, r * 0.2);
    ctx.lineTo(-r * 1.8, r * 1.4);
    ctx.stroke();
  } else if (e.style === 'smuggler') {
    ctx.fillStyle = '#5b5561';
    ctx.fillRect(-r, -r * 0.2, r * 2, r * 2.2);
    ctx.fillStyle = '#3f3a45'; // hood
    ctx.fillRect(-r, -r * 1.7, r * 2, r * 0.8);
  } else if (e.style === 'broker') {
    ctx.fillStyle = '#b0a38a';
    ctx.fillRect(-r, -r * 0.2, r * 2, r * 2.2);
    ctx.fillStyle = '#8b7b63'; // ledger
    ctx.fillRect(-r * 1.4, r * 0.4, r * 0.8, r * 0.7);
  } else {
    ctx.fillStyle = '#c7b9a5';
    ctx.fillRect(-r, -r * 0.2, r * 2, r * 2.2);
  }

  ctx.restore();
}


function computeNpcBubbleLayout() {
  const b = ui.npcBubble;
  if (!b) return null;
  if (stateTime > b.untilMs) { ui.npcBubble = null; return null; }
  const npc = entities.find(e => e.id === b.npcId);
  if (!npc) return null;

  const sx = npc.x - camera.x;
  const sy = npc.y - camera.y - npc.radius - 10;
  const text = b.text || '';

  ctx.save();
  ctx.font = `700 ${Math.round(11 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  const maxW = IS_MOBILE ? Math.min(200, VIEW_W - 20) : 260;
  const pad = 12;
  const maxTextW = Math.max(40, maxW - pad * 2);
  const line = ellipsizeText(text, maxTextW);
  const tw = Math.min(maxW, ctx.measureText(line).width + pad * 2);
  const th = Math.round(18 * UI_SCALE);

  let x = sx - tw / 2;
  let y = sy - th;
  if (IS_MOBILE && y < HUD_H + 6) {
    y = sy + 8; // flip below npc if too close to HUD
  }
  x = clamp(x, 8, VIEW_W - tw - 8);
  y = clamp(y, HUD_H + 6, VIEW_H - th - 8);

  ctx.restore();
  return { line, rect: { x, y, w: tw, h: th }, sx, sy };
}

function drawNpcBubble() {
  let layout = null;
  try {
    layout = computeNpcBubbleLayout();
  } catch {
    ui.npcBubble = null;
    ui._npcBubbleRect = null;
    return;
  }
  if (!layout) { ui._npcBubbleRect = null; return; }

  const { line, rect, sx, sy } = layout;
  const { x, y, w: tw, h: th } = rect;

  ui._npcBubbleRect = rect;
  ui._npcBubbleText = line;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 18, 24, 0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, tw, th, 10);
  else ctx.rect(x, y, tw, th);
  ctx.fill();
  ctx.stroke();

  // tail
  ctx.fillStyle = 'rgba(15, 18, 24, 0.92)';
  ctx.beginPath();
  ctx.moveTo(sx - 4, y + th);
  ctx.lineTo(sx + 4, y + th);
  ctx.lineTo(sx, y + th + 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#e8edf2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(11 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillText(line, x + tw / 2, y + th / 2 + 1);
  ctx.restore();
}


  function populationTick() {
    const cityIds = Object.keys(CITY_RULES);

    // ── 1. Hunger + price pressure ──────────────────────────────────────
    for (const [cid, rule] of Object.entries(CITY_RULES)) {
      const state = cityPop[cid];
      if (!state) continue;
      const subsidyReduction = 1 - (cityBonus[cid]?.foodSubsidy || 0);
      state.hunger = Math.min(1, state.hunger + rule.foodDemand * (state.pop / rule.population) * subsidyReduction);
      const pressureBoost = state.hunger * 0.4;
      if (pressureBoost > 0.02) {
        if (!ECONOMY.pressure[cid]) ECONOMY.pressure[cid] = {};
        ECONOMY.pressure[cid]['food']  = Math.min(0.5, (ECONOMY.pressure[cid]['food']  || 0) + pressureBoost * 0.15);
        ECONOMY.pressure[cid]['grain'] = Math.min(0.5, (ECONOMY.pressure[cid]['grain'] || 0) + pressureBoost * 0.15);
      }
      // Natural growth/decline
      if (state.hunger < 0.2) {
        state.pop = Math.min(state.pop * 1.002, rule.population * 1.5);
      } else if (state.hunger > 0.7) {
        state.pop = Math.max(state.pop * 0.998, rule.population * 0.5);
      }
    }

    // ── 2. Migration: people flee hungry/taxed cities to comfortable ones ─
    // Attractiveness = (1 - hunger) * (1 - taxRate) — higher = more attractive
    const attract = {};
    for (const cid of cityIds) {
      const rule = CITY_RULES[cid];
      const hunger = cityPop[cid]?.hunger ?? 0;
      const popBonus = 1 + (cityBonus[cid]?.popIncentive || 0);
      attract[cid] = (1 - hunger) * (1 - (rule.taxRate ?? 0)) * popBonus;
    }
    const totalAttract = cityIds.reduce((s, c) => s + attract[c], 0) || 1;

    for (const fromId of cityIds) {
      const fromState = cityPop[fromId];
      if (!fromState || fromState.pop < 10) continue;
      const fromRule = CITY_RULES[fromId];

      // Migration rate: 0.1% of pop per day base, amplified by hunger + tax
      const pushFactor = (fromState.hunger * 0.6 + (fromRule.taxRate ?? 0) * 0.4);
      if (pushFactor < 0.05) continue; // happy city barely loses anyone

      const migrantPool = Math.floor(fromState.pop * 0.001 * pushFactor);
      if (migrantPool < 1) continue;

      // Distribute migrants to other cities proportional to attractiveness
      for (const toId of cityIds) {
        if (toId === fromId) continue;
        const toState = cityPop[toId];
        if (!toState) continue;
        const toRule = CITY_RULES[toId];
        const share = attract[toId] / (totalAttract - attract[fromId] || 1);
        const movers = Math.round(migrantPool * share);
        if (movers < 1) continue;

        // Cap destination at 2× its base population
        const destCap = toRule.population * 2;
        const actualMovers = Math.min(movers, Math.max(0, destCap - toState.pop));
        fromState.pop = Math.max(fromState.pop - actualMovers, Math.floor(toRule.population * 0.3));
        toState.pop   = Math.min(toState.pop + actualMovers, destCap);

        // Migration events: toast if player is in either city and movement is significant
        if (actualMovers >= 50) {
          const fromCity = getCityById(fromId);
          const toCity   = getCityById(toId);
          const playerCity = currentCity();
          if (playerCity && (playerCity.id === fromId || playerCity.id === toId)) {
            const msg = playerCity.id === fromId
              ? `${actualMovers} residents left for ${toCity?.name || toId}`
              : `${actualMovers} migrants arrived from ${fromCity?.name || fromId}`;
            toast(msg, 3);
          }
        }
      }
    }
  }

  // ── Find building slot by map tile position ──────────────────────────────
  function findSlotAtTile(cityId, tx, ty) {
    const slots = cityBuildings[cityId];
    if (!slots) return null;
    for (const [key, slot] of Object.entries(slots)) {
      if (slot.built) continue;
      if (Math.abs(tx - slot.tileX) <= 1 && Math.abs(ty - slot.tileY) <= 1) return { key, slot };
    }
    return null;
  }

  // ── Player donation modal for vacant building slots ───────────────────────
  function showBuildingDonateModal(cityId, tx, ty) {
    const found = findSlotAtTile(cityId, tx, ty);
    if (!found) { toast('No building planned here.', 2); return; }
    const { key, slot } = found;
    const nextCost = slot.costPerLevel[slot.level];
    if (nextCost === undefined) { toast('This building is fully upgraded.', 2); return; }
    const city = getCityById(cityId);
    const cityGold = cityTreasury[cityId]?.gold || 0;
    const funded = slot.playerFunded || 0;
    const remaining = nextCost - funded;
    const slotLabel = key.charAt(0).toUpperCase() + key.slice(1);
    const levelLabel = slot.level === 0 ? '' : ` (upgrade to Lv${slot.level+1})`;

    // Effect description
    const effectDesc = {
      marketDiscount: 'Cheaper goods to buy',
      roadSpeed:      'Faster travel speed',
      foodSubsidy:    'Slower hunger drain',
      popIncentive:   'City grows faster',
      guardDiscount:  'Guards inspect you less',
    }[slot.effect] || slot.effect;

    ui.buildingDonateOpen = true;
    dom._buildingDonate = { cityId, key, slot, nextCost, remaining, slotLabel, effectDesc, levelLabel };
    domEnsureOpen();
    dom.key = '';
    domRender();
  }

  function donateToSlot(cityId, key, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    amount = Math.floor(Math.min(amount, player.gold));
    if (amount <= 0) { toast('Not enough gold.', 2); return; }
    const slot = cityBuildings[cityId]?.[key];
    if (!slot) return;
    const nextCost = slot.costPerLevel[slot.level];
    if (nextCost === undefined) { toast('Already maxed.', 2); return; }
    player.gold -= amount;
    slot.playerFunded = Math.min((slot.playerFunded || 0) + amount, nextCost);
    const slotLabel = key.charAt(0).toUpperCase() + key.slice(1);
    toast(`You donated ${amount}g toward the ${slotLabel}!`, 2.5);
    // If player fully funded → build immediately
    if (slot.playerFunded >= nextCost) {
      slot.level += 1;
      slot.built = true;
      slot.playerFunded = 0;
      if (cityBonus[cityId] && slot.effect && cityBonus[cityId][slot.effect] !== undefined) {
        cityBonus[cityId][slot.effect] = Math.min(
          (cityBonus[cityId][slot.effect] || 0) + slot.gain,
          slot.gain * slot.maxLevel
        );
      }
      buildSlotOnMap(cityId, key, slot);
      toast(`🏛 ${slotLabel} built! The city cheers!`, 4);
      if (cityTreasury[cityId]) {
        cityTreasury[cityId].investLog.push({ day: Math.floor(time.day), project: `${slotLabel} Lv${slot.level} (player-funded)`, effect: slot.effect });
        if (cityTreasury[cityId].investLog.length > 8) cityTreasury[cityId].investLog.shift();
      }
    }
    ui.buildingDonateOpen = false;
    dom.key = '';
    domRender();
    saveGame();
  }

  // ── Build a slot visually on the map ────────────────────────────────────
  function buildSlotOnMap(cid, slotKey, slot) {
    if (!mapData || !slot || slot.tileX <= 0) return;
    const bx = slot.tileX, by = slot.tileY;
    const bw = slot.tileW, bh = slot.tileH;
    const interior = slot.tileType;
    const door = slot.doorSide || 'south';
    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        const isWall = dx === 0 || dx === bw-1 || dy === 0 || dy === bh-1;
        mapData[(by+dy)*MAP_W + (bx+dx)] = isWall ? 3 : interior;
      }
    }
    if (door === 'south' && bh > 1) mapData[(by+bh-1)*MAP_W + (bx+Math.floor(bw/2))] = 4;
    if (door === 'north' && bh > 1) mapData[by*MAP_W + (bx+Math.floor(bw/2))] = 4;
    if (door === 'east')  mapData[(by+Math.floor(bh/2))*MAP_W + (bx+bw-1)] = 4;
    if (door === 'west')  mapData[(by+Math.floor(bh/2))*MAP_W + bx] = 4;
    // Redraw minimap after map change
    if (typeof drawMinimap === 'function') try { drawMinimap(); } catch(_) {}
  }

  function cityInvestTick() {
    for (const [cid, treasury] of Object.entries(cityTreasury)) {
      // ── Treasury → Bank funding (20% of treasury flows to bank vault each cycle) ──
      const vaultShare = Math.floor(treasury.gold * 0.20);
      if (vaultShare > 0 && bankVault[cid]) {
        treasury.gold -= vaultShare;
        bankVault[cid].reserve += vaultShare;
      }

      // ── If treasury is critically low, bank vault bleeds (no new investment) ──
      if (treasury.gold < 20 && bankVault[cid]) {
        bankVault[cid].reserve = Math.max(0, bankVault[cid].reserve - 5);
      }

      // ── City investment: spend treasury on building slots ──
      const slots = cityBuildings[cid];
      if (!slots) { checkBankSolvency(cid); continue; }

      // Find affordable next-level slots, cheapest first
      const candidates = Object.entries(slots)
        .filter(([, slot]) => {
          const nextCost = slot.costPerLevel[slot.level];
          return nextCost !== undefined && slot.level < slot.maxLevel &&
                 treasury.gold >= (nextCost - (slot.playerFunded || 0));
        })
        .sort((a, b) => (a[1].costPerLevel[a[1].level] || 999) - (b[1].costPerLevel[b[1].level] || 999));

      if (candidates.length) {
        const [slotKey, slot] = candidates[0];
        const nextCost = slot.costPerLevel[slot.level];
        const cityPay = Math.max(0, nextCost - (slot.playerFunded || 0));
        treasury.gold -= cityPay;
        slot.playerFunded = 0;
        slot.level += 1;
        slot.built = true;

        // Apply bonus effect
        if (!cityBonus[cid]) cityBonus[cid] = {};
        if (slot.effect && cityBonus[cid][slot.effect] !== undefined) {
          cityBonus[cid][slot.effect] = Math.min(
            (cityBonus[cid][slot.effect] || 0) + slot.gain,
            slot.gain * slot.maxLevel
          );
        }

        // Paint building onto map
        buildSlotOnMap(cid, slotKey, slot);

        const slotLabel = slotKey.charAt(0).toUpperCase() + slotKey.slice(1);
        treasury.investLog.push({ day: Math.floor(time.day), project: `${slotLabel} Lv${slot.level}`, effect: slot.effect });
        if (treasury.investLog.length > 8) treasury.investLog.shift();

        const playerCity = currentCity();
        const city = getCityById(cid);
        if (playerCity?.id === cid) {
          toast(`📢 ${city?.name || cid} built a ${slotLabel}!`, 3.5);
        }
      }

      // ── Check bank solvency after funding changes ──
      checkBankSolvency(cid);
    }
  }

  function advanceDays(days, reason = '') {
    if (!Number.isFinite(days) || days <= 0) return;
    time.frac += days;
    let advanced = 0;
    while (time.frac >= 1) {
      time.frac -= 1;
      time.day += 1;
      advanced += 1;
      populationTick();
      // City investment every 7 days
      if (time.day % 7 === 0) cityInvestTick();
      // Daily bank solvency check (catches slow vault drain between invest ticks)
      for (const cid of Object.keys(bankVault)) checkBankSolvency(cid);
      // Contract boards refresh every CONTRACT_REGEN_DAYS days (silent background regen)
      for (const cid of Object.keys(contracts.byCity)) {
        const last = contracts.lastRegenDay[cid] || 1;
        if (time.day - last >= CONTRACT_REGEN_DAYS) {
          contracts.byCity[cid] = regenContractsForCity(cid);
          contracts.lastRegenDay[cid] = time.day;
        }
      }
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
      verifyExpiredIntel();
    }
  }

  // Iteration notes (rendered into the bottom textbox)
  const ITERATION = {
    version: 'v0.1.6',
    whatsNew: [
      'Building labels: one label per building cluster (no more stacked overlapping bubbles).',
      'Labels use flood-fill centroid — single dot + pill for each Market/Inn/Bank/etc.',
      'Minimap: always-visible small corner widget (bottom-left), live player dot + nav route.',
      'Tap minimap to navigate directly to any city.',
    ],
    whatsNext: [
      'Mobile: optional bottom action bar for market/contract.',
      'NPCs: add a nearby "Press E" hint (optional).',
      'Dialogue: richer lines + rare city-specific quips.',
    ],
  };

  const ui = {
    marketOpen: false,
    toast: 'Walk into a city. Tap the market tile to trade.',
    toastT: 6,
    selection: 0,
    marketScroll: 0, // first visible item index
    _marketList: null,
    _marketTabs: null,
    _marketClose: null,
    _drag: null,
    mode: 'buy', // buy|sell
    navT: 0,

    npcBubble: null,
    _npcBubbleRect: null,
    _npcBubbleText: '',
    npcDiag: __NPCDIAG_STATE,
    mobileHudExpanded: false,
    _hudCityTap: null,
    _hudExpandedText: '',
    _hudExpandedVisible: false,
    _hudTopH: 0,
    _hudTapLastTs: 0,

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

    bankOpen: false,
    bankTab: 'deposit', // 'deposit'|'withdraw'|'loan'
    innOpen: false,
    guildOpen: false,
    warehouseOpen: false,
    buildingDonateOpen: false,
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
    ui.bankOpen = false;
    ui.innOpen = false;
    ui.guildOpen = false;
    ui.warehouseOpen = false;
    ui.buildingDonateOpen = false;
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
      economyPostTrade(c.id, it.id, 'buy', buyN);
      scheduleAutoSave();

      return;
    }

    // sell
    const have = player.inv[it.id] || 0;
    if (have <= 0) { toast('You have none to sell.', 2); return; }
    const sellN = Math.min(q, have);
    if (sellN <= 0) { toast('Invalid quantity.', 2); return; }
    const toolBonus = currentGear('tool').sellBonus || 0;
    const guildBonusMap = [0, 0.05, 0.10, 0.18];
    const guildBonus = playerGuild.joined ? (guildBonusMap[playerGuild.tier] || 0) : 0;
    const netEach = Math.max(1, Math.round(p * (1 - CITY_RULES[c.id].taxRate) * (1 + toolBonus + guildBonus)));
    const gain = sellN * netEach;

    player.inv[it.id] = have - sellN;
    if (player.inv[it.id] < 0) { player.inv[it.id] = have; toast('Trade blocked (qty would go negative).', 2); return; }
    player.gold += gain;
    if (player.gold < 0) { player.gold -= gain; player.inv[it.id] = have; toast('Trade blocked (gold would go negative).', 2); return; }
    toast(`Sold ${sellN} ${it.name} (+${gain}g after tax)`, 2);
    economyPostTrade(c.id, it.id, 'sell', sellN);
    // City treasury receives the tax portion
    const taxCollected = Math.round(sellN * p * CITY_RULES[c.id].taxRate);
    if (taxCollected > 0 && cityTreasury[c.id]) {
      cityTreasury[c.id].gold += taxCollected;
    }
    // Hunger relief when selling food or grain
    if (it.id === 'food' || it.id === 'grain') {
      if (cityPop[c.id]) {
        const relief = sellN * 0.02;
        cityPop[c.id].hunger = Math.max(0, cityPop[c.id].hunger - relief);
      }
    }
    scheduleAutoSave();
  }

  function contractRewardForAccept(cityId, baseReward, jobTier) {
    const repTier = contractTierForRep(player.rep?.[cityId] || 0);
    const tier = clamp(jobTier ?? 0, 0, 2);
    // Scaling uses the job's tier (difficulty) and can be further boosted by your rep tier.
    const baseMult = CONTRACT_TIER_MULT[tier] || 1.0;
    const repMult = 1.0 + 0.05 * repTier;
    const permitMult = player.permits?.[cityId] ? (1.0 + CONTRACT_PERMIT_BONUS) : 1.0;
    const r = Math.round((Number(baseReward) || 0) * baseMult * repMult * permitMult);
    return Math.max(0, r);
  }

  function contractsAccept(idx) {
    const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
    if (!c) return;

    const repTier = contractTierForRep(player.rep?.[c.id] || 0);
    const jobs = (contracts.byCity[c.id] || []).filter(j => (j?.tier ?? 0) <= repTier);
    const job = jobs[idx];
    if (!job) return;

    const finalReward = contractRewardForAccept(c.id, job.reward, job.tier);
    contracts.active = { ...job, reward: finalReward };

    // Remove the accepted job from the board so it's not re-takeable
    removeContractFromBoard(c.id, job);

    toast(`Accepted contract. (Reward ${finalReward}g)`, 2.2);

    // QA hook: accepting a contract must not crash and should activate a job.
    if (__QA.enabled && !contracts.active) qaFail('accept: contracts.active not set');

    // Close both UI systems (DOM overlay + canvas fallback) to avoid “stuck modal” / null-city crashes.
    ui.contractsOpen = false;
    domCloseAll();
  }

  function domRender() {
    if (!USE_DOM_MODALS || !uiRoot) return;

    const kind = ui.eventOpen ? 'event' : (ui.marketOpen ? 'market' : (ui.contractsOpen ? 'contracts' : (ui.bankOpen ? 'bank' : (ui.innOpen ? 'inn' : (ui.guildOpen ? 'guild' : (ui.warehouseOpen ? 'warehouse' : (ui.buildingDonateOpen ? 'building-donate' : null)))))));
    if (!kind) { domCloseAll(); return; }

    // Banner is rendered whenever a modal is open (keeps scope minimal).
    // NOTE: keep render keys small but sufficient; rebuild modal when state changes.
    let key = kind;
    if (banner.q.length) {
      key += `|b${banner.q.length}`;
      for (const it of banner.q) key += `|${it.id}:${it.state}`;
    }
    if (kind === 'market') {
      const c = currentCity();
      key += `|${c ? c.id : 'none'}|${ui.mode}|${ui.selection}|${ui.marketScroll}|${player.gold}|${invWeight()}|${player.permits[c?.id] ? 1 : 0}|g${player.gear?.pack??0}${player.gear?.boots??0}${player.gear?.tool??0}|e${ECONOMY.lastSync}`;
      for (const it of ITEMS) key += `|${player.inv[it.id] || 0}`;
    } else if (kind === 'contracts') {
      const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
      key += `|${c ? c.id : 'none'}|${ui.contractsSel}|${contracts.active ? (contracts.active.want+contracts.active.toId+contracts.active.qty) : 'none'}`;
    } else if (kind === 'event') {
      key += `|${ui.eventTitle}|${ui.eventText}|${ui.eventSel}|${ui.eventChoices.length}`;
    } else if (kind === 'bank') {
      const c = currentCity();
      const cid = c?.id;
      const vault = cid ? bankVault[cid] : null;
      key += `|${cid}|${ui.bankTab}|${player.gold}|${vault?.reserve ?? 0}|${vault?.bankruptDay ?? 'no'}|${playerBank.deposits[cid]?.amount ?? 0}|${playerBank.loans[cid]?.amount ?? 0}`;
    }

    if (dom.key === key) return;
    dom.key = key;
    dom.kind = kind;
    domEnsureOpen();

    const bannerHtml = banner.q.length ? `
      <div class="cr-banner-stack" aria-label="Notifications">
        ${banner.q.map(it => `
          <div class="cr-banner ${it.state === 'out' ? 'out' : ''}" role="status" aria-live="polite">
            <div class="cr-banner-title">${htmlEscape(it.title)}</div>
            <div class="cr-banner-text">${htmlEscape(it.text)}</div>
          </div>
        `).join('')}
      </div>
    ` : '';

    if (kind === 'market') {
      const c = currentCity();
      if (!c) { domCloseAll(); return; }
      const rules = CITY_RULES[c.id];
      const isMobile = IS_MOBILE;
      const sellHasItems = ITEMS.some(it => (player.inv[it.id] || 0) > 0);
      const buyHasItems = true;
      if (ui.mode !== 'gear') {
        if (buyHasItems && !sellHasItems) ui.mode = 'buy';
        if (sellHasItems && !buyHasItems) ui.mode = 'sell';
      }
      const showTabs = true; // always show — gear tab always visible
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
        const sub = isPermitRow ? 'Reduces inspections in this city' : `Have: ${have} · Wt: ${it.weight}`;
        const right = isPermitRow ? (hasPermit ? 'Owned' : `${price}g`) : `${price}g`;
        const badge = contra ? '<span class="cr-badge">CONTRABAND</span>' : '';

        // Enriched price info for regular items
        const sellPrice = isPermitRow ? null : Math.max(1, Math.round(price * (1 - MARKET.spread)));
        const deltaPct = isPermitRow ? 0 : Math.round(((price - it.base) / it.base) * 100);
        const deltaClass = deltaPct > 5 ? 'cr-delta-up' : deltaPct < -5 ? 'cr-delta-down' : 'cr-delta-flat';
        const deltaSign = deltaPct >= 0 ? `+${deltaPct}%` : `${deltaPct}%`;
        const deltaLabel = deltaPct > 5 ? `▲ ${deltaSign}` : deltaPct < -5 ? `▼ ${deltaSign}` : `~ ${deltaSign}`;
        const priceRowHtml = isPermitRow ? '' : `<div class="cr-price-row"><span class="cr-buy-price">Buy ${price}g</span><span class="cr-sell-price">Sell ${sellPrice}g</span></div>`;
        const deltaHtml = isPermitRow ? '' : `<span class="${deltaClass}" aria-label="Price vs average">${deltaLabel}</span>`;

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
                <button class="${isMobile ? 'cr-action' : 'cr-tab'}" style="margin-top:10px; padding:10px 10px;" data-action="trade" data-idx="${i}" data-qty="1" ${actionDisabled}>${htmlEscape(actionLabel)}</button>
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

          if (isMobile) {
            const actionLabel = ui.mode === 'buy' ? 'BUY' : 'SELL';
            const disabled = ui.mode === 'buy' ? (maxBuy <= 0) : (have <= 0);
            const btn = `<button class="cr-action" data-action="trade" data-idx="${i}" data-qty="1" ${disabled ? 'disabled' : ''}>${actionLabel}</button>`;
            rows.push(`
              <div class="cr-card" role="button" tabindex="0" data-idx="${i}" aria-current="${selected}">
                <div class="cr-card-left">
                  <div class="cr-card-title">${htmlEscape(title)}</div>
                  <div class="cr-card-sub">${htmlEscape(sub)}</div>
                  ${priceRowHtml}
                  ${badge}
                </div>
                <div class="cr-right">
                  ${deltaHtml}
                  ${btn}
                </div>
              </div>
            `);
          } else {
            const btnBase = 'style="margin-top:6px;padding:6px 8px;font-size:12px;"';
            const mkBtn = (label, qty, disabled) => `<button class="cr-tab" ${btnBase} data-action="trade" data-idx="${i}" data-qty="${qty}" ${disabled ? 'disabled' : ''}>${label}</button>`;

            const q1 = mkBtn('±1', 1, false);
            const q5 = mkBtn('±5', 5, maxBuy < 5);
            const qMax = mkBtn(ui.mode === 'buy' ? 'MAX' : 'ALL', maxBuy > 0 ? maxBuy : 1, maxBuy <= 0);

            rows.push(`
              <div class="cr-card" role="button" tabindex="0" data-idx="${i}" aria-current="${selected}">
                <div class="cr-card-left">
                  <div class="cr-card-title">${htmlEscape(title)}</div>
                  <div class="cr-card-sub">${htmlEscape(sub)}</div>
                  ${priceRowHtml}
                  ${badge}
                </div>
                <div class="cr-right">
                  ${deltaHtml}
                  <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;">
                    ${q1}${q5}${qMax}
                  </div>
                </div>
              </div>
            `);
          }
        }
      }

      const w = invWeight();
      const rumors = getMarketRumors(c.id);
      const rumorsHtml = rumors.length ? `
        <div class="cr-rumors" aria-label="Rumors">
          <div class="cr-rumors-title">Rumors</div>
          ${rumors.map(t => `<div class="cr-rumor">• ${htmlEscape(t)}</div>`).join('')}
        </div>
      ` : '';

      // Global economy pulse: show items with notable price pressure
      const econPressures = ECONOMY.pressure[c.id] || {};
      const hotItems = Object.entries(econPressures)
        .filter(([, p]) => Math.abs(p) >= 0.05)
        .sort(([,a],[,b]) => Math.abs(b) - Math.abs(a))
        .slice(0, 3);
      const econHtml = hotItems.length ? `
        <div class="cr-rumors" aria-label="Market pulse" style="border-color:#4a3a10">
          <div class="cr-rumors-title" style="color:#f0d080">🌍 Global Market</div>
          ${hotItems.map(([itemId, p]) => {
            const it = ITEMS.find(x => x.id === itemId);
            const name = it ? it.name : itemId;
            const pct = Math.round(Math.abs(p) * 100);
            const dir = p > 0 ? '📈 High demand' : '📉 Oversupplied';
            const col = p > 0 ? '#f87171' : '#34d399';
            return `<div class="cr-rumor" style="color:${col}">• ${name}: ${dir} (+${pct}% pressure)</div>`;
          }).join('')}
        </div>
      ` : '';

      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Market">
          <div class="cr-panel">
            ${bannerHtml}
            <div class="cr-head">
              <div>
                <div class="cr-title">${htmlEscape(c.name)} Market</div>
                <div class="cr-sub">${htmlEscape(rules.vibe)}</div>
              </div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>${showTabs ? `
            <div class="cr-tabs" role="tablist" aria-label="Buy or sell">
              <button class="cr-tab" role="tab" aria-selected="${ui.mode === 'buy'}" data-action="mode" data-mode="buy">BUY</button>
              <button class="cr-tab" role="tab" aria-selected="${ui.mode === 'sell'}" data-action="mode" data-mode="sell">SELL</button>
              <button class="cr-tab" role="tab" aria-selected="${ui.mode === 'gear'}" data-action="mode" data-mode="gear">⚙ GEAR</button>
            </div>
` : ''}            <div class="cr-body">
              <div class="cr-list" aria-label="Items">
                ${econHtml}
                ${ui.mode === 'gear' ? (() => {
                  const slots = ['pack','boots','tool'];
                  const slotLabels = { pack: '🎒 Pack', boots: '👟 Boots', tool: '📜 Tool' };
                  return slots.map(slot => {
                    const tiers = GEAR[slot];
                    const cur = player.gear[slot] ?? 0;
                    return `<div style="margin-bottom:12px">
                      <div style="font-weight:700;color:#f0d080;margin-bottom:6px">${slotLabels[slot]}</div>
                      ${tiers.map((g, i) => {
                        const owned = i <= cur;
                        const isCurrent = i === cur;
                        const canBuy = i === cur + 1 && player.gold >= g.cost;
                        const tooExpensive = i === cur + 1 && player.gold < g.cost;
                        const locked = i > cur + 1;
                        const badge = isCurrent ? '<span style="color:#4ade80;font-size:11px">✓ EQUIPPED</span>' : '';
                        const cost = g.cost === 0 ? 'Default' : `${g.cost}g`;
                        const btnStyle = canBuy
                          ? 'background:#4a3a10;border:1px solid #f0d080;color:#f0d080;cursor:pointer;'
                          : 'background:#1a1408;border:1px solid #444;color:#666;cursor:default;';
                        const btn = locked ? `<span style="color:#444;font-size:11px">🔒 Locked</span>`
                          : owned ? badge
                          : `<button style="${btnStyle}padding:4px 10px;border-radius:4px;font-size:12px;" data-action="buy-gear" data-slot="${slot}" data-tier="${i}" ${tooExpensive ? 'disabled' : ''}>${tooExpensive ? `Need ${g.cost}g` : `Buy ${g.cost}g`}</button>`;
                        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;margin-bottom:4px;border-radius:6px;background:${isCurrent ? '#1a2010' : '#0e0c08'};border:1px solid ${isCurrent ? '#4ade80' : '#2a2010'};">
                          <div>
                            <span style="font-size:15px">${g.icon}</span>
                            <span style="color:${isCurrent ? '#e0cfa0' : locked ? '#555' : '#b0a070'};margin-left:6px;font-weight:${isCurrent ? '700' : '400'}">${g.name}</span>
                            <div style="font-size:11px;color:#666;margin-left:22px">${g.desc}</div>
                          </div>
                          <div style="text-align:right">${btn}</div>
                        </div>`;
                      }).join('')}
                    </div>`;
                  }).join('');
                })() : `${rumorsHtml}${rows.join('')}`}
              </div>
            </div>
            <div class="cr-foot">
              <div><strong>Gold:</strong> ${player.gold}g &nbsp; <strong>Pack:</strong> ${w}/${player.capacity} &nbsp; ${currentGear('boots').icon} ${currentGear('boots').name} &nbsp; ${currentGear('tool').icon} ${currentGear('tool').name}</div>
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

      // Gear purchase buttons
      uiRoot.querySelectorAll('[data-action="buy-gear"]').forEach(el => el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const slot = el.getAttribute('data-slot');
        const tier = Number(el.getAttribute('data-tier'));
        const g = GEAR[slot]?.[tier];
        if (!g) return;
        if (player.gold < g.cost) { toast(`Need ${g.cost}g to buy ${g.name}.`, 2); return; }
        if (tier !== (player.gear[slot] ?? 0) + 1) { toast('Buy upgrades in order.', 2); return; }
        player.gold -= g.cost;
        player.gear[slot] = tier;
        applyGearStats();
        scheduleAutoSave();
        showBanner(`Gear Upgraded!`, `${g.icon} ${g.name} equipped — ${g.desc}`);
        toast(`${g.icon} ${g.name} equipped!`, 2.5);
        dom.key = ''; // force re-render
      }));

      return;
    }

    if (kind === 'contracts') {
      const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
      if (!c) { domCloseAll(); return; }

      // Auto-refresh board if enough days have passed
      if (maybeRegenCityContracts(c.id)) {
        toast(`📋 ${c.name} contract board refreshed.`, 2.2);
        dom.key = ''; // force re-render with new jobs
      }

      const rep = player.rep?.[c.id] || 0;
      const repTier = contractTierForRep(rep);
      const jobsAll = contracts.byCity[c.id] || [];
      const jobs = jobsAll.filter(j => (j?.tier ?? 0) <= repTier);

      const rows = jobs.map((job, i) => {
        const it = ITEMS.find(x => x.id === job.want);
        const selected = i === ui.contractsSel;
        const tierTag = `[T${job.tier ?? 0}]`;
        const shownReward = contractRewardForAccept(c.id, job.reward, job.tier);
        return `
          <div class="cr-card" role="button" tabindex="0" data-cidx="${i}" aria-current="${selected}">
            <div>
              <div class="cr-card-title">${htmlEscape(tierTag)} Deliver ${job.qty}× ${htmlEscape(it ? it.name : job.want)} → ${htmlEscape(job.toId)}</div>
              <div class="cr-card-sub">Reward: ${shownReward}g</div>
            </div>
            <div class="cr-right">
              <div class="cr-price">${shownReward}g</div>
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
            ${bannerHtml}
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
            ${bannerHtml}
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

    if (kind === 'bank') {
      const c = currentCity();
      if (!c) { domCloseAll(); return; }
      const cid = c.id;

      const vault = bankVault[cid] || { reserve: 0, bankruptDay: null };
      const isBankrupt = bankIsBankrupt(cid);
      const bankruptDaysLeft = isBankrupt
        ? (vault.bankruptDay + BANK_BANKRUPTCY_REOPEN_DAYS - Math.floor(time.day))
        : 0;

      const dep = playerBank.deposits[cid];
      const loan = playerBank.loans[cid];
      const daysSinceDep = dep ? Math.max(0, Math.floor(time.day) - dep.depositDay) : 0;
      const interest = dep ? Math.floor(dep.amount * BANK_INTEREST_RATE * daysSinceDep) : 0;
      const depTotal = dep ? dep.amount + interest : 0;

      // Vault health indicator
      const vaultHealthPct = vault.reserve > 0
        ? Math.min(100, Math.round((vault.reserve / Math.max(bankTotalOwed(cid), vault.reserve, 1)) * 100))
        : 0;
      const vaultHealthColor = vaultHealthPct > 60 ? '#4ade80' : vaultHealthPct > 30 ? '#fbbf24' : '#ef4444';
      const vaultHealthLabel = vaultHealthPct > 60 ? 'Stable' : vaultHealthPct > 30 ? 'At Risk' : 'Critical';

      const tabBtns = ['deposit','withdraw','loan'].map(t =>
        `<button class="cr-tab${ui.bankTab===t?' cr-tab-active':''}" data-bank-tab="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`
      ).join('');

      let bodyHtml = '';
      if (isBankrupt) {
        bodyHtml = `
          <div style="text-align:center;padding:16px 0;">
            <div style="font-size:28px;margin-bottom:8px;">🏚️</div>
            <div style="color:#ef4444;font-weight:bold;font-size:15px">BANK CLOSED — BANKRUPT</div>
            <div class="cr-sub" style="margin-top:6px">Reopens in <b>${bankruptDaysLeft}</b> day${bankruptDaysLeft !== 1 ? 's' : ''}.</div>
            <div class="cr-sub" style="margin-top:4px">The city treasury ran dry and the bank could not meet its obligations.</div>
          </div>`;
      } else if (ui.bankTab === 'deposit') {
        const rateLabel = `${(BANK_INTEREST_RATE * 100).toFixed(1)}%/day`;
        bodyHtml = `
          <div class="cr-sub">Deposits earn <b>${rateLabel}</b> interest.</div>
          <div class="cr-sub">Vault reserve: <b style="color:${vaultHealthColor}">${vault.reserve}g</b> — <span style="color:${vaultHealthColor}">${vaultHealthLabel}</span></div>
          <div class="cr-sub" style="margin-top:2px">Your gold: <b>${player.gold}g</b>${dep ? ` · On deposit: <b>${depTotal}g</b> (+${interest}g interest)` : ''}</div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="cr-tab" data-action="dep10">+10g</button>
            <button class="cr-tab" data-action="dep50">+50g</button>
            <button class="cr-tab" data-action="dep100">+100g</button>
          </div>`;
      } else if (ui.bankTab === 'withdraw') {
        bodyHtml = dep
          ? `<div class="cr-sub">Deposit: <b>${dep.amount}g</b> + <b>${interest}g</b> interest = <b>${depTotal}g</b></div>
             <div class="cr-sub">Vault can cover: <b style="color:${vaultHealthColor}">${vault.reserve}g</b></div>
             <div style="margin-top:10px;"><button class="cr-tab" data-action="withdraw-all">Withdraw All (${depTotal}g)</button></div>`
          : `<div class="cr-sub">No deposit in this city.</div>`;
      } else {
        const hasLoan = !!loan;
        const loanPrincipal = loan ? (loan.principal ?? loan.amount) : 0;
        const overdue = loan ? Math.max(0, Math.floor(time.day) - loan.dueDay) : 0;
        const overdueExtra = overdue > 0 ? Math.round(loanPrincipal * 0.05 * overdue) : 0;
        const repayTotal = hasLoan ? loan.amount + overdueExtra : 0;
        const maxLoan = Math.min(200, Math.floor(bankVault[cid]?.reserve * 0.6 || 0));
        bodyHtml = hasLoan
          ? `<div class="cr-sub">Borrowed: <b>${loanPrincipal}g</b> · Due day <b>${loan.dueDay}</b></div>
             <div class="cr-sub">Repay amount: <b>${loan.amount}g</b> (incl. 10% fee)</div>
             ${overdue > 0
               ? `<div class="cr-sub" style="color:#ef4444;margin-top:4px">⚠️ OVERDUE ${overdue}d — +${overdueExtra}g penalty → total <b>${repayTotal}g</b></div>`
               : `<div class="cr-sub" style="color:#4ade80;margin-top:4px">✓ On time — ${loan.dueDay - Math.floor(time.day)}d remaining</div>`}
             <div style="margin-top:10px;"><button class="cr-tab" data-action="repay">Repay (${repayTotal}g)</button></div>`
          : vault.reserve < 50
          ? `<div class="cr-sub" style="color:#fbbf24">⚠️ Vault reserves too low for loans (${vault.reserve}g). Sell goods here to help the city economy.</div>`
          : `<div class="cr-sub">Borrow up to <b>${maxLoan}g</b> at 10% fee, due in 7 days.</div>
             <div class="cr-sub" style="color:#fbbf24">Overdue loans: +5%/day of principal.</div>
             <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
               ${maxLoan >= 50  ? '<button class="cr-tab" data-action="loan50">50g</button>' : ''}
               ${maxLoan >= 100 ? '<button class="cr-tab" data-action="loan100">100g</button>' : ''}
               ${maxLoan >= 200 ? '<button class="cr-tab" data-action="loan200">200g</button>' : ''}
             </div>`;
      }

      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Bank">
          <div class="cr-panel">
            ${bannerHtml}
            <div class="cr-head">
              <div>
                <div class="cr-title">🏦 Bank of ${htmlEscape(c.name)}</div>
                <div class="cr-sub">Your gold: ${player.gold}g · Vault: <span style="color:${vaultHealthColor}">${vault.reserve}g (${vaultHealthLabel})</span></div>
              </div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>
            <div class="cr-body">
              ${isBankrupt ? bodyHtml : `<div style="display:flex;gap:8px;margin-bottom:12px;">${tabBtns}</div>${bodyHtml}`}
            </div>
            <div class="cr-foot"><div class="cr-hint">Esc close</div></div>
          </div>
        </div>
      `;

      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.bankOpen = false; domCloseAll(); }));
      uiRoot.querySelectorAll('[data-bank-tab]').forEach(el => el.addEventListener('click', () => { ui.bankTab = el.getAttribute('data-bank-tab'); dom.key = ''; domRender(); }));

      if (!isBankrupt) {
        const bankDeposit = (amt) => {
          if (player.gold < amt) { toast(`Need ${amt}g to deposit.`, 2); return; }
          player.gold -= amt;
          // Deposit goes into vault reserve
          if (bankVault[cid]) bankVault[cid].reserve += amt;
          if (!playerBank.deposits[cid]) {
            playerBank.deposits[cid] = { amount: amt, depositDay: Math.floor(time.day) };
          } else {
            const d = playerBank.deposits[cid];
            const days = Math.max(0, Math.floor(time.day) - d.depositDay);
            d.amount = d.amount + Math.floor(d.amount * BANK_INTEREST_RATE * days) + amt;
            d.depositDay = Math.floor(time.day);
          }
          toast(`Deposited ${amt}g.`, 2); scheduleAutoSave(); dom.key = ''; domRender();
        };
        uiRoot.querySelector('[data-action="dep10"]')?.addEventListener('click', () => bankDeposit(10));
        uiRoot.querySelector('[data-action="dep50"]')?.addEventListener('click', () => bankDeposit(50));
        uiRoot.querySelector('[data-action="dep100"]')?.addEventListener('click', () => bankDeposit(100));

        uiRoot.querySelector('[data-action="withdraw-all"]')?.addEventListener('click', () => {
          if (!playerBank.deposits[cid]) { toast('Nothing to withdraw.', 2); return; }
          const d = playerBank.deposits[cid];
          const days = Math.max(0, Math.floor(time.day) - d.depositDay);
          const total = d.amount + Math.floor(d.amount * BANK_INTEREST_RATE * days);
          const vault = bankVault[cid];
          if (vault && vault.reserve < total) {
            toast(`⚠️ Vault only has ${vault.reserve}g — partial withdrawal only.`, 3);
            const partial = vault.reserve;
            player.gold += partial;
            vault.reserve = 0;
            delete playerBank.deposits[cid];
            checkBankSolvency(cid);
            scheduleAutoSave(); dom.key = ''; domRender();
            return;
          }
          player.gold += total;
          if (vault) vault.reserve = Math.max(0, vault.reserve - total);
          delete playerBank.deposits[cid];
          toast(`Withdrew ${total}g (incl. interest).`, 2); scheduleAutoSave(); dom.key = ''; domRender();
        });

        const maxLoan = Math.min(200, Math.floor((bankVault[cid]?.reserve || 0) * 0.6));

        const takeLoan = (amt) => {
          if (playerBank.loans[cid]) { toast('Repay existing loan first.', 2); return; }
          const v = bankVault[cid];
          if (!v || v.reserve < amt) { toast(`Vault can only lend ${v?.reserve || 0}g right now.`, 2); return; }
          const feeAmt = Math.round(amt * BANK_LOAN_RATE);
          const repayAmt = amt + feeAmt;
          // Store principal separately so overdue penalty compounds on original borrowed amount, not inflated repay total
          playerBank.loans[cid] = { principal: amt, amount: repayAmt, fee: feeAmt, dueDay: Math.floor(time.day) + 7 };
          player.gold += amt;
          v.reserve -= amt; // loan comes out of vault
          toast(`Borrowed ${amt}g. Repay ${repayAmt}g by day ${Math.floor(time.day)+7}.`, 3); scheduleAutoSave(); dom.key = ''; domRender();
        };
        uiRoot.querySelector('[data-action="loan50"]')?.addEventListener('click', () => takeLoan(50));
        uiRoot.querySelector('[data-action="loan100"]')?.addEventListener('click', () => takeLoan(100));
        uiRoot.querySelector('[data-action="loan200"]')?.addEventListener('click', () => takeLoan(200));

        uiRoot.querySelector('[data-action="repay"]')?.addEventListener('click', () => {
          const l = playerBank.loans[cid];
          if (!l) { toast('No loan here.', 2); return; }
          const overdue = Math.max(0, Math.floor(time.day) - l.dueDay);
          // Penalty on original principal only, not on the already-interest-inflated repay amount
          const basePrincipal = l.principal ?? l.amount; // fallback for legacy saves
          const penalty = overdue > 0 ? Math.round(basePrincipal * 0.05 * overdue) : 0;
          const total = l.amount + penalty;
          if (player.gold < total) { toast(`Need ${total}g to repay${penalty > 0 ? ` (incl. ${penalty}g overdue penalty)` : ''}.`, 2); return; }
          player.gold -= total;
          if (bankVault[cid]) bankVault[cid].reserve += total; // repayment flows back to vault
          delete playerBank.loans[cid];
          toast(`Loan repaid (${total}g${penalty > 0 ? `, incl. ${penalty}g overdue penalty` : ''}).`, 2); scheduleAutoSave(); dom.key = ''; domRender();
        });
      }
      return;
    }

    if (kind === 'inn') {
      const c = currentCity();
      if (!c) { domCloseAll(); return; }
      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Inn">
          <div class="cr-panel">
            ${bannerHtml}
            <div class="cr-head">
              <div><div class="cr-title">🏨 ${htmlEscape(c.name)} Inn</div><div class="cr-sub">Gold: ${player.gold}g · Day ${Math.floor(time.day)}, Hour ${Math.floor(time.hour)}</div></div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>
            <div class="cr-body">
              <div class="cr-card"><div><div class="cr-card-title">Rest (5g)</div><div class="cr-sub">Advance time 8 hours. Rested well.</div></div><div class="cr-right"><button class="cr-tab" data-action="rest">Rest</button></div></div>
              <div class="cr-card"><div><div class="cr-card-title">Rumors (10g)</div><div class="cr-sub">Hear a price tip about distant goods.</div></div><div class="cr-right"><button class="cr-tab" data-action="rumors">Listen</button></div></div>
              <div class="cr-card"><div><div class="cr-card-title">Full Night (15g)</div><div class="cr-sub">Sleep till morning (next day, hour 7).</div></div><div class="cr-right"><button class="cr-tab" data-action="fullnight">Sleep</button></div></div>
            </div>
            <div class="cr-foot"><div class="cr-hint">Esc close</div></div>
          </div>
        </div>
      `;
      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.innOpen = false; domCloseAll(); }));
      uiRoot.querySelector('[data-action="rest"]')?.addEventListener('click', () => {
        if (player.gold < 5) { toast('Need 5g to rest.', 2); return; }
        player.gold -= 5;
        time.hour = (time.hour + 8);
        if (time.hour >= 24) { time.day += Math.floor(time.hour / 24); time.hour = time.hour % 24; }
        toast('You rested well.', 2.5); scheduleAutoSave(); dom.key = ''; domRender();
      });
      uiRoot.querySelector('[data-action="rumors"]')?.addEventListener('click', () => {
        if (player.gold < 10) { toast('Need 10g for rumors.', 2); return; }
        const active = player.intelLedger.filter(cd => !cd.sold && cd.expiryDay >= Math.floor(time.day));
        if (active.length >= 6) { toast('Intel ledger full!', 2); return; }
        player.gold -= 10;
        const card = generateIntel({ id: 'innkeeper_' + c.id }, c.id);
        player.intelLedger.push(card);
        toast(`Rumors: "${card.itemName}" in ${card.cityName} — promising!`, 3); scheduleAutoSave(); dom.key = ''; domRender();
      });
      uiRoot.querySelector('[data-action="fullnight"]')?.addEventListener('click', () => {
        if (player.gold < 15) { toast('Need 15g for full night.', 2); return; }
        player.gold -= 15;
        time.day = Math.floor(time.day) + 1;
        time.hour = 7;
        toast('You slept until morning. Feeling refreshed!', 2.5); scheduleAutoSave(); dom.key = ''; domRender();
      });
      return;
    }

    if (kind === 'guild') {
      const c = currentCity();
      if (!c) { domCloseAll(); return; }
      const cid = c.id;
      const rep = player.rep?.[cid] || 0;
      const tierNames = ['None','Apprentice','Journeyman','Master'];
      const bonuses = [0, 5, 10, 18];
      let actionHtml = '';
      if (!playerGuild.joined) {
        actionHtml = `<div class="cr-card"><div><div class="cr-card-title">Join Guild (50g)</div><div class="cr-sub">Become Apprentice. +5% sell bonus.</div></div><div class="cr-right"><button class="cr-tab" data-action="join">Join</button></div></div>`;
      } else if (playerGuild.tier === 1) {
        actionHtml = rep >= 5
          ? `<div class="cr-card"><div><div class="cr-card-title">Advance to Journeyman (150g)</div><div class="cr-sub">Rep ✓ · +10% sell bonus total.</div></div><div class="cr-right"><button class="cr-tab" data-action="advance2">Advance</button></div></div>`
          : `<div class="cr-card"><div><div class="cr-card-title">Journeyman (150g, need Rep 5+)</div><div class="cr-sub">Your rep here: ${rep}. Keep trading!</div></div></div>`;
      } else if (playerGuild.tier === 2) {
        actionHtml = rep >= 15
          ? `<div class="cr-card"><div><div class="cr-card-title">Advance to Master (300g)</div><div class="cr-sub">Rep ✓ · +18% sell bonus, exclusive contracts.</div></div><div class="cr-right"><button class="cr-tab" data-action="advance3">Advance</button></div></div>`
          : `<div class="cr-card"><div><div class="cr-card-title">Master (300g, need Rep 15+)</div><div class="cr-sub">Your rep here: ${rep}. Keep grinding!</div></div></div>`;
      } else if (playerGuild.tier === 3) {
        actionHtml = `<div class="cr-sub" style="color:#a78bfa;font-weight:bold;">⭐ Master Rank — Maximum prestige achieved.</div>`;
      }
      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Guild Hall">
          <div class="cr-panel">
            ${bannerHtml}
            <div class="cr-head">
              <div><div class="cr-title">🏛 Merchants Guild</div><div class="cr-sub">Rank: <b>${tierNames[playerGuild.tier]}</b> · Sell bonus: +${bonuses[playerGuild.tier]}% · Gold: ${player.gold}g · Rep here: ${rep}</div></div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>
            <div class="cr-body">${actionHtml}</div>
            <div class="cr-foot"><div class="cr-hint">Esc close</div></div>
          </div>
        </div>
      `;
      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.guildOpen = false; domCloseAll(); }));
      uiRoot.querySelector('[data-action="join"]')?.addEventListener('click', () => {
        if (player.gold < 50) { toast('Need 50g to join the guild.', 2); return; }
        player.gold -= 50; playerGuild.joined = true; playerGuild.tier = 1;
        toast('Welcome, Apprentice! +5% sell bonus unlocked.', 3); scheduleAutoSave(); dom.key = ''; domRender();
      });
      uiRoot.querySelector('[data-action="advance2"]')?.addEventListener('click', () => {
        if (player.gold < 150) { toast('Need 150g.', 2); return; }
        if ((player.rep?.[cid] || 0) < 5) { toast('Need Rep 5+ here.', 2); return; }
        player.gold -= 150; playerGuild.tier = 2;
        toast('Promoted to Journeyman! +10% sell bonus.', 3); scheduleAutoSave(); dom.key = ''; domRender();
      });
      uiRoot.querySelector('[data-action="advance3"]')?.addEventListener('click', () => {
        if (player.gold < 300) { toast('Need 300g.', 2); return; }
        if ((player.rep?.[cid] || 0) < 15) { toast('Need Rep 15+ here.', 2); return; }
        player.gold -= 300; playerGuild.tier = 3;
        toast('You are now a Master! +18% sell bonus unlocked.', 3); scheduleAutoSave(); dom.key = ''; domRender();
      });
      return;
    }

    if (kind === 'warehouse') {
      const c = currentCity();
      if (!c) { domCloseAll(); return; }
      const cid = c.id;
      if (!warehouseStash[cid]) warehouseStash[cid] = {};
      const stash = warehouseStash[cid];
      const stashRows = ITEMS.filter(it => (stash[it.id] || 0) > 0).map(it =>
        `<div class="cr-card"><div><div class="cr-card-title">${htmlEscape(it.name)}</div><div class="cr-sub">Stored: ${stash[it.id]}</div></div><div class="cr-right"><button class="cr-tab" data-action="retrieve" data-item="${it.id}">Retrieve 1</button></div></div>`
      ).join('');
      const invRows = ITEMS.filter(it => (player.inv[it.id] || 0) > 0).map(it =>
        `<div class="cr-card"><div><div class="cr-card-title">${htmlEscape(it.name)}</div><div class="cr-sub">Carrying: ${player.inv[it.id]}</div></div><div class="cr-right"><button class="cr-tab" data-action="store" data-item="${it.id}">Store 1</button></div></div>`
      ).join('');
      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Warehouse">
          <div class="cr-panel">
            ${bannerHtml}
            <div class="cr-head">
              <div><div class="cr-title">📦 Warehouse — ${htmlEscape(c.name)}</div><div class="cr-sub">Free storage. Items stay in this city.</div></div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>
            <div class="cr-body">
              ${stashRows ? `<div class="cr-sub" style="margin-bottom:4px;font-weight:bold;">Stored here:</div>${stashRows}` : '<div class="cr-sub">Nothing stored here.</div>'}
              ${invRows ? `<div class="cr-sub" style="margin:8px 0 4px;font-weight:bold;">In your pack:</div>${invRows}` : '<div class="cr-sub" style="margin-top:8px;">Pack is empty.</div>'}
            </div>
            <div class="cr-foot"><div class="cr-hint">Esc close</div></div>
          </div>
        </div>
      `;
      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.warehouseOpen = false; domCloseAll(); }));
      uiRoot.querySelectorAll('[data-action="store"]').forEach(el => el.addEventListener('click', () => {
        const itemId = el.getAttribute('data-item');
        if ((player.inv[itemId] || 0) <= 0) { toast('None to store.', 2); return; }
        player.inv[itemId]--;
        stash[itemId] = (stash[itemId] || 0) + 1;
        toast(`Stored 1 ${ITEMS.find(i=>i.id===itemId)?.name || itemId}.`, 1.5); scheduleAutoSave(); dom.key = ''; domRender();
      }));
      uiRoot.querySelectorAll('[data-action="retrieve"]').forEach(el => el.addEventListener('click', () => {
        const itemId = el.getAttribute('data-item');
        const it = ITEMS.find(i => i.id === itemId);
        if ((stash[itemId] || 0) <= 0) { toast('None stored.', 2); return; }
        const w = invWeight();
        if (it && w + it.weight > player.capacity) { toast('No pack space.', 2); return; }
        stash[itemId]--;
        if (stash[itemId] <= 0) delete stash[itemId];
        player.inv[itemId] = (player.inv[itemId] || 0) + 1;
        toast(`Retrieved 1 ${it?.name || itemId}.`, 1.5); scheduleAutoSave(); dom.key = ''; domRender();
      }));
      return;
    }

    if (kind === 'building-donate') {
      const d = dom._buildingDonate;
      if (!d) { domCloseAll(); return; }
      const { cityId, key, slot, nextCost, slotLabel, effectDesc, levelLabel } = d;
      const cityGold = cityTreasury[cityId]?.gold || 0;
      const funded = slot.playerFunded || 0;
      const remaining = nextCost - funded;
      const canDonate10  = player.gold >= 10  && funded < nextCost;
      const canDonate50  = player.gold >= 50  && funded < nextCost;
      const maxDonate = Math.min(player.gold, Math.max(0, nextCost - funded));

      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Build ${htmlEscape(slotLabel)}">
          <div class="cr-panel">
            ${bannerHtml}
            <div class="cr-head">
              <div><div class="cr-title">🏗 Build ${htmlEscape(slotLabel)}${levelLabel}</div>
                   <div class="cr-sub">${htmlEscape(effectDesc)}</div></div>
              <button class="cr-close" data-action="close">CLOSE</button>
            </div>
            <div class="cr-body">
              <div class="cr-card">
                <div style="width:100%">
                  <div class="cr-sub" style="margin-bottom:6px">Construction Funding</div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <span>Total cost</span><strong>${nextCost}g</strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <span>City treasury</span><strong>${cityGold}g</strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <span>Your donations</span><strong style="color:#4ade80">${funded}g</strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <span>Still needed</span><strong style="color:#f59e0b">${Math.max(0, remaining - cityGold)}g</strong>
                  </div>
                  <div style="display:flex;justify-content:space-between">
                    <span>Your gold</span><strong>💰 ${player.gold}g</strong>
                  </div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
                <button class="cr-tab${canDonate10 ? '' : ' cr-tab-disabled'}" data-donate="10">Donate 10g</button>
                <button class="cr-tab${canDonate50 ? '' : ' cr-tab-disabled'}" data-donate="50">Donate 50g</button>
                ${maxDonate > 0 ? `<button class="cr-tab" data-donate="${maxDonate}" style="background:rgba(74,222,128,0.15);color:#4ade80">Fund it all (${maxDonate}g) 🏛</button>` : ''}
              </div>
              <div class="cr-sub" style="margin-top:10px">The city will also contribute automatically from its treasury over time.</div>
            </div>
            <div class="cr-foot"><div class="cr-hint">Esc close</div></div>
          </div>
        </div>
      `;
      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.buildingDonateOpen = false; domCloseAll(); }));
      uiRoot.querySelectorAll('[data-donate]').forEach(el => el.addEventListener('click', () => {
        const amt = parseInt(el.getAttribute('data-donate'), 10);
        if (el.classList.contains('cr-tab-disabled')) return;
        donateToSlot(cityId, key, amt);
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
    img.onload = () => {
      // Infer cell size from the actual image to avoid “grid of icons” cropping bugs.
      // Expect 8 columns and 16 rows, but keep it resilient.
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w > 0 && h > 0) {
        const fw = Math.floor(w / s.cols);
        const fh = Math.floor(h / s.rows);
        if (fw > 0 && fh > 0) { s.frameW = fw; s.frameH = fh; }
      }
      s.ready = true;
    };
    img.onerror = () => {
      s.ready = false;
      if (!s._loggedError) {
        s._loggedError = true;
        console.warn('Player sprite failed to load: assets/player_adventurer.png');
      }
    };
    return s;
  })();

  // --- Completion banner (stacking, max 3)
  const banner = {
    q: [],
    max: 3,
    // Each item: { id, title, text, t, state }
    // state: 'in' | 'out'
  };

  let bannerNextId = 1;
  const BANNER_TTL = 2.6; // seconds visible
  const BANNER_EXIT = 0.28; // seconds for exit animation

  function showBanner(title, text) {
    const item = {
      id: bannerNextId++,
      title: String(title || ''),
      text: String(text || ''),
      t: BANNER_TTL,
      state: 'in',
    };
    banner.q.unshift(item);
    if (banner.q.length > banner.max) banner.q.length = banner.max;
    dom.key = ''; // force domRender to rebuild
    return item.id;
  }

  function tickBanners(dt) {
    if (!banner.q.length) return;
    for (const it of banner.q) {
      it.t -= dt;
      if (it.state === 'in' && it.t <= 0) {
        it.state = 'out';
        it.t = BANNER_EXIT;
      } else if (it.state === 'out' && it.t <= 0) {
        it._remove = true;
      }
    }
    const before = banner.q.length;
    banner.q = banner.q.filter(it => !it._remove);
    if (banner.q.length !== before) dom.key = '';
  }

  function contractRewardLabel(reward, repGain) {
    const parts = [];
    if (Number.isFinite(reward)) parts.push(`+${reward}g`);
    if (Number.isFinite(repGain)) parts.push(`+${repGain} rep`);
    return parts.join(', ');
  }

  const player = {
    x: (world.cities[0].x + world.cities[0].w/2) * TILE,
    y: (world.cities[0].y + world.cities[0].h/2) * TILE,
    r: 8,
    vx: 0,
    vy: 0,
    speed: 90,

    // Movement-derived facing/anim
    facing: { x: 0, y: 1 },

    gold: 160,
    capacity: 18,
    inv: Object.fromEntries(ITEMS.map(it => [it.id, 0])),

    lastCityId: null,
    npcGhostUntil: 0,
    moveStallT: 0,
    moveStallX: 0,
    moveStallY: 0,

    rep: { valdenmere: 0, ashport: 0, crosshaven: 0, ironholt: 0 },
    permits: { valdenmere: false, ashport: false, crosshaven: false, ironholt: false },

    // Intelligence Market: purchased intel cards
    intelLedger: [], // [{id, item, cityId, predictedPrice, direction, boughtDay, expiryDay, reliable, sold, verified}]
    intelSells: 0,   // total intel sold (for rep/scoring)

    // Gear slots: tier index (0=default, 1=tier2, 2=tier3)
    gear: { pack: 0, boots: 0, tool: 0 },
  };

  // --- Save/Load (localStorage)
  // Save slot is scoped to the current player ID (set by login overlay).
  // QA mode and guest (ID 0) use the legacy key for backward compat.
  const _playerId = (typeof window.__PLAYER_ID === 'string' && window.__PLAYER_ID) ? window.__PLAYER_ID : '0';
  const SAVE_KEY = _playerId === '0' ? 'charter-road-save-v1' : `charter-road-save-v1-${_playerId}`;
  const SAVE_SCHEMA_VERSION = 1; // bump when save format changes

  // Wire QA API save key now that SAVE_KEY exists.
  if (__QA.enabled && __QA.api) __QA.api._getSaveKey = () => SAVE_KEY;

  // UI bits
  ui._lastSavedDay = null;
  ui._saveToastUntilMs = 0;
  ui._saveToastText = '';
  ui._saveToastTimer = null;

  function notifySaved(text) {
    ui._saveToastText = text;
    ui._saveToastUntilMs = performance.now() + 1200;
  }

  // ── DB Save/Load ─────────────────────────────────────────────────────────
  // All players (incl. guest uid=0 and QA) save to Supabase player_saves.
  // localStorage always acts as fast local cache / offline fallback.

  const _isGuest = false; // always write to DB so world.html can see every player

  async function saveGameToDb(state) {
    if (!ECONOMY.enabled && !__QA.enabled) return; // skip only if economy is fully disabled AND not QA
    try {
      await fetch(`${ECONOMY.url}/rest/v1/player_saves`, {
        method: 'POST',
        headers: {
          ...economyHeaders(),
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ uid: _playerId, save_data: state, updated_at: new Date().toISOString() }),
      });
    } catch (e) {
      console.warn('[SAVE] DB save failed (non-fatal, local save still written):', e.message);
    }
  }

  async function loadGameFromDb() {
    try {
      const res = await fetch(
        `${ECONOMY.url}/rest/v1/player_saves?uid=eq.${encodeURIComponent(_playerId)}&select=save_data`,
        { headers: economyHeaders() }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows[0].save_data;
    } catch (e) {
      console.warn('[LOAD] DB load failed, falling back to localStorage:', e.message);
      return null;
    }
  }

  function saveGame() {
    const state = {
      saveVersion: SAVE_SCHEMA_VERSION,
      buildVersion: 'v0.1.6',
      player: {
        x: player.x,
        y: player.y,
        gold: player.gold,
        capacity: player.capacity,
        inv: { ...player.inv },
        lastCityId: player.lastCityId,
        rep: { ...player.rep },
        permits: { ...player.permits },
        facing: { ...player.facing },
        intelLedger: player.intelLedger ? [...player.intelLedger] : [],
        intelSells: player.intelSells || 0,
        gear: { ...player.gear },
      },
      time: { ...time },
      marketDrift: Object.fromEntries(
        Object.keys(marketDrift).map(cid => [cid, { ...marketDrift[cid] }])
      ),
      contracts: {
        active: contracts.active ? { ...contracts.active } : null,
        byCity: Object.fromEntries(Object.entries(contracts.byCity).map(([k,v]) => [k, v.map(j => ({...j}))])),
        lastRegenDay: { ...contracts.lastRegenDay },
      },
      openedCaches: Array.from(openedCaches),
      cityPop: Object.fromEntries(Object.entries(cityPop).map(([k,v]) => [k, {...v}])),
      cityTreasury: Object.fromEntries(Object.entries(cityTreasury).map(([k,v]) => [k, { gold: v.gold, investLog: [...v.investLog] }])),
      cityBonus: Object.fromEntries(Object.entries(cityBonus).map(([k,v]) => [k, {...v}])),
      cityBuildings: Object.fromEntries(Object.entries(cityBuildings).map(([cid, slots]) => [
        cid, Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, { level: s.level, built: s.built, playerFunded: s.playerFunded }]))
      ])),
      playerBank: { deposits: { ...playerBank.deposits }, loans: { ...playerBank.loans } },
      bankVault: Object.fromEntries(Object.entries(bankVault).map(([k,v]) => [k, {...v}])),
      playerGuild: { ...playerGuild },
      warehouseStash: Object.fromEntries(Object.entries(warehouseStash).map(([k,v]) => [k, {...v}])),
      aiTraders: AI_TRADERS.map(t => ({
        id: t.id, name: t.name, personality: t.personality, color: t.color,
        state: t.state, fromId: t.fromId, toId: t.toId, itemId: t.itemId,
        inv: { ...t.inv }, gold: t.gold,
        startGold: t.startGold || 80,
        totalProfit: t.totalProfit || 0,
        tripsCompleted: t.tripsCompleted || 0,
      })),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      ui._lastSavedDay = time.day;
      notifySaved(`Saved (Day ${time.day})`);
      console.log('[SAVE] Game saved (local)');
    } catch (e) {
      console.warn('[SAVE] Failed to save locally:', e);
    }
    // Fire-and-forget DB save for real players
    saveGameToDb(state);
  }

  function isObj(x) { return !!x && typeof x === 'object'; }

  function validateSave(s) {
    const errors = [];

    if (!isObj(s)) errors.push('save is not an object');

    // saveVersion is optional for legacy saves; if present, must be an integer
    if (s?.saveVersion !== undefined && !Number.isInteger(s.saveVersion)) {
      errors.push('saveVersion must be an integer if present');
    }

    if (!isObj(s?.player)) errors.push('player missing');
    else {
      const p = s.player;
      if (!Number.isFinite(p.x)) errors.push('player.x must be number');
      if (!Number.isFinite(p.y)) errors.push('player.y must be number');
      if (!Number.isFinite(p.gold)) errors.push('player.gold must be number');
      if (!Number.isFinite(p.capacity)) errors.push('player.capacity must be number');

      if (!isObj(p.inv)) errors.push('player.inv must be object');
      if (!isObj(p.rep)) errors.push('player.rep must be object');
      if (!isObj(p.permits)) errors.push('player.permits must be object');
      if (!isObj(p.facing)) errors.push('player.facing must be object');
      else {
        if (!Number.isFinite(p.facing.x)) errors.push('player.facing.x must be number');
        if (!Number.isFinite(p.facing.y)) errors.push('player.facing.y must be number');
      }

      if (p.lastCityId != null && typeof p.lastCityId !== 'string') {
        errors.push('player.lastCityId must be string|null');
      }
    }

    if (!isObj(s?.time)) errors.push('time missing');
    else {
      const t = s.time;
      if (!Number.isFinite(t.day)) errors.push('time.day must be number');
      if (!Number.isFinite(t.frac)) errors.push('time.frac must be number');
      if (!Number.isFinite(t.seed)) errors.push('time.seed must be number');
    }

    if (s.marketDrift !== undefined) {
      if (!isObj(s.marketDrift)) errors.push('marketDrift must be object');
      else {
        if (!isObj(s.marketDrift)) errors.push('marketDrift must be object');
      }
    }

    if (s.contracts !== undefined) {
      if (!isObj(s.contracts)) errors.push('contracts must be object');
      else {
        const a = s.contracts.active;
        if (a !== null && a !== undefined) {
          if (!isObj(a)) errors.push('contracts.active must be object|null');
        }
      }
    }

    if (s.openedCaches !== undefined) {
      if (!Array.isArray(s.openedCaches)) errors.push('openedCaches must be an array if present');
    }

    return { ok: errors.length === 0, errors };
  }

  function migrateSave(raw) {
    let s;
    try { s = structuredClone(raw); }
    catch { s = JSON.parse(JSON.stringify(raw)); }

    const v = Number.isInteger(s?.saveVersion) ? s.saveVersion : 0;

    if (v === 0) {
      s.saveVersion = 1;

      // Legacy saves used `version` as a build string.
      if (s.version && !s.buildVersion) {
        s.buildVersion = s.version;
        // keep s.version for backward compatibility
      }

      s.player ||= {};
      s.player.inv ||= {};
      // Migration: old saves used sunspire/gloomwharf ids
      if (s.player.rep?.sunspire !== undefined) { s.player.rep.valdenmere = s.player.rep.sunspire; delete s.player.rep.sunspire; }
      if (s.player.rep?.gloomwharf !== undefined) { s.player.rep.ashport = s.player.rep.gloomwharf; delete s.player.rep.gloomwharf; }
      if (s.player.permits?.sunspire !== undefined) { s.player.permits.valdenmere = s.player.permits.sunspire; delete s.player.permits.sunspire; }
      if (s.player.permits?.gloomwharf !== undefined) { s.player.permits.ashport = s.player.permits.gloomwharf; delete s.player.permits.gloomwharf; }
      s.player.rep ||= { valdenmere: 0, ashport: 0, crosshaven: 0, ironholt: 0 };
      s.player.permits ||= { valdenmere: false, ashport: false, crosshaven: false, ironholt: false };
      // Ensure all city keys exist
      for (const cid of ['valdenmere','ashport','crosshaven','ironholt']) {
        s.player.rep[cid] ??= 0;
        s.player.permits[cid] ??= false;
      }
      s.player.facing ||= { x: 0, y: 1 };

      s.time ||= { day: 1, frac: 0, seed: 1 };
      s.marketDrift ||= {};
      for (const cid of ['valdenmere','ashport','crosshaven','ironholt']) s.marketDrift[cid] ||= {};
      // Migrate old city keys
      if (s.marketDrift.sunspire) { s.marketDrift.valdenmere = s.marketDrift.sunspire; delete s.marketDrift.sunspire; }
      if (s.marketDrift.gloomwharf) { s.marketDrift.ashport = s.marketDrift.gloomwharf; delete s.marketDrift.gloomwharf; }

      s.contracts ||= { active: null };
      if (s.contracts.active === undefined) s.contracts.active = null;

      if (!Array.isArray(s.openedCaches)) s.openedCaches = [];
    }

    // Ensure openedCaches exists for newer saves too.
    if (!Array.isArray(s.openedCaches)) s.openedCaches = [];

    return s;
  }

  function _applyLoadedState(state) {
    // Restore player
    Object.assign(player, state.player);
    if (!player.gear) player.gear = { pack: 0, boots: 0, tool: 0 };
    applyGearStats();
    // Restore time
    Object.assign(time, state.time);
    // Restore market drift
    for (const cid of Object.keys(marketDrift)) {
      if (state.marketDrift?.[cid]) Object.assign(marketDrift[cid], state.marketDrift[cid]);
    }
    // Restore contracts
    contracts.active = state.contracts?.active || null;
    if (state.contracts?.byCity) {
      for (const cid of Object.keys(contracts.byCity)) {
        if (Array.isArray(state.contracts.byCity[cid]) && state.contracts.byCity[cid].length > 0) {
          contracts.byCity[cid] = state.contracts.byCity[cid];
        }
      }
    }
    if (state.contracts?.lastRegenDay) {
      Object.assign(contracts.lastRegenDay, state.contracts.lastRegenDay);
    }
    // Restore cityPop
    if (state.cityPop) {
      for (const cid of Object.keys(cityPop)) {
        if (state.cityPop[cid]) Object.assign(cityPop[cid], state.cityPop[cid]);
      }
    }
    // Restore city treasury + bonuses
    if (state.cityTreasury) {
      for (const cid of Object.keys(cityTreasury)) {
        if (state.cityTreasury[cid]) Object.assign(cityTreasury[cid], state.cityTreasury[cid]);
      }
    }
    if (state.cityBonus) {
      for (const cid of Object.keys(cityBonus)) {
        if (state.cityBonus[cid]) Object.assign(cityBonus[cid], state.cityBonus[cid]);
      }
    }
    // Restore city buildings (and rebuild map tiles for built slots)
    if (state.cityBuildings) {
      for (const [cid, slots] of Object.entries(state.cityBuildings)) {
        if (!cityBuildings[cid]) continue;
        for (const [key, saved] of Object.entries(slots)) {
          const slot = cityBuildings[cid][key];
          if (!slot) continue;
          slot.level = saved.level ?? 0;
          slot.built = saved.built ?? false;
          slot.playerFunded = saved.playerFunded ?? 0;
          if (slot.built) {
            buildSlotOnMap(cid, key, slot);
          }
        }
      }
    }
    // Restore bank, guild, warehouse
    if (state.playerBank) {
      playerBank.deposits = state.playerBank.deposits || {};
      playerBank.loans = state.playerBank.loans || {};
    }
    if (state.bankVault) {
      for (const cid of Object.keys(bankVault)) {
        if (state.bankVault[cid]) Object.assign(bankVault[cid], state.bankVault[cid]);
      }
    }
    if (state.playerGuild) Object.assign(playerGuild, state.playerGuild);
    if (state.warehouseStash) {
      for (const [k, v] of Object.entries(state.warehouseStash)) {
        warehouseStash[k] = { ...v };
      }
    }
    // Restore opened caches
    openedCaches.clear();
    if (Array.isArray(state.openedCaches)) {
      for (const k of state.openedCaches) if (typeof k === 'string') openedCaches.add(k);
    }
    // Re-center camera on player
    camera.x = player.x - VIEW_W/2;
    camera.y = player.y - VIEW_H/2;
  }

  function _parseAndApply(raw, source) {
    let parsed;
    try { parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); }
    catch (e) { console.warn(`[LOAD] Bad JSON from ${source}:`, e); return false; }
    const state = migrateSave(parsed);
    const vr = validateSave(state);
    if (!vr.ok) { console.warn(`[LOAD] Invalid save from ${source}:`, vr.errors); return false; }
    _applyLoadedState(state);
    // Write canonical migrated save back to localStorage as cache
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch {}
    console.log(`[LOAD] Game loaded from ${source} (day ${time.day})`);
    toast(`Game loaded (day ${time.day}).`, 2);
    return true;
  }

  function loadGame() {
    // Guests and QA: localStorage only
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { console.log('[LOAD] No local save found'); return false; }
    const ok = _parseAndApply(raw, 'localStorage');
    if (!ok) { toast('Load failed: corrupted save.', 2.5); }
    return ok;
  }

  // Async load for real players: try DB first, fall back to localStorage
  async function loadGameAsync() {

    const dbData = await loadGameFromDb();
    if (dbData) {
      // DB save found — compare day with local to pick newest
      let localDay = 0;
      try {
        const localRaw = localStorage.getItem(SAVE_KEY);
        if (localRaw) {
          const localParsed = JSON.parse(localRaw);
          localDay = localParsed?.time?.day || 0;
        }
      } catch {}
      const dbDay = dbData?.time?.day || 0;

      if (dbDay >= localDay) {
        console.log(`[LOAD] Using DB save (day ${dbDay}) over local (day ${localDay})`);
        return _parseAndApply(dbData, 'database');
      } else {
        console.log(`[LOAD] Local save (day ${localDay}) newer than DB (day ${dbDay}), using local`);
        return loadGame();
      }
    }
    // No DB save — fall back to local
    return loadGame();
  }

  function deleteSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      console.log('[SAVE] Save deleted');
    } catch (e) {
      console.warn('[SAVE] Failed to delete:', e);
    }
  }

  // Auto-save on certain actions
  let autoSaveTimer = null;
  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveGame, 500); // reduced from 2000ms — saves faster after action
  }

  // Flush any pending auto-save immediately when tab is hidden or closed.
  // Without this, closing/backgrounding within 2s of an action loses the save.
  function flushAutoSaveNow() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
      saveGame();
    }
  }
  window.addEventListener('beforeunload', flushAutoSaveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutoSaveNow();
  });
  // Periodic safety save every 60s regardless of activity
  setInterval(saveGame, 60_000);

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
    // City-specific price multipliers
    // Each city has a clear economic identity with 2–3 cheap items and 2–3 expensive ones.
    // Routes designed so no single item dominates; relic nerfed, ink contraband buffed,
    // grain given a niche, early herbs/food routes are starter-friendly.
    const mults = {
      // Valdenmere: trade capital — imports ore, exports relics, hates potions (local alchemy)
      valdenmere: { grain: 1.10, food: 1.10, ore: 1.20, herbs: 1.05, potion: 0.85, relic: 1.15, ink: 1.05 },
      // Ashport: port city — imports food via sea (cheap), strong demand for ink+relics
      ashport:    { grain: 1.05, food: 0.90, ore: 1.05, herbs: 1.10, potion: 1.15, relic: 1.20, ink: 1.20 },
      // Crosshaven: farming village — cheapest grain+food+herbs, average everything else
      crosshaven: { grain: 0.90, food: 0.85, ore: 1.00, herbs: 0.85, potion: 1.00, relic: 1.00, ink: 1.00 },
      // Ironholt: mining town — dirt cheap ore, expensive food+herbs (isolated supply)
      // Ink is cheap too (mining camps stockpile it) — must travel far to profit on ink
      ironholt:   { grain: 1.15, food: 1.30, ore: 0.65, herbs: 1.20, potion: 1.10, relic: 0.85, ink: 0.90 },
    };
    const mult = (mults[cityId] && mults[cityId][item.id]) ? mults[cityId][item.id] : 1.0;
    // Same day-based wobble as quoteFor — no real-time flicker, changes once per in-game day
    const wob = dayWobble(cityId, item);
    const drift = (marketDrift[cityId] && marketDrift[cityId][item.id]) ? marketDrift[cityId][item.id] : 1;
    // Global economy: player collective pressure shifts prices
    const econ = economyModifier(cityId, item.id);
    return Math.max(1, Math.round(item.base * mult * wob * drift * econ));
  }

  function isSolidAt(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    return SOLID.has(tileAt(tx, ty));
  }

  function moveWithCollision(dt) {
    if (ui.marketOpen || ui.eventOpen || ui.contractsOpen) return;
    if (autoNav.active) return; // auto-nav handles movement in updateAutoNav

    // ── Direction from keyboard (still supported as fallback) ─────────
    let ax = (isDown('KeyD') || isDown('ArrowRight') ? 1 : 0) - (isDown('KeyA') || isDown('ArrowLeft') ? 1 : 0);
    let ay = (isDown('KeyS') || isDown('ArrowDown') ? 1 : 0) - (isDown('KeyW') || isDown('ArrowUp') ? 1 : 0);
    let kbActive = ax !== 0 || ay !== 0;

    // ── Click/tap-to-move (path-following) ──────────────────────────
    if (clickMove.active && !kbActive) {
      // ── Waypoint lookahead: skip any waypoints the player has already passed ──
      // This prevents "orbiting" when the player slides past a waypoint center.
      if (clickMove.path.length > 0) {
        while (clickMove.pathIdx < clickMove.path.length - 1) {
          const wp = clickMove.path[clickMove.pathIdx];
          const wdx = wp.x - player.x, wdy = wp.y - player.y;
          if (Math.hypot(wdx, wdy) < TILE * 0.9) {
            clickMove.pathIdx++;
          } else {
            break;
          }
        }
      }

      // Determine current target: next waypoint or final dest
      let curTx = clickMove.tx, curTy = clickMove.ty;
      if (clickMove.path.length > 0 && clickMove.pathIdx < clickMove.path.length) {
        const wp = clickMove.path[clickMove.pathIdx];
        curTx = wp.x; curTy = wp.y;
      }

      const dx = curTx - player.x;
      const dy = curTy - player.y;
      const dist = Math.hypot(dx, dy);

      // Stuck recovery: if player hasn't moved for 15+ frames at this waypoint,
      // replan the path from current position to avoid getting locked on corners.
      if (dist > TILE * 0.9) {
        const stuckKey = `${clickMove.pathIdx}`;
        if (clickMove._stuckKey !== stuckKey) {
          clickMove._stuckKey = stuckKey;
          clickMove._stuckFrames = 0;
          clickMove._stuckX = player.x;
          clickMove._stuckY = player.y;
        } else {
          const movedDist = Math.hypot(player.x - (clickMove._stuckX || player.x),
                                       player.y - (clickMove._stuckY || player.y));
          if (movedDist < 1.0) {
            clickMove._stuckFrames = (clickMove._stuckFrames || 0) + 1;
            if (clickMove._stuckFrames > 15) {
              clickMove._stuckFrames = 0;
              // Try to replan from current position to remaining destination
              const destWp = clickMove.path[clickMove.path.length - 1];
              const destX = destWp ? destWp.x : clickMove.tx;
              const destY = destWp ? destWp.y : clickMove.ty;
              const savedAction = clickMove._tapAction;
              const savedTarget = clickMove._tapTarget;
              planClickPath(destX, destY, savedAction, savedTarget);
              // planClickPath overwrites _tapAction/_tapTarget — restore
              clickMove._tapAction = savedAction;
              clickMove._tapTarget = savedTarget;
              // Exit this frame's logic; new path will be followed next frame
              ax = 0; ay = 0;
              // Fall through to movement with zero input (no-op this frame)
            }
          } else {
            clickMove._stuckFrames = 0;
            clickMove._stuckX = player.x;
            clickMove._stuckY = player.y;
          }
        }
      }

      const arrivedAtWp = dist < TILE * 0.9;
      const arrivedAtFinal = clickMove.path.length === 0
        ? dist < TILE * 0.9
        : clickMove.pathIdx >= clickMove.path.length - 1 && dist < TILE * 0.9;

      if (arrivedAtWp && clickMove.path.length > 0 && !arrivedAtFinal) {
        // Advance to next waypoint
        clickMove.pathIdx++;
        if (clickMove.pathIdx < clickMove.path.length) {
          const nwp = clickMove.path[clickMove.pathIdx];
          const ndx = nwp.x - player.x, ndy = nwp.y - player.y;
          const nd = Math.hypot(ndx, ndy);
          if (nd > 0) { ax = ndx/nd; ay = ndy/nd; }
        }
      }

      if (arrivedAtFinal || (clickMove.path.length === 0 && dist < TILE * 0.9)) {
        // Arrived at destination — trigger tap action if any
        clickMove.active = false;
        ax = 0; ay = 0;
        if (clickMove._tapAction) {
          const action = clickMove._tapAction;
          clickMove._tapAction = null;
          if (action === 'npc') {
            const npc = entities.find(e2 => e2.kind === 'npc' && e2.id === clickMove._tapTarget);
            if (npc) triggerNpcTalk(npc);
          } else if (action === 'market') {
            const c = currentCity();
            if (c) {
              ui.contractsOpen = false;
              ui.marketOpen = true;
              ui.selection = 0;
              ui.mode = 'buy';
              toast(`Market opened in ${c.name}`, 1.8);
            }
          } else if (action === 'contracts') {
            const c = currentCity();
            if (c) {
              ui.marketOpen = false;
              ui.contractsOpen = true;
              ui.contractsSel = 0;
              ui.contractsCityId = c.id;
              toast('Contracts board opened', 1.8);
            }
          } else if (action === 'bank') {
            const c = currentOrNearestCity(8);
            if (c) { ui.bankOpen = true; ui.bankTab = 'deposit'; domEnsureOpen(); dom.key = ''; domRender(); toast(`Bank of ${c.name} opened.`, 2); }
          } else if (action === 'inn') {
            const c = currentOrNearestCity(8);
            if (c) { ui.innOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast(`${c.name} Inn.`, 2); }
          } else if (action === 'guild') {
            const c = currentOrNearestCity(8);
            if (c) { ui.guildOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast('Merchants Guild.', 2); }
          } else if (action === 'warehouse') {
            const c = currentOrNearestCity(8);
            if (c) { ui.warehouseOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast('Warehouse opened.', 2); }
          }
        }
      } else {
        ax = dx / dist;
        ay = dy / dist;
      }
    } else if (kbActive) {
      // Keyboard overrides click-move
      clickMove.active = false;
    }

    const mag = Math.hypot(ax, ay);
    const nx = mag > 0 ? ax / mag : 0;
    const ny = mag > 0 ? ay / mag : 0;

    player.vx = nx * player.speed;
    player.vy = ny * player.speed;

    // Track last facing direction from input (for 8-way sprite)
    if (mag > 0) player.facing = { x: nx, y: ny };

    const stepX = player.vx * dt;
    const stepY = player.vy * dt;

    // While following a click-move path, keep NPC ghost active so wandering
    // NPCs don't permanently block the route mid-walk.
    if (clickMove.active) {
      player.npcGhostUntil = Math.max(player.npcGhostUntil || 0, stateTime + 500);
    }

    // X axis collision
    // Use a 1px inset on the collision radius during click-move to avoid
    // snagging on single-pixel wall corners while staying on A* path.
    const cr = clickMove.active ? Math.max(player.r - 1, 1) : player.r;
    let nxPos = player.x + stepX;
    if (!isSolidAt(nxPos - cr, player.y - cr) &&
        !isSolidAt(nxPos + cr, player.y - cr) &&
        !isSolidAt(nxPos - cr, player.y + cr) &&
        !isSolidAt(nxPos + cr, player.y + cr) &&
        !isNpcBlocking(nxPos, player.y)) {
      player.x = nxPos;
    }
    // X blocked: do NOT cancel click-move — let Y-axis slide continue the path

    // Y axis collision
    let nyPos = player.y + stepY;
    if (!isSolidAt(player.x - cr, nyPos - cr) &&
        !isSolidAt(player.x + cr, nyPos - cr) &&
        !isSolidAt(player.x - cr, nyPos + cr) &&
        !isSolidAt(player.x + cr, nyPos + cr) &&
        !isNpcBlocking(player.x, nyPos)) {
      player.y = nyPos;
    }

    // clamp to map
    player.x = clamp(player.x, TILE, MAP_W*TILE - TILE);
    player.y = clamp(player.y, TILE, MAP_H*TILE - TILE);

    resolvePlayerNpcOverlap();
  }



  function getCityById(id) {
    return world.cities.find(c => c.id === id) || null;
  }

  function cityName(id) {
    const c = getCityById(id);
    return c ? c.name : String(id || '');
  }

  function getMarketRumors(cityId) {
    const id = String(cityId || '');
    const c = getCityById(id);
    if (!c) return [];

    // Always-true rumors derived from actual computed prices vs another city.
    // Use day directly as index so it reliably rotates each day
    const others = world.cities.filter(c => c.id !== id);
    const dayIdx = Math.floor(time.day) % others.length;
    const otherC = others[dayIdx] || others[0];
    const other = otherC ? otherC.id : id;

    const list = [];
    for (const it of ITEMS) {
      const pHere = priceFor(id, it);
      const pThere = otherC ? priceFor(other, it) : pHere;
      const ratio = pThere > 0 ? (pHere / pThere) : 1;
      list.push({ it, pHere, pThere, ratio });
    }

    // Two strongest opportunities: one "cheap here" (lowest ratio), one "expensive here" (highest ratio).
    list.sort((a, b) => a.ratio - b.ratio);
    const cheap = list[0];
    list.sort((a, b) => b.ratio - a.ratio);
    const pricey = list[0];

    const otherName = cityName(other);
    const lines = [];
    if (cheap && cheap.it) {
      lines.push(`${cheap.it.name} is cheaper here vs ${otherName}.`);
    }
    if (pricey && pricey.it) {
      // Avoid duplicate item line; pick next best if needed.
      if (cheap && pricey.it.id === cheap.it.id) {
        const alt = list.find(x => x.it.id !== cheap.it.id);
        if (alt) lines.push(`${alt.it.name} fetches more in ${otherName}.`);
      } else {
        lines.push(`${pricey.it.name} fetches more in ${otherName}.`);
      }
    }

    return lines.slice(0, 2);
  }
  function currentCity() {
    const px = player.x / TILE;
    const py = player.y / TILE;
    for (const c of world.cities) {
      if (px >= c.x && px < c.x + c.w && py >= c.y && py < c.y + c.h) return c;
    }
    return null;
  }

  // Like currentCity() but also returns the nearest city within 3 tiles — useful
  // when the player is standing in a building at the city boundary.
  function currentOrNearestCity(radiusTiles = 3) {
    const c = currentCity();
    if (c) return c;
    const px = player.x / TILE;
    const py = player.y / TILE;
    let best = null, bestD = radiusTiles;
    for (const city of world.cities) {
      const cx = city.x + city.w / 2;
      const cy = city.y + city.h / 2;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = city; }
    }
    return best;
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


  function nearTile(tileId) {
    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        if (tileAt(tx + ox, ty + oy) === tileId) return true;
      }
    }
    return false;
  }

  function nearPOITile() {
    // Only trigger cache POI outside city bounds (tile 13 inside cities is the Bank building)
    const inCity = !!currentCity();
    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const id = tileAt(tx + ox, ty + oy);
        if (id >= 7 && id <= 9) return id;
        if (id === 13 && !inCity) return id; // cache only on road/wilderness
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

  // Cache POIs (tile 13) are single-use per save.
  const openedCaches = new Set();
  const cacheKey = (tx, ty) => `${tx},${ty}`;

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

    if (poiId === 13) {
      const tx = Math.floor(player.x / TILE);
      const ty = Math.floor(player.y / TILE);
      // find the actual cache tile within 1 tile radius
      let ctx = null, cty = null;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const x = tx + ox;
          const y = ty + oy;
          if (tileAt(x, y) === 13) { ctx = x; cty = y; break; }
        }
        if (ctx !== null) break;
      }
      if (ctx === null) { toast('No cache here.', 1.6); return; }

      const key = cacheKey(ctx, cty);
      if (openedCaches.has(key)) {
        toast('This cache has already been looted.', 2.2);
        return;
      }

      openEvent({
        title: 'Hidden Cache',
        text: 'A half-buried stash sits beneath loose stones. Open it?',
        choices: [
          { label: 'Open it', run: () => {
              openedCaches.add(key);

              // Deterministic reward via rand01 (seeded), so QA is stable.
              const r = rand01();
              if (r < 0.55) {
                const g = 6 + Math.floor(rand01() * 15);
                player.gold += g;
                toast(`Cache: +${g}g`, 2.2);
              } else if (r < 0.85) {
                const pool = ['food','ore','herbs'];
                const itId = pool[Math.floor(rand01() * pool.length)];
                const n = 1 + (rand01() < 0.35 ? 1 : 0);
                player.inv[itId] = (player.inv[itId] || 0) + n;
                const it = ITEMS.find(x => x.id === itId);
                toast(`Cache: +${n} ${it ? it.name : itId}`, 2.4);
              } else {
                // Light risk/cost: lose a day (and upkeep will apply elsewhere as normal)
                advanceDays(1, 'cache');
                toast('Trap! You waste a day dealing with it.', 2.6);
              }

              scheduleAutoSave();
              closeEvent();
            }
          },
          { label: 'Leave it', run: closeEvent },
        ],
      });


      return;
    }

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

    const kind = randChoice([
      'bandits', 'toll', 'storm', 'omen', 'escort',
      'wandering_merchant', 'wounded_soldier', 'plague_cart',
      'lost_cargo', 'wild_animal',
    ]);

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

    } else if (kind === 'toll') {
      openEvent({
        title: 'Toll Checkpoint',
        text: 'A petty lord has stationed guards here. Pay the toll or detour through rough terrain.',
        choices: [
          { label: 'Pay 12g', run: () => { const paid = Math.min(player.gold, 12); player.gold -= paid; toast(`Paid ${paid}g toll.`, 2.4); closeEvent(); } },
          { label: 'Detour (slow)', run: () => { road.cooldown = 12.0; toast('You detour. No toll, but it wastes time.', 3); closeEvent(); } },
        ],
      });

    } else if (kind === 'storm') {
      openEvent({
        title: 'Sudden Storm',
        text: 'Wind and rain hammer the road. Your pack gets soaked.',
        choices: [
          { label: 'Push through', run: () => {
              road.cooldown = 10.0;
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

    } else if (kind === 'omen') {
      // Omen is a lucky find — but 25% chance it's a lure and a pickpocket strikes
      openEvent({
        title: 'Strange Omen',
        text: 'A glint of gold on the roadside catches your eye. Could be luck — or a lure.',
        choices: [
          { label: 'Investigate', run: () => {
              if (rand01() < 0.25) {
                const loss = 5 + Math.floor(rand01() * 8);
                const paid = Math.min(player.gold, loss);
                player.gold -= paid;
                toast(`A pickpocket strikes while you look! Lost ${paid}g.`, 3.2);
              } else {
                const g = 5 + Math.floor(rand01() * 8);
                player.gold += g;
                toast(`Good omen! Found ${g}g.`, 2.4);
              }
              closeEvent();
            }
          },
          { label: 'Ignore and press on', run: () => { toast('You keep walking. Better safe than sorry.', 2); closeEvent(); } },
        ],
      });

    } else if (kind === 'escort') {
      // Escort now has risk — 20% chance of ambush, costing you both 10g
      openEvent({
        title: 'Merchant Escort',
        text: 'A nervous merchant asks for protection through a rough stretch. He will pay 12g — but the road ahead looks dangerous.',
        choices: [
          { label: 'Escort (earn 12g, some risk)', run: () => {
              if (rand01() < 0.20) {
                const loss = Math.min(player.gold, 10);
                player.gold -= loss;
                toast(`Ambush! You drove them off but took a hit. Lost ${loss}g.`, 3.2);
              } else {
                player.gold += 12;
                toast('You escort the merchant safely. +12g.', 2.4);
              }
              closeEvent();
            }
          },
          { label: 'Decline', run: () => { toast('The merchant finds others.', 2); closeEvent(); } },
        ],
      });

    } else if (kind === 'wandering_merchant') {
      const it = ITEMS[Math.floor(rand01() * ITEMS.length)];
      const nearCityId = (world.cities.length > 0) ? world.cities[Math.floor(rand01() * world.cities.length)].id : 'valdenmere';
      const fullPrice = priceFor(nearCityId, it);
      const discountPrice = Math.max(1, Math.round(fullPrice * 0.80));
      openEvent({
        title: 'Wandering Merchant',
        text: `A road merchant offers ${it.name} at a discount — ${discountPrice}g each (market is ~${fullPrice}g).`,
        choices: [
          { label: `Buy 1 for ${discountPrice}g`, run: () => {
              if (player.gold < discountPrice) { toast('Not enough gold.', 2); closeEvent(); return; }
              const w = invWeight() + it.weight;
              if (w > player.capacity) { toast('No room in your pack.', 2); closeEvent(); return; }
              player.gold -= discountPrice;
              player.inv[it.id] = (player.inv[it.id] || 0) + 1;
              toast(`Bought 1 ${it.name} for ${discountPrice}g.`, 2.5);
              closeEvent();
            }
          },
          { label: 'Pass', run: closeEvent },
        ],
      });

    } else if (kind === 'wounded_soldier') {
      // Rep goes to the nearest city ahead (player's destination), not current (they're on the road)
      const destCity = world.cities.find(c2 => c2.id === player.lastCityId)
        || world.cities.reduce((best, c2) => {
          const dx = (c2.x + c2.w/2) * TILE - player.x;
          const dy = (c2.y + c2.h/2) * TILE - player.y;
          const dist = Math.hypot(dx, dy);
          return (!best || dist < best.dist) ? { city: c2, dist } : best;
        }, null)?.city
        || world.cities[0];
      openEvent({
        title: 'Wounded Soldier',
        text: 'A soldier collapsed on the road, uniform torn. He needs food and rest.',
        choices: [
          { label: 'Help (spend 1 ration)', run: () => {
              if ((player.inv['food'] || 0) < 1) { toast('No rations to spare.', 2); closeEvent(); return; }
              player.inv['food'] -= 1;
              player.rep[destCity.id] = (player.rep[destCity.id] || 0) + 2;
              toast(`You helped the soldier. +2 rep in ${destCity.name}.`, 3);
              closeEvent();
            }
          },
          { label: 'Ignore and move on', run: () => { toast('You walk past. The road feels heavier.', 2.5); closeEvent(); } },
        ],
      });

    } else if (kind === 'plague_cart') {
      openEvent({
        title: 'Quarantine Barrier',
        text: 'Guards in masks block the road — a plague cart passed through. Pay a 15g disinfection fee, or wait it out.',
        choices: [
          { label: 'Pay 15g to pass', run: () => {
              const paid = Math.min(player.gold, 15);
              player.gold -= paid;
              toast(`Paid ${paid}g. You continue onward.`, 2.4);
              closeEvent();
            }
          },
          { label: 'Wait (lose 1 day)', run: () => {
              advanceDays(1, 'quarantine wait');
              toast('You wait at camp. The road clears by morning.', 3);
              closeEvent();
            }
          },
        ],
      });

    } else if (kind === 'lost_cargo') {
      openEvent({
        title: 'Abandoned Crate',
        text: 'A sealed crate sits in the ditch, no markings. Might be valuable — or dangerous.',
        choices: [
          { label: 'Open it', run: () => {
              const r = rand01();
              if (r < 0.5) {
                const pool = ['potion','herbs','relic'];
                const itId = pool[Math.floor(rand01() * pool.length)];
                const it2 = ITEMS.find(x => x.id === itId);
                player.inv[itId] = (player.inv[itId] || 0) + 1;
                toast(`Found 1 ${it2 ? it2.name : itId}!`, 2.6);
              } else if (r < 0.8) {
                const loss = 8 + Math.floor(rand01() * 10);
                const paid = Math.min(player.gold, loss);
                player.gold -= paid;
                toast(`Booby-trapped! Lost ${paid}g dealing with it.`, 3);
              } else {
                toast('Just hay and broken glass. Nothing useful.', 2.2);
              }
              closeEvent();
            }
          },
          { label: 'Leave it', run: closeEvent },
        ],
      });

    } else if (kind === 'wild_animal') {
      openEvent({
        title: 'Wolf Pack',
        text: 'A hungry wolf pack circles the road ahead, blocking your path.',
        choices: [
          { label: 'Flee (drop 1 ration)', run: () => {
              if ((player.inv['food'] || 0) > 0) {
                player.inv['food'] -= 1;
                toast('You flee, tossing a ration behind you. They take the bait.', 3);
              } else {
                const g = Math.min(player.gold, 6);
                player.gold -= g;
                toast(`Nothing to drop! They chase you. Lost ${g}g in the confusion.`, 3.2);
              }
              closeEvent();
            }
          },
          { label: 'Fight them off', run: () => {
              if (rand01() < 0.52) {
                const g = 4 + Math.floor(rand01() * 8);
                player.gold += g;
                toast(`You drove them off! Sold the pelt for ${g}g.`, 2.8);
              } else {
                const hurt = 8 + Math.floor(rand01() * 10);
                const paid = Math.min(player.gold, hurt);
                player.gold -= paid;
                toast(`Bitten badly. Lost ${paid}g on road-side medicine.`, 3);
              }
              closeEvent();
            }
          },
        ],
      });
    }
  }

  window.addEventListener('keydown', (e) => {
    // Close intel modal on Escape
    if (e.code === 'Escape' && intelUI.open) { closeIntelUI(); return; }
    // Close trader modal on Escape
    if (e.code === 'Escape' && document.getElementById('cr-trader-modal')) { closeTraderUI(); return; }
    // Close nav picker on Escape
    if (e.code === 'Escape') { const np = document.getElementById('cr-nav-picker'); if (np) { np.remove(); return; } }

    // [T] and [E] interaction keys removed — tap/click buildings directly to interact
    if (e.code === 'Escape' && (ui.bankOpen || ui.innOpen || ui.guildOpen || ui.warehouseOpen)) {
      domCloseAll(); return;
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
      // Stone wall — with battlements on top, beveled blocks
      const n = hash2(tx, ty);
      const wallBase = n < 0.5 ? '#484e5c' : '#404654';
      ctx.fillStyle = wallBase;
      ctx.fillRect(x, y, TILE, TILE);
      // Horizontal mortar line
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + Math.floor(TILE/2), TILE, 1);
      // Block highlight
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x+1, y+1, TILE-2, 2);
      ctx.fillRect(x+1, y+Math.floor(TILE/2)+1, TILE-2, 2);
      // Battlements on top row of walls (decorative notch)
      if (tileAt(tx, ty-1) !== 3) {
        ctx.fillStyle = '#2e333d';
        ctx.fillRect(x, y, Math.floor(TILE/3), 3);
        ctx.fillRect(x+Math.floor(TILE*2/3), y, Math.floor(TILE/3)+1, 3);
      }
      return;
    }

    if (id === 4) {
      // City floor — cobblestone with mortar lines
      const n = hash2(tx, ty);
      const base = n < 0.33 ? '#6b5642' : (n < 0.66 ? '#5f4e3c' : '#645446');
      ctx.fillStyle = base;
      ctx.fillRect(x, y, TILE, TILE);
      // mortar grid
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, y + Math.floor(TILE/2), TILE, 1);
      ctx.fillRect(x + Math.floor(TILE/2), y, 1, TILE);
      // stone highlight
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 1, y + 1, Math.floor(TILE/2) - 2, Math.floor(TILE/2) - 2);
      ctx.fillRect(x + Math.floor(TILE/2) + 1, y + Math.floor(TILE/2) + 1, Math.floor(TILE/2) - 2, Math.floor(TILE/2) - 2);
      return;
    }

    if (id === 5) {
      // Gate arch — stone archway with portcullis bars
      ctx.fillStyle = '#4a3f2e';
      ctx.fillRect(x, y, TILE, TILE);
      // arch body
      ctx.fillStyle = '#8b7355';
      ctx.fillRect(x+1, y+2, TILE-2, TILE-4);
      // arch opening (dark passage)
      ctx.fillStyle = '#1a1208';
      ctx.fillRect(x+4, y+4, TILE-8, TILE-6);
      // portcullis bars
      ctx.fillStyle = '#5a4a30';
      for (let bx = x+5; bx < x+TILE-4; bx += 3) {
        ctx.fillRect(bx, y+4, 1, TILE-7);
      }
      // stone highlight top
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x+1, y+2, TILE-2, 1);
      return;
    }

    if (id === 6) {
      // Market stall — wooden awning + hanging goods + counter
      // Floor
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(x, y, TILE, TILE);
      // Back wall of stall
      ctx.fillStyle = '#8b6914';
      ctx.fillRect(x+1, y+1, TILE-2, TILE-5);
      // Roof/awning (amber yellow, slanted feel)
      ctx.fillStyle = '#d97706';
      ctx.fillRect(x, y, TILE, 4);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x+1, y+1, TILE-2, 2);
      // Counter / display shelf
      ctx.fillStyle = '#6b4c12';
      ctx.fillRect(x+1, y+TILE-5, TILE-2, 3);
      // Items on counter (small colored dots)
      ctx.fillStyle = '#ef4444'; ctx.fillRect(x+3, y+TILE-6, 2, 2);  // red item
      ctx.fillStyle = '#84cc16'; ctx.fillRect(x+7, y+TILE-6, 2, 2);  // green item
      ctx.fillStyle = '#a78bfa'; ctx.fillRect(x+11, y+TILE-6, 2, 2); // purple item
      // Sign above
      ctx.fillStyle = '#292524';
      ctx.fillRect(x+4, y+4, TILE-8, 3);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x+5, y+5, TILE-10, 1);
      return;
    }

    if (id === 7) {
      // Inn / Tavern — timbered building, warm window glow
      // Stone foundation
      ctx.fillStyle = '#4a3f2e';
      ctx.fillRect(x, y, TILE, TILE);
      // Building walls (warm plaster)
      ctx.fillStyle = '#c4a882';
      ctx.fillRect(x+1, y+3, TILE-2, TILE-5);
      // Timber framing (dark cross beams)
      ctx.fillStyle = '#3d2b1a';
      ctx.fillRect(x+1, y+3, TILE-2, 1);      // top beam
      ctx.fillRect(x+Math.floor(TILE/2), y+3, 1, TILE-4); // vertical beam
      ctx.fillRect(x+1, y+Math.floor(TILE*0.6)|0, TILE-2, 1); // middle beam
      // Thatched roof (dark red-brown triangle)
      ctx.fillStyle = '#7c2d12';
      ctx.beginPath();
      ctx.moveTo(x + TILE/2, y);
      ctx.lineTo(x, y+5);
      ctx.lineTo(x+TILE, y+5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#9a3412';
      ctx.fillRect(x, y+4, TILE, 1);
      // Warm window glow
      const glow = 0.55 + 0.15 * Math.sin(stateTime * 0.0012 + tx);
      ctx.fillStyle = `rgba(251,191,36,${glow.toFixed(2)})`;
      ctx.fillRect(x+3, y+5, 4, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x+4, y+6, 2, 2);  // window cross
      // Door
      ctx.fillStyle = '#2a1810';
      ctx.fillRect(x+TILE-6, y+TILE-7, 4, 6);
      ctx.fillStyle = '#7c4a1a';
      ctx.fillRect(x+TILE-5, y+TILE-6, 2, 4);
      return;
    }

    if (id === 8) {
      // Warehouse in cities, Traveler Camp on roads
      const isInCity = tileAt(tx-1,ty)===4 || tileAt(tx+1,ty)===4 || tileAt(tx,ty-1)===4 || tileAt(tx,ty+1)===4;
      if (!isInCity) {
        // Road camp: fire + tent
        ctx.fillStyle = '#2e3a22';
        ctx.fillRect(x, y, TILE, TILE);
        // Tent
        ctx.fillStyle = '#7c5c2e';
        ctx.beginPath();
        ctx.moveTo(x + TILE/2, y + 2);
        ctx.lineTo(x + 2, y + TILE - 4);
        ctx.lineTo(x + TILE - 2, y + TILE - 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#5a3d18';
        ctx.fillRect(x + Math.floor(TILE/2)-1, y+TILE-4, 3, 3); // tent door
        // Campfire glow
        const flame = 0.5 + 0.25 * Math.sin(stateTime * 0.004 + tx * 3);
        ctx.fillStyle = `rgba(255,140,0,${flame.toFixed(2)})`;
        ctx.fillRect(x+TILE-5, y+TILE-5, 3, 3);
        ctx.fillStyle = `rgba(255,220,0,${(flame*0.7).toFixed(2)})`;
        ctx.fillRect(x+TILE-4, y+TILE-5, 1, 2);
        return;
      }
      // Warehouse / Storage — large stone building, big dark doors
      ctx.fillStyle = '#3a3028';
      ctx.fillRect(x, y, TILE, TILE);
      // Walls (rough stone)
      ctx.fillStyle = '#6b5c4a';
      ctx.fillRect(x+1, y+4, TILE-2, TILE-5);
      // Stone blocks detail
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x+1, y+7, TILE-2, 1);
      ctx.fillRect(x+1, y+11, TILE-2, 1);
      ctx.fillRect(x+Math.floor(TILE*0.4)|0, y+4, 1, TILE-5);
      // Flat roof (dark grey slate)
      ctx.fillStyle = '#4b4540';
      ctx.fillRect(x, y+2, TILE, 4);
      ctx.fillStyle = '#5a5048';
      ctx.fillRect(x+1, y+3, TILE-2, 2);
      // Big loading doors (double)
      ctx.fillStyle = '#1c140a';
      ctx.fillRect(x+2, y+TILE-7, (TILE-4)/2-1, 6);
      ctx.fillRect(x+TILE/2+1, y+TILE-7, (TILE-4)/2-1, 6);
      // Door handles
      ctx.fillStyle = '#8b6914';
      ctx.fillRect(x + Math.floor(TILE/2)-2, y+TILE-5, 2, 1);
      ctx.fillRect(x + Math.floor(TILE/2)+1, y+TILE-5, 2, 1);
      return;
    }

    if (id === 9) {
      // Cobblestone plaza / courtyard — premium city floor
      const n = hash2(tx, ty);
      ctx.fillStyle = n < 0.4 ? '#5c4d3c' : '#503f2e';
      ctx.fillRect(x, y, TILE, TILE);
      // Large cobble pattern
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x,   y + Math.floor(TILE/3),     TILE, 1);
      ctx.fillRect(x,   y + Math.floor(TILE*2/3),   TILE, 1);
      ctx.fillRect(x + Math.floor(TILE/3),   y,     1, TILE);
      ctx.fillRect(x + Math.floor(TILE*2/3), y,     1, TILE);
      // Stone highlights
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x+1, y+1, Math.floor(TILE/3)-2, Math.floor(TILE/3)-2);
      ctx.fillRect(x+Math.floor(TILE/3)+1, y+Math.floor(TILE/3)+1, Math.floor(TILE/3)-2, Math.floor(TILE/3)-2);
      ctx.fillRect(x+Math.floor(TILE*2/3)+1, y+1, Math.floor(TILE/3)-2, Math.floor(TILE/3)-2);
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

    if (id === 12) {
      // Contracts board — wooden post with parchment notices
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(x, y, TILE, TILE);
      // Post / board backing (dark wood)
      ctx.fillStyle = '#6b4c1a';
      ctx.fillRect(x+3, y+1, TILE-6, TILE-2);
      // Board face (parchment)
      ctx.fillStyle = '#d4b483';
      ctx.fillRect(x+4, y+2, TILE-8, TILE-7);
      // Notice lines (text illusion)
      ctx.fillStyle = '#3d2b0a';
      ctx.fillRect(x+5, y+4, TILE-10, 1);
      ctx.fillRect(x+5, y+6, TILE-10, 1);
      ctx.fillRect(x+5, y+8, (TILE-10)*0.7|0, 1);
      // Official seal (green circle)
      ctx.fillStyle = '#16a34a';
      ctx.beginPath();
      ctx.arc(x+TILE-6, y+TILE-5, 2, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(x+TILE-7, y+TILE-6, 1, 0, Math.PI*2);
      ctx.fill();
      // Post foot
      ctx.fillStyle = '#3d2b0a';
      ctx.fillRect(x + Math.floor(TILE/2)-1, y+TILE-3, 3, 2);
      return;
    }

    if (id === 13) {
      // Bank (in city context) — stone building with coin symbol
      const isInCity = tileAt(tx-1,ty)===4 || tileAt(tx+1,ty)===4 || tileAt(tx,ty-1)===4 || tileAt(tx,ty+1)===4;
      if (isInCity) {
        // Stone bank building with gold coin
        ctx.fillStyle = '#3a3028';
        ctx.fillRect(x, y, TILE, TILE);
        // Stone walls (grey-blue)
        ctx.fillStyle = '#7a7068';
        ctx.fillRect(x+1, y+4, TILE-2, TILE-5);
        // Stone blocks
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(x+1, y+7, TILE-2, 1);
        ctx.fillRect(x+1, y+11, TILE-2, 1);
        // Flat stone roof
        ctx.fillStyle = '#5a5048';
        ctx.fillRect(x, y+2, TILE, 3);
        ctx.fillStyle = '#6a6058';
        ctx.fillRect(x+1, y+3, TILE-2, 1);
        // Columns (pillars on front)
        ctx.fillStyle = '#8a8070';
        ctx.fillRect(x+2, y+4, 2, TILE-5);
        ctx.fillRect(x+TILE-4, y+4, 2, TILE-5);
        // Door (arched, dark)
        ctx.fillStyle = '#1c140a';
        ctx.fillRect(x+TILE/2-2, y+TILE-7, 5, 6);
        // Gold coin above door
        const coinY = y + 4;
        const coinX = x + TILE/2;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(coinX, coinY + 1, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(coinX - 1, coinY, 2, 2);
        return;
      }
      // On road: cache tile (existing behavior handled by POI system)
      ctx.fillStyle = '#4a3820'; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#fbbf24'; ctx.fillRect(x+3, y+3, TILE-6, TILE-6);
      ctx.fillStyle = '#d97706'; ctx.fillRect(x+5, y+5, TILE-10, TILE-10);
      return;
    }

    if (id === 14) {
      // Inn — warm stone building with hanging lantern
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(x, y, TILE, TILE);
      // Warm stone walls
      ctx.fillStyle = '#a08060';
      ctx.fillRect(x+1, y+3, TILE-2, TILE-4);
      // Tiled roof (darker red-brown)
      ctx.fillStyle = '#7c2d12';
      ctx.fillRect(x, y, TILE, 5);
      ctx.fillStyle = '#9a3412';
      ctx.fillRect(x+1, y+1, TILE-2, 2);
      // Two windows (warm glow — beds inside)
      const glow2 = 0.45 + 0.20 * Math.sin(stateTime * 0.0009 + tx * 1.3);
      ctx.fillStyle = `rgba(255,200,80,${glow2.toFixed(2)})`;
      ctx.fillRect(x+2, y+5, 4, 4);
      ctx.fillRect(x+TILE-6, y+5, 4, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x+3, y+6, 2, 2);
      ctx.fillRect(x+TILE-5, y+6, 2, 2);
      // Door (center, arched top)
      ctx.fillStyle = '#2a1810';
      ctx.fillRect(x+TILE/2-2, y+TILE-7, 5, 6);
      ctx.fillStyle = '#5a3010';
      ctx.fillRect(x+TILE/2-1, y+TILE-6, 3, 4);
      // Lantern hanging above door
      const lanternFlicker = 0.6 + 0.2 * Math.sin(stateTime * 0.005 + tx * 2);
      ctx.fillStyle = `rgba(255,160,20,${lanternFlicker.toFixed(2)})`;
      ctx.fillRect(x+TILE/2-1, y+2, 2, 3);
      return;
    }

    if (id === 15) {
      // Guild Hall — grand stone building with banner
      ctx.fillStyle = '#2e2a20';
      ctx.fillRect(x, y, TILE, TILE);
      // Stone walls (lighter grey)
      ctx.fillStyle = '#8a8070';
      ctx.fillRect(x+1, y+3, TILE-2, TILE-4);
      // Decorative stone detail
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x+2, y+6, TILE-4, 1);
      ctx.fillRect(x+2, y+10, TILE-4, 1);
      // Peaked roof with battlements
      ctx.fillStyle = '#5a5048';
      ctx.fillRect(x, y, TILE, 4);
      ctx.fillStyle = '#4a4038';
      ctx.fillRect(x+1, y+1, 3, 3);  // battlement
      ctx.fillRect(x+TILE-4, y+1, 3, 3);  // battlement
      ctx.fillRect(x+TILE/2-1, y+1, 3, 3);  // center battlement
      // Banner (purple — guild color)
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(x+TILE/2-1, y+3, 3, 5);
      ctx.fillStyle = '#a78bfa';
      ctx.fillRect(x+TILE/2, y+4, 1, 3);
      // Grand double door
      ctx.fillStyle = '#1c140a';
      ctx.fillRect(x+TILE/2-3, y+TILE-7, 6, 6);
      ctx.fillStyle = '#7c4a1a';
      ctx.fillRect(x+TILE/2-2, y+TILE-6, 2, 4);
      ctx.fillRect(x+TILE/2+1, y+TILE-6, 2, 4);
      return;
    }

    if (id === 16) {
      // Vacant building lot — rubble / bare dirt
      const n = hash2(tx, ty);
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(x, y, TILE, TILE);
      // Dirt texture variation
      ctx.fillStyle = '#3d2f18';
      if (n > 0.5) ctx.fillRect(x+2, y+3, TILE-4, TILE-6);
      // Scattered rubble stones
      ctx.fillStyle = '#6a6058';
      ctx.fillRect(x+2, y+2, 3, 2);
      ctx.fillRect(x+TILE-5, y+TILE-5, 4, 3);
      ctx.fillStyle = '#7a7068';
      ctx.fillRect(x+TILE-6, y+3, 3, 2);
      ctx.fillRect(x+3, y+TILE-5, 3, 3);
      ctx.fillRect(x+6, y+7, 2, 2);
      // Highlight fleck on stones
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x+2, y+2, 2, 1);
      ctx.fillRect(x+TILE-5, y+3, 2, 1);
      // Small construction stake
      ctx.fillStyle = '#8b5e2a';
      ctx.fillRect(x+TILE/2-1, y+4, 2, 5);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x+TILE/2-2, y+3, 4, 2);
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


// Building discovery layer: ONE label per building cluster, not per tile.
// Algorithm: flood-fill connected same-type tiles → compute centroid → draw once.
function drawBuildingLabels() {
  if (!currentCity()) return;

  const INTERACT = {
    6:  { label: 'Market',     color: '#fbbf24', nearDist: 6 },
    12: { label: 'Contracts',  color: '#60a5fa', nearDist: 6 },
    7:  { label: 'Tavern',     color: '#f97316', nearDist: 5 },
    8:  { label: 'Warehouse',  color: '#a78bfa', nearDist: 5 },
    13: { label: 'Bank',       color: '#fbbf24', nearDist: 6 },
    14: { label: 'Inn',        color: '#f97316', nearDist: 6 },
    15: { label: 'Guild Hall', color: '#a78bfa', nearDist: 6 },
  };

  const px = player.x, py = player.y;
  const camX = camera.x, camY = camera.y;

  // Scan visible tiles + small padding
  const tileX0 = Math.max(0, Math.floor(camX / TILE) - 2);
  const tileY0 = Math.max(0, Math.floor(camY / TILE) - 2);
  const tileX1 = Math.min(MAP_W - 1, Math.floor((camX + VIEW_W) / TILE) + 2);
  const tileY1 = Math.min(MAP_H - 1, Math.floor((camY + VIEW_H) / TILE) + 2);

  // Collect all interactive tiles in the visible region
  // Then cluster them: two tiles are in the same cluster if they share an edge AND same type
  const visited = new Set();
  const clusters = []; // [{id, info, tiles:[{tx,ty}], cx, cy}]

  for (let ty = tileY0; ty <= tileY1; ty++) {
    for (let tx = tileX0; tx <= tileX1; tx++) {
      const id = tileAt(tx, ty);
      if (!INTERACT[id]) continue;
      const key = ty * MAP_W + tx;
      if (visited.has(key)) continue;

      // BFS flood-fill to find all connected tiles of this type
      const info = INTERACT[id];
      const tiles = [];
      const queue = [{ tx, ty }];
      visited.add(key);

      while (queue.length) {
        const { tx: qx, ty: qy } = queue.shift();
        tiles.push({ tx: qx, ty: qy });
        // 4-connected neighbours
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < tileX0 || nx > tileX1 || ny < tileY0 || ny > tileY1) continue;
          const nk = ny * MAP_W + nx;
          if (visited.has(nk)) continue;
          if (tileAt(nx, ny) !== id) continue;
          visited.add(nk);
          queue.push({ tx: nx, ty: ny });
        }
      }

      // Centroid of the cluster in tile coords
      const sumX = tiles.reduce((s, t) => s + t.tx, 0);
      const sumY = tiles.reduce((s, t) => s + t.ty, 0);
      const cTx = sumX / tiles.length;
      const cTy = sumY / tiles.length;

      clusters.push({ id, info, tiles, cTx, cTy });
    }
  }

  // Draw one glow + label per cluster
  for (const { id, info, tiles, cTx, cTy } of clusters) {
    // Screen coords of cluster centroid
    const scx = (cTx + 0.5) * TILE - camX;
    const scy = (cTy + 0.5) * TILE - camY;

    // Distance from player to cluster centroid (in tiles)
    const distTiles = Math.hypot(cTx + 0.5 - px / TILE, cTy + 0.5 - py / TILE);
    const isNear = distTiles <= info.nearDist + 1;
    const showDot = distTiles <= info.nearDist + 3;

    // Parse color components once
    const pillR = parseInt(info.color.slice(1,3), 16);
    const pillG = parseInt(info.color.slice(3,5), 16);
    const pillB = parseInt(info.color.slice(5,7), 16);

    // ── Pulsing glow outline around each tile in the cluster ──────────
    if (showDot) {
      const pulse = 0.25 + 0.15 * Math.sin(stateTime * 0.003 + cTx * 1.7 + cTy * 2.3);
      const fadeIn = Math.min(1, (info.nearDist + 4 - distTiles) / 3);
      ctx.save();
      ctx.globalAlpha = pulse * fadeIn * (isNear ? 0.75 : 0.35);
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = info.color;
      ctx.shadowBlur = isNear ? 6 : 3;
      for (const { tx, ty } of tiles) {
        const sx = tx * TILE - camX;
        const sy = ty * TILE - camY;
        ctx.strokeRect(sx - 0.5, sy - 0.5, TILE + 1, TILE + 1);
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── Single dot above the cluster centroid ────────────────────────
    if (showDot) {
      const alpha = Math.min(1, (info.nearDist + 4 - distTiles) / 2);
      const bobY = Math.sin(stateTime * 0.004 + cTx + cTy) * 2;
      const dotR = Math.round(3 * UI_SCALE);
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = info.color;
      ctx.shadowColor = info.color;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(scx, scy - dotR * 3 + bobY, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── Single label above the cluster when close ─────────────────────
    if (isNear) {
      const labelAlpha = Math.min(1, (info.nearDist + 2 - distTiles) / 2);
      const bobY = Math.sin(stateTime * 0.004 + cTx + cTy) * 1.5;
      // Place label above the top-most tile of the cluster
      const topTileY = Math.min(...tiles.map(t => t.ty));
      const labelScreenY = topTileY * TILE - camY - 4 + bobY;

      ctx.save();
      ctx.globalAlpha = Math.max(0, labelAlpha * 0.92);
      ctx.font = `700 ${Math.round(9 * UI_SCALE)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';

      const lw = ctx.measureText(info.label).width + Math.round(10 * UI_SCALE);
      const lh = Math.round(12 * UI_SCALE);
      const lx = clamp(scx - lw / 2, 4, VIEW_W - lw - 4);
      const ly = Math.max(4, labelScreenY - lh);

      ctx.fillStyle = `rgba(${pillR},${pillG},${pillB},0.22)`;
      if (ctx.roundRect) ctx.roundRect(lx, ly, lw, lh, 4);
      else ctx.fillRect(lx, ly, lw, lh);
      ctx.fill();
      ctx.strokeStyle = `rgba(${pillR},${pillG},${pillB},0.55)`;
      ctx.lineWidth = 1;
      if (ctx.roundRect) ctx.roundRect(lx, ly, lw, lh, 4);
      else ctx.strokeRect(lx, ly, lw, lh);
      ctx.stroke();

      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 3;
      ctx.fillStyle = info.color;
      ctx.fillText(info.label, lx + lw / 2, ly + lh - Math.round(3 * UI_SCALE));
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }
}

function drawEntities() {
  if (!entities.length) return;
  for (const e of entities) {
    if (e.kind === 'npc') drawNpcEntity(e);
  }
}

  function drawClickMarker() {
    // Draw planned A* path
    if (clickMove.active && clickMove.path.length > 0) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(251,191,36,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(player.x - camera.x, player.y - camera.y);
      for (let i = clickMove.pathIdx; i < clickMove.path.length; i++) {
        ctx.lineTo(clickMove.path[i].x - camera.x, clickMove.path[i].y - camera.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Destination dot
      const last = clickMove.path[clickMove.path.length - 1];
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.beginPath();
      ctx.arc(last.x - camera.x, last.y - camera.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Ripple marker at tap location
    const age = stateTime - clickMove.markerT;
    if (age > 600) return;
    const alpha = Math.max(0, 1 - age / 600);
    const r = Math.max(0, 6 + age * 0.03);
    const sx = clickMove.markerX;
    const sy = clickMove.markerY;
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Returns true when the player is outside any city (show carriage)
  function playerOnRoad() {
    return !currentCity();
  }

  // Draw a medieval carriage with horse for player on the road.
  // Visual appearance scales with gear tier.
  function drawPlayerCarriage(x, y) {
    const facing = player.facing || { x: 0, y: 1 };
    const vx = facing.x || 0;
    const vy = facing.y || 0;
    // Classify into 4 cardinal directions
    let dir;
    if (Math.abs(vy) >= Math.abs(vx)) {
      dir = vy >= 0 ? 'DOWN' : 'UP';
    } else {
      dir = vx >= 0 ? 'RIGHT' : 'LEFT';
    }
    const moving = autoNav.active || clickMove.active ||
      Math.hypot(player.vx || 0, player.vy || 0) > 0.01;

    // Gear tiers (0–4)
    const packTier  = player.gear?.pack  ?? 0;
    const bootsTier = player.gear?.boots ?? 0;
    const toolTier  = player.gear?.tool  ?? 0;

    ctx.save();
    ctx.translate(x, y);

    // Shadow
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 4, 12 + packTier * 2, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // NO ctx.rotate — draw explicitly for each direction

    // Gear color palettes
    const HORSE_PAL = [
      { body:'#a08860', dark:'#7a5a30', mane:'#5a3a18', glow:false  }, // T0 pale donkey
      { body:'#6b4c2a', dark:'#4a3018', mane:'#2a1808', glow:false  }, // T1 dark bay
      { body:'#b05010', dark:'#803010', mane:'#200800', glow:false  }, // T2 bright chestnut
      { body:'#111122', dark:'#080812', mane:'#e8c820', glow:false  }, // T3 jet black warhorse
      { body:'#c8e8ff', dark:'#80b8e8', mane:'#ffffff', glow:true   }, // T4 phantom (glowing white-blue)
    ];
    const WAGON_PAL = [
      { body:'#5a3c18', trim:'#8a6040' }, // T0 rough planks
      { body:'#6a4828', trim:'#c09050' }, // T1 reinforced cart
      { body:'#7a3010', trim:'#e07820' }, // T2 painted orange
      { body:'#4a3010', trim:'#d4af37' }, // T3 dark noble (gold trim)
      { body:'#3a2408', trim:'#ffd700' }, // T4 royal black-gold
    ];
    const hc = HORSE_PAL[Math.min(bootsTier, 4)];
    const bc = WAGON_PAL[Math.min(packTier, 4)];

    // Leg animation
    const legSwing = moving ? Math.sin(stateTime * 0.012) * 2 : 0;

    // Phantom glow
    if (hc.glow) { ctx.shadowColor = '#80c8ff'; ctx.shadowBlur = 6; }

    // Wagon size: T0 small, grows with tier
    const wW = 10 + packTier * 3;   // wagon width  10→22px
    const wH = 8  + packTier * 2;   // wagon height 8→16px
    // Horse body size grows with boots tier
    const hW = 6 + Math.floor(bootsTier * 0.5);
    const hH = 9 + bootsTier;

    // Helper: draw horse body at (hx,hy) top-left, legs direction = legDir ('v'=vertical,'h'=horizontal)
    // frontLegs offset: +legSwing, backLegs: -legSwing
    // headDir: 'up','down','left','right' — where the head sticks out
    const drawHorse = (hx, hy, headDir) => {
      // Body
      ctx.fillStyle = hc.body;
      ctx.fillRect(hx, hy, hW, hH);
      // Head
      ctx.fillStyle = hc.dark;
      let hcx, hcy;
      if (headDir === 'up')    { hcx = hx + hW/2; hcy = hy - 3; }
      else if (headDir === 'down') { hcx = hx + hW/2; hcy = hy + hH + 3; }
      else if (headDir === 'left') { hcx = hx - 3;    hcy = hy + hH/2; }
      else                         { hcx = hx + hW + 3; hcy = hy + hH/2; }
      ctx.beginPath(); ctx.arc(hcx, hcy, 3, 0, Math.PI * 2); ctx.fill();
      // Legs (4 legs)
      ctx.fillStyle = hc.dark;
      if (headDir === 'up' || headDir === 'down') {
        // Vertical travel — legs hang left/right
        const ly = hy + hH - 2;
        ctx.fillRect(hx,        ly + legSwing,  2, 4);
        ctx.fillRect(hx + 2,    ly - legSwing,  2, 4);
        ctx.fillRect(hx + hW-4, ly - legSwing,  2, 4);
        ctx.fillRect(hx + hW-2, ly + legSwing,  2, 4);
      } else {
        // Horizontal travel — legs dangle above/below
        const lx = hx + 1;
        ctx.fillRect(lx,        hy + hH,  2, 4 + legSwing);
        ctx.fillRect(lx + 2,    hy + hH,  2, 4 - legSwing);
        ctx.fillRect(lx + hW-4, hy + hH,  2, 4 + legSwing);
        ctx.fillRect(lx + hW-2, hy + hH,  2, 4 - legSwing);
      }
      // Mane strip
      ctx.fillStyle = hc.mane;
      if (headDir === 'up' || headDir === 'down') {
        ctx.fillRect(hx + 1, hy, 2, hH);
      } else {
        ctx.fillRect(hx, hy + 1, hW, 2);
      }
    };

    const drawWagon = (wx, wy) => {
      if (packTier === 4) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 5; }
      // Body
      ctx.fillStyle = bc.body;
      ctx.fillRect(wx, wy, wW, wH);
      // T1+: canvas cover strip across top of wagon
      if (packTier >= 1) {
        // T1=cream, T2=orange, T3=gold, T4=bright gold
        const roofColors = ['', '#d4c08a', '#e07820', '#d4af37', '#ffd700'];
        ctx.fillStyle = roofColors[Math.min(packTier, 4)];
        ctx.fillRect(wx, wy, wW, Math.max(3, Math.round(wH * 0.3)));
      }
      // T2+: window dot each side
      if (packTier >= 2) {
        ctx.fillStyle = 'rgba(20,10,5,0.7)';
        ctx.fillRect(wx + 2, wy + 3, 3, 3);
        ctx.fillRect(wx + wW - 5, wy + 3, 3, 3);
      }
      // T4: gilded side panels
      if (packTier === 4) {
        ctx.fillStyle = 'rgba(255,215,0,0.35)';
        ctx.fillRect(wx, wy + 3, 2, wH - 3);
        ctx.fillRect(wx + wW - 2, wy + 3, 2, wH - 3);
      }
      // Trim outline
      ctx.shadowBlur = 0;
      ctx.strokeStyle = bc.trim;
      ctx.lineWidth = packTier >= 3 ? 1.5 : 1;
      ctx.strokeRect(wx, wy, wW, wH);
      // Player identity stripe (purple)
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(wx + wW/2 - 2, wy + wH - 3, 4, 3);
    };

    // Harness line from wagon to horse
    const drawHarness = (x1, y1, x2, y2) => {
      ctx.strokeStyle = bootsTier >= 3 ? '#d4af37' : '#5a3010';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };

    // Layout depends on direction
    // CENTER of sprite at (0,0); horse in travel direction, wagon behind
    const gap = 2; // gap between horse and wagon
    if (dir === 'DOWN') {
      // Horse above (y negative), wagon below
      const hx = -hW/2;
      const hy = -hH - gap - wH/2;
      const wx = -wW/2;
      const wy = -wH/2;
      drawWagon(wx, wy);
      drawHarness(0, wy, 0, hy + hH);
      drawHorse(hx, hy, 'down');
    } else if (dir === 'UP') {
      // Wagon above, horse below (facing up)
      const wx = -wW/2;
      const wy = -wH/2;
      const hx = -hW/2;
      const hy = wH/2 + gap;
      drawWagon(wx, wy);
      drawHarness(0, wy + wH, 0, hy);
      drawHorse(hx, hy, 'up');
    } else if (dir === 'RIGHT') {
      // Horse to the right, wagon to the left
      const wy = -wH/2;
      const wx = -wW/2 - gap/2 - hW/2;
      const hx = wW/2 + gap/2;
      const hy = -hH/2;
      drawWagon(wx - wW/2, wy);
      drawHarness(wx, 0, hx, hy + hH/2);
      drawHorse(hx, hy, 'right');
    } else { // LEFT
      // Horse to the left, wagon to the right
      const wy = -wH/2;
      const wx = hW/2 + gap/2;
      const hx = -hW/2 - gap/2 - wW/2;
      const hy = -hH/2;
      drawWagon(wx, wy);
      drawHarness(wx, 0, hx + hW, hy + hH/2);
      drawHorse(hx, hy, 'left');
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawPlayer() {
    const x = player.x - camera.x;
    const y = player.y - camera.y;

    // Draw carriage when on the road (outside city)
    if (playerOnRoad()) {
      drawPlayerCarriage(x, y);
      return;
    }

    // shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y + 8, 10, 5, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Sprite draw (disabled — sprite sheet is a palette catalog, not animation sheet)
    if (false && playerSprite && playerSprite.ready) {
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

    // Player character: top-down merchant figure
    const facing = player.facing || { x: 0, y: 1 };
    const moving = Math.hypot(player.vx, player.vy) > 0.01;
    const legSwing = moving ? Math.sin(stateTime * 0.015) * 2 : 0;

    // Dominant direction for facing
    const facingDown  = Math.abs(facing.y) >= Math.abs(facing.x) && facing.y >= 0;
    const facingUp    = Math.abs(facing.y) >= Math.abs(facing.x) && facing.y < 0;
    const facingRight = !facingDown && !facingUp && facing.x > 0;
    // (facingLeft is default)

    ctx.save();
    ctx.translate(x, y);

    // Shadow
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 6, 8, 3, 0, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;

    if (facingDown) {
      // Legs
      ctx.fillStyle = '#3b2a1a';
      ctx.fillRect(-4, 2 + legSwing, 3, 6);
      ctx.fillRect(1,  2 - legSwing, 3, 6);
      // Cloak body
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(-5, -4, 10, 9);
      // Belt
      ctx.fillStyle = '#92400e';
      ctx.fillRect(-5, 1, 10, 2);
      // Head
      ctx.fillStyle = '#c8a87a';
      ctx.beginPath(); ctx.arc(0, -8, 5, 0, Math.PI*2); ctx.fill();
      // Hat brim
      ctx.fillStyle = '#4a2c0a';
      ctx.fillRect(-6, -11, 12, 2);
      ctx.fillRect(-4, -15, 8, 5);
      // Eyes
      ctx.fillStyle = '#1a0a00';
      ctx.fillRect(-2, -9, 2, 2);
      ctx.fillRect(1,  -9, 2, 2);
    } else if (facingUp) {
      // Legs
      ctx.fillStyle = '#3b2a1a';
      ctx.fillRect(-4, 2 + legSwing, 3, 6);
      ctx.fillRect(1,  2 - legSwing, 3, 6);
      // Cloak body (back view)
      ctx.fillStyle = '#5b26c9';
      ctx.fillRect(-5, -4, 10, 9);
      // Hood/back of hat
      ctx.fillStyle = '#4a2c0a';
      ctx.fillRect(-6, -11, 12, 2);
      ctx.fillRect(-4, -15, 8, 5);
      ctx.fillStyle = '#c8a87a';
      ctx.beginPath(); ctx.arc(0, -8, 5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#4a2c0a';
      ctx.fillRect(-4, -15, 8, 5);
    } else if (facingRight) {
      // Side profile right
      ctx.fillStyle = '#3b2a1a';
      ctx.fillRect(2, 2 + legSwing, 3, 6);
      ctx.fillRect(2, 2 - legSwing, 3, 6);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(-3, -4, 8, 9);
      ctx.fillStyle = '#92400e';
      ctx.fillRect(-3, 1, 8, 2);
      ctx.fillStyle = '#c8a87a';
      ctx.beginPath(); ctx.arc(4, -8, 5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#4a2c0a';
      ctx.fillRect(-2, -11, 12, 2);
      ctx.fillRect(1, -15, 8, 5);
    } else {
      // Side profile left
      ctx.fillStyle = '#3b2a1a';
      ctx.fillRect(-5, 2 + legSwing, 3, 6);
      ctx.fillRect(-5, 2 - legSwing, 3, 6);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(-5, -4, 8, 9);
      ctx.fillStyle = '#92400e';
      ctx.fillRect(-5, 1, 8, 2);
      ctx.fillStyle = '#c8a87a';
      ctx.beginPath(); ctx.arc(-4, -8, 5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#4a2c0a';
      ctx.fillRect(-10, -11, 12, 2);
      ctx.fillRect(-9, -15, 8, 5);
    }

    ctx.restore();
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
    // Mobile minimap is now a DOM overlay (tap 🗺️ toggle).
    // Nothing to draw on canvas here — keeps the gameplay viewport fully clear.
  }

  // ── Mobile minimap DOM overlay ────────────────────────────────────────────
  // Separate canvas rendered each frame when open; tapping navigates to nearest city.
  // ── Mobile minimap corner widget — always rendered each frame ───────────
  const _mmCanvas   = document.getElementById('minimap-canvas');
  const _mmCtx      = _mmCanvas ? _mmCanvas.getContext('2d') : null;

  function _mmRender() {
    if (!_mmCtx || !IS_MOBILE) return;
    const S = _mmCanvas.width; // 100px
    _mmCtx.clearRect(0, 0, S, S);
    _mmCtx.imageSmoothingEnabled = false;
    // World map
    _mmCtx.drawImage(mini.canvas, 0, 0, mini.w, mini.h, 0, 0, S, S);
    // City dots + short name labels
    for (const c2 of world.cities) {
      const cx2 = ((c2.x + c2.w/2) / MAP_W) * S;
      const cy2 = ((c2.y + c2.h/2) / MAP_H) * S;
      _mmCtx.fillStyle = '#fbbf24';
      _mmCtx.beginPath(); _mmCtx.arc(cx2, cy2, 3, 0, Math.PI*2); _mmCtx.fill();
      _mmCtx.fillStyle = 'rgba(255,255,255,0.8)';
      _mmCtx.font = 'bold 7px system-ui,sans-serif';
      _mmCtx.textAlign = 'left';
      _mmCtx.fillText(c2.name.slice(0,4), cx2 + 4, cy2 + 3);
    }
    // Active contract destination ring
    if (contracts.active) {
      const dest = getCityById(contracts.active.toId);
      if (dest) {
        const dx = ((dest.x + dest.w/2) / MAP_W) * S;
        const dy = ((dest.y + dest.h/2) / MAP_H) * S;
        _mmCtx.strokeStyle = '#60a5fa'; _mmCtx.lineWidth = 1.5;
        _mmCtx.beginPath(); _mmCtx.arc(dx, dy, 6, 0, Math.PI*2); _mmCtx.stroke();
      }
    }
    // Auto-nav route line
    if (autoNav.active && autoNav.path.length > 0) {
      _mmCtx.strokeStyle = 'rgba(251,191,36,0.6)';
      _mmCtx.lineWidth = 1;
      _mmCtx.setLineDash([2,3]);
      _mmCtx.beginPath();
      const startPx = (player.x / (MAP_W * TILE)) * S;
      const startPy = (player.y / (MAP_H * TILE)) * S;
      _mmCtx.moveTo(startPx, startPy);
      // Sample every few waypoints to keep it readable
      for (let i = autoNav.pathIdx; i < autoNav.path.length; i += 4) {
        _mmCtx.lineTo((autoNav.path[i].x / (MAP_W * TILE)) * S, (autoNav.path[i].y / (MAP_H * TILE)) * S);
      }
      const last = autoNav.path[autoNav.path.length - 1];
      _mmCtx.lineTo((last.x / (MAP_W * TILE)) * S, (last.y / (MAP_H * TILE)) * S);
      _mmCtx.stroke();
      _mmCtx.setLineDash([]);
    }
    // Player dot (on top of everything)
    const px = (player.x / (MAP_W * TILE)) * S;
    const py = (player.y / (MAP_H * TILE)) * S;
    _mmCtx.fillStyle = '#f43f5e';
    _mmCtx.beginPath(); _mmCtx.arc(px, py, 3.5, 0, Math.PI*2); _mmCtx.fill();
    _mmCtx.strokeStyle = 'rgba(255,255,255,0.9)'; _mmCtx.lineWidth = 1;
    _mmCtx.stroke();
  }

  // Tap minimap widget to navigate to nearest city
  if (_mmCanvas) {
    _mmCanvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = _mmCanvas.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      const mapTX = fx * MAP_W;
      const mapTY = fy * MAP_H;
      let best = null, bestD = 14;
      for (const c2 of world.cities) {
        const d = Math.hypot((c2.x + c2.w/2) - mapTX, (c2.y + c2.h/2) - mapTY);
        if (d < bestD) { bestD = d; best = c2; }
      }
      if (best) startNavTo(best.id);
    });
  }

  // No-op: was used by toggle, kept so call sites don't crash
  function _mmClose() {}
  // ── FAB / ACTION BAR — context-sensitive action buttons ──────────────
  // Desktop: stacked round FABs (bottom-right of canvas).
  // Mobile: slim horizontal pill bar at bottom of screen — max 3 actions, always labelled.
  //         Hidden when no contextual actions available; slides in when relevant.
  let _fabLastKey = '';
  function updateFabBar() {
    const fabBar = document.getElementById('fab-bar');
    if (!fabBar) return;

    // Close minimap overlay when any modal opens
    const anyModal = ui.marketOpen || ui.contractsOpen || ui.eventOpen ||
      ui.bankOpen || ui.innOpen || ui.guildOpen || ui.warehouseOpen ||
      document.getElementById('cr-intel-modal') ||
      document.getElementById('cr-trader-modal');

    if (anyModal) {
      if (IS_MOBILE) { fabBar.classList.remove('fab-bar-visible'); _mmClose(); }
      if (fabBar.children.length) fabBar.innerHTML = '';
      _fabLastKey = 'modal';
      return;
    }

    const c = currentCity();
    const atMarket = nearMarketTile();
    const atContracts = nearContractsTile();
    const nearNpc = findNearestNpc(player.x, player.y, NPC_INTERACT_RADIUS + 6);
    const nearTrader = findNearestTrader(player.x, player.y);

    // Build key to avoid unnecessary DOM thrashing
    const key = [
      c?.id || 'road',
      atMarket ? 'm' : '',
      atContracts ? 'c' : '',
      nearNpc?.id || '',
      nearTrader?.id || '',
      autoNav.active ? 'nav' : '',
    ].join('|');

    if (key === _fabLastKey) return;
    _fabLastKey = key;

    fabBar.innerHTML = '';

    const addFab = (icon, label, onClick) => {
      const btn = document.createElement('button');
      btn.className = 'fab';
      btn.setAttribute('aria-label', label);
      btn.title = label;

      if (IS_MOBILE) {
        // Pill with icon + short label side by side
        const iconSpan = document.createElement('span');
        iconSpan.textContent = icon;
        iconSpan.style.cssText = 'font-size:16px;line-height:1;flex-shrink:0';
        const lbl = document.createElement('span');
        lbl.className = 'fab-label';
        // Truncate label to keep pills compact
        lbl.textContent = label.length > 14 ? label.slice(0, 13) + '…' : label;
        btn.appendChild(iconSpan);
        btn.appendChild(lbl);
      } else {
        // Desktop: round icon only, label as tooltip
        btn.innerHTML = icon;
        btn.style.position = 'relative';
        const lbl = document.createElement('span');
        lbl.className = 'fab-label';
        lbl.textContent = label;
        btn.appendChild(lbl);
      }

      btn.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); onClick(); });
      fabBar.appendChild(btn);
    };

    // ── Priority order: most important first (mobile shows max 3) ────────
    const actions = [];

    if (nearTrader) {
      actions.push(['🛒', `Trade`, () => openTraderUI(nearTrader)]);
    }
    if (nearNpc) {
      actions.push(['💬', `Talk`, () => triggerNpcTalk(nearNpc)]);
    }
    if (atMarket && c) {
      actions.push(['🏪', 'Market', () => {
        ui.contractsOpen = false; ui.marketOpen = true; ui.selection = 0; ui.mode = 'buy';
        toast(`Market opened in ${c.name}`, 1.8); _fabLastKey = '';
      }]);
    }
    if (atContracts && c) {
      actions.push(['📋', 'Contracts', () => {
        ui.marketOpen = false; ui.contractsOpen = true; ui.contractsSel = 0; ui.contractsCityId = c.id;
        toast('Contracts board opened', 1.8); _fabLastKey = '';
      }]);
    }
    if (autoNav.active) {
      const destName = getCityById(autoNav.destCityId)?.name || '';
      actions.push(['✕', `Cancel: ${destName}`, () => {
        autoNav.active = false; toast('Navigation cancelled.', 1.5); _fabLastKey = '';
      }]);
    } else if (!atMarket && !atContracts && !nearNpc && !nearTrader) {
      // Only show Navigate when there's nothing else to do (avoids crowding)
      actions.push(['🗺️', 'Navigate', () => showNavPicker()]);
    }
    if (!c && !IS_MOBILE) {
      // Desktop save button; mobile uses autosave so no need to show
      actions.push(['💾', 'Save', () => { saveGame(); ui._lastSavedDay = time.day; toast('Game saved.', 1.5); }]);
    }

    // Mobile: limit to 3 most relevant; desktop: show all
    const shown = IS_MOBILE ? actions.slice(0, 3) : actions;
    for (const [icon, label, onClick] of shown) addFab(icon, label, onClick);

    // Mobile: show/hide the bar with animation
    if (IS_MOBILE) {
      fabBar.classList.toggle('fab-bar-visible', shown.length > 0);
    }
  }

  function drawHUD() {
    const c = currentCity();
    const rules = c ? CITY_RULES[c.id] : null;
    const w = invWeight();

    const pad = Math.round(14 * UI_SCALE);


// MOBILE HUD — single slim bar, no expand needed (map is in separate toggle)
if (IS_MOBILE) {
  const topH = Math.round(36 * UI_SCALE);
  ui._hudTopH = topH;
  const padX = Math.round(10 * UI_SCALE);
  const midY = Math.round(22 * UI_SCALE);

  // Background strip
  ctx.fillStyle = 'rgba(10, 14, 20, 0.82)';
  ctx.fillRect(0, 0, VIEW_W, topH);
  ctx.strokeStyle = 'rgba(30, 42, 54, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, topH + 0.5);
  ctx.lineTo(VIEW_W, topH + 0.5);
  ctx.stroke();

  // Left: location name
  const title = c ? c.name : (autoNav.active ? `→ ${getCityById(autoNav.destCityId)?.name || '…'}` : 'Road');
  ctx.fillStyle = c ? '#e8edf2' : '#94a3b8';
  ctx.font = `700 ${Math.round(13 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const maxTitleW = Math.round(VIEW_W * 0.45);
  ctx.fillText(ellipsizeText(title, maxTitleW), padX, midY);
  // Keep tap zone for expand (legacy, still wired in handleMobileHudTap)
  ui._hudCityTap = { x: 0, y: 0, w: Math.round(VIEW_W * 0.5), h: topH };

  // Center: day counter
  const day = Math.floor(time.day || 1);
  ctx.fillStyle = 'rgba(160,184,203,0.75)';
  ctx.font = `600 ${Math.round(11 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`Day ${day}`, VIEW_W / 2, midY);
  ctx.textAlign = 'left';

  // Right: gold + pack
  ctx.textAlign = 'right';
  ctx.fillStyle = '#cfe6ff';
  ctx.font = `700 ${Math.round(13 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillText(`${player.gold}g  ${w}/${player.capacity}`, VIEW_W - padX, midY);
  ctx.textAlign = 'left';

  // Active contract mini-indicator (small dot + destination)
  if (contracts.active) {
    const dest = getCityById(contracts.active.toId);
    if (dest) {
      const prog = activeContractProgressLabel();
      ctx.fillStyle = 'rgba(96,165,250,0.80)';
      ctx.font = `600 ${Math.round(10 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`📦 → ${dest.name} (${prog})`, VIEW_W / 2, topH - Math.round(4 * UI_SCALE));
      ctx.textAlign = 'left';
    }
  }

  ui._hudExpandedVisible = false;
  ui._hudExpandedText = '';

  if (ui._hudTapDebug) {
    ctx.fillStyle = 'rgba(239,68,68,0.9)';
    ctx.font = `${Math.round(10 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(ellipsizeText(ui._hudTapDebug, VIEW_W - padX * 2), padX, Math.round(topH - 4 * UI_SCALE));
  }

  // Render the DOM minimap widget each frame (keeps it live as player moves)
  _mmRender();

  return;
}

    ctx.fillStyle = 'rgba(10, 14, 20, 0.82)';
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    ctx.strokeStyle = 'rgba(30, 42, 54, 1)';
    ctx.beginPath();
    ctx.moveTo(0, HUD_H + 0.5);
    ctx.lineTo(VIEW_W, HUD_H + 0.5);
    ctx.stroke();

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
    // store minimap rect for tap detection
    ui._minimapRect = { x: mmX, y: mmY, w: mmSize, h: mmSize };
    // player marker
    const px = (player.x / (MAP_W * TILE)) * mmSize;
    const py = (player.y / (MAP_H * TILE)) * mmSize;
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(mmX + Math.floor(px) - 1, mmY + Math.floor(py) - 1, 3, 3);
    // city dots on minimap
    for (const c2 of world.cities) {
      const cx2 = mmX + ((c2.x + c2.w/2) / MAP_W) * mmSize;
      const cy2 = mmY + ((c2.y + c2.h/2) / MAP_H) * mmSize;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(cx2, cy2, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = `bold ${Math.round(7*UI_SCALE)}px system-ui,sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(c2.name.slice(0,3), cx2 + 4, cy2 + 3);
      ctx.textAlign = 'left';
    }
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
    
    // Save/Load buttons (desktop only, small icons in HUD)
    if (!IS_MOBILE) {
      const btnSaveX = rightX - Math.round(260 * UI_SCALE);
      const btnSaveY = Math.round(14 * UI_SCALE);
      const btnW = Math.round(48 * UI_SCALE);
      const btnH = Math.round(20 * UI_SCALE);
      
      // Save button
      ctx.fillStyle = 'rgba(34,197,94,0.85)';
      if (ctx.roundRect) ctx.roundRect(btnSaveX, btnSaveY - btnH, btnW, btnH, 4);
      else ctx.fillRect(btnSaveX, btnSaveY - btnH, btnW, btnH);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(10 * UI_SCALE)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('💾', btnSaveX + btnW/2, btnSaveY - Math.round(6 * UI_SCALE));
      ui._btnSave = { x: btnSaveX, y: btnSaveY - btnH, w: btnW, h: btnH };
      
      // Load button
      const btnLoadX = btnSaveX + btnW + Math.round(8 * UI_SCALE);
      ctx.fillStyle = 'rgba(59,130,246,0.85)';
      if (ctx.roundRect) ctx.roundRect(btnLoadX, btnSaveY - btnH, btnW, btnH, 4);
      else ctx.fillRect(btnLoadX, btnSaveY - btnH, btnW, btnH);
      ctx.fillStyle = '#fff';
      ctx.fillText('📂', btnLoadX + btnW/2, btnSaveY - Math.round(6 * UI_SCALE));
      ui._btnLoad = { x: btnLoadX, y: btnSaveY - btnH, w: btnW, h: btnH };
      
      // Player ID badge (desktop HUD, top-right corner)
      if (_playerId) {
        ctx.fillStyle = 'rgba(251,191,36,0.50)';
        ctx.font = `700 ${Math.round(9 * UI_SCALE)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textAlign = 'right';
        ctx.fillText(`ID: ${_playerId}`, rightX, Math.round(10 * UI_SCALE));
      }

      // Save toast + last-saved indicator
      const nowMs = performance.now();
      if (ui._saveToastUntilMs && nowMs < ui._saveToastUntilMs && ui._saveToastText) {
        const tLeft = Math.max(0, ui._saveToastUntilMs - nowMs);
        const a = Math.min(1, tLeft / 220);
        ctx.fillStyle = `rgba(160,184,203,${(0.92 * a).toFixed(3)})`;
        ctx.font = `700 ${Math.round(9 * UI_SCALE)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(ui._saveToastText, btnLoadX + btnW + Math.round(10 * UI_SCALE), btnSaveY - Math.round(6 * UI_SCALE));
      } else if (ui._lastSavedDay) {
        ctx.fillStyle = 'rgba(160,184,203,0.85)';
        ctx.font = `${Math.round(9 * UI_SCALE)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(`Day ${ui._lastSavedDay}`, btnLoadX + btnW + Math.round(10 * UI_SCALE), btnSaveY - Math.round(6 * UI_SCALE));
      }
    }
    
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

      // Intel badge (desktop only)
      const activeIntel = (player.intelLedger || []).filter(card => !card.sold && card.expiryDay >= Math.floor(time.day));
      if (activeIntel.length > 0) {
        const ibX = bagX + Math.round(50 * UI_SCALE);
        const ibY = line1 - Math.round(8 * UI_SCALE);
        ctx.fillStyle = '#f0d060';
        ctx.font = `700 ${Math.round(12 * UI_SCALE)}px system-ui, sans-serif`;
        ctx.fillText(`🕵️ ${activeIntel.length}`, ibX, line1);
      }
      // Guild tier badge (desktop only)
      if (playerGuild.joined && playerGuild.tier > 0) {
        const tierBadge = ['','⚒','⚔','★'][playerGuild.tier] || '';
        const guildBadgeX = bagX + Math.round(100 * UI_SCALE);
        ctx.fillStyle = '#a78bfa';
        ctx.font = `700 ${Math.round(11 * UI_SCALE)}px system-ui, sans-serif`;
        ctx.fillText(`Guild:${tierBadge}`, guildBadgeX, line1);
      }
    }

    // ── line2: compact single-line status (city vibe or road hint) ──────────
    if (!IS_MOBILE) {
      ctx.fillStyle = 'rgba(138,160,179,0.80)';
      ctx.font = `${Math.round(12 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = 'left';
      if (rules) {
        ctx.fillText(ellipsizeText(rules.vibe || c.name, maxTextW), titleX, line2);
      } else {
        ctx.fillText('Follow the road between cities.', titleX, line2);
      }
    }



// ── Combined City State + People panel (desktop, below HUD, hidden during modals) ──
if (!IS_MOBILE && c && rules && !ui.marketOpen && !ui.contractsOpen && !ui.eventOpen && !(document.body && document.body.classList.contains('ui-open'))) {
  const npcRows  = getNpcPanelState(c.id) || [];
  const _cpop     = cityPop[c.id];
  const _treasury = cityTreasury[c.id];
  const _rep      = player.rep?.[c.id] || 0;
  const popVal    = _cpop ? (_cpop.pop >= 1000 ? (_cpop.pop / 1000).toFixed(1) + 'k' : Math.round(_cpop.pop).toString()) : '–';
  const hungerPct = _cpop ? Math.round(_cpop.hunger * 100) : 0;
  const hungerCol = hungerPct >= 60 ? '#f87171' : hungerPct >= 30 ? '#fbbf24' : '#86efac';
  const treVal    = (_treasury && _treasury.gold > 0) ? `${_treasury.gold}g` : '–';
  const taxVal    = `${Math.round(rules.taxRate * 100)}%`;
  const inspVal   = `${Math.round(rules.inspectionChance * 100)}%`;
  const repStr    = _rep >= 10 ? 'Trusted' : _rep >= 5 ? 'Known' : _rep >= 0 ? 'Neutral' : 'Suspect';
  const repCol    = _rep >= 10 ? '#86efac' : _rep >= 5 ? '#fbbf24' : _rep >= 0 ? '#94a3b8' : '#f87171';
  const contraTxt = rules.contraband.join(', ') || 'none';
  const hint      = nearMarketTile() ? '⚡ Market nearby — tap to trade' : '★ Find market (gold tile)';

  const x        = titleX;
  const padX     = Math.round(10 * UI_SCALE);
  const padY     = Math.round(8 * UI_SCALE);
  const colW     = Math.round(130 * UI_SCALE);
  const rowH     = Math.round(15 * UI_SCALE);
  const fSz      = Math.round(11 * UI_SCALE);
  const fSzSm    = Math.round(10 * UI_SCALE);
  const boxW     = Math.min(maxTextW, VIEW_W - x - Math.round(12 * UI_SCALE));

  // Stat rows: [labelA, valueA, colorA, labelB, valueB, colorB]
  const LABEL    = 'rgba(138,160,179,0.75)';
  const VAL      = '#cfe6ff';
  // Population + Treasury share one combined row; remaining stats in 2 columns
  const statRows = [
    ['Hunger',  `${hungerPct}%`, hungerCol, 'Tax',     taxVal,  VAL    ],
    ['Inspect', inspVal,         VAL,       'Rep',     repStr,  repCol ],
  ];

  // Height: section header + stat rows + contraband + hint + npc header + npc rows
  const npcSection = npcRows.length > 0 ? (Math.round(18 * UI_SCALE) + npcRows.length * rowH) : 0;
  const boxH = padY
    + Math.round(14 * UI_SCALE)          // "CITY STATE" header
    + rowH                                // combined Pop · Treasury row
    + statRows.length * rowH             // Hunger/Tax, Inspect/Rep
    + rowH                                // contraband
    + rowH                                // hint
    + npcSection
    + padY;

  const boxX = x;
  const boxY = HUD_H + Math.round(4 * UI_SCALE);

  ctx.save();

  // Card background + border
  ctx.fillStyle = 'rgba(8, 12, 18, 0.78)';
  ctx.strokeStyle = 'rgba(30, 42, 54, 0.90)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 10);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();
  ctx.stroke();

  let cy = boxY + padY;

  // ── Section: CITY STATE ─────────────────────────────────────────────
  ctx.fillStyle = 'rgba(160,184,203,0.60)';
  ctx.font = `900 ${Math.round(9 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('CITY STATE', boxX + padX, cy);
  cy += Math.round(14 * UI_SCALE);

  ctx.font = `${fSz}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  // ── Combined Population · Treasury row (full width) ─────────────────
  {
    ctx.fillStyle = LABEL;
    ctx.fillText('Pop:', boxX + padX, cy);
    const popLW = ctx.measureText('Pop:  ').width;
    ctx.fillStyle = VAL;
    ctx.fillText(popVal, boxX + padX + popLW, cy);
    const popValW = ctx.measureText(popVal + '  ').width;

    // separator dot
    ctx.fillStyle = 'rgba(138,160,179,0.40)';
    ctx.fillText('·', boxX + padX + popLW + popValW, cy);
    const dotW = ctx.measureText('·  ').width;

    ctx.fillStyle = LABEL;
    ctx.fillText('Treasury:', boxX + padX + popLW + popValW + dotW, cy);
    const treLW = ctx.measureText('Treasury:  ').width;
    ctx.fillStyle = VAL;
    ctx.fillText(treVal, boxX + padX + popLW + popValW + dotW + treLW, cy);
    cy += rowH;
  }

  // ── Remaining stat rows (2 columns each) ───────────────────────────
  for (const [lA, vA, cA, lB, vB, cB] of statRows) {
    // Column A
    ctx.fillStyle = LABEL;
    ctx.fillText(lA + ':', boxX + padX, cy);
    const lAW = ctx.measureText(lA + ':  ').width;
    ctx.fillStyle = cA;
    ctx.fillText(vA, boxX + padX + lAW, cy);
    // Column B
    ctx.fillStyle = LABEL;
    ctx.fillText(lB + ':', boxX + padX + colW, cy);
    const lBW = ctx.measureText(lB + ':  ').width;
    ctx.fillStyle = cB;
    ctx.fillText(vB, boxX + padX + colW + lBW, cy);
    cy += rowH;
  }

  // Contraband row
  ctx.font = `${fSzSm}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillStyle = LABEL;
  ctx.fillText('Contraband:', boxX + padX, cy);
  const cbLW = ctx.measureText('Contraband:  ').width;
  ctx.fillStyle = '#fca5a5';
  ctx.fillText(ellipsizeText(contraTxt, boxW - padX * 2 - cbLW), boxX + padX + cbLW, cy);
  cy += rowH;

  // Hint row
  ctx.fillStyle = 'rgba(251,191,36,0.75)';
  ctx.fillText(hint, boxX + padX, cy);
  cy += rowH;

  // ── Section: PEOPLE (NPC chatter) ──────────────────────────────────
  if (npcRows.length > 0) {
    // Thin divider
    ctx.strokeStyle = 'rgba(30, 42, 54, 0.70)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boxX + padX, cy - Math.round(4 * UI_SCALE));
    ctx.lineTo(boxX + boxW - padX, cy - Math.round(4 * UI_SCALE));
    ctx.stroke();

    ctx.fillStyle = 'rgba(160,184,203,0.60)';
    ctx.font = `900 ${Math.round(9 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText('PEOPLE', boxX + padX, cy + Math.round(10 * UI_SCALE));
    cy += Math.round(18 * UI_SCALE);

    ctx.fillStyle = '#cfe6ff';
    ctx.font = `${fSz}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    for (const r of npcRows) {
      ctx.fillText(ellipsizeText(r.line, boxW - padX * 2), boxX + padX, cy);
      cy += rowH;
    }
  }

  ctx.restore();
}

// npc diag overlay
if (ui.npcDiag && ui.npcDiag.enabled) {
  const d = ui.npcDiag;
  const status = d.result === 'pass' ? 'PASS' : (d.result === 'fail' ? 'FAIL' : d.state);
  ctx.save();
  ctx.fillStyle = d.result === 'fail' ? 'rgba(239,68,68,0.9)' : 'rgba(16,185,129,0.9)';
  ctx.font = `800 ${Math.round(12 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillText(`NPC DIAG: ${status}`, Math.round(10 * UI_SCALE), Math.round(18 * UI_SCALE));
  ctx.fillStyle = '#e5e7eb';
  ctx.font = `${Math.round(10 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const lineA = `delta=${d.delta.toFixed(1)} bubble=${d.bubble ? 'yes' : 'no'} tick=${d.tick}`;
  const lineB = d.note ? `note=${d.note}` : '';
  ctx.fillText(lineA, Math.round(10 * UI_SCALE), Math.round(34 * UI_SCALE));
  if (lineB) ctx.fillText(lineB, Math.round(10 * UI_SCALE), Math.round(48 * UI_SCALE));
  ctx.restore();
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
      const showTabs = buyHasItems && sellHasItems;
      if (buyHasItems && !sellHasItems) ui.mode = 'buy';
      if (sellHasItems && !buyHasItems) ui.mode = 'sell';
      const headerH = showTabs ? 94 : 64;
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
// BUY/SELL tabs (auto-switch/hide empty)
if (showTabs) {
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
} else {
  ui._marketTabs = null;
}

// list viewport

      const footerH = 84;
      const listTop = sheetTop + headerH;
      const listBottom = sheetTop + sheetH - 12 - footerH;
      const listH = Math.max(40, listBottom - listTop);
      const rowH = 90; // card height
      const visibleN = Math.max(2, Math.floor(listH / rowH));

      const totalN = ITEMS.length + 1; // +1 permit row
      const scrollMax = Math.max(0, totalN - visibleN);
      ui.marketScroll = clamp(ui.marketScroll, 0, scrollMax);

      // expose list rect for touch scrolling
      const cardPad = 8;
      const cardH = rowH - cardPad * 2;
      const btnH = Math.round(26 * UI_SCALE);
      const btnPad = 6;
      const btnInset = Math.round(24 * UI_SCALE);
      ui._marketList = { x: sheetX, y: listTop, w: sheetW, h: listH, rowH, scrollMax, cols: 1, cardPad, cardH, btnH, btnPad, btnInset };

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

// action button
const btnY = cardY + cardH - btnH - btnPad;
const btnX = sheetX + btnInset;
const btnW = sheetW - btnInset * 2;
ctx.fillStyle = ui.mode === 'buy' ? 'rgba(34,197,94,0.18)' : 'rgba(59,130,246,0.18)';
ctx.strokeStyle = ui.mode === 'buy' ? 'rgba(34,197,94,0.6)' : 'rgba(59,130,246,0.6)';
ctx.beginPath();
if (ctx.roundRect) ctx.roundRect(btnX, btnY, btnW, btnH, 10);
else ctx.rect(btnX, btnY, btnW, btnH);
ctx.fill();
ctx.stroke();
ctx.fillStyle = ui.mode === 'buy' ? '#166534' : '#1d4ed8';
ctx.font = `900 ${Math.round(12*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
const actLabel = ui.mode === 'buy' ? 'BUY' : 'SELL';
const actW = ctx.measureText(actLabel).width;
ctx.fillText(actLabel, btnX + (btnW - actW) / 2, btnY + Math.round(18 * UI_SCALE));

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
    requestAnimationFrame(tick);
    const now = performance.now();
    if (ui.npcDiag && ui.npcDiag.enabled) ui.npcDiag.lastTickAt = now;
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
      if (nowId !== player.lastCityId) {
        spawnCityNPCs(nowId);
      }
      if (nowId && player.lastCityId !== nowId) {
        const rules = CITY_RULES[nowId];
        if (rules) {
          const roll = Math.random();
          const permit = !!player.permits[nowId];
          const _guardDisc = cityBonus[nowId]?.guardDiscount || 0;
              const inspChance = (permit ? Math.max(0.05, rules.inspectionChance * 0.45) : rules.inspectionChance) * (1 - _guardDisc);
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


      // contract delivery on city entry (no toast spam while staying inside city)
      if (nowId && player.lastCityId !== nowId && contracts.active && contracts.active.toId === nowId) {
        const want = contracts.active.want;
        const qty = contracts.active.qty;
        const have = player.inv[want] || 0;
        if (have >= qty) {
          player.inv[want] = have - qty;
          if (player.inv[want] < 0) player.inv[want] = 0;

          player.gold += contracts.active.reward;

          // Rep scheme: +1 per item delivered (min 2, max 4)
          const repGain = clamp(qty, 2, 4);
          player.rep[nowId] = (player.rep[nowId] || 0) + repGain;

          toast(`Contract complete! +${contracts.active.reward}g (Rep +${repGain})`, 3.2);
          contracts.active = null;
          scheduleAutoSave();
        } else {
          toast('You arrived for delivery, but lack the required goods.', 3.0);
        }
      }
      player.lastCityId = nowId;
      // Check overdue loans at any bank city (rep warning only — gold penalty handled at repay time)
      if (nowId) {
        for (const [loanCid, loan] of Object.entries(playerBank.loans)) {
          const overdue = Math.max(0, Math.floor(time.day) - loan.dueDay);
          if (overdue > 0 && !loan._warnedOverdue) {
            loan._warnedOverdue = true;
            const cityObj = getCityById(loanCid);
            toast(`⚠️ Loan overdue in ${cityObj?.name || loanCid}! Visit the bank to repay and avoid growing penalties.`, 4);
          }
        }
      }
      // Sync global economy on city entry
      if (nowId) { ECONOMY.lastSync = 0; economySync(); }
      // Trigger server aggregation (hourly, no-op if too soon)
      maybeAggregateEconomy();
    }

    // Virtual KeyE button removed — interaction is tap-only

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
          for (let i = 0; i < days; i++) {
            if (player.inv['food'] > 0) {
              player.inv['food'] -= 1;
              toast('Consumed 1 rations.', 1.4);
            } else {
              // No food: meaningful penalty — roughly the cost of buying rations + inconvenience
              // Old value was 3g (too cheap to care), now 8g so carrying food actually matters
              const penalty = 8;
              player.gold = Math.max(0, player.gold - penalty);
              toast(`No rations! Paid ${penalty}g for road supplies.`, 1.8);
            }
          }
          scheduleAutoSave();
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
    updateEntities(dt);
    updateAiTraders(dt);
    updateAutoNav(dt);
    npcDiagTick(dt);
    moveWithCollision(dt);
    npcDiagPostMove();

if (IS_MOBILE && (isDown('ArrowLeft') || isDown('ArrowRight') || isDown('ArrowUp') || isDown('ArrowDown'))) {
  if (player.moveStallT <= 0) {
    player.moveStallT = stateTime + 0.6;
    player.moveStallX = player.x;
    player.moveStallY = player.y;
  } else if (stateTime > player.moveStallT) {
    const dx = player.x - player.moveStallX;
    const dy = player.y - player.moveStallY;
    if (Math.hypot(dx, dy) < 2) {
      // watchdog nudge
      resolvePlayerNpcOverlap();
      player.npcGhostUntil = Math.max(player.npcGhostUntil || 0, stateTime + 800);
    }
    player.moveStallT = stateTime + 0.6;
    player.moveStallX = player.x;
    player.moveStallY = player.y;
  }
} else {
  player.moveStallT = 0;
}

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
    drawBuildingLabels();
    drawEntities();
    for (const t of AI_TRADERS) drawAiTrader(t);
    drawTraderBubbles();
    drawNavPath();
    drawClickMarker();
    drawPlayer();
    drawNpcBubble();
    drawMobileOverlay();
    drawHUD();
    updateFabBar();
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

  }

  // If QA enabled, run a deterministic self-test (no input required).
  if (__QA.enabled) {
    try {
      function assert(cond, msg) {
        if (!cond) throw new Error('QA: ' + msg);
      }

      // --- Save/Load robustness
      const snap = {
        x: player.x,
        y: player.y,
        gold: player.gold,
        day: time.day,
      };

      // A) Missing save key
      localStorage.removeItem(SAVE_KEY);
      assert(loadGame() === false, 'loadGame should return false when no save exists');
      assert(player.gold === snap.gold, 'player state should not change on missing save');

      // B) Malformed JSON
      localStorage.setItem(SAVE_KEY, '{not valid json');
      assert(loadGame() === false, 'loadGame should return false on malformed JSON');
      assert(player.gold === snap.gold, 'player state should not change on malformed JSON');

      // C) Partial save (missing time)
      localStorage.setItem(SAVE_KEY, JSON.stringify({ player: { gold: 5 } }));
      assert(loadGame() === false, 'loadGame should return false on partial save');
      assert(player.gold === snap.gold, 'player state should not change on partial save');

      // D) Autosave (deterministic, via __QA.api)
      __QA.api.freezePrices();
      __QA.api.clearSave();

      // Buy should schedule autosave and persist the updated state
      __QA.api.setPlayer({ gold: 120, inv: { food: 0 }, capacity: 999 });
      const beforeBuy = __QA.api.snapshot();
      const buyR = __QA.api.marketBuy('food', 1, 'valdenmere');
      assert(buyR.ok === true, 'marketBuy should succeed');
      assert(__QA.api.flushAutosave() === true, 'autosave should be scheduled after buy');
      const buySave = __QA.api.readSave();
      assert(!!buySave, 'save should exist after buy autosave flush');
      assert(buySave.player.inv.food === (beforeBuy.player.inv.food || 0) + 1, 'save should reflect bought food');

      // Sell should schedule autosave and persist the updated state
      __QA.api.clearSave();
      __QA.api.setPlayer({ gold: 50, inv: { food: 2 }, capacity: 999 });
      const beforeSell = __QA.api.snapshot();
      const sellR = __QA.api.marketSell('food', 1, 'valdenmere');
      assert(sellR.ok === true, 'marketSell should succeed');
      assert(__QA.api.flushAutosave() === true, 'autosave should be scheduled after sell');
      const sellSave = __QA.api.readSave();
      assert(!!sellSave, 'save should exist after sell autosave flush');
      assert(sellSave.player.inv.food === (beforeSell.player.inv.food || 0) - 1, 'save should reflect sold food');

      // Failed buy should not schedule autosave
      __QA.api.clearSave();
      __QA.api.setPlayer({ gold: 0, inv: { food: 0 }, capacity: 999 });
      const badBuy = __QA.api.marketBuy('food', 1, 'valdenmere');
      assert(badBuy.ok === false, 'marketBuy should fail with insufficient gold');
      assert(__QA.api.flushAutosave() === false, 'no autosave should be scheduled after failed buy');
      assert(__QA.api.readSaveRaw() === null, 'no save should be written after failed buy');

      // Travel should schedule autosave and persist day + upkeep changes
      __QA.api.clearSave();
      __QA.api.setTime({ day: 5 });
      __QA.api.setPlayer({ gold: 100, inv: { food: 3 } });
      const beforeTravel = __QA.api.snapshot();
      const tr = __QA.api.travelDays(1);
      assert(tr.ok === true, 'travelDays should succeed');
      assert(__QA.api.flushAutosave() === true, 'autosave should be scheduled after travel');
      const travelSave = __QA.api.readSave();
      assert(!!travelSave, 'save should exist after travel autosave flush');
      assert(travelSave.time.day === beforeTravel.time.day + 1, 'travel should advance day by 1');
      assert(travelSave.player.inv.food === (beforeTravel.player.inv.food || 0) - 1, 'travel should consume 1 food');

      // --- Contracts rep/permit tiers QA
      {
        __QA.api.setRep('valdenmere', 0);
        __QA.api.regenContracts('valdenmere');
        const vis0 = __QA.api.listVisibleContracts('valdenmere');
        assert(vis0.every(j => (j.tier ?? 0) <= 0), 'rep=0 should only show tier0 contracts');

        __QA.api.setRep('valdenmere', 3);
        const vis1 = __QA.api.listVisibleContracts('valdenmere');
        assert(vis1.some(j => (j.tier ?? 0) === 1) || vis1.length === 0, 'rep=3 should allow tier1 contracts');

        __QA.api.setRep('valdenmere', 7);
        const vis2 = __QA.api.listVisibleContracts('valdenmere');
        assert(vis2.some(j => (j.tier ?? 0) === 2) || vis2.length === 0, 'rep=7 should allow tier2 contracts');

        // Reward math: permit should increase reward.
        __QA.api.setRep('valdenmere', 0);
        __QA.api.setPermit('valdenmere', false);
        const rNo = contractRewardForAccept('valdenmere', 100, 0);
        __QA.api.setPermit('valdenmere', true);
        const rYes = contractRewardForAccept('valdenmere', 100, 0);
        assert(rYes > rNo, 'permit should increase contract reward');
      }

      // --- Cache POI QA (single-use + persistence)
      {
        const pos = __QA.api.findTile(13);
        assert(!!pos, 'should find a cache tile (id 13)');
        __QA.api.clearSave();

        // Open once -> should schedule autosave and write openedCaches.
        __QA.api.teleportToTile(pos.x, pos.y);
        const r1 = __QA.api.openCacheAt(pos.x, pos.y);
        assert(r1.ok === true, 'openCacheAt should succeed first time');
        assert(__QA.api.flushAutosave() === true, 'autosave should be scheduled after opening cache');
        const save1 = __QA.api.readSave();
        assert(!!save1, 'save should exist after cache open');
        assert(Array.isArray(save1.openedCaches) && save1.openedCaches.length >= 1, 'save should include openedCaches');

        // Open again -> should fail and NOT schedule autosave.
        __QA.api.clearSave();
        const r2 = __QA.api.openCacheAt(pos.x, pos.y);
        assert(r2.ok === false, 'openCacheAt should fail when already opened');
        assert(__QA.api.flushAutosave() === false, 'no autosave should be scheduled for already-opened cache');
        assert(__QA.api.readSaveRaw() === null, 'no save should be written for already-opened cache');

        // Persistence via load: write save with openedCaches, then load and ensure still blocked.
        saveGame();
        const raw = localStorage.getItem(SAVE_KEY);
        assert(!!raw, 'saveGame should write save for persistence test');
        assert(loadGame() === true, 'loadGame should succeed for persistence test');
        const r3 = __QA.api.openCacheAt(pos.x, pos.y);
        assert(r3.ok === false, 'opened cache should remain blocked after reload');
      }

      // --- Market Rumors QA (deterministic, always true)
      {
        __QA.api.setTime({ day: 20, frac: 0, seed: 7 });
        const r1 = __QA.api.getRumors('valdenmere');
        const r2 = __QA.api.getRumors('valdenmere');
        assert(Array.isArray(r1) && r1.length === 2, 'valdenmere should return exactly 2 rumors');
        assert(JSON.stringify(r1) === JSON.stringify(r2), 'rumors should be stable across repeated calls');

        __QA.api.travelDays(1);
        const r3 = __QA.api.getRumors('valdenmere');
        assert(JSON.stringify(r3) !== JSON.stringify(r1), 'rumors should change after day advances (most days)');
      }

      // --- NPC dialogue (fixture; cached 10 per NPC per day)
      {
        try { localStorage.removeItem(NPC_CACHE_KEY); } catch {}
        __QA.api.setTime({ day: 12, frac: 0, seed: 7 });

        const lines = __QA.api.getNpcLines('valdenmere', 'valdenmere_scribe');
        assert(Array.isArray(lines) && lines.length === 10, 'npc lines should be 10');
        assert(lines.every(s => typeof s === 'string' && s.trim().length > 0), 'npc lines should be non-empty strings');

        const panel = __QA.api.getNpcPanel('valdenmere');
        assert(Array.isArray(panel) && panel.length === 3, 'npc panel should return 3 npcs for valdenmere');
        assert(panel.every(r => typeof r.line === 'string' && r.line.trim().length > 0), 'npc panel lines should be non-empty');

        const day0 = __QA.api.getNpcCacheDay();
        assert(day0 === 12, 'npc cache day should match time.day');

        // Advance day should reset cache day (even if fixture content is same)
        __QA.api.setTime({ day: 13 });
        const day1 = __QA.api.getNpcCacheDay();
        assert(day1 === 13, 'npc cache day should advance when time.day advances');
      }


// --- NPC walkers (entity system)
{
  __QA.api.clearNpcBubble();
  __QA.api.setTime({ day: 15, frac: 0, seed: 3 });
  __QA.api.teleportToCity('valdenmere');
  __QA.api.spawnCityNPCs('valdenmere');

  const walkers = __QA.api.getNpcEntities();
  assert(Array.isArray(walkers) && walkers.length === 3, 'valdenmere should spawn 3 NPC walkers');
  assert(walkers.every(w => w.bounds && Number.isFinite(w.x) && Number.isFinite(w.y)), 'NPC walkers should have bounds and positions');
  assert(walkers.every(w => w.x >= w.bounds.x1 && w.x <= w.bounds.x2 && w.y >= w.bounds.y1 && w.y <= w.bounds.y2), 'NPC walkers spawn within bounds');

  for (let i = 0; i < 300; i++) __QA.api.step(1/60);
  const walkers2 = __QA.api.getNpcEntities();
  assert(walkers2.every(w => w.x >= w.bounds.x1 && w.x <= w.bounds.x2 && w.y >= w.bounds.y1 && w.y <= w.bounds.y2), 'NPC walkers stay within bounds');

  const target = walkers2[0];
  __QA.api.setPlayer({ x: target.x, y: target.y });
  assert(__QA.api.interactNpc(target.id) === true, 'interacting with nearby NPC should succeed');
  const bubble = __QA.api.getNpcBubble();
  assert(!!bubble && typeof bubble.text === 'string' && bubble.text.length > 0, 'NPC bubble should appear with text');
  const lines = __QA.api.getNpcLines('valdenmere', target.id);
  assert(lines.includes(bubble.text), 'bubble text should come from npc lines');

  const dxp = player.x - target.x;
  const dyp = player.y - target.y;
  const d = Math.hypot(dxp, dyp);
  assert(d >= (player.r + target.radius - 0.5), 'player should not remain overlapping NPC after talk');

  assert(player.npcGhostUntil > stateTime, 'npc ghost cooldown should be set after talk');

  for (let i = 0; i < 200; i++) __QA.api.step(1/60);
  assert(__QA.api.getNpcBubble() === null, 'NPC bubble should expire');
}

// --- NPC bubble bounds (mobile-safe)
{
  __QA.api.setTime({ day: 16, frac: 0, seed: 2 });
  __QA.api.teleportToCity('valdenmere');
  __QA.api.spawnCityNPCs('valdenmere');
  const walkers = __QA.api.getNpcEntities();
  const target = walkers[0];
  __QA.api.setPlayer({ x: target.x, y: target.y });
  assert(__QA.api.interactNpc(target.id) === true, 'npc interaction should succeed for bubble bounds test');
  const rect = __QA.api.getNpcBubbleRect();
  assert(!!rect && rect.w > 0 && rect.h > 0, 'npc bubble rect should exist');
  assert(rect.x >= 0 && rect.y >= 0, 'npc bubble rect should be on-screen');
  assert(rect.x + rect.w <= VIEW_W + 1, 'npc bubble rect should fit within view width');
  assert(rect.y + rect.h + 6 <= VIEW_H + 1, 'npc bubble rect should fit within view height (tail included)');
  if (IS_MOBILE) {
    assert(rect.y >= HUD_H, 'mobile bubble should not overlap HUD');
  }
}



// --- Mobile HUD compact/expand QA
{
  if (IS_MOBILE) {
    ui.mobileHudExpanded = false;
    drawHUD();
    const T = ui._hudCityTap;
    assert(!!T, 'mobile HUD tap rect should exist');
    assert(handleMobileHudTap(T.x + 1, T.y + 1) === true, 'tap should toggle mobile HUD');
    drawHUD();
    assert(ui.mobileHudExpanded === true, 'mobile HUD should expand after tap');
    assert(ui._hudExpandedVisible === true, 'expanded line should be visible');
    ui.marketOpen = true;
    drawHUD();
    assert(ui._hudExpandedVisible === false, 'expanded line hidden during modal');
    ui.marketOpen = false;
  }
}


// --- Mobile Market layout QA
{
  if (IS_MOBILE) {
    ui.marketOpen = true;
    ui.mode = 'buy';
    ui.marketScroll = 0;
    ui.selection = 0;
    for (const it of ITEMS) player.inv[it.id] = 0;

    if (USE_DOM_MODALS) {
      domRender();
      assert(uiRoot.querySelector('.cr-tabs'), 'market should always show tabs (gear tab always visible)');
      assert(ui.mode === 'buy', 'mobile market should force buy mode when sell empty');
      assert(uiRoot.querySelector('.cr-action'), 'mobile market should render single action button');

      if (ITEMS[0]) player.inv[ITEMS[0].id] = 2;
      domRender();
      assert(uiRoot.querySelector('.cr-tabs'), 'mobile market should show tabs when both have items');
      assert(uiRoot.querySelectorAll('.cr-card').length > 0, 'mobile market should render cards');
    } else {
      drawMarket();
      assert(ui._marketTabs === null, 'mobile market should hide tabs when sell empty');
      assert(ui.mode === 'buy', 'mobile market should force buy mode when sell empty');
      assert(ui._marketList && ui._marketList.cols === 1, 'mobile market list should be single column');

      if (ITEMS[0]) player.inv[ITEMS[0].id] = 2;
      drawMarket();
      assert(ui._marketTabs && ui._marketTabs.buy && ui._marketTabs.sell, 'mobile market should show tabs when both have items');
    }

    ui.marketOpen = false;
    domCloseAll();
  }
}


      // --- Contracts deterministic auto-complete QA
      // We assert BOTH:
      // 1) Success path: enough goods -> contract completes on city entry and autosave reflects completion.
      // 2) Failure path: insufficient goods -> contract remains active and autosave does NOT claim completion.

      // Ensure stable starting state.
      __QA.api.clearSave();
      __QA.api.setTime({ day: 10, frac: 0, seed: 1 });
      __QA.api.setPlayer({ gold: 100, capacity: 999, inv: { food: 0, ore: 0, herbs: 0, potion: 0, relic: 0 } });

      // A) Success case
      {
        const want = 'ore';
        const qty = 2;
        const reward = 33;
        __QA.api.setPlayer({ inv: { [want]: qty } });
        assert(__QA.api.setActiveContract({ fromId: 'valdenmere', toId: 'ashport', want, qty, reward }) === true, 'setActiveContract should succeed');
        const before = __QA.api.snapshot();

        // Enter destination city and process entry logic.
        assert(__QA.api.forceCityEntry('ashport') === true, 'forceCityEntry ashport should succeed');

        assert(contracts.active === null, 'contract should be cleared after successful delivery');
        assert((player.inv[want] || 0) === (before.player.inv[want] || 0) - qty, 'delivered goods should be removed from inventory');
        assert(player.gold === before.player.gold + reward, 'reward should be granted on completion');

        // Completion banner should appear.
        assert(Array.isArray(banner.q) && banner.q.length >= 1, 'completion banner should be queued');
        assert(String(banner.q[0].title || '').toLowerCase().includes('contract'), 'banner title should mention contract');
        assert(String(banner.q[0].text || '').includes(`+${reward}g`), 'banner text should include reward gold');

        // Banner should auto-dismiss with time.
        const n0 = banner.q.length;
        // Step enough dt to expire TTL + exit animation.
        for (let i = 0; i < 260; i++) __QA.api.step(1/60);
        assert(banner.q.length <= n0 - 1, 'banner should auto-dismiss after TTL');

        // Autosave must reflect completion when flushed.
        assert(__QA.api.flushAutosave() === true, 'autosave should be scheduled after contract completion');
        const save = __QA.api.readSave();
        assert(!!save, 'save should exist after contract completion autosave flush');
        assert(save.contracts && save.contracts.active === null, 'save JSON should reflect completed contract (active:null)');
      }

      // B) Insufficient-goods case
      {
        __QA.api.clearSave();
        __QA.api.setTime({ day: 11, frac: 0, seed: 1 });
        __QA.api.setPlayer({ gold: 100, capacity: 999, inv: { ore: 1 } });

        const want = 'ore';
        const qty = 2;
        const reward = 33;
        assert(__QA.api.setActiveContract({ fromId: 'valdenmere', toId: 'ashport', want, qty, reward }) === true, 'setActiveContract should succeed (insufficient case)');
        const before = __QA.api.snapshot();

        assert(__QA.api.forceCityEntry('ashport') === true, 'forceCityEntry ashport should succeed (insufficient case)');

        assert(!!contracts.active, 'contract should remain active when insufficient goods');
        assert(contracts.active.want === want && contracts.active.qty === qty && contracts.active.toId === 'ashport', 'active contract should remain unchanged');
        assert((player.inv[want] || 0) === (before.player.inv[want] || 0), 'inventory should not change when insufficient goods');
        assert(player.gold === before.player.gold, 'gold should not change when insufficient goods');

        // No autosave should be scheduled purely from failing delivery.
        assert(__QA.api.flushAutosave() === false, 'no autosave should be scheduled after insufficient-goods delivery');
        assert(__QA.api.readSaveRaw() === null, 'no save should be written after insufficient-goods delivery');
      }

      // ══════════════════════════════════════════════════════════════════
      // CITY WALKING TESTS
      // ══════════════════════════════════════════════════════════════════

      // --- Test 1: Player spawns inside Valdenmere
      {
        __QA.api.closeUI();
        __QA.api.teleportToCity('valdenmere');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        const city = __QA.api.getPlayerCity();
        assert(city === 'valdenmere', 'player should be inside valdenmere after teleport');
        const pos = __QA.api.getPlayerPos();
        const info = __QA.api.getCityInfo('valdenmere');
        assert(Number.isFinite(pos.x) && Number.isFinite(pos.y), 'player position should be finite');
        assert(pos.x > info.x * TILE && pos.x < (info.x + info.w) * TILE, 'player x should be within city x bounds');
        assert(pos.y > info.y * TILE && pos.y < (info.y + info.h) * TILE, 'player y should be within city y bounds');
      }

      // --- Test 2: Click-to-move — player moves toward a tap target within city
      {
        __QA.api.closeUI();
        __QA.api.teleportToCity('valdenmere');
        const before = __QA.api.getPlayerPos();
        const info = __QA.api.getCityInfo('valdenmere');
        // Target: right side of the city, should be walkable floor
        const targetX = info.centerX + 2 * TILE;
        const targetY = info.centerY;
        __QA.api.setClickMove(targetX, targetY);
        const cm = __QA.api.getClickMove();
        assert(cm.active === true, 'click-move should be active after setClickMove');
        // Run 120 frames (~2s of movement)
        __QA.api.walkSteps(120);
        const after = __QA.api.getPlayerPos();
        const movedDist = Math.hypot(after.x - before.x, after.y - before.y);
        assert(movedDist > 5, `player should have moved after click-move (moved ${movedDist.toFixed(1)}px)`);
      }

      // --- Test 3: Player cannot walk through walls
      {
        __QA.api.closeUI();
        __QA.api.teleportToCity('valdenmere');
        const info = __QA.api.getCityInfo('valdenmere');
        // Try to walk into the north wall (y = city.y - 1)
        const wallTileX = info.x + Math.floor(info.w / 2);
        const wallTileY = info.y - 1;
        assert(__QA.api.isTileSolid(wallTileX, wallTileY) === true, 'north wall tile should be solid');
        // Teleport near the north wall (inside, 1 tile from wall)
        __QA.api.teleportToTile(wallTileX, info.y + 1);
        const before = __QA.api.getPlayerPos();
        // Click-move directly into the wall
        __QA.api.setClickMove(wallTileX * TILE, wallTileY * TILE);
        __QA.api.walkSteps(60);
        const after = __QA.api.getPlayerPos();
        // Player should not have passed through the wall
        assert(after.y >= (wallTileY + 1) * TILE - player.r, 'player should not penetrate north wall');
      }

      // --- Test 4: Click-to-move stops when arriving at target
      {
        __QA.api.closeUI();
        __QA.api.teleportToCity('valdenmere');
        const info = __QA.api.getCityInfo('valdenmere');
        // Move to a position that's reachable (city center)
        __QA.api.setClickMove(info.centerX, info.centerY);
        // Run enough frames to arrive
        __QA.api.walkSteps(300);
        const cm = __QA.api.getClickMove();
        const pos = __QA.api.getPlayerPos();
        const distToTarget = Math.hypot(pos.x - info.centerX, pos.y - info.centerY);
        // Either arrived (clickMove inactive) or close to target
        assert(!cm.active || distToTarget < TILE * 2, 
          `player should arrive at target or stop nearby (dist: ${distToTarget.toFixed(1)}px, active: ${cm.active})`);
      }

      // --- Test 5: Market tile exists and is reachable
      {
        __QA.api.closeUI();
        __QA.api.teleportToCity('valdenmere');
        const marketTile = __QA.api.findTileInCity('valdenmere', 6);
        assert(marketTile !== null, 'valdenmere should have at least one market tile (6)');
        assert(!__QA.api.isTileSolid(marketTile.tx, marketTile.ty), 'market tile should not be solid');
        // Walk to the market tile
        __QA.api.setClickMove((marketTile.tx + 0.5) * TILE, (marketTile.ty + 0.5) * TILE, 'market');
        __QA.api.walkSteps(300);
        const pos = __QA.api.getPlayerPos();
        const distToMarket = Math.hypot(pos.x - (marketTile.tx + 0.5) * TILE, pos.y - (marketTile.ty + 0.5) * TILE);
        assert(distToMarket < TILE * 3, `player should reach market tile (dist: ${distToMarket.toFixed(1)}px)`);
      }

      // --- Test 6: Contracts tile exists and is reachable
      {
        __QA.api.closeUI();
        __QA.api.teleportToCity('valdenmere');
        const contractsTile = __QA.api.findTileInCity('valdenmere', 12);
        assert(contractsTile !== null, 'valdenmere should have at least one contracts tile (12)');
        assert(!__QA.api.isTileSolid(contractsTile.tx, contractsTile.ty), 'contracts tile should not be solid');
      }

      // --- Test 7: City floor tiles are walkable
      {
        for (const cityId of ['valdenmere', 'ashport', 'crosshaven', 'ironholt']) {
          const info = __QA.api.getCityInfo(cityId);
          // Sample a 3x3 grid around city center and count walkable tiles
          let walkable = 0;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const tx = Math.floor(info.centerX / TILE) + dx;
              const ty = Math.floor(info.centerY / TILE) + dy;
              if (__QA.api.isTileWalkable(tx, ty)) walkable++;
            }
          }
          assert(walkable >= 4, `${cityId} center should have walkable floor tiles (found ${walkable})`);
        }
      }

      // --- Test 8: Auto-nav from one city to another — player moves along path
      {
        // Close any open modals from previous tests
        __QA.api.closeUI();
        // Start at ironholt, navigate to crosshaven
        __QA.api.teleportToCity('ironholt');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        const before = __QA.api.getPlayerPos();
        // Navigate to crosshaven (different city — won't trigger "already there")
        const started = __QA.api.startAutoNav('crosshaven');
        assert(started === true, 'startAutoNav to crosshaven should succeed');
        const nav = __QA.api.getAutoNav();
        assert(nav.active === true, 'autoNav should be active after start');
        assert(nav.destCityId === 'crosshaven', 'autoNav destCityId should be crosshaven');
        assert(nav.pathLen > 0, 'autoNav path should have waypoints');
        // Run 120 frames (~2s) — player should have moved
        __QA.api.walkSteps(120);
        const after = __QA.api.getPlayerPos();
        const moved = Math.hypot(after.x - before.x, after.y - before.y);
        assert(moved > 2, `player should move along autoNav path (moved ${moved.toFixed(1)}px)`);
      }

      // --- Test 9: Walk across city using keyboard
      {
        __QA.api.closeUI();
        autoNav.active = false;
        clickMove.active = false;
        __QA.api.teleportToCity('ironholt');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        const before = __QA.api.getPlayerPos();
        // Simulate holding ArrowRight for 60 frames
        vkeys.add('ArrowRight');
        for (let i = 0; i < 60; i++) __QA.api.step(1/60);
        vkeys.delete('ArrowRight');
        const after = __QA.api.getPlayerPos();
        const movedX = after.x - before.x;
        assert(movedX > TILE, `player should move rightward in ironholt (moved ${movedX.toFixed(1)}px)`);
      }

      // --- Test 10: All cities are reachable via teleport and have a valid city id
      {
        for (const cityId of ['valdenmere', 'ashport', 'crosshaven', 'ironholt']) {
          assert(__QA.api.teleportToCity(cityId) === true, `teleportToCity(${cityId}) should succeed`);
          for (let i = 0; i < 3; i++) __QA.api.step(1/60);
          const city = __QA.api.getPlayerCity();
          assert(city === cityId, `getPlayerCity should return ${cityId} after teleport (got ${city})`);
        }
      }

      // ══════════════════════════════════════════════════════════════════
      // NAVIGATION UNIT TESTS (auto-nav between cities)
      // ══════════════════════════════════════════════════════════════════

      // --- Nav Test 1: Auto-nav Valdenmere → Ashport — player leaves city
      {
        __QA.api.closeUI();
        autoNav.active = false;
        clickMove.active = false;
        __QA.api.teleportToCity('valdenmere');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        assert(__QA.api.getPlayerCity() === 'valdenmere', 'nav1: should start in valdenmere');
        const before = __QA.api.getPlayerPos();
        const started = __QA.api.startAutoNav('ashport');
        assert(started === true, 'nav1: startAutoNav should succeed');
        const nav = __QA.api.getAutoNav();
        assert(nav.active === true, 'nav1: autoNav should be active');
        assert(nav.destCityId === 'ashport', 'nav1: dest should be ashport');
        assert(nav.pathLen >= 2, 'nav1: path should have multiple waypoints');
        // pathIdx should skip first waypoint (city center) since player is inside city
        assert(nav.pathIdx >= 1, 'nav1: pathIdx should skip origin city waypoint');
        // Run enough frames to leave city
        __QA.api.walkSteps(600);
        const after = __QA.api.getPlayerPos();
        const moved = Math.hypot(after.x - before.x, after.y - before.y);
        assert(moved > TILE * 3, `nav1: player should move significantly (moved ${moved.toFixed(1)}px)`);
      }

      // --- Nav Test 2: All city-to-city routes produce valid paths
      {
        const cities = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];
        for (const from of cities) {
          for (const to of cities) {
            if (from === to) continue;
            __QA.api.closeUI();
            autoNav.active = false;
            clickMove.active = false;
            __QA.api.teleportToCity(from);
            for (let i = 0; i < 3; i++) __QA.api.step(1/60);
            const started = __QA.api.startAutoNav(to);
            assert(started === true, `nav2: ${from}→${to} should start`);
            const nav = __QA.api.getAutoNav();
            assert(nav.active === true, `nav2: ${from}→${to} should be active`);
            assert(nav.pathLen >= 2, `nav2: ${from}→${to} should have ≥2 waypoints (got ${nav.pathLen})`);
          }
        }
      }

      // --- Nav Test 3: Auto-nav advances pathIdx over time
      {
        __QA.api.closeUI();
        autoNav.active = false;
        clickMove.active = false;
        __QA.api.teleportToCity('ironholt');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        __QA.api.startAutoNav('crosshaven');
        const nav0 = __QA.api.getAutoNav();
        const idx0 = nav0.pathIdx;
        // Walk a lot — should advance at least one waypoint
        __QA.api.walkSteps(1200);
        const nav1 = __QA.api.getAutoNav();
        assert(nav1.pathIdx > idx0 || !nav1.active, `nav3: pathIdx should advance or nav should complete (was ${idx0}, now ${nav1.pathIdx}, active=${nav1.active})`);
      }

      // --- Nav Test 4: "Already there" — starting nav to current city returns false
      {
        __QA.api.closeUI();
        autoNav.active = false;
        __QA.api.teleportToCity('ashport');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        const started = __QA.api.startAutoNav('ashport');
        assert(started === false, 'nav4: navigating to current city should fail');
        assert(autoNav.active === false, 'nav4: autoNav should not be active');
      }

      // --- Nav Test 5: Manual input cancels auto-nav
      {
        __QA.api.closeUI();
        autoNav.active = false;
        clickMove.active = false;
        __QA.api.teleportToCity('valdenmere');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        __QA.api.startAutoNav('ironholt');
        assert(autoNav.active === true, 'nav5: autoNav should be active');
        // Simulate arrow key press — should cancel
        vkeys.add('ArrowRight');
        __QA.api.step(1/60);
        vkeys.delete('ArrowRight');
        assert(autoNav.active === false, 'nav5: arrow key should cancel autoNav');
      }

      // --- Nav Test 6: Full journey — nav makes significant progress along path
      {
        __QA.api.closeUI();
        autoNav.active = false;
        clickMove.active = false;
        __QA.api.teleportToCity('crosshaven');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        const before = __QA.api.getPlayerPos();
        __QA.api.startAutoNav('ironholt');
        const nav0 = __QA.api.getAutoNav();
        // Walk for ~40s of travel
        __QA.api.walkSteps(2400);
        const nav1 = __QA.api.getAutoNav();
        const after = __QA.api.getPlayerPos();
        const moved = Math.hypot(after.x - before.x, after.y - before.y);
        // Should have advanced multiple waypoints and moved significantly
        assert(nav1.pathIdx > nav0.pathIdx || !nav1.active,
          `nav6: should advance waypoints (was ${nav0.pathIdx}, now ${nav1.pathIdx}, active=${nav1.active})`);
        assert(moved > TILE * 10, `nav6: should move significantly (moved ${moved.toFixed(1)}px)`);
      }

      // ══════════════════════════════════════════════════════════════════
      // PER-PLAYER SAVE ISOLATION TEST
      // ══════════════════════════════════════════════════════════════════
      {
        const api = __QA.api;
        const key = api.getSaveKey();

        // Verify save key exists and is non-empty
        assert(typeof key === 'string' && key.length > 0, 'save key should be a non-empty string');

        // Write a full state: gold, rep, inv, position
        api.clearSave();
        api.setPlayer({ gold: 777, inv: { ore: 3, herbs: 1 } });
        api.setRep('ironholt', 9);
        api.setPermit('ashport', true);
        api.teleportToCity('crosshaven');
        for (let i = 0; i < 5; i++) api.step(1/60);

        // Force buy to trigger auto-save
        api.freezePrices();
        api.marketBuy('food', 1);
        assert(api.flushAutosave() === true, 'player-save: autosave should be pending after buy');

        const saved = api.readSave();
        assert(!!saved, 'player-save: save should exist');
        assert(saved.player.gold === 777 - saved.player.inv.food * 1 || saved.player.inv.food >= 1, 'player-save: gold/inv should reflect buy');
        assert((saved.player.rep?.ironholt || 0) === 9, 'player-save: rep should be persisted');
        assert(saved.player.permits?.ashport === true, 'player-save: permit should be persisted');
        assert(Number.isFinite(saved.player.x) && Number.isFinite(saved.player.y), 'player-save: position should be saved');
        assert(Number.isFinite(saved.time?.day), 'player-save: day should be saved');

        // Verify save is stored under correct localStorage key
        const rawFromStorage = (() => { try { return localStorage.getItem(key); } catch { return null; } })();
        assert(!!rawFromStorage, 'player-save: save should be in localStorage under correct key');
        const parsedFromStorage = JSON.parse(rawFromStorage);
        assert(parsedFromStorage.player.rep?.ironholt === 9, 'player-save: localStorage rep should match');

        // Load and verify state restores
        const beforeLoad = api.snapshot();
        assert(loadGame() === true, 'player-save: loadGame should succeed');
        const afterLoad = api.snapshot();
        assert(afterLoad.player.rep?.ironholt === 9, 'player-save: rep restored after load');
        assert(afterLoad.player.permits?.ashport === true, 'player-save: permit restored after load');
        assert(Number.isFinite(afterLoad.player.x), 'player-save: position restored after load');
      }

      qaPass('save/load + autosave + contracts + npc dialogue + npc walkers + mobile bubbles + city walking + navigation + per-player save');
    } catch (e) {
      qaFail(String(e && (e.stack || e.message) || e));
    }
  }

  // Apply gear stats on fresh start (load already calls applyGearStats)
  applyGearStats();

  // Auto-load save on startup: real players try DB first, guests use localStorage
  loadGameAsync().then(loaded => {
    if (loaded) console.log('[BOOT] Save loaded');
    else console.log('[BOOT] No save — fresh start');
  });

  tick();
})();
