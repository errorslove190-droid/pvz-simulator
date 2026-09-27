// D1. onDeadloadClick: каждый тап по мёртвому грузу ставит свой setTimeout(6 с), таймеры не
// сбрасываются. a) заказа нет на складе: два тапа → две кнопки «Разобраться с клиентом»;
// b) заказ на складе: второй тап через 5 с → предложение «убрать за рекламу» исчезает через 1 с.
import { launch, newGame, skipGuides, playAcceptance, waitChoices, waitContinue, bug, info } from './lib.mjs';

const browser = await launch();
async function toWarehouse(p, { dropTarget }) {
  await skipGuides(p);
  await p.evaluate(() => {
    gameState.day = 5; gameState.money = 1000; gameState.warehouseCapacity = 6;
    const mk = (code) => ({ code, sprite: PARCEL_SPRITES[3], spriteIdx: 3, status: 'surplus', isBroken: false });
    gameState.shelfParcels = [mk('4829')]; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
    startAcceptance();
    gameState.todayScandal = null; gameState.todayBomzh = null;
    gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
  });
  await playAcceptance(p);
  if (dropTarget) await p.evaluate(() => { const code = gameState.todayVisitorRoster[0].orderCode; gameState.shelfParcels = gameState.shelfParcels.filter((x) => x.code !== code); });
  await p.click('#btn-summary-continue');
  await waitChoices(p);
  await p.click('.scene-choice >> nth=0');
  await waitContinue(p);
  await p.click('#btn-scene-continue');
  await p.waitForSelector('.wh-box.is-deadload');
  await p.waitForTimeout(400);
}
try {
  {
    console.log('a) заказа нет, два тапа по мёртвому грузу с интервалом 2 с');
    const p = await newGame(browser, { mobile: true });
    await toWarehouse(p, { dropTarget: true });
    await p.tap('.wh-box.is-deadload');
    await p.waitForTimeout(2000);
    await p.tap('.wh-box.is-deadload');
    await p.waitForTimeout(6500);
    const n = await p.evaluate(() => ({ refuse: document.querySelectorAll('#warehouse-hint-feedback .refuse-btn').length, ad: document.querySelectorAll('#warehouse-hint-feedback .wh-ad-btn').length }));
    info(`кнопок «Разобраться с клиентом»: ${n.refuse}, кнопок рекламы: ${n.ad}`);
    bug(n.refuse >= 2, 'кнопка «Разобраться с клиентом» задвоилась');
    await p.context().close();
  }
  {
    console.log('b) заказ на складе, второй тап через 5 с');
    const p = await newGame(browser, { mobile: true });
    await toWarehouse(p, { dropTarget: false });
    await p.tap('.wh-box.is-deadload');
    await p.waitForTimeout(5000);
    await p.tap('.wh-box.is-deadload');
    const t0 = Date.now();
    let goneAfter = null;
    for (let i = 0; i < 70; i++) {
      const has = await p.evaluate(() => !!document.querySelector('#warehouse-hint-feedback .wh-ad-btn'));
      if (!has) { goneAfter = Date.now() - t0; break; }
      await p.waitForTimeout(100);
    }
    info(`предложение рекламы после второго тапа исчезло через ${goneAfter} мс (задумано 6000)`);
    bug(goneAfter !== null && goneAfter < 2000, 'предложение «убрать за рекламу» исчезает раньше времени — таймер первого тапа не сброшен');
    await p.context().close();
  }
} finally {
  await browser.close();
}
