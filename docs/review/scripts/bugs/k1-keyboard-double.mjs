// K1. Клавиатура: после клика мышью по варианту выбора кнопка остаётся в фокусе;
// класс .disabled гасит только указатель (pointer-events), а Enter/Пробел жмут её ещё раз.
// Проверяем четыре обработчика без защиты от повтора: скандал, «извиниться и обещать»,
// курьер «сдать груз», бомж.
import { launch, newGame, skipGuides, playAcceptance, waitChoices, waitContinue, state, bug, info } from './lib.mjs';

const browser = await launch();

async function setupDay(p, { day = 5, money = 1000, force }) {
  await skipGuides(p);
  await p.evaluate(({ day, money, force }) => {
    gameState.day = day; gameState.money = money; gameState.rating = 3.5;
    gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
    startAcceptance();
    const regular = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
    gameState.todayScandal = null; gameState.todayBomzh = null; gameState.visitorCount = regular;
    if (force === 'scandal') {
      gameState.todayScandal = { type: SCANDAL_TYPES.find((t) => t.id === 'damaged_box'), visitor: VISITORS[0], pos: 0, done: false };
      gameState.visitorCount += 1;
    }
    if (force === 'bomzh') {
      gameState.todayBomzh = { visitor: VISITOR_BOMZH, pos: 0, done: false, stolen: null };
      gameState.visitorCount += 1;
    }
  }, { day, money, force });
  await playAcceptance(p);
}

try {
  // --- 1. Скандал «помятая коробка»: вариант «пакет» = −0.06 ⭐ и −10 ₽
  {
    console.log('1. Скандал: клик мышью по варианту + Enter');
    const p = await newGame(browser, { mobile: false });
    await setupDay(p, { force: 'scandal' });
    await p.click('#btn-summary-continue');
    await waitChoices(p);
    const before = await state(p);
    await p.click('.scene-choice >> nth=0'); // «Бесплатно упаковать в фирменный пакет»: −0.06 ⭐, −10 ₽
    const focused = await p.evaluate(() => document.activeElement && document.activeElement.className);
    await p.keyboard.press('Enter');
    await waitContinue(p);
    const after = await state(p);
    info(`фокус после клика: ${focused}`);
    info(`рейтинг ${before.rating} → ${after.rating}, деньги ${before.money} → ${after.money}, dayOtherCost ${after.other}`);
    bug(Math.abs((before.rating - after.rating) - 0.12) < 0.001 && before.money - after.money === 20,
      'штраф скандала применён дважды: −0.12 ⭐ и −20 ₽ вместо −0.06 ⭐ и −10 ₽');
    await p.context().close();
  }

  // --- 2. «Заказ не найден» → «Извиниться и обещать к завтра» + Enter
  {
    console.log('2. Заказ не найден: «извиниться и обещать» + Enter');
    const p = await newGame(browser, { mobile: false });
    await setupDay(p, {});
    // убираем со склада коробку первого посетителя — его заказ «не принят»
    await p.evaluate(() => { const code = gameState.todayVisitorRoster[0].orderCode; gameState.shelfParcels = gameState.shelfParcels.filter((x) => x.code !== code); });
    await p.click('#btn-summary-continue');
    await waitChoices(p);
    await p.click('.scene-choice >> nth=0'); // «молча выдать»
    await waitContinue(p);
    await p.click('#btn-scene-continue'); // на склад
    await p.waitForSelector('.refuse-btn');
    await p.click('.refuse-btn'); // «Разобраться с клиентом»
    await waitChoices(p);
    const before = await state(p);
    await p.click('.scene-choice >> nth=0'); // «Извиниться и обещать найти к завтра»
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    const toasts = await p.evaluate(() => document.getElementById('toast').textContent);
    const mid = await p.evaluate(() => ({ attempts: JSON.stringify(gameState.debtAttempts), promised: gameState.promisedDebts.length }));
    await waitContinue(p);
    const after = await state(p);
    info(`debtAttempts ${mid.attempts}, обещаний в очереди ${mid.promised}, последний тост: «${toasts}»`);
    info(`деньги ${before.money} → ${after.money}, рейтинг ${before.rating} → ${after.rating}`);
    bug(/"\d+":2/.test(mid.attempts) && before.money - after.money === 10,
      'первое обещание засчитано как второе: неустойка −10 ₽ и −0.02 ⭐ за одно нажатие');
    await p.context().close();
  }

  // --- 3. Курьер возвратов: «Сдать весь мёртвый груз» + Enter
  {
    console.log('3. Курьер: «сдать груз» + Enter');
    const p = await newGame(browser, { mobile: false });
    await skipGuides(p);
    await p.evaluate(() => {
      gameState.day = 7; gameState.money = 1000;
      const mk = (code, status) => ({ code, sprite: PARCEL_SPRITES[0], spriteIdx: 0, status, isBroken: status === 'broken' });
      gameState.shelfParcels = [mk('4829', 'surplus'), mk('7721', 'broken')];
      gameState.courierVisitedToday = true;
      startCourierScene();
    });
    await waitChoices(p);
    const before = await state(p);
    await p.click('.scene-choice >> nth=0'); // «Сдать весь мёртвый груз (−100 ₽)»
    await p.keyboard.press('Enter');
    await waitContinue(p);
    const after = await state(p);
    info(`деньги ${before.money} → ${after.money}, dayCourierFee ${after.courier}`);
    bug(before.money - after.money === 200, 'за вывоз 2 коробок списано 200 ₽ вместо 100 ₽');
    await p.context().close();
  }

  // --- 4. Бомж: «Выгнать на мороз» (−0.15 ⭐) + Enter
  {
    console.log('4. Бомж: «выгнать» + Enter');
    const p = await newGame(browser, { mobile: false });
    await setupDay(p, { force: 'bomzh' });
    await p.click('#btn-summary-continue');
    await waitChoices(p);
    const before = await state(p);
    await p.click('.scene-choice >> nth=2');
    await p.keyboard.press('Enter');
    await waitContinue(p);
    const after = await state(p);
    info(`рейтинг ${before.rating} → ${after.rating}`);
    bug(Math.abs((before.rating - after.rating) - 0.30) < 0.001, 'штраф −0.15 ⭐ применён дважды (−0.30)');
    await p.context().close();
  }

  // --- 5. Контроль: мышью второй клик не проходит (pointer-events: none)
  {
    console.log('5. Контроль: двойной клик мышью по варианту скандала');
    const p = await newGame(browser, { mobile: false });
    await setupDay(p, { force: 'scandal' });
    await p.click('#btn-summary-continue');
    await waitChoices(p);
    const before = await state(p);
    await p.dblclick('.scene-choice >> nth=0');
    await waitContinue(p);
    const after = await state(p);
    info(`рейтинг ${before.rating} → ${after.rating}, деньги ${before.money} → ${after.money}`);
    console.log((Math.abs(before.rating - after.rating - 0.06) < 0.001 && before.money - after.money === 10) ? '  ✓ мышью — один раз (защита pointer-events работает)' : '  ✗ двойной клик мышью тоже проходит');
    await p.context().close();
  }
} finally {
  await browser.close();
}
