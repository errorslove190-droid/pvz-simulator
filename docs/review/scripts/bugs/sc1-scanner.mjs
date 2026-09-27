// SC1. Сканер ШК.
//  a) Неверная коробка отсканирована → через 1,2 с срабатывает closeScan() из setTimeout.
//     Если игрок за это время нажал «Отмена», открыл нужную коробку и держит ШК —
//     старый таймер закрывает новый скан посреди удержания.
//  b) Контроль: удержание пальцем (pointer+touch+compat mouse одновременно) — скан проходит;
//     короткий тап не оставляет «висящего» таймера.
import { launch, newGame, skipGuides, playAcceptance, waitChoices, waitContinue, bug, ok, info } from './lib.mjs';

const browser = await launch();

async function toWarehouse(p) {
  await skipGuides(p);
  await p.evaluate(() => {
    gameState.day = 5; gameState.money = 1000; gameState.warehouseCapacity = 6;
    gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
    startAcceptance();
    gameState.todayScandal = null; gameState.todayBomzh = null;
    gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
  });
  await playAcceptance(p);
  await p.click('#btn-summary-continue');
  await waitChoices(p);
  await p.click('.scene-choice >> nth=0');
  await waitContinue(p);
  await p.click('#btn-scene-continue');
  await p.waitForSelector('.wh-plate-num');
  await p.waitForTimeout(400);
}

try {
  {
    console.log('a) мышь: неверный скан → «Отмена» → нужная коробка, держим ШК');
    const p = await newGame(browser, { mobile: false });
    await toWarehouse(p);
    const codes = await p.evaluate(() => ({ target: '#' + gameState.activeVisitor.orderCode, other: [...document.querySelectorAll('.wh-plate-num')].map((n) => n.textContent).find((t) => t !== '#' + gameState.activeVisitor.orderCode) }));
    info(`нужная ${codes.target}, чужая ${codes.other}`);
    await p.click(`.wh-plate-num:text-is("${codes.other}")`);
    const bc = await p.locator('#scan-bc-wrap').boundingBox();
    await p.mouse.move(bc.x + bc.width / 2, bc.y + bc.height / 2);
    await p.mouse.down();
    await p.waitForFunction(() => scanState && scanState.done, null, { timeout: 5000 });
    await p.mouse.up();
    const hint1 = await p.evaluate(() => document.getElementById('scan-hint').textContent);
    await p.click('.scan-cancel');
    await p.click(`.wh-plate-num:text-is("${codes.target}")`);
    await p.mouse.move(bc.x + bc.width / 2, bc.y + bc.height / 2);
    await p.mouse.down();
    const t0 = Date.now();
    let closedAt = null, lastProgress = 0;
    for (let i = 0; i < 30; i++) {
      const s = await p.evaluate(() => ({ open: document.getElementById('scan-overlay').classList.contains('show'), progress: scanState ? Math.round(scanState.progress) : null, scr: document.querySelector('.screen-card.active').id }));
      if (s.open && s.progress != null) lastProgress = s.progress;
      if (!s.open && closedAt === null) { closedAt = Date.now() - t0; }
      await p.waitForTimeout(100);
    }
    await p.mouse.up();
    const end = await p.evaluate(() => ({ open: document.getElementById('scan-overlay').classList.contains('show'), scr: document.querySelector('.screen-card.active').id }));
    info(`«${hint1}»; держим нужную: окно закрылось через ${closedAt} мс при прогрессе ${lastProgress} %, игрок всё ещё держит палец; итог: экран ${end.scr}`);
    bug(closedAt !== null && lastProgress < 100 && end.scr === 'screen-warehouse', 'таймер закрытия прошлого (неверного) скана закрыл новый скан посреди удержания');
    await p.context().close();
  }
  {
    console.log('b) тач: удержание 2 с и короткий тап (CDP touch → pointer+touch+mouse обработчики)');
    const p = await newGame(browser, { mobile: true });
    await toWarehouse(p);
    const cdp = await p.context().newCDPSession(p);
    const target = await p.evaluate(() => '#' + gameState.activeVisitor.orderCode);
    await p.tap(`.wh-plate-num:text-is("${target}")`);
    const bc = await p.locator('#scan-bc-wrap').boundingBox();
    const pt = [{ x: bc.x + bc.width / 2, y: bc.y + bc.height / 2 }];
    // короткий тап
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await p.waitForTimeout(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(600);
    const tap = await p.evaluate(() => ({ timer: !!(scanState && scanState.timer), progress: scanState && scanState.progress }));
    // удержание
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await p.waitForTimeout(2200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(1200);
    const scr = await p.evaluate(() => document.querySelector('.screen-card.active').id);
    info(`после тапа: таймер скана ${tap.timer}, прогресс ${tap.progress}; после удержания — экран ${scr}`);
    ok(!tap.timer && tap.progress === 0 && scr === 'screen-result', 'тап не оставляет висящего скана, удержание пальцем выдаёт заказ');
    await p.context().close();
  }
} finally {
  await browser.close();
}
