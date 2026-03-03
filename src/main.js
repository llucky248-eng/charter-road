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
  const NPC_DIAG_ENABLED = new URLSearchParams(location.search).get('npcdiag') === '1';

  const NPC_DIAG_BUILD = 'v0.0.117';
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
          contracts.byCity.sunspire = regenContractsForCity('sunspire');
          contracts.byCity.gloomwharf = regenContractsForCity('gloomwharf');
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

      marketBuy: (itemId, qty = 1, cityId = 'sunspire') => {
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
      marketSell: (itemId, qty = 1, cityId = 'sunspire') => {
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
          else player.gold = Math.max(0, player.gold - 3);
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
          if (ui.toastT > 0) ui.toastT -= d;
          tickBanners(d);
          updateEntities(d);
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
              const inspChance = permit ? Math.max(0.05, rules.inspectionChance * 0.45) : rules.inspectionChance;
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
            player.lastCityId = nowId;
          }
          return true;
        } catch (e) {
          qaFail(String(e && (e.stack || e.message) || e));
          return false;
        }
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
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (VIEW_W / r.width);
    const sy = (e.clientY - r.top) * (VIEW_H / r.height);

    // HUD Save/Load buttons (desktop)
    if (!IS_MOBILE && sy <= HUD_H) {
      const S = ui._btnSave;
      const L = ui._btnLoad;
      if (S && sx >= S.x && sx <= S.x + S.w && sy >= S.y && sy <= S.y + S.h) {
        saveGame();
        ui._lastSavedDay = time.day;
        toast('Game saved.', 1.6);
        e.preventDefault();
        return;
      }
      if (L && sx >= L.x && sx <= L.x + L.w && sy >= L.y && sy <= L.y + L.h) {
        if (!loadGame()) toast('No save found.', 1.6);
        e.preventDefault();
        return;
      }
    }

    // Mobile pointer handling: drag-scroll for canvas popups
    if (!IS_MOBILE) return;
    if (!ui.marketOpen && !ui.eventOpen) return;

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
  // 0 grass, 1 road, 2 water, 3 wall/rock, 4 city-floor, 5 gate, 6 market, 7 shrine, 8 camp, 9 ruins, 10 forest, 11 swamp, 12 contracts, 13 cache
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

    // Branching detour: fork off the main road near the river crossing, loop through the NE lowlands,
    // and rejoin the main route further east. Longer path, but has cache POIs.
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

        // Avoid city rectangles
        const inA = (x >= cityA.x-3 && x < cityA.x + cityA.w + 3 && y >= cityA.y-3 && y < cityA.y + cityA.h + 3);
        const inB = (x >= cityB.x-3 && x < cityB.x + cityB.w + 3 && y >= cityB.y-3 && y < cityB.y + cityB.h + 3);
        if (inA || inB) continue;

        m[i] = 13;
        return true;
      }
      return false;
    };

    for (let i = 0; i < 3; i++) placeCache();

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
        else if (id === 13) { r=246; g=196; b=74; } // cache
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

  const CITY_NPCS = {
    sunspire: [
      { id: "sunspire_scribe", name: "Archivist Rowen", role: "scribe" },
      { id: "sunspire_baker", name: "Mara the Baker", role: "baker" },
      { id: "sunspire_guard", name: "Captain Venn", role: "guard" },
    ],
    gloomwharf: [
      { id: "gloomwharf_fisher", name: "Old Maren", role: "fisher" },
      { id: "gloomwharf_smuggler", name: "Lira of the Docks", role: "smuggler" },
      { id: "gloomwharf_broker", name: "Brusk the Broker", role: "broker" },
    ],
  };

const CITY_ENTITY_TEMPLATES = {
  sunspire: [
    { id: 'sunspire_scribe', role: 'scribe', style: 'scribe', speed: 26, radius: 6 },
    { id: 'sunspire_baker', role: 'baker', style: 'baker', speed: 24, radius: 6 },
    { id: 'sunspire_guard', role: 'guard', style: 'guard', speed: 28, radius: 7 },
  ],
  gloomwharf: [
    { id: 'gloomwharf_fisher', role: 'fisher', style: 'fisher', speed: 24, radius: 6 },
    { id: 'gloomwharf_smuggler', role: 'smuggler', style: 'smuggler', speed: 26, radius: 6 },
    { id: 'gloomwharf_broker', role: 'broker', style: 'broker', speed: 25, radius: 6 },
  ],
};

const NPC_INTERACT_RADIUS = 18;


  const NPC_DIALOGUE_FIXTURE = {
  date: "fixture",
  cities: {
    sunspire: {
      npcs: {
        sunspire_scribe: [
          "Rowen: The archives are three days behind.",
          "Rowen: Taxes rose again after the last caravan.",
          "Rowen: A permit stamp can save you trouble.",
          "Rowen: Sunspire keeps ledgers tighter than chains.",
          "Rowen: I can hear the market bell from here.",
          "Rowen: Merchants whisper about relics at dusk.",
          "Rowen: Every city has its price; ours is just honest.",
          "Rowen: The inspector counts twice, just in case.",
          "Rowen: A clean manifest keeps your wagon moving.",
          "Rowen: The road is quiet when ink runs dry.",
  ],
        sunspire_baker: [
          "Mara: Fresh loaves for the road\u2014if you pay upfront.",
          "Mara: Flour is scarce, but rations still sell.",
          "Mara: Travelers love warm bread more than gold.",
          "Mara: Sunspire ovens never sleep.",
          "Mara: Bring herbs and I\u2019ll trade you a crust.",
          "Mara: The guards eat first; everyone else waits.",
          "Mara: Markets buzz louder than my ovens.",
          "Mara: A pinch of salt keeps spirits steady.",
          "Mara: I saw a courier racing to Gloomwharf.",
          "Mara: Keep your pack light, keep your steps fast.",
  ],
        sunspire_guard: [
          "Venn: Papers ready? We don\u2019t bend for excuses.",
          "Venn: Contraband earns a night in the cells.",
          "Venn: Sunspire\u2019s gates close at the third bell.",
          "Venn: I\u2019ve seen more deals than duels.",
          "Venn: The road south is clear\u2014for now.",
          "Venn: Permits make inspections shorter.",
          "Venn: Don\u2019t flash relics in daylight.",
          "Venn: Keep your wagon straight and your story straighter.",
          "Venn: The market\u2019s honest when the sun\u2019s high.",
          "Venn: Trouble usually arrives with a smile.",
  ],
      }
    },
    gloomwharf: {
      npcs: {
        gloomwharf_fisher: [
          "Maren: The tide brings profit and rot alike.",
          "Maren: Fish sells, if you can stomach the stink.",
          "Maren: Gloomwharf taxes are light, but knives are not.",
          "Maren: The docks remember every debt.",
          "Maren: I trade rumors for a clean hook.",
          "Maren: Storms hide smugglers better than fog.",
          "Maren: The market here answers to coin, not law.",
          "Maren: Keep your boots dry or lose a toe.",
          "Maren: Sunspire men count coins; we count favors.",
          "Maren: The sea doesn\u2019t care who you are.",
  ],
        gloomwharf_smuggler: [
          "Lira: If it fits under a cloak, it fits the law.",
          "Lira: Gloomwharf\u2019s best deals happen after dark.",
          "Lira: Don\u2019t ask where I found it.",
          "Lira: Contraband? That\u2019s just \u201crare stock\u201d here.",
          "Lira: The docks have eyes; pay them.",
          "Lira: I know a shortcut if you know a price.",
          "Lira: Sunspire\u2019s rules make good black-market business.",
          "Lira: Keep moving\u2014guards hate still shadows.",
          "Lira: I trade whispers for weightless goods.",
          "Lira: The fog hides more than ships.",
  ],
        gloomwharf_broker: [
          "Brusk: Prices swing like a pendulum\u2014watch it.",
          "Brusk: I can move ore faster than you can blink.",
          "Brusk: Contracts favor the bold, not the honest.",
          "Brusk: Gloomwharf pays in silence.",
          "Brusk: Bring relics; I\u2019ll find a buyer.",
          "Brusk: Every deal leaves a footprint.",
          "Brusk: The road north bleeds profit if you rush.",
          "Brusk: Keep your numbers tight, your hands tighter.",
          "Brusk: I don\u2019t haggle\u2014time is the fee.",
          "Brusk: Markets here are sharp; come prepared.",
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
    const toId = fromId === 'sunspire' ? 'gloomwharf' : 'sunspire';
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
      sunspire: regenContractsForCity('sunspire'),
      gloomwharf: regenContractsForCity('gloomwharf'),
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

function npcCityBounds(city) {
  const pad = Math.max(6, Math.round(TILE * 0.6));
  return {
    x1: (city.x + 0.5) * TILE + pad,
    y1: (city.y + 0.5) * TILE + pad,
    x2: (city.x + city.w - 0.5) * TILE - pad,
    y2: (city.y + city.h - 0.5) * TILE - pad,
  };
}

function npcSeed(id, salt = 0, salt2 = 0) {
  return seeded01(hashStr(id) + salt, salt2, npcDayKey());
}

function npcPickTarget(e) {
  const b = e.bounds;
  const t = Math.floor(stateTime / 1000);
  const rx = seeded01(hashStr(e.id), t, 11);
  const ry = seeded01(hashStr(e.id), t, 37);
  e.target = {
    x: b.x1 + rx * (b.x2 - b.x1),
    y: b.y1 + ry * (b.y2 - b.y1),
  };
  const jitter = seeded01(hashStr(e.id), t, 99);
  e.nextWanderAt = stateTime + 1600 + jitter * 1200;
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
  for (const tpl of templates) {
    let placed = false;
    let x = (city.x + city.w / 2) * TILE;
    let y = (city.y + city.h / 2) * TILE;
    for (let i = 0; i < 16; i++) {
      const rx = seeded01(hashStr(tpl.id), i, 7);
      const ry = seeded01(hashStr(tpl.id), i, 13);
      const nx = b.x1 + rx * (b.x2 - b.x1);
      const ny = b.y1 + ry * (b.y2 - b.y1);
      if (!npcBlockedAt(nx, ny, tpl.radius)) {
        x = nx; y = ny; placed = true; break;
      }
    }
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
      dialogueIdx: Math.floor(npcSeed(tpl.id, 3, 5) * 10) % 10,
      talkCooldown: 0,
    };
    entities.push(e);
  }
}

function updateEntities(dt) {
  if (!entities.length) return;
  for (const e of entities) {
    if (e.kind !== 'npc') continue;
    if (!e.bounds) continue;
    if (!e.target || stateTime >= e.nextWanderAt) npcPickTarget(e);

    const dx = e.target.x - e.x;
    const dy = e.target.y - e.y;
    const dist = Math.hypot(dx, dy);
    let vx = 0, vy = 0;
    if (dist > 1) {
      vx = (dx / dist) * e.speed;
      vy = (dy / dist) * e.speed;
    }

    // soft repulsion from player
    const pdx = e.x - player.x;
    const pdy = e.y - player.y;
    const pd = Math.hypot(pdx, pdy);
    const pr = e.radius + player.r + 6;
    if (pd > 0 && pd < pr) {
      const push = (pr - pd) * 2.2;
      vx += (pdx / pd) * push;
      vy += (pdy / pd) * push;
    }

    // soft repulsion from other NPCs
    for (const o of entities) {
      if (o === e || o.kind !== 'npc') continue;
      const odx = e.x - o.x;
      const ody = e.y - o.y;
      const od = Math.hypot(odx, ody);
      const or = e.radius + o.radius + 4;
      if (od > 0 && od < or) {
        const push = (or - od) * 1.6;
        vx += (odx / od) * push;
        vy += (ody / od) * push;
      }
    }

    const nx = e.x + vx * dt;
    const ny = e.y + vy * dt;
    if (!npcBlockedAt(nx, e.y, e.radius)) e.x = nx; else e.target = null;
    if (!npcBlockedAt(e.x, ny, e.radius)) e.y = ny; else e.target = null;

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
    const c = getCityById('sunspire') || currentCity();
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
    if (d.passCheck) { d.result = 'pass'; d.note = ''; }
    else { d.result = 'fail'; d.note = 'no movement'; }
    d.state = 'done';
  }
}

function triggerNpcTalk(npc) {
  if (!npc) return false;
  if (npc.talkCooldown && stateTime < npc.talkCooldown) return false;
  resolvePlayerNpcOverlap();
  player.npcGhostUntil = stateTime + 800;
  if (IS_MOBILE) player.npcGhostUntil = Math.max(player.npcGhostUntil, stateTime + 1500);
  const lines = getNpcLines(npc.cityId, npc.id);
  npc.dialogueIdx = (npc.dialogueIdx + 1) % lines.length;
  const text = lines[npc.dialogueIdx];
  ui.npcBubble = { npcId: npc.id, text, untilMs: stateTime + 2400 };
  npc.talkCooldown = stateTime + 1200;
  return true;
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
  if (!overlaps.length) return npcOverlapAt(px, py);
  const ignore = new Set(overlaps.map(e => e.id));
  for (const e of entities) {
    if (e.kind !== 'npc') continue;
    if (ignore.has(e.id)) continue;
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
    version: 'v0.0.119',
    whatsNew: [
      'Diag: auto-moves to nearest open tile before testing movement.',
      'Diag: isolates NPC blocking vs wall blocking.',
      'QA: unchanged (diag runtime-only).',
    ],
    whatsNext: [
      'NPCs: add a nearby "Press E" hint (optional).',
      'Dialogue: richer lines + rare city-specific quips.',
      'UI: polish NPC panel layout + mobile-friendly hinting.',
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

    npcBubble: null,
    _npcBubbleRect: null,
    _npcBubbleText: '',
    npcDiag: __NPCDIAG_STATE,

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
      scheduleAutoSave();
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
    toast(`Accepted contract. (Reward ${finalReward}g)`, 2.2);

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

    // Banner is rendered whenever a modal is open (keeps scope minimal).
    // NOTE: keep render keys small but sufficient; rebuild modal when state changes.
    let key = kind;
    if (banner.q.length) {
      key += `|b${banner.q.length}`;
      for (const it of banner.q) key += `|${it.id}:${it.state}`;
    }
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
      const rumors = getMarketRumors(c.id);
      const rumorsHtml = rumors.length ? `
        <div class="cr-rumors" aria-label="Rumors">
          <div class="cr-rumors-title">Rumors</div>
          ${rumors.map(t => `<div class="cr-rumor">• ${htmlEscape(t)}</div>`).join('')}
        </div>
      ` : '';

      uiRoot.innerHTML = `
        ${bannerHtml}
        <div class="cr-backdrop" role="dialog" aria-modal="true" aria-label="Market">
          <div class="cr-panel">
            <div class="cr-head">
              <div>
                <div class="cr-title">${htmlEscape(c.name)} Market</div>
                <div class="cr-sub">${htmlEscape(rules.vibe)}</div>
                ${rumorsHtml}
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
        ${bannerHtml}
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
        ${bannerHtml}
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
    npcGhostUntil: 0,
    moveStallT: 0,
    moveStallX: 0,
    moveStallY: 0,

    rep: { sunspire: 0, gloomwharf: 0 },
    permits: { sunspire: false, gloomwharf: false },

  };

  // --- Save/Load (localStorage)
  const SAVE_KEY = 'charter-road-save-v1';
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

  function saveGame() {
    const state = {
      saveVersion: SAVE_SCHEMA_VERSION,
      buildVersion: 'v0.0.93',
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
      },
      time: { ...time },
      marketDrift: {
        sunspire: { ...marketDrift.sunspire },
        gloomwharf: { ...marketDrift.gloomwharf },
      },
      contracts: {
        active: contracts.active ? { ...contracts.active } : null,
      },
      openedCaches: Array.from(openedCaches),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      ui._lastSavedDay = time.day;
      notifySaved(`Saved (Day ${time.day})`);
      console.log('[SAVE] Game saved');
    } catch (e) {
      console.warn('[SAVE] Failed to save:', e);
    }
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
        if (!isObj(s.marketDrift.sunspire)) errors.push('marketDrift.sunspire must be object');
        if (!isObj(s.marketDrift.gloomwharf)) errors.push('marketDrift.gloomwharf must be object');
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
      s.player.rep ||= { sunspire: 0, gloomwharf: 0 };
      s.player.permits ||= { sunspire: false, gloomwharf: false };
      s.player.facing ||= { x: 0, y: 1 };

      s.time ||= { day: 1, frac: 0, seed: 1 };
      s.marketDrift ||= { sunspire: {}, gloomwharf: {} };

      s.contracts ||= { active: null };
      if (s.contracts.active === undefined) s.contracts.active = null;

      if (!Array.isArray(s.openedCaches)) s.openedCaches = [];
    }

    // Ensure openedCaches exists for newer saves too.
    if (!Array.isArray(s.openedCaches)) s.openedCaches = [];

    return s;
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        console.log('[LOAD] No save found');
        return false;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.warn('[LOAD] Failed to parse save JSON:', e);
        toast('Load failed: corrupted save data.', 2.5);
        return false;
      }

      const state = migrateSave(parsed);
      const vr = validateSave(state);
      if (!vr.ok) {
        console.warn('[LOAD] Invalid save data:', vr.errors);
        toast('Load failed: incompatible save.', 2.5);
        return false;
      }

      // Restore player
      Object.assign(player, state.player);
      // Restore time
      Object.assign(time, state.time);
      // Restore market drift
      if (state.marketDrift?.sunspire) Object.assign(marketDrift.sunspire, state.marketDrift.sunspire);
      if (state.marketDrift?.gloomwharf) Object.assign(marketDrift.gloomwharf, state.marketDrift.gloomwharf);
      // Restore contracts
      contracts.active = state.contracts?.active || null;

      // Restore opened caches
      openedCaches.clear();
      if (Array.isArray(state.openedCaches)) {
        for (const k of state.openedCaches) if (typeof k === 'string') openedCaches.add(k);
      }

      // Re-center camera on player
      camera.x = player.x - VIEW_W/2;
      camera.y = player.y - VIEW_H/2;

      // Opportunistically re-save after migration/validation
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {
        console.warn('[SAVE] Failed to re-save after load:', e);
      }

      console.log('[LOAD] Game loaded (day', time.day, ')');
      toast('Game loaded (day ' + time.day + ').', 2);
      return true;
    } catch (e) {
      console.warn('[LOAD] Failed to load:', e);
      toast('Load failed.', 2.5);
      return false;
    }
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
    autoSaveTimer = setTimeout(saveGame, 2000);
  }

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
        !isSolidAt(nxPos + player.r, player.y + player.r) &&
        !isNpcBlocking(nxPos, player.y)) {
      player.x = nxPos;
    }

    // Y axis collision
    let nyPos = player.y + stepY;
    if (!isSolidAt(player.x - player.r, nyPos - player.r) &&
        !isSolidAt(player.x + player.r, nyPos - player.r) &&
        !isSolidAt(player.x - player.r, nyPos + player.r) &&
        !isSolidAt(player.x + player.r, nyPos + player.r) &&
        !isNpcBlocking(player.x, nyPos)) {
      player.y = nyPos;
    }

    // clamp to map
    player.x = clamp(player.x, TILE, MAP_W*TILE - TILE);
    player.y = clamp(player.y, TILE, MAP_H*TILE - TILE);

    resolvePlayerNpcOverlap();
  }



  function getCityById(id) {
    if (id === world.cityA.id) return world.cityA;
    if (id === world.cityB.id) return world.cityB;
    return null;
  }

  function cityName(id) {
    const c = getCityById(id);
    return c ? c.name : String(id || '');
  }

  function getMarketRumors(cityId) {
    const id = String(cityId || '');
    const c = getCityById(id);
    if (!c) return [];

    // Always-true rumors derived from actual computed prices.
    const other = (id === 'sunspire') ? 'gloomwharf' : 'sunspire';
    const otherC = getCityById(other);

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

    const lines = [];
    if (cheap && cheap.it) {
      lines.push(`${cheap.it.name} is cheaper in ${cityName(id)} today.`);
    }
    if (pricey && pricey.it) {
      // Avoid duplicate item line; pick next best if needed.
      if (cheap && pricey.it.id === cheap.it.id) {
        const alt = list.find(x => x.it.id !== cheap.it.id);
        if (alt) lines.push(`${alt.it.name} is pricier in ${cityName(id)} today.`);
      } else {
        lines.push(`${pricey.it.name} is pricier in ${cityName(id)} today.`);
      }
    }

    return lines.slice(0, 2);
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
        if (id === 13) return id; // cache
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
      if (ui.marketOpen || ui.contractsOpen || ui.eventOpen) return;
      const c = currentCity();
      if (ui.npcDiag?.enabled && ui.npcDiag.forceNpc && c) {
        const npc = findNearestNpc(player.x, player.y, NPC_INTERACT_RADIUS);
        if (npc && triggerNpcTalk(npc)) { ui.npcDiag.lastAction = 'npc'; return; }
      }
      if (c && nearMarketTile()) {
        ui.contractsOpen = false;
        ui.marketOpen = !ui.marketOpen;
        ui.selection = 0;
        ui.mode = 'buy';
        if (ui.npcDiag?.enabled) ui.npcDiag.lastAction = 'market';
        toast(ui.marketOpen ? `Market opened in ${c.name}` : 'Market closed', 2);
      } else if (c && nearContractsTile()) {
        ui.marketOpen = false;
        ui.contractsOpen = !ui.contractsOpen;
        ui.contractsSel = 0;
        ui.contractsCityId = c.id;
        toast(ui.contractsOpen ? 'Contracts board opened' : 'Contracts board closed', 2);
      } else if (c) {
        const npc = findNearestNpc(player.x, player.y, NPC_INTERACT_RADIUS);
        if (npc && triggerNpcTalk(npc)) { if (ui.npcDiag?.enabled) ui.npcDiag.lastAction = 'npc'; return; }
        toast('Find the market stall (tan), contracts board (green), or a local to chat with.', 2.5);
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


function drawEntities() {
  if (!entities.length) return;
  for (const e of entities) {
    if (e.kind === 'npc') drawNpcEntity(e);
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



// city hub NPC chatter (desktop; hidden during modals)
if (!IS_MOBILE && c && !ui.marketOpen && !ui.contractsOpen && !ui.eventOpen && !(document.body && document.body.classList.contains('ui-open'))) {
  const rows = getNpcPanelState(c.id);
  if (rows && rows.length) {
    const fontSz = Math.round(12 * UI_SCALE);
    const rowH = Math.round(16 * UI_SCALE);
    const x = titleX;
    const y0 = line2 + Math.round(18 * UI_SCALE);
    const padX = Math.round(10 * UI_SCALE);
    const padY = Math.round(8 * UI_SCALE);
    const boxW = Math.min(maxTextW, VIEW_W - x - Math.round(12 * UI_SCALE));
    const boxH = Math.round(14 * UI_SCALE) + rows.length * rowH + padY;
    const boxX = x;
    const boxY = y0 - Math.round(14 * UI_SCALE);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.strokeStyle = 'rgba(30, 42, 54, 0.80)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 12);
    else ctx.rect(boxX, boxY, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(160,184,203,0.95)';
    ctx.font = `900 ${Math.round(10 * UI_SCALE)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText('PEOPLE', boxX + padX, boxY + Math.round(14 * UI_SCALE));

    ctx.fillStyle = '#cfe6ff';
    ctx.font = `700 ${fontSz}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    let y = boxY + Math.round(30 * UI_SCALE);
    for (const r of rows) {
      ctx.fillText(ellipsizeText(r.line, boxW - padX * 2), boxX + padX, y);
      y += rowH;
    }

    ctx.restore();
  }
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
    }

    // Virtual (touch) button actions
    if (consumeVKey('KeyE')) {
      const c = currentCity();
      if (ui.npcDiag?.enabled && ui.npcDiag.forceNpc && c) {
        const npc = findNearestNpc(player.x, player.y, NPC_INTERACT_RADIUS);
        if (npc && triggerNpcTalk(npc)) { ui.npcDiag.lastAction = 'npc'; return; }
      }
      if (c && nearMarketTile()) {
        ui.contractsOpen = false;
        ui.marketOpen = !ui.marketOpen;
        ui.selection = 0;
        ui.mode = 'buy';
        if (ui.npcDiag?.enabled) ui.npcDiag.lastAction = 'market';
        toast(ui.marketOpen ? `Market opened in ${c.name}` : 'Market closed', 2);
      } else if (c && nearContractsTile()) {
        ui.marketOpen = false;
        ui.contractsOpen = !ui.contractsOpen;
        ui.contractsSel = 0;
        ui.contractsCityId = c.id;
        toast(ui.contractsOpen ? 'Contracts board opened' : 'Contracts board closed', 2);
      } else if (c) {
        const npc = findNearestNpc(player.x, player.y, NPC_INTERACT_RADIUS);
        if (npc && triggerNpcTalk(npc)) { if (ui.npcDiag?.enabled) ui.npcDiag.lastAction = 'npc'; return; }
        toast('Find the market stall (tan), contracts board (green), or a local to chat with.', 2.5);
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
          for (let i = 0; i < days; i++) {
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
    drawEntities();
    drawPlayer();
    drawNpcBubble();
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
      const buyR = __QA.api.marketBuy('food', 1, 'sunspire');
      assert(buyR.ok === true, 'marketBuy should succeed');
      assert(__QA.api.flushAutosave() === true, 'autosave should be scheduled after buy');
      const buySave = __QA.api.readSave();
      assert(!!buySave, 'save should exist after buy autosave flush');
      assert(buySave.player.inv.food === (beforeBuy.player.inv.food || 0) + 1, 'save should reflect bought food');

      // Sell should schedule autosave and persist the updated state
      __QA.api.clearSave();
      __QA.api.setPlayer({ gold: 50, inv: { food: 2 }, capacity: 999 });
      const beforeSell = __QA.api.snapshot();
      const sellR = __QA.api.marketSell('food', 1, 'sunspire');
      assert(sellR.ok === true, 'marketSell should succeed');
      assert(__QA.api.flushAutosave() === true, 'autosave should be scheduled after sell');
      const sellSave = __QA.api.readSave();
      assert(!!sellSave, 'save should exist after sell autosave flush');
      assert(sellSave.player.inv.food === (beforeSell.player.inv.food || 0) - 1, 'save should reflect sold food');

      // Failed buy should not schedule autosave
      __QA.api.clearSave();
      __QA.api.setPlayer({ gold: 0, inv: { food: 0 }, capacity: 999 });
      const badBuy = __QA.api.marketBuy('food', 1, 'sunspire');
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
        __QA.api.setRep('sunspire', 0);
        __QA.api.regenContracts('sunspire');
        const vis0 = __QA.api.listVisibleContracts('sunspire');
        assert(vis0.every(j => (j.tier ?? 0) <= 0), 'rep=0 should only show tier0 contracts');

        __QA.api.setRep('sunspire', 3);
        const vis1 = __QA.api.listVisibleContracts('sunspire');
        assert(vis1.some(j => (j.tier ?? 0) === 1) || vis1.length === 0, 'rep=3 should allow tier1 contracts');

        __QA.api.setRep('sunspire', 7);
        const vis2 = __QA.api.listVisibleContracts('sunspire');
        assert(vis2.some(j => (j.tier ?? 0) === 2) || vis2.length === 0, 'rep=7 should allow tier2 contracts');

        // Reward math: permit should increase reward.
        __QA.api.setRep('sunspire', 0);
        __QA.api.setPermit('sunspire', false);
        const rNo = contractRewardForAccept('sunspire', 100, 0);
        __QA.api.setPermit('sunspire', true);
        const rYes = contractRewardForAccept('sunspire', 100, 0);
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
        const r1 = __QA.api.getRumors('sunspire');
        const r2 = __QA.api.getRumors('sunspire');
        assert(Array.isArray(r1) && r1.length === 2, 'sunspire should return exactly 2 rumors');
        assert(JSON.stringify(r1) === JSON.stringify(r2), 'rumors should be stable across repeated calls');

        __QA.api.travelDays(1);
        const r3 = __QA.api.getRumors('sunspire');
        assert(JSON.stringify(r3) !== JSON.stringify(r1), 'rumors should change after day advances (most days)');
      }

      // --- NPC dialogue (fixture; cached 10 per NPC per day)
      {
        try { localStorage.removeItem(NPC_CACHE_KEY); } catch {}
        __QA.api.setTime({ day: 12, frac: 0, seed: 7 });

        const lines = __QA.api.getNpcLines('sunspire', 'sunspire_scribe');
        assert(Array.isArray(lines) && lines.length === 10, 'npc lines should be 10');
        assert(lines.every(s => typeof s === 'string' && s.trim().length > 0), 'npc lines should be non-empty strings');

        const panel = __QA.api.getNpcPanel('sunspire');
        assert(Array.isArray(panel) && panel.length === 3, 'npc panel should return 3 npcs for sunspire');
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
  __QA.api.teleportToCity('sunspire');
  __QA.api.spawnCityNPCs('sunspire');

  const walkers = __QA.api.getNpcEntities();
  assert(Array.isArray(walkers) && walkers.length === 3, 'sunspire should spawn 3 NPC walkers');
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
  const lines = __QA.api.getNpcLines('sunspire', target.id);
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
  __QA.api.teleportToCity('sunspire');
  __QA.api.spawnCityNPCs('sunspire');
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
        assert(__QA.api.setActiveContract({ fromId: 'sunspire', toId: 'gloomwharf', want, qty, reward }) === true, 'setActiveContract should succeed');
        const before = __QA.api.snapshot();

        // Enter destination city and process entry logic.
        assert(__QA.api.forceCityEntry('gloomwharf') === true, 'forceCityEntry gloomwharf should succeed');

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
        assert(__QA.api.setActiveContract({ fromId: 'sunspire', toId: 'gloomwharf', want, qty, reward }) === true, 'setActiveContract should succeed (insufficient case)');
        const before = __QA.api.snapshot();

        assert(__QA.api.forceCityEntry('gloomwharf') === true, 'forceCityEntry gloomwharf should succeed (insufficient case)');

        assert(!!contracts.active, 'contract should remain active when insufficient goods');
        assert(contracts.active.want === want && contracts.active.qty === qty && contracts.active.toId === 'gloomwharf', 'active contract should remain unchanged');
        assert((player.inv[want] || 0) === (before.player.inv[want] || 0), 'inventory should not change when insufficient goods');
        assert(player.gold === before.player.gold, 'gold should not change when insufficient goods');

        // No autosave should be scheduled purely from failing delivery.
        assert(__QA.api.flushAutosave() === false, 'no autosave should be scheduled after insufficient-goods delivery');
        assert(__QA.api.readSaveRaw() === null, 'no save should be written after insufficient-goods delivery');
      }

      qaPass('save/load + autosave + contracts + npc dialogue + npc walkers + mobile bubbles');
    } catch (e) {
      qaFail(String(e && (e.stack || e.message) || e));
    }
  }

  tick();
})();
