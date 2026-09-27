// W2. Склад на 9 мест (все 9 ячеек арта): 6 мёртвого груза + 3 заказа — всё ли видно,
// есть ли номер нужной коробки. И таймер 6 с от мёртвого груза клиента A, когда на складе
// уже клиент B.
import { launch, newGame, skipGuides, playAcceptance, waitChoices, waitContinue, ok, info } from './lib.mjs';

const browser = await launch();
try {
  const p = await newGame(browser, { mobile: true });
  await skipGuides(p);
  await p.evaluate(() => {
    gameState.day = 5; gameState.money = 1000; gameState.warehouseCapacity = 9;
    const mk = (code, st) => ({ code, sprite: PARCEL_SPRITES[2], spriteIdx: 2, status: st, isBroken: st === 'broken' });
    gameState.shelfParcels = [mk('4829', 'surplus'), mk('7721', 'broken'), mk('9015', 'surplus'), mk('3318', 'broken'), mk('6677', 'surplus'), mk('2204', 'surplus')];
    gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
    startAcceptance(); gameState.todayScandal = null; gameState.todayBomzh = null;
    gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
  });
  await playAcceptance(p);
  const acc = await p.evaluate(() => ({ shelf: gameState.shelfParcels.length, normal: gameState.shelfParcels.filter((x) => !x.status || x.status === 'normal').map((x) => x.code) }));
  await p.click('#btn-summary-continue');
  await waitChoices(p); await p.click('.scene-choice >> nth=0');
  await waitContinue(p); await p.click('#btn-scene-continue');
  await p.waitForSelector('.wh-box');
  const wh = await p.evaluate(() => ({
    boxes: document.querySelectorAll('.wh-box').length, plates: [...document.querySelectorAll('.wh-plate-num')].map((n) => n.textContent),
    target: '#' + gameState.activeVisitor.orderCode, hint: document.getElementById('warehouse-hint-feedback').textContent,
  }));
  info(`на складе ${acc.shelf} коробок (заказы ${acc.normal.join(', ')}); на полках нарисовано ${wh.boxes}, номера ${wh.plates.join(' ')}; ищем ${wh.target}; подсказка «${wh.hint}»`);
  ok(wh.boxes === acc.shelf && wh.plates.includes(wh.target), 'все 9 коробок на полках, номер нужной виден');
  await p.screenshot({ path: 'work/bugs/w2-warehouse-9.png' });

  // таймер 6 с: тап по мёртвому грузу у клиента A, быстро выдаём A и идём к B
  await p.tap('.wh-box.is-deadload >> nth=0');
  const t0 = Date.now();
  await p.evaluate(() => { const c = gameState.activeVisitor.orderCode; [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + c).click(); scanStart(); });
  await p.waitForSelector('#screen-result.active');
  await p.click('#btn-next-customer');
  await waitChoices(p); await p.click('.scene-choice >> nth=0');
  await waitContinue(p); await p.click('#btn-scene-continue');
  await p.waitForSelector('#screen-warehouse.active');
  const beforeT = Date.now() - t0;
  const hintB = await p.evaluate(() => document.getElementById('warehouse-hint-feedback').innerHTML);
  await p.waitForTimeout(Math.max(0, 6500 - beforeT));
  const hintB2 = await p.evaluate(() => document.getElementById('warehouse-hint-feedback').innerHTML);
  info(`клиент B на складе через ${beforeT} мс после тапа у A; подсказка до срабатывания таймера A: «${hintB.replace(/<[^>]+>/g, ' ').trim()}», после: «${hintB2.replace(/<[^>]+>/g, ' ').trim()}»`);
  ok(beforeT < 6000 && hintB === hintB2, 'таймер клиента A сработал у клиента B, но подсказку для B не испортил (проверяет текущего клиента)');
  if (p._errors.length) info('ошибки консоли: ' + p._errors.join(' | '));
} finally {
  await browser.close();
}
