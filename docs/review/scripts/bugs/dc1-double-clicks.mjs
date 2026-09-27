// DC1. Двойные нажатия (мышь, dblclick): «Открыть двери», «Следующий посетитель»,
// покупка в магазине, «Начать рабочий день» (и повтор во время рекламы).
// Плюс: где окажется кнопка «Открыть двери» относительно корзин сортировки.
import { launch, newGame, skipGuides, playAcceptance, waitChoices, waitContinue, ok, info } from './lib.mjs';

const browser = await launch();
try {
  const p = await newGame(browser, { mobile: true });
  await skipGuides(p);
  await p.evaluate(() => {
    gameState.day = 5; gameState.money = 2000; gameState.warehouseCapacity = 6;
    gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
    startAcceptance();
    gameState.todayScandal = null; gameState.todayBomzh = null;
    gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
  });
  const bins = await p.evaluate(() => ['bin-ours', 'bin-others', 'bin-broken'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, top: Math.round(r.top), bottom: Math.round(r.bottom) }; }));
  const binBox = await p.locator('#bin-others').boundingBox();
  // сортируем накладную, а последний тап по корзине «Чужие» приходится ровно на конец таймера
  await p.evaluate(() => { acceptance.duration = 9999; });
  await playAcceptance(p).catch(() => {});
  const door = await p.evaluate(() => { const r = document.getElementById('btn-summary-continue').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
  const overlap = bins.some((b) => b.top < door.bottom && door.top < b.bottom);
  info(`корзины y=${bins[0].top}…${bins[0].bottom}; кнопка «Открыть двери» y=${door.top}…${door.bottom}; перекрытие: ${overlap}`);
  await p.tap('#btn-summary-continue', { position: { x: 5, y: 5 }, trial: true }).catch(() => {});
  await p.touchscreen.tap(binBox.x + binBox.width / 2, binBox.y + binBox.height / 2); // «ещё один тап по корзине»
  await p.waitForTimeout(900);
  const stray = await p.evaluate(() => document.querySelector('.screen-card.active').id);
  info(`тап в центр корзины «Чужие» сразу после конца приёмки → экран ${stray}`);
  console.log(stray === 'screen-scene' ? '  БАГ ПОДТВЕРЖДЁН: запоздалый тап по корзине открывает двери, итог приёмки не виден' : '  не воспроизвелось: тап по корзине не открыл двери');

  // 1. «Открыть двери» двойным кликом (повторно: день заново)
  await p.evaluate(() => { gameState.shelfParcels = []; startAcceptance(); gameState.todayScandal = null; gameState.todayBomzh = null; gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0); });
  await playAcceptance(p);
  await p.dblclick('#btn-summary-continue');
  await p.waitForTimeout(1200);
  const s1 = await p.evaluate(() => ({ vi: gameState.visitorIndex, name: gameState.activeVisitor.name, total: gameState.totalVisits }));
  ok(s1.vi === 0, `«Открыть двери» ×2: visitorIndex ${s1.vi}, вошёл ${s1.name}`);

  // 2. «Следующий посетитель» двойным кликом
  await waitChoices(p);
  await p.click('.scene-choice >> nth=0');
  await waitContinue(p);
  await p.click('#btn-scene-continue');
  await p.waitForSelector('.wh-plate-num');
  await p.evaluate(() => { const code = gameState.activeVisitor.orderCode; [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + code).click(); scanStart(); });
  await p.waitForSelector('#screen-result.active');
  await p.dblclick('#btn-next-customer');
  await p.waitForTimeout(1200);
  const s2 = await p.evaluate(() => ({ vi: gameState.visitorIndex, total: gameState.totalVisits }));
  ok(s2.vi === 1, `«Следующий посетитель» ×2: visitorIndex ${s2.vi} (ожидался 1)`);

  // 3. покупка в магазине двойным кликом
  await p.evaluate(() => { gameState.day = 6; gameState._lastExpenseDay = 5; gameState.warehouseCapacity = 3; gameState.money = 2000; showDayEnd(); openShopScreen(); });
  await p.waitForTimeout(300);
  const m0 = await p.evaluate(() => gameState.money);
  await p.dblclick('#shop-grid .shop-buy-btn >> nth=0');
  const m1 = await p.evaluate(() => ({ money: gameState.money, cap: gameState.warehouseCapacity }));
  ok(m0 - m1.money === 450 && m1.cap === 6, `стеллаж ×2: списано ${m0 - m1.money} ₽, склад ${m1.cap}`);
  await p.click('.shop-tab-pill[data-tab="daily"]');
  const m2 = await p.evaluate(() => gameState.money);
  await p.dblclick('#shop-grid .shop-card:nth-child(4) .shop-buy-btn'); // кофе
  const m3 = await p.evaluate(() => gameState.money);
  ok(m2 - m3 === 60, `кофе ×2: списано ${m2 - m3} ₽`);

  // 4. «Начать рабочий день» ×2 и ещё раз во время рекламы
  const ads0 = await p.evaluate(() => __ygMock.events.filter((e) => e.name === 'adv:fullscreen').length);
  await p.dblclick('#screen-shop .shop-bottom-actions .action-btn');
  await p.waitForTimeout(80);
  await p.evaluate(() => YG.startNewDay()); // «клик» сквозь рекламу
  await p.waitForTimeout(900);
  const s4 = await p.evaluate(() => ({ ads: __ygMock.events.filter((e) => e.name === 'adv:fullscreen').length, day: gameState.day, running: acceptance && acceptance.running, coffeeUsed: acceptance.duration }));
  ok(s4.ads - ads0 === 1 && s4.running, `«Начать день» ×3: показов рекламы ${s4.ads - ads0}, приёмка идёт, длительность ${s4.coffeeUsed} с`);
  if (p._errors.length) info('ошибки консоли: ' + p._errors.join(' | '));
} finally {
  await browser.close();
}
