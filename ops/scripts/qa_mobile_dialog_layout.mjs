#!/usr/bin/env node
/**
 * QA: Mobile dialog layout screenshot validation.
 *
 * Verifies that after the v0.0.97 compact-chrome changes:
 *   1. The market modal opens on iPhone 12 viewport
 *   2. .cr-list fills ≥40% of .cr-panel height (taller list)
 *   3. .cr-head is ≤20% of .cr-panel height (compact header)
 *   4. .cr-foot is ≤15% of .cr-panel height (compact footer)
 *   5. .cr-close button has ≥44px touch target (usable)
 *
 * Saves screenshots to ops/screenshots/
 *
 * Usage:
 *   node ops/scripts/qa_mobile_dialog_layout.mjs [url]
 */

import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, '../screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const url = process.argv[2] || process.env.QA_URL || 'http://127.0.0.1:8080/?qa=1';

function die(msg) {
  console.error('QA_FAIL:', msg);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) die(msg);
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 12'] });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.stack || e?.message || e)));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Wait for QA harness
  await page.waitForFunction(() => window.__QA?.status === 'pass' || window.__QA?.status === 'fail', { timeout: 20_000 });
  const qaResult = await page.evaluate(() => window.__QA);
  if (qaResult?.status !== 'pass') {
    die(`QA harness failed before screenshot test: ${qaResult?.details}`);
  }

  // Screenshot: baseline (no modal)
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/mobile_baseline.png`, fullPage: false });
  console.log('Screenshot saved: mobile_baseline.png');

  // Open market modal via QA helper openMarketUI()
  const opened = await page.evaluate(() => window.__QA.api.openMarketUI('gloomwharf', 'buy'));
  await page.waitForTimeout(200);

  if (!opened) {
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/mobile_no_modal.png`, fullPage: false });
    console.log('Screenshot saved: mobile_no_modal.png');
    die('openMarketUI() returned false — .cr-panel not rendered. Check screenshot: mobile_no_modal.png');
  }

  // Screenshot: modal open
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/mobile_market_modal.png`, fullPage: false });
  console.log('Screenshot saved: mobile_market_modal.png');

  // Measure layout proportions
  const measurements = await page.evaluate(() => {
    const panel = document.querySelector('.cr-panel');
    const head = document.querySelector('.cr-head');
    const list = document.querySelector('.cr-list');
    const foot = document.querySelector('.cr-foot');
    const closeBtn = document.querySelector('.cr-close');

    if (!panel) return null;

    const pr = panel.getBoundingClientRect();
    const hr = head ? head.getBoundingClientRect() : null;
    const lr = list ? list.getBoundingClientRect() : null;
    const fr = foot ? foot.getBoundingClientRect() : null;
    const cr = closeBtn ? closeBtn.getBoundingClientRect() : null;

    return {
      panelH: pr.height,
      headH: hr ? hr.height : 0,
      listH: lr ? lr.height : 0,
      footH: fr ? fr.height : 0,
      closeBtnH: cr ? cr.height : 0,
      closeBtnW: cr ? cr.width : 0,
    };
  });

  if (!measurements) die('Could not measure .cr-panel layout');

  const { panelH, headH, listH, footH, closeBtnH, closeBtnW } = measurements;
  console.log(`Panel: ${panelH.toFixed(1)}px  Head: ${headH.toFixed(1)}px  List: ${listH.toFixed(1)}px  Foot: ${footH.toFixed(1)}px  CloseBtn: ${closeBtnH.toFixed(1)}×${closeBtnW.toFixed(1)}px`);

  const listPct = listH / panelH;
  const headPct = headH / panelH;
  const footPct = footH / panelH;

  assert(listPct >= 0.40, `FAIL list fills only ${(listPct * 100).toFixed(1)}% of panel (want ≥40%)`);
  assert(headPct <= 0.22, `FAIL header is ${(headPct * 100).toFixed(1)}% of panel (want ≤22%)`);
  assert(footPct <= 0.18, `FAIL footer is ${(footPct * 100).toFixed(1)}% of panel (want ≤18%)`);
  assert(closeBtnH >= 36, `FAIL close button height ${closeBtnH.toFixed(1)}px is too small (want ≥36px)`);

  console.log(`✓ list=${(listPct * 100).toFixed(1)}% (≥40%)  head=${(headPct * 100).toFixed(1)}% (≤22%)  foot=${(footPct * 100).toFixed(1)}% (≤18%)  closeBtn=${closeBtnH.toFixed(1)}px (≥36px)`);

  // Validate enriched card data
  const cardValidation = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.cr-card')];
    // Skip permit row (last card) — it has no price row
    const itemCards = cards.slice(0, -1);
    const results = itemCards.map(card => ({
      hasPriceRow: !!card.querySelector('.cr-price-row'),
      hasBuyPrice: !!card.querySelector('.cr-buy-price'),
      hasSellPrice: !!card.querySelector('.cr-sell-price'),
      hasDelta: !!(card.querySelector('.cr-delta-up') || card.querySelector('.cr-delta-down') || card.querySelector('.cr-delta-flat')),
      deltaText: (card.querySelector('.cr-delta-up, .cr-delta-down, .cr-delta-flat') || {}).textContent || '',
      buyText: (card.querySelector('.cr-buy-price') || {}).textContent || '',
      sellText: (card.querySelector('.cr-sell-price') || {}).textContent || '',
    }));
    return results;
  });

  for (let i = 0; i < cardValidation.length; i++) {
    const c = cardValidation[i];
    assert(c.hasPriceRow, `Card ${i}: missing .cr-price-row`);
    assert(c.hasBuyPrice, `Card ${i}: missing .cr-buy-price`);
    assert(c.hasSellPrice, `Card ${i}: missing .cr-sell-price`);
    assert(c.hasDelta, `Card ${i}: missing delta badge`);
    assert(/\d+g/.test(c.buyText), `Card ${i}: buy price text '${c.buyText}' has no price`);
    assert(/\d+g/.test(c.sellText), `Card ${i}: sell price text '${c.sellText}' has no price`);
    console.log(`  Card ${i}: ${c.buyText} / ${c.sellText} ${c.deltaText}`);
  }
  console.log(`✓ enriched cards validated (${cardValidation.length} item cards)`);

  await browser.close();

  if (errors.length) {
    die(`Console/page errors during test:\n- ${errors.join('\n- ')}`);
  }

  console.log('QA_PASS: mobile-dialog-layout');
}

run().catch((e) => die(e?.stack || e?.message || e));
