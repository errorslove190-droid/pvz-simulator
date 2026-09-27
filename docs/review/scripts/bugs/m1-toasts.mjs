// M1. Тосты: showToast меняет текст одного и того же элемента. Если сразу за ним вызвать
// continueCustomerFlow (он показывает «🔔 Новый посетитель»), первый тост не успевает
// появиться. Проверяем: «⭐ Рейтинг −0.25» после «выставить клиента» и объяснение кражи бомжа.
import { launch, newGame, skipGuides, playAcceptance, waitChoices, waitContinue, bug, info } from './lib.mjs';

const browser = await launch();
async function watchToasts(p) {
  await p.evaluate(() => {
    window.__toasts = [];
    const t = document.getElementById('toast');
    // каждая запись = одно присваивание textContent; одна пачка = один такт без отрисовки между ними
    let batch = 0;
    new MutationObserver((recs) => { batch++; recs.forEach((r) => r.addedNodes.forEach((n) => window.__toasts.push({ text: n.textContent, at: performance.now(), batch }))); }).observe(t, { childList: true });
  });
}
// сколько мс текст был на экране: 0 — затёрт в том же такте (до отрисовки)
const shownFor = (list, re) => {
  const i = list.findIndex((x) => re.test(x.text));
  if (i === -1) return null;
  const next = list[i + 1];
  if (!next) return Infinity;
  return next.batch === list[i].batch ? 0 : Math.round(next.at - list[i].at);
};
try {
  {
    console.log('a) «Отказать → Стоять на своём → Завершить визит» посреди дня');
    const p = await newGame(browser, { mobile: true });
    await skipGuides(p);
    await p.evaluate(() => {
      gameState.day = 5; gameState.money = 1000; gameState.warehouseCapacity = 6;
      gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
      startAcceptance(); gameState.todayScandal = null; gameState.todayBomzh = null;
      gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
    });
    await playAcceptance(p);
    await p.click('#btn-summary-continue');
    await waitChoices(p); await p.click('.scene-choice >> nth=2');
    await waitChoices(p); await p.click('.scene-choice >> nth=0');
    await waitContinue(p);
    await watchToasts(p);
    await p.click('#btn-scene-continue');
    await p.waitForTimeout(300);
    const list = await p.evaluate(() => window.__toasts);
    info('тосты (№такта): ' + list.map((x) => `[${x.batch}] «${x.text}»`).join(' → '));
    const ms = shownFor(list, /Рейтинг/);
    info(`тост с рейтингом продержался ${ms} мс`);
    bug(ms !== null && ms < 20, 'изменение рейтинга после визита без выдачи сразу затирается тостом «Новый посетитель» — игрок его не видит');
    await p.context().close();
  }
  {
    console.log('b) бомж утащил конфеты: объяснение по кнопке «Проверить стойку…»');
    const p = await newGame(browser, { mobile: true });
    await skipGuides(p);
    await p.evaluate(() => {
      gameState.day = 5; gameState.money = 1000; gameState.warehouseCapacity = 6;
      gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
      startAcceptance(); gameState.todayScandal = null;
      gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0) + 1;
      gameState.todayBomzh = { visitor: VISITOR_BOMZH, pos: 0, done: false, stolen: null };
      gameState.daily.candy = true; gameState.daily.wrap = false;
      BOMZH_EVENT.choices[2].stealChance = 1; // «выгнать» (75 %) — фиксируем исход «украл»
    });
    await playAcceptance(p);
    await p.click('#btn-summary-continue');
    await waitChoices(p); await p.click('.scene-choice >> nth=2');
    await waitContinue(p);
    await watchToasts(p);
    await p.click('#btn-scene-continue');
    await p.waitForTimeout(300);
    const list = await p.evaluate(() => window.__toasts);
    info('тосты (№такта): ' + list.map((x) => `[${x.batch}] «${x.text}»`).join(' → '));
    const ms = shownFor(list, /Баф «Вазочка/);
    bug(ms !== null && ms < 20, `пояснение «Баф … пропал» затёрто через ${ms} мс`);
    await p.context().close();
  }
} finally {
  await browser.close();
}
