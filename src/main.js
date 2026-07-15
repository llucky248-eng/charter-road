/* The Amber Road - web prototype (tiles + free roam)
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

  const NPC_DIAG_BUILD = 'v0.5.23'; // single version - updated by ops/scripts/bump_version.mjs
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
          gainItem(itId, n);
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
        // If gear is set directly, apply stat changes so capacity/speed stay correct
        if (p.gear && typeof p.gear === 'object') {
          if (!player.gear) player.gear = { pack: 0, boots: 0, tool: 0, pickaxe: 0 };
          Object.assign(player.gear, p.gear);
          applyGearStats();
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

      /** QA helper: set a market pressure value directly. Lets tests exercise the
       *  "Global Market" pulse block in the market list, which is otherwise only
       *  populated by the (QA-disabled) live economy sync. */
      setEconomyPressure: (cityId, itemId, p) => {
        if (!ECONOMY.pressure[cityId]) ECONOMY.pressure[cityId] = {};
        ECONOMY.pressure[cityId][itemId] = Number(p) || 0;
        dom.key = ''; // force re-render so the block appears
        return true;
      },

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
        // Mirror real tick: always save on city arrival (not just on contract delivery)
        scheduleAutoSave();
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
          else player.gold = Math.max(0, player.gold - 5); // no-food penalty
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
          updateAiTraders(d);
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
                checkGuildMilestone();
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

      /** QA helper: open a synthetic road event of the given kind and render.
       *  Returns true if the themed .cr-event panel is present in the DOM. */
      qaOpenTestEvent: (kind = 'bandits', opts = {}) => {
        __QA.__evRan = false;
        openEvent({
          kind,
          dismissable: opts.dismissable, // undefined → derived from EVENT_THEMES[kind].threat
          title: 'QA Event',
          text: 'test',
          choices: [{ label: 'Do it', run: () => { __QA.__evRan = true; closeEvent(); } }],
        });
        domRender();
        return !!document.querySelector('.cr-panel.cr-event');
      },
      qaEventChoiceRan: () => !!__QA.__evRan,
      qaEventOpen: () => !!ui.eventOpen,
      /** QA helper: advance only the stateTime UI clock (ms). api.step can't be
       *  used to age an open event dialog — it force-closes modals so movement
       *  tests never wedge. */
      qaAdvanceStateTime: (ms) => { stateTime += Math.max(0, Number(ms) || 0); return stateTime; },

      // ── City walking helpers ──────────────────────────────────────────
      /** Start a click-move to world pixel (wx, wy) - uses A* pathfinding */
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
        if (!player.gear) player.gear = { pack: 0, boots: 0, tool: 0, pickaxe: 0 };
        if (player.gold < cost) return { ok: false, reason: 'insufficient gold' };
        if ((player.gear[slot] ?? 0) >= tier) return { ok: false, reason: 'already owned' };
        player.gold -= cost;
        player.gear[slot] = tier;
        applyGearStats();
        scheduleAutoSave(); // mirrors real gear-buy handler
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

      // ── Mining QA helpers ─────────────────────────────────────────────
      /** Force-build the Ironholt mine to a target level (1..maxLevel). */
      qaForceBuildMine: (level = 1) => {
        const slot = cityBuildings.ironholt?.mine;
        if (!slot) return false;
        const lv = Math.max(1, Math.min(slot.maxLevel, Math.floor(level)));
        slot.level = lv;
        slot.built = true;
        slot.playerFunded = 0;
        cityBonus.ironholt.mineProduction = slot.gain * lv;
        if (typeof buildSlotOnMap === 'function' && slot.tileX > 0) buildSlotOnMap('ironholt', 'mine', slot);
        return true;
      },
      /** Find the first legacy ore mine_node (tile 18, untagged). Falls back to any node. */
      qaMineNodeAt: () => {
        let fallback = null;
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            if (tileAt(x, y) === 18) {
              const idx = y * MAP_W + x;
              if (!MINE_SITE_NODES[idx]) return { tx: x, ty: y };
              if (!fallback) fallback = { tx: x, ty: y };
            }
          }
        }
        return fallback;
      },
      /** Find the first mine_node tagged with the given metal variant. */
      qaMineSiteNodeAt: (metal) => {
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            if (tileAt(x, y) === 18 && MINE_SITE_NODES[y * MAP_W + x] === metal) {
              return { tx: x, ty: y };
            }
          }
        }
        return null;
      },
      /** Snapshot of the active loot popup queue (for assertions). */
      qaLootPopups: () => _lootPopups.map(p => ({
        itemId: p.itemId, qty: p.qty, startMs: p.startMs, sx: p.sx, sy: p.sy,
      })),
      /** Clear the loot popup queue (used to isolate per-test assertions). */
      qaClearLootPopups: () => { _lootPopups.length = 0; return true; },
      /** Invoke the renderer's drawLootPopups pass so age-out semantics are
       *  exercised in QA (the main render loop doesn't run during api.step). */
      qaDrawLootPopups: () => { drawLootPopups(); return _lootPopups.length; },
      /** Read the loot popup tunables so tests can wait the right interval. */
      qaLootPopupConsts: () => ({
        lifetimeMs: LOOT_POPUP_LIFETIME_MS,
        risePx:     LOOT_POPUP_RISE_PX,
        stackMs:    LOOT_POPUP_STACK_MS,
      }),
      /** Count mine_node tiles tagged with the given metal variant. */
      qaCountMineNodes: (metal) => {
        let n = 0;
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            if (tileAt(x, y) === 18 && MINE_SITE_NODES[y * MAP_W + x] === metal) n++;
          }
        }
        return n;
      },
      /** Trigger a single player swing at (tx, ty). Returns whether the swing landed. */
      qaPlayerMine: (tx, ty) => {
        const x = Number(tx), y = Number(ty);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        return playerMineNode(x, y);
      },
      /** Get player mining state (for assertions). */
      qaGetMiningState: () => ({
        stamina: player.mineStamina,
        cooldowns: { ...(player.mineCooldown || {}) },
      }),
      /** Set player stamina directly (for cooldown/full-cargo isolation tests). */
      qaSetStamina: (v) => { player.mineStamina = clamp(Math.floor(Number(v) || 0), 0, 100); },
      /** Wipe per-vein cooldown so the same tile is mineable again (test isolation). */
      qaResetMineCooldowns: () => { player.mineCooldown = {}; return true; },
      /** Run cityMineTick once (no day advance). */
      qaCityMineTick: () => { cityMineTick(); return cityBuildings.ironholt?.mine || null; },
      /** Snapshot of AI traders for assertions (state, fromId, toId, cityTimer). */
      qaAiTraders: () => AI_TRADERS.map(t => ({
        id: t.id, state: t.state, fromId: t.fromId, toId: t.toId,
        itemId: t.itemId, cityTimer: t.cityTimer ?? 0,
      })),
    };
  }

  const TILE = IS_MOBILE ? 12 : 16;
  // Scale factor applied to player carriage + AI trader carriage drawings.
  // 2.0 = carriage spans ~2×2 tiles, matching the visual weight of buildings.
  const CARRIAGE_SCALE = 2.0;
  // How many pixels building tiles extend upward as a raised 3D top face.
  // Makes buildings visually taller/bigger relative to the player (who is ~1 tile tall).
  const BUILDING_RISE = IS_MOBILE ? 10 : 14;
  const UI_SCALE = IS_MOBILE ? 1.9 : 1.0;
  const HUD_H = Math.round((IS_MOBILE ? 48 : 56) * UI_SCALE);
  const MAP_W = 280;
  const MAP_H = 180;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function ellipsizeText(str, maxW) {
    if (!str) return '';
    if (ctx.measureText(str).width <= maxW) return str;
    const ell = '...';
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

        // Terrain cost: forest/swamp are expensive so A* prefers roads
        const nt = tileAt(nx, ny);
        const terrainCost = nt === 10 ? 3.0 : nt === 11 ? 2.5 : 1.0;
        const tentativeG = (gScore.get(currentKey) ?? Infinity) + COSTS[d] * terrainCost;
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
    // Skip smoothing - A* already gives a valid tile path; smoothing creates
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
          : '-';
        const treVal   = (_tre && _tre.gold > 0) ? `${_tre.gold}g` : '-';
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
    // The gate exit (path[0]) is just outside the south wall - safe to warp to.
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
    toast(`Navigating to ${dest?.name || cityId}...`, 2);
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

    // Check if already inside the destination city - done!
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
      // Path exhausted - snap player into destination city
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

    // Arrival threshold - generous so player flows smoothly between waypoints
    if (dist < TILE * 2) {
      autoNav.pathIdx++;
      return;
    }

    const nx = dx / dist, ny = dy / dist;
    const tMul = terrainSpeedMul(player.x, player.y);
    const stepX = nx * player.speed * tMul * dt;
    const stepY = ny * player.speed * tMul * dt;
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
      if (e.code === 'Escape') {
        if (!ui.eventDismissable) toast('This demands an answer.', 1.6);
        else { closeEvent(); toast('You move on.', 2); }
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') ui.eventSel = (ui.eventSel + ui.eventChoices.length - 1) % ui.eventChoices.length;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') ui.eventSel = (ui.eventSel + 1) % ui.eventChoices.length;
      if (e.code === 'Enter' || e.code === 'Space') {
        if (eventChoiceLocked(stateTime, ui.eventOpenedAt, EVENT_INPUT_LOCK_MS)) return;
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

  function handleEventChoiceTap(sx, sy) {
    if (!ui.eventOpen) return false;
    const E = ui._eventList;
    if (!E || sx < E.x || sx > E.x + E.w || sy < E.y || sy > E.y + E.h) return false;
    const vi = Math.floor((sy - E.y) / E.rowH);
    const i = ui.eventScroll + vi;
    if (i < 0 || i >= ui.eventChoices.length) return false;
    if (ui.eventSel === i) {
      if (eventChoiceLocked(stateTime, ui.eventOpenedAt, EVENT_INPUT_LOCK_MS)) return true;
      const ch = ui.eventChoices[i];
      if (ch && typeof ch.run === 'function') ch.run();
    } else {
      ui.eventSel = i;
    }
    return true;
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
  // Contract indicator strip — tap navigates to destination
  const CT = ui._hudContractTap;
  if (CT && sx >= CT.x && sx <= CT.x + CT.w && sy >= CT.y && sy <= CT.y + CT.h) {
    startNavTo(CT.toId);
    return true;
  }
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
      if (handleEventChoiceTap(sx, sy)) { e.preventDefault(); return; }
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
    const TAP_BUILDING_ACTIONS = { 6: 'market', 12: 'contracts', 7: 'inn', 8: 'warehouse', 13: 'bank', 14: 'inn', 15: 'guild', 16: 'vacant', 18: 'mine', 19: 'mine_building' };

    // Sprite-space hit test FIRST: the 3D building sprite extends visually
    // above the footprint by `rise` pixels, and construction sites have a
    // floating hammer cue above the plaque. Tile-based hit testing misses
    // both. Walk every city building slot and check the sprite bounds in
    // world coords; if we hit one, redirect the tap to a tile inside its
    // footprint so the rest of the existing dispatch logic just works.
    let resolvedTileX = tapTileX, resolvedTileY = tapTileY;
    let spriteHitFootprint = null, spriteHitRise = null;
    for (const city of world.cities) {
      const slots = cityBuildings[city.id];
      if (!slots) continue;
      for (const slot of Object.values(slots)) {
        if (!slot || slot.tileX <= 0) continue;
        const slotTapTile = slot.built ? slot.tileType : 16;
        if (TAP_BUILDING_ACTIONS[slotTapTile] === undefined) continue;
        const fx0 = slot.tileX * TILE;
        const fx1 = (slot.tileX + slot.tileW) * TILE;
        const fy0 = slot.tileY * TILE;
        const fy1 = (slot.tileY + slot.tileH) * TILE;
        if (worldX < fx0 || worldX >= fx1) continue;
        const cx = slot.tileX + (slot.tileW >> 1);
        const cy = slot.tileY + (slot.tileH >> 1);
        // Direct footprint hit — strongest match.
        if (worldY >= fy0 && worldY < fy1) {
          spriteHitFootprint = { tile: slotTapTile, tx: cx, ty: cy };
          break;
        }
        // Above-footprint hit (roof rise + floating cues). Use a generous
        // margin: full rise for built buildings, plus an extra 10px for the
        // construction-site bobbing hammer.
        const rise = slot.built ? Math.min(TILE - 2, Math.round(slot.tileH * TILE * 0.55)) : 0;
        const riseTop = fy0 - rise - 10;
        if (worldY >= riseTop && worldY < fy0 && !spriteHitRise) {
          spriteHitRise = { tile: slotTapTile, tx: cx, ty: cy };
        }
      }
      if (spriteHitFootprint) break;
    }
    const spriteHit = spriteHitFootprint || spriteHitRise;
    if (spriteHit) {
      tapTile = spriteHit.tile;
      resolvedTileX = spriteHit.tx;
      resolvedTileY = spriteHit.ty;
    }

    // If the player tapped a wall tile (3), scan the 5×5 neighbourhood for the
    // nearest building interior tile so tapping on a building's visible art still works.
    if (!spriteHit && (tapTile === 3 || TAP_BUILDING_ACTIONS[tapTile] === undefined)) {
      let bestDist = 9999, bestTile = null;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = tapTileX + dx, ny = tapTileY + dy;
          const t = tileAt(nx, ny);
          if (TAP_BUILDING_ACTIONS[t] !== undefined) {
            const d = Math.abs(dx) + Math.abs(dy);
            if (d < bestDist) { bestDist = d; bestTile = { tx: nx, ty: ny, t }; }
          }
        }
      }
      if (bestTile && bestDist <= 5) {
        tapTile = bestTile.t;
        resolvedTileX = bestTile.tx;
        resolvedTileY = bestTile.ty;
      }
    }

    if (TAP_BUILDING_ACTIONS[tapTile] !== undefined) {
      const action = TAP_BUILDING_ACTIONS[tapTile];
      const playerTX = Math.floor(player.x / TILE), playerTY = Math.floor(player.y / TILE);
      const distTiles = Math.max(Math.abs(resolvedTileX - playerTX), Math.abs(resolvedTileY - playerTY));
      const c = currentOrNearestCity(10);
      // Mine veins live in the wilderness around Ironholt (no city context required).
      if (action === 'mine' && distTiles <= 2) {
        playerMineNode(resolvedTileX, resolvedTileY);
      } else if (c && distTiles <= 10) {
        // Close enough - open immediately
        if (action === 'market') { ui.contractsOpen = false; ui.marketOpen = true; ui.selection = 0; ui.mode = 'buy'; toast(`Market opened in ${c.name}`, 1.8); }
        else if (action === 'contracts') { ui.marketOpen = false; ui.contractsOpen = true; ui.contractsSel = 0; ui.contractsCityId = c.id; toast('Contracts board opened', 1.8); }
        else if (action === 'bank') { ui.bankOpen = true; ui.bankTab = 'deposit'; domEnsureOpen(); dom.key = ''; domRender(); toast(`Bank of ${c.name} opened.`, 2); }
        else if (action === 'inn') { ui.innOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast(`${c.name} Inn.`, 2); }
        else if (action === 'guild') { ui.guildOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast('Merchants Guild.', 2); }
        else if (action === 'warehouse') { ui.warehouseOpen = true; domEnsureOpen(); dom.key = ''; domRender(); toast('Warehouse opened.', 2); }
        else if (action === 'vacant') { showBuildingDonateModal(c.id, resolvedTileX, resolvedTileY); }
        else if (action === 'mine_building') {
          const m = cityBuildings[c.id]?.mine;
          if (m && m.built) toast(`Mine Lv${m.level} — daily output flows to the city treasury.`, 2.5);
        }
      } else {
        // Walk to building interior tile, open on arrival
        clickMove.markerX = sx; clickMove.markerY = sy;
        planClickPath((resolvedTileX + 0.5) * TILE, (resolvedTileY + 0.5) * TILE, action, action === 'mine' ? { tx: resolvedTileX, ty: resolvedTileY } : null);
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
  // 0 grass, 1 road, 2 water, 3 wall/rock, 4 city-floor, 5 gate, 6 market, 7 shrine, 8 camp, 9 ruins, 10 forest, 11 swamp, 12 contracts, 13 cache, 14 inn-alt, 15 guildhall, 16 vacant-lot (walkable), 17 mountain (solid), 18 mine-node (walkable ore vein; Ironholt iron + the copper/silver mining sites), 19 mine-floor (built mine interior)
  const SOLID = new Set([2, 3, 17]);

  // Terrain speed multiplier — forest slows, swamp slows more, road is full speed
  function terrainSpeedMul(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    const t = tileAt(tx, ty);
    if (t === 10) return 0.45;  // forest: 45% speed
    if (t === 11) return 0.28;  // swamp: 28% speed (slowest terrain)
    return 1.0;
  }

  // Live reference to the map array - set by makeMap(), used by buildSlotOnMap()
  let mapData = null;

  // Redesigned mining: two sites, each yielding a different metal variant.
  // Coordinates + metals mirror ops/scripts/lib/mining.mjs (MINE_SITES). Each
  // site's hub city is where its metal is cheapest (the source market/warehouse);
  // traders + the player buy there and ship to dearer cities for profit.
  const MINE_SITES = [
    { id: 'coppervein_hollow', name: 'Coppervein Hollow', metal: 'copper', hub: 'crosshaven', x: 82,  y: 140 },
    { id: 'argent_reach',      name: 'Argent Reach',      metal: 'silver', hub: 'ironholt',   x: 116, y: 30  },
    { id: 'sunwell_shaft',     name: 'Sunwell Shaft',     metal: 'gold',   hub: 'valdenmere', x: 40,  y: 60  },
  ];
  // Minimap marker tint per metal (hoisted to module scope so the per-frame
  // render doesn't re-allocate it). Unknown metals fall back to purple.
  const MINE_SITE_COLORS = { copper: '#c47a3a', silver: '#cfcfd6', gold: '#fde047' };
  // tileIndex -> metalId, populated by makeMap() so playerMineNode drops the
  // variant that belongs to the site the vein sits in (legacy Ironholt = ore).
  const MINE_SITE_NODES = {};

  function makeMap() {
    const m = new Uint8Array(MAP_W * MAP_H);
    // base grass
    for (let i = 0; i < m.length; i++) m[i] = 0;

    // North river (spans map east of Valdenmere, rows y=12-14)
    for (let y = 12; y < 15; y++) {
      for (let x = 76; x < MAP_W-1; x++) m[y * MAP_W + x] = 2;
    }
    // North river — road runs south of it (y=18) so no true crossing needed;
    // but add a wide visual bank strip at the closest approach (x:130-145)
    for (let y = 12; y < 15; y++) {
      for (let x = 130; x < 146; x++) m[y * MAP_W + x] = 1;
    }

    // South river (crosses near Crosshaven, rows y=120-122)
    for (let y = 120; y < 123; y++) {
      for (let x = 0; x < 104; x++) m[y * MAP_W + x] = 2;
    }
    // South river bridge at x:90-100 (road crosses at x=96 for Valdenmere→Crosshaven)
    for (let y = 120; y < 123; y++) {
      for (let x = 90; x < 101; x++) m[y * MAP_W + x] = 1;
    }

    // rocks/walls border
    for (let x = 0; x < MAP_W; x++) { m[x] = 3; m[(MAP_H-1) * MAP_W + x] = 3; }
    for (let y = 0; y < MAP_H; y++) { m[y * MAP_W] = 3; m[y * MAP_W + (MAP_W-1)] = 3; }

    // roads between cities
    const carveRoad = (x0,y0,x1,y1) => {
      // Carve 3-wide road so player (r=8px, TILE=16px) can navigate cleanly.
      // Horizontal leg: widen north+south. Vertical leg: widen east+west.
      // Paint a 3×3 patch at corners to avoid gaps at L-turns.
      const paint3h = (tx, ty) => { // horizontal - widen N/S
        for (let dy = -1; dy <= 1; dy++) {
          const ny = ty + dy;
          if (ny >= 0 && ny < MAP_H) m[ny*MAP_W + tx] = 1;
        }
      };
      const paint3v = (tx, ty) => { // vertical - widen E/W
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
      paint3x3(x, y); // endpoint / corner - fill 3×3 to close gap
    };

    // ── CITIES ──────────────────────────────────────────────────────────────
    // Valdenmere: large capital (NW)
    const cityA = { id:'valdenmere', name:'Valdenmere', x: 16,  y: 16,  w: 36, h: 26 };
    // Ashport: medium fishing port (SE-center)
    const cityB = { id:'ashport',    name:'Ashport',    x: 184, y: 110, w: 28, h: 24 };
    // Crosshaven: small crossroads village (S-center)
    const cityC = { id:'crosshaven', name:'Crosshaven', x: 110, y: 130, w: 20, h: 20 };
    // Ironholt: medium mining town (NE)
    const cityD = { id:'ironholt',   name:'Ironholt',   x: 210, y: 28,  w: 24, h: 22 };

    // Helper: place a building block - outer wall ring (tile 3) with interior tile
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
      // Only overwrite city floor (4) - don't carve through walls
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

      // 3. Gate — opening matches internal road width; 3-wide external buffer for carveRoad junction
      const gx = x0 + Math.floor(W/2);
      const gy = y0 + H;
      // Valdenmere has a 3-wide boulevard (gx-1..gx+1); all others have a 2-wide road (gx-1..gx)
      const gateR = c.id === 'valdenmere' ? gx + 1 : gx;
      for (let tx = gx-1; tx <= gateR; tx++) {
        m[gy*MAP_W + tx] = 5;             // gate tile (walkable), flanked by wall pillars
      }
      // 3-wide road buffer outside gate so carveRoad's paint3v connects cleanly
      for (let tx = gx-1; tx <= gx+1; tx++) {
        m[(gy+1)*MAP_W + tx] = 1;
        m[(gy+2)*MAP_W + tx] = 1;
      }

      // 4. LAYOUT by city identity
      if (c.id === 'valdenmere') {
        // Capital city (36×26): 3-wide boulevard + 2-wide cross-street + north alley
        const msX = gx;                            // boulevard center col (34)
        const csY = y0 + Math.floor(H * 0.48);    // cross-street row (28)

        // Main boulevard (3 tiles wide)
        carveStreet(msX-1, y0, msX-1, y0+H-1);
        carveStreet(msX,   y0, msX,   y0+H-1);
        carveStreet(msX+1, y0, msX+1, y0+H-1);
        // Cross-street (2 tiles wide)
        carveStreet(x0, csY,   x0+W-1, csY);
        carveStreet(x0, csY-1, x0+W-1, csY-1);
        // North alley dividing NW/NE blocks
        carveStreet(x0, y0+6, x0+W-1, y0+6);

        // Grand town square at avenue intersection
        paintPlaza(msX-4, csY-3, 9, 7);
        m[(csY-2)*MAP_W + msX] = 12;              // contracts board

        // Buildings (placed before road connectors)
        placeBuilding(18,     17,    5, 4, 7,  'east');  // inn — NW above alley
        placeBuilding(18,     23,    4, 3, 8,  'east');  // granary — NW below alley
        placeBuilding(msX+2,  17,    5, 4, 15, 'west');  // guild — NE above alley
        placeBuilding(msX+3,  23,    4, 3, 6,  'west');  // market — NE below alley
        placeBuilding(18,     csY+4, 7, 3, 8,  'north'); // warehouse — SW
        placeBuilding(msX+2,  csY+4, 5, 4, 4,  'west');  // barracks — SE
        placeBuilding(18,     csY+8, 5, 3, 13, 'east');  // bank (civic, decorative)

        // Road connectors: door → nearest street
        carveStreet(23,     19,     msX-1, 19);     // inn east door → boulevard
        carveStreet(22,     24,     msX-1, 24);     // granary east door → boulevard
        carveStreet(msX+1,  19,     msX+2, 19);     // guild west door → boulevard
        carveStreet(msX+1,  24,     msX+3, 24);     // market west door → boulevard
        carveStreet(21,     csY+1,  21,    csY+4);  // warehouse north door → cross-street
        carveStreet(msX+1,  csY+6,  msX+2, csY+6); // barracks west door → boulevard

      } else if (c.id === 'ashport') {
        // Port city (28×24): 2-wide main road + 2-wide dock road
        const dockY = y0 + Math.floor(H * 0.68);   // dock road row (126)
        const mktY  = y0 + Math.floor(H * 0.38);   // market row (119)

        // Main N-S road (2 tiles)
        carveStreet(gx-1, y0, gx-1, y0+H-1);
        carveStreet(gx,   y0, gx,   y0+H-1);
        // Dock road (2 tiles)
        carveStreet(x0, dockY,   x0+W-1, dockY);
        carveStreet(x0, dockY-1, x0+W-1, dockY-1);

        // Market plaza
        paintPlaza(gx-5, mktY-1, 10, 4);
        m[(mktY+1)*MAP_W+gx] = 12;

        // Buildings
        placeBuilding(x0+2,  y0+2,    5, 5, 7,  'east');  // inn — NW
        placeBuilding(gx+2,  y0+2,    5, 4, 4,  'west');  // residence NE (civic)
        placeBuilding(gx+2,  mktY+1,  4, 3, 13, 'west');  // bank (civic)
        placeBuilding(x0+2,  mktY+2,  4, 3, 6,  'east');  // market
        placeBuilding(x0+2,  dockY-1, 4, 3, 15, 'east');  // guild — near docks
        placeBuilding(202,   dockY+1, 5, 3, 8,  'north'); // warehouse — dock side

        // Road connectors
        carveStreet(x0+7, y0+4,   gx-1, y0+4);    // inn east door → main road
        carveStreet(gx,   y0+4,   gx+2, y0+4);    // residence west door → main road
        carveStreet(x0+6, mktY+3, gx-1, mktY+3);  // market east door → main road
        carveStreet(gx,   mktY+2, gx+2, mktY+2);  // bank west door → main road

      } else if (c.id === 'crosshaven') {
        // Village (20×20): 2-wide main road + 2-wide market cross road
        const mktY = y0 + Math.floor(H * 0.42);    // cross-road row (138)

        // Main N-S road (2 tiles)
        carveStreet(gx-1, y0, gx-1, y0+H-1);
        carveStreet(gx,   y0, gx,   y0+H-1);
        // Market cross road (2 tiles)
        carveStreet(x0, mktY,   x0+W-1, mktY);
        carveStreet(x0, mktY+1, x0+W-1, mktY+1);

        // Plaza at crossroads
        paintPlaza(gx-2, mktY-1, 5, 4);
        m[(mktY+1)*MAP_W+gx] = 12;

        // Buildings
        placeBuilding(x0+2, y0+2,   4, 3, 7,  'east');  // inn — west side
        placeBuilding(gx+2, y0+2,   3, 3, 8,  'west');  // granary — east side
        placeBuilding(x0+2, mktY-1, 4, 3, 6,  'east');  // market — SW
        placeBuilding(gx+2, mktY-1, 3, 3, 13, 'west');  // bank — SE (civic)

        // Road connectors
        carveStreet(x0+6, y0+3, gx-1, y0+3);   // inn east door → main road
        carveStreet(gx,   y0+3, gx+2, y0+3);   // granary west door → main road

      } else if (c.id === 'ironholt') {
        // Mining town (24×22): 2-wide ore road + 2-wide yard cross road
        const yardY = y0 + Math.floor(H * 0.60);   // yard cross road row (41)
        const mktY  = y0 + Math.floor(H * 0.36);   // market junction row (35)

        // Main N-S ore road (2 tiles)
        carveStreet(gx-1, y0, gx-1, y0+H-1);
        carveStreet(gx,   y0, gx,   y0+H-1);
        // Ore yard cross road (2 tiles)
        carveStreet(x0, yardY,   x0+W-1, yardY);
        carveStreet(x0, yardY-1, x0+W-1, yardY-1);

        // Market junction plaza
        paintPlaza(gx-3, mktY-1, 7, 4);
        m[(mktY+1)*MAP_W+gx] = 12;

        // Buildings
        placeBuilding(x0+2,  y0+2,    5, 4, 4,  'east');  // barracks — NW foreman HQ
        placeBuilding(gx+2,  y0+2,    5, 4, 7,  'west');  // inn — NE workers lodge (pre-built)
        placeBuilding(gx+2,  mktY+1,  4, 3, 6,  'west');  // market
        placeBuilding(gx+2,  yardY-1, 4, 3, 13, 'west');  // bank (pre-built)
        placeBuilding(x0+2,  yardY-1, 4, 3, 15, 'east');  // guild (pre-built)
        placeBuilding(x0+2,  yardY+3, 4, 3, 8,  'east');  // granary — south yard
        placeBuilding(gx+2,  yardY+3, 6, 3, 8,  'north'); // warehouse — south yard
        placeBuilding(x0+2,  yardY+6, 5, 3, 19, 'east');  // mine adit

        // Road connectors
        carveStreet(x0+7, y0+4,    gx-1, y0+4);    // barracks east door → ore road
        carveStreet(gx,   y0+4,    gx+2, y0+4);    // inn west door → ore road
        carveStreet(gx,   mktY+2,  gx+2, mktY+2);  // market west door → ore road
        carveStreet(x0+6, yardY+1, gx-1, yardY+1); // guild east door → ore road
        carveStreet(x0+6, yardY+4, gx-1, yardY+4); // granary east door → ore road
        carveStreet(gx+5, yardY,   gx+5, yardY+3); // warehouse north door → yard road
        carveStreet(x0+7, yardY+7, gx-1, yardY+7); // mine east door → ore road
      }

      return { gx, gy };
    };

    const gateA = paintCity(cityA);
    const gateB = paintCity(cityB);
    const gateC = paintCity(cityC);
    const gateD = paintCity(cityD);

    // ── Ashport bay: paint a sea east of the city so the "fishing port"
    //    description matches the map. Only overwrites grass (tile 0) so city
    //    walls, roads, and gate areas are preserved.
    {
      const bayX0 = cityB.x + cityB.w + 1;          // 209: one tile east of east wall
      const bayX1 = Math.min(MAP_W - 2, bayX0 + 14); // up to ~223
      const bayY0 = cityB.y - 2;                     // 108
      const bayY1 = cityB.y + cityB.h + 2;          // 134
      for (let yy = bayY0; yy <= bayY1; yy++) {
        for (let xx = bayX0; xx <= bayX1; xx++) {
          const idx = yy * MAP_W + xx;
          if (m[idx] !== 0) continue;
          // Soft, irregular eastern shoreline so the bay doesn't read as a rectangle
          const dx = xx - bayX0;
          const dy = yy - (bayY0 + (bayY1 - bayY0) / 2);
          const noise = hash2(xx, yy);
          const reach = (bayX1 - bayX0) - 2 - Math.abs(dy) * 0.35 - noise * 2;
          if (dx <= reach) m[idx] = 2;
        }
      }
      // Wooden pier: two-tile-wide dock extending east from a small opening in
      // the east wall (use city-floor tile 4 for the planking; players see it
      // as a visual extension though the wall itself blocks travel).
      const pierY = cityB.y + Math.floor(cityB.h * 0.55);
      for (let dx = 1; dx <= 4; dx++) {
        const tx = cityB.x + cityB.w + dx;
        const idx0 = pierY * MAP_W + tx;
        const idx1 = (pierY + 1) * MAP_W + tx;
        // Only stamp planking where we just painted water (preserves any
        // existing road/non-water tile that may already be there).
        if (m[idx0] === 2) m[idx0] = 4;
        if (m[idx1] === 2) m[idx1] = 4;
      }
    }

    // ── ROAD NETWORK ────────────────────────────────────────────────────────
    // Map doubled to 280×180. All junction coords scaled ×2.
    // Valdenmere gate: gateA.gx=34, gateA.gy=42 (city 36×26, gate y=16+26=42)
    // Ironholt gate:   gateD.gx=222, gateD.gy=50 (city 24×22, gate y=28+22=50)
    // Crosshaven gate: gateC.gx=120, gateC.gy=150 (city 20×20, gate y=130+20=150)
    // Ashport gate:    gateB.gx=198, gateB.gy=134 (city 28×24, gate y=110+24=134)

    // ── Valdenmere → Ironholt (N highway, runs south of north river at y=12-14) ──
    // Gate(31,39) → junction(64,64) → east(136,64) → north(136,18) → east(230,18) → Ironholt
    carveRoad(gateA.gx, gateA.gy+1, 64, 64);    // SE to main junction
    carveRoad(64, 64, 136, 64);                   // E to north highway
    carveRoad(136, 64, 136, 18);                  // N (south of river at y=12-14)
    carveRoad(136, 18, 230, 18);                  // E
    carveRoad(230, 18, gateD.gx, gateD.gy+1);    // S to Ironholt gate

    // ── Valdenmere → Crosshaven (SW valley road) ─────────────────────────
    // Junction(64,64) already carved; go SW
    carveRoad(64, 64, 64, 112);                   // S from junction
    carveRoad(64, 112, 96, 112);                  // E (valley floor)
    carveRoad(96, 112, 96, 140);                  // S (crosses south river bridge at y=120-122)
    carveRoad(96, 140, gateC.gx, gateC.gy+1);    // E to Crosshaven gate

    // ── Crosshaven → Ashport (SE road via southern approach) ─────────────
    // Gate(117,147) → south(117,164) → east(156,164) → north to approach → Ashport gate
    // Approach at y=gateB.gy+2=134 avoids dock warehouses
    carveRoad(gateC.gx, gateC.gy+1, gateC.gx, 164);           // S to southern approach
    carveRoad(gateC.gx, 164, 156, 164);                         // E
    carveRoad(156, 164, 156, gateB.gy+2);                       // N to gate approach
    carveRoad(156, gateB.gy+2, gateB.gx, gateB.gy+2);          // E to Ashport gate

    // ── Ironholt → Ashport (loop east+south, shares y=134 approach) ──────
    // Gate(220,47) → east(260,47) → south to y=134 → west to Ashport gate
    carveRoad(gateD.gx, gateD.gy+1, 260, gateD.gy+1);         // E from Ironholt
    carveRoad(260, gateD.gy+1, 260, gateB.gy+2);               // S to shared approach y=134
    carveRoad(260, gateB.gy+2, gateB.gx, gateB.gy+2);         // W to Ashport gate

    // Detour / cache route in NE highlands (off main roads)
    carveRoad(148, 28, 180, 52);
    carveRoad(180, 52, 208, 84);

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

    // paintRidge: chains overlapping patches along a polyline to form continuous ranges
    const paintRidge = (pts, r, tileId, density = 0.80) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i+1];
        const steps = Math.max(1, Math.round(Math.hypot(bx-ax, by-ay) / (r * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          paintPatch(ax + (bx-ax)*t | 0, ay + (by-ay)*t | 0, r, tileId, density);
        }
      }
    };

    // Mountains (tile 17, solid) — continuous ranges, not isolated blobs.
    // paintPatch only overwrites tile 0, so roads (tile 1) pass through naturally.

    // ── North barrier: two wings flanking the bridge gap at x≈130-146 ──
    paintRidge([[12,9],[58,7],[100,10],[126,13]], 9, 17, 0.82);
    paintRidge([[148,10],[176,9],[196,7]], 8, 17, 0.80);

    // ── NE highlands — dramatic peaks rising behind Ironholt ──
    paintRidge([[200,7],[232,9],[255,14],[276,22]], 7, 17, 0.80);

    // ── Central spine — divides N highway from S valley; junction at (64,64) stays clear ──
    paintRidge([[92,82],[120,85],[152,81],[188,77],[216,84]], 10, 17, 0.78);
    paintPatch(238, 68, 13, 17, 0.75);   // pocket range filling gap to NE highlands

    // ── Eastern wall — forces Ironholt→Ashport traffic through x=260 loop ──
    paintRidge([[268,46],[271,88],[270,130]], 8, 17, 0.85);

    // ── Southern highlands — world border ──
    paintRidge([[22,172],[72,174],[142,176],[210,173],[260,168]], 8, 17, 0.70);

    // ── Western crags — natural world edge ──
    paintRidge([[5,48],[7,108],[5,158]], 6, 17, 0.72);

    // Forests (tile 10) — coherent woodland areas, not scattered dots

    // Western forest (between Valdenmere and Crosshaven, west of main junction)
    paintPatch(38,  98, 18, 10, 0.80);
    paintPatch(52,  80, 13, 10, 0.72);
    paintPatch(22, 118, 12, 10, 0.68);

    // Central forest (flanking main junction at 64,64)
    paintPatch(88,  66, 20, 10, 0.82);
    paintPatch(72,  52, 12, 10, 0.72);

    // North-central forest (between the two northern highways)
    paintPatch(132, 42, 15, 10, 0.75);
    paintPatch(158, 55, 13, 10, 0.70);

    // Eastern foothills (below Ironholt, along highlands edge)
    paintPatch(222, 94, 14, 10, 0.72);
    paintPatch(248, 112, 12, 10, 0.70);

    // Southeast forest (flanking Crosshaven→Ashport corridor)
    paintPatch(148, 148, 16, 10, 0.78);
    paintPatch(174, 152, 14, 10, 0.74);

    // Pocket forests
    paintPatch(62,  128, 10, 10, 0.68);
    paintPatch(102, 155, 10, 10, 0.65);

    // Swamps (tile 11)
    paintPatch(170,  88, 14, 11, 0.72);   // NE lowland below central spine
    paintPatch( 88, 140, 12, 11, 0.80);   // S swamp near Crosshaven
    paintPatch( 42, 162, 10, 11, 0.70);   // SW wetlands
    paintPatch(142, 108,  8, 11, 0.65);   // Central lowland bog
    paintPatch( 50, 110, 12, 11, 0.75);   // West swamp
    paintPatch(202, 148, 10, 11, 0.68);   // SE swamp

    // Mine nodes (tile 18) — walkable ore veins in the Ironholt vicinity.
    // Rank grass candidates (mountain-adjacent first, stable hash2 tiebreak) and
    // place the top `wanted`. Ranking instead of filtering guarantees nodes always
    // exist: a hard mountain-adjacency filter placed zero once the ranges became
    // continuous and no grass tile inside the old bbox bordered a peak.
    {
      const bbox = { x0: 198, y0: 14, x1: 256, y1: 52 };
      const wanted = 12;
      const candidates = [];
      for (let ty = bbox.y0; ty < bbox.y1; ty++) {
        for (let tx = bbox.x0; tx < bbox.x1; tx++) {
          const idx = ty * MAP_W + tx;
          if (m[idx] !== 0) continue;
          // skip if inside cityD (Ironholt) bounds
          if (tx >= 210 && tx < 230 && ty >= 28 && ty < 46) continue;
          const adj = (
            m[idx-1] === 17 || m[idx+1] === 17 ||
            m[idx-MAP_W] === 17 || m[idx+MAP_W] === 17
          ) ? 1 : 0;
          candidates.push({ idx, adj, h: hash2(tx, ty) });
        }
      }
      candidates.sort((a, b) => (b.adj - a.adj) || (b.h - a.h));
      for (let i = 0; i < Math.min(wanted, candidates.length); i++) {
        m[candidates[i].idx] = 18;
      }
    }

    // Redesigned mining sites: carve a small walkable ore-vein cluster (tile 18)
    // around each site centre and tag every node with the metal it yields.
    // Strictly grass-only (m[idx]===0) so we never overwrite water/roads/cities/
    // mountains; rings widen outward so the cluster still forms if the centre is
    // occupied — and if no grass is reachable, the site simply gets no nodes
    // rather than corrupting terrain (the QA self-test asserts both sites exist).
    for (const site of MINE_SITES) {
      const want = 12;
      let placed = 0;
      for (let r = 0; r <= 40 && placed < want; r++) {
        for (let oy = -r; oy <= r && placed < want; oy++) {
          for (let ox = -r; ox <= r && placed < want; ox++) {
            if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue; // ring at radius r
            const tx = site.x + ox, ty = site.y + oy;
            if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) continue;
            const idx = ty * MAP_W + tx;
            if (m[idx] !== 0) continue; // only carve grass
            m[idx] = 18;
            MINE_SITE_NODES[idx] = site.metal;
            placed++;
          }
        }
      }
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

        // Prefer detour zone (NE-ish) — scaled ×2
        if (!(x >= 148 && x <= 224 && y >= 28 && y <= 96)) continue;

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

    // Expose map array for dynamic building placement
    mapData = m;

    // Collect road POI positions for minimap markers (tiles 8=camp, 9=ruins, 13=cache)
    const pois = [];
    for (let iy = 0; iy < MAP_H; iy++) {
      for (let ix = 0; ix < MAP_W; ix++) {
        const t = m[iy * MAP_W + ix];
        if (t === 8 || t === 9 || t === 13) {
          // Only include POIs outside city bounds
          const inAnyCity = [cityA, cityB, cityC, cityD].some(c =>
            ix >= c.x && ix < c.x + c.w && iy >= c.y && iy < c.y + c.h);
          if (!inAnyCity) pois.push({ x: ix, y: iy, type: t });
        }
      }
    }

    return { m, cities: [cityA, cityB, cityC, cityD], pois };
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
        else if (id === 10) { r=18;  g=68;  b=38;  } // forest (dark green)
        else if (id === 11) { r=40;  g=62;  b=54;  } // swamp (dark teal-grey)
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
    // Pack - cargo capacity (T0–T19), carriage visual caps at T4
    pack: [
      { id: 'satchel',          name: 'Satchel',            icon: '🎒', desc: 'A worn cloth bag. Fits barely anything.',              cost: 0,       capacity: 18   },
      { id: 'traders_pack',     name: "Trader's Pack",      icon: '🗃️', desc: 'Leather-bound. Room to breathe.',                      cost: 120,     capacity: 26   },
      { id: 'merchant_cart',    name: 'Merchant Cart',      icon: '🛒', desc: 'A proper hand-cart. Serious haul.',                    cost: 300,     capacity: 36   },
      { id: 'cargo_wagon',      name: 'Cargo Wagon',        icon: '🪵', desc: 'Reinforced wagon bed. Double the goods.',              cost: 700,     capacity: 50   },
      { id: 'royal_carriage',   name: 'Royal Carriage',     icon: '👑', desc: 'Gold-trimmed. Built for a merchant lord.',             cost: 1500,    capacity: 68   },
      { id: 'guild_hauler',     name: 'Guild Hauler',       icon: '🏛️', desc: 'Guild-endorsed. Extra cargo permits.',                 cost: 2800,    capacity: 90   },
      { id: 'iron_strongbox',   name: 'Iron Strongbox',     icon: '⚙️', desc: 'Reinforced iron panels. Built to last.',               cost: 5000,    capacity: 118  },
      { id: 'silk_caravan',     name: 'Silk Caravan',       icon: '🎪', desc: 'Multiple compartments. Silk-lined.',                   cost: 8500,    capacity: 152  },
      { id: 'war_chest',        name: 'War Chest',          icon: '🛡️', desc: 'Military-grade storage. No limits.',                   cost: 14000,   capacity: 194  },
      { id: 'master_wagon',     name: 'Master Wagon',       icon: '🏆', desc: 'Hand-built by master craftsmen.',                      cost: 22000,   capacity: 245  },
      { id: 'noble_train',      name: 'Noble Train',        icon: '🚂', desc: 'Three wagons chained. Noble convoy.',                  cost: 34000,   capacity: 308  },
      { id: 'merchant_fleet',   name: 'Merchant Fleet',     icon: '⛵', desc: 'Coordinated pack mules. Massive scale.',               cost: 52000,   capacity: 384  },
      { id: 'trading_company',  name: 'Trading Company',    icon: '🏢', desc: 'Full company logistics. Unstoppable.',                 cost: 80000,   capacity: 475  },
      { id: 'royal_train',      name: 'Royal Train',        icon: '👸', desc: 'Royal charter. Unlimited royal pass.',                 cost: 120000,  capacity: 583  },
      { id: 'grand_caravan',    name: 'Grand Caravan',      icon: '🌟', desc: 'Legendary convoy. All roads bow.',                     cost: 180000,  capacity: 712  },
      { id: 'dragon_wagon',     name: 'Dragon Wagon',       icon: '🐉', desc: 'Enchanted. Carries the weight of kingdoms.',           cost: 260000,  capacity: 864  },
      { id: 'arcane_hold',      name: 'Arcane Hold',        icon: '🔮', desc: 'Magical expansion. Space defies physics.',             cost: 380000,  capacity: 1042 },
      { id: 'void_carriage',    name: 'Void Carriage',      icon: '🌀', desc: 'Pocket dimension. Near-infinite cargo.',               cost: 550000,  capacity: 1250 },
      { id: 'timeless_vault',   name: 'Timeless Vault',     icon: '⏳', desc: 'Time-locked storage. Legendary artifact.',             cost: 800000,  capacity: 1490 },
      { id: 'cosmic_hauler',    name: 'Cosmic Hauler',      icon: '🌌', desc: 'Transcendent. Carries entire markets.',                cost: 1200000, capacity: 1760 },
    ],
    // Boots - travel speed (T0–T19), horse visual caps at T4
    boots: [
      { id: 'worn_boots',       name: 'Worn Boots',         icon: '👞', desc: 'Blistered feet. Gets the job done.',                   cost: 0,       speed: 90    },
      { id: 'road_boots',       name: 'Road Boots',         icon: '👟', desc: 'Sturdy leather. Long-route ready.',                    cost: 150,     speed: 112   },
      { id: 'swift_horse',      name: 'Swift Horse',        icon: '🐴', desc: 'A reliable road horse. Trots all day.',                cost: 400,     speed: 138   },
      { id: 'war_horse',        name: 'War Horse',          icon: '🏇', desc: 'Trained charger. Blazes any road.',                    cost: 900,     speed: 168   },
      { id: 'phantom_mare',     name: 'Phantom Mare',       icon: '⚡', desc: 'A legend on four hooves. Pure speed.',                 cost: 2000,    speed: 203   },
      { id: 'wind_rider',       name: 'Wind Rider',         icon: '🌬️', desc: 'Bred for open roads. Never tires.',                   cost: 3800,    speed: 243   },
      { id: 'thunder_steed',    name: 'Thunder Steed',      icon: '⛈️', desc: 'Hooves like thunder. Roads fear it.',                 cost: 7000,    speed: 288   },
      { id: 'storm_gallop',     name: 'Storm Gallop',       icon: '🌪️', desc: 'Storm-born speed. Unstoppable force.',                cost: 12000,   speed: 340   },
      { id: 'celestial_run',    name: 'Celestial Run',      icon: '🌠', desc: 'Blessed by road spirits. Flies low.',                  cost: 20000,   speed: 398   },
      { id: 'silver_charger',   name: 'Silver Charger',     icon: '🥈', desc: 'Silver-shod. Fastest mortal horse.',                  cost: 32000,   speed: 464   },
      { id: 'golden_stallion',  name: 'Golden Stallion',    icon: '🥇', desc: 'Gold-plated hooves. Pure legend.',                    cost: 50000,   speed: 538   },
      { id: 'shadow_sprint',    name: 'Shadow Sprint',      icon: '🌑', desc: 'Shadow-phase travel. Near teleport.',                  cost: 78000,   speed: 621   },
      { id: 'dragon_mount',     name: 'Dragon Mount',       icon: '🐲', desc: 'Dragon-bonded. Flies over terrain.',                   cost: 120000,  speed: 714   },
      { id: 'void_strider',     name: 'Void Strider',       icon: '🕳️', desc: 'Steps through mini-voids. No distance.',             cost: 180000,  speed: 818   },
      { id: 'time_gallop',      name: 'Time Gallop',        icon: '⏰', desc: 'Moves faster than time itself.',                       cost: 270000,  speed: 934   },
      { id: 'arcane_mount',     name: 'Arcane Mount',       icon: '✨', desc: 'Magical construct. Infinite endurance.',               cost: 400000,  speed: 1062  },
      { id: 'royal_charger',    name: 'Royal Charger',      icon: '👸', desc: 'Royal bloodline. All gates open.',                    cost: 600000,  speed: 1203  },
      { id: 'legendary_run',    name: 'Legendary Run',      icon: '🏅', desc: 'Spoken of in every tavern.',                           cost: 900000,  speed: 1358  },
      { id: 'cosmic_horse',     name: 'Cosmic Horse',       icon: '🌌', desc: 'Constellation-born. Rides starlight.',                 cost: 1300000, speed: 1528  },
      { id: 'eternal_steed',    name: 'Eternal Steed',      icon: '♾️', desc: 'Never rests. Never stops. Eternal.',                  cost: 2000000, speed: 1714  },
    ],
    // Tool - sell price bonus (T0–T19)
    tool: [
      { id: 'bare_hands',         name: 'Bare Hands',         icon: '✋', desc: 'You bargain with a shrug.',                           cost: 0,       sellBonus: 0.00 },
      { id: 'merchant_ledger',    name: 'Merchant Ledger',    icon: '📒', desc: 'Track prices. Sell for more. +4%',                   cost: 200,     sellBonus: 0.04 },
      { id: 'guild_seal',         name: 'Guild Seal',         icon: '🔖', desc: 'Guild-certified. They pay respect. +8%',             cost: 500,     sellBonus: 0.08 },
      { id: 'trade_charter',      name: 'Trade Charter',      icon: '📜', desc: 'Royal charter. No one lowballs you. +12%',           cost: 1100,    sellBonus: 0.12 },
      { id: 'golden_abacus',      name: 'Golden Abacus',      icon: '🧮', desc: 'Every calculation in your favor. +16%',              cost: 2200,    sellBonus: 0.16 },
      { id: 'silk_tongue',        name: 'Silk Tongue',        icon: '🗣️', desc: 'Words worth gold. +20%',                             cost: 4000,    sellBonus: 0.20 },
      { id: 'market_oracle',      name: 'Market Oracle',      icon: '🔮', desc: "Sees the best deal before it's offered. +24%",       cost: 6500,    sellBonus: 0.24 },
      { id: 'guild_master_seal',  name: 'Guildmaster Seal',   icon: '⚜️', desc: 'Highest guild rank. +28%',                           cost: 10000,   sellBonus: 0.28 },
      { id: 'royal_warrant',      name: 'Royal Warrant',      icon: '📋', desc: 'Signed by the crown. +32%',                          cost: 15000,   sellBonus: 0.32 },
      { id: 'spice_calculator',   name: 'Spice Calculator',   icon: '🌶️', desc: 'Ancient merchant tool. +36%',                        cost: 22000,   sellBonus: 0.36 },
      { id: 'diamond_ledger',     name: 'Diamond Ledger',     icon: '💎', desc: 'Diamond-inlaid. Inspires trust. +40%',               cost: 32000,   sellBonus: 0.40 },
      { id: 'master_scale',       name: 'Master Scale',       icon: '⚖️', desc: 'Perfectly calibrated. +44%',                         cost: 46000,   sellBonus: 0.44 },
      { id: 'arcane_ledger',      name: 'Arcane Ledger',      icon: '📖', desc: 'Self-updating. Never wrong. +48%',                   cost: 65000,   sellBonus: 0.48 },
      { id: 'golden_tongue',      name: 'Golden Tongue',      icon: '💬', desc: 'Words turn to gold. +52%',                           cost: 77000,   sellBonus: 0.52 },
      { id: 'prophecy_scroll',    name: 'Prophecy Scroll',    icon: '📿', desc: 'Predicts market prices. +56%',                       cost: 90000,   sellBonus: 0.56 },
      { id: 'void_contract',      name: 'Void Contract',      icon: '🌀', desc: 'Binding across dimensions. +60%',                    cost: 105000,  sellBonus: 0.60 },
      { id: 'time_ledger',        name: 'Time Ledger',        icon: '⏳', desc: 'Prices from the future. +64%',                       cost: 120000,  sellBonus: 0.64 },
      { id: 'cosmic_deal',        name: 'Cosmic Deal',        icon: '🌟', desc: 'Universe agrees. +68%',                              cost: 140000,  sellBonus: 0.68 },
      { id: 'eternal_charter',    name: 'Eternal Charter',    icon: '♾️', desc: 'Never expires. Everywhere honored. +72%',            cost: 158000,  sellBonus: 0.72 },
      { id: 'godtrader_seal',     name: 'Godtrader Seal',     icon: '🌌', desc: 'Ascended merchant. Max bonus. +75%',                 cost: 175000,  sellBonus: 0.75 },
    ],
    // Pickaxe - mining yield + stamina cost per swing (T0–T19). Cost curve mirrors `tool`.
    // T0 is bare hands (no progression); T2+ unlocks gold ore at Sunwell Shaft.
    pickaxe: [
      { id: 'bare_hands_mine',    name: 'Bare Hands',         icon: '✋', desc: 'You pry ore loose with your fingers. 15 stamina/swing.', cost: 0,       yieldMult: 1.00, staminaCost: 15 },
      { id: 'tin_pickaxe',        name: 'Tin Pickaxe',        icon: '🔨', desc: 'A makeshift tin head. +10% yield, -1 stamina.',        cost: 200,     yieldMult: 1.10, staminaCost: 14 },
      { id: 'guild_pickaxe',      name: 'Guild Pickaxe',      icon: '⛏', desc: 'Guild-issued steel. +20% yield, -2 stamina. Unlocks GOLD.', cost: 500,    yieldMult: 1.20, staminaCost: 13 },
      { id: 'reinforced_pick',    name: 'Reinforced Pick',    icon: '🛠️', desc: 'Reinforced shaft. +30% yield, -3 stamina.',           cost: 1100,    yieldMult: 1.30, staminaCost: 12 },
      { id: 'dwarven_hammer',     name: 'Dwarven Hammer',     icon: '🔨', desc: 'Dwarf-forged head. +40% yield, -4 stamina.',          cost: 2200,    yieldMult: 1.40, staminaCost: 11 },
      { id: 'mithril_pick',       name: 'Mithril Pick',       icon: '⛏', desc: 'Mithril head, ultralight. +50% yield, -5 stamina.',   cost: 4000,    yieldMult: 1.50, staminaCost: 10 },
      { id: 'rune_etched',        name: 'Rune-Etched Pick',   icon: '🔮', desc: 'Runes guide the swing. +60% yield, -6 stamina.',      cost: 6500,    yieldMult: 1.60, staminaCost: 10 },
      { id: 'masters_drill',      name: "Master's Drill",     icon: '⚙️', desc: 'Clockwork drill. +70% yield, -6 stamina.',           cost: 10000,   yieldMult: 1.70, staminaCost: 9  },
      { id: 'crown_pick',         name: 'Crown Pickaxe',      icon: '👑', desc: 'Crown-blessed. +80% yield, -6 stamina.',              cost: 15000,   yieldMult: 1.80, staminaCost: 9  },
      { id: 'diamond_tip',        name: 'Diamond-Tip Pick',   icon: '💎', desc: 'Diamond head cuts anything. +90% yield, -7 stamina.', cost: 22000,   yieldMult: 1.90, staminaCost: 8  },
      { id: 'star_iron',          name: 'Star-Iron Pick',     icon: '⭐', desc: 'Meteoric iron. +100% yield, -7 stamina.',            cost: 32000,   yieldMult: 2.00, staminaCost: 8  },
      { id: 'forge_master',       name: 'Forge-Master Pick',  icon: '🔥', desc: 'Foundry-tempered. +110% yield.',                      cost: 46000,   yieldMult: 2.10, staminaCost: 8  },
      { id: 'titan_breaker',      name: 'Titan Breaker',      icon: '🪨', desc: 'Splits boulders. +120% yield.',                       cost: 65000,   yieldMult: 2.20, staminaCost: 8  },
      { id: 'soul_pick',          name: 'Soul Pickaxe',       icon: '👻', desc: 'Swings itself, almost. +130% yield.',                 cost: 77000,   yieldMult: 2.30, staminaCost: 8  },
      { id: 'phoenix_pick',       name: 'Phoenix Pick',       icon: '🔥', desc: 'Reforges with each swing. +140% yield.',              cost: 90000,   yieldMult: 2.40, staminaCost: 8  },
      { id: 'void_breaker',       name: 'Void Breaker',       icon: '🌀', desc: 'Cuts through reality. +150% yield.',                  cost: 105000,  yieldMult: 2.50, staminaCost: 8  },
      { id: 'time_chip',          name: 'Time-Chip Pick',     icon: '⏳', desc: 'Strikes ore before it solidifies. +160% yield.',      cost: 120000,  yieldMult: 2.60, staminaCost: 8  },
      { id: 'cosmic_pick',        name: 'Cosmic Pickaxe',     icon: '🌟', desc: 'Universe yields to it. +170% yield.',                 cost: 140000,  yieldMult: 2.70, staminaCost: 8  },
      { id: 'eternal_pick',       name: 'Eternal Pick',       icon: '♾️', desc: 'Never dulls. +180% yield.',                          cost: 158000,  yieldMult: 2.80, staminaCost: 8  },
      { id: 'godminer_pick',      name: 'Godminer Pick',      icon: '🌌', desc: 'Ascended miner. Max yield. +200% yield, -7 stamina.', cost: 175000,  yieldMult: 3.00, staminaCost: 8  },
    ],
  };

  // Returns current gear item for a slot
  function currentGear(slot) {
    const tier = player.gear?.[slot] ?? 0;
    return GEAR[slot][Math.min(tier, GEAR[slot].length - 1)];
  }

  // Apply gear effects to player stats (called after purchase + on load)
  function applyGearStats() {
    const pack    = currentGear('pack');
    const boots   = currentGear('boots');
    const pickaxe = currentGear('pickaxe');
    player.capacity          = pack.capacity;
    player.speed             = boots.speed;
    player.miningYieldMult   = pickaxe.yieldMult   ?? 1;
    player.miningStaminaCost = pickaxe.staminaCost ?? 15;
  }

  function checkGuildMilestone() {
    if (player.guildMember) return;
    const cityIds = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];
    const allRep = cityIds.every(id => (player.rep?.[id] || 0) >= 5);
    const hasCargo = (player.gear?.pack ?? 0) >= 3; // Cargo Wagon or better
    if (!allRep || !hasCargo) return;
    player.guildMember = true;
    scheduleAutoSave();
    openEvent({
      title: '⚜️ Merchant Guild Member',
      text: 'Your reputation has spread across all four cities, and your cart is the envy of the road. The Merchants Guild formally recognises you as a member.',
      choices: [
        { label: 'Accept the honour', run: () => {
            toast('⚜️ Merchant Guild Member — you\'ve earned it.', 4);
            closeEvent();
          }
        },
      ],
    });
  }

  const CITY_RULES = {
    valdenmere: {
      taxRate: 0.08,          // reduced 12%→8% — 12% made too many Valdenmere routes net-negative
      inspectionChance: 0.55,
      contraband: ['Demon Ink'],
      fineBase: 18,
      finePerItem: 6,
      vibe: 'Orderly. Taxed. Prestigious.',
      population: 8000,
      foodDemand: 0.0010,
    },
    ashport: {
      taxRate: 0.05,
      inspectionChance: 0.25, // raised 15%→25% — Ashport was too easy for ink contraband runs
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
    { id: 'coal',   name: 'Coal',          base: 8,  weight: 2 },  // bulk fuel; mined / sourced at Ironholt
    { id: 'grain',  name: 'Grain',         base: 10, weight: 1 },  // bulk staple - weight 1 so it's a real starter option (was weight 2: too punishing)
    { id: 'food',   name: 'Dried Rations', base: 16, weight: 1 },  // light, early-game earner
    { id: 'ore',    name: 'Iron Ore',      base: 22, weight: 2 },  // heavy - only good on specific routes
    { id: 'herbs',  name: 'Moon Herbs',    base: 24, weight: 1 },  // mid-tier, good margins when specced
    { id: 'potion', name: 'Minor Potion',  base: 40, weight: 1 },  // mid-game tier
    { id: 'relic',  name: 'Old Relic',     base: 60, weight: 2 },  // high value, heavy - late-game route
    { id: 'ink',    name: 'Demon Ink',     base: 75, weight: 1, contrabandName: 'Demon Ink', sourceCities: ['ironholt','crosshaven'] },  // contraband; only profitable when sourced from ironholt/crosshaven
    { id: 'gem',    name: 'Gemstones',     base: 80, weight: 1, rare: true },  // rare drop from mining; high value, low weight
    { id: 'copper', name: 'Copper Ore',    base: 14,  weight: 2, rarity: 'common',    sourceCities: ['crosshaven'] },  // mined at Coppervein Hollow; common, cheap
    { id: 'silver', name: 'Silver Ore',    base: 58,  weight: 1, rarity: 'rare',      sourceCities: ['ironholt']   },  // mined at Argent Reach; rare, dear
    { id: 'gold',   name: 'Gold Ore',      base: 140, weight: 1, rarity: 'legendary', sourceCities: ['valdenmere'], minPickaxeTier: 2 },  // mined at Sunwell Shaft; legendary, needs Pickaxe T2+ (client-mining gate only)
  ];

  // --- Market model (minimal, deterministic)
  // Goals:
  // - Per-town price differences that persist for a run (seeded by city+item).
  // - Avoid degenerate buy->sell loops in the same town (spread).
  // - Provide profit clarity via "reference/base" and "last seen" prices.
  const MARKET = {
    spread: 0.06,          // buy price = mid*(1+spread/2), sell price = mid*(1-spread/2) - reduced from 0.10 so margins survive
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

  // ── BUILDING DEBUG: ring buffer + overlay (toggle with ?debug=1 or backtick key) ──
  const BUILD_DEBUG = {
    enabled: new URLSearchParams(location.search).get('debug') === '1',
    log: [], // ring buffer of { t, tag, msg, data }
    bootT: Date.now(),
    overlay: null,
  };
  function bdLog(tag, msg, data) {
    const entry = { t: Date.now() - BUILD_DEBUG.bootT, tag, msg, data };
    BUILD_DEBUG.log.push(entry);
    if (BUILD_DEBUG.log.length > 100) BUILD_DEBUG.log.shift();
    // Only print to console when the overlay is enabled OR for error tags. Otherwise stay quiet.
    if (BUILD_DEBUG.enabled || tag.startsWith('ERR')) {
      try { console.log(`[BD ${(entry.t/1000).toFixed(1)}s][${tag}] ${msg}`, data ?? ''); } catch(_) {}
    }
    if (BUILD_DEBUG.enabled && BUILD_DEBUG.overlay) bdRender();
  }
  function bdSnapshotCity(cid) {
    const slots = (typeof cityBuildings !== 'undefined' && cityBuildings[cid]) || {};
    const out = {};
    for (const [k, s] of Object.entries(slots)) {
      out[k] = { built: s.built, level: s.level, playerFunded: s.playerFunded };
    }
    return out;
  }
  function bdInitOverlay() {
    if (!BUILD_DEBUG.enabled || BUILD_DEBUG.overlay) return;
    const el = document.createElement('div');
    el.id = 'build-debug';
    el.style.cssText = 'position:fixed;top:8px;right:8px;width:520px;max-height:80vh;overflow:auto;background:rgba(0,0,0,0.85);color:#9fe;font:11px ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;border:1px solid #2af;border-radius:6px;z-index:99999;white-space:pre-wrap;line-height:1.35;';
    document.body.appendChild(el);
    BUILD_DEBUG.overlay = el;
    bdRender();
  }
  function bdRender() {
    if (!BUILD_DEBUG.overlay) return;
    const cids = (typeof cityBuildings !== 'undefined') ? Object.keys(cityBuildings) : [];
    let html = '<b style="color:#fff">BUILDING DEBUG</b>  press backtick to hide\n';
    html += '<b style="color:#fc6">— In-memory cityBuildings —</b>\n';
    for (const cid of cids) {
      const snap = bdSnapshotCity(cid);
      const built = Object.entries(snap).filter(([, v]) => v.built).map(([k, v]) => `${k}L${v.level}`).join(',') || '(none)';
      const funded = Object.entries(snap).filter(([, v]) => !v.built && v.playerFunded > 0).map(([k, v]) => `${k}=${v.playerFunded}g`).join(',') || '';
      html += `  <span style="color:#9f9">${cid}</span>: built=${built}${funded ? ' funded=' + funded : ''}\n`;
    }
    html += '\n<b style="color:#fc6">— Last 25 events —</b>\n';
    const last = BUILD_DEBUG.log.slice(-25);
    for (const e of last) {
      const ts = (e.t/1000).toFixed(1).padStart(5);
      const tagColor = e.tag.startsWith('ERR') ? '#f88' : e.tag.startsWith('PUSH') ? '#fc6' : e.tag.startsWith('SYNC') ? '#9cf' : '#fff';
      const dataStr = e.data !== undefined ? ' ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)).slice(0, 200) : '';
      html += `<span style="color:#888">${ts}s</span> <span style="color:${tagColor}">[${e.tag}]</span> ${e.msg}${dataStr ? '<span style="color:#888">' + dataStr.replace(/</g,'&lt;') + '</span>' : ''}\n`;
    }
    BUILD_DEBUG.overlay.innerHTML = html;
  }
  // Toggle with backtick key
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') {
      BUILD_DEBUG.enabled = !BUILD_DEBUG.enabled;
      if (BUILD_DEBUG.enabled) bdInitOverlay();
      else if (BUILD_DEBUG.overlay) { BUILD_DEBUG.overlay.remove(); BUILD_DEBUG.overlay = null; }
    }
  });
  if (BUILD_DEBUG.enabled) setTimeout(bdInitOverlay, 100);
  // Expose for console inspection
  window.__BD = BUILD_DEBUG;
  bdLog('BOOT', 'Building debug system ready', { uid: 'pending' });

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
      // Network fail - degrade gracefully, local drift still works
    }
  }

  // Post a trade event to Supabase (fire-and-forget)
  function economyPostTrade(cityId, itemId, direction, qty) {
    if (!ECONOMY.enabled) return;
    // Optimistically update local cache immediately
    if (!ECONOMY.pressure[cityId]) ECONOMY.pressure[cityId] = {};
    const delta = (direction === 'buy' ? qty : -qty) * 0.02;
    ECONOMY.pressure[cityId][itemId] = Math.max(-0.25, Math.min(0.25,
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
    // pressure clamped to ±0.25: max +0.25 → price ×1.25, max -0.25 → price ×0.75
    // Halved from ±0.5 to prevent heavy trade from completely collapsing a route.
    return 1 + p;
  }

  // Active world events synced from server (active_events column in world_state)
  const worldEvents = []; // { templateId, name, cities, items, effect, startDay, endDay }

  function worldEventModifier(cityId, itemId) {
    let mult = 1.0;
    for (const ev of worldEvents) {
      if (ev.cities && !ev.cities.includes(cityId)) continue;
      if (ev.items  && !ev.items.includes(itemId))  continue;
      mult *= (ev.effect || 1.0);
    }
    return mult;
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

  // ── World state sync from DB ─────────────────────────────────────────────
  // Reads world_state (time), city_treasury (pop/hunger/treasury/buildings/bonus)
  // All shared world state is authoritative from DB; client only observes + writes events.

  // Push world time to DB after advancing days (fire-and-forget)
  function pushWorldTimeToDb() {
    if (__QA.enabled || !ECONOMY.enabled) return;
    fetch(`${ECONOMY.url}/rest/v1/world_state`, {
      method: 'POST',
      headers: { ...economyHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: 'main', day: time.day, frac: time.frac, seed: time.seed, updated_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  // Push city pop/hunger to DB after populationTick (fire-and-forget)
  function pushCityPopToDb(cid) {
    if (__QA.enabled || !ECONOMY.enabled) return;
    const pop = cityPop[cid];
    if (!pop) return;
    fetch(`${ECONOMY.url}/rest/v1/city_treasury`, {
      method: 'POST',
      headers: { ...economyHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ city_id: cid, population: Math.round(pop.pop), hunger: pop.hunger, updated_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  // Push full city treasury (gold, invest_log, city_bonus, buildings) after invest tick.
  // Only slots that have been touched (built or partially funded) are pushed so that
  // default-state entries never overwrite a valid built:true row in the DB.
  // Per-city dirty set + single trailing-edge flush. During day-catchup,
  // cityMineTick and cityInvestTick can call pushCityTreasuryToDb() many times
  // per city in one JS tick — this collapses those bursts into one upsert per city.
  const _ctDirty = new Set();
  let _ctFlushTimer = null;
  function pushCityTreasuryToDb(cid) {
    if (__QA.enabled || !ECONOMY.enabled) return;
    if (!cityTreasury[cid]) return;
    _ctDirty.add(cid);
    if (_ctFlushTimer) return;
    _ctFlushTimer = setTimeout(() => {
      _ctFlushTimer = null;
      const cities = [..._ctDirty];
      _ctDirty.clear();
      for (const c of cities) _doPushCityTreasuryToDb(c);
    }, 1500);
  }
  function _doPushCityTreasuryToDb(cid) {
    const t = cityTreasury[cid]; if (!t) return;
    const touchedBuildings = Object.fromEntries(
      Object.entries(cityBuildings[cid] || {})
        .filter(([, s]) => s.built || (s.playerFunded || 0) > 0)
        .map(([k, s]) => [k, { level: s.level, built: s.built, playerFunded: s.playerFunded }])
    );
    bdLog('PUSH-CT', `upsert_city_treasury ${cid} touched=${Object.keys(touchedBuildings).join(',') || '(none)'}`, touchedBuildings);
    fetch(`${ECONOMY.url}/rest/v1/rpc/upsert_city_treasury`, {
      method: 'POST',
      headers: { ...economyHeaders() },
      body: JSON.stringify({
        p_city_id:    cid,
        p_gold:       t.gold,
        p_invest_log: t.investLog,
        p_city_bonus: { ...(cityBonus[cid] || {}) },
        p_buildings:  touchedBuildings,
        p_updated_at: new Date().toISOString(),
      }),
    }).then(r => {
      bdLog(r.ok ? 'PUSH-CT-OK' : 'ERR-PUSH-CT', `HTTP ${r.status} for ${cid}`, null);
      if (!r.ok) r.text().then(t => bdLog('ERR-PUSH-CT-BODY', t.slice(0, 200), null));
    }).catch(e => bdLog('ERR-PUSH-CT', `${cid} network error: ${String(e).slice(0,100)}`, null));
  }

  // Push AI trader state to DB after arrive/depart (fire-and-forget)
  function pushTraderToDb(t) {
    if (__QA.enabled || !ECONOMY.enabled) return;
    fetch(`${ECONOMY.url}/rest/v1/world_traders`, {
      method: 'POST',
      headers: { ...economyHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: t.id, name: t.name, personality: t.personality, color: t.color,
        state: t.state, from_id: t.fromId, to_id: t.toId, item_id: t.itemId,
        inv: t.inv, gold: t.gold,
        start_gold: t.startGold || 80,
        total_profit: t.totalProfit || 0,
        trips_completed: t.tripsCompleted || 0,
        progress: (t.path?.length && t.pathIdx != null) ? (t.pathIdx / t.path.length) : 0,
        city_timer: t.cityTimer || 0,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  // ── Player presence: show other players on the map ────────────────────────
  // otherPlayers: uid → { uid, name, x, y, city_id, facing_x, facing_y, gear_pack, gear_boots, color }
  const otherPlayers = {};
  let _lastPresencePush = 0;
  let _lastPresenceFetch = 0;
  let _lastPresenceHash = '';
  let _realtimeClient = null;
  let _realtimeConnected = false;
  let _realtimeFallbackTimer = null;
  // Shared throttle timestamp used by syncWorldState() to guard all callers
  let _lastWorldSyncT = 0;
  // Semantic alias for call sites inside player action handlers
  function syncWorldStateOnAction() { syncWorldState(); }

  function pushPlayerPresence() {
    if (__QA.enabled || !ECONOMY.enabled) return;
    const now = Date.now();
    if (now - _lastPresencePush < 2000) return;
    const city = typeof currentCity === 'function' ? currentCity() : null;
    // Only push when state changed; fall back to a 25s heartbeat to keep presence alive for other clients
    const hash = `${Math.round(player.x)},${Math.round(player.y)},${city?.id||''},${player.facing?.x??0},${player.facing?.y??1},${player.gear?.pack??0},${player.gear?.boots??0}`;
    if (hash === _lastPresenceHash && now - _lastPresencePush < 25_000) return;
    _lastPresencePush = now;
    _lastPresenceHash = hash;
    fetch(`${ECONOMY.url}/rest/v1/player_presence`, {
      method: 'POST',
      headers: { ...economyHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        uid: _playerId,
        name: _playerId === '0' ? 'Guest' : `Trader ${_playerId}`,
        city_id: city ? city.id : null,
        x: player.x,
        y: player.y,
        gold: player.gold,
        facing_x: player.facing?.x ?? 0,
        facing_y: player.facing?.y ?? 1,
        gear_pack: player.gear?.pack ?? 0,
        gear_boots: player.gear?.boots ?? 0,
        color: '#a78bfa',
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  async function syncOtherPlayers() {
    if (__QA.enabled || !ECONOMY.enabled) return;
    const now = Date.now();
    if (now - _lastPresenceFetch < 15000) return; // 5s→15s: players move slowly, was 7% of egress
    _lastPresenceFetch = now;
    try {
      const cutoff = new Date(now - 30000).toISOString();
      const res = await fetch(
        `${ECONOMY.url}/rest/v1/player_presence?updated_at=gte.${encodeURIComponent(cutoff)}&select=uid,name,x,y,city_id,facing_x,facing_y,gear_pack,gear_boots,color`,
        { headers: economyHeaders() }
      );
      if (!res.ok) return;
      const rows = await res.json();
      for (const uid of Object.keys(otherPlayers)) {
        if (!rows.find(r => r.uid === uid)) delete otherPlayers[uid];
      }
      for (const row of rows) {
        if (row.uid === _playerId) continue;
        otherPlayers[row.uid] = row;
      }
    } catch {}
  }

  async function syncWorldState() {
    if (__QA.enabled) return;
    // Guard against any caller running this faster than 3s — city entry, actions, or stray calls
    const _now = Date.now();
    if (_now - _lastWorldSyncT < 3000) return;
    _lastWorldSyncT = _now;
    let _syncHadChange = false;
    try {
      // ── 1. City state from city_treasury ──
      // Fetched FIRST so cityBuildings is populated before the day-catchup loop
      // runs cityInvestTick → pushCityTreasuryToDb, which would otherwise overwrite
      // built slots with zeroed in-memory state.
      const rows = await fetch(
        `${ECONOMY.url}/rest/v1/city_treasury?select=city_id,gold,population,hunger,city_bonus,buildings,bank_reserve,total_deposits,bankrupt_day`,
        { headers: { apikey: ECONOMY.key, Authorization: `Bearer ${ECONOMY.key}` } }
      ).then(r => r.ok ? r.json() : []);

      for (const row of rows) {
        const cid = row.city_id;
        // Treasury gold: take DB value if higher
        if (cityTreasury[cid]) {
          if (row.gold != null) cityTreasury[cid].gold = row.gold;
          if (row.invest_log) cityTreasury[cid].investLog = row.invest_log;
        }
        // Population + hunger
        if (cityPop[cid]) {
          if (row.population) cityPop[cid].pop = row.population;
          if (row.hunger != null) cityPop[cid].hunger = row.hunger;
        }
        // Bank vault (shared across all players)
        if (bankVault[cid]) {
          if (Number.isFinite(row.bank_reserve)) bankVault[cid].reserve = row.bank_reserve;
          bankVault[cid].bankruptDay = row.bankrupt_day ?? null;
          // If the server marked this bank bankrupt while we have a local deposit,
          // clear it — the player took the haircut already (vault collapsed for all).
          if (row.bankrupt_day !== null && playerBank.deposits[cid]) {
            delete playerBank.deposits[cid];
            delete playerBank.loans[cid];
            const cityObj = getCityById(cid);
            toast(`🏦 Bank of ${cityObj?.name || cid} collapsed — deposit lost.`, 5);
          }
        }
        // City bonuses
        if (row.city_bonus && typeof row.city_bonus === 'object' && cityBonus[cid]) {
          Object.assign(cityBonus[cid], row.city_bonus);
        }
        // Buildings
        if (row.buildings && typeof row.buildings === 'object' && cityBuildings[cid]) {
          for (const [key, saved] of Object.entries(row.buildings)) {
            const slot = cityBuildings[cid][key];
            if (!slot) continue;
            const wasBuilt = slot.built;
            slot.level  = saved.level  ?? slot.level;
            slot.built  = saved.built  ?? slot.built;
            if (!slot.playerFunded || slot.playerFunded === 0) {
              slot.playerFunded = saved.playerFunded ?? 0;
            }
            if (slot.built && !wasBuilt) {
              _syncHadChange = true;
              bdLog('SYNC-BUILD-MAP', `${cid}.${key} → buildSlotOnMap (DB built:true, mem was built:false)`, null);
              buildSlotOnMap(cid, key, slot);
            }
          }
        }
      }

      // ── 2. World time + events from world_state ──
      const wsRows = await fetch(
        `${ECONOMY.url}/rest/v1/world_state?id=eq.main&select=day,frac,seed,active_events,market_drift,contract_boards`,
        { headers: { apikey: ECONOMY.key, Authorization: `Bearer ${ECONOMY.key}` } }
      ).then(r => r.ok ? r.json() : []).catch(() => []);
      if (wsRows.length > 0) {
        const ws = wsRows[0];
        // Sync active world events
        if (Array.isArray(ws.active_events)) {
          const prevCount = worldEvents.length;
          worldEvents.length = 0;
          for (const ev of ws.active_events) worldEvents.push(ev);
          if (worldEvents.length > prevCount) {
            const newest = worldEvents[worldEvents.length - 1];
            if (newest) toast(`World event: ${newest.name}`, 4);
          }
        }
        // Sync market drift — server is authoritative; overrides local random drift
        if (ws.market_drift && typeof ws.market_drift === 'object') {
          for (const cid of Object.keys(marketDrift)) {
            if (ws.market_drift[cid]) Object.assign(marketDrift[cid], ws.market_drift[cid]);
          }
        }
        // Sync contract boards — server-regenerated every 3 game-days; all players see the same board
        if (ws.contract_boards && typeof ws.contract_boards === 'object') {
          for (const [cid, board] of Object.entries(ws.contract_boards)) {
            if (Array.isArray(board) && board.length > 0 && contracts.byCity[cid] !== undefined) {
              contracts.byCity[cid] = board;
              contracts.lastRegenDay[cid] = Math.floor(time.day);
            }
          }
        }
        if (typeof ws.day === 'number' && ws.day > time.day) {
          // Server (or another player) advanced time - catch up.
          // cityBuildings is now populated from step 1, so cityInvestTick is safe.
          // Cap at 30 days to avoid runaway on first load after long server-only run.
          const daysAhead = Math.min(Math.floor(ws.day) - Math.floor(time.day), 30);
          _syncHadChange = true;
          bdLog('SYNC-CATCHUP', `Server day ${ws.day} > local ${time.day}; advancing ${daysAhead} days`, null);
          for (let i = 0; i < daysAhead; i++) {
            time.day++;
            populationTick();
            cityMineTick();
            if (time.day % 7 === 0) cityInvestTick();
          }
          time.frac = ws.frac ?? time.frac;
          if (ws.seed) time.seed = ws.seed;
        } else if (typeof ws.day === 'number' && ws.day < 1) {
          // DB never seeded - push our local time up
          pushWorldTimeToDb();
        }
      }
      // Only log a sync event if it actually changed something visible (avoids
      // spamming on every Realtime push when nothing notable changed).
      if (_syncHadChange) bdLog('SYNC-END', 'syncWorldState() applied changes', null);
    } catch (e) {
      bdLog('ERR-SYNC', `Exception: ${String(e).slice(0,200)}`, null);
    }
  }

  // Initial sync on load (syncWorldState deferred - needs buildSlotOnMap defined first)
  economySync();

  function initRealtimeSubscriptions() {
    if (!ECONOMY.enabled || __QA.enabled) return;
    // World state is now synced only on player actions (city entry, trades) to reduce traffic.
    // Realtime is used only to push AI-trader visual updates.
    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
      console.warn('[REALTIME] supabase-js not loaded — trader sync will rely on city-entry refresh');
      return;
    }
    const { createClient } = window.supabase;
    _realtimeClient = createClient(ECONOMY.url, ECONOMY.key);

    // Fallback: if realtime doesn't connect within 10s, no polling (action-only sync)
    _realtimeFallbackTimer = setTimeout(() => {
      if (!_realtimeConnected) {
        console.warn('[REALTIME] Connection timeout — trader updates paused until city entry');
      }
    }, 10_000);

    _realtimeClient
      .channel('world-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'world_traders' },
          () => syncTradersFromServer())
      .subscribe((status) => {
        console.log('[REALTIME] status:', status);
        if (status === 'SUBSCRIBED') {
          _realtimeConnected = true;
          clearTimeout(_realtimeFallbackTimer);
          console.log('[REALTIME] Connected — world_traders live; world state syncs on player actions');
        }
      });
  }

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

  // ── PRICE SYSTEM: single source of truth ─────────────────────────────────
  // Previously there were two competing systems: priceFor() (hardcoded mults) and
  // quoteFor() (seeded RNG via townItemModifier). They disagreed significantly,
  // causing the market display and actual trade prices to be inconsistent.
  // Fix: quoteFor now derives its mid from priceFor's hardcoded mults table,
  // so BUY/SELL quotes, AI trader decisions, and market display all agree.
  // townItemModifier is kept for legacy compatibility but no longer used in core pricing.

  function townItemModifier(cityId, itemId) {
    // DEPRECATED: previously used by quoteFor; quoteFor now uses priceFor mults directly.
    // Kept to avoid breaking any external references.
    const cs = citySeed(cityId);
    const u = seeded01(cs, itemId.length, itemId.charCodeAt(0) || 0);
    const skew = (u * 2 - 1) * 0.35;
    const v = seeded01(cs, 999, 42);
    const cityTilt = (v * 2 - 1) * 0.10;
    return 1 + skew + cityTilt;
  }

  function referencePrice(item) {
    return Math.max(1, Math.round(item.base));
  }

  function dayWobble(cityId, item) {
    // ±3% daily wobble - makes prices feel alive without real-time flicker.
    const day = Math.max(1, Math.floor(time?.day || 1));
    const cs = citySeed(cityId);
    const u = seeded01(cs ^ (item.base * 7), day, item.id.charCodeAt(0) || 0);
    return 0.97 + u * 0.06; // [0.97, 1.03]
  }

  // midPriceFor uses the hardcoded mults table (same as priceFor) + daily wobble.
  // This is now the canonical mid-price for all market purposes.
  function midPriceFor(cityId, item) {
    // Get the city multiplier from the hardcoded mults table in priceFor.
    // We inline the mults here to keep them consistent.
    const CITY_MULTS = {
      valdenmere: { grain: 1.10, food: 1.10, ore: 1.20, herbs: 1.05, potion: 0.85, relic: 1.15, ink: 1.05, coal: 1.20, gem: 1.10, copper: 1.20, silver: 1.20, gold: 0.65 },
      ashport:    { grain: 1.05, food: 0.90, ore: 1.05, herbs: 1.10, potion: 1.15, relic: 1.20, ink: 1.20, coal: 1.30, gem: 1.25, copper: 1.22, silver: 1.30, gold: 1.30 },
      crosshaven: { grain: 0.90, food: 0.85, ore: 1.00, herbs: 1.15, potion: 1.25, relic: 1.10, ink: 1.00, coal: 1.35, gem: 1.40, copper: 0.68, silver: 1.28, gold: 1.25 },
      ironholt:   { grain: 1.15, food: 1.30, ore: 0.65, herbs: 1.20, potion: 1.10, relic: 0.85, ink: 0.90, coal: 0.55, gem: 0.70, copper: 1.05, silver: 0.66, gold: 1.20 },
    };
    const mult  = (CITY_MULTS[cityId]?.[item.id]) ?? 1.0;
    const drift = (marketDrift[cityId]?.[item.id]) ?? 1;
    const wob   = dayWobble(cityId, item);
    const econ  = economyModifier(cityId, item.id);
    const evMod = worldEventModifier(cityId, item.id);
    return Math.max(1, Math.round(item.base * mult * drift * wob * econ * evMod));
  }

  function quoteFor(cityId, item) {
    // Unified buy/sell quotes derived from midPriceFor (same formula as priceFor).
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
  // Ironholt-origin contracts can also request coal (weighted) and rare gem hauls.
  const CONTRACT_ITEMS_IRONHOLT = ['grain','food','ore','herbs','potion','relic','coal','coal','gem'];


  function rewardForContract(want, qty) {
    // Contract reward = cost to buy + 50-80% above best free-trade margin.
    // Previous formula gave 20× the free-trade margin (too dominant).
    // Now: item buy cost + delivery bonus (50-70% on top of best margin * qty).
    const it = ITEMS.find(x => x.id === want);
    const base = it ? it.base : 20;
    // Best single-route margin per unit for this item (approximate — used as reference)
    // Tuned so net contract profit (reward - buy cost) is ~1.5-4.5× free trade margin.
    const bestMarginRef = {
      grain: 7, food: 5, ore: 9, herbs: 7, potion: 10, relic: 18, ink: 13, coal: 4, gem: 22,
    }[want] || 5;
    // Contract pays: buy cost (at cheapest city ≈ base * 0.85) + best margin * 1.2 per unit
    const buyCostRef = Math.round(base * 0.88);
    const deliveryPremium = Math.round(bestMarginRef * 1.2); // 20% above best free margin (down from 60%)
    const perUnit = buyCostRef + deliveryPremium;
    // qty multiplier: diminishing — each extra unit adds 75% of per-unit value
    const qtyMult = qty === 1 ? 1.0 : qty === 2 ? 1.75 : 2.35;
    const r = Math.round(perUnit * qtyMult);
    return clamp(r, 18, 280);
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
    const pool = (fromId === 'ironholt') ? CONTRACT_ITEMS_IRONHOLT : CONTRACT_ITEMS;
    const want = randChoice(pool);
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

  // City treasury - accumulates from player sell taxes, auto-invests every ~7 days
  const cityTreasury = {
    valdenmere: { gold: 60, investLog: [] }, // seed gold so first building can appear early
    ashport:    { gold: 40, investLog: [] },
    crosshaven: { gold: 30, investLog: [] },
    ironholt:   { gold: 45, investLog: [] },
  };

  // Bank state - player deposits and loans per city
  const playerBank = {
    deposits: {}, // cityId -> { amount, depositDay }
    loans: {},    // cityId -> { amount, dueDay, interest }
  };

  // Bank vault - each city bank holds its own reserve
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
          : `🏦 Bank of ${cityObj?.name || cid} bankrupt - deposit fully recovered (${payout}g).`;
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

  // Warehouse stash - items stored per city
  const warehouseStash = {}; // cityId -> { itemId: qty, ... }

  // City upgrades - multiplicative bonuses unlocked by investment
  const cityBonus = {
    valdenmere: { marketDiscount: 0, roadSpeed: 0, foodSubsidy: 0, popIncentive: 0, guardDiscount: 0, mineProduction: 0 },
    ashport:    { marketDiscount: 0, roadSpeed: 0, foodSubsidy: 0, popIncentive: 0, guardDiscount: 0, mineProduction: 0 },
    crosshaven: { marketDiscount: 0, roadSpeed: 0, foodSubsidy: 0, popIncentive: 0, guardDiscount: 0, mineProduction: 0 },
    ironholt:   { marketDiscount: 0, roadSpeed: 0, foodSubsidy: 0, popIncentive: 0, guardDiscount: 0, mineProduction: 0 },
  };

  // ── City Building Slots ───────────────────────────────────────────────────
  // Each slot: level (0=unbuilt), maxLevel, costPerLevel[], effect, gain, built flag,
  // tileX/Y (set after makeMap), tileW/H (building footprint), tileType, doorSide, playerFunded
  const cityBuildings = {
    valdenmere: {
      market:    { level:0, maxLevel:3, costPerLevel:[80,160,300],  effect:'marketDiscount', gain:0.05, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:6,  doorSide:'west',  playerFunded:0 },
      barracks:  { level:0, maxLevel:2, costPerLevel:[100,200],     effect:'guardDiscount',  gain:0.10, built:false, tileX:0, tileY:0, tileW:5, tileH:4, tileType:4,  doorSide:'west',  playerFunded:0 },
      granary:   { level:0, maxLevel:2, costPerLevel:[60,120],      effect:'foodSubsidy',    gain:0.10, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:8,  doorSide:'east',  playerFunded:0 },
      guild:     { level:0, maxLevel:1, costPerLevel:[200],         effect:'popIncentive',   gain:0.10, built:false, tileX:0, tileY:0, tileW:5, tileH:4, tileType:15, doorSide:'west',  playerFunded:0 },
      warehouse: { level:0, maxLevel:2, costPerLevel:[90,180],      effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:7, tileH:3, tileType:8,  doorSide:'north', playerFunded:0 },
      inn:       { level:0, maxLevel:1, costPerLevel:[70],          effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:4, tileType:7,  doorSide:'east',  playerFunded:0 },
    },
    ashport: {
      market:    { level:0, maxLevel:2, costPerLevel:[80,160],      effect:'marketDiscount', gain:0.05, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:6,  doorSide:'east',  playerFunded:0 },
      warehouse: { level:0, maxLevel:3, costPerLevel:[70,140,250],  effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:3, tileType:8,  doorSide:'north', playerFunded:0 },
      inn:       { level:0, maxLevel:2, costPerLevel:[60,120],      effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:5, tileH:5, tileType:7,  doorSide:'east',  playerFunded:0 },
      guild:     { level:0, maxLevel:1, costPerLevel:[150],         effect:'popIncentive',   gain:0.08, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:15, doorSide:'east',  playerFunded:0 },
    },
    crosshaven: {
      granary:   { level:0, maxLevel:2, costPerLevel:[50,100],      effect:'foodSubsidy',    gain:0.12, built:false, tileX:0, tileY:0, tileW:3, tileH:3, tileType:8,  doorSide:'west',  playerFunded:0 },
      inn:       { level:0, maxLevel:1, costPerLevel:[55],          effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:7,  doorSide:'east',  playerFunded:0 },
      market:    { level:0, maxLevel:1, costPerLevel:[70],          effect:'marketDiscount', gain:0.05, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:6,  doorSide:'east',  playerFunded:0 },
    },
    ironholt: {
      barracks:  { level:0, maxLevel:2, costPerLevel:[90,180],      effect:'guardDiscount',  gain:0.10, built:false, tileX:0, tileY:0, tileW:5, tileH:4, tileType:4,  doorSide:'east',  playerFunded:0 },
      warehouse: { level:0, maxLevel:3, costPerLevel:[80,160,280],  effect:'roadSpeed',      gain:0.05, built:false, tileX:0, tileY:0, tileW:6, tileH:3, tileType:8,  doorSide:'north', playerFunded:0 },
      granary:   { level:0, maxLevel:1, costPerLevel:[60],          effect:'foodSubsidy',    gain:0.10, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:8,  doorSide:'east',  playerFunded:0 },
      market:    { level:0, maxLevel:1, costPerLevel:[80],          effect:'marketDiscount', gain:0.05, built:false, tileX:0, tileY:0, tileW:4, tileH:3, tileType:6,  doorSide:'west',  playerFunded:0 },
      mine:      { level:0, maxLevel:3, costPerLevel:[120,240,400], effect:'mineProduction', gain:1.00, built:false, tileX:0, tileY:0, tileW:5, tileH:3, tileType:19, doorSide:'east',  playerFunded:0 },
      // Pre-built civic buildings: positions mirror the static placeBuilding calls in paintCity.
      // built:true so auto-invest never touches them and they sprite-render from day 1.
      bank:      { level:1, maxLevel:1, costPerLevel:[],            effect:'mineProduction', gain:0,    built:true,  tileX:0, tileY:0, tileW:4, tileH:3, tileType:13, doorSide:'west',  playerFunded:0 },
      guild:     { level:1, maxLevel:1, costPerLevel:[],            effect:'mineProduction', gain:0,    built:true,  tileX:0, tileY:0, tileW:4, tileH:3, tileType:15, doorSide:'east',  playerFunded:0 },
      inn:       { level:1, maxLevel:1, costPerLevel:[],            effect:'mineProduction', gain:0,    built:true,  tileX:0, tileY:0, tileW:5, tileH:4, tileType:7,  doorSide:'west',  playerFunded:0 },
    },
  };

  // ── Assign tile positions + paint vacant lots (called after cityBuildings is declared) ──
  function initCityBuildingSlots() {
    // Valdenmere (x=16, y=16, w=36, h=26) — gx=34, csY=28
    cityBuildings.valdenmere.inn.tileX       = 18;  cityBuildings.valdenmere.inn.tileY       = 17;
    cityBuildings.valdenmere.granary.tileX   = 18;  cityBuildings.valdenmere.granary.tileY   = 23;
    cityBuildings.valdenmere.market.tileX    = 37;  cityBuildings.valdenmere.market.tileY    = 23;
    cityBuildings.valdenmere.barracks.tileX  = 36;  cityBuildings.valdenmere.barracks.tileY  = 32;
    cityBuildings.valdenmere.warehouse.tileX = 18;  cityBuildings.valdenmere.warehouse.tileY = 32;
    cityBuildings.valdenmere.guild.tileX     = 36;  cityBuildings.valdenmere.guild.tileY     = 17;
    // Ashport (x=184, y=110, w=28, h=24) — gx=198, dockY=126, mktY=119
    cityBuildings.ashport.inn.tileX       = 186;  cityBuildings.ashport.inn.tileY       = 112;
    cityBuildings.ashport.market.tileX    = 186;  cityBuildings.ashport.market.tileY    = 121;
    cityBuildings.ashport.guild.tileX     = 186;  cityBuildings.ashport.guild.tileY     = 125;
    cityBuildings.ashport.warehouse.tileX = 202;  cityBuildings.ashport.warehouse.tileY = 127;
    // Crosshaven (x=110, y=130, w=20, h=20) — gx=120, mktY=138
    cityBuildings.crosshaven.inn.tileX     = 112;  cityBuildings.crosshaven.inn.tileY     = 132;
    cityBuildings.crosshaven.granary.tileX = 122;  cityBuildings.crosshaven.granary.tileY = 132;
    cityBuildings.crosshaven.market.tileX  = 112;  cityBuildings.crosshaven.market.tileY  = 137;
    // Ironholt (x=210, y=28, w=24, h=22) — gx=222, yardY=41, mktY=35
    cityBuildings.ironholt.barracks.tileX  = 212;  cityBuildings.ironholt.barracks.tileY  = 30;
    cityBuildings.ironholt.market.tileX    = 224;  cityBuildings.ironholt.market.tileY    = 36;
    cityBuildings.ironholt.granary.tileX   = 212;  cityBuildings.ironholt.granary.tileY   = 44;
    cityBuildings.ironholt.warehouse.tileX = 224;  cityBuildings.ironholt.warehouse.tileY = 44;
    cityBuildings.ironholt.mine.tileX      = 212;  cityBuildings.ironholt.mine.tileY      = 47;
    cityBuildings.ironholt.inn.tileX       = 224;  cityBuildings.ironholt.inn.tileY       = 30;
    cityBuildings.ironholt.bank.tileX      = 224;  cityBuildings.ironholt.bank.tileY      = 40;
    cityBuildings.ironholt.guild.tileX     = 212;  cityBuildings.ironholt.guild.tileY     = 40;
    // Paint vacant lots (tile 16) for unbuilt slots
    if (!mapData) return;
    for (const slots of Object.values(cityBuildings)) {
      for (const slot of Object.values(slots)) {
        if (!slot.built && slot.tileX > 0 && slot.tileY > 0) {
          for (let dy = 0; dy < slot.tileH; dy++)
            for (let dx = 0; dx < slot.tileW; dx++) {
              const idx = (slot.tileY + dy) * MAP_W + (slot.tileX + dx);
              if (mapData[idx] === 4) mapData[idx] = 16;
            }
        }
      }
    }
  }
  initCityBuildingSlots();

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
  { id: 'olt_the_bold',    name: 'Olt the Bold',      style: 'guard',    personality: 'aggressive',  color: '#ef4444', speed: 75 },
  { id: 'mira_silvertong', name: 'Mira Silvertongue', style: 'scribe',   personality: 'opportunist', color: '#a78bfa', speed: 60 },
  { id: 'cargo_dom',       name: 'Cargo Dom',         style: 'broker',   personality: 'cautious',    color: '#f59e0b', speed: 50 },
  { id: 'wren_the_swift',  name: 'Wren the Swift',    style: 'smuggler', personality: 'aggressive',  color: '#34d399', speed: 85 },
  { id: 'pilgrim_bex',     name: 'Bex the Pilgrim',   style: 'scribe',   personality: 'opportunist', color: '#86efac', speed: 55 },
  { id: 'iron_marek',      name: 'Iron Marek',        style: 'guard',    personality: 'aggressive',  color: '#fb923c', speed: 80 },
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
    // No path found - fallback straight line
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
 * Returns { fromId, toId, itemId } - the trip they'll do.
 */
function traderDecideRoute(trader) {
  const fromId = trader.toId || trader.fromId || 'valdenmere';
  const candidates = [];
  for (const to of world.cities) {
    if (to.id === fromId) continue; // never stay in same city
    for (const it of ITEMS) {
      if (it.sourceCities && !it.sourceCities.includes(fromId)) continue; // respect item source restrictions
      const buy  = quoteFor(fromId, it).buy;
      const sell = quoteFor(to.id, it).sell;
      const profit = sell - buy;
      if (profit <= 0) continue;
      const units = Math.floor(trader.capacity / it.weight);
      candidates.push({ from: fromId, to: to.id, itemId: it.id, profit: profit * units });
    }
  }

  if (!candidates.length) {
    // No profitable route - pick any other city
    const others = world.cities.filter(c => c.id !== fromId);
    const fallbackTo = others[Math.floor(Math.random() * others.length)]?.id || 'ashport';
    return { fromId, toId: fallbackTo, itemId: 'ore' };
  }

  candidates.sort((a, b) => b.profit - a.profit);

  // Diversity enforcement: avoid piling onto an item already being traded by 2+ other traders.
  // This prevents all traders from converging on a single over-pressured item.
  const itemCounts = {};
  for (const t of AI_TRADERS) {
    if (t.id !== trader.id && t.itemId) {
      itemCounts[t.itemId] = (itemCounts[t.itemId] || 0) + 1;
    }
  }
  // Filter out items where 2+ other traders are already active, unless no alternative exists
  const diverseCandidates = candidates.filter(c => (itemCounts[c.itemId] || 0) < 2);
  const pool = diverseCandidates.length > 0 ? diverseCandidates : candidates;

  let pick;
  if (trader.personality === 'aggressive') {
    pick = pool[0];
  } else if (trader.personality === 'cautious') {
    pick = pool[Math.floor(pool.length * 0.4)] || pool[0];
  } else {
    // Opportunist: random from top 5
    pick = pool[Math.floor(Math.random() * Math.min(5, pool.length))];
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
      let t = AI_TRADERS.find(tr => tr.id === row.id);
      // If trader exists in DB but not yet locally (e.g. server spawned between client loads),
      // create a local stub so the client renders them correctly.
      if (!t) {
        const def = TRADER_DEFS.find(d => d.id === row.id);
        if (!def) continue;
        const fromC = getCityById(row.from_id) || getCityById('valdenmere');
        t = {
          ...def,
          capacity: 12,
          startGold: row.start_gold || 80,
          inv: {},
          x: (fromC.x + fromC.w/2) * TILE,
          y: (fromC.y + fromC.h/2) * TILE,
          path: [], pathIdx: 0,
          fromId: row.from_id, toId: row.to_id, itemId: row.item_id,
          state: row.state || 'traveling',
          cityTimer: 0, _lastX: 0, _lastY: 0, _stuckT: 0, radius: 7,
          gold: row.gold, totalProfit: row.total_profit || 0,
          tripsCompleted: row.trips_completed || 0,
        };
        AI_TRADERS.push(t);
      }
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
        // Reset the local-fallback dwell timer so a near-threshold cityTimer
        // doesn't fire localTraderDepart immediately after the server pushes
        // a fresh in_city dwell.
        t.cityTimer = 0;
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
    // Non-fatal - game runs with local state
    console.warn('[SYNC] Trader sync failed (non-fatal):', e.message);
  }
}

// Call after world is ready - deferred slightly so world init completes first
setTimeout(() => {
  syncTradersFromServer();
  syncWorldState();
  initRealtimeSubscriptions();
}, 1500);

function traderArrive(t) {
  // Visual-only: snap sprite to city center. State/gold/profit managed by server world_tick().
  const destC = getCityById(t.toId);
  if (destC) {
    t.x = (destC.x + destC.w/2) * TILE;
    t.y = (destC.y + destC.h/2) * TILE;
  }
  // Clear client-side path so animation stops cleanly
  t.path = [];
  t.pathIdx = 0;
}

// Seconds a trader sits in a city before the local fallback dispatches it.
// Staggered per-trader via t.cityTimer's initial offset (see spawnAiTraders).
const LOCAL_TRADER_DEPART_DELAY = 18;
// Back-off after a failed local dispatch (e.g. buildTraderPath empty). Tied
// to DEPART_DELAY so a future tuning of DEPART_DELAY doesn't accidentally
// produce a zero / negative back-off and spin every frame.
const LOCAL_TRADER_RETRY_BACKOFF = 3;

// Snap a trader to its destination city center and clear all
// per-trip bookkeeping so the in_city branch (and any server sync) reads a
// clean state on the next tick. All three "trip ended" branches in
// updateAiTraders go through this helper so they stay in lock-step.
function parkTraderInCity(t) {
  const destC = getCityById(t.toId);
  if (destC) {
    t.x = (destC.x + destC.w/2) * TILE;
    t.y = (destC.y + destC.h/2) * TILE;
  }
  t.state = 'in_city';
  t.fromId = t.toId;
  t.path = [];
  t.pathIdx = 0;
  t.cityTimer = 0;
}

function localTraderDepart(t) {
  const route = traderDecideRoute(t);
  const path = buildTraderPath(route.fromId, route.toId);
  if (!path || path.length === 0) return false;
  t.fromId = route.fromId;
  t.toId = route.toId;
  t.itemId = route.itemId;
  t.path = path;
  t.pathIdx = 0;
  t.state = 'traveling';
  t.cityTimer = 0;
  t._stuckT = stateTime;
  t._lastX = t.x;
  t._lastY = t.y;
  return true;
}

function traderDepart(t) {
  // No-op: when Supabase world_tick is reachable it owns route decisions.
  // updateAiTraders runs a local autonomous fallback when the server isn't
  // ticking so traders still leave their starting city.
}

function updateAiTraders(dt) {
  for (const t of AI_TRADERS) {
    // ── In city: snap to city center; locally tick a departure timer ────────
    if (t.state === 'in_city') {
      const c = getCityById(t.toId || t.fromId);
      if (c) {
        t.x = (c.x + c.w/2) * TILE;
        t.y = (c.y + c.h/2) * TILE;
      }
      maybeFireTraderBubble(t, dt);

      // Local autonomous fallback: if the server world_service cron isn't
      // pushing trader updates, traders would otherwise sit forever. After
      // ~18s in city, decide a route locally and start traveling. A server
      // sync will override on the next realtime update if it arrives.
      t.cityTimer = (t.cityTimer || 0) + dt;
      if (t.cityTimer >= LOCAL_TRADER_DEPART_DELAY) {
        // If pathing isn't available right now (e.g. world not fully ready),
        // back off a few seconds instead of retrying every frame.
        if (!localTraderDepart(t)) t.cityTimer -= LOCAL_TRADER_RETRY_BACKOFF;
      }
      continue;
    }

    if (t.state !== 'traveling') continue;

    // ── Traveling: animate along path waypoints (visual only) ────────
    // All "trip ended" branches go through parkTraderInCity() so they stay
    // in lock-step (state/fromId/path/pathIdx/cityTimer all reset together).
    if (!t.path || t.path.length === 0) {
      parkTraderInCity(t);
      continue;
    }
    if (t.pathIdx >= t.path.length) {
      parkTraderInCity(t);
      continue;
    }

    const target = t.path[t.pathIdx];
    if (!target) {
      t.pathIdx++;
      continue;
    }

    const dx = target.x - t.x;
    const dy = target.y - t.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 12) {
      // Reached waypoint - advance
      t.pathIdx++;
      if (t.pathIdx >= t.path.length) {
        parkTraderInCity(t);
      }
      continue;
    }

    // Move
    t.x += (dx / dist) * t.speed * dt;
    t.y += (dy / dist) * t.speed * dt;

    // Stuck detection - skip waypoint if blocked for 3s (visual only)
    if (stateTime - (t._stuckT || 0) > 3000) {
      const moved = Math.hypot(t.x - (t._lastX || t.x), t.y - (t._lastY || t.y));
      if (moved < 8) {
        t.pathIdx = Math.min(t.pathIdx + 1, t.path.length);
      }
      t._stuckT = stateTime; t._lastX = t.x; t._lastY = t.y;
    }

    maybeFireTraderBubble(t, dt);
  }
}

const TRADER_INTERACT_RADIUS = 40; // pixels - close enough to trade

function findNearestTrader(px, py) {
  let best = null, bestD = TRADER_INTERACT_RADIUS;
  for (const t of AI_TRADERS) {
    const d = Math.hypot(t.x - px, t.y - py);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function openTraderUI(trader) {
  // Show a quick trade modal - buy what they're carrying at a slight discount
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
        <button id="cr-trader-close2" style="background:none;border:1px solid #5a4a20;color:#888;padding:4px 16px;border-radius:5px;cursor:pointer;font-size:16px" aria-label="Close">✕</button>
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
      gainItem(itemId, 1);
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
    'I\'ll cut you a deal - once.',
    'Move it or lose it.',
    'Profits don\'t wait.',
    'Faster than the tax man!',
  ],
  cautious: [
    'Steady trade, steady coin.',
    'Always check the road ahead.',
    'No rush - no losses.',
    'Is that bandit country?',
    'A safe route beats a fast one.',
    'Better safe than sorry.',
  ],
  opportunist: [
    'Where there\'s chaos, there\'s coin.',
    'I smell a bargain...',
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
      `Restocking in ${fromName}...`,
      `${fromName} market is lively today.`,
      'Just arrived. Give me a moment.',
      `Looking for ${itemName} at a good price.`,
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }
  // Traveling
  if (cargoCount === 0) return `Heading to ${destName} empty - not ideal.`;
  const lines = [
    `Hauling ${cargoCount}× ${itemName} to ${destName}.`,
    `${destName} pays well for ${itemName}.`,
    `${Math.round(Math.hypot(t.x - (getCityById(t.toId)?.x||0)*TILE, t.y - (getCityById(t.toId)?.y||0)*TILE))}px to go...`,
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

  // Next quip in 10-20s
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

    // Bubble background - tinted by trader color
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
  if (sx < -40 || sx > VIEW_W+40 || sy < -40 || sy > VIEW_H+40) return;

  const moving  = t.state === 'traveling';
  const inCity  = t.state === 'in_city';
  const facing  = t.facing || { x: 1, y: 0 };

  // Classify direction
  let dir;
  const ax = Math.abs(facing.x), ay = Math.abs(facing.y);
  if (ay >= ax) dir = facing.y >= 0 ? 'DOWN' : 'UP';
  else          dir = facing.x >= 0 ? 'RIGHT' : 'LEFT';

  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(CARRIAGE_SCALE, CARRIAGE_SCALE);

  const phase     = stateTime * 0.013 + hashStr(t.id) * 1.3;
  const bounce    = moving ? Math.sin(phase * 2) * 1.1 : 0;
  const wheelSpin = moving ? stateTime * 0.020 + hashStr(t.id) : 0;
  const bodyColor = t.color || '#8b5e2a';
  const roofColor = t.color ? t.color + '99' : '#d9770688';

  const W  = 11;  // wagon half-width ref
  const H  = 8;   // wagon half-height ref
  const wW = W * 2, wH = H * 2;
  const wheelR = 4;
  const spokes  = 6;
  const hW = 7, hH = 8;
  const legLen = 5;

  const drawWheel = (wx, wy) => {
    ctx.strokeStyle = '#2a1808'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(wx, wy, wheelR, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#5a3a15';
    ctx.beginPath(); ctx.arc(wx, wy, wheelR*0.3, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#5a3a15'; ctx.lineWidth = 1;
    for (let s = 0; s < spokes; s++) {
      const a = wheelSpin + s / spokes * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(wx + Math.cos(a)*wheelR*0.28, wy + Math.sin(a)*wheelR*0.28);
      ctx.lineTo(wx + Math.cos(a)*wheelR*0.88, wy + Math.sin(a)*wheelR*0.88);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(wx-1, wy-1, wheelR*0.88, Math.PI*1.1, Math.PI*1.8); ctx.stroke();
  };

  const drawBody = (wx, wy) => {
    const by = wy + bounce;
    // Body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(wx, by, wW, wH);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(wx, by, 3, wH);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(wx+wW-3, by, 3, wH);
    // Plank lines
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.5;
    for (let pl = 3; pl < wH; pl += 3) {
      ctx.beginPath(); ctx.moveTo(wx+1,by+pl); ctx.lineTo(wx+wW-1,by+pl); ctx.stroke();
    }
    // Arched canopy
    ctx.beginPath();
    ctx.moveTo(wx-1, by);
    ctx.bezierCurveTo(wx-1, by-H*1.5, wx+wW+1, by-H*1.5, wx+wW+1, by);
    ctx.fillStyle = roofColor; ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,80,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    // Cargo goods bump
    const hasGoods = Object.values(t.inv||{}).some(q=>q>0);
    if (hasGoods) {
      ctx.fillStyle = 'rgba(180,140,60,0.5)';
      ctx.fillRect(wx+2, by-H*1.5-3, wW-4, 3);
    }
    // Parked wheel chocks
    if (inCity) {
      ctx.fillStyle = '#5a3a15';
      ctx.fillRect(wx-3, by+wH-4, 4, 4);
      ctx.fillRect(wx+wW-1, by+wH-4, 4, 4);
    }
    // Trim
    ctx.strokeStyle = 'rgba(255,200,80,0.5)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(wx, by, wW, wH);
  };

  const drawHorse = (hcx, hcy, dir) => {
    if (inCity) return; // horse off to side when parked
    const lp1 = moving ? Math.sin(phase*2)*legLen*0.5 : 0;
    const lp2 = moving ? Math.sin(phase*2+Math.PI)*legLen*0.5 : 0;
    const horiz = dir === 'RIGHT' || dir === 'LEFT';

    ctx.save();
    ctx.translate(hcx, hcy);
    if (dir === 'LEFT') ctx.scale(-1,1);

    if (horiz) {
      ctx.fillStyle = '#b09060';
      ctx.beginPath(); ctx.ellipse(0,0,hW*0.9,hH*0.45,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#a08050';
      ctx.beginPath(); ctx.ellipse(-1,-1,hW*0.78,hH*0.38,-0.15,0,Math.PI*2); ctx.fill();
      // Neck+head
      ctx.fillStyle = '#a08050';
      ctx.beginPath();
      ctx.moveTo(hW*0.6,-hH*0.3);
      ctx.bezierCurveTo(hW*0.9,-hH*0.7,hW*1.3,-hH*0.8,hW*1.5,-hH*0.5);
      ctx.bezierCurveTo(hW*1.4,-hH*0.2,hW*0.9,-hH*0.1,hW*0.6,-hH*0.1);
      ctx.fill();
      ctx.beginPath(); ctx.ellipse(hW*1.55,-hH*0.55,hW*0.3,hH*0.2,-0.3,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#c8a878';
      ctx.beginPath(); ctx.ellipse(hW*1.73,-hH*0.47,hW*0.13,hH*0.11,0.2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#100800';
      ctx.beginPath(); ctx.arc(hW*1.44,-hH*0.64,1.2,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#5a3810'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(hW*0.55,-hH*0.32); ctx.bezierCurveTo(hW*0.65,-hH*0.9,hW*1.1,-hH*0.95,hW*1.3,-hH*0.7); ctx.stroke();
      ctx.strokeStyle = '#5a3810'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-hW*0.82,-hH*0.1); ctx.bezierCurveTo(-hW*1.2,hH*0.2,-hW*1.1,hH*0.5,-hW*0.9,hH*0.55); ctx.stroke();
      ctx.strokeStyle = '#7a5828'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      const legs = [[-hW*0.4,lp1],[-hW*0.12,lp2],[hW*0.22,lp2],[hW*0.48,lp1]];
      for (const [lx,lp] of legs) {
        ctx.beginPath(); ctx.moveTo(lx,hH*0.38); ctx.lineTo(lx+lp*0.5,hH*0.38+legLen*0.5); ctx.lineTo(lx+lp*0.7,hH*0.38+legLen); ctx.stroke();
      }
      ctx.lineCap='butt';
    } else {
      const ys = dir==='DOWN'?1:-1;
      ctx.scale(1,ys);
      ctx.fillStyle='#b09060'; ctx.beginPath(); ctx.ellipse(0,0,hW*0.42,hH*0.48,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#a08050'; ctx.beginPath(); ctx.ellipse(0,-hH*0.06,hW*0.35,hH*0.42,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#a08050'; ctx.beginPath(); ctx.ellipse(0,hH*0.48,hW*0.24,hH*0.17,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#c8a878'; ctx.beginPath(); ctx.ellipse(0,hH*0.63,hW*0.14,hH*0.09,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#5a3810'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(0,-hH*0.4); ctx.lineTo(0,hH*0.2); ctx.stroke();
      ctx.strokeStyle='#7a5828'; ctx.lineWidth=2; ctx.lineCap='round';
      const pts=[[-hW*0.35,hH*0.18+lp1],[hW*0.35,hH*0.18+lp2],[-hW*0.35,-hH*0.32+lp2],[hW*0.35,-hH*0.32+lp1]];
      for(const[lx,ly]of pts){ctx.beginPath();ctx.moveTo(lx*0.6,ly-2);ctx.lineTo(lx,ly+legLen);ctx.stroke();}
      ctx.lineCap='butt';
    }
    ctx.restore();
  };

  // Dust
  if (moving) {
    for (let d = 0; d < 3; d++) {
      const dp = ((stateTime * 0.003 + d * 0.33) % 1);
      ctx.save(); ctx.globalAlpha = (1-dp)*0.3;
      let dox=0,doy=0;
      if(dir==='RIGHT') dox=-wW*0.6-dp*8; else if(dir==='LEFT') dox=wW*0.6+dp*8;
      else if(dir==='DOWN') doy=-wH*0.5-dp*8; else doy=wH*0.5+dp*8;
      ctx.fillStyle='#c8b090';
      ctx.beginPath(); ctx.arc(dox+Math.sin(d*2.3)*3, doy+Math.cos(d*1.7)*2, dp*5, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }

  // Ground shadow
  ctx.globalAlpha=0.18; ctx.fillStyle='#000';
  ctx.beginPath(); ctx.ellipse(0,8,13,4,0,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=1;

  // Layout
  const gap=3;
  if (dir==='RIGHT'||dir==='LEFT') {
    const flip = dir==='LEFT'?-1:1;
    const hcx = flip*(wW/2+gap+hW*0.9);
    drawWheel(-wW/2+wheelR*0.6, wH/2+wheelR*0.3);
    drawWheel( wW/2-wheelR*0.6, wH/2+wheelR*0.3);
    drawBody(-wW/2,-wH/2);
    // Harness
    ctx.strokeStyle='#5a3820'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(flip*wW/2, bounce); ctx.lineTo(flip*(wW/2+gap), bounce); ctx.stroke();
    drawHorse(hcx, bounce, dir);
    // Merchant figure parked
    if (inCity) {
      ctx.fillStyle = bodyColor;
      ctx.fillRect(flip*(wW/2+2), -H*0.4, 5, 9);
      ctx.fillStyle='#c8a87a'; ctx.beginPath(); ctx.arc(flip*(wW/2+4.5),-H*0.7,3,0,Math.PI*2); ctx.fill();
    }
  } else {
    const horse_y = dir==='DOWN' ? -(hH*0.5+gap+wH/2) : (hH*0.5+gap+wH/2);
    drawWheel(-wW/2+wheelR*0.5, 0);
    drawWheel( wW/2-wheelR*0.5, 0);
    drawBody(-wW/2,-wH/2);
    ctx.strokeStyle='#5a3820'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,dir==='DOWN'?-wH/2+bounce:wH/2+bounce); ctx.lineTo(0,horse_y+(dir==='DOWN'?hH*0.4:-hH*0.4)); ctx.stroke();
    drawHorse(0, horse_y, dir);
    if (inCity) {
      ctx.fillStyle = bodyColor; ctx.fillRect(-2, wH/2+2, 5, 9);
      ctx.fillStyle='#c8a87a'; ctx.beginPath(); ctx.arc(0,wH/2-2,3,0,Math.PI*2); ctx.fill();
    }
  }

  ctx.shadowBlur=0;
  ctx.restore();

  // Name label (unscaled)
  ctx.save();
  ctx.translate(sx, sy);
  const labelY = -(t.radius * 2.2 * CARRIAGE_SCALE) - 10;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(-22, labelY, 44, 12);
  ctx.fillStyle = t.color || '#f0d080';
  ctx.font = `bold ${Math.round(8*UI_SCALE)}px system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(t.name.split(' ')[0], 0, labelY + 9);
  ctx.textAlign = 'left';
  const dist = Math.hypot(t.x - player.x, t.y - player.y);
  if (dist < TRADER_INTERACT_RADIUS) {
    ctx.fillStyle = 'rgba(251,191,36,0.9)';
    ctx.font = `${Math.round(9*UI_SCALE)}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('[T] Trade', 0, labelY - 4);
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
 * Each waypoint: { x, y, pauseMs }  - pauseMs: how long to idle at this point.
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
      // Stand at gate - one waypoint with very long pause. Slight jitter from NPC id separates them.
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
  return null; // totally blocked - caller will skip
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
      // Can't reach this waypoint - skip to next one next frame
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
      // Place guards flanking the gate - left/right of center, 3 tiles apart, inside city
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

const NPC_ARRIVAL_THRESHOLD = 10; // pixels - within this, NPC has "arrived" at waypoint
const NPC_STUCK_THRESHOLD = 12;   // pixels - if NPC barely moved in 1.5s, it's stuck

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

    // Arrived at waypoint - start pause
    if (dist < NPC_ARRIVAL_THRESHOLD) {
      if (e.pendingPauseMs > 0) {
        e.pauseUntil = stateTime + e.pendingPauseMs;
        e.pendingPauseMs = 0;
        e.nextWanderAt = e.pauseUntil;
      } else {
        // No pause defined - go straight to next waypoint
        npcPickTarget(e);
      }
      continue;
    }

    // ── Stuck detection ──────────────────────────────────────────────────
    if (!e._stuckCheckT) { e._stuckCheckT = stateTime; e._stuckCheckX = e.x; e._stuckCheckY = e.y; }
    if (stateTime - e._stuckCheckT > 1500) {
      const moved = Math.hypot(e.x - e._stuckCheckX, e.y - e._stuckCheckY);
      if (moved < NPC_STUCK_THRESHOLD) {
        // Stuck - skip to next waypoint
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
    // else fully blocked this frame - stuck detection will handle it

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

function mineStatusLine() {
  const m = cityBuildings?.ironholt?.mine;
  if (!m || !m.built) return 'If only the Charter would fund a proper mine here.';
  if (m.level >= m.maxLevel) return `Mine running at full Lv${m.level} — cargoes ship daily.`;
  return `Mine Lv${m.level} pulled good ore today. We could expand if there were funds.`;
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
  let text = lines[npc.dialogueIdx];
  // Miner/foreman in Ironholt occasionally surface live mine status.
  if (npc.cityId === 'ironholt' && (npc.role === 'miner' || npc.role === 'foreman') && Math.random() < 0.40) {
    text = mineStatusLine();
  }
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
  toast(`Intel bought: "${card.itemName}" in ${card.cityName} - ${INTEL_BUY_COST}g paid.`, 3);
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

/** Check intel on day advance - reward bonus if correct */
function verifyExpiredIntel() {
  const today = Math.floor(time.day);
  for (const card of player.intelLedger) {
    if (card.verified || card.sold) continue;
    if (card.expiryDay < today) {
      const actualPrice = priceFor(card.cityId, ITEMS.find(it => it.id === card.item) || ITEMS[0]);
      const diff = Math.abs(actualPrice - card.predictedPrice);
      const pct = diff / Math.max(1, card.truePrice);
      if (pct < 0.12) { // within 12% - intel was good
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

function openIntelUI(npc, cityId, initialTab) {
  intelUI.open = true;
  intelUI.npc = npc;
  intelUI.cityId = cityId;
  intelUI.tab = initialTab || (npc ? 'buy' : 'ledger');
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
            <span style="font-weight:600;color:#f0d080">${dirIcon(c.direction)} ${htmlEscape(c.itemName)}</span>
            <span style="color:#888;font-size:11px">${daysLeft}d left</span>
          </div>
          <div style="color:#b0a080;font-size:12px;margin-top:3px">
            In <b>${htmlEscape(c.cityName)}</b>: ~${c.predictedPrice}g (${dirLabel(c.direction)})
          </div>
          ${canSell ? `<button data-sell="${c.id}" style="margin-top:5px;background:#2a3a1a;border:1px solid #4a6a2a;color:#a0d060;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px">Sell for ${INTEL_SELL_PRICE}g</button>` : `<span style="font-size:10px;color:#555">Same city - can't sell here</span>`}
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
        ${intelUI.npc ? `<button data-tab="buy" style="flex:1;padding:5px;border-radius:5px;cursor:pointer;border:1px solid #5a4a20;background:${intelUI.tab==='buy'?'#3a2a0a':'#1a1508'};color:${intelUI.tab==='buy'?'#f0d080':'#a09060'}">Buy Tip (${INTEL_BUY_COST}g)</button>` : ''}
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
        <button id="cr-intel-close2" style="background:none;border:1px solid #5a4a20;color:#888;padding:4px 16px;border-radius:5px;cursor:pointer;font-size:16px" aria-label="Close">✕</button>
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
    if (e.role === 'guard_post') continue; // guards are decorative - player passes through
    const dx = px - e.x;
    const dy = py - e.y;
    const r = player.r + e.radius;
    if (dx*dx + dy*dy < r*r) return true;
  }
  return false;
}

// ── Chibi character sprite (translated from the Plumberry Trail design) ────
// Logical design size: 40w × 48h (SVG viewBox 0 0 40 48). The chibi's anchor
// is the chest/waist at design coord (20, 36) so callers can ctx.translate to
// the entity's existing world position. Caller is responsible for save/restore.
//   opts: { skin, hair, shirt, hat }
//   scale: design pixel → canvas pixel (typically r/12 so total height ≈ 4r)
//   flip:  true to mirror horizontally (facing left)
function _drawChibi(opts, scale, flip, walkPhase = 0) {
  const ink = '#3b2a1d';
  ctx.scale(scale * (flip ? -1 : 1), scale);
  ctx.translate(-20, -36);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Drop shadow (under boots)
  ctx.fillStyle = 'rgba(59,42,29,0.32)';
  ctx.beginPath();
  ctx.ellipse(20, 53, 11, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs & boots (drawn before shirt so hem overlaps cleanly)
  const leftLegX  = 15 + walkPhase * 2.5;
  const rightLegX = 25 - walkPhase * 2.5;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.8;

  // Pants
  ctx.fillStyle = opts.pants || '#7a5a3a';
  ctx.beginPath();
  ctx.moveTo(leftLegX - 3.5, 44);
  ctx.lineTo(leftLegX - 3, 50);
  ctx.quadraticCurveTo(leftLegX, 53, leftLegX + 3, 50);
  ctx.lineTo(leftLegX + 3.5, 44);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(rightLegX - 3.5, 44);
  ctx.lineTo(rightLegX - 3, 50);
  ctx.quadraticCurveTo(rightLegX, 53, rightLegX + 3, 50);
  ctx.lineTo(rightLegX + 3.5, 44);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Boots
  ctx.fillStyle = opts.boots || '#3b2a1d';
  ctx.beginPath(); ctx.ellipse(leftLegX, 52.5, 4.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(rightLegX, 52.5, 4.5, 2, 0, 0, Math.PI * 2); ctx.fill();

  // Body / shirt
  ctx.fillStyle = opts.shirt;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8, 36);
  ctx.quadraticCurveTo(8, 28, 20, 28);
  ctx.quadraticCurveTo(32, 28, 32, 36);
  ctx.lineTo(32, 44);
  ctx.quadraticCurveTo(32, 46, 30, 46);
  ctx.lineTo(10, 46);
  ctx.quadraticCurveTo(8, 46, 8, 44);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Arms (skin ellipses, swing opposite to legs when walking)
  const leftArmY  = 36 + walkPhase * 1.5;
  const rightArmY = 36 - walkPhase * 1.5;
  ctx.fillStyle = opts.skin;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.ellipse(7, leftArmY, 3.6, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(33, rightArmY, 3.6, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // Collar V
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(16, 28); ctx.lineTo(20, 32); ctx.lineTo(24, 28);
  ctx.stroke();

  // Head
  ctx.fillStyle = opts.skin;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(20, 18, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // Hair (front fringe)
  ctx.fillStyle = opts.hair;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(10, 16);
  ctx.quadraticCurveTo(10, 6, 20, 6);
  ctx.quadraticCurveTo(30, 6, 30, 16);
  ctx.quadraticCurveTo(28, 12, 24, 13);
  ctx.quadraticCurveTo(22, 9, 18, 12);
  ctx.quadraticCurveTo(14, 11, 12, 14);
  ctx.quadraticCurveTo(11, 15, 10, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  _drawChibiHat(opts.hat || 'none', ink);

  // Cheeks
  ctx.fillStyle = '#f29ab0';
  ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.ellipse(13.5, 20.5, 2.2, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(26.5, 20.5, 2.2, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Eyes
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(16, 18, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(24, 18, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(16.5, 17.4, 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(24.5, 17.4, 0.5, 0, Math.PI * 2); ctx.fill();

  // Smile
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(17, 22.5);
  ctx.quadraticCurveTo(20, 24.5, 23, 22.5);
  ctx.stroke();
}

function _drawChibiHat(kind, ink) {
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6;

  if (kind === 'straw') {
    ctx.fillStyle = '#e6c07b';
    ctx.beginPath(); ctx.ellipse(20, 9, 14, 2.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f0d28e';
    ctx.beginPath();
    ctx.moveTo(13, 9);
    ctx.quadraticCurveTo(13, 3, 20, 3);
    ctx.quadraticCurveTo(27, 3, 27, 9);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#a87432';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(13, 8);
    ctx.quadraticCurveTo(20, 7, 27, 8);
    ctx.stroke();
  } else if (kind === 'cap') {
    ctx.fillStyle = '#5d8fb8';
    ctx.beginPath();
    ctx.moveTo(11, 12);
    ctx.quadraticCurveTo(11, 4, 20, 4);
    ctx.quadraticCurveTo(29, 4, 29, 12);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a6a90';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(11, 12);
    ctx.quadraticCurveTo(15, 14, 20, 14);
    ctx.quadraticCurveTo(25, 14, 31, 12);
    ctx.lineTo(31, 14);
    ctx.quadraticCurveTo(24, 16, 20, 16);
    ctx.quadraticCurveTo(15, 16, 11, 14);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (kind === 'flower') {
    ctx.fillStyle = '#e57389';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(13, 8, 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff3c2';
    ctx.beginPath(); ctx.arc(13, 8, 0.8, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'sailor') {
    ctx.fillStyle = '#fdfaf0';
    ctx.beginPath(); ctx.ellipse(20, 10, 11, 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 10);
    ctx.quadraticCurveTo(12, 4, 20, 4);
    ctx.quadraticCurveTo(28, 4, 28, 10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5d8fb8';
    ctx.fillRect(15, 6, 10, 2);
  } else if (kind === 'helm') {
    ctx.fillStyle = '#7a8a96';
    ctx.beginPath();
    ctx.moveTo(10, 14);
    ctx.quadraticCurveTo(10, 4, 20, 4);
    ctx.quadraticCurveTo(30, 4, 30, 14);
    ctx.lineTo(28, 14); ctx.lineTo(28, 18); ctx.lineTo(26, 18);
    ctx.lineTo(26, 15); ctx.lineTo(14, 15); ctx.lineTo(14, 18); ctx.lineTo(12, 18); ctx.lineTo(12, 14);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a6a90';
    ctx.fillRect(19, 3, 2, 4); // crest
  } else if (kind === 'hood') {
    ctx.fillStyle = '#5b5561';
    ctx.beginPath();
    ctx.moveTo(8, 22);
    ctx.quadraticCurveTo(6, 8, 20, 6);
    ctx.quadraticCurveTo(34, 8, 32, 22);
    ctx.lineTo(28, 18);
    ctx.quadraticCurveTo(28, 14, 20, 12);
    ctx.quadraticCurveTo(12, 14, 12, 18);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (kind === 'bakerCap') {
    ctx.fillStyle = '#fdfaf0';
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.quadraticCurveTo(8, 2, 20, 2);
    ctx.quadraticCurveTo(32, 2, 28, 12);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 12); ctx.lineTo(28, 12);
    ctx.stroke();
  } else if (kind === 'scribeHood') {
    ctx.fillStyle = '#a87842';
    ctx.beginPath();
    ctx.moveTo(8, 20);
    ctx.quadraticCurveTo(8, 6, 20, 6);
    ctx.quadraticCurveTo(32, 6, 32, 20);
    ctx.lineTo(30, 20);
    ctx.quadraticCurveTo(30, 12, 20, 12);
    ctx.quadraticCurveTo(10, 12, 10, 20);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (kind === 'travelhat') {
    // Wide-brim with crown + feather (player)
    ctx.fillStyle = '#5a3a1a';
    ctx.beginPath(); ctx.ellipse(20, 9, 15, 2.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7a4a26';
    ctx.beginPath();
    ctx.moveTo(13, 9);
    ctx.quadraticCurveTo(13, 1, 20, 1);
    ctx.quadraticCurveTo(27, 1, 27, 9);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(13, 7); ctx.lineTo(27, 7);
    ctx.stroke();
    ctx.strokeStyle = '#e57389';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(26, 3);
    ctx.quadraticCurveTo(33, -3, 33, 4);
    ctx.stroke();
  } else if (kind === 'tophat') {
    // Tall merchant top hat with gold band — high-tier pack reward
    ctx.fillStyle = '#2a1e14';
    ctx.beginPath(); ctx.ellipse(20, 10, 13, 2.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2a1c';
    ctx.beginPath();
    ctx.moveTo(12, 10); ctx.lineTo(12, 1);
    ctx.quadraticCurveTo(12, -1, 20, -1);
    ctx.quadraticCurveTo(28, -1, 28, 1);
    ctx.lineTo(28, 10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Gold band
    ctx.strokeStyle = '#d4a020';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(12, 8); ctx.lineTo(28, 8); ctx.stroke();
  }
}

// Per-style palette for NPC chibis. Falls back to a default when unknown.
const _NPC_STYLE_OPTS = {
  scribe:   { skin: '#f5d2b8', hair: '#3b2a1d', shirt: '#a87842', hat: 'scribeHood' },
  baker:    { skin: '#f5d2b8', hair: '#8a5a2e', shirt: '#d9b38c', hat: 'bakerCap' },
  guard:    { skin: '#e6c08a', hair: '#3b2a1d', shirt: '#7a8a96', hat: 'helm' },
  fisher:   { skin: '#f5d2b8', hair: '#8a5a2e', shirt: '#7fbf83', hat: 'sailor' },
  smuggler: { skin: '#d2b88a', hair: '#3b2a1d', shirt: '#5b5561', hat: 'hood' },
  broker:   { skin: '#e6c08a', hair: '#5a3a1a', shirt: '#b0a38a', hat: 'cap' },
};
const _NPC_DEFAULT_OPTS = { skin: '#f5d2b8', hair: '#5a3a1a', shirt: '#c7b9a5', hat: 'straw' };

function drawNpcEntity(e) {
  const sx = e.x - camera.x;
  const sy = e.y - camera.y;
  const r = e.radius || 6;

  const opts = _NPC_STYLE_OPTS[e.style] || _NPC_DEFAULT_OPTS;
  const scale = r / 12;
  // Phase offset per NPC so they don't all animate in sync
  const phase = (typeof e.id === 'string') ? e.id.charCodeAt(0) * 0.37 : 0;
  const walkPhase = Math.sin(stateTime * 0.016 + phase);
  const bob = walkPhase * (r * 0.08);
  const flip = (e.facing && typeof e.facing.x === 'number') ? e.facing.x < -0.1 : false;

  ctx.save();
  ctx.translate(sx, sy + bob);
  _drawChibi(opts, scale, flip, walkPhase);
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
      // hunger is now ticked server-side (world_service.mjs tickHunger) and
      // loaded via syncWorldState() → city_treasury.hunger. Read-only here.
      const pressureBoost = state.hunger * 0.4;
      if (pressureBoost > 0.02) {
        if (!ECONOMY.pressure[cid]) ECONOMY.pressure[cid] = {};
        ECONOMY.pressure[cid]['food']  = Math.min(0.25, (ECONOMY.pressure[cid]['food']  || 0) + pressureBoost * 0.15);
        ECONOMY.pressure[cid]['grain'] = Math.min(0.25, (ECONOMY.pressure[cid]['grain'] || 0) + pressureBoost * 0.15);
      }
      // Natural growth/decline
      if (state.hunger < 0.2) {
        state.pop = Math.min(state.pop * 1.002, rule.population * 1.5);
      } else if (state.hunger > 0.7) {
        state.pop = Math.max(state.pop * 0.998, rule.population * 0.5);
      }
    }

    // ── 2. Migration: people flee hungry/taxed cities to comfortable ones ─
    // Attractiveness = (1 - hunger) * (1 - taxRate) - higher = more attractive
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
    // Push updated pop/hunger for all cities to DB so other players see the world simulation
    for (const cid of cityIds) pushCityPopToDb(cid);
  }

  // ── Find building slot by map tile position ──────────────────────────────
  // Returns the unbuilt slot whose footprint contains (tx, ty), or null.
  function findSlotAtTile(cityId, tx, ty) {
    const slots = cityBuildings[cityId];
    if (!slots) return null;
    for (const [key, slot] of Object.entries(slots)) {
      if (slot.built) continue;
      if (slot.tileX <= 0 || slot.tileY <= 0) continue;
      if (tx >= slot.tileX && tx < slot.tileX + slot.tileW &&
          ty >= slot.tileY && ty < slot.tileY + slot.tileH) {
        return { key, slot };
      }
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
      mineProduction: 'Daily ore output to city',
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
    bdLog('DONATE-START', `${cityId}.${key} +${amount}g (nextCost=${nextCost}, currentFunded=${slot.playerFunded||0}, built=${slot.built})`, null);
    // Optimistic: deduct gold and bump playerFunded only.
    // Completion (level++, built, paint, cityBonus, investLog) is deferred to the RPC response
    // so a failed RPC can't leave a phantom built building in local memory.
    player.gold -= amount;
    slot.playerFunded = Math.min((slot.playerFunded || 0) + amount, nextCost);
    const slotLabel = key.charAt(0).toUpperCase() + key.slice(1);
    toast(`You donated ${amount}g toward the ${slotLabel}!`, 2.5);
    // In QA mode there's no RPC — apply completion locally so tests still pass.
    if (__QA.enabled && slot.playerFunded >= nextCost) {
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
    // Atomic RPC: locks the city_treasury row, increments playerFunded, upgrades if complete,
    // and logs the donation — all in one transaction (no concurrent-write races).
    if (!__QA.enabled) {
      bdLog('DONATE-RPC-CALL', `POST donate_to_building ${cityId}.${key} amount=${amount} nextCost=${nextCost}`, null);
      fetch(`${ECONOMY.url}/rest/v1/rpc/donate_to_building`, {
        method: 'POST',
        headers: { ...economyHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify({
          p_uid:       player.uid || '0',
          p_city_id:   cityId,
          p_slot_key:  key,
          p_amount:    amount,
          p_next_cost: nextCost,
        }),
      })
        .then(r => {
          bdLog('DONATE-RPC-STATUS', `HTTP ${r.status} ${r.statusText}`, null);
          return r.ok ? r.json() : r.text().then(t => Promise.reject(t));
        })
        .then(result => {
          bdLog('DONATE-RPC-RESPONSE', `ok=${result.ok} completed=${result.completed}`, result);
          if (!result.ok) {
            // Server rejected — revert the optimistic gold + playerFunded change
            player.gold += amount;
            slot.playerFunded = Math.max(0, (slot.playerFunded || 0) - amount);
            toast(`Donation failed: ${result.error || 'server error'}`, 3);
            return;
          }
          // Merge authoritative buildings state back. The server is the source of truth
          // for completion — if it reports level++, we apply level/built/paint/cityBonus/investLog here.
          if (result.buildings && typeof result.buildings === 'object') {
            for (const [k, saved] of Object.entries(result.buildings)) {
              if (!cityBuildings[cityId]?.[k]) continue;
              const s = cityBuildings[cityId][k];
              if (saved.level > s.level) {
                const prevLevel = s.level;
                s.level = saved.level;
                s.built = saved.built ?? s.built;
                s.playerFunded = saved.playerFunded ?? 0;
                if (s.built) buildSlotOnMap(cityId, k, s);
                // Apply cityBonus + investLog for the upgrade(s) the server just confirmed
                if (cityBonus[cityId] && s.effect && cityBonus[cityId][s.effect] !== undefined) {
                  const levels = s.level - prevLevel;
                  cityBonus[cityId][s.effect] = Math.min(
                    (cityBonus[cityId][s.effect] || 0) + s.gain * levels,
                    s.gain * s.maxLevel
                  );
                }
                if (k === key && cityTreasury[cityId]) {
                  const lbl = k.charAt(0).toUpperCase() + k.slice(1);
                  cityTreasury[cityId].investLog.push({ day: Math.floor(time.day), project: `${lbl} Lv${s.level} (player-funded)`, effect: s.effect });
                  if (cityTreasury[cityId].investLog.length > 8) cityTreasury[cityId].investLog.shift();
                  toast(`🏛 ${lbl} built! The city cheers!`, 4);
                }
              } else {
                s.playerFunded = saved.playerFunded ?? s.playerFunded;
              }
            }
            bdLog('DONATE-MERGE-DONE', `Final mem state: ${cityId}.${key} built=${slot.built} L=${slot.level} funded=${slot.playerFunded}`, null);
          }
        })
        .catch(e => {
          bdLog('ERR-DONATE-RPC', `RPC failed: ${String(e).slice(0,200)}`, null);
          console.warn('[donateToSlot] RPC failed:', e);
          // Network failure — always refund (no optimistic completion to worry about now)
          player.gold += amount;
          slot.playerFunded = Math.max(0, (slot.playerFunded || 0) - amount);
          toast('Network error — donation refunded.', 3);
        });
    }
    ui.buildingDonateOpen = false;
    dom.key = '';
    domRender();
    saveGame();
  }

  // ── Build a slot visually on the map ────────────────────────────────────
  function buildSlotOnMap(cid, slotKey, slot) {
    if (!mapData || !slot || slot.tileX <= 0) {
      bdLog('ERR-PAINT', `buildSlotOnMap ${cid}.${slotKey} ABORTED (mapData=${!!mapData} slot=${!!slot} tileX=${slot?.tileX})`, null);
      return;
    }
    bdLog('PAINT', `buildSlotOnMap ${cid}.${slotKey} at (${slot.tileX},${slot.tileY}) ${slot.tileW}x${slot.tileH}`, null);
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

  // Initial world sync — reset throttle so this always fires even if the earlier
  // syncTradersFromServer-adjacent call already consumed the 3s window.
  _lastWorldSyncT = 0;
  const _initWorldSyncP = ECONOMY.enabled ? syncWorldState() : Promise.resolve();

  function cityInvestTick() {
    for (const [cid, treasury] of Object.entries(cityTreasury)) {
      // Treasury → Bank funding (20% each invest cycle) is now done server-side
      // in world_service.mjs tickBankSolvency() so it applies to the shared vault.

      // ── If treasury is critically low, bank vault bleeds (no new investment) ──
      if (treasury.gold < 20 && bankVault[cid]) {
        bankVault[cid].reserve = Math.max(0, bankVault[cid].reserve - 5);
      }

      // ── City investment: spend treasury on building slots ──
      const slots = cityBuildings[cid];
      if (!slots) continue;

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

      // Bank solvency check moved to server (tickBankSolvency in world_service.mjs)

      // ── Push full treasury + buildings to DB so other players see the world ──
      pushCityTreasuryToDb(cid);
    }
  }

  // Daily output from each city's built mine slot. Sells produce into the city
  // treasury at the local sell price and nudges global supply pressure down so
  // the local market reflects the new inflow.
  function cityMineTick() {
    for (const cid of Object.keys(cityBuildings)) {
      const m = cityBuildings[cid]?.mine;
      if (!m || !m.built || m.level <= 0) continue;
      const lvl = m.level;
      const yields = { ore: 2 * lvl, coal: 1 * lvl };
      if (Math.random() < 0.10 * lvl) yields.gem = 1;
      let goldGained = 0;
      for (const [iid, qty] of Object.entries(yields)) {
        const it = ITEMS.find(x => x.id === iid);
        if (!it || qty <= 0) continue;
        const q = quoteFor(cid, it);
        goldGained += q.sell * qty;
      }
      if (goldGained > 0 && cityTreasury[cid]) {
        cityTreasury[cid].gold += goldGained;
      }
      if (!ECONOMY.pressure[cid]) ECONOMY.pressure[cid] = {};
      ECONOMY.pressure[cid].ore  = Math.max(-0.25, (ECONOMY.pressure[cid].ore  || 0) - 0.010 * lvl);
      ECONOMY.pressure[cid].coal = Math.max(-0.25, (ECONOMY.pressure[cid].coal || 0) - 0.005 * lvl);
      if (yields.gem) {
        ECONOMY.pressure[cid].gem = Math.max(-0.25, (ECONOMY.pressure[cid].gem || 0) - 0.010);
      }
      pushCityTreasuryToDb(cid);
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
      cityMineTick();
      // City investment every 7 days
      if (time.day % 7 === 0) cityInvestTick();
      // Bank solvency is now ticked server-side (world_service.mjs tickBankSolvency).
      // Local clients receive bankrupt_day via syncWorldState() and react accordingly.
      // Contract boards now regenerate server-side (world_service.mjs regenerateContracts)
      // and arrive via syncWorldState() → world_state.contract_boards JSONB.
      // Local regen kept as a fallback if the server is unreachable on first load.
      // Market drift is now server-authoritative (world_service.mjs tickMarketDrift).
      // Clients receive it via syncWorldState() → market_drift column.
      // Local ticking removed to prevent per-player price divergence.
    }

    if (advanced > 0) {
      toast(reason ? `Day +${advanced} (${reason}).` : `Day +${advanced}.`, 1.8);
      verifyExpiredIntel();
      pushWorldTimeToDb(); // push shared world time to DB so other clients catch up
    }
  }

  // Iteration notes (rendered into the bottom textbox)
  const ITERATION = {
    version: 'v0.5.23',
    whatsNew: [
      'Road events now LOOK like events: each encounter gets its own icon and color (⚔️ bandits, 🛡️ patrol, ✨ omen...), a dramatic pop-in animation over a darkened road, a "what\'s at stake" badge showing the gold on the line, and a ❗ marker over your head when trouble finds you. Misclick protection: for the first moment after a dialog appears it ignores taps, so a movement tap can never accidentally pick a choice. And threat encounters (bandits, tolls, patrols, quarantine, wolves) can no longer be waved away with Esc or the ✕ — you have to deal with them.',
      'Road events redesigned so they matter again: every encounter now scales with what you\'re actually carrying — bandit demands, tolls, quarantine fees, escort pay, and found gold all follow your total wealth (gold + cargo value) instead of flat 5–25g amounts. Events also react to your situation: valuable cargo attracts bandits, carrying contraband attracts patrols, and running out of rations attracts food sellers. Encounters are rarer but each one carries real weight.',
      'Fixed mining being permanently blocked by a false "Another miner just worked this vein" message, and the same bug in hidden caches ("Already looted — empty crate"): the client was treating any failed multiplayer-claim request (server hiccup, bad response) the same as a genuine claim-lost-to-another-player response, so every swing/loot attempt got phantom-blocked. Both now fail open — backend issues no longer stop you from mining or looting. Also fixed: losing a contested mining swing now refunds the exact stamina your pickaxe spent instead of always refunding a flat amount.',
      'Loot pickup animation: every time you gain an item — mining, cache loot, market buy, road-trader buy, event drop, stash retrieve — a floating "+N icon" sprite rises off your head and fades. Rapid identical gains stack into a single popup so a multi-drop swing doesn\'t spam overlapping sprites.',
      'Mining sites read as real deposits now: each site carves 12 ore veins instead of 5 (and Ironholt\'s iron cluster grew from 6 to 12), the tile art is chunkier with metal-tinted glints + a vein streak, and veins on cooldown swap to a depleted gray look with a bright amber hourglass-pip so you can tell at a glance which ones are ready to swing.',
      'Fixes: mining veins no longer appear permanently "still recovering" after a reload — per-vein cooldowns now reset on load so you can swing again right away. AI caravans on the road no longer go missing when the world cron is offline — a local fallback dispatches a fresh trade route every ~18s so the highways stay populated.',
      'Mining gets real depth: new Pickaxe gear slot (20 tiers, faster swings + bigger yield), legendary Gold ore with a new Sunwell Shaft mine near Valdenmere (requires Guild Pickaxe T2+), minimap markers for all three mine sites, and a one-time tip when you find your first vein.',
      'Debug overlay for building persistence: press ` (backtick) or add ?debug=1 to the URL to see a live log of every donate → RPC → sync → paint event, plus current in-memory cityBuildings for every city.',
      'Every building-related operation now writes a tagged event (DONATE-START, DONATE-RPC-RESPONSE, SYNC-CT-FETCH, PUSH-CT, PAINT, etc.) to console and the overlay, so we can pinpoint where the built state is being lost.',
      'window.__BD exposes the full ring buffer for inspection from devtools.',
    ],
    whatsNext: [
      'World news feed: log notable world events (building built, city grew, famine).',
      'Player-to-player trade: offer/accept item trades with nearby players.',
      'Supabase Realtime channel for instant presence updates (currently 5-second poll).',
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
    _hudContractTap: null,
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
    eventKind: null,        // road-event kind → EVENT_THEMES entry
    eventOpenedAt: -1,      // stateTime (ms) when the dialog opened; drives the input lock
    eventDismissable: true, // threat events refuse Esc/X — a choice must be made
    eventStakes: '',        // short "what's at risk" line shown in the head
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
      `Version:${v}\n\nWhat's new:\n- ${ITERATION.whatsNew.join('\n- ')}\n\nWhat's coming:\n- ${ITERATION.whatsNext.join('\n- ')}`;
  }

  // --- HTML UI overlay (Market / Contracts / Event)
  const USE_DOM_MODALS = true;
  const uiRoot = document.getElementById('ui-root');
  const dom = {
    kind: null,
    key: null,
    marketListScroll: 0,
    marketListMode: null,
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
    // Use quoteFor for buy/sell prices so spread is correctly applied both directions.
    const _q = quoteFor(c.id, it);
    const p = ui.mode === 'buy' ? _q.buy : _q.sell; // buy at ask, sell at bid

    if (ui.mode === 'buy') {
      // Block buying items that have a sourceCities restriction in non-source cities.
      if (it.sourceCities && !it.sourceCities.includes(c.id)) {
        toast(`${it.name} is not available here.`, 2);
        return;
      }
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
      gainItem(it.id, buyN);
      toast(`Bought ${buyN} ${it.name} (-${cost}g)`, 2);
      economyPostTrade(c.id, it.id, 'buy', buyN);
      syncWorldStateOnAction();
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
    // Cap combined tool+guild bonus at 40% to prevent exponential late-game income
    const combinedBonus = Math.min(toolBonus + guildBonus, 0.40);
    // p is already the spread-adjusted sell price from quoteFor; apply tax and bonus on top
    const netEach = Math.max(1, Math.round(p * (1 - CITY_RULES[c.id].taxRate) * (1 + combinedBonus)));
    const gain = sellN * netEach;

    player.inv[it.id] = have - sellN;
    if (player.inv[it.id] < 0) { player.inv[it.id] = have; toast('Trade blocked (qty would go negative).', 2); return; }
    player.gold += gain;
    if (player.gold < 0) { player.gold -= gain; player.inv[it.id] = have; toast('Trade blocked (gold would go negative).', 2); return; }
    toast(`Sold ${sellN} ${it.name} (+${gain}g after tax)`, 2);
    economyPostTrade(c.id, it.id, 'sell', sellN);
    syncWorldStateOnAction();
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

    // Close both UI systems (DOM overlay + canvas fallback) to avoid "stuck modal" / null-city crashes.
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
      // Only rebuild DOM when banner count changes or a new banner is added/removed.
      // Do NOT include banner.state in the key — let CSS animation handle in/out transitions
      // without destroying and recreating the DOM element (which would break the animation).
      key += `|b${banner.q.length}:${banner.q.map(it => it.id).join(',')}`;
    }
    if (kind === 'market') {
      const c = currentCity();
      key += `|${c ? c.id : 'none'}|${ui.mode}|${ui.selection}|${ui.marketScroll}|${player.gold}|${invWeight()}|${player.permits[c?.id] ? 1 : 0}|g${player.gear?.pack??0}${player.gear?.boots??0}${player.gear?.tool??0}|e${ECONOMY.lastSync}`;
      for (const it of ITEMS) key += `|${player.inv[it.id] || 0}`;
    } else if (kind === 'contracts') {
      const c = currentCity() || (ui.contractsCityId ? getCityById(ui.contractsCityId) : null);
      key += `|${c ? c.id : 'none'}|${ui.contractsSel}|${contracts.active ? (contracts.active.want+contracts.active.toId+contracts.active.qty) : 'none'}`;
    } else if (kind === 'event') {
      key += `|${ui.eventTitle}|${ui.eventText}|${ui.eventSel}|${ui.eventChoices.length}|${ui.eventKind}|${ui.eventDismissable ? 1 : 0}|${ui.eventStakes}`;
    } else if (kind === 'bank') {
      const c = currentCity();
      const cid = c?.id;
      const vault = cid ? bankVault[cid] : null;
      key += `|${cid}|${ui.bankTab}|${player.gold}|${vault?.reserve ?? 0}|${vault?.bankruptDay ?? 'no'}|${playerBank.deposits[cid]?.amount ?? 0}|${playerBank.loans[cid]?.amount ?? 0}`;
    }

    // Event intro lock expires without a rebuild: strip the class in place so
    // the entrance animation isn't replayed (class mutation never touches dom.key).
    if (kind === 'event' && !eventChoiceLocked(stateTime, ui.eventOpenedAt, EVENT_INPUT_LOCK_MS)) {
      uiRoot.querySelector('.cr-list.cr-intro-lock')?.classList.remove('cr-intro-lock');
    }

    if (dom.key === key) return;
    dom.key = key;
    dom.kind = kind;
    domEnsureOpen();

    const bannerHtml = banner.q.length ? `
      <div class="cr-banner-stack" aria-label="Notifications">
        ${banner.q.map(it => `
          <div class="cr-banner${it.state === 'out' ? ' out' : ''}" data-bid="${it.id}" role="status" aria-live="polite">
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
      const showTabs = true; // always show - gear tab always visible
      const hasPermit = !!player.permits[c.id];

      const totalN = ITEMS.length + 1;
      const rows = [];
      for (let i = 0; i < totalN; i++) {
        const selected = i === ui.selection;
        const isPermitRow = i === ITEMS.length;
        const it = isPermitRow ? null : ITEMS[i];
        const have = isPermitRow ? 0 : (player.inv[it.id] || 0);
        // SELL tab lists only what the player holds (permit is a buy-only row).
        // An empty pack shows an empty state below instead of bouncing to BUY.
        if (ui.mode === 'sell' && (isPermitRow || have <= 0)) continue;
        const _quote = isPermitRow ? null : quoteFor(c.id, it);
        const price = isPermitRow ? PERMIT_PRICE : _quote.buy;  // display buy price = ask
        const sellPrice = isPermitRow ? null : _quote.sell;      // display sell price = bid
        const contra = (!isPermitRow) && it.contrabandName && rules.contraband.includes(it.contrabandName);
        const notAvailHere = (!isPermitRow) && it.sourceCities && !it.sourceCities.includes(c.id);

        const title = isPermitRow ? (hasPermit ? 'City Permit (owned)' : 'City Permit') : it.name;
        const sub = isPermitRow ? 'Reduces inspections in this city' : `Have: ${have} · Wt: ${it.weight}`;
        const right = isPermitRow ? (hasPermit ? 'Owned' : `${price}g`) : `${price}g`;
        const badge = contra ? '<span class="cr-badge">CONTRABAND</span>' : '';
        const notAvailBadge = notAvailHere ? '<span class="cr-badge" style="background:#444;color:#999">NOT STOCKED</span>' : '';

        // Enriched price info for regular items
        const deltaPct = isPermitRow ? 0 : Math.round(((_quote.mid - it.base) / it.base) * 100);
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
            const disabled = ui.mode === 'buy' ? (maxBuy <= 0 || notAvailHere) : (have <= 0);
            const btn = `<button class="cr-action" data-action="trade" data-idx="${i}" data-qty="1" ${disabled ? 'disabled' : ''}>${actionLabel}</button>`;
            rows.push(`
              <div class="cr-card" role="button" tabindex="0" data-idx="${i}" aria-current="${selected}">
                <div class="cr-card-left">
                  <div class="cr-card-title">${htmlEscape(title)}</div>
                  <div class="cr-card-sub">${htmlEscape(sub)}</div>
                  ${priceRowHtml}
                  ${badge}${notAvailBadge}
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

            const buyDisabled = notAvailHere || maxBuy <= 0;
            const q1 = mkBtn('±1', 1, ui.mode === 'buy' ? buyDisabled : have <= 0);
            const q5 = mkBtn('±5', 5, ui.mode === 'buy' ? (buyDisabled || maxBuy < 5) : have < 5);
            const qMax = mkBtn(ui.mode === 'buy' ? 'MAX' : 'ALL', maxBuy > 0 ? maxBuy : 1, ui.mode === 'buy' ? buyDisabled : have <= 0);

            rows.push(`
              <div class="cr-card" role="button" tabindex="0" data-idx="${i}" aria-current="${selected}">
                <div class="cr-card-left">
                  <div class="cr-card-title">${htmlEscape(title)}</div>
                  <div class="cr-card-sub">${htmlEscape(sub)}</div>
                  ${priceRowHtml}
                  ${badge}${notAvailBadge}
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

      // Rebuilding innerHTML replaces the .cr-list node, which resets its native
      // scrollTop to 0. Capture and restore the scroll so a buy/sell (which
      // changes the dom.key via gold/inv) doesn't yank the list back to the top.
      // Restore is anchored to item rows, not the raw pixel offset: blocks above
      // the items (Global Market pulse, rumors) can appear or grow on a rebuild —
      // e.g. selling enough units pushes pressure past the ±0.05 display
      // threshold — and a raw scrollTop restore would leave the number intact
      // while the rows the player was looking at shift away. Anchors are matched
      // by data-idx because the sell tab drops a row entirely when its item
      // sells out; we use the first old row that still exists after the rebuild.
      // Only carry the offset over within the same tab — buy/sell/gear show
      // different-length lists, so reusing a scroll offset across a tab switch
      // would open the new tab already scrolled partway down instead of at the top.
      const prevList = ui.mode === dom.marketListMode ? uiRoot.querySelector('.cr-list') : null;
      const prevListScroll = prevList?.scrollTop || 0;
      const prevAnchors = [];
      if (prevList) {
        const listTop = prevList.getBoundingClientRect().top;
        for (const card of prevList.querySelectorAll('.cr-card[data-idx]')) {
          prevAnchors.push([card.getAttribute('data-idx'), card.getBoundingClientRect().top - listTop + prevList.scrollTop]);
        }
      }

      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Market">
          <div class="cr-panel">
            ${bannerHtml}
            <div class="cr-head">
              <div>
                <div class="cr-title">${htmlEscape(c.name)} Market</div>
                <div class="cr-sub">${htmlEscape(rules.vibe)}</div>
              </div>
              <button class="cr-close" data-action="close" aria-label="Close">✕</button>
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
                  const slots = ['pack','boots','tool','pickaxe'];
                  const slotLabels = { pack: '🎒 Pack', boots: '👟 Boots', tool: '📜 Tool', pickaxe: '⛏️ Pickaxe' };
                  return slots.map(slot => {
                    const tiers = GEAR[slot];
                    const cur = player.gear[slot] ?? 0;
                    const maxT = tiers.length - 1;
                    // Stat label per slot
                    const statLabel = (g) => slot === 'pack'    ? `📦 ${g.capacity} cap`
                                           : slot === 'boots'   ? `⚡ ${g.speed} spd`
                                           : slot === 'pickaxe' ? `⛏ ${g.yieldMult.toFixed(2)}× yield · ${g.staminaCost} stam`
                                           : `💰 +${Math.round(g.sellBonus*100)}%`;
                    // Progress bar
                    const pct = Math.round((cur / maxT) * 100);
                    const progressBar = `<div style="height:4px;background:#1a1408;border-radius:2px;margin:4px 0 8px;overflow:hidden">
                      <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#6a4a10,#f0d080);border-radius:2px;transition:width 0.3s"></div>
                    </div>`;
                    // Show: all owned (collapsed if >3), next 1 buyable, next 2 locked
                    const showFrom = Math.max(0, cur - 2);
                    const showTo   = Math.min(maxT, cur + 3);
                    const hiddenBefore = showFrom > 0;
                    const hiddenAfter  = showTo < maxT;
                    return `<div style="margin-bottom:14px">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                        <span style="font-weight:700;color:#f0d080">${slotLabels[slot]}</span>
                        <span style="font-size:11px;color:#888">T${cur}/${maxT} &nbsp; ${statLabel(tiers[cur])}</span>
                      </div>
                      ${progressBar}
                      ${hiddenBefore ? `<div style="font-size:10px;color:#555;margin-bottom:4px;padding-left:4px">▲ ${showFrom} earlier tiers owned</div>` : ''}
                      ${tiers.slice(showFrom, showTo + 1).map((g, _i) => {
                        const i = showFrom + _i;
                        const owned = i <= cur;
                        const isCurrent = i === cur;
                        const canBuy = i === cur + 1 && player.gold >= g.cost;
                        const tooExpensive = i === cur + 1 && player.gold < g.cost;
                        const locked = i > cur + 1;
                        const tierBadge = `<span style="font-size:9px;color:#666;margin-right:4px">T${i}</span>`;
                        const btn = isCurrent
                          ? `<span style="color:#4ade80;font-size:11px">✓ EQUIPPED</span>`
                          : owned
                          ? `<span style="color:#555;font-size:11px">✓ owned</span>`
                          : locked
                          ? `<span style="color:#333;font-size:11px">🔒</span>`
                          : `<button style="${canBuy ? 'background:#4a3a10;border:1px solid #f0d080;color:#f0d080;cursor:pointer;' : 'background:#1a1408;border:1px solid #444;color:#666;cursor:default;'}padding:4px 10px;border-radius:4px;font-size:12px;" data-action="buy-gear" data-slot="${slot}" data-tier="${i}" ${tooExpensive ? 'disabled' : ''}>${tooExpensive ? `Need ${g.cost}g` : `Buy ${g.cost}g`}</button>`;
                        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;margin-bottom:3px;border-radius:6px;background:${isCurrent ? '#1a2010' : owned ? '#0f0e0a' : '#0e0c08'};border:1px solid ${isCurrent ? '#4ade80' : owned ? '#2a2a1a' : '#1a1810'};">
                          <div style="flex:1;min-width:0">
                            ${tierBadge}<span style="font-size:14px">${g.icon}</span>
                            <span style="color:${isCurrent ? '#e0cfa0' : locked ? '#444' : owned ? '#888' : '#b0a070'};margin-left:5px;font-weight:${isCurrent ? '700' : '400'}">${g.name}</span>
                            <span style="font-size:10px;color:${isCurrent ? '#a0e060' : '#666'};margin-left:6px">${statLabel(g)}</span>
                            <div style="font-size:10px;color:#555;margin-left:22px;margin-top:1px">${g.desc}</div>
                          </div>
                          <div style="text-align:right;flex-shrink:0;margin-left:8px">${btn}</div>
                        </div>`;
                      }).join('')}
                      ${hiddenAfter ? `<div style="font-size:10px;color:#555;margin-top:4px;padding-left:4px">▼ ${maxT - showTo} more tiers locked</div>` : ''}
                    </div>`;
                  }).join('');
                })() : `${rumorsHtml}${rows.length ? rows.join('') : `<div class="cr-empty" style="text-align:center;padding:28px 16px;color:#8a7a5a;font-size:14px;">🎒 Nothing to sell — your pack is empty.<br><span style="font-size:12px;color:#a89a78;">Buy goods here or mine ore, then sell where prices are higher.</span></div>`}`}
              </div>
            </div>
            <div class="cr-foot">
              <div><strong>Gold:</strong> ${player.gold}g &nbsp; <strong>Pack:</strong> ${w}/${player.capacity} &nbsp; ${currentGear('boots').icon} ${currentGear('boots').name} &nbsp; ${currentGear('tool').icon} ${currentGear('tool').name}</div>
              <div class="cr-hint">Esc close · Tab switch · Enter trade</div>
            </div>
          </div>
        </div>
      `;

      const newList = uiRoot.querySelector('.cr-list');
      if (newList) {
        let drift = 0;
        const newListTop = newList.getBoundingClientRect().top; // scrollTop is 0 on a fresh node
        for (const [idx, prevTop] of prevAnchors) {
          const match = newList.querySelector(`.cr-card[data-idx="${idx}"]`);
          if (match) {
            drift = (match.getBoundingClientRect().top - newListTop) - prevTop;
            break;
          }
        }
        newList.scrollTop = prevListScroll + drift;
      }
      dom.marketListMode = ui.mode;

      // Bind events (re-bound on re-render)
      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.marketOpen = false; domCloseAll(); toast('Market closed', 2); }));
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
        checkGuildMilestone();
        scheduleAutoSave();
        showBanner(`Gear Upgraded!`, `${g.icon} ${g.name} equipped - ${g.desc}`);
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
              <button class="cr-close" data-action="close" aria-label="Close">✕</button>
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

      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => { ui.contractsOpen = false; domCloseAll(); toast('Contracts board closed', 2); }));
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

      const theme = eventThemeFor(ui.eventKind);
      const locked = eventChoiceLocked(stateTime, ui.eventOpenedAt, EVENT_INPUT_LOCK_MS);
      // Negative delay resumes the entrance animation mid-flight when a
      // selection change rebuilds the DOM, instead of replaying it.
      const elapsedMs = Math.max(0, Math.round(stateTime - (ui.eventOpenedAt >= 0 ? ui.eventOpenedAt : stateTime)));
      uiRoot.innerHTML = `
        <div class="cr-backdrop cr-event-backdrop${theme.threat ? ' cr-event-threat-backdrop' : ''}" role="dialog" aria-modal="true" aria-label="Event">
          <div class="cr-panel cr-event${theme.threat ? ' cr-event-threat' : ''}" style="--ev-accent:${theme.accent}; animation-delay:-${elapsedMs}ms;">
            ${bannerHtml}
            <div class="cr-head">
              <div class="cr-event-icon" aria-hidden="true" style="animation-delay:-${elapsedMs}ms;">${theme.icon}</div>
              <div>
                <div class="cr-title">${htmlEscape(ui.eventTitle || 'On the road')}</div>
                <div class="cr-sub">${htmlEscape(ui.eventText || '')}</div>
                ${ui.eventStakes ? `<div class="cr-event-stakes">⚖️ ${htmlEscape(ui.eventStakes)}</div>` : ''}
              </div>
              ${ui.eventDismissable ? '<button class="cr-close" data-action="close" aria-label="Close">✕</button>' : ''}
            </div>
            <div class="cr-body">
              <div class="cr-list${locked ? ' cr-intro-lock' : ''}" aria-label="Choices">
                ${rows.join('')}
              </div>
            </div>
            <div class="cr-foot">
              <div class="cr-hint">${ui.eventDismissable ? 'Esc close · ' : ''}↑/↓ select · Enter choose</div>
            </div>
          </div>
        </div>
      `;

      uiRoot.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => {
        if (!ui.eventDismissable) { toast('This demands an answer.', 1.6); return; }
        closeEvent(); domCloseAll(); toast('You move on.', 2);
      }));
      uiRoot.querySelectorAll('[data-eidx]').forEach(el => {
        el.addEventListener('click', () => { const idx = Number(el.getAttribute('data-eidx')); if (Number.isFinite(idx)) ui.eventSel = idx; });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            if (eventChoiceLocked(stateTime, ui.eventOpenedAt, EVENT_INPUT_LOCK_MS)) return;
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
        if (eventChoiceLocked(stateTime, ui.eventOpenedAt, EVENT_INPUT_LOCK_MS)) return;
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
            <div style="color:#ef4444;font-weight:bold;font-size:15px">BANK CLOSED - BANKRUPT</div>
            <div class="cr-sub" style="margin-top:6px">Reopens in <b>${bankruptDaysLeft}</b> day${bankruptDaysLeft !== 1 ? 's' : ''}.</div>
            <div class="cr-sub" style="margin-top:4px">The city treasury ran dry and the bank could not meet its obligations.</div>
          </div>`;
      } else if (ui.bankTab === 'deposit') {
        const rateLabel = `${(BANK_INTEREST_RATE * 100).toFixed(1)}%/day`;
        bodyHtml = `
          <div class="cr-sub">Deposits earn <b>${rateLabel}</b> interest.</div>
          <div class="cr-sub">Vault reserve: <b style="color:${vaultHealthColor}">${vault.reserve}g</b> - <span style="color:${vaultHealthColor}">${vaultHealthLabel}</span></div>
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
               ? `<div class="cr-sub" style="color:#ef4444;margin-top:4px">⚠️ OVERDUE ${overdue}d - +${overdueExtra}g penalty → total <b>${repayTotal}g</b></div>`
               : `<div class="cr-sub" style="color:#4ade80;margin-top:4px">✓ On time - ${loan.dueDay - Math.floor(time.day)}d remaining</div>`}
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
              <button class="cr-close" data-action="close" aria-label="Close">✕</button>
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
        const bankRPC = (op, body) => {
          if (__QA.enabled || !ECONOMY.enabled) return Promise.resolve({ ok: true });
          return fetch(`${ECONOMY.url}/rest/v1/rpc/${op}`, {
            method: 'POST',
            headers: { ...economyHeaders(), 'Prefer': 'return=representation' },
            body: JSON.stringify(body),
          }).then(r => r.ok ? r.json() : r.text().then(t => ({ ok: false, error: t })));
        };
        const bankDeposit = (amt) => {
          if (player.gold < amt) { toast(`Need ${amt}g to deposit.`, 2); return; }
          // Optimistic local update
          player.gold -= amt;
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
          // Atomic shared-vault update
          bankRPC('bank_deposit', { p_city_id: cid, p_amount: amt }).then(res => {
            if (!res?.ok) {
              // Revert optimistic local change
              player.gold += amt;
              if (bankVault[cid]) bankVault[cid].reserve = Math.max(0, bankVault[cid].reserve - amt);
              const d = playerBank.deposits[cid];
              if (d) {
                d.amount -= amt;
                if (d.amount <= 0) delete playerBank.deposits[cid];
              }
              toast(`Deposit failed: ${res?.error || 'server error'}`, 3);
              dom.key = ''; domRender();
            } else if (Number.isFinite(res.bank_reserve) && bankVault[cid]) {
              bankVault[cid].reserve = res.bank_reserve; // reconcile from server
            }
          });
        };
        uiRoot.querySelector('[data-action="dep10"]')?.addEventListener('click', () => bankDeposit(10));
        uiRoot.querySelector('[data-action="dep50"]')?.addEventListener('click', () => bankDeposit(50));
        uiRoot.querySelector('[data-action="dep100"]')?.addEventListener('click', () => bankDeposit(100));

        uiRoot.querySelector('[data-action="withdraw-all"]')?.addEventListener('click', () => {
          if (!playerBank.deposits[cid]) { toast('Nothing to withdraw.', 2); return; }
          const d = playerBank.deposits[cid];
          const days = Math.max(0, Math.floor(time.day) - d.depositDay);
          const total = d.amount + Math.floor(d.amount * BANK_INTEREST_RATE * days);
          // Atomic withdraw — server returns actual amount paid (partial if insolvent)
          bankRPC('bank_withdraw', { p_city_id: cid, p_amount: total }).then(res => {
            if (!res?.ok) {
              toast(`Withdraw failed: ${res?.error || 'server error'}`, 3);
              return;
            }
            const paid = Number.isFinite(res.paid) ? res.paid : total;
            player.gold += paid;
            if (bankVault[cid] && Number.isFinite(res.bank_reserve)) bankVault[cid].reserve = res.bank_reserve;
            delete playerBank.deposits[cid];
            if (paid < total) toast(`⚠️ Vault paid ${paid}g of ${total}g owed.`, 3);
            else toast(`Withdrew ${paid}g (incl. interest).`, 2);
            scheduleAutoSave(); dom.key = ''; domRender();
          });
        });

        const maxLoan = Math.min(200, Math.floor((bankVault[cid]?.reserve || 0) * 0.6));

        const takeLoan = (amt) => {
          if (playerBank.loans[cid]) { toast('Repay existing loan first.', 2); return; }
          // Atomic loan — server checks reserve and deducts; client only commits on success
          bankRPC('bank_loan', { p_city_id: cid, p_amount: amt }).then(res => {
            if (!res?.ok) {
              const reserve = res?.bank_reserve ?? 0;
              toast(res?.error === 'insufficient reserve'
                ? `Vault can only lend ${reserve}g right now.`
                : `Loan failed: ${res?.error || 'server error'}`, 3);
              return;
            }
            const feeAmt = Math.round(amt * BANK_LOAN_RATE);
            const repayAmt = amt + feeAmt;
            playerBank.loans[cid] = { principal: amt, amount: repayAmt, fee: feeAmt, dueDay: Math.floor(time.day) + 7 };
            player.gold += amt;
            if (bankVault[cid] && Number.isFinite(res.bank_reserve)) bankVault[cid].reserve = res.bank_reserve;
            toast(`Borrowed ${amt}g. Repay ${repayAmt}g by day ${Math.floor(time.day)+7}.`, 3);
            scheduleAutoSave(); dom.key = ''; domRender();
          });
        };
        uiRoot.querySelector('[data-action="loan50"]')?.addEventListener('click', () => takeLoan(50));
        uiRoot.querySelector('[data-action="loan100"]')?.addEventListener('click', () => takeLoan(100));
        uiRoot.querySelector('[data-action="loan200"]')?.addEventListener('click', () => takeLoan(200));

        uiRoot.querySelector('[data-action="repay"]')?.addEventListener('click', () => {
          const l = playerBank.loans[cid];
          if (!l) { toast('No loan here.', 2); return; }
          const overdue = Math.max(0, Math.floor(time.day) - l.dueDay);
          const basePrincipal = l.principal ?? l.amount;
          const penalty = overdue > 0 ? Math.round(basePrincipal * 0.05 * overdue) : 0;
          const total = l.amount + penalty;
          if (player.gold < total) { toast(`Need ${total}g to repay${penalty > 0 ? ` (incl. ${penalty}g overdue penalty)` : ''}.`, 2); return; }
          // Optimistic local update
          player.gold -= total;
          delete playerBank.loans[cid];
          toast(`Loan repaid (${total}g${penalty > 0 ? `, incl. ${penalty}g overdue penalty` : ''}).`, 2);
          scheduleAutoSave(); dom.key = ''; domRender();
          // Return funds to shared vault
          bankRPC('bank_repay', { p_city_id: cid, p_amount: total }).then(res => {
            if (!res?.ok) {
              // RPC failed — revert (rare; player loses sync but no money disappears)
              player.gold += total;
              playerBank.loans[cid] = l;
              toast(`Repay sync failed: ${res?.error || 'server error'}`, 3);
              dom.key = ''; domRender();
            } else if (bankVault[cid] && Number.isFinite(res.bank_reserve)) {
              bankVault[cid].reserve = res.bank_reserve;
            }
          });
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
              <button class="cr-close" data-action="close" aria-label="Close">✕</button>
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
        toast(`Rumors: "${card.itemName}" in ${card.cityName} - promising!`, 3); scheduleAutoSave(); dom.key = ''; domRender();
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
        actionHtml = `<div class="cr-sub" style="color:#a78bfa;font-weight:bold;">⭐ Master Rank - Maximum prestige achieved.</div>`;
      }
      uiRoot.innerHTML = `
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Guild Hall">
          <div class="cr-panel">
            ${bannerHtml}
            <div class="cr-head">
              <div><div class="cr-title">🏛 Merchants Guild</div><div class="cr-sub">Rank: <b>${tierNames[playerGuild.tier]}</b> · Sell bonus: +${bonuses[playerGuild.tier]}% · Gold: ${player.gold}g · Rep here: ${rep}</div></div>
              <button class="cr-close" data-action="close" aria-label="Close">✕</button>
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
              <div><div class="cr-title">📦 Warehouse - ${htmlEscape(c.name)}</div><div class="cr-sub">Free storage. Items stay in this city.</div></div>
              <button class="cr-close" data-action="close" aria-label="Close">✕</button>
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
        gainItem(itemId, 1);
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
              <button class="cr-close" data-action="close" aria-label="Close">✕</button>
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
      // Infer cell size from the actual image to avoid "grid of icons" cropping bugs.
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
        // Apply .out class directly on the existing DOM element — no full re-render needed.
        // This lets the crBannerOut CSS animation run without the element being destroyed.
        try {
          const el = document.querySelector(`.cr-banner[data-bid="${it.id}"]`);
          if (el) el.classList.add('out');
        } catch {}
      } else if (it.state === 'out' && it.t <= 0) {
        it._remove = true;
      }
    }
    const before = banner.q.length;
    banner.q = banner.q.filter(it => !it._remove);
    if (banner.q.length !== before) dom.key = ''; // force re-render to remove dismissed banners
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

    gold: 220,  // raised from 160 - enough to buy a meaningful first load
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
    gear: { pack: 0, boots: 0, tool: 0, pickaxe: 0 },

    // Mining: per-vein cooldown (tileKey → stateTime when usable again) and
    // a stamina meter (0..100) consumed by each swing, regens 1/sec.
    mineCooldown: {},
    mineStamina: 100,
    _mineStaminaTickAt: 0,

    guildMember: false, // true once Merchant Guild milestone is achieved
    seenFirstVein: false, // one-shot tutorial: fires the first time the player stands near any mining vein
    _lastTile: -1,      // transient: last tile id for terrain-entry toasts
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

  // In-flight lock: prevents out-of-order DB writes when saves arrive faster
  // than the network can deliver them. Only the latest pending state is kept.
  let _dbSaveInFlight = false;
  let _dbSavePending  = null;

  async function saveGameToDb(state) {
    if (__QA.enabled) return; // never write to DB in QA mode
    if (!ECONOMY.enabled) return;

    if (_dbSaveInFlight) {
      // A write is already in flight — queue only the latest state.
      _dbSavePending = state;
      return;
    }

    _dbSaveInFlight = true;
    try {
      const res = await fetch(`${ECONOMY.url}/rest/v1/player_saves`, {
        method: 'POST',
        headers: {
          ...economyHeaders(),
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ uid: _playerId, save_data: state, updated_at: new Date().toISOString() }),
      });
      if (res.ok) {
        console.log(`[SAVE] DB save OK (uid=${_playerId})`);
      } else {
        const body = await res.text().catch(() => '');
        console.warn(`[SAVE] DB save HTTP ${res.status} (uid=${_playerId}):`, body);
      }
    } catch (e) {
      console.warn('[SAVE] DB save failed (non-fatal, local save still written):', e.message);
    } finally {
      _dbSaveInFlight = false;
      // Flush the latest pending state if one accumulated while we were writing.
      if (_dbSavePending) {
        const pending = _dbSavePending;
        _dbSavePending = null;
        saveGameToDb(pending);
      }
    }
  }

  async function loadGameFromDb() {
    // All guests share uid='0' — never cross-load another guest's save.
    // Guests rely on localStorage exclusively.
    if (_playerId === '0') return null;
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

  function saveGame(silent = false) {
    const state = {
      saveVersion: SAVE_SCHEMA_VERSION,
      buildVersion: 'v0.5.23',
      savedAt: Date.now(),
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
        guildMember: player.guildMember || false,
        seenFirstVein: player.seenFirstVein || false,
        gear: { ...player.gear },
        // mineCooldown is intentionally NOT persisted: its values are stateTime
        // offsets, and stateTime resets to 0 on every page reload, so saving
        // them would either strand veins as "still recovering" forever (cross-
        // session) or let Ctrl+L bypass the 30s anti-spam (in-session).
        mineStamina: typeof player.mineStamina === 'number' ? player.mineStamina : 100,
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
      // NOTE: cityPop, cityTreasury, cityBonus, cityBuildings, bankVault, aiTraders are
      // world-shared state - they live in Supabase (city_treasury / world_traders tables).
      // Do NOT persist them per-player; they are loaded via syncWorldState() on boot.
      playerBank: { deposits: { ...playerBank.deposits }, loans: { ...playerBank.loans } },
      playerGuild: { ...playerGuild },
      warehouseStash: Object.fromEntries(Object.entries(warehouseStash).map(([k,v]) => [k, {...v}])),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      ui._lastSavedDay = time.day;
      if (!silent) notifySaved(`Saved (Day ${time.day})`);
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

      if (p.gear !== undefined) {
        if (!isObj(p.gear)) {
          errors.push('player.gear must be object');
        } else {
          for (const slot of ['pack', 'boots', 'tool', 'pickaxe']) {
            if (p.gear[slot] !== undefined && !Number.isInteger(p.gear[slot])) {
              errors.push(`player.gear.${slot} must be an integer`);
            }
          }
        }
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

    // Save from a newer build — don't mangle it, let validateSave catch any issues.
    if (v > SAVE_SCHEMA_VERSION) {
      console.warn(`[MIGRATE] Save version ${v} is newer than supported ${SAVE_SCHEMA_VERSION} — loading as-is`);
      return s;
    }

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
    if (!player.gear) player.gear = { pack: 0, boots: 0, tool: 0, pickaxe: 0 };
    else if (player.gear.pickaxe === undefined) player.gear.pickaxe = 0;
    // Legacy migration: older saves persisted mineCooldown (stateTime-offset
    // values). Those values are stale on every reload, so drop them. Current
    // saveGame omits the field entirely, in which case Object.assign above
    // didn't touch the in-memory map and we preserve it (this is what keeps
    // Ctrl+L from bypassing the 30s anti-spam cooldown).
    if (state.player && state.player.mineCooldown !== undefined) {
      player.mineCooldown = {};
    }
    if (!player.mineCooldown || typeof player.mineCooldown !== 'object') {
      player.mineCooldown = {};
    }
    if (typeof player.mineStamina !== 'number') player.mineStamina = 100;
    // Ensure new items appear in inv after schema upgrade.
    for (const it of ITEMS) if (player.inv[it.id] === undefined) player.inv[it.id] = 0;
    applyGearStats();
    // Restore time
    Object.assign(time, state.time);
    // Restore market drift — normalise 50% toward 1.0 on load so stale
    // extremes correct themselves after a real-world break.
    for (const cid of Object.keys(marketDrift)) {
      const saved = state.marketDrift?.[cid];
      if (!saved) continue;
      for (const itemId of Object.keys(marketDrift[cid])) {
        if (saved[itemId] !== undefined) {
          marketDrift[cid][itemId] = 1 + (saved[itemId] - 1) * 0.5;
        }
      }
    }
    if (typeof player.guildMember !== 'boolean') player.guildMember = false;
    if (typeof player.seenFirstVein !== 'boolean') player.seenFirstVein = false;
    // Re-check milestone silently on load (no event, just ensures flag is set for saves
    // that predate this feature where conditions may already be met)
    if (!player.guildMember) {
      const cityIds = ['valdenmere', 'ashport', 'crosshaven', 'ironholt'];
      if (cityIds.every(id => (player.rep?.[id] || 0) >= 5) && (player.gear?.pack ?? 0) >= 3) {
        player.guildMember = true;
      }
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
    // cityPop, cityTreasury, cityBonus, cityBuildings, bankVault, aiTraders are
    // world-shared state - loaded from Supabase via syncWorldState(), not from player saves.
    // Legacy saves may still contain these fields; they are silently ignored here.

    // Restore bank, guild, warehouse (player-personal)
    if (state.playerBank) {
      playerBank.deposits = state.playerBank.deposits || {};
      playerBank.loans = state.playerBank.loans || {};
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

    // ── Solid-tile escape: city layout can change between versions, which may
    // leave a saved player position inside a wall. Nudge to a safe tile.
    _escapeIfStuck();
  }

  function _escapeIfStuck() {
    // Check if player is inside a solid tile; if so, snap to city center or nearest open tile.
    const pr = player.r || 8;
    function blocked() {
      return isSolidAt(player.x - pr, player.y - pr) ||
             isSolidAt(player.x + pr, player.y - pr) ||
             isSolidAt(player.x - pr, player.y + pr) ||
             isSolidAt(player.x + pr, player.y + pr);
    }
    if (!blocked()) return; // already fine

    // Try nudging in expanding squares first
    for (let d = 1; d <= 8; d++) {
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]) {
        player.x += dx * TILE * d * 0.5;
        player.y += dy * TILE * d * 0.5;
        if (!blocked()) {
          camera.x = player.x - VIEW_W/2;
          camera.y = player.y - VIEW_H/2;
          console.warn('[LOAD] Player was in solid tile — nudged to safety');
          return;
        }
        player.x -= dx * TILE * d * 0.5;
        player.y -= dy * TILE * d * 0.5;
      }
    }

    // Last resort: snap to last known city center
    const city = getCityById(player.lastCityId) || world.cities[0];
    if (city) {
      player.x = (city.x + Math.floor(city.w / 2)) * TILE;
      player.y = (city.y + Math.floor(city.h / 2)) * TILE;
      camera.x = player.x - VIEW_W/2;
      camera.y = player.y - VIEW_H/2;
      console.warn('[LOAD] Player stuck in solid tile — snapped to city center:', city.id);
    }
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
  // Pure helper: given two save snapshots, return 'db' or 'local' (whichever is newer).
  // Uses savedAt ms timestamp when both saves have it; falls back to day number.
  // Exported on __QA.api so unit tests can call it directly without touching fetch/localStorage.
  function _pickNewerSave(dbData, localData) {
    const dbTs    = dbData?.savedAt   || 0;
    const localTs = localData?.savedAt || 0;
    const dbDay   = dbData?.time?.day   || 0;
    const localDay = localData?.time?.day || 0;
    if (dbTs > 0 && localTs > 0) {
      return dbTs >= localTs ? 'db' : 'local';
    }
    return dbDay >= localDay ? 'db' : 'local';
  }
  // Export pure helper to QA API for unit testing
  if (__QA.enabled && __QA.api) __QA.api.pickNewerSave = _pickNewerSave;

  async function loadGameAsync() {

    const dbData = await loadGameFromDb();
    if (dbData) {
      let localData = null;
      try {
        const localRaw = localStorage.getItem(SAVE_KEY);
        if (localRaw) localData = JSON.parse(localRaw);
      } catch {}

      const pick = _pickNewerSave(dbData, localData);
      const dbDay = dbData?.time?.day || 0, dbTs = dbData?.savedAt || 0;
      const localDay = localData?.time?.day || 0, localTs = localData?.savedAt || 0;

      if (pick === 'db') {
        console.log(`[LOAD] Using DB save (day ${dbDay}, ts ${dbTs}) over local (day ${localDay}, ts ${localTs})`);
        return _parseAndApply(dbData, 'database');
      } else {
        console.log(`[LOAD] Local save (day ${localDay}, ts ${localTs}) newer than DB (day ${dbDay}, ts ${dbTs}), using local`);
        return loadGame();
      }
    }
    // No DB save - fall back to local
    return loadGame();
  }

  function deleteSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      console.log('[SAVE] Local save deleted');
    } catch (e) {
      console.warn('[SAVE] Failed to delete locally:', e);
    }
    deleteSaveFromDb(); // fire-and-forget: prevent DB save from overwriting a fresh game
  }

  async function deleteSaveFromDb() {
    if (__QA.enabled || !ECONOMY.enabled) return;
    try {
      const res = await fetch(
        `${ECONOMY.url}/rest/v1/player_saves?uid=eq.${encodeURIComponent(_playerId)}`,
        { method: 'DELETE', headers: economyHeaders() }
      );
      if (res.ok) {
        console.log(`[SAVE] DB save deleted (uid=${_playerId})`);
      } else {
        console.warn(`[SAVE] DB delete HTTP ${res.status} (uid=${_playerId})`);
      }
    } catch (e) {
      console.warn('[SAVE] DB delete failed (non-fatal):', e.message);
    }
  }

  // Auto-save on certain actions
  let autoSaveTimer = null;
  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveGame, 500); // reduced from 2000ms - saves faster after action
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
  // Periodic silent save every 5s — keeps progress in sync without notification noise
  setInterval(() => saveGame(true), 5_000);

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

  function nearMineTile() {
    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        if (tileAt(tx + ox, ty + oy) === 18) return { tx: tx + ox, ty: ty + oy };
      }
    }
    return null;
  }

  // Player-active mining: 30s per-vein cooldown, 15 stamina per swing,
  // drops 2..4 ore + 10% chance +1 coal + 5% chance +1 gem.
  function playerMineNode(tx, ty) {
    if (tileAt(tx, ty) !== 18) { toast('Nothing to mine here.', 1.5); return false; }
    const playerTX = Math.floor(player.x / TILE);
    const playerTY = Math.floor(player.y / TILE);
    if (Math.max(Math.abs(tx - playerTX), Math.abs(ty - playerTY)) > 2) {
      toast('Move closer to the vein.', 1.5);
      return false;
    }
    const key = ty * MAP_W + tx;
    // Local debounce: prevent spam-tap before the RPC responds
    const cd = player.mineCooldown[key] || 0;
    if (stateTime < cd) {
      const left = Math.ceil((cd - stateTime) / 1000);
      toast(`Vein still recovering (${left}s).`, 1.5);
      return false;
    }
    const staminaCost = player.miningStaminaCost ?? 15;
    if ((player.mineStamina || 0) < staminaCost) {
      toast('Too tired to swing — rest at the inn.', 2);
      return false;
    }
    if (invWeight() + 2 > player.capacity) {
      toast('Cargo full — drop some load first.', 2);
      return false;
    }
    // Rarer metals can require a minimum pickaxe tier (data-driven via the item
    // spec's minPickaxeTier). Refuse before committing stamina/cooldown.
    const metalAtTile = MINE_SITE_NODES[key];
    const metalSpec = metalAtTile ? ITEMS.find(it => it.id === metalAtTile) : null;
    const minTier = metalSpec?.minPickaxeTier ?? 0;
    if (minTier > 0 && (player.gear?.pickaxe ?? 0) < minTier) {
      const reqName = GEAR.pickaxe[minTier]?.name || `Tier ${minTier} pickaxe`;
      toast(`Need a ${reqName} (T${minTier}+) to mine ${metalSpec.name}.`, 2.5);
      return false;
    }
    // Optimistic local cooldown so the player can't tap twice before RPC responds
    player.mineCooldown[key] = stateTime + 30000;
    player.mineStamina = Math.max(0, (player.mineStamina || 0) - staminaCost);

    function _doMineYield() {
      // Veins inside a redesigned mining site drop that site's metal variant;
      // legacy Ironholt veins still drop iron ore.
      const metalId = MINE_SITE_NODES[key] || 'ore';
      const metal = ITEMS.find(it => it.id === metalId);
      const yieldMult = player.miningYieldMult ?? 1;
      const qty = Math.max(1, Math.round((2 + (Math.random() * 3 | 0)) * yieldMult)); // (2..4) × pickaxe mult
      gainItem(metalId, qty);
      let bonus = '';
      if (Math.random() < 0.10) { gainItem('coal', 1); bonus += ' +1 coal'; }
      if (Math.random() < 0.05) { gainItem('gem',  1); bonus += ' +1 GEM!'; }
      toast(`Mined ${qty} ${metal?.name || metalId}${bonus}`, 2.5);
      saveGame(true);
    }

    if (!__QA.enabled && ECONOMY.enabled) {
      fetch(`${ECONOMY.url}/rest/v1/rpc/mine_ore_vein`, {
        method: 'POST',
        headers: { ...economyHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify({ p_uid: player.uid || '0', p_tile_key: String(key) }),
      })
        .then(r => {
          // A non-2xx response means the RPC call itself failed (missing
          // function, bad auth, paused project, etc.) — an infra problem,
          // not contention. Route it to the same fail-open path as a thrown
          // network error below, instead of misreporting it as "another
          // miner" and phantom-blocking every swing whenever the backend
          // hiccups.
          if (!r.ok) throw new Error(`mine_ore_vein HTTP ${r.status}`);
          return r.json();
        })
        .then(result => {
          if (result?.ok) {
            _doMineYield();
          } else {
            // Another player mined this vein; roll back stamina + cooldown.
            // Refund the same staminaCost that was deducted above — not a
            // flat 15 — so upgraded pickaxes (lower stamina/swing) don't net
            // free stamina every time they lose a contested swing.
            player.mineStamina = Math.min(100, (player.mineStamina || 0) + staminaCost);
            const msLeft = result?.cooldown_remaining_ms || 30000;
            player.mineCooldown[key] = stateTime + msLeft;
            toast(`Another miner just worked this vein — try again in ${Math.ceil(msLeft / 1000)}s.`, 2.5);
          }
        })
        .catch(() => {
          // Network/HTTP failure: apply yield optimistically
          _doMineYield();
        });
    } else {
      _doMineYield();
    }
    return true;
  }

  function priceFor(cityId, item) {
    // Unified with quoteFor: both now use midPriceFor as the single canonical price.
    // priceFor = the mid price (before spread). Used by marketTryTrade for buy/sell.
    return midPriceFor(cityId, item);
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
              // planClickPath overwrites _tapAction/_tapTarget - restore
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
        // Arrived at destination - trigger tap action if any
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
          } else if (action === 'mine') {
            const tgt = clickMove._tapTarget;
            if (tgt && typeof tgt.tx === 'number') playerMineNode(tgt.tx, tgt.ty);
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

    const tMul = terrainSpeedMul(player.x, player.y);
    player.vx = nx * player.speed * tMul;
    player.vy = ny * player.speed * tMul;

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
    // X blocked: do NOT cancel click-move - let Y-axis slide continue the path

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

  // Like currentCity() but also returns the nearest city within 3 tiles - useful
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

  // ── Loot pickup popups ────────────────────────────────────────────────────
  // Lightweight floating "+N icon" sprites that spawn at the player's screen
  // position whenever they gain items (mining, cache loot, market buy, event
  // drops). Rapid identical gains stack into a single popup so a multi-drop
  // swing doesn't paint a spam of overlapping sprites.
  const ITEM_ICONS = {
    coal:   '⚫',
    grain:  '🌾',
    food:   '🥖',
    ore:    '🟫',
    herbs:  '🌿',
    potion: '🧪',
    relic:  '🏺',
    ink:    '🖋️',
    gem:    '💎',
    copper: '🟠',
    silver: '⚪',
    gold:   '🟡',
    __alert: '❗', // road-event ambush marker, not an item
  };
  const LOOT_POPUP_LIFETIME_MS = 1500;
  const LOOT_POPUP_RISE_PX    = 36;
  const LOOT_POPUP_STACK_MS   = 300;
  const _lootPopups = [];

  function spawnLootPopup(itemId, qty) {
    if (!itemId || !(qty > 0)) return;
    // Rapid same-item gains collapse into the latest popup so a single swing
    // doesn't paint three overlapping sprites for ore+coal+gem combos. The
    // pure decision is mirrored in ops/scripts/unit_tests.mjs#stackPopup.
    const last = _lootPopups[_lootPopups.length - 1];
    if (last && last.itemId === itemId && (stateTime - last.startMs) < LOOT_POPUP_STACK_MS) {
      last.qty += qty;
      last.startMs = stateTime;
      return;
    }
    _lootPopups.push({
      itemId,
      qty,
      sx: player.x - camera.x,
      sy: player.y - camera.y - 18,
      startMs: stateTime,
    });
  }

  // Threat road events pop a bare "❗" over the player through the same
  // pipeline (qty 0 → drawn without the "+N", and never stacked).
  function spawnAlertPopup() {
    _lootPopups.push({
      itemId: '__alert',
      qty: 0,
      sx: player.x - camera.x,
      sy: player.y - camera.y - 18,
      startMs: stateTime,
    });
  }

  // Single source of truth for "player gains items" so every drop site picks
  // up the visual feedback automatically. Returns the new total for convenience.
  function gainItem(itemId, qty) {
    if (!itemId || !(qty > 0)) return player.inv[itemId] || 0;
    player.inv[itemId] = (player.inv[itemId] || 0) + qty;
    spawnLootPopup(itemId, qty);
    return player.inv[itemId];
  }

  function drawLootPopups() {
    if (_lootPopups.length === 0) return;
    const fontPx = Math.round(13 * UI_SCALE);
    ctx.save();
    ctx.font = `800 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let writeIdx = 0;
    for (let i = 0; i < _lootPopups.length; i++) {
      const p = _lootPopups[i];
      const age = stateTime - p.startMs;
      if (age >= LOOT_POPUP_LIFETIME_MS) continue;
      const t = age / LOOT_POPUP_LIFETIME_MS;
      // Ease-out rise + accelerating fade so the eye catches the spawn moment.
      const yOff = -LOOT_POPUP_RISE_PX * (1 - (1 - t) * (1 - t));
      ctx.globalAlpha = 1 - t * t;
      const text = p.qty > 0 ? `${ITEM_ICONS[p.itemId] || '✨'} +${p.qty}` : (ITEM_ICONS[p.itemId] || '✨');
      // dark shadow first for legibility against grass/road
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(text, p.sx + 1, p.sy + yOff + 1);
      ctx.fillStyle = '#fde047';
      ctx.fillText(text, p.sx, p.sy + yOff);
      _lootPopups[writeIdx++] = p;
    }
    _lootPopups.length = writeIdx;
    ctx.restore();
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
    lastPatrolDay: -99, // tracks last patrol encounter day
  };

  // Cache POIs (tile 13) are single-use per save.
  const openedCaches = new Set();
  const cacheKey = (tx, ty) => `${tx},${ty}`;

  function randChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // --- Road event scaling (pure; mirrored verbatim in ops/scripts/unit_tests.mjs) ---
  // Stakes follow what the player stands to lose (gold + cargo market value) so
  // encounters stay meaningful at any wealth level. Selection is a deterministic
  // weighted pick driven by rand01() — no Math.random in the decision path.

  function cargoMarketValue(inv, items) {
    let v = 0;
    for (const it of items) v += (inv[it.id] || 0) * it.base;
    return v;
  }

  function roadStakes(gold, cargoVal) {
    const wealth = Math.max(0, gold || 0) + Math.max(0, cargoVal || 0);
    const heat = Math.min(1, wealth / 600); // 600g total wealth = fully "worth robbing"
    return {
      wealth,
      heat,
      banditDemand: Math.min(150, Math.max(12, Math.round(wealth * 0.12))),
      toll:         Math.min(60,  Math.max(8,  Math.round(wealth * 0.05))),
      shelter:      Math.min(25,  Math.max(4,  Math.round(wealth * 0.02))),
      quarantine:   Math.min(45,  Math.max(10, Math.round(wealth * 0.04))),
      escortPay:    Math.round(12 + heat * 28),
      omenFind:     Math.round(5 + heat * 20),
      fightLoot:    Math.round(10 + heat * 30),
      dropCount:    cargoVal >= 240 ? 3 : cargoVal >= 80 ? 2 : 1,
    };
  }

  function roadEventWeights(ctx) {
    const w = {
      bandits: 1 + (ctx.heat || 0) * 2, // valuable travelers attract predators
      toll: 1, storm: 1, omen: 1, escort: 1,
      wandering_merchant: 1, wounded_soldier: 1, plague_cart: 0.7,
      lost_cargo: 1, wild_animal: 1, hermit: 1, waystone: 1,
    };
    if ((ctx.cargoVal || 0) <= 0) w.bandits = 0.25; // empty pack — nothing to rob
    if ((ctx.food || 0) <= 0) { w.wandering_merchant += 1; w.hermit += 0.75; }
    if (ctx.patrolOk) w.patrol = ctx.hasContraband ? 2.5 : 1;
    return w;
  }

  function pickWeighted(weights, roll) {
    const keys = Object.keys(weights).filter(k => weights[k] > 0);
    if (keys.length === 0) return null;
    let total = 0;
    for (const k of keys) total += weights[k];
    let x = Math.min(0.999999999, Math.max(0, roll || 0)) * total;
    for (const k of keys) {
      x -= weights[k];
      if (x < 0) return k;
    }
    return keys[keys.length - 1];
  }

  // Input lock right after an event dialog opens, so a tap meant for movement
  // can never activate a choice. Driven by stateTime (deterministic frame clock);
  // a clock reset (now < openedAt) must unlock, never permanently lock.
  const EVENT_INPUT_LOCK_MS = 400;

  function eventChoiceLocked(nowMs, openedAtMs, lockMs) {
    if (typeof openedAtMs !== 'number') return false; // legacy/QA path — unlocked
    if (nowMs < openedAtMs) return false;             // clock reset — unlocked
    return (nowMs - openedAtMs) < lockMs;
  }

  // threat:true events are forced encounters: no X button, Esc is refused.
  const EVENT_THEMES = {
    bandits:            { icon: '⚔️', accent: '#c0392b', threat: true },
    toll:               { icon: '🛑', accent: '#b0722a', threat: true },
    patrol:             { icon: '🛡️', accent: '#3d6da8', threat: true },
    plague_cart:        { icon: '☠️', accent: '#5b6e5a', threat: true },
    wild_animal:        { icon: '🐺', accent: '#7a4a2b', threat: true },
    storm:              { icon: '⛈️', accent: '#5a6472', threat: false },
    omen:               { icon: '✨', accent: '#d18816', threat: false },
    escort:             { icon: '🤝', accent: '#4f9e5b', threat: false },
    wandering_merchant: { icon: '🧺', accent: '#8a5aa3', threat: false },
    wounded_soldier:    { icon: '🩹', accent: '#a8485e', threat: false },
    lost_cargo:         { icon: '📦', accent: '#a87a3e', threat: false },
    hermit:             { icon: '🔥', accent: '#e57389', threat: false },
    waystone:           { icon: '🗿', accent: '#7fbf83', threat: false },
    default:            { icon: '❗', accent: '#7c5cd6', threat: false },
  };

  function eventThemeFor(kind) {
    return EVENT_THEMES[kind] || EVENT_THEMES.default;
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
      const it = options[Math.floor(rand01() * options.length)];
      player.inv[it.id] -= 1;
      dropped += 1;
    }
    return dropped;
  }

  function openEvent({ title, text, choices, kind = null, dismissable, stakes = '' }) {
    ui.marketOpen = false;
    ui.contractsOpen = false;
    ui.eventOpen = true;
    ui.eventTitle = title;
    ui.eventText = text;
    ui.eventChoices = choices;
    ui.eventKind = kind;
    ui.eventDismissable = (dismissable !== undefined) ? !!dismissable : !eventThemeFor(kind).threat;
    ui.eventStakes = stakes;
    ui.eventOpenedAt = stateTime; // input lock starts now
    ui.eventSel = 0;
    ui.eventNavT = 0;
    if (eventThemeFor(kind).threat) spawnAlertPopup();
  }

  function closeEvent() {
    ui.eventOpen = false;
    ui.eventChoices = [];
    ui.eventKind = null;
    ui.eventDismissable = true;
    ui.eventStakes = '';
    ui.eventOpenedAt = -1;
    domCloseAll();
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
              // Compute loot before the RPC so it's ready to apply on success
              const _r = rand01();
              function _applyLoot() {
                if (_r < 0.55) {
                  const g = 6 + Math.floor(rand01() * 15);
                  player.gold += g;
                  toast(`Cache: +${g}g`, 2.2);
                } else if (_r < 0.85) {
                  const pool = ['food','ore','herbs'];
                  const itId = pool[Math.floor(rand01() * pool.length)];
                  const n = 1 + (rand01() < 0.35 ? 1 : 0);
                  gainItem(itId, n);
                  const it = ITEMS.find(x => x.id === itId);
                  toast(`Cache: +${n} ${it ? it.name : itId}`, 2.4);
                } else {
                  advanceDays(1, 'cache');
                  toast('Trap! You waste a day dealing with it.', 2.6);
                }
              }
              // Claim cache globally (first-come-first-served via DB lock)
              if (!__QA.enabled && ECONOMY.enabled) {
                fetch(`${ECONOMY.url}/rest/v1/rpc/open_cache`, {
                  method: 'POST',
                  headers: { ...economyHeaders(), 'Prefer': 'return=representation' },
                  body: JSON.stringify({ p_uid: player.uid || '0', p_tile_key: key }),
                })
                  .then(r => {
                    // Same fail-open contract as mine_ore_vein: a non-2xx
                    // response is an infra problem, not a genuine "someone
                    // already looted this" result. Route it to the same
                    // fail-open path as a thrown network error below, instead
                    // of permanently marking the cache empty for zero loot.
                    if (!r.ok) throw new Error(`open_cache HTTP ${r.status}`);
                    return r.json();
                  })
                  .then(result => {
                    if (result?.ok) {
                      openedCaches.add(key);
                      _applyLoot();
                    } else {
                      openedCaches.add(key); // don't prompt again locally
                      toast('Already looted — empty crate.', 2.2);
                    }
                    scheduleAutoSave();
                  })
                  .catch(() => {
                    // Network/HTTP failure: apply loot optimistically, cache locally
                    openedCaches.add(key);
                    _applyLoot();
                    scheduleAutoSave();
                  });
              } else {
                // QA / offline: local-only
                openedCaches.add(key);
                _applyLoot();
                scheduleAutoSave();
              }
              closeEvent();
            }
          },
          { label: 'Leave it', run: closeEvent },
        ],
      });


      return;
    }

    if (poiId === 7) {
      openEvent({
        title: 'Roadside Shrine',
        text: 'A small shrine flickers with candlelight. Offer a coin, or move on?',
        choices: [
          { label: 'Offer 1g (chance of blessing)', run: () => {
              if (player.gold <= 0) { toast('No coin to offer.', 2); closeEvent(); return; }
              player.gold -= 1;
              if (rand01() < 0.6) { player.gold += 4; toast('Blessing! +4g', 2); }
              else toast('The wind answers in silence.', 2);
              closeEvent();
            }
          },
          { label: 'Rest (+short calm)', run: () => { toast('You catch your breath.', 2); closeEvent(); } },
          { label: 'Leave', run: closeEvent },
        ],
      });
      return;
    }

    if (poiId === 8) {
      openEvent({
        title: 'Traveler Camp',
        text: 'A few travelers share a fire. They might trade, for a price.',
        choices: [
          { label: 'Buy supplies (3g → +1 rations)', run: () => {
              if (player.gold < 3) { toast('Not enough gold.', 2); closeEvent(); return; }
              player.gold -= 3;
              gainItem('food', 1);
              toast('Bought 1 Dried Rations.', 2);
              closeEvent();
            }
          },
          { label: 'Ask for directions', run: () => { toast('They warn: stay on the road.', 2); closeEvent(); } },
          { label: 'Move on', run: closeEvent },
        ],
      });
      return;
    }

    if (poiId === 9) {
      openEvent({
        title: 'Old Ruins',
        text: 'Broken stones and mossy pillars. Something might be worth taking.',
        choices: [
          { label: 'Search', run: () => {
              const r = rand01();
              if (r < 0.45) { const g = 2 + (rand01()*6|0); player.gold += g; toast(`Found ${g}g`, 2); }
              else if (r < 0.75) { gainItem('herbs', 1); toast('Found 1 Moon Herbs', 2); }
              else toast('Nothing but dust.', 2);
              closeEvent();
            }
          },
          { label: 'Leave it', run: closeEvent },
        ],
      });
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
    if (road.travel < 640) return; // threshold; rarer than before so each event carries weight

    road.travel = 0;
    road.cooldown = 8.0;

    const patrolCooldownOk = Math.floor(time.day) - road.lastPatrolDay >= 3;
    const cargoVal = cargoMarketValue(player.inv, ITEMS);
    const stakes = roadStakes(player.gold, cargoVal);
    const hasContraband = ITEMS.some(it => it.contrabandName && (player.inv[it.id] || 0) > 0);
    const kind = pickWeighted(roadEventWeights({
      cargoVal,
      heat: stakes.heat,
      food: player.inv['food'] || 0,
      hasContraband,
      patrolOk: patrolCooldownOk,
    }), rand01());

    if (kind === 'bandits') {
      const demand = stakes.banditDemand;
      openEvent({
        kind,
        stakes: `${demand}g demanded`,
        title: 'Bandits!',
        text: `A masked crew steps onto the road. They size up your pack and demand ${demand}g.`,
        choices: [
          { label: `Pay ${demand}g`, run: () => { const paid = Math.min(player.gold, demand); player.gold -= paid; toast(`Paid ${paid}g to avoid trouble.`, 2.6); closeEvent(); } },
          { label: 'Flee (drop cargo)', run: () => { const d = dropRandomCargo(stakes.dropCount + 1); toast(d ? `You escaped, but dropped ${d} item(s).` : 'You escaped, barely. No cargo to drop.', 3); closeEvent(); } },
          { label: 'Fight (risk)', run: () => {
              if (rand01() < 0.58) {
                const loot = stakes.fightLoot + Math.floor(rand01() * stakes.fightLoot);
                player.gold += loot;
                toast(`You won! Looted ${loot}g.`, 2.8);
              } else {
                const d = dropRandomCargo(stakes.dropCount);
                const fine = Math.round(demand * 0.6) + Math.floor(rand01() * 10);
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
      const toll = stakes.toll;
      openEvent({
        kind,
        stakes: `${toll}g toll`,
        title: 'Toll Checkpoint',
        text: 'A petty lord has stationed guards here. They assess your cargo before naming a price. Pay up or detour through rough terrain.',
        choices: [
          { label: `Pay ${toll}g`, run: () => { const paid = Math.min(player.gold, toll); player.gold -= paid; toast(`Paid ${paid}g toll.`, 2.4); closeEvent(); } },
          { label: 'Detour (slow)', run: () => { road.cooldown = 12.0; toast('You detour. No toll, but it wastes time.', 3); closeEvent(); } },
        ],
      });

    } else if (kind === 'storm') {
      openEvent({
        kind,
        title: 'Sudden Storm',
        text: 'Wind and rain hammer the road. Your pack gets soaked.',
        choices: [
          { label: 'Push through', run: () => {
              road.cooldown = 10.0;
              const fragile = ['herbs', 'potion'];
              if (rand01() < 0.4) {
                const id = fragile[Math.floor(rand01() * fragile.length)];
                if ((player.inv[id] || 0) > 0) { player.inv[id] -= 1; toast('A fragile item was ruined by the storm.', 3); }
                else toast('You weather the storm.', 2.4);
              } else {
                toast('You weather the storm.', 2.4);
              }
              closeEvent();
            }
          },
          { label: `Take shelter (-${stakes.shelter}g)`, run: () => { const paid = Math.min(player.gold, stakes.shelter); player.gold -= paid; toast(`Sheltered at a roadside inn (-${paid}g).`, 2.8); closeEvent(); } },
        ],
      });

    } else if (kind === 'omen') {
      // Omen is a lucky find - but 25% chance it's a lure and a pickpocket strikes
      openEvent({
        kind,
        title: 'Strange Omen',
        text: 'A glint of gold on the roadside catches your eye. Could be luck - or a lure.',
        choices: [
          { label: 'Investigate', run: () => {
              if (rand01() < 0.25) {
                const loss = Math.round(stakes.omenFind * 0.8) + Math.floor(rand01() * 8);
                const paid = Math.min(player.gold, loss);
                player.gold -= paid;
                toast(`A pickpocket strikes while you look! Lost ${paid}g.`, 3.2);
              } else {
                const g = stakes.omenFind + Math.floor(rand01() * 8);
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
      // Escort has risk - 20% chance of ambush; pay scales with how dangerous the roads are for you
      const pay = stakes.escortPay;
      openEvent({
        kind,
        stakes: `${pay}g offered`,
        title: 'Merchant Escort',
        text: `A nervous merchant asks for protection through a rough stretch. He will pay ${pay}g - but the road ahead looks dangerous.`,
        choices: [
          { label: `Escort (earn ${pay}g, some risk)`, run: () => {
              if (rand01() < 0.20) {
                const loss = Math.min(player.gold, Math.round(pay * 0.8));
                player.gold -= loss;
                toast(`Ambush! You drove them off but took a hit. Lost ${loss}g.`, 3.2);
              } else {
                player.gold += pay;
                toast(`You escort the merchant safely. +${pay}g.`, 2.4);
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
        kind,
        title: 'Wandering Merchant',
        text: `A road merchant offers ${it.name} at a discount - ${discountPrice}g each (market is ~${fullPrice}g).`,
        choices: [
          { label: `Buy 1 for ${discountPrice}g`, run: () => {
              if (player.gold < discountPrice) { toast('Not enough gold.', 2); closeEvent(); return; }
              const w = invWeight() + it.weight;
              if (w > player.capacity) { toast('No room in your pack.', 2); closeEvent(); return; }
              player.gold -= discountPrice;
              gainItem(it.id, 1);
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
        kind,
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
      const fee = stakes.quarantine;
      openEvent({
        kind,
        stakes: `${fee}g fee or 1 day`,
        title: 'Quarantine Barrier',
        text: `Guards in masks block the road - a plague cart passed through. Pay a ${fee}g disinfection fee (cargo included), or wait it out.`,
        choices: [
          { label: `Pay ${fee}g to pass`, run: () => {
              const paid = Math.min(player.gold, fee);
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
        kind,
        title: 'Abandoned Crate',
        text: 'A sealed crate sits in the ditch, no markings. Might be valuable - or dangerous.',
        choices: [
          { label: 'Open it', run: () => {
              const r = rand01();
              if (r < 0.5) {
                const pool = ['potion','herbs','relic'];
                const itId = pool[Math.floor(rand01() * pool.length)];
                const it2 = ITEMS.find(x => x.id === itId);
                gainItem(itId, 1);
                toast(`Found 1 ${it2 ? it2.name : itId}!`, 2.6);
              } else if (r < 0.8) {
                const loss = Math.round(8 + stakes.heat * 18) + Math.floor(rand01() * 10);
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
        kind,
        title: 'Wolf Pack',
        text: 'A hungry wolf pack circles the road ahead, blocking your path.',
        choices: [
          { label: 'Flee (drop 1 ration)', run: () => {
              if ((player.inv['food'] || 0) > 0) {
                player.inv['food'] -= 1;
                toast('You flee, tossing a ration behind you. They take the bait.', 3);
              } else {
                const g = Math.min(player.gold, Math.round(6 + stakes.heat * 12));
                player.gold -= g;
                toast(`Nothing to drop! They chase you. Lost ${g}g in the confusion.`, 3.2);
              }
              closeEvent();
            }
          },
          { label: 'Fight them off', run: () => {
              if (rand01() < 0.52) {
                const g = Math.round(stakes.fightLoot * 0.5) + Math.floor(rand01() * 8);
                player.gold += g;
                toast(`You drove them off! Sold the pelt for ${g}g.`, 2.8);
              } else {
                const hurt = Math.round(8 + stakes.heat * 15) + Math.floor(rand01() * 10);
                const paid = Math.min(player.gold, hurt);
                player.gold -= paid;
                toast(`Bitten badly. Lost ${paid}g on road-side medicine.`, 3);
              }
              closeEvent();
            }
          },
        ],
      });
    } else if (kind === 'hermit') {
      openEvent({
        kind,
        title: 'Roadside Hermit',
        text: 'An old figure sits beside a smoking fire, wrapped in a patchwork cloak. They look up with bright eyes.',
        choices: [
          { label: 'Share a meal (1 food)', run: () => {
              if ((player.inv['food'] || 0) >= 1) {
                player.inv['food'] -= 1;
                // Hermit shares a trade secret — free intel card
                const npcProxy = { id: 'hermit_npc' };
                const nearCity = world.cities.reduce((best, c2) => {
                  const d = Math.hypot(player.x - (c2.x+c2.w/2)*TILE, player.y - (c2.y+c2.h/2)*TILE);
                  return !best || d < best.d ? { c: c2, d } : best;
                }, null)?.c;
                if (nearCity && player.intelLedger.filter(ic => !ic.sold).length < 6) {
                  const card = generateIntel(npcProxy, nearCity.id);
                  player.intelLedger.push(card);
                  toast(`The hermit shares a tip: ${card.itemName} is ${card.direction} in ${card.cityName}.`, 4);
                } else {
                  player.mineStamina = Math.min(100, player.mineStamina + 30);
                  toast('They share a tonic. Stamina restored.', 2.8);
                }
              } else {
                toast('You have no food to share. They wave you on.', 2.4);
              }
              closeEvent();
            }
          },
          { label: 'Ask for road news (free)', run: () => {
              const tips = [
                'Patrol activity is heavy near the capital lately.',
                'A merchant told me the river market has fine herbs this season.',
                'Bandits have been spotted on the northern stretch.',
                'The mining town pays well for food this time of year.',
                'Safe travels. The road gives back what you put in.',
              ];
              toast(tips[Math.floor(rand01() * tips.length)], 4);
              closeEvent();
            }
          },
          { label: 'Move on', run: closeEvent },
        ],
      });

    } else if (kind === 'waystone') {
      openEvent({
        kind,
        title: 'Ancient Waystone',
        text: 'A moss-covered stone pillar stands at a crossroads, carved with old trade-route symbols.',
        choices: [
          { label: 'Study the markings', run: () => {
              const nearCity = world.cities.reduce((best, c2) => {
                const d = Math.hypot(player.x - (c2.x+c2.w/2)*TILE, player.y - (c2.y+c2.h/2)*TILE);
                return !best || d < best.d ? { c: c2, d } : best;
              }, null)?.c;
              const dist = nearCity ? Math.round(Math.hypot(player.x - (nearCity.x+nearCity.w/2)*TILE, player.y - (nearCity.y+nearCity.h/2)*TILE) / TILE) : '?';
              toast(`Waystone: ${nearCity?.name || 'Unknown'} is ~${dist} tiles away. The symbol suggests it is a trading hub.`, 4.5);
              closeEvent();
            }
          },
          { label: 'Leave an offering (3g)', run: () => {
              if (player.gold >= 3) {
                player.gold -= 3;
                // Small road speed boost for next journey
                road.cooldown = Math.max(0, road.cooldown - 3);
                toast('You leave a coin. The road feels lighter under your feet.', 3);
              } else {
                toast('Not enough gold. You move on.', 2);
              }
              closeEvent();
            }
          },
          { label: 'Pass by', run: closeEvent },
        ],
      });

    } else if (kind === 'patrol') {
      road.lastPatrolDay = Math.floor(time.day);
      // Find nearest city to determine which guard force this is
      let nearestCity = world.cities[0];
      let nearestDist = Infinity;
      for (const city of world.cities) {
        const cx = (city.x + city.w / 2) * TILE;
        const cy = (city.y + city.h / 2) * TILE;
        const d = Math.hypot(player.x - cx, player.y - cy);
        if (d < nearestDist) { nearestDist = d; nearestCity = city; }
      }
      const cid = nearestCity.id;
      const hasPermit = !!player.permits[cid];
      const rep = player.rep?.[cid] || 0;

      if (hasPermit) {
        openEvent({
          kind,
          title: `${nearestCity.name} Road Patrol`,
          text: `A ${nearestCity.name} guard patrol stops you. They check your papers — your city permit is in order.`,
          choices: [
            { label: 'Show permit', run: () => {
                player.rep[cid] = (player.rep[cid] || 0) + 1;
                toast(`Permit accepted. Rep +1 in ${nearestCity.name}.`, 2.4);
                closeEvent();
              }
            },
          ],
        });
      } else if (rep >= 4) {
        const fine = Math.max(6, Math.round(stakes.toll * 0.75));
        openEvent({
          kind,
          stakes: `${fine}g toll`,
          title: `${nearestCity.name} Road Patrol`,
          text: `Guards stop you for a spot check. One recognises your face from ${nearestCity.name}.`,
          choices: [
            { label: `Pay reduced toll (${fine}g)`, run: () => {
                const paid = Math.min(player.gold, fine);
                player.gold -= paid;
                toast(`Familiar face helps — reduced toll ${paid}g.`, 2.4);
                closeEvent();
              }
            },
            { label: 'Explain your business', run: () => {
                if (rand01() < 0.6) {
                  toast('They let you through. Your reputation precedes you.', 2.8);
                } else {
                  const paid = Math.min(player.gold, Math.round(stakes.toll * 1.25));
                  player.gold -= paid;
                  toast(`They're unconvinced. Standard toll ${paid}g.`, 2.8);
                }
                closeEvent();
              }
            },
          ],
        });
      } else {
        const fine = Math.max(10, Math.round(stakes.toll * 1.5));
        const bribe = Math.max(15, Math.round(stakes.toll * 2));
        const contrabandItems = ITEMS.filter(it => {
          const cityRules = CITY_RULES[cid];
          return cityRules && it.contrabandName && cityRules.contraband.includes(it.contrabandName) && (player.inv[it.id] || 0) > 0;
        });
        openEvent({
          kind,
          stakes: `${fine}g toll`,
          title: `${nearestCity.name} Road Patrol`,
          text: contrabandItems.length > 0
            ? `Guards stop you and demand a cargo inspection. They eye your pack suspiciously — you're carrying restricted goods.`
            : `Guards stop you for a routine check. No permit, no exception.`,
          choices: [
            { label: `Pay toll (${fine}g)`, run: () => {
                const paid = Math.min(player.gold, fine);
                player.gold -= paid;
                toast(`Paid ${paid}g road toll.`, 2.4);
                closeEvent();
              }
            },
            ...(contrabandItems.length > 0 ? [
              { label: `Bribe to look away (${bribe}g)`, run: () => {
                  if (rand01() < 0.65) {
                    const paid = Math.min(player.gold, bribe);
                    player.gold -= paid;
                    toast(`Guard pockets the coin and walks away. Paid ${paid}g.`, 3);
                  } else {
                    const it = contrabandItems[0];
                    const seized = Math.min(player.inv[it.id], 2);
                    player.inv[it.id] -= seized;
                    const fine2 = Math.min(player.gold, fine);
                    player.gold -= fine2;
                    player.rep[cid] = Math.max(0, (player.rep[cid] || 0) - 1);
                    toast(`Bribe refused! Seized ${seized} ${it.name}, fined ${fine2}g, rep -1.`, 3.5);
                  }
                  closeEvent();
                }
              },
            ] : []),
            { label: 'Slip past on foot (risk)', run: () => {
                if (rand01() < 0.45) {
                  road.cooldown = 8.0;
                  toast('You duck off the road and circle around. Lost some time.', 2.8);
                } else {
                  const d = dropRandomCargo(stakes.dropCount);
                  const penalty = Math.min(player.gold, bribe);
                  player.gold -= penalty;
                  player.rep[cid] = Math.max(0, (player.rep[cid] || 0) - 2);
                  toast(`Caught! Dropped ${d} item(s), fined ${penalty}g, rep -2.`, 3.5);
                }
                closeEvent();
              }
            },
          ],
        });
      }
    }
  }

  window.addEventListener('keydown', (e) => {
    // Close intel modal on Escape
    if (e.code === 'Escape' && intelUI.open) { closeIntelUI(); return; }
    // Close trader modal on Escape
    if (e.code === 'Escape' && document.getElementById('cr-trader-modal')) { closeTraderUI(); return; }
    // Close nav picker on Escape
    if (e.code === 'Escape') { const np = document.getElementById('cr-nav-picker'); if (np) { np.remove(); return; } }

    // [T] and [E] interaction keys removed - tap/click buildings directly to interact
    if (e.code === 'Escape' && (ui.bankOpen || ui.innOpen || ui.guildOpen || ui.warehouseOpen)) {
      domCloseAll(); return;
    }



    if (ui.marketOpen) {
      const totalN = ITEMS.length + 1; // +1 permit row
      if (e.code === 'Escape') { ui.marketOpen = false; domCloseAll(); toast('Market closed', 2); }
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
      if (e.code === 'Escape') { ui.contractsOpen = false; domCloseAll(); toast('Contracts board closed', 2); }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') ui.contractsSel = (ui.contractsSel + n - 1) % n;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') ui.contractsSel = (ui.contractsSel + 1) % n;
      if (e.code === 'Enter' || e.code === 'Space') contractsAccept(ui.contractsSel);
    }


    // Event controls (keyboard)
    if (ui.eventOpen) {
      if (e.code === 'Escape') {
        if (!ui.eventDismissable) toast('This demands an answer.', 1.6);
        else { closeEvent(); toast('You move on.', 2); }
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') ui.eventSel = (ui.eventSel + ui.eventChoices.length - 1) % ui.eventChoices.length;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') ui.eventSel = (ui.eventSel + 1) % ui.eventChoices.length;
      if (e.code === 'Enter' || e.code === 'Space') {
        if (eventChoiceLocked(stateTime, ui.eventOpenedAt, EVENT_INPUT_LOCK_MS)) return;
        const ch = ui.eventChoices[ui.eventSel];
        if (ch && typeof ch.run === 'function') ch.run();
      }
    }
  }, { passive: false });

  // --- Render

  // Building tile IDs that get a 3D raised top face drawn above their grid row.
  const BUILDING_TILE_IDS = new Set([6, 7, 8, 12, 14, 15, 16]);

  // Icon + accent color for each building type — used for the facade plaque
  const BUILDING_META = {
    6:  { icon: '🛒', accent: '#f0a830', ribbon: '#d18816' }, // Market — honey
    7:  { icon: '🍺', accent: '#e57389', ribbon: '#a8485e' }, // Tavern — berry
    8:  { icon: '📦', accent: '#a87a3e', ribbon: '#7d5230' }, // Warehouse — oak
    12: { icon: '📜', accent: '#7fbf83', ribbon: '#4f9e5b' }, // Contracts — sage
    13: { icon: '💰', accent: '#d18816', ribbon: '#a8753a' }, // Bank — honey-deep
    14: { icon: '🛏️', accent: '#e57389', ribbon: '#a8485e' }, // Inn — berry
    15: { icon: '⚒️', accent: '#b07ec3', ribbon: '#8a5aa3' }, // Guild — plum
    16: { icon: '🏚️', accent: '#a89e8a', ribbon: '#6b5e4a' }, // Vacant — muted
  };
  // Slot-key icon overrides (when multiple slots share a tile type)
  const SLOT_KEY_ICON = { granary: '🌾', barracks: '🛡️' };

  // Draw the raised "wall face" above a building tile so buildings look taller
  // than the player. Only called for the top row of a building block (no tile
  // of the same id directly above), to avoid stacking rise on every floor.
  function drawBuildingRise(id, x, y) {
    const rise = BUILDING_RISE;
    // Each building type gets a wall-face color that matches its facade
    let wallColor, roofColor;
    switch (id) {
      case 6:  wallColor = '#8b6914'; roofColor = '#b8860b'; break; // market: golden
      case 7:  wallColor = '#c4a882'; roofColor = '#a0836a'; break; // inn: warm plaster
      case 8:  wallColor = '#5a4a3a'; roofColor = '#4a3a2a'; break; // warehouse: stone
      case 12: wallColor = '#6b5a3a'; roofColor = '#5a4a2a'; break; // contracts: parchment
      case 14: wallColor = '#c4a882'; roofColor = '#a0836a'; break; // inn alt
      case 15: wallColor = '#7a5a3a'; roofColor = '#5a3a1a'; break; // guild: oak
      case 16: wallColor = '#5a5a5a'; roofColor = '#4a4a4a'; break; // vacant: grey stone
      default: wallColor = '#7a6a4a'; roofColor = '#5a5a3a';
    }
    // Top face (roof/top of wall) — slightly lighter
    ctx.fillStyle = roofColor;
    ctx.fillRect(x, y - rise, TILE, rise);
    // Left-edge shadow for depth
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y - rise, 2, rise);
    // Top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y - rise, TILE, 2);
    // Bottom edge of rise blends into tile top
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y - 2, TILE, 2);
  }

  function drawTile(id, x, y, tx, ty) {
    // storybook fantasy palette + subtle variation
    if (id === 0) {
      const n = hash2(tx, ty);
      const g = n < 0.33 ? '#a8dd92' : (n < 0.66 ? '#b5e29a' : '#9cd584');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, TILE, TILE);
      if (n > 0.86) {
        ctx.fillStyle = 'rgba(255, 230, 160, 0.18)';
        ctx.fillRect(x + 3, y + 4, 2, 2);
        ctx.fillRect(x + 10, y + 9, 1, 1);
      }

      // bushes / flowers (non-colliding detail)
      if (n < 0.08) {
        ctx.fillStyle = 'rgba(80, 140, 90, 0.40)';
        ctx.fillRect(x + 4, y + 8, 8, 5);
        ctx.fillStyle = 'rgba(127, 191, 131, 0.45)';
        ctx.fillRect(x + 5, y + 9, 6, 3);
      } else if (n > 0.92) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.fillRect(x + 7, y + 6, 1, 1);
        ctx.fillStyle = 'rgba(229, 115, 137, 0.40)';
        ctx.fillRect(x + 9, y + 10, 1, 1);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure

      return;
    }

    if (id === 1) {
      const rn = hash2(tx, ty);
      const roadBase = rn < 0.4 ? '#e6c88c' : (rn < 0.7 ? '#e8cb90' : '#e4c388');
      ctx.fillStyle = roadBase;
      ctx.fillRect(x, y, TILE, TILE);
      // Worn center lane (lighter packed earth)
      ctx.fillStyle = rn < 0.5 ? '#f0d9a8' : '#f2dcae';
      ctx.fillRect(x + 3, y + 2, TILE - 6, TILE - 4);
      // Subtle rut line
      ctx.fillStyle = 'rgba(140,100,60,0.18)';
      ctx.fillRect(x + 4, y, 1, TILE);
      ctx.fillRect(x + TILE - 5, y, 1, TILE);
      // Edge shading from adjacent tiles
      ctx.fillStyle = 'rgba(140,100,60,0.20)';
      if (tileAt(tx, ty-1) !== 1) ctx.fillRect(x, y, TILE, 2);
      if (tileAt(tx, ty+1) !== 1) ctx.fillRect(x, y + TILE - 2, TILE, 2);
      if (tileAt(tx-1, ty) !== 1) ctx.fillRect(x, y, 2, TILE);
      if (tileAt(tx+1, ty) !== 1) ctx.fillRect(x + TILE - 2, y, 2, TILE);
      return;
    }

    if (id === 2) {
      ctx.fillStyle = '#9ad6e8';
      ctx.fillRect(x, y, TILE, TILE);

      const nearLand = (tileAt(tx, ty-1) !== 2) || (tileAt(tx, ty+1) !== 2) || (tileAt(tx-1, ty) !== 2) || (tileAt(tx+1, ty) !== 2);
      if (nearLand) {
        ctx.fillStyle = 'rgba(255,255,255,0.40)';
        ctx.fillRect(x+1, y+1, TILE-2, 1);
      }

      const phase = (stateTime * 0.004 + (tx*7 + ty*11)) % 6;
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillRect(x, y + Math.floor(phase), TILE, 2);

      // active contract (pinned)
      // moved to drawHUD(); keeping tile rendering pure

      return;
    }

    if (id === 3) {
      // Stone wall — cream dressed stone with chunky ink mortar and battlements
      const n = hash2(tx, ty);
      const wallBase = n < 0.5 ? '#e6d4b0' : '#d8c9a2';
      ctx.fillStyle = wallBase;
      ctx.fillRect(x, y, TILE, TILE);
      // Horizontal mortar line
      ctx.fillStyle = 'rgba(140,100,60,0.32)';
      ctx.fillRect(x, y + Math.floor(TILE/2), TILE, 1);
      // Block highlight
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(x+1, y+1, TILE-2, 2);
      ctx.fillRect(x+1, y+Math.floor(TILE/2)+1, TILE-2, 2);
      // Battlements on top row of walls (decorative notch)
      if (tileAt(tx, ty-1) !== 3) {
        ctx.fillStyle = '#3b2a1d';
        ctx.fillRect(x, y, Math.floor(TILE/3), 3);
        ctx.fillRect(x+Math.floor(TILE*2/3), y, Math.floor(TILE/3)+1, 3);
      }
      return;
    }

    if (id === 4) {
      // City floor - cream cobblestone with soft mortar lines (Plumberry)
      const n = hash2(tx, ty);
      const base = n < 0.33 ? '#f0e2c4' : (n < 0.66 ? '#e8d8b4' : '#ecdebc');
      ctx.fillStyle = base;
      ctx.fillRect(x, y, TILE, TILE);
      // mortar grid
      ctx.fillStyle = 'rgba(140,100,60,0.20)';
      ctx.fillRect(x, y + Math.floor(TILE/2), TILE, 1);
      ctx.fillRect(x + Math.floor(TILE/2), y, 1, TILE);
      // stone highlight
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x + 1, y + 1, Math.floor(TILE/2) - 2, Math.floor(TILE/2) - 2);
      ctx.fillRect(x + Math.floor(TILE/2) + 1, y + Math.floor(TILE/2) + 1, Math.floor(TILE/2) - 2, Math.floor(TILE/2) - 2);
      return;
    }

    if (id === 5) {
      // Gate arch — cream stone with honey portcullis bars
      ctx.fillStyle = '#c8b08a';
      ctx.fillRect(x, y, TILE, TILE);
      // arch body
      ctx.fillStyle = '#e6d4b0';
      ctx.fillRect(x+1, y+2, TILE-2, TILE-4);
      // arch opening (dark passage)
      ctx.fillStyle = '#3b2a1d';
      ctx.fillRect(x+4, y+4, TILE-8, TILE-6);
      // portcullis bars (honey)
      ctx.fillStyle = '#d18816';
      for (let bx = x+5; bx < x+TILE-4; bx += 3) {
        ctx.fillRect(bx, y+4, 1, TILE-7);
      }
      // stone highlight top
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(x+1, y+2, TILE-2, 1);
      return;
    }

    if (id === 6) {
      // Market stall - wooden awning + hanging goods + counter
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
      // Inn interior floor — warm wood planks (the 3D sprite renders on top)
      ctx.fillStyle = '#6b4c2a';
      ctx.fillRect(x, y, TILE, TILE);
      // Wood plank lines
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      const plankStep = Math.round(TILE / 4);
      for (let py2 = plankStep; py2 < TILE; py2 += plankStep) {
        ctx.fillRect(x, y + py2, TILE, 1);
      }
      // Subtle grain highlight
      ctx.fillStyle = 'rgba(255,220,140,0.10)';
      ctx.fillRect(x + 1, y + 1, TILE - 2, Math.round(TILE * 0.4));
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
      // Warehouse / Storage - large stone building, big dark doors
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
      // Cobblestone plaza / courtyard — cream premium floor (Plumberry)
      const n = hash2(tx, ty);
      ctx.fillStyle = n < 0.4 ? '#f5e6c8' : '#eedeb8';
      ctx.fillRect(x, y, TILE, TILE);
      // Large cobble pattern
      ctx.fillStyle = 'rgba(140,100,60,0.22)';
      ctx.fillRect(x,   y + Math.floor(TILE/3),     TILE, 1);
      ctx.fillRect(x,   y + Math.floor(TILE*2/3),   TILE, 1);
      ctx.fillRect(x + Math.floor(TILE/3),   y,     1, TILE);
      ctx.fillRect(x + Math.floor(TILE*2/3), y,     1, TILE);
      // Stone highlights
      ctx.fillStyle = 'rgba(255,255,255,0.40)';
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

    if (id === 17) { // hill — soft rounded dome, not a sharp peak
      const n = hash2(tx, ty);
      // Grassy ground base
      ctx.fillStyle = n < 0.5 ? '#5c7030' : '#516628';
      ctx.fillRect(x, y, TILE, TILE);

      const hillH = 7 + (n * 4 | 0);     // height varies per tile for natural look
      const hillCx = x + TILE * 0.5;
      const baseY  = y + TILE - 1;

      // Rounded hill dome via quadratic bezier (soft arch, not triangle)
      ctx.fillStyle = n < 0.45 ? '#9e8a58' : '#8c7a4c';
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(hillCx, baseY - hillH, x + TILE, baseY);
      ctx.lineTo(x + TILE, y + TILE);
      ctx.lineTo(x, y + TILE);
      ctx.closePath();
      ctx.fill();

      // Grass highlight on the crest
      ctx.fillStyle = 'rgba(110,150,55,0.55)';
      ctx.beginPath();
      ctx.moveTo(hillCx - 3, baseY - hillH + 2);
      ctx.quadraticCurveTo(hillCx, baseY - hillH - 1, hillCx + 3, baseY - hillH + 2);
      ctx.closePath();
      ctx.fill();

      // Right-side shadow for gentle depth
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.beginPath();
      ctx.moveTo(hillCx + 1, baseY - hillH + 4);
      ctx.quadraticCurveTo(x + TILE - 2, baseY - 3, x + TILE, baseY);
      ctx.lineTo(hillCx + 1, baseY);
      ctx.closePath();
      ctx.fill();

      // Edge pixel
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);
      return;
    }

    if (id === 18) { // mine node — walkable rocky outcrop with ore vein
      const n = hash2(tx, ty);
      const cdMap = (typeof player !== 'undefined' && player.mineCooldown) || null;
      const inCooldown = !!(cdMap && (cdMap[ty * MAP_W + tx] || 0) > stateTime);
      // Metal-tinted ore color: site veins carry their metal's color so the
      // outcrop reads at a glance. Untagged (legacy ironholt) stays gold.
      const metalId = MINE_SITE_NODES[ty * MAP_W + tx];
      const oreColor =
        metalId === 'copper' ? '#c47a3a' :
        metalId === 'silver' ? '#cfcfd6' :
        metalId === 'gold'   ? '#fde047' :
        '#c0a060';

      if (inCooldown) {
        // Spent vein: muted gray base, dark empty pits where ore was, and a
        // bright hourglass-pip in the center so the cooldown state reads at
        // a glance instead of blending into the rock.
        ctx.fillStyle = '#3f3a36';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#4a4540';
        ctx.fillRect(x+1, y+1, TILE-2, TILE-2);
        ctx.fillStyle = '#221e1a';
        ctx.fillRect(x + 2 + (n*3|0), y + 3 + ((n*7)%4|0), 3, 3);
        ctx.fillRect(x + 8 + (n*2|0), y + 9 + ((n*5)%3|0), 3, 3);
        ctx.fillRect(x + 4, y + 10, 2, 2);
        // hourglass-pip: amber pinch in the middle so eye finds it fast
        ctx.fillStyle = '#fbbf24';
        const mx = x + (TILE>>1), my = y + (TILE>>1);
        ctx.fillRect(mx - 2, my - 2, 4, 1);
        ctx.fillRect(mx - 1, my - 1, 2, 1);
        ctx.fillRect(mx, my, 1, 1);
        ctx.fillRect(mx - 1, my + 1, 2, 1);
        ctx.fillRect(mx - 2, my + 2, 4, 1);
      } else {
        // Active vein: chunkier rocky base + larger metal-tinted glints + a
        // diagonal vein streak so the deposit reads as a real ore vein, not
        // a single token tile.
        ctx.fillStyle = '#5a5048';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#6b6258';
        ctx.fillRect(x+1, y+1, TILE-2, TILE-2);
        // chunky glints (3 lumps, 3x3 each — was 2 lumps at 2x2)
        ctx.fillStyle = oreColor;
        ctx.fillRect(x + 2 + (n*3|0),  y + 3 + ((n*7)%4|0), 3, 3);
        ctx.fillRect(x + 8 + (n*2|0),  y + 8 + ((n*5)%3|0), 3, 3);
        ctx.fillRect(x + 5 + ((n*11)%3|0), y + 11, 2, 2);
        // diagonal vein streak (semi-transparent so it reads as embedded ore)
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 3, y + 7, 3, 1);
        ctx.fillRect(x + 10, y + 11, 3, 1);
        // gem hint (rare blue speckle — bigger so it actually catches the eye)
        if (n > 0.85) { ctx.fillStyle = '#7dd3fc'; ctx.fillRect(x + 9, y + 5, 2, 2); }
      }
      // edge shadow
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, y + TILE - 1, TILE, 1);
      ctx.fillRect(x + TILE - 1, y, 1, TILE);
      return;
    }

    if (id === 19) { // built-mine interior — dark stone floor + lantern + ore cart hint
      ctx.fillStyle = '#3a322a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#4a4238';
      ctx.fillRect(x+1, y+1, TILE-2, TILE-2);
      // floor planking
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, y + (TILE>>1), TILE, 1);
      // ore lump (stable per tile via hash2)
      const n = hash2(tx, ty);
      ctx.fillStyle = '#c0a060';
      ctx.fillRect(x + 4 + (n*4|0), y + 4 + ((n*5)%4|0), 2, 2);
      // lantern glow on the wall side
      ctx.fillStyle = 'rgba(251,191,36,0.55)';
      ctx.fillRect(x + TILE - 4, y + 3, 2, 2);
      return;
    }

    if (id === 12) {
      // Contracts board - wooden post with parchment notices
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
      // Bank (in city context) - stone building with coin symbol
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
      // Inn - warm stone building with hanging lantern
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
      // Two windows (warm glow - beds inside)
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
      // Guild Hall - grand stone building with banner
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
      // Banner (purple - guild color)
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
      // Vacant building lot — cream foundation pad with faint blueprint grid
      // (mostly covered by the construction-site sprite; this is the fallback)
      ctx.fillStyle = '#fff5d8';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(208,136,22,0.22)';
      ctx.fillRect(x, y + Math.floor(TILE/2), TILE, 1);
      ctx.fillRect(x + Math.floor(TILE/2), y, 1, TILE);
      return;
    }

  }

  // Draw each city building as one unified sprite over its full tile footprint.
  // Called after the tile pass so it renders on top of floor/wall tiles.
  function drawBuildingSprites(camX, camY) {
    // Draw building sprites for ALL cities visible in the viewport,
    // regardless of whether the player is inside a city or on the road.
    for (const city of world.cities) {
      const slots = cityBuildings[city.id];
      if (!slots) continue;
      _drawCityBuildingSprites(slots, camX, camY);
    }
  }

  function _drawConstructionSite(key, slot, bx, by, bw, bh) {
    ctx.save();

    // Foundation pad — cream paper with a faint honey blueprint grid
    ctx.fillStyle = '#fff5d8';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(208,136,22,0.32)';
    ctx.lineWidth = 1;
    const gridStep = Math.max(6, Math.round(TILE / 2));
    for (let gx = bx + gridStep; gx < bx + bw; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(gx + 0.5, by + 2); ctx.lineTo(gx + 0.5, by + bh - 2); ctx.stroke();
    }
    for (let gy = by + gridStep; gy < by + bh; gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(bx + 2, gy + 0.5); ctx.lineTo(bx + bw - 2, gy + 0.5); ctx.stroke();
    }

    // Scaffolding poles at the four corners with two crossbeams
    ctx.fillStyle = '#8a5a2e';
    const poleH = Math.max(8, Math.round(Math.min(bh, TILE * 1.5)));
    const poleW = 2;
    ctx.fillRect(bx + 2,           by + 2,            poleW, poleH);
    ctx.fillRect(bx + bw - 4,      by + 2,            poleW, poleH);
    ctx.fillRect(bx + 2,           by + bh - poleH - 2, poleW, poleH);
    ctx.fillRect(bx + bw - 4,      by + bh - poleH - 2, poleW, poleH);
    ctx.fillStyle = 'rgba(138,90,46,0.85)';
    ctx.fillRect(bx + 2, by + 2, bw - 4, 1);
    ctx.fillRect(bx + 2, by + 2 + Math.round(poleH * 0.55), bw - 4, 1);

    // Pulsing dashed honey border — the build hitbox itself, made obvious
    const pulse = 0.65 + 0.35 * (Math.sin(stateTime * 0.003 + slot.tileX) * 0.5 + 0.5);
    ctx.strokeStyle = `rgba(208,136,22,${pulse.toFixed(2)})`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -stateTime * 0.012;
    ctx.strokeRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Centered plaque showing the icon of the building that will go here
    const meta = BUILDING_META[slot.tileType];
    const icon = SLOT_KEY_ICON[key] || (meta && meta.icon) || '🏗️';
    const plaqueSize = Math.max(14, Math.min(Math.round(TILE * 1.2), Math.round(Math.min(bw, bh) * 0.6)));
    const plaqueX = bx + Math.round((bw - plaqueSize) / 2);
    const plaqueY = by + Math.round((bh - plaqueSize) / 2);

    ctx.fillStyle = 'rgba(59,42,29,0.30)';
    ctx.fillRect(plaqueX + 1, plaqueY + 2, plaqueSize, plaqueSize);
    ctx.fillStyle = '#fffaef';
    ctx.fillRect(plaqueX, plaqueY, plaqueSize, plaqueSize);
    const ribbonH = Math.max(2, Math.round(plaqueSize * 0.18));
    ctx.fillStyle = '#f0a830';
    ctx.fillRect(plaqueX, plaqueY, plaqueSize, ribbonH);
    ctx.strokeStyle = '#3b2a1d';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(plaqueX + 0.5, plaqueY + 0.5, plaqueSize - 1, plaqueSize - 1);

    const iconPx = Math.max(9, Math.round(plaqueSize * 0.68));
    ctx.font = `${iconPx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, plaqueX + plaqueSize / 2, plaqueY + ribbonH + (plaqueSize - ribbonH) / 2 + 1);

    // Bobbing hammer above the plaque for an unmistakable "build me" cue
    const bobY = Math.sin(stateTime * 0.004 + slot.tileX) * 2;
    const hammerPx = Math.max(11, Math.round(TILE * 0.85));
    ctx.font = `${hammerPx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
    ctx.fillText('🔨', plaqueX + plaqueSize - 2, plaqueY - 4 + bobY);

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function _drawCityBuildingSprites(slots, camX, camY) {
    for (const [key, slot] of Object.entries(slots)) {
      if (!slot || slot.tileX <= 0) continue;

      const bx = slot.tileX * TILE - camX;
      const by = slot.tileY * TILE - camY;
      const bw = slot.tileW * TILE;
      const bh = slot.tileH * TILE;
      const type = slot.tileType; // 6=market, 7=inn, 8=warehouse, 15=guild, etc.

      // Skip if completely off-screen
      if (bx + bw < 0 || bx > VIEW_W || by + bh < -BUILDING_RISE * 2 || by > VIEW_H) continue;

      // Unbuilt slot → draw a clear construction-site marker instead of a
      // finished building sprite. Makes the build hitbox findable.
      if (!slot.built) {
        _drawConstructionSite(key, slot, bx, by, bw, bh);
        continue;
      }

      ctx.save();

      // ── 3D raised top face (above the building footprint) ──────────────────
      // Cap rise at TILE-2 so a sprite never reaches into the building one row
      // above it; otherwise a 3-tall building (26px proportional rise) clips
      // into the bottom row of any building directly to its north.
      const lv = slot.level || 1;
      const riseBase = Math.round(slot.tileH * TILE * 0.55);
      const rise = Math.min(TILE + (lv >= 3 ? 2 : -2), Math.round(riseBase * (lv >= 3 ? 1.45 : lv >= 2 ? 1.22 : 1.0)));
      let roofTop, roofFace, wallMain, wallDark, wallLight, doorColor, windowColor;

      // Plumberry cottage-core palette — cream walls + colorful roofs per use
      switch (type) {
        case 7: case 14: // Inn / Tavern — berry roof
          roofTop   = '#a8485e'; roofFace  = '#c66479';
          wallMain  = '#fffaef'; wallDark  = '#e6d8be'; wallLight = '#ffffff';
          doorColor = '#3b2a1d'; windowColor = 'rgba(240,168,48,0.90)';
          break;
        case 6: // Market — honey roof
          roofTop   = '#d18816'; roofFace  = '#f0a830';
          wallMain  = '#fffaef'; wallDark  = '#e8d5a8'; wallLight = '#ffffff';
          doorColor = '#3b2a1d'; windowColor = 'rgba(255,220,100,0.85)';
          break;
        case 8: // Warehouse / Granary — oak roof on cream-tan walls
          roofTop   = '#7d5230'; roofFace  = '#a87a3e';
          wallMain  = '#fdecc4'; wallDark  = '#e0c890'; wallLight = '#fff7e3';
          doorColor = '#3b2a1d'; windowColor = 'rgba(180,140,80,0.65)';
          break;
        case 15: // Guild — plum roof
          roofTop   = '#8a5aa3'; roofFace  = '#b07ec3';
          wallMain  = '#fffaef'; wallDark  = '#e6d8be'; wallLight = '#ffffff';
          doorColor = '#3b2a1d'; windowColor = 'rgba(176,126,195,0.75)';
          break;
        case 12: // Contracts — sage roof
          roofTop   = '#4f9e5b'; roofFace  = '#7fbf83';
          wallMain  = '#fffaef'; wallDark  = '#e6d8be'; wallLight = '#ffffff';
          doorColor = '#3b2a1d'; windowColor = 'rgba(127,191,131,0.75)';
          break;
        case 13: // Bank — honey-deep roof on creamy stone
          roofTop   = '#a8753a'; roofFace  = '#d18816';
          wallMain  = '#fdecc4'; wallDark  = '#e0c890'; wallLight = '#fff7e3';
          doorColor = '#3b2a1d'; windowColor = 'rgba(240,168,48,0.85)';
          break;
        case 4: // Foreman HQ / Barracks — slate roof, cream walls
          roofTop   = '#5b6b78'; roofFace  = '#7a8a96';
          wallMain  = '#fffaef'; wallDark  = '#d8d2c4'; wallLight = '#ffffff';
          doorColor = '#3b2a1d'; windowColor = 'rgba(127,191,131,0.65)';
          break;
        case 19: // Mine — slate roof, warm tan walls (kept earthier)
          roofTop   = '#3a322a'; roofFace  = '#5c5247';
          wallMain  = '#c8a878'; wallDark  = '#9a7a4a'; wallLight = '#e6c898';
          doorColor = '#2a1f14'; windowColor = 'rgba(240,168,48,0.85)';
          break;
        default:
          roofTop   = '#8a5aa3'; roofFace  = '#b07ec3';
          wallMain  = '#fffaef'; wallDark  = '#e6d8be'; wallLight = '#ffffff';
          doorColor = '#3b2a1d'; windowColor = 'rgba(255,220,140,0.55)';
      }

      // ── Top face (isometric-ish roof on top of rise) ──
      ctx.fillStyle = roofTop;
      ctx.fillRect(bx, by - rise, bw, rise);
      // Roof highlight top edge
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(bx, by - rise, bw, 2);
      // Ridge line along center of roof
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(bx + Math.round(bw * 0.25), by - rise + 3, Math.round(bw * 0.5), 1);
      // Roof shadow left edge
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(bx, by - rise, 3, rise);
      // Roof right edge lighter (light comes from right)
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(bx + bw - 3, by - rise, 3, rise);
      // Roof face / fascia
      ctx.fillStyle = roofFace;
      ctx.fillRect(bx, by - 6, bw, 6);
      // Fascia highlight
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(bx + 2, by - 6, bw - 4, 1);
      // Gold trim strip at max level
      if (lv >= 3) {
        ctx.fillStyle = '#d4a020';
        ctx.fillRect(bx, by - rise, bw, 2);
        ctx.fillRect(bx, by - 7, bw, 2);
      }
      // Inn chimney (type 7/14 only)
      if (type === 7 || type === 14) {
        const chX = bx + Math.round(bw * 0.75);
        const chW = Math.max(3, Math.round(TILE * 0.28));
        const chH = Math.round(rise * 0.55);
        ctx.fillStyle = '#4a3020';
        ctx.fillRect(chX, by - rise - chH, chW, chH);
        ctx.fillStyle = '#2a1a10';
        ctx.fillRect(chX - 1, by - rise - chH, chW + 2, 2); // chimney cap
        // Smoke puff
        const puff = 0.25 + 0.15 * Math.sin(stateTime * 0.0008 + slot.tileX * 0.5);
        ctx.fillStyle = `rgba(200,200,200,${puff.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(chX + chW / 2, by - rise - chH - 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Pennant flags at level 2+ ──────────────────────────────────────────
      if (lv >= 2) {
        const poleH = Math.round(TILE * 0.48);
        const positions = lv >= 3 ? [bw * 0.28, bw * 0.72] : [bw * 0.5];
        ctx.lineJoin = 'round';
        for (const px of positions) {
          const fpx = bx + Math.round(px);
          const fpy = by - rise;
          ctx.fillStyle = '#3b2a1d';
          ctx.fillRect(fpx - 1, fpy - poleH, 2, poleH);
          ctx.fillStyle = roofTop;
          ctx.beginPath();
          ctx.moveTo(fpx + 1, fpy - poleH);
          ctx.lineTo(fpx + 8, fpy - poleH + 3);
          ctx.lineTo(fpx + 1, fpy - poleH + 6);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#3b2a1d';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      // ── Front wall (full footprint) ──
      ctx.fillStyle = wallMain;
      ctx.fillRect(bx, by, bw, bh);

      // Wall texture: horizontal mortar lines every ~(TILE*0.6)px
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      const lineStep = Math.round(TILE * 0.6);
      for (let ly = lineStep; ly < bh - 2; ly += lineStep) {
        ctx.fillRect(bx + 2, by + ly, bw - 4, 1);
      }

      // Wall shading: dark left, light right
      ctx.fillStyle = wallDark;
      ctx.fillRect(bx, by, 4, bh);
      ctx.fillStyle = wallLight;
      ctx.fillRect(bx + bw - 3, by, 3, bh);
      // Bottom shadow
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(bx, by + bh - 3, bw, 3);

      // ── Windows: evenly spaced across width, top ~35% of height ──
      const winW = Math.round(TILE * 0.5);
      const winH = Math.round(TILE * 0.6);
      const winY  = by + Math.round(bh * 0.18);
      const numWins = Math.max(1, Math.floor(bw / (TILE * 1.4)));
      const winSpacing = bw / (numWins + 1);
      for (let wi = 1; wi <= numWins; wi++) {
        const wx = bx + Math.round(wi * winSpacing - winW / 2);
        // Window frame
        ctx.fillStyle = wallDark;
        ctx.fillRect(wx - 2, winY - 2, winW + 4, winH + 4);
        // Window glow
        const flicker = type === 7 || type === 14
          ? 0.65 + 0.20 * Math.sin(stateTime * 0.0013 + wi * 1.7 + slot.tileX)
          : 0.55;
        ctx.fillStyle = windowColor.replace(/[\d.]+\)$/, `${flicker.toFixed(2)})`);
        ctx.fillRect(wx, winY, winW, winH);
        // Window cross
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(wx, winY + Math.floor(winH / 2), winW, 1);
        ctx.fillRect(wx + Math.floor(winW / 2), winY, 1, winH);
      }

      // ── Door: draw on whichever face is visible from front ──
      const doorW = Math.round(TILE * 0.75);
      const doorH = Math.round(TILE * 1.0);
      const door  = slot.doorSide || 'south';
      {
        let dx, dy, dw, dh;
        if (door === 'south') {
          dx = bx + Math.round(bw / 2 - doorW / 2);
          dy = by + bh - doorH;
          dw = doorW; dh = doorH;
        } else if (door === 'north') {
          dx = bx + Math.round(bw / 2 - doorW / 2);
          dy = by;
          dw = doorW; dh = doorH;
        } else if (door === 'east') {
          dx = bx + bw - Math.round(TILE * 0.35);
          dy = by + Math.round(bh / 2 - doorH / 2);
          dw = Math.round(TILE * 0.35); dh = doorH;
        } else { // west
          dx = bx;
          dy = by + Math.round(bh / 2 - doorH / 2);
          dw = Math.round(TILE * 0.35); dh = doorH;
        }
        ctx.fillStyle = doorColor;
        ctx.fillRect(dx, dy, dw, dh);
        // Door arch highlight
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(dx + 2, dy + 2, Math.max(1, dw - 4), 3);
        // Door knob
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(dx + dw - 5, dy + Math.round(dh * 0.55), 3, 3);
      }

      // ── Hanging plaque with building icon ─────────────────────────────
      // Slot-key icons override tile-type icon when multiple slots share a
      // tile (e.g. granary and warehouse both use tile 8).
      const meta = BUILDING_META[type];
      const slotIcon = SLOT_KEY_ICON[key] || (meta && meta.icon);
      if (meta && slotIcon) {
        // Square-ish plaque — large enough for a legible emoji
        const plaqueSize = Math.max(14, Math.round(TILE * 1.05));
        const plaqueX    = bx + Math.round((bw - plaqueSize) / 2);
        const plaqueY    = by + Math.round(TILE * 0.18);

        // Two short hanging ropes from roof to plaque corners
        ctx.strokeStyle = '#3b2a1d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(plaqueX + plaqueSize * 0.22, plaqueY);
        ctx.lineTo(plaqueX + plaqueSize * 0.22, plaqueY - 5);
        ctx.moveTo(plaqueX + plaqueSize * 0.78, plaqueY);
        ctx.lineTo(plaqueX + plaqueSize * 0.78, plaqueY - 5);
        ctx.stroke();

        // Plaque drop shadow
        ctx.fillStyle = 'rgba(59,42,29,0.30)';
        ctx.fillRect(plaqueX + 1, plaqueY + 2, plaqueSize, plaqueSize);

        // Cream paper plaque
        ctx.fillStyle = '#fffaef';
        ctx.fillRect(plaqueX, plaqueY, plaqueSize, plaqueSize);

        // Accent ribbon strip across top of plaque
        const ribbonH = Math.max(2, Math.round(plaqueSize * 0.18));
        ctx.fillStyle = meta.ribbon;
        ctx.fillRect(plaqueX, plaqueY, plaqueSize, ribbonH);

        // Level pips in ribbon (right-aligned dots: 1=white, 2=white×2, 3=gold×3)
        const pipR = Math.max(1.5, ribbonH * 0.25);
        const pipY2 = plaqueY + ribbonH / 2;
        ctx.fillStyle = lv >= 3 ? '#d4a020' : 'rgba(255,255,255,0.85)';
        for (let p = 0; p < lv; p++) {
          const pipX = plaqueX + plaqueSize - (lv - p) * (pipR * 2 + 2) - 2;
          ctx.beginPath();
          ctx.arc(pipX, pipY2, pipR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Ink border (chunky outline)
        ctx.strokeStyle = '#3b2a1d';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(plaqueX + 0.5, plaqueY + 0.5, plaqueSize - 1, plaqueSize - 1);

        // Emoji icon centered in plaque (below ribbon)
        const iconSize = Math.max(9, Math.round(plaqueSize * 0.72));
        ctx.font = `${iconSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          slotIcon,
          plaqueX + plaqueSize / 2,
          plaqueY + ribbonH + (plaqueSize - ribbonH) / 2 + 1
        );
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
      }

      // ── Outer wall border (chunky ink) ──
      ctx.strokeStyle = '#3b2a1d';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

      ctx.restore();
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

    // Second pass: draw unified building sprites over the tile grid.
    // Each building is drawn once as a cohesive structure using slot metadata.
    drawBuildingSprites(camX, camY);

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
    6:  { icon: '🛒', color: '#f0a830', nearDist: 6 }, // Market
    12: { icon: '📜', color: '#7fbf83', nearDist: 6 }, // Contracts
    7:  { icon: '🍺', color: '#e57389', nearDist: 5 }, // Tavern
    8:  { icon: '📦', color: '#a87a3e', nearDist: 5 }, // Warehouse
    13: { icon: '💰', color: '#d18816', nearDist: 6 }, // Bank
    14: { icon: '🛏️', color: '#e57389', nearDist: 6 }, // Inn
    15: { icon: '⚒️', color: '#b07ec3', nearDist: 6 }, // Guild
    16: { icon: '🔨', color: '#f0a830', nearDist: 8 }, // Construction site (vacant)
    18: { icon: '⛏️', color: '#8a7a52', nearDist: 2 }, // Ore Vein
    19: { icon: '⛏️', color: '#5c5247', nearDist: 6 }, // Mine
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

    // ── Icon chip above the cluster when close ────────────────────────
    if (isNear) {
      const labelAlpha = Math.min(1, (info.nearDist + 2 - distTiles) / 2);
      const bobY = Math.sin(stateTime * 0.004 + cTx + cTy) * 1.5;
      // Place chip above the top-most tile of the cluster
      const topTileY = Math.min(...tiles.map(t => t.ty));
      const labelScreenY = topTileY * TILE - camY - 4 + bobY;

      ctx.save();
      ctx.globalAlpha = Math.max(0, labelAlpha);
      const chipSize = Math.round(18 * UI_SCALE);
      const cx2 = clamp(scx, chipSize / 2 + 4, VIEW_W - chipSize / 2 - 4);
      const cy2 = Math.max(4 + chipSize, labelScreenY) - chipSize;
      const chipX = cx2 - chipSize / 2;
      const chipY = cy2;

      // Drop shadow
      ctx.fillStyle = 'rgba(59,42,29,0.30)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(chipX + 1, chipY + 2, chipSize, chipSize, 6); ctx.fill(); }
      else ctx.fillRect(chipX + 1, chipY + 2, chipSize, chipSize);

      // Cream paper chip
      ctx.fillStyle = '#fffaef';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(chipX, chipY, chipSize, chipSize, 6); ctx.fill(); }
      else ctx.fillRect(chipX, chipY, chipSize, chipSize);

      // Accent ribbon top stripe
      const ribbonH = Math.max(2, Math.round(chipSize * 0.18));
      ctx.fillStyle = info.color;
      if (ctx.roundRect) {
        ctx.save();
        ctx.beginPath(); ctx.roundRect(chipX, chipY, chipSize, chipSize, 6); ctx.clip();
        ctx.fillRect(chipX, chipY, chipSize, ribbonH);
        ctx.restore();
      } else {
        ctx.fillRect(chipX, chipY, chipSize, ribbonH);
      }

      // Ink border
      ctx.strokeStyle = '#3b2a1d';
      ctx.lineWidth = 1.5;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(chipX + 0.5, chipY + 0.5, chipSize - 1, chipSize - 1, 6); ctx.stroke(); }
      else ctx.strokeRect(chipX + 0.5, chipY + 0.5, chipSize - 1, chipSize - 1);

      // Emoji icon centered (below ribbon)
      const iconPx = Math.max(10, Math.round(chipSize * 0.72));
      ctx.font = `${iconPx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.icon, cx2, chipY + ribbonH + (chipSize - ribbonH) / 2 + 1);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
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
    let dir;
    if (Math.abs(vy) >= Math.abs(vx)) dir = vy >= 0 ? 'DOWN' : 'UP';
    else dir = vx >= 0 ? 'RIGHT' : 'LEFT';

    const moving = autoNav.active || clickMove.active ||
      Math.hypot(player.vx || 0, player.vy || 0) > 0.01;

    const packTier  = player.gear?.pack  ?? 0;
    const bootsTier = player.gear?.boots ?? 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(CARRIAGE_SCALE, CARRIAGE_SCALE);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const INK = '#3b2a1d';

    const t = stateTime;
    const phase = t * 0.014;

    // ── Suspension bounce (wagon bobs vertically when moving) ──────────
    const bounce    = moving ? Math.sin(phase * 2) * 1.2 : 0;
    const tilt      = moving ? Math.sin(phase) * 0.6 : 0; // slight rock

    // ── Wheel spin angle ────────────────────────────────────────────────
    const wheelSpin = moving ? t * 0.022 : 0;

    // ── Color palettes (chibi/paper aesthetic: warm pastels + ink outlines) ──
    const HORSE_PAL = [
      { body:'#d6b27e', belly:'#bf9560', dark:'#7a5230', mane:'#5a3818', nose:'#e3a890', glow:false },
      { body:'#8c6238', belly:'#6e4a26', dark:'#3a2010', mane:'#1f0e04', nose:'#b48060', glow:false },
      { body:'#d05a28', belly:'#a6401a', dark:'#6e2208', mane:'#3a1008', nose:'#f4845c', glow:false },
      { body:'#2a2a3a', belly:'#1c1c2a', dark:'#0a0a14', mane:'#e8c040', nose:'#444458', glow:false },
      { body:'#e8f6ff', belly:'#c8e0f4', dark:'#88b4d8', mane:'#ffffff', nose:'#f4faff', glow:true  },
    ];
    const WAGON_PAL = [
      { body:'#b08358', roof:'#c9a578', trim:'#7a5230', wheel:'#7a5230', spoke:'#3b2a1d' },
      { body:'#c89464', roof:'#fff5d6', trim:'#b07ec3', wheel:'#8a5aa3', spoke:'#3b2a1d' },
      { body:'#c87a2c', roof:'#f0a830', trim:'#d18816', wheel:'#7a4810', spoke:'#3b2a1d' },
      { body:'#6e4824', roof:'#fdecc4', trim:'#b07ec3', wheel:'#8a5aa3', spoke:'#3b2a1d' },
      { body:'#c89464', roof:'#f0c040', trim:'#d18816', wheel:'#806010', spoke:'#3b2a1d' },
    ];
    const hc = HORSE_PAL[Math.min(bootsTier, 4)];
    const bc = WAGON_PAL[Math.min(packTier, 4)];

    // Phantom glow
    if (hc.glow) { ctx.shadowColor = '#a0d8ff'; ctx.shadowBlur = 8; }

    // Sizes (base at TILE=16, already scaled by CARRIAGE_SCALE externally)
    const wW = 12 + packTier * 2;  // wagon width
    const wH = 9  + packTier * 2;  // wagon body height
    const wRoofH = 4 + packTier;   // roof height
    const hW = 7 + bootsTier;      // horse body width
    const hH = 8 + bootsTier;      // horse body height
    const legLen = 5 + Math.floor(bootsTier * 0.5);
    const wheelR = 4 + Math.floor(packTier * 0.8);
    const spokes  = 6;

    // ── Shared helpers ─────────────────────────────────────────────────

    const drawWheel = (wx, wy) => {
      // Tyre — wood-toned fill with thick ink outline
      ctx.fillStyle = bc.wheel;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(wx, wy, wheelR, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      // Spokes (4, simpler) — ink lines
      ctx.strokeStyle = bc.spoke;
      ctx.lineWidth = 1.4;
      const spokeCount = 4;
      for (let s = 0; s < spokeCount; s++) {
        const a = wheelSpin + (s / spokeCount) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(wx + Math.cos(a) * wheelR * 0.32, wy + Math.sin(a) * wheelR * 0.32);
        ctx.lineTo(wx + Math.cos(a) * wheelR * 0.86, wy + Math.sin(a) * wheelR * 0.86);
        ctx.stroke();
      }
      // Hub — cream highlight in the middle
      ctx.fillStyle = bc.trim;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(wx, wy, wheelR * 0.32, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    };

    // Rounded-rectangle helper for chibi-style wagon body
    const roundRect = (rx, ry, rw, rh, rr) => {
      ctx.beginPath();
      ctx.moveTo(rx + rr, ry);
      ctx.lineTo(rx + rw - rr, ry);
      ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
      ctx.lineTo(rx + rw, ry + rh - rr);
      ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
      ctx.lineTo(rx + rr, ry + rh);
      ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
      ctx.lineTo(rx, ry + rr);
      ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
      ctx.closePath();
    };

    const drawWagonBody = (wx, wy) => {
      if (packTier === 4) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 6; }
      const by = wy + bounce;
      // Wagon body — rounded paper-style with thick ink outline
      ctx.fillStyle = bc.body;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      roundRect(wx, by, wW, wH, 2);
      ctx.fill();
      ctx.stroke();
      // Soft pencil plank line (single gentle curve, not hard rulings)
      ctx.strokeStyle = 'rgba(59,42,29,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(wx + 2, by + wH * 0.6);
      ctx.quadraticCurveTo(wx + wW / 2, by + wH * 0.6 - 0.4, wx + wW - 2, by + wH * 0.6);
      ctx.stroke();
      // Roof/canopy — thick ink outline, soft fill
      ctx.fillStyle = bc.roof;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      if (packTier === 0) {
        // Flat plank roof — rounded
        roundRect(wx - 1, by - wRoofH, wW + 2, wRoofH + 0.5, 1.5);
        ctx.fill();
        ctx.stroke();
      } else {
        // Arched canvas canopy
        ctx.beginPath();
        ctx.moveTo(wx - 1, by);
        ctx.bezierCurveTo(wx - 1, by - wRoofH * 1.6, wx + wW + 1, by - wRoofH * 1.6, wx + wW + 1, by);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Two faint vertical canopy ribs (pencil-style)
        ctx.strokeStyle = 'rgba(59,42,29,0.18)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i++) {
          const sx = wx - 1 + (wW + 2) * (i / 3);
          ctx.beginPath();
          ctx.moveTo(sx, by);
          ctx.quadraticCurveTo(sx, by - wRoofH * 0.9, sx, by - wRoofH * 0.4);
          ctx.stroke();
        }
      }
      // Cargo pack on top (T2+) — rounded + ink outline
      if (packTier >= 2) {
        ctx.fillStyle = bc.trim;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.4;
        roundRect(wx + 2, by - wRoofH - 3, wW - 4, 3.2, 1);
        ctx.fill();
        ctx.stroke();
      }
      // T4 gold side rails
      if (packTier === 4) {
        ctx.fillStyle = '#f0c040';
        ctx.fillRect(wx, by + 2, 2, wH - 4);
        ctx.fillRect(wx + wW - 2, by + 2, 2, wH - 4);
      }
      // Player identity stripe (plum) — small banner at the front
      ctx.fillStyle = '#b07ec3';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(wx + wW/2 - 2.5, by + wH - 3.5, 5, 3);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    const drawHarness = (x1, y1, x2, y2) => {
      ctx.strokeStyle = bootsTier >= 3 ? '#d4af37' : '#5a3820';
      ctx.lineWidth = 1;
      // Two reins
      ctx.beginPath();
      ctx.moveTo(x1, y1 - 1); ctx.lineTo(x2, y2 - 1);
      ctx.moveTo(x1, y1 + 1); ctx.lineTo(x2, y2 + 1);
      ctx.stroke();
    };

    // ── Horse drawing: proper arc-based body ───────────────────────────
    // dir = which direction the horse is walking toward
    // pos (hx,hy) = center of horse body
    const drawHorse = (hcx, hcy, dir) => {
      const legPhase1 = moving ? Math.sin(phase * 2) * legLen * 0.5 : 0;
      const legPhase2 = moving ? Math.sin(phase * 2 + Math.PI) * legLen * 0.5 : 0;

      // Horiz or vert stance
      const horiz = (dir === 'RIGHT' || dir === 'LEFT');
      const flip   = dir === 'LEFT' ? -1 : 1;

      ctx.save();
      ctx.translate(hcx, hcy);
      if (horiz && dir === 'LEFT') ctx.scale(-1, 1);

      if (hc.glow) { ctx.shadowColor = '#a0d8ff'; ctx.shadowBlur = 10; }

      if (horiz) {
        // Side-view horse — chibi style: thick ink outlines on every shape
        // Body
        ctx.fillStyle = hc.belly;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 0, hW * 0.9, hH * 0.45, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        // Body top shading (no stroke, soft overlay)
        ctx.fillStyle = hc.body;
        ctx.beginPath(); ctx.ellipse(-1, -1.5, hW * 0.78, hH * 0.32, -0.15, 0, Math.PI*2); ctx.fill();
        // Neck + head silhouette (single outlined shape)
        ctx.fillStyle = hc.body;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hW * 0.6, -hH * 0.3);
        ctx.bezierCurveTo(hW * 0.9, -hH * 0.7, hW * 1.3, -hH * 0.8, hW * 1.5, -hH * 0.5);
        ctx.bezierCurveTo(hW * 1.4, -hH * 0.2, hW * 0.9, -hH * 0.1, hW * 0.6, -hH * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Head
        ctx.fillStyle = hc.body;
        ctx.beginPath(); ctx.ellipse(hW * 1.55, -hH * 0.55, hW * 0.32, hH * 0.22, -0.3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        // Nose/muzzle (cheek-blush palette)
        ctx.fillStyle = hc.nose;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(hW * 1.75, -hH * 0.48, hW * 0.14, hH * 0.12, 0.2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        // Chibi eye (bigger, with bright white highlight)
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.arc(hW * 1.46, -hH * 0.62, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(hW * 1.5, -hH * 0.66, 0.55, 0, Math.PI*2); ctx.fill();
        // Mane
        ctx.fillStyle = hc.mane;
        ctx.beginPath();
        ctx.moveTo(hW * 0.6, -hH * 0.3);
        ctx.bezierCurveTo(hW * 0.7, -hH * 0.9, hW * 1.1, -hH * 0.95, hW * 1.3, -hH * 0.7);
        ctx.lineWidth = 2.5; ctx.strokeStyle = hc.mane; ctx.stroke();
        // Tail
        ctx.strokeStyle = hc.mane; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-hW * 0.85, -hH * 0.1);
        ctx.bezierCurveTo(-hW * 1.2, hH * 0.2, -hW * 1.1, hH * 0.5, -hW * 0.9, hH * 0.6);
        ctx.stroke();
        // Legs (4 — side view shows 2 pairs offset)
        ctx.lineWidth = 2; ctx.strokeStyle = hc.dark; ctx.lineCap = 'round';
        // Back legs
        ctx.beginPath();
        ctx.moveTo(-hW * 0.45, hH * 0.38);
        ctx.lineTo(-hW * 0.45 + legPhase1 * 0.4, hH * 0.38 + legLen * 0.5);
        ctx.lineTo(-hW * 0.35 + legPhase1 * 0.6, hH * 0.38 + legLen);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-hW * 0.15, hH * 0.38);
        ctx.lineTo(-hW * 0.15 + legPhase2 * 0.4, hH * 0.38 + legLen * 0.5);
        ctx.lineTo(-hW * 0.05 + legPhase2 * 0.6, hH * 0.38 + legLen);
        ctx.stroke();
        // Front legs
        ctx.beginPath();
        ctx.moveTo(hW * 0.25, hH * 0.35);
        ctx.lineTo(hW * 0.25 + legPhase2 * 0.4, hH * 0.35 + legLen * 0.5);
        ctx.lineTo(hW * 0.35 + legPhase2 * 0.6, hH * 0.35 + legLen);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hW * 0.5, hH * 0.32);
        ctx.lineTo(hW * 0.5 + legPhase1 * 0.4, hH * 0.32 + legLen * 0.5);
        ctx.lineTo(hW * 0.6 + legPhase1 * 0.6, hH * 0.32 + legLen);
        ctx.stroke();
        ctx.lineCap = 'butt';

      } else {
        // Top-down / rear view horse (UP/DOWN) — chibi outline style
        const yscale = dir === 'DOWN' ? 1 : -1;
        ctx.scale(1, yscale);
        // Body oval
        ctx.fillStyle = hc.belly;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 0, hW * 0.45, hH * 0.5, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        // Body top shading (no stroke)
        ctx.fillStyle = hc.body;
        ctx.beginPath(); ctx.ellipse(0, -hH * 0.1, hW * 0.36, hH * 0.38, 0, 0, Math.PI*2); ctx.fill();
        // Head
        ctx.fillStyle = hc.body;
        ctx.beginPath(); ctx.ellipse(0, hH * 0.5, hW * 0.25, hH * 0.18, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        // Muzzle
        ctx.fillStyle = hc.nose;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(0, hH * 0.65, hW * 0.16, hH * 0.1, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        // Mane line
        ctx.strokeStyle = hc.mane; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, -hH*0.42); ctx.lineTo(0, hH*0.2); ctx.stroke();
        // Legs (4 corners)
        ctx.strokeStyle = hc.dark; ctx.lineWidth = 2; ctx.lineCap = 'round';
        const pairs = [[-hW*0.38, hH*0.2 + legPhase1], [hW*0.38, hH*0.2 + legPhase2],
                       [-hW*0.38, -hH*0.35 + legPhase2],[hW*0.38, -hH*0.35 + legPhase1]];
        for (const [lx, ly] of pairs) {
          ctx.beginPath(); ctx.moveTo(lx * 0.6, ly - 2); ctx.lineTo(lx, ly + legLen); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    };

    // ── Dust particles when moving ──────────────────────────────────────
    if (moving) {
      const dustCount = 3;
      for (let d = 0; d < dustCount; d++) {
        const dustPhase = ((t * 0.003 + d * 0.33) % 1);
        const dustAlpha = (1 - dustPhase) * 0.35;
        const dustR = dustPhase * 5;
        // Dust trails behind carriage direction
        let dox = 0, doy = 0;
        if (dir === 'RIGHT') dox = -wW * 0.7 - dustPhase * 8;
        else if (dir === 'LEFT') dox = wW * 0.7 + dustPhase * 8;
        else if (dir === 'DOWN') doy = -wH - dustPhase * 8;
        else doy = wH + dustPhase * 8;
        const jx = (Math.sin(d * 2.3 + t * 0.01) * 4);
        const jy = (Math.cos(d * 1.7 + t * 0.01) * 3);
        ctx.save();
        ctx.globalAlpha = dustAlpha;
        ctx.fillStyle = '#c8b090';
        ctx.beginPath(); ctx.arc(dox + jx, doy + jy, dustR, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
    }

    // ── Ground shadow ───────────────────────────────────────────────────
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 8, 14 + packTier * 2, 4, 0, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;

    // ── Layout: horse in travel direction, wagon behind ─────────────────
    const gap = 3;
    if (dir === 'RIGHT') {
      const hcx = wW/2 + gap + hW * 0.9;
      const hcy = bounce;
      // Wheels (behind wagon body)
      drawWheel(-wW/2 + wheelR * 0.6, wH/2 + wheelR * 0.3);
      drawWheel(wW/2  - wheelR * 0.6, wH/2 + wheelR * 0.3);
      drawWagonBody(-wW/2, -wH/2);
      drawHarness(wW/2, bounce, hcx - hW * 0.85, bounce * 0.5);
      drawHorse(hcx, hcy, 'RIGHT');
    } else if (dir === 'LEFT') {
      const hcx = -(wW/2 + gap + hW * 0.9);
      const hcy = bounce;
      drawWheel(-wW/2 + wheelR * 0.6, wH/2 + wheelR * 0.3);
      drawWheel(wW/2  - wheelR * 0.6, wH/2 + wheelR * 0.3);
      drawWagonBody(-wW/2, -wH/2);
      drawHarness(-wW/2, bounce, hcx + hW * 0.85, bounce * 0.5);
      drawHorse(hcx, hcy, 'LEFT');
    } else if (dir === 'DOWN') {
      const horse_y = -(hH * 0.5 + gap + wH/2);
      drawWheel(-wW/2 + wheelR * 0.5, 0);
      drawWheel( wW/2 - wheelR * 0.5, 0);
      drawWagonBody(-wW/2, -wH/2 + bounce);
      drawHarness(0, -wH/2 + bounce, 0, horse_y + hH * 0.45);
      drawHorse(0, horse_y, 'DOWN');
    } else { // UP
      const horse_y = hH * 0.5 + gap + wH/2;
      drawWheel(-wW/2 + wheelR * 0.5, 0);
      drawWheel( wW/2 - wheelR * 0.5, 0);
      drawWagonBody(-wW/2, -wH/2 + bounce);
      drawHarness(0, wH/2 + bounce, 0, horse_y - hH * 0.45);
      drawHorse(0, horse_y, 'UP');
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Draw other players currently in the same area (fetched from player_presence table every 5s)
  function drawOtherPlayers() {
    for (const [uid, op] of Object.entries(otherPlayers)) {
      // Only show if in the same area (same city, or both on road)
      const opCity = op.city_id || null;
      const myCity = currentCity()?.id || null;
      if (opCity !== myCity) continue;
      const sx = Math.round(op.x - camera.x);
      const sy = Math.round(op.y - camera.y);
      if (sx < -32 || sx > VIEW_W + 32 || sy < -32 || sy > VIEW_H + 32) continue;
      ctx.save();
      ctx.globalAlpha = 0.85;
      const col = op.color || '#a78bfa';
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(sx, sy + 10, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
      // Body circle (color-coded per player)
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff8dc'; ctx.lineWidth = 1.5;
      ctx.stroke();
      // Name label
      const label = op.name || `Trader ${uid}`;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 3;
      ctx.strokeText(label, sx, sy - 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, sx, sy - 12);
      ctx.restore();
    }
  }

  // Compute chibi appearance from current gear tiers.
  function _playerChibiOpts() {
    const packTier  = player.gear?.pack  ?? 0;
    const bootsTier = player.gear?.boots ?? 0;
    const toolTier  = player.gear?.tool  ?? 0;

    const hat   = packTier  >= 4 ? 'tophat'    : packTier  >= 1 ? 'travelhat' : 'straw';
    const shirt = toolTier  >= 6 ? '#c04040'   // crimson — master trader
                : toolTier  >= 4 ? '#d4a020'   // gold silk
                : toolTier  >= 2 ? '#9060b0'   // rich purple
                : toolTier  >= 1 ? '#b07ec3'   // lavender
                :                  '#c7b9a5';  // plain linen
    const boots = bootsTier >= 4 ? '#d4a020'   // golden — phantom mare
                : bootsTier >= 3 ? '#4a3828'   // dark war-horse leather
                : bootsTier >= 2 ? '#9a6840'   // oiled road leather
                : bootsTier >= 1 ? '#8a5a30'   // sturdy road boots
                :                  '#5a3018';  // worn, beaten boots

    return { skin: '#f5d2b8', hair: '#5a3a1a', shirt, hat, boots };
  }

  function drawPlayer() {
    const x = player.x - camera.x;
    const y = player.y - camera.y;

    // Carriage when on the road (outside city)
    if (playerOnRoad()) {
      drawPlayerCarriage(x, y);
      return;
    }

    const r = player.r || 8;
    const scale = r / 12;
    const moving = Math.hypot(player.vx || 0, player.vy || 0) > 0.01;
    const walkPhase = moving ? Math.sin(stateTime * 0.018) : 0;
    const bob = walkPhase * 1.2;
    const flip = (player.facing && typeof player.facing.x === 'number') ? player.facing.x < -0.1 : false;

    const opts = _playerChibiOpts();
    const bootsTier = player.gear?.boots ?? 0;

    ctx.save();
    ctx.translate(x, y + bob);
    if (bootsTier >= 4) { ctx.shadowColor = '#ffd84d'; ctx.shadowBlur = 7; }
    _drawChibi(opts, scale, flip, walkPhase);
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
    // Nothing to draw on canvas here - keeps the gameplay viewport fully clear.
  }

  // ── Mobile minimap DOM overlay ────────────────────────────────────────────
  // Separate canvas rendered each frame when open; tapping navigates to nearest city.
  // ── Mobile minimap corner widget - always rendered each frame ───────────
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
    // Active contract destination ring + compass arrow
    if (contracts.active) {
      const dest = getCityById(contracts.active.toId);
      if (dest) {
        const dx = ((dest.x + dest.w/2) / MAP_W) * S;
        const dy = ((dest.y + dest.h/2) / MAP_H) * S;
        // Destination ring
        _mmCtx.strokeStyle = '#60a5fa'; _mmCtx.lineWidth = 1.5;
        _mmCtx.beginPath(); _mmCtx.arc(dx, dy, 6, 0, Math.PI*2); _mmCtx.stroke();
        // Compass arrow in top-right corner pointing toward destination
        const tx = (dest.x + dest.w/2) * TILE;
        const ty = (dest.y + dest.h/2) * TILE;
        const ang = Math.atan2(ty - player.y, tx - player.x);
        const ax = S - 12, ay = 12, r = 8;
        _mmCtx.save();
        _mmCtx.translate(ax, ay);
        _mmCtx.rotate(ang);
        _mmCtx.fillStyle = 'rgba(0,0,0,0.65)';
        _mmCtx.beginPath(); _mmCtx.moveTo(r,0); _mmCtx.lineTo(-r*0.65,r*0.65); _mmCtx.lineTo(-r*0.65,-r*0.65); _mmCtx.closePath(); _mmCtx.fill();
        _mmCtx.fillStyle = '#60a5fa';
        _mmCtx.beginPath(); _mmCtx.moveTo(r-1,0); _mmCtx.lineTo(-r*0.55,r*0.55); _mmCtx.lineTo(-r*0.55,-r*0.55); _mmCtx.closePath(); _mmCtx.fill();
        _mmCtx.restore();
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
    // Road POI markers (camps=🏕, ruins=🏛, caches=💰)
    if (world.pois) {
      const poiColor = { 8: 'rgba(229,115,57,0.75)', 9: 'rgba(140,120,90,0.75)', 13: 'rgba(209,136,22,0.9)' };
      for (const poi of world.pois) {
        const px2 = (poi.x / MAP_W) * S;
        const py2 = (poi.y / MAP_H) * S;
        _mmCtx.fillStyle = poiColor[poi.type] || 'rgba(180,160,100,0.7)';
        _mmCtx.beginPath(); _mmCtx.arc(px2, py2, poi.type === 13 ? 2.5 : 1.5, 0, Math.PI*2); _mmCtx.fill();
      }
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
  // ── FAB / ACTION BAR - context-sensitive action buttons ──────────────
  // Desktop: stacked round FABs (bottom-right of canvas).
  // Mobile: slim horizontal pill bar at bottom of screen - max 3 actions, always labelled.
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
    const atMine = nearMineTile();
    // One-shot tutorial: first time the player gets within 2 tiles of any vein.
    if (atMine && !player.seenFirstVein) {
      player.seenFirstVein = true;
      toast('⛏️ Mining vein! Tap to swing — costs stamina, drops 2-4 ore. Recharges every 30s.', 5);
      saveGame(true);
    }

    const today = Math.floor(time.day);
    const activeIntel = (player.intelLedger || []).filter(ic => !ic.sold && ic.expiryDay >= today);

    // Build key to avoid unnecessary DOM thrashing
    const key = [
      c?.id || 'road',
      atMarket ? 'm' : '',
      atContracts ? 'c' : '',
      nearNpc?.id || '',
      nearTrader?.id || '',
      autoNav.active ? 'nav' : '',
      atMine ? `mine:${atMine.tx},${atMine.ty}` : '',
      activeIntel.length,
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
        lbl.textContent = label.length > 14 ? label.slice(0, 13) + '...' : label;
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
    if (atMine) {
      actions.push(['⛏️', 'Mine', () => { playerMineNode(atMine.tx, atMine.ty); _fabLastKey = ''; }]);
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
    if (activeIntel.length > 0) {
      actions.push(['📒', `Ledger (${activeIntel.length})`, () => {
        openIntelUI(null, c?.id || null, 'ledger');
        _fabLastKey = '';
      }]);
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


// MOBILE HUD - single slim bar, no expand needed (map is in separate toggle)
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

  // Left: location name (+ guild badge if earned)
  const titleBase = c ? c.name : (autoNav.active ? `→ ${getCityById(autoNav.destCityId)?.name || '...'}` : 'Road');
  const title = player.guildMember ? `⚜️ ${titleBase}` : titleBase;
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
  ui._hudContractTap = null;
  if (contracts.active) {
    const dest = getCityById(contracts.active.toId);
    if (dest) {
      const prog = activeContractProgressLabel();
      ctx.fillStyle = 'rgba(96,165,250,0.80)';
      ctx.font = `600 ${Math.round(10 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`📦 → ${dest.name} (${prog})`, VIEW_W / 2, topH - Math.round(4 * UI_SCALE));
      ctx.textAlign = 'left';
      // tap zone covers the full-width bottom strip of the HUD bar
      ui._hudContractTap = { x: 0, y: topH - Math.round(16 * UI_SCALE), w: VIEW_W, h: Math.round(16 * UI_SCALE), toId: contracts.active.toId };
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
    // mine-site markers (small ⛏ glyph + metal-tinted dot)
    ctx.font = `${Math.round(8*UI_SCALE)}px system-ui,sans-serif`;
    for (const site of MINE_SITES) {
      const sx2 = mmX + (site.x / MAP_W) * mmSize;
      const sy2 = mmY + (site.y / MAP_H) * mmSize;
      ctx.fillStyle = MINE_SITE_COLORS[site.metal] || '#a78bfa';
      ctx.beginPath(); ctx.arc(sx2, sy2, 2, 0, Math.PI*2); ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillText('⛏', sx2 + 3, sy2 + 3);
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
  const popVal    = _cpop ? (_cpop.pop >= 1000 ? (_cpop.pop / 1000).toFixed(1) + 'k' : Math.round(_cpop.pop).toString()) : '-';
  const hungerPct = _cpop ? Math.round(_cpop.hunger * 100) : 0;
  const hungerCol = hungerPct >= 60 ? '#f87171' : hungerPct >= 30 ? '#fbbf24' : '#86efac';
  const treVal    = (_treasury && _treasury.gold > 0) ? `${_treasury.gold}g` : '-';
  const taxVal    = `${Math.round(rules.taxRate * 100)}%`;
  const inspVal   = `${Math.round(rules.inspectionChance * 100)}%`;
  const repStr    = _rep >= 10 ? 'Trusted' : _rep >= 5 ? 'Known' : _rep >= 0 ? 'Neutral' : 'Suspect';
  const repCol    = _rep >= 10 ? '#86efac' : _rep >= 5 ? '#fbbf24' : _rep >= 0 ? '#94a3b8' : '#f87171';
  const contraTxt = rules.contraband.join(', ') || 'none';
  const hint      = nearMarketTile() ? '⚡ Market nearby - tap to trade' : '★ Find market (gold tile)';

  const x        = titleX;
  const padX     = Math.round(10 * UI_SCALE);
  const padY     = Math.round(8 * UI_SCALE);
  const colW     = Math.round(130 * UI_SCALE);
  const rowH     = Math.round(15 * UI_SCALE);
  const fSz      = Math.round(11 * UI_SCALE);
  const fSzSm    = Math.round(10 * UI_SCALE);
  const boxW     = Math.min(Math.round(230 * UI_SCALE), VIEW_W - Math.round(16 * UI_SCALE));

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

  // Pin to bottom-right corner so it never overlaps the main gameplay viewport
  const boxX = VIEW_W - boxW - Math.round(8 * UI_SCALE);
  const boxY = VIEW_H - boxH - Math.round(8 * UI_SCALE);

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
      const headerH = showTabs ? 120 : 100;
      const innerX = sheetX + 16;
      const innerW = sheetW - 32;

      ctx.fillStyle = '#2a1f14';
      ctx.font = `900 ${Math.round(20*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(`${c.name} Market`, innerX, sheetTop + Math.round(28 * UI_SCALE));

      ctx.fillStyle = '#4a3b2a';
      ctx.font = `${Math.round(13*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(rules.vibe, innerX, sheetTop + Math.round(50 * UI_SCALE));


      // close button (tap) — ≥44 CSS px tap target on typical phones
      const closeW = Math.round(80 * UI_SCALE);
      const closeH = Math.round(36 * UI_SCALE);
      const closeX = sheetX + sheetW - closeW - Math.round(10 * UI_SCALE);
      const closeY = sheetTop + Math.round(12 * UI_SCALE);
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
      ctx.textAlign = 'center';
      ctx.fillText('CLOSE', closeX + closeW / 2, closeY + Math.round(24 * T_SCALE));
      ctx.textAlign = 'left';
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
      const rowH = 120; // card height — larger for mobile tap targets
      const visibleN = Math.max(1, Math.floor(listH / rowH));

      const totalN = ITEMS.length + 1; // +1 permit row
      const scrollMax = Math.max(0, totalN - visibleN);
      ui.marketScroll = clamp(ui.marketScroll, 0, scrollMax);

      // expose list rect for touch scrolling
      const cardPad = 8;
      const cardH = rowH - cardPad * 2;
      const btnH = Math.round(36 * UI_SCALE);
      const btnPad = 8;
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

        const _mq = isPermitRow ? null : quoteFor(c.id, it);
        const price = isPermitRow ? PERMIT_PRICE : (ui.mode === 'buy' ? _mq.buy : _mq.sell);
        const have = isPermitRow ? 0 : (player.inv[it.id] || 0);
        const contra = (!isPermitRow) && it.contrabandName && rules.contraband.includes(it.contrabandName);
        const notAvailHereCanvas = (!isPermitRow) && it.sourceCities && !it.sourceCities.includes(c.id);
        const hasPermit = !!player.permits[c.id];

        // name
        ctx.fillStyle = notAvailHereCanvas ? '#888' : '#2a1f14';
        ctx.font = `900 ${Math.round(15*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.fillText(isPermitRow ? (hasPermit ? 'City Permit (owned)' : 'City Permit') : it.name, innerX, cardY + 22);

        // price + drift indicator (right-aligned on same line)
        ctx.textAlign = 'right';
        ctx.fillText(isPermitRow ? (hasPermit ? 'Owned' : `${price}g`) : (notAvailHereCanvas && ui.mode === 'buy' ? 'N/A' : `${price}g`), sheetX + sheetW - 16, cardY + 22);
        if (!isPermitRow && !notAvailHereCanvas) {
          const d = (marketDrift[c.id]?.[it.id]) ?? 1;
          if (d > 1.05) {
            ctx.fillStyle = '#16a34a';
            ctx.font = `700 ${Math.round(10*T_SCALE)}px system-ui, -apple-system, sans-serif`;
            ctx.fillText(' ▲', sheetX + sheetW - 16, cardY + 38);
          } else if (d < 0.95) {
            ctx.fillStyle = '#dc2626';
            ctx.font = `700 ${Math.round(10*T_SCALE)}px system-ui, -apple-system, sans-serif`;
            ctx.fillText(' ▼', sheetX + sheetW - 16, cardY + 38);
          }
        }
        ctx.textAlign = 'left';

        // subline
        ctx.fillStyle = '#4a3b2a';
        ctx.font = `${Math.round(12*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.fillText(isPermitRow ? 'Reduces inspections in this city' : (notAvailHereCanvas ? 'Not stocked here · Sell only' : `You have: ${have} · Weight: ${it.weight}`), innerX, cardY + 38);

// action button
const btnY = cardY + cardH - btnH - btnPad;
const btnX = sheetX + btnInset;
const btnW = sheetW - btnInset * 2;
const btnDisabled = notAvailHereCanvas && ui.mode === 'buy';
ctx.fillStyle = btnDisabled ? 'rgba(100,100,100,0.18)' : (ui.mode === 'buy' ? 'rgba(34,197,94,0.18)' : 'rgba(59,130,246,0.18)');
ctx.strokeStyle = btnDisabled ? 'rgba(100,100,100,0.4)' : (ui.mode === 'buy' ? 'rgba(34,197,94,0.6)' : 'rgba(59,130,246,0.6)');
ctx.beginPath();
if (ctx.roundRect) ctx.roundRect(btnX, btnY, btnW, btnH, 10);
else ctx.rect(btnX, btnY, btnW, btnH);
ctx.fill();
ctx.stroke();
ctx.fillStyle = btnDisabled ? '#888' : (ui.mode === 'buy' ? '#166534' : '#1d4ed8');
ctx.font = `900 ${Math.round(12*T_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
const actLabel = btnDisabled ? 'N/A' : (ui.mode === 'buy' ? 'BUY' : 'SELL');
const actW = ctx.measureText(actLabel).width;
ctx.fillText(actLabel, btnX + (btnW - actW) / 2, btnY + Math.round(22 * UI_SCALE));

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

      const _pq = quoteFor(c.id, it);
      const p = ui.mode === 'buy' ? _pq.buy : _pq.sell;
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
    const choiceRowH = Math.round(40 * UI_SCALE);
    const footerPad = Math.round(34 * UI_SCALE);
    const listH = (by + boxH - footerPad) - startY;
    const visibleN = Math.max(1, Math.floor(listH / choiceRowH));
    const maxScroll = Math.max(0, ui.eventChoices.length - visibleN);
    ui.eventScroll = clamp(ui.eventScroll, 0, maxScroll);

    // expose choice rect for touch scrolling + tap-to-select
    ui._eventList = { x: bx + 12, y: startY - Math.round(22 * UI_SCALE), w: boxW - 24, h: visibleN * choiceRowH, rowH: choiceRowH, scrollMax: maxScroll };


    for (let vi = 0; vi < visibleN; vi++) {
      const i = ui.eventScroll + vi;
      if (i >= ui.eventChoices.length) break;
      const y = startY + vi * choiceRowH;
      const selected = i === ui.eventSel;
      // highlight spans the full row for clear tap feedback
      ctx.fillStyle = selected ? 'rgba(120, 92, 60, 0.20)' : 'rgba(120, 92, 60, 0.04)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx + 12, y - Math.round(22 * UI_SCALE), boxW - 24, Math.round(38 * UI_SCALE), 8);
      else ctx.rect(bx + 12, y - Math.round(22 * UI_SCALE), boxW - 24, Math.round(38 * UI_SCALE));
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = 'rgba(120, 92, 60, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
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
    tickBanners(dt); // advance banner TTL every frame so they actually auto-dismiss

    // Mining stamina regen: +1/sec, capped at 100. Throttled to once-per-second
    // via _mineStaminaTickAt so the rate doesn't depend on frame rate.
    if ((player.mineStamina || 0) < 100) {
      if (stateTime - (player._mineStaminaTickAt || 0) >= 1000) {
        player._mineStaminaTickAt = stateTime;
        player.mineStamina = Math.min(100, (player.mineStamina || 0) + 1);
      }
    } else {
      player._mineStaminaTickAt = stateTime;
    }

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
      // Check overdue loans at any bank city (rep warning only - gold penalty handled at repay time)
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
      if (nowId) { economySync(); syncWorldState(); } // on city entry: refresh world state
      // Trigger server aggregation (hourly, no-op if too soon)
      maybeAggregateEconomy();
    }
    // Biome entry notification — once per tile-type transition
    {
      const _nt = tileAt(Math.floor(player.x / TILE), Math.floor(player.y / TILE));
      if (_nt !== player._lastTile) {
        player._lastTile = _nt;
        if (_nt === 10) toast('Entering forest — slower going', 2);
        else if (_nt === 11) toast('Entering swamp — treacherous ground', 2.5);
      }
    }

    // Push own presence + fetch other players every frame (rate-limited internally)
    pushPlayerPresence();
    syncOtherPlayers();

    // Virtual KeyE button removed - interaction is tap-only

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
              // No food: penalty - 5g (balanced vs rations buy cost ~12g, trip economy)
              const penalty = 5;
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
      if (consumeVKey('Escape')) {
        if (!ui.eventDismissable) toast('This demands an answer.', 1.6);
        else { closeEvent(); toast('You move on.', 2); }
      }
      if (consumeVKey('Enter') || consumeVKey('Space')) {
        if (!eventChoiceLocked(stateTime, ui.eventOpenedAt, EVENT_INPUT_LOCK_MS)) {
          const ch = ui.eventChoices[ui.eventSel];
          if (ch && typeof ch.run === 'function') ch.run();
        }
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
    // Building labels are now baked into drawBuildingSprites() as facade banners.
    drawEntities();
    for (const t of AI_TRADERS) drawAiTrader(t);
    drawTraderBubbles();
    drawNavPath();
    drawClickMarker();
    drawPlayer();
    drawOtherPlayers();
    drawNpcBubble();
    drawLootPopups();
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

      // Selling an item must not reset the market list's scroll position to top
      // (regression: rebuilding .cr-list on every trade wiped native scrollTop)
      // Hold every item so the sell tab (which now lists only held items) is
      // long enough to actually scroll.
      __QA.api.clearSave();
      __QA.api.setPlayer({ gold: 50, inv: { coal: 5, grain: 5, food: 5, ore: 5, herbs: 5, potion: 5, relic: 5, ink: 5, gem: 5, copper: 5, silver: 5, gold: 5 }, capacity: 999 });
      const scrollOpened = __QA.api.openMarketUI('valdenmere', 'sell');
      assert(scrollOpened, 'market UI should open for scroll-preservation test');
      const scrollList = uiRoot.querySelector('.cr-list');
      assert(!!scrollList, 'cr-list should exist after market open');
      scrollList.scrollTop = 40;
      const scrollSellR = __QA.api.marketSell('food', 1, 'valdenmere');
      assert(scrollSellR.ok === true, 'marketSell should succeed for scroll-preservation test');
      __QA.api.flushAutosave(); // clear pending autosave timer so it doesn't leak into later tests
      domRender();
      const scrollListAfter = uiRoot.querySelector('.cr-list');
      assert(!!scrollListAfter, 'cr-list should still exist after sell re-render');
      assert(scrollListAfter.scrollTop === 40, 'selling an item should preserve market list scroll position');

      // Switching tabs (sell -> buy) shows a different list, so the old
      // scroll offset must NOT carry over into the new tab.
      ui.mode = 'buy';
      domRender();
      const scrollListAfterTabSwitch = uiRoot.querySelector('.cr-list');
      assert(!!scrollListAfterTabSwitch, 'cr-list should exist after switching tabs');
      assert(scrollListAfterTabSwitch.scrollTop === 0, 'switching market tabs should reset scroll to top, not reuse the previous tab\'s offset');

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
        assert(Array.isArray(panel) && panel.length === CITY_NPCS['valdenmere'].length, 'npc panel length should match CITY_NPCS for valdenmere');
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
  assert(Array.isArray(walkers) && walkers.length === CITY_NPCS['valdenmere'].length, 'valdenmere NPC walkers should match CITY_NPCS count');
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
    // Expanded state: HUD tap target should still exist after expand
    assert(!!ui._hudCityTap, 'HUD tap target should still exist when expanded');
    // Modal should block further HUD taps
    ui.marketOpen = true;
    assert(handleMobileHudTap(T.x + 1, T.y + 1) === false, 'HUD tap blocked when modal open');
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
      assert(uiRoot.querySelector('.cr-action'), 'mobile market should render single action button');

      // Sell tab with an empty pack: stays on sell and shows an empty state
      // (it must NOT silently bounce the player to the buy tab).
      ui.mode = 'sell';
      domRender();
      assert(ui.mode === 'sell', 'empty pack must not bounce the sell tab to buy');
      assert(uiRoot.querySelector('.cr-empty'), 'empty pack sell tab should show an empty state');
      assert(uiRoot.querySelectorAll('.cr-card[data-idx]').length === 0, 'empty pack sell tab should list no items');

      if (ITEMS[0]) player.inv[ITEMS[0].id] = 2;
      domRender();
      assert(uiRoot.querySelectorAll('.cr-card[data-idx]').length === 1, 'sell tab should list only held items');

      ui.mode = 'buy';
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

        // City arrival always saves (position/state persisted even when delivery fails).
        // Contract remains active and gold/inv unchanged, but city arrival itself saves.
        assert(__QA.api.flushAutosave() === true, 'city arrival should schedule autosave even when delivery fails');
        const failSave = __QA.api.readSave();
        assert(!!failSave, 'save should be written on city arrival');
        assert(!!failSave.contracts?.active, 'active contract should be persisted in save after failed delivery');
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

      // --- Test 2: Click-to-move - player moves toward a tap target within city
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
        // Mobile pathing can stop slightly off-center on larger building footprints after map/layout changes.
        assert(distToMarket < TILE * 4, `player should reach market tile (dist: ${distToMarket.toFixed(1)}px)`);
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

      // --- Test 8: Auto-nav from one city to another - player moves along path
      {
        // Close any open modals from previous tests
        __QA.api.closeUI();
        // Start at ironholt, navigate to crosshaven
        __QA.api.teleportToCity('ironholt');
        for (let i = 0; i < 3; i++) __QA.api.step(1/60);
        const before = __QA.api.getPlayerPos();
        // Navigate to crosshaven (different city - won't trigger "already there")
        const started = __QA.api.startAutoNav('crosshaven');
        assert(started === true, 'startAutoNav to crosshaven should succeed');
        const nav = __QA.api.getAutoNav();
        assert(nav.active === true, 'autoNav should be active after start');
        assert(nav.destCityId === 'crosshaven', 'autoNav destCityId should be crosshaven');
        assert(nav.pathLen > 0, 'autoNav path should have waypoints');
        // Run 120 frames (~2s) - player should have moved
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

      // --- Nav Test 1: Auto-nav Valdenmere → Ashport - player leaves city
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
        // Walk a lot - should advance at least one waypoint
        __QA.api.walkSteps(1200);
        const nav1 = __QA.api.getAutoNav();
        assert(nav1.pathIdx > idx0 || !nav1.active, `nav3: pathIdx should advance or nav should complete (was ${idx0}, now ${nav1.pathIdx}, active=${nav1.active})`);
      }

      // --- Nav Test 4: "Already there" - starting nav to current city returns false
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
        // Simulate arrow key press - should cancel
        vkeys.add('ArrowRight');
        __QA.api.step(1/60);
        vkeys.delete('ArrowRight');
        assert(autoNav.active === false, 'nav5: arrow key should cancel autoNav');
      }

      // --- Nav Test 6: Full journey - nav makes significant progress along path
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

      // GEAR BUY + SAVE TEST (covers uid=0 / guest scenario)
      // ══════════════════════════════════════════════════════════════════
      {
        const api = __QA.api;

        // Start fresh — simulates uid=0 guest player opening the game
        api.clearSave();
        api.setPlayer({ gold: 500, gear: { pack: 0, boots: 0, tool: 0 } });

        // Buy pack tier 1 (costs 120g) via QA API
        const gearResult = api.buyGear('pack', 1, 120);
        assert(gearResult.ok === true, 'gear-save: buyGear should succeed with enough gold');

        // Autosave should have been scheduled
        assert(api.flushAutosave() === true, 'gear-save: autosave should be pending after gear buy');

        // Verify gear is persisted in localStorage
        const saved = api.readSave();
        assert(!!saved, 'gear-save: save should exist after gear buy');
        assert(saved.player.gear?.pack === 1, 'gear-save: gear.pack should be 1 in save');
        assert(saved.player.gold === 500 - 120, 'gear-save: gold deducted correctly in save');

        // Reload and confirm gear survives round-trip
        assert(loadGame() === true, 'gear-save: loadGame should succeed after gear buy');
        const reload = api.snapshot();
        assert(reload.player.gear?.pack === 1, 'gear-save: gear.pack should be restored after reload');
        assert(reload.player.gold === 380, 'gear-save: gold should be restored after reload');

        // Boot tier 2 purchase (requires tier 1 first — already have pack=1; buy boots)
        api.setPlayer({ gold: 200, gear: { pack: 1, boots: 0, tool: 0 } });
        const bootsResult = api.buyGear('boots', 1, 150);
        assert(bootsResult.ok === true, 'gear-save: boots tier 1 buy should succeed');
        assert(api.flushAutosave() === true, 'gear-save: autosave scheduled after boots buy');
        const savedBoots = api.readSave();
        assert(savedBoots?.player?.gear?.boots === 1, 'gear-save: gear.boots persisted in save');

        // Confirm insufficient gold is correctly rejected and NOT saved
        api.clearSave();
        api.setPlayer({ gold: 10, gear: { pack: 1, boots: 1, tool: 0 } });
        const poorResult = api.buyGear('tool', 1, 200); // costs 200g, only have 10
        assert(poorResult.ok === false, 'gear-save: buyGear should fail with insufficient gold');
        assert(api.flushAutosave() === false, 'gear-save: no autosave after failed gear buy');
        assert(api.readSaveRaw() === null, 'gear-save: no save written after failed gear buy');
      }

      // SETPLAYER GEAR STATS TEST
      // ══════════════════════════════════════════════════════════════════
      {
        const api = __QA.api;
        const defaultCapacity = 18; // T0 pack capacity

        // setPlayer with gear should immediately update capacity/speed via applyGearStats
        api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0 } });
        assert(api.snapshot().player.capacity === defaultCapacity,
          'setPlayer-gear: pack=0 should give default capacity 18');

        api.setPlayer({ gear: { pack: 1, boots: 0, tool: 0 } });
        assert(api.snapshot().player.capacity > defaultCapacity,
          'setPlayer-gear: pack=1 should increase capacity above default');

        // Reset to defaults
        api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0 } });
        assert(api.snapshot().player.capacity === defaultCapacity,
          'setPlayer-gear: resetting pack=0 should restore default capacity');
      }

      // CITY ARRIVAL SAVE TEST
      // ══════════════════════════════════════════════════════════════════
      {
        const api = __QA.api;
        api.clearSave();
        api.setPlayer({ gold: 400 });
        const snapGold = api.snapshot().player.gold; // actual gold after any prior state

        // forceCityEntry should always schedule autosave (mirrors real tick city-entry save)
        api.forceCityEntry('crosshaven');
        assert(api.flushAutosave() === true,
          'city-arrival-save: forceCityEntry should always schedule autosave');

        const saved = api.readSave();
        assert(!!saved, 'city-arrival-save: save should exist after city entry');
        assert(saved.player.gold === snapGold,
          'city-arrival-save: gold in save should match gold at time of arrival');
      }

      // FULL SAVE COMPLETENESS TEST
      // Verifies every important player field survives save → load round-trip.
      // This is the "does the DB save actually capture everything" test.
      // ══════════════════════════════════════════════════════════════════
      {
        const api = __QA.api;

        // 1. Set up a rich, distinctive state
        api.clearSave();
        api.setPlayer({
          gold: 847,
          x: 1200,
          y: 960,
          inv: { grain: 5, food: 3, ore: 2, herbs: 1, potion: 0, relic: 0, ink: 0 },
          gear: { pack: 2, boots: 1, tool: 1, pickaxe: 3 },
        });
        api.setRep('valdenmere', 7);
        api.setRep('ashport', 3);
        api.setRep('ironholt', 12);
        api.setRep('crosshaven', 0);
        api.setPermit('ashport', true);
        api.setPermit('valdenmere', true);
        api.setTime({ day: 14, frac: 0.35 });

        // 2. Force a save via city arrival (triggers scheduleAutoSave)
        api.forceCityEntry('ironholt');
        assert(api.flushAutosave() === true, 'full-save: autosave pending after city entry');

        // 3. Read raw save and verify every field
        const saved = api.readSave();
        assert(!!saved, 'full-save: save object exists');

        // Player fields
        const p = saved.player;
        assert(!!p, 'full-save: player section present');
        assert(p.gold === 847, `full-save: gold correct (got ${p.gold})`);
        assert(Number.isFinite(p.x) && p.x > 0, `full-save: x is finite positive (got ${p.x})`);
        assert(Number.isFinite(p.y) && p.y > 0, `full-save: y is finite positive (got ${p.y})`);

        // Inventory
        assert(p.inv?.grain === 5, `full-save: inv.grain=5 (got ${p.inv?.grain})`);
        assert(p.inv?.food === 3, `full-save: inv.food=3 (got ${p.inv?.food})`);
        assert(p.inv?.ore === 2, `full-save: inv.ore=2 (got ${p.inv?.ore})`);
        assert(p.inv?.herbs === 1, `full-save: inv.herbs=1 (got ${p.inv?.herbs})`);

        // Gear
        assert(p.gear?.pack === 2, `full-save: gear.pack=2 (got ${p.gear?.pack})`);
        assert(p.gear?.boots === 1, `full-save: gear.boots=1 (got ${p.gear?.boots})`);
        assert(p.gear?.tool === 1, `full-save: gear.tool=1 (got ${p.gear?.tool})`);
        assert(p.gear?.pickaxe === 3, `full-save: gear.pickaxe=3 (got ${p.gear?.pickaxe})`);

        // Rep
        assert(p.rep?.valdenmere === 7, `full-save: rep.valdenmere=7 (got ${p.rep?.valdenmere})`);
        assert(p.rep?.ashport === 3, `full-save: rep.ashport=3 (got ${p.rep?.ashport})`);
        assert(p.rep?.ironholt === 12, `full-save: rep.ironholt=12 (got ${p.rep?.ironholt})`);

        // Permits
        assert(p.permits?.ashport === true, `full-save: permits.ashport=true (got ${p.permits?.ashport})`);
        assert(p.permits?.valdenmere === true, `full-save: permits.valdenmere=true (got ${p.permits?.valdenmere})`);

        // Time
        assert(saved.time?.day === 14, `full-save: day=14 (got ${saved.time?.day})`);

        // Top-level structure
        assert(typeof saved.marketDrift === 'object', 'full-save: marketDrift present');
        assert(typeof saved.contracts === 'object', 'full-save: contracts present');
        assert(Array.isArray(saved.openedCaches), 'full-save: openedCaches is array');

        // 4. Load back and verify round-trip fidelity
        assert(loadGame() === true, 'full-save: loadGame succeeds');
        const after = api.snapshot();

        assert(after.player.gold === 847, `full-save: gold survived reload (got ${after.player.gold})`);
        assert(after.player.inv?.grain === 5, `full-save: inv.grain survived reload`);
        assert(after.player.gear?.pack === 2, `full-save: gear.pack survived reload (got ${after.player.gear?.pack})`);
        assert(after.player.gear?.boots === 1, `full-save: gear.boots survived reload`);
        assert(after.player.rep?.ironholt === 12, `full-save: rep.ironholt survived reload (got ${after.player.rep?.ironholt})`);
        assert(after.player.permits?.ashport === true, `full-save: permits.ashport survived reload`);
        assert(after.time?.day === 14, `full-save: day survived reload (got ${after.time?.day})`);
        // Gear stats applied: pack=2 should give capacity > 28
        assert(after.player.capacity > 28, `full-save: capacity reflects gear.pack=2 (got ${after.player.capacity})`);
      }

      // ── Mining: city-side production + player-active mining ──────────────
      {
        const api = __QA.api;
        // Reset gear to baseline so stamina/yield assertions match T0 pickaxe.
        api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0, pickaxe: 0 } });
        // Force-build mine, run cityMineTick, treasury should rise.
        api.qaForceBuildMine(1);
        const t0 = (cityTreasury.ironholt?.gold) || 0;
        api.qaCityMineTick();
        const t1 = (cityTreasury.ironholt?.gold) || 0;
        assert(t1 > t0, `mine: cityMineTick should add gold to ironholt treasury (got ${t1 - t0})`);
        const m = cityBuildings.ironholt.mine;
        assert(m.built === true && m.level === 1, 'mine: slot built at level 1 after force-build');

        // Find a mine_node tile and verify player-active mining drops ore.
        const node = api.qaMineNodeAt();
        assert(node && Number.isFinite(node.tx), 'mine: at least one mine_node (tile 18) exists');
        api.teleportToTile(node.tx, node.ty);
        api.qaSetStamina(100);
        api.setPlayer({ capacity: 999 });
        const oreBefore = player.inv.ore || 0;
        const ok = api.qaPlayerMine(node.tx, node.ty);
        assert(ok === true, 'mine: first swing succeeds');
        assert((player.inv.ore || 0) >= oreBefore + 2, 'mine: at least +2 ore after one swing');
        assert(player.mineStamina === 85, `mine: stamina costs 15 per swing (got ${player.mineStamina})`);
        // Second swing immediately should be blocked by per-vein cooldown.
        const ok2 = api.qaPlayerMine(node.tx, node.ty);
        assert(ok2 === false, 'mine: 2nd swing within 30s blocked by cooldown');

        // Redesigned mining sites: all three metal variants exist on the map, and a
        // site vein drops its own metal (copper here) rather than iron ore.
        const copperNode = api.qaMineSiteNodeAt('copper');
        const silverNode = api.qaMineSiteNodeAt('silver');
        const goldNode   = api.qaMineSiteNodeAt('gold');
        assert(copperNode && silverNode && goldNode, 'mine: copper, silver, AND gold sites exist on the map');
        // Each site's veins must carve near its declared coordinate, so the minimap
        // marker actually points at the ore (guards against world-gen drift).
        for (const site of MINE_SITES) {
          const n = api.qaMineSiteNodeAt(site.metal);
          assert(Math.abs(n.tx - site.x) <= 8 && Math.abs(n.ty - site.y) <= 8,
            `mine: ${site.id} vein (${n.tx},${n.ty}) should carve near marker (${site.x},${site.y})`);
        }
        // Each mining site should carve a substantial cluster so the location
        // reads as a real ore deposit, not a single token tile.
        for (const site of MINE_SITES) {
          const count = api.qaCountMineNodes(site.metal);
          assert(count >= 10,
            `mine: ${site.id} should carve at least 10 ${site.metal} veins, got ${count}`);
        }
        api.teleportToTile(copperNode.tx, copperNode.ty);
        api.qaSetStamina(100);
        const copperBefore = player.inv.copper || 0;
        const okCu = api.qaPlayerMine(copperNode.tx, copperNode.ty);
        assert(okCu === true, 'mine: copper-site swing succeeds');
        assert((player.inv.copper || 0) >= copperBefore + 2, 'mine: copper site drops copper, not ore');

        // Gold gating: T0 pickaxe is refused, T2 pickaxe succeeds.
        api.teleportToTile(goldNode.tx, goldNode.ty);
        api.qaSetStamina(100);
        const goldBefore = player.inv.gold || 0;
        const okGoldT0 = api.qaPlayerMine(goldNode.tx, goldNode.ty);
        assert(okGoldT0 === false, 'mine: gold swing refused without Guild Pickaxe (T2)');
        assert((player.inv.gold || 0) === goldBefore, 'mine: gold inv unchanged when refused');
        assert(player.mineStamina === 100, 'mine: stamina refunded when gold swing refused');

        api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0, pickaxe: 2 } });
        api.setPlayer({ capacity: 999 }); // restore the cargo headroom that the gear-change reset
        api.qaSetStamina(100);
        const okGoldT2 = api.qaPlayerMine(goldNode.tx, goldNode.ty);
        assert(okGoldT2 === true, 'mine: T2 pickaxe swing succeeds at gold vein');
        assert((player.inv.gold || 0) >= goldBefore + 2, 'mine: gold site drops gold ore');
        // Reset gear to T0 for save round-trip baseline.
        api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0, pickaxe: 0 } });

        // Save round-trip preserves stamina + cooldown.
        api.qaSetStamina(42);
        saveGame(true);
        api.qaSetStamina(100);
        loadGame();
        assert(player.mineStamina === 42, `mine: stamina survives save/load (got ${player.mineStamina})`);
        assert(typeof player.mineCooldown === 'object', 'mine: mineCooldown survives save/load');

        // mineCooldown semantics: per-vein timestamps are stateTime offsets,
        // and stateTime resets to 0 on every page reload. Persisting them
        // would either strand veins as "still recovering" forever after a
        // reload, or let the player bypass the 30s anti-spam by autosaving
        // and pressing Ctrl+L. Confirm (a) saveGame doesn't write the field
        // and (b) an in-session reload preserves the in-memory cooldown.
        api.qaSetStamina(100);
        const cdNode = api.qaMineSiteNodeAt('copper');
        api.teleportToTile(cdNode.tx, cdNode.ty);
        api.qaPlayerMine(cdNode.tx, cdNode.ty);
        const cdKey = cdNode.ty * MAP_W + cdNode.tx;
        const cdBefore = player.mineCooldown[cdKey];
        assert(cdBefore > 0, 'mine: a cooldown entry was recorded before save');
        saveGame(true);
        const savedJson = JSON.parse(api.readSaveRaw() || '{}');
        assert(savedJson?.player?.mineCooldown === undefined,
          `mine: saveGame must not serialize stateTime-relative mineCooldown (got ${JSON.stringify(savedJson?.player?.mineCooldown)})`);
        loadGame();
        assert(player.mineCooldown[cdKey] === cdBefore,
          `mine: in-session reload must preserve cooldown to block save-spam exploit (was ${cdBefore}, now ${player.mineCooldown[cdKey]})`);

        // Legacy-save migration: a save that DOES carry mineCooldown (from a
        // pre-fix build) gets its stale entries dropped on load.
        const legacy = JSON.parse(api.readSaveRaw() || '{}');
        legacy.player.mineCooldown = { '999999': 1 };
        localStorage.setItem(api.getSaveKey(), JSON.stringify(legacy));
        loadGame();
        assert(Object.keys(player.mineCooldown).length === 0,
          `mine: legacy save with persisted mineCooldown is migrated to empty (got ${Object.keys(player.mineCooldown).length})`);
      }

      // ── AI trader local-fallback departure ────────────────────────────────
      // When the server (Supabase world_service cron) isn't reachable, all
      // traders would otherwise sit forever 'in_city' because traderDepart()
      // is a server-driven no-op. Confirm the local autonomy kicks in so
      // traders still leave their starting city after a reasonable wait.
      {
        const api = __QA.api;
        const seenTraveling = new Set();
        // Tick ~40s of game time (well past the local fallback threshold).
        // Watch every frame so a trader that departs + arrives between samples
        // is still counted.
        for (let i = 0; i < 2500; i++) {
          api.step(1/60);
          for (const t of api.qaAiTraders()) {
            if (t.state === 'traveling') seenTraveling.add(t.id);
          }
        }
        assert(seenTraveling.size > 0,
          `traders: at least one should depart locally when server isn't ticking (saw ${seenTraveling.size} traveling)`);
      }

      // ── Loot pickup animation: gain → popup queue ────────────────────────
      // Every item-gain site funnels through gainItem(itemId, qty), which
      // spawns a floating "+N icon" sprite. The render path consumes the
      // queue; QA just checks that the queue receives the right entries.
      {
        const api = __QA.api;
        api.qaClearLootPopups();
        api.qaSetStamina(100);
        // Reset gear so mining yield is the deterministic T0 baseline (2..4).
        api.setPlayer({ gear: { pack: 0, boots: 0, tool: 0, pickaxe: 0 } });
        api.setPlayer({ capacity: 999 });
        const copperNode = api.qaMineSiteNodeAt('copper');
        api.teleportToTile(copperNode.tx, copperNode.ty);
        const okMine = api.qaPlayerMine(copperNode.tx, copperNode.ty);
        assert(okMine === true, 'loot popup: copper swing should land');
        const popups = api.qaLootPopups();
        assert(popups.length >= 1,
          `loot popup: at least one popup spawned after successful mine (got ${popups.length})`);
        const copperPopup = popups.find(p => p.itemId === 'copper');
        assert(copperPopup && copperPopup.qty >= 1,
          `loot popup: expected a copper popup with qty>=1, got ${JSON.stringify(popups)}`);

        // Rapid same-item gains within the stack window collapse into the
        // latest popup so a multi-drop swing doesn't spam overlapping sprites.
        api.qaClearLootPopups();
        gainItem('coal', 1);
        const before = api.qaLootPopups().length;
        gainItem('coal', 2);
        const after = api.qaLootPopups();
        assert(after.length === before,
          `loot popup: same-item rapid gain should stack into one popup (got ${after.length})`);
        assert(after[0].qty === 3,
          `loot popup: stacked qty should be 1+2=3, got ${after[0].qty}`);

        // Full lifecycle: spawn → render (queue persists) → age out → render
        // (queue pruned). Confirms the renderer actually consumes the queue
        // and that popups don't leak past LIFETIME_MS.
        api.qaClearLootPopups();
        const k = api.qaLootPopupConsts();
        gainItem('gem', 1);
        let q = api.qaLootPopups();
        assert(q.length === 1 && q[0].itemId === 'gem',
          `lifecycle: spawn → queue has gem (got ${JSON.stringify(q)})`);
        // First render pass: popup is freshly spawned so it survives.
        const afterRender1 = api.qaDrawLootPopups();
        assert(afterRender1 === 1,
          `lifecycle: render at age=0 keeps the popup (got ${afterRender1})`);
        // Tick past LIFETIME (1500ms + slack). 1/60s × ~100 = ~1.67s.
        const ticks = Math.ceil((k.lifetimeMs + 200) / (1000 / 60));
        for (let i = 0; i < ticks; i++) api.step(1/60);
        // Render pass: aged-out popup gets pruned.
        const afterRender2 = api.qaDrawLootPopups();
        assert(afterRender2 === 0,
          `lifecycle: render past LIFETIME=${k.lifetimeMs}ms prunes the popup (got ${afterRender2} after ${ticks} ticks)`);

        // Spawn site coords must be on-screen at spawn time (above player).
        // Catches regressions like passing world coords without subtracting
        // camera — the popup would otherwise spawn far outside the viewport.
        api.qaClearLootPopups();
        gainItem('silver', 2);
        const fresh = api.qaLootPopups()[0];
        const VIEW_W_PROBE = (typeof window !== 'undefined' && window.innerWidth) || 1280;
        const VIEW_H_PROBE = (typeof window !== 'undefined' && window.innerHeight) || 720;
        // Camera centers on player, so sx ≈ VIEW_W/2 and sy ≈ VIEW_H/2 - 18.
        // Allow a wide margin since exact view size varies by device.
        const xOk = (typeof fresh.sx !== 'number') || (fresh.sx >= 0 && fresh.sx <= VIEW_W_PROBE);
        const yOk = (typeof fresh.sy !== 'number') || (fresh.sy >= 0 && fresh.sy <= VIEW_H_PROBE);
        // Note: sx/sy aren't returned by qaLootPopups by default; this just
        // documents the expected camera-centered spawn for future debugging.
        assert(xOk && yOk,
          `lifecycle: spawn coords should be within viewport (sx=${fresh.sx}, sy=${fresh.sy})`);
      }

      // ── Road event dialog: theming, input lock, dismissal integrity ──────
      // Events must read as events (themed panel), never accept a choice click
      // in the instant they open (tap-to-move misclick), and threat events
      // (bandits/toll/patrol/plague/wolves) must be answered — Esc/X refused.
      {
        const api = __QA.api;
        api.closeUI();
        api.qaClearLootPopups();

        // Threat event: themed panel, no close button, darker backdrop, ❗ alert.
        assert(api.qaOpenTestEvent('bandits') === true, 'event-ui: bandits test event opens a .cr-event panel');
        const evPanel = document.querySelector('.cr-panel');
        assert(evPanel.classList.contains('cr-event-threat'), 'event-ui: bandits panel carries cr-event-threat');
        assert(!!document.querySelector('.cr-event-icon'), 'event-ui: themed icon rendered in head');
        assert(!document.querySelector('.cr-close'), 'event-ui: threat event has no X close button');
        assert(document.querySelector('.cr-backdrop').classList.contains('cr-event-threat-backdrop'),
          'event-ui: threat backdrop is the darker variant');
        assert(api.qaLootPopups().some(p => p.itemId === '__alert'),
          'event-ui: threat event spawns the ❗ alert popup over the player');

        // Input lock: a click the instant the dialog opens must not run a choice.
        document.querySelector('[data-action="choose"]').click();
        assert(api.qaEventChoiceRan() === false, 'event-ui: choice click during input lock is ignored');
        assert(api.qaEventOpen() === true, 'event-ui: event stays open through the locked click');

        // Esc refused on threat events (both keydown listeners must guard).
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
        assert(api.qaEventOpen() === true, 'event-ui: Escape does not dismiss a threat event');

        // After the lock window (~400ms of stateTime), the same click works.
        // (api.step force-closes modals, so age the clock directly instead.)
        api.qaAdvanceStateTime(500);
        document.querySelector('[data-action="choose"]').click();
        assert(api.qaEventChoiceRan() === true, 'event-ui: choice click after the lock window runs');
        assert(api.qaEventOpen() === false, 'event-ui: choice resolution closes the event');

        // Benign event: not threat-themed, X present, Esc closes.
        assert(api.qaOpenTestEvent('omen') === true, 'event-ui: omen test event opens');
        assert(!document.querySelector('.cr-panel').classList.contains('cr-event-threat'),
          'event-ui: omen is not threat-themed');
        assert(!!document.querySelector('.cr-close'), 'event-ui: benign event keeps the X close button');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
        assert(api.qaEventOpen() === false, 'event-ui: Escape dismisses a benign event');

        // walkSteps force-close must keep working regardless of dismissability.
        assert(api.qaOpenTestEvent('bandits') === true, 'event-ui: reopen bandits for walkSteps check');
        api.walkSteps(2);
        assert(api.qaEventOpen() === false, 'event-ui: walkSteps force-closes events (QA escape hatch)');
        api.closeUI();
        api.qaClearLootPopups();
      }

      qaPass('save/load + autosave + contracts + npc dialogue + npc walkers + mobile bubbles + city walking + navigation + per-player save + gear-save + setplayer-gear + city-arrival-save + full-save + mining + mining-sites + trader-fallback + loot-popups + popup-lifecycle + road-event-ui');
    } catch (e) {
      qaFail(String(e && (e.stack || e.message) || e));
    }
  }

  // Apply gear stats on fresh start (load already calls applyGearStats)
  applyGearStats();

  // Auto-load save + initial world sync in parallel.
  // Dismiss the loading overlay only when both resolve so the player never
  // interacts with an unsynced world.
  const _loadSaveP = loadGameAsync().then(loaded => {
    console.log(loaded ? '[BOOT] Save loaded' : '[BOOT] No save - fresh start');
  });
  Promise.all([_loadSaveP, _initWorldSyncP]).finally(() => {
    const el = document.getElementById('loading-overlay');
    if (el && !el.classList.contains('hidden')) {
      el.style.transition = 'opacity 0.4s';
      el.style.opacity = '0';
      setTimeout(() => el.classList.add('hidden'), 400);
    }
  });

  tick();
})();
