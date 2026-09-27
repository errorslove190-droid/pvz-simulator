// RS1. Перезапуск в разных фазах + старые сейвы.
//  1) отчёт смены; 2) магазин после покупок; 3) курьер после оплаты; 4) скандал после выбора;
//  5) бомж после выбора; 6) «заказ не найден» после «обещать к завтра»;
//  7) «аварийный вывоз» после трат в магазине (кнопка «Назад к отчёту» и перезапуск);
//  8) старые сейвы без новых полей (lastExpenseDay; visitorCount/ростер).
import { launch, newGame, reopen, skipGuides, playAcceptance, waitChoices, waitContinue, state, ok, bug, info } from './lib.mjs';

const browser = await launch();
const report = (p) => p.evaluate(() => ['dayend-gross', 'dayend-expenses', 'dayend-courier', 'dayend-net', 'dayend-purchases', 'dayend-money'].map((id) => document.getElementById(id).textContent).join(' | '));

async function dayWithForced(p, { day = 5, money = 1000, capacity = 6, force = null, dropFirst = false }) {
  await skipGuides(p);
  await p.evaluate(({ day, money, capacity, force }) => {
    gameState.day = day; gameState.money = money; gameState.warehouseCapacity = capacity; gameState.rating = 3.5;
    gameState._lastExpenseDay = day - 1; gameState._dailyResetDay = day - 1;
    gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = []; gameState.debtAttempts = {};
    startAcceptance();
    gameState.todayScandal = null; gameState.todayBomzh = null;
    gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
    if (force === 'scandal') { gameState.todayScandal = { type: SCANDAL_TYPES.find((t) => t.id === 'damaged_box'), visitor: VISITORS[4], pos: 0, done: false }; gameState.visitorCount++; }
    if (force === 'bomzh') { gameState.todayBomzh = { visitor: VISITOR_BOMZH, pos: 0, done: false, stolen: null }; gameState.visitorCount++; gameState.daily.candy = true; }
  }, { day, money, capacity, force });
  await playAcceptance(p);
  if (dropFirst) await p.evaluate(() => { const code = gameState.todayVisitorRoster[0].orderCode; gameState.shelfParcels = gameState.shelfParcels.filter((x) => x.code !== code); });
  await p.click('#btn-summary-continue');
}

async function finishDay(p) {
  // быстрый конец смены через настоящие функции (все оставшиеся — «выставить»)
  for (let i = 0; i < 300; i++) {
    const r = await p.evaluate(() => {
      const act = document.querySelector('.screen-card.active').id;
      if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'g'; }
      if (act === 'screen-dayend') return 'dayend';
      if (act === 'screen-scene') {
        if (sceneQueue.length) { tapScene(); return 'tap'; }
        const cont = document.querySelector('#btn-scene-continue:not([disabled])'); if (cont) { cont.click(); return 'c'; }
        const ch = [...document.querySelectorAll('.scene-choice:not(.disabled):not([disabled])')]; if (ch.length) { (ch[2] || ch[0]).click(); return 'ch'; }
        return 'w';
      }
      if (act === 'screen-warehouse') { const b = document.querySelector('.refuse-btn'); if (b) b.click(); return 'wh'; }
      if (act === 'screen-result') { const b = document.getElementById('btn-next-customer'); if (!b.disabled) b.click(); return 'n'; }
      return act;
    });
    if (r === 'dayend') return;
    await p.waitForTimeout(300);
  }
  throw new Error('день не закончился');
}

try {
  { // 1. отчёт смены
    console.log('1. Перезапуск на отчёте смены');
    const p = await newGame(browser);
    await dayWithForced(p, {});
    await finishDay(p);
    const r1 = await report(p); const s1 = await state(p);
    await reopen(p);
    const r2 = await report(p); const s2 = await state(p);
    info(`до: ${r1}\n      после: ${r2}`);
    ok(s2.screen === 'screen-dayend' && s1.money === s2.money && r1 === r2, `экран ${s2.screen}, баланс ${s1.money} → ${s2.money}, отчёт тот же`);
    await p.context().close();
  }
  { // 2. магазин после покупок
    console.log('2. Перезапуск в магазине после покупок');
    const p = await newGame(browser);
    await dayWithForced(p, { capacity: 3 });
    await finishDay(p);
    await p.evaluate(() => { gameState.money = 1000; openShopScreen(); });
    await p.click('#shop-grid .shop-buy-btn >> nth=0'); // стеллаж 450
    await p.click('.shop-tab-pill[data-tab="daily"]');
    await p.click('#shop-grid .shop-card:nth-child(4) .shop-buy-btn'); // кофе 60
    const s1 = await p.evaluate(() => ({ money: gameState.money, cap: gameState.warehouseCapacity, coffee: gameState.daily.coffee, spend: gameState.dayShopSpend }));
    await reopen(p);
    const s2 = await p.evaluate(() => ({ scr: document.querySelector('.screen-card.active').id, money: gameState.money, cap: gameState.warehouseCapacity, coffee: gameState.daily.coffee, spend: gameState.dayShopSpend, purch: document.getElementById('dayend-purchases').textContent }));
    info(`до: ${JSON.stringify(s1)}\n      после: ${JSON.stringify(s2)}`);
    ok(s2.scr === 'screen-shop' && s2.money === s1.money && s2.cap === 6 && s2.coffee && s2.spend === 510, 'магазин, баланс, стеллаж, кофе и «покупки» на месте');
    await p.context().close();
  }
  { // 3. курьер после оплаты
    console.log('3. Перезапуск у курьера после оплаты вывоза');
    const p = await newGame(browser);
    await skipGuides(p);
    await p.evaluate(() => {
      // фоновая приёмка первого дня новой игры: в настоящем потоке к курьеру она уже закончена
      if (acceptance) { clearInterval(acceptance._timer); clearTimeout(acceptance._nextBoxTimeout); acceptance.running = false; }
      gameState.day = 7; gameState.money = 1000; gameState._lastExpenseDay = 6; gameState.dayGrossIncome = 300;
      const mk = (code, status) => ({ code, sprite: PARCEL_SPRITES[0], spriteIdx: 0, status, isBroken: status === 'broken' });
      gameState.shelfParcels = [mk('4829', 'surplus'), mk('7721', 'broken')];
      gameState.courierVisitedToday = true; startCourierScene();
    });
    await waitChoices(p);
    await p.click('.scene-choice >> nth=0');
    await p.waitForTimeout(300);
    const m1 = await p.evaluate(() => gameState.money);
    await reopen(p);
    await waitChoices(p);
    const s2 = await p.evaluate(() => ({ money: gameState.money, dead: gameState.shelfParcels.length, text: document.getElementById('scene-text').textContent.slice(0, 80) }));
    await p.click('.scene-choice >> nth=0');
    await waitContinue(p);
    await p.click('#btn-scene-continue');
    await p.waitForTimeout(300);
    const r = await report(p);
    info(`после оплаты ${m1} ₽; после перезапуска ${s2.money} ₽, груз ${s2.dead}, курьер: «${s2.text}…»; отчёт: ${r}`);
    ok(s2.money === m1 && s2.dead === 0 && /-100 ₽/.test(r), 'повторно не списано, в отчёте вывоз −100 ₽');
    await p.context().close();
  }
  { // 4. скандал после выбора
    console.log('4. Перезапуск посреди скандала (выбор сделан, «Закончить скандал» не нажат)');
    const p = await newGame(browser);
    await dayWithForced(p, { force: 'scandal' });
    await waitChoices(p);
    const b = await state(p);
    await p.click('.scene-choice >> nth=0'); // −0.06, −10
    await waitContinue(p);
    await reopen(p);
    const a = await state(p);
    const again = await p.evaluate(() => document.getElementById('scene-name').textContent);
    info(`до выбора ${b.rating}/${b.money} ₽; после перезапуска ${a.rating}/${a.money} ₽; на сцене: ${again}`);
    ok(a.rating === b.rating && a.money === b.money && /скандалист/.test(again), 'скандал переигрывается с исходного состояния');
    await p.context().close();
  }
  { // 5. бомж после выбора
    console.log('5. Перезапуск посреди визита бомжа');
    const p = await newGame(browser);
    await dayWithForced(p, { force: 'bomzh' });
    await waitChoices(p);
    const b = await state(p);
    await p.click('.scene-choice >> nth=2'); // выгнать: −0.15
    await waitContinue(p);
    await reopen(p);
    const a = await state(p);
    const again = await p.evaluate(() => ({ n: document.getElementById('scene-name').textContent, candy: gameState.daily.candy }));
    info(`до ${b.rating}; после перезапуска ${a.rating}; на сцене: ${again.n}; конфеты: ${again.candy}`);
    ok(a.rating === b.rating && /Федор/.test(again.n) && again.candy, 'бомж переигрывается, кража отменена вместе с шагом');
    await p.context().close();
  }
  { // 6. заказ не найден
    console.log('6. Перезапуск в сцене «заказ не найден» после «обещать к завтра»');
    const p = await newGame(browser);
    await dayWithForced(p, { dropFirst: true });
    await waitChoices(p);
    const first = await p.evaluate(() => gameState.activeVisitor.name);
    await p.click('.scene-choice >> nth=0');
    await waitContinue(p); await p.click('#btn-scene-continue');
    await p.waitForSelector('.refuse-btn'); await p.click('.refuse-btn');
    await waitChoices(p);
    await p.click('.scene-choice >> nth=0'); // извиниться и обещать
    await waitContinue(p);
    const mid = await p.evaluate(() => ({ promised: gameState.promisedDebts.length, att: JSON.stringify(gameState.debtAttempts) }));
    await reopen(p);
    const a = await p.evaluate(() => ({ name: gameState.activeVisitor && gameState.activeVisitor.name, promised: gameState.promisedDebts.length, att: JSON.stringify(gameState.debtAttempts) }));
    info(`до перезапуска: обещаний ${mid.promised}, попытки ${mid.att}; после: посетитель ${a.name} (был ${first}), обещаний ${a.promised}, попытки ${a.att}`);
    ok(a.name === first && a.promised === 0 && a.att === '{}', 'тот же посетитель, обещание не задвоилось');
    await p.context().close();
  }
  { // 7. аварийный вывоз
    console.log('7. «Аварийный вывоз» после трат в магазине');
    const p = await newGame(browser);
    await skipGuides(p);
    await p.evaluate(() => {
      gameState.day = 6; gameState.money = 200; gameState.warehouseCapacity = 3; gameState._lastExpenseDay = 5; gameState._dailyResetDay = 5;
      const mk = (code) => ({ code, sprite: PARCEL_SPRITES[0], spriteIdx: 0, status: 'surplus', isBroken: false });
      gameState.shelfParcels = [mk('4829'), mk('7721'), mk('9015')];
      showDayEnd(); openShopScreen();
    });
    const before = await p.evaluate(() => ({ money: gameState.money, dead: gameState.shelfParcels.length, courier: [...document.querySelectorAll('#shop-grid .shop-card')].find((c) => /Экстренный/.test(c.textContent)).querySelector('.shop-buy-btn').textContent.trim() }));
    await p.click('.shop-tab-pill[data-tab="daily"]');
    await p.click('#shop-grid .shop-card:nth-child(1) .shop-buy-btn'); // пакеты 75
    await p.click('#shop-grid .shop-card:nth-child(4) .shop-buy-btn'); // кофе 60
    await p.click('#shop-grid .shop-card:nth-child(3) .shop-buy-btn'); // конфеты 52 → 13 ₽
    await p.click('text=Назад к отчёту дня');
    const after = await p.evaluate(() => ({ money: gameState.money, dead: gameState.shelfParcels.length, toast: document.getElementById('toast').textContent }));
    info(`на конце дня: ${before.money} ₽, мёртвого груза ${before.dead}, экстренный курьер «${before.courier}»; после покупок и «Назад к отчёту»: ${after.money} ₽, груза ${after.dead}, тост «${after.toast}»`);
    bug(before.dead === 3 && after.dead === 0 && /Аварийный вывоз/.test(after.toast), 'потратил деньги ниже 60 ₽ → «Назад к отчёту дня» → весь мёртвый груз вывезен бесплатно');
    await p.context().close();
  }
  { // 8. старые сейвы
    console.log('8. Старые сейвы без новых полей');
    const old1 = { v: 1, t: Date.now(), phase: 'dayend', day: 9, money: 500, rating: 3.6, warehouseCapacity: 6, upg: { routine: 0, scanner: 0 }, expansion: { rack1: true, rack2: false, cctv: false }, daily: { coffee: false, wrap: false, gloves: false, candy: false, promo: false }, tutorialShown: true, dayGross: 300, shelfParcels: [] };
    const p = await newGame(browser, { keepStorage: { pvz_sim_save_v1: JSON.stringify(old1) } });
    const s = await p.evaluate(() => ({ scr: document.querySelector('.screen-card.active').id, money: gameState.money, exp: document.getElementById('dayend-expenses').textContent }));
    await reopen(p);
    const s2 = await p.evaluate(() => gameState.money);
    info(`сейв без lastExpenseDay (фаза dayend, 500 ₽): экран ${s.scr}, баланс ${s.money} ₽ (${s.exp}); после ещё одного перезапуска ${s2} ₽`);
    bug(s.scr === 'screen-dayend' && s.money === 350, 'аренда за уже закрытый день списана повторно при первой загрузке старого сейва');
    const old2 = { ...old1, phase: 'customers', t: Date.now() + 5, shelfParcels: [{ code: '4829', spriteIdx: 1, status: null }, { code: '7721', spriteIdx: 2, status: null }] };
    const q = await newGame(browser, { keepStorage: { pvz_sim_save_v1: JSON.stringify(old2) } });
    const t = await q.evaluate(() => ({ scr: document.querySelector('.screen-card.active').id, v: gameState.activeVisitor && gameState.activeVisitor.name, vc: gameState.visitorCount }));
    info(`сейв без visitorCount/ростера (фаза customers): экран ${t.scr}, посетитель ${t.v}, visitorCount ${t.vc}`);
    ok(q._errors.length === 0 && p._errors.length === 0, 'ошибок в консоли нет' + (q._errors.length + p._errors.length ? ': ' + [...p._errors, ...q._errors].slice(0, 2).join(' | ') : ''));
    await p.context().close(); await q.context().close();
  }
} finally {
  await browser.close();
}
