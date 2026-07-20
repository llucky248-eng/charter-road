#!/usr/bin/env node
/**
 * Lightweight self-test runner.
 *
 * Usage:
 *   node ops/scripts/qa_selftest.mjs [url]
 *
 * Default URL: starts its own server on port 8080 if none provided.
 * If a custom URL is passed as argv[2], uses that directly (no server started).
 */

import { chromium, devices } from 'playwright';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { startServer } from './lib/static_server.mjs';

function die(msg) {
  // Emit a GitHub Actions error annotation so the failure appears in the PR
  // without needing to open the raw job log.
  if (process.env.GITHUB_ACTIONS) console.error(`::error::QA_FAIL: ${msg}`);
  console.error('QA_FAIL:', msg);
  process.exit(1);
}

let activeUrl = process.argv[2] || process.env.QA_URL || 'http://127.0.0.1:8080/?qa=1';

// Chromium's sandbox can't initialize as uid 0, which is how the Playwright CI
// container runs. Drop it only in that case; local (non-root) runs keep it on.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const launchOptions = isRoot ? { args: ['--no-sandbox'] } : {};

async function runOnce({ name, contextOptions }) {
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && (e.stack || e.message) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for the QA harness to report pass/fail.
  let result;
  try {
    result = await page.waitForFunction(() => {
      // @ts-ignore
      return window.__QA && window.__QA.status && (window.__QA.status === 'pass' || window.__QA.status === 'fail');
    }, { timeout: 30_000 }).then(() => page.evaluate(() => {
      // @ts-ignore
      return window.__QA;
    }));
  } catch (waitErr) {
    await browser.close();
    const errSummary = errors.length
      ? `\nPage errors captured:\n- ${errors.join('\n- ')}`
      : '\n(no page errors captured; __QA.status never changed from pending)';
    die(`${name}: waitForFunction timed out — window.__QA.status never reached pass/fail.${errSummary}`);
  }

  await browser.close();

  if (!result || result.status !== 'pass') {
    const msg = result?.details || 'unknown failure';
    die(`${name}: ${msg}`);
  }
  if (errors.length) {
    // Non-fatal console noise can be normal, but for QA we treat it as a failure.
    die(`${name}: console/page errors:\n- ${errors.join('\n- ')}`);
  }

  console.log('QA_PASS:', name);
}

// Selling (or buying) rebuilds the market panel's .cr-list DOM node every
// render, which used to reset its native scrollTop to 0. Drive the real DOM
// through __QA.api (outside the in-page self-test) to confirm the scroll
// offset survives a same-tab trade but still resets on a tab switch.
async function checkMarketScrollPreservation() {
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    // @ts-ignore
    return window.__QA && window.__QA.status && window.__QA.status !== 'pending';
  }, { timeout: 30_000 });

  const outcome = await page.evaluate(() => {
    // @ts-ignore
    const api = window.__QA.api;
    api.clearSave();
    api.setPlayer({ gold: 50, inv: { food: 5, grain: 5, wood: 5, tools: 5 }, capacity: 999 });

    if (!api.openMarketUI('valdenmere', 'sell')) return { ok: false, reason: 'market UI did not open' };
    const list = document.querySelector('.cr-list');
    if (!list) return { ok: false, reason: 'cr-list missing after open' };
    list.scrollTop = 40;

    const sellR = api.marketSell('food', 1, 'valdenmere');
    if (!sellR.ok) return { ok: false, reason: 'marketSell failed' };
    api.flushAutosave();
    // Force a deterministic re-render (mirrors the game loop's per-frame domRender call).
    api.openMarketUI('valdenmere', 'sell');
    const afterSell = document.querySelector('.cr-list');
    const sellScrollOk = !!afterSell && afterSell.scrollTop === 40;

    api.openMarketUI('valdenmere', 'buy');
    const afterSwitch = document.querySelector('.cr-list');
    const switchScrollOk = !!afterSwitch && afterSwitch.scrollTop === 0;

    // Live-mode regression: selling can push an item past the ±0.05 pressure
    // threshold, making the "Global Market" pulse block appear at the TOP of
    // the scroll list. A raw scrollTop restore then leaves the numeric offset
    // intact while the item rows shift down — the view visually jumps toward
    // the top. Anchor check: the item row the player was looking at must stay
    // at the same on-screen position after the sale inserts the block.
    api.openMarketUI('valdenmere', 'sell');
    const list2 = document.querySelector('.cr-list');
    list2.scrollTop = 150;
    const rowTopBefore = (() => {
      const card = list2.querySelector('.cr-card[data-idx]');
      return card.getBoundingClientRect().top - list2.getBoundingClientRect().top;
    })();
    api.setEconomyPressure('valdenmere', 'food', -0.2); // simulates the post-sell pressure spike
    api.marketSell('food', 1, 'valdenmere');
    api.flushAutosave();
    api.openMarketUI('valdenmere', 'sell'); // force re-render, same tab
    const list3 = document.querySelector('.cr-list');
    const econBlockShown = !!list3.querySelector('[aria-label="Market pulse"]');
    const rowTopAfter = (() => {
      const card = list3.querySelector('.cr-card[data-idx]');
      return card.getBoundingClientRect().top - list3.getBoundingClientRect().top;
    })();
    const anchorOk = econBlockShown && Math.abs(rowTopAfter - rowTopBefore) <= 2;

    api.setEconomyPressure('valdenmere', 'food', 0); // clean up for later checks
    api.closeUI();
    return {
      ok: sellScrollOk && switchScrollOk && anchorOk,
      sellScrollOk, switchScrollOk, anchorOk, econBlockShown, rowTopBefore, rowTopAfter,
    };
  });

  await browser.close();

  if (!outcome || !outcome.ok) {
    die(`market-scroll-preservation: ${outcome?.reason || JSON.stringify(outcome)}`);
  }
  console.log('QA_PASS: market-scroll-preservation');
}

// The SELL tab must list only items the player actually holds, and when the
// pack is empty it must stay on SELL and show an empty state — not silently
// bounce the player to the BUY tab.
async function checkSellTabFiltering() {
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    // @ts-ignore
    return window.__QA && window.__QA.status && window.__QA.status !== 'pending';
  }, { timeout: 30_000 });

  const outcome = await page.evaluate(() => {
    // @ts-ignore
    const api = window.__QA.api;
    api.clearSave();

    // Holding 2 item types: sell tab shows exactly those 2 rows (no permit row)
    api.setPlayer({ gold: 50, inv: { coal: 0, grain: 0, food: 5, ore: 3, herbs: 0, potion: 0, relic: 0, ink: 0, gem: 0, copper: 0, silver: 0, gold: 0 }, capacity: 999 });
    if (!api.openMarketUI('valdenmere', 'sell')) return { ok: false, reason: 'market UI did not open' };
    const heldCards = [...document.querySelectorAll('.cr-list .cr-card[data-idx]')];
    const heldCount = heldCards.length;
    const heldTitles = heldCards.map(c => c.querySelector('.cr-card-title')?.textContent || '');
    const onlyHeldShown = heldCount === 2
      && heldTitles.some(t => /rations/i.test(t))
      && heldTitles.some(t => /iron ore/i.test(t));

    // Buy tab still shows the full catalogue + permit row
    api.openMarketUI('valdenmere', 'buy');
    const buyCount = document.querySelectorAll('.cr-list .cr-card[data-idx]').length;
    const buyShowsAll = buyCount > heldCount;

    // Empty pack: sell tab stays selected and shows an empty state
    api.setPlayer({ gold: 50, inv: { food: 0, ore: 0 }, capacity: 999 });
    api.openMarketUI('valdenmere', 'sell');
    const sellSelected = document.querySelector('[data-mode="sell"]')?.getAttribute('aria-selected') === 'true';
    const emptyCards = document.querySelectorAll('.cr-list .cr-card[data-idx]').length;
    const emptyState = !!document.querySelector('.cr-list .cr-empty');
    const emptyOk = sellSelected && emptyCards === 0 && emptyState;

    api.closeUI();
    return { ok: onlyHeldShown && buyShowsAll && emptyOk, onlyHeldShown, buyShowsAll, emptyOk, heldCount, heldTitles, buyCount, sellSelected, emptyCards, emptyState };
  });

  await browser.close();

  if (!outcome || !outcome.ok) {
    die(`sell-tab-filtering: ${outcome?.reason || JSON.stringify(outcome)}`);
  }
  console.log('QA_PASS: sell-tab-filtering');
}

// Mobile market cards must offer a MAX/ALL quantity button, not just single-unit
// trades — emptying a 20-item pack should be one tap, not twenty. Runs under an
// iPhone 12 context so IS_MOBILE (viewport-based) selects the mobile card branch.
async function checkMobileMarketQtyButtons() {
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ ...devices['iPhone 12'] });
  const page = await context.newPage();

  await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    // @ts-ignore
    return window.__QA && window.__QA.status && window.__QA.status !== 'pending';
  }, { timeout: 30_000 });

  const outcome = await page.evaluate(() => {
    // @ts-ignore
    const api = window.__QA.api;
    api.clearSave();
    api.setPlayer({ gold: 500, inv: { coal: 0, grain: 0, food: 7, ore: 0, herbs: 0, potion: 0, relic: 0, ink: 0, gem: 0, copper: 0, silver: 0, gold: 0 }, capacity: 999 });

    // SELL tab: the held item's card must expose an ALL button (qty = holdings)
    if (!api.openMarketUI('valdenmere', 'sell')) return { ok: false, reason: 'market UI did not open' };
    const sellCard = document.querySelector('.cr-list .cr-card[data-idx]');
    if (!sellCard) return { ok: false, reason: 'no sell card rendered' };
    const sellBtns = [...sellCard.querySelectorAll('[data-action="trade"]')];
    const allBtn = sellBtns.find(b => Number(b.getAttribute('data-qty')) === 7);
    if (!allBtn) return { ok: false, reason: `no ALL(qty=7) button; qtys=[${sellBtns.map(b => b.getAttribute('data-qty')).join(',')}]` };
    allBtn.click();
    const soldOut = (api.snapshot().player.inv.food || 0) === 0;

    // BUY tab: cards must expose a MAX button with qty > 1
    api.openMarketUI('valdenmere', 'buy');
    const buyCard = document.querySelector('.cr-list .cr-card[data-idx="0"]');
    if (!buyCard) return { ok: false, reason: 'no buy card rendered' };
    const buyBtns = [...buyCard.querySelectorAll('[data-action="trade"]')];
    const maxBtn = buyBtns.find(b => Number(b.getAttribute('data-qty')) > 1 && !b.disabled);
    if (!maxBtn) return { ok: false, reason: `no MAX(qty>1) buy button; qtys=[${buyBtns.map(b => b.getAttribute('data-qty')).join(',')}]` };
    const maxQty = Number(maxBtn.getAttribute('data-qty'));
    const invBefore = api.snapshot().player.inv;
    const idBefore = JSON.stringify(invBefore);
    maxBtn.click();
    const after = api.snapshot().player.inv;
    // Exactly one item id gained exactly maxQty units in a single tap.
    const gained = Object.keys(after).filter(k => (after[k] || 0) !== (invBefore[k] || 0));
    const boughtMax = gained.length === 1 && (after[gained[0]] || 0) - (invBefore[gained[0]] || 0) === maxQty;

    api.closeUI();
    return { ok: soldOut && boughtMax, soldOut, boughtMax, maxQty, gained, idBefore };
  });

  await browser.close();

  if (!outcome || !outcome.ok) {
    die(`mobile-market-qty-buttons: ${outcome?.reason || JSON.stringify(outcome)}`);
  }
  console.log('QA_PASS: mobile-market-qty-buttons');
}

// Accepting a contract while another is active must not silently discard the
// active one: the first tap arms a confirm, the second tap replaces. The
// active-contract line must also offer an explicit Abandon button.
async function checkContractReplaceAndAbandon() {
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    // @ts-ignore
    return window.__QA && window.__QA.status && window.__QA.status !== 'pending';
  }, { timeout: 30_000 });

  const outcome = await page.evaluate(() => {
    // @ts-ignore
    const api = window.__QA.api;
    api.clearSave();
    api.setActiveContract(null);
    if (typeof api.openContractsUI !== 'function') return { ok: false, reason: 'openContractsUI QA helper missing' };

    // No active contract: one tap accepts.
    if (!api.openContractsUI('valdenmere')) return { ok: false, reason: 'contracts UI did not open' };
    const firstAccept = document.querySelector('[data-action="accept"]');
    if (!firstAccept) return { ok: false, reason: 'no accept button on board' };
    firstAccept.click();
    const active1 = api.snapshot().contracts.active;
    if (!active1) return { ok: false, reason: 'plain accept did not activate a contract' };

    // Active contract present: first tap must NOT replace, second tap must.
    // A sentinel qty (board jobs never ask for 99) makes replacement detectable
    // even when board jobs are seeded identical to each other.
    api.setActiveContract({ want: 'ore', toId: 'ashport', qty: 99, reward: 5 });
    if (!api.openContractsUI('valdenmere')) return { ok: false, reason: 'contracts UI did not reopen' };
    const secondAccept = document.querySelector('[data-action="accept"]');
    if (!secondAccept) return { ok: false, reason: 'no second job on board' };
    secondAccept.click();
    const afterFirstTap = api.snapshot().contracts.active;
    const notReplacedYet = !!afterFirstTap && afterFirstTap.qty === 99;
    // Re-query: the confirm re-render may rebuild the modal DOM.
    const confirmBtn = document.querySelector('[data-action="accept"]');
    if (!confirmBtn) return { ok: false, reason: 'accept button vanished after confirm arm' };
    confirmBtn.click();
    const afterSecondTap = api.snapshot().contracts.active;
    const replaced = !!afterSecondTap && afterSecondTap.qty !== 99;

    // Abandon: active-contract line offers an explicit button that clears it.
    if (!api.openContractsUI('valdenmere')) return { ok: false, reason: 'contracts UI did not reopen for abandon' };
    const abandonBtn = document.querySelector('[data-action="abandon"]');
    if (!abandonBtn) return { ok: false, reason: 'no abandon button while contract active' };
    abandonBtn.click();
    const cleared = api.snapshot().contracts.active === null;

    api.closeUI();
    return { ok: notReplacedYet && replaced && cleared, notReplacedYet, replaced, cleared };
  });

  await browser.close();

  if (!outcome || !outcome.ok) {
    die(`contract-replace-abandon: ${outcome?.reason || JSON.stringify(outcome)}`);
  }
  console.log('QA_PASS: contract-replace-abandon');
}

// The market panel must never clip its own footer or item list. The panel is
// capped (max-height + overflow:hidden), so unless the body/list flex-shrink,
// a long list pushes the footer past the clip edge and the list looks "cut
// off" with no scrollbar — which is exactly what happened on desktop, where
// .cr-list had a viewport-based max-height (62vh) inside a canvas-sized panel.
async function checkMarketPanelNotClipped() {
  const browser = await chromium.launch(launchOptions);

  for (const [name, viewport] of [
    ['desktop-720p', { width: 1280, height: 720 }],
    ['desktop-short', { width: 1280, height: 600 }],
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => {
      // @ts-ignore
      return window.__QA && window.__QA.status && window.__QA.status !== 'pending';
    }, { timeout: 30_000 });

    const outcome = await page.evaluate(() => {
      // @ts-ignore
      const api = window.__QA.api;
      api.clearSave();
      api.setPlayer({ gold: 500, inv: { coal: 5, grain: 5, food: 5 }, capacity: 999 });
      if (!api.openMarketUI('valdenmere', 'buy')) return { ok: false, reason: 'market UI did not open' };
      const panel = document.querySelector('.cr-panel');
      const foot = document.querySelector('.cr-foot');
      const list = document.querySelector('.cr-list');
      if (!panel || !foot || !list) return { ok: false, reason: 'panel/foot/list missing' };
      const pr = panel.getBoundingClientRect();
      const fr = foot.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      // The footer must sit fully inside the panel's clip box, and the list's
      // box must end above the footer (i.e. the list shrank and scrolls instead
      // of overflowing past the clip edge).
      const footVisible = fr.bottom <= pr.bottom + 1 && fr.height > 0;
      const listInside = lr.bottom <= pr.bottom + 1;
      const listScrollable = list.scrollHeight > list.clientHeight
        ? (() => { list.scrollTop = 99999; return list.scrollTop > 0; })()
        : true;
      api.closeUI();
      return { ok: footVisible && listInside && listScrollable, footVisible, listInside, listScrollable, panelBottom: pr.bottom, footBottom: fr.bottom, listBottom: lr.bottom };
    });

    if (!outcome || !outcome.ok) {
      await browser.close();
      die(`market-panel-clipping (${name}): ${outcome?.reason || JSON.stringify(outcome)}`);
    }
    await page.close();
  }

  await browser.close();
  console.log('QA_PASS: market-panel-clipping');
}

(async () => {
  let server = null;

  // Auto-start embedded server when no custom URL given
  // This makes `npm test` self-contained — no need for a separate `npm run serve`
  if (!process.argv[2] && !process.env.QA_URL) {
    const PORT = 8080;
    // Resolve repo root: ops/scripts/qa_selftest.mjs → ../../.. = repo root
    const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
    try {
      server = await startServer(ROOT, PORT);
    } catch (e) {
      if (e.code === 'EADDRINUSE') {
        console.log(`[QA] Port ${PORT} already in use — using existing server`);
      } else {
        die(`Failed to start local server: ${e.message}`);
      }
    }
    activeUrl = `http://127.0.0.1:${PORT}/?qa=1`;
  }

  try {
    await runOnce({
      name: 'desktop',
      contextOptions: { viewport: { width: 1280, height: 720 } },
    });

    await runOnce({
      name: 'mobile-iphone',
      contextOptions: { ...devices['iPhone 12'] },
    });

    await checkMarketScrollPreservation();
    await checkSellTabFiltering();
    await checkMobileMarketQtyButtons();
    await checkContractReplaceAndAbandon();
    await checkMarketPanelNotClipped();

    console.log('QA_PASS: all');
  } finally {
    if (server) server.close();
  }
})();
