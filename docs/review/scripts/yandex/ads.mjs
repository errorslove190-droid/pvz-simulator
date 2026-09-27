// Реклама: rewarded на складе, звук при уходе со вкладки/паузе/повороте ВО ВРЕМЯ рекламы,
// реклама закрылась, пока вкладка скрыта. Сервер 8802 (src) с имитацией SDK.
import { chromium } from 'playwright';
import { PROFILES, OUT, initScript, watchConsole, playAcceptance, hideTab, showTab, state, save, compactEvents } from './lib.mjs';

const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = {};

async function freshPage(adMs, prof = 'phone') {
  const ctx = await browser.newContext(PROFILES[prof]);
  await ctx.addInitScript(initScript);
  const p = await ctx.newPage();
  const cons = await watchConsole(p, ctx);
  await p.goto(`http://localhost:8802/?adMs=${adMs}`);
  await p.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await sleep(500);
  if (prof === 'phone') await p.tap('#tutorial-btn'); else await p.click('#tutorial-btn'); // настоящий жест: звук включается
  await sleep(700);
  return { ctx, p, cons };
}
// Отчёт → магазин → вкладка «Расходники»
async function toShop(p) {
  await playAcceptance(p, { input: 'eval' });
  await p.evaluate(() => { showDayEnd({ keepDaily: true }); openShopScreen(); if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); switchShopTab('daily'); });
  await sleep(400);
}

// ---------- A. Rewarded на складе (убрать мёртвый груз) ----------
{
  const { ctx, p } = await freshPage(1500);
  await playAcceptance(p, { input: 'eval' });
  await p.evaluate(() => document.getElementById('btn-summary-continue').click());
  await sleep(900);
  // сцена → «выдать» → склад
  for (let i = 0; i < 30; i++) {
    const act = await p.evaluate(() => {
      if (document.getElementById('tutorial-overlay').classList.contains('show')) { closeGuide(); return 'guide'; }
      const a = document.querySelector('.screen-card.active').id;
      if (a === 'screen-warehouse') return a;
      if (sceneQueue.length) { tapScene(); return 'tap'; }
      const ch = document.querySelector('.scene-choice:not(.disabled):not([disabled])'); if (ch) { ch.click(); return 'choice'; }
      const c = document.querySelector('#btn-scene-continue'); if (c) { c.click(); return 'cont'; }
      return a;
    });
    if (act === 'screen-warehouse') break;
    await sleep(500);
  }
  // подложить брак на полку (вместо одной «чужой» посылки, если мест нет)
  const placed = await p.evaluate(() => {
    const cust = gameState.activeVisitor;
    const extra = { code: '9901', spriteIdx: 0, sprite: PARCEL_SPRITES[0], spriteTorn: PARCEL_SPRITES_TORN[0], status: 'broken', isBroken: true, daysOnShelf: 0 };
    const other = gameState.shelfParcels.findIndex((x) => x.code !== cust.orderCode);
    if (gameState.shelfParcels.length >= gameState.warehouseCapacity && other !== -1) gameState.shelfParcels.splice(other, 1, extra); else gameState.shelfParcels.push(extra);
    gameState.shelfCells = null; showWarehouse();
    return !!document.querySelector('.wh-box.is-deadload');
  });
  await p.tap('.wh-box.is-deadload');
  await sleep(400);
  await p.screenshot({ path: OUT + 'phone-warehouse-rv.jpg', type: 'jpeg', quality: 70 });
  const btn = await p.$('.wh-ad-btn');
  const label = btn ? await btn.textContent() : null;
  const before = await state(p);
  await btn.tap();
  await sleep(300);
  const mid = await state(p);
  await sleep(1700);
  const after = await state(p);
  const removed = await p.evaluate(() => !gameState.shelfParcels.some((x) => x.code === '9901'));
  res.warehouseRV = { placed, label, before, mid, after, removed, journal: compactEvents(await p.evaluate(() => __ygMock.events)).slice(-8) };
  await ctx.close();
}

// ---------- B. Уход со вкладки и возврат ВО ВРЕМЯ rewarded ----------
{
  const { ctx, p } = await freshPage(5000);
  await toShop(p);
  await p.tap('.shop-ad-btn');
  await sleep(400);
  const mid = await state(p);
  await hideTab(p); await sleep(700);
  const hid = await state(p);
  await showTab(p); await sleep(700);
  const back = await state(p);
  const overlay = await p.evaluate(() => [...document.body.children].some((el) => el.textContent.includes('(имитация)')));
  await sleep(3800);
  res.tabSwitchDuringAd = { mid, hidden: hid, backWhileAdStillOpen: back, adOverlayStillShown: overlay, after: await state(p) };
  // та же история через game_api_pause/resume (пауза платформы во время рекламы)
  await p.tap('.shop-ad-btn');
  await sleep(400);
  await p.evaluate(() => __ygMock.pause()); await sleep(500);
  await p.evaluate(() => __ygMock.resume()); await sleep(500);
  res.platformPauseDuringAd = { afterResumeWhileAdOpen: await state(p) };
  await sleep(4500);
  await ctx.close();
}

// ---------- C. Реклама закрылась, пока вкладка скрыта (полноэкранная при начале дня) ----------
{
  const { ctx, p } = await freshPage(2000);
  await toShop(p);
  await p.tap('#screen-shop .action-btn'); // «Начать рабочий день» → полноэкранная реклама
  await sleep(300);
  const mid = await state(p);
  await hideTab(p);
  await sleep(2600); // реклама закрылась, вкладка всё ещё скрыта
  const hiddenAfterAd1 = await state(p);
  await sleep(3000);
  const hiddenAfterAd2 = await state(p);
  await showTab(p);
  await sleep(800);
  res.adClosedWhileHidden = { mid, hiddenAfterAdClose: hiddenAfterAd1, hidden3sLater: hiddenAfterAd2, visibleAgain: await state(p), journal: compactEvents(await p.evaluate(() => __ygMock.events)).slice(-6) };
  await ctx.close();
}

// ---------- D. Телефон повернули горизонтально и обратно во время rewarded ----------
{
  const { ctx, p } = await freshPage(5000);
  await toShop(p);
  await p.tap('.shop-ad-btn');
  await sleep(400);
  await p.setViewportSize({ width: 844, height: 390 }); await sleep(700);
  const land = await state(p);
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(700);
  res.rotateDuringAd = { landscape: land, portraitWhileAdOpen: await state(p) };
  await sleep(4000);
  await ctx.close();
}

// ---------- E. Частота полноэкранной: быстрые дни подряд ----------
{
  const { ctx, p } = await freshPage(200, 'pc720');
  const starts = [];
  for (let d = 0; d < 4; d++) {
    await playAcceptance(p, { input: 'eval' });
    await p.evaluate(() => { showDayEnd({ keepDaily: true }); });
    await sleep(300);
    const t = await p.evaluate(() => Math.round(performance.now()));
    await p.evaluate(() => YG.startNewDay());
    await sleep(600);
    starts.push(t);
  }
  const ads = await p.evaluate(() => __ygMock.events.filter((e) => e.name.startsWith('adv:')).map((e) => e.t));
  res.interstitialFrequency = { dayStartsAtMs: starts, adsAtMs: ads };
  await ctx.close();
}

save('ads.json', res);
console.log(JSON.stringify(res, null, 1).slice(0, 9000));
await browser.close();
