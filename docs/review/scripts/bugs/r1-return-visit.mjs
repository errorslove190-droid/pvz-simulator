// R1. «Приду завтра» после «Отказать → Стоять на своём» (registerReturnVisit).
// Ожидаемо: коробка ждёт клиента на полке, завтра он её забирает.
// Проверяем: (1) коробка сегодня же становится «излишком»; (2) завтра тот же заказ
// снова приходит в накладной как обязательный ДОЛГ → на складе две коробки с одним
// номером; (3) клиента встречают как должника: «Вчера вы лично пообещали…», выдача даёт
// «сдержал обещание +0.10 ⭐»; (4) если новую коробку не приняли — «нарушенное обещание»
// с выбором «обещать ещё раз / принять гнев −0.50 ⭐», хотя обещал не сотрудник, а клиент.
import { launch, newGame, skipGuides, playAcceptance, playCustomers, waitChoices, waitContinue, state, bug, info } from './lib.mjs';

const browser = await launch();

async function refuseHardFirstVisitor(p) {
  // день 5, склад 6 мест; первый посетитель — тот, у кого в концовках есть «завтра»
  await skipGuides(p);
  const who = await p.evaluate(() => {
    gameState.day = 5; gameState.money = 1000; gameState.warehouseCapacity = 6; gameState.rating = 3.5;
    gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
    for (let k = 0; k < 200; k++) {
      startAcceptance();
      const v = gameState.todayVisitorRoster[0].visitor;
      if ((v.hardEnds || []).some((e) => RETURN_PROMISE_RE.test(e.v))) break;
    }
    gameState.todayScandal = null; gameState.todayBomzh = null;
    gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
    const v = gameState.todayVisitorRoster[0].visitor;
    // из случайных концовок оставляем те, где клиент обещает вернуться (они есть в данных игры)
    v.hardEnds = v.hardEnds.filter((e) => RETURN_PROMISE_RE.test(e.v));
    return { name: v.name, code: gameState.todayVisitorRoster[0].orderCode };
  });
  await playAcceptance(p);
  await p.click('#btn-summary-continue');
  await waitChoices(p);
  await p.click('.scene-choice >> nth=2'); // «Отказать без объяснений»
  await waitChoices(p);
  await p.click('.scene-choice >> nth=0'); // «Стоять на своём»
  await waitContinue(p);
  const said = await p.evaluate(() => [...document.querySelectorAll('#scene-text .scene-line')].map((x) => x.textContent).join(' | '));
  await p.click('#btn-scene-continue'); // «Завершить визит»
  await p.waitForTimeout(200);
  return { ...who, said };
}

try {
  {
    console.log('1. Клиент уходит со словами «приду завтра»; завтра его коробку приняли');
    const p = await newGame(browser, { mobile: false });
    const w = await refuseHardFirstVisitor(p);
    info(`посетитель ${w.name}, заказ #${w.code}; диалог: ${w.said.slice(0, 220)}…`);
    const s1 = await p.evaluate(() => ({ shelf: gameState.shelfParcels.map((x) => x.code + ':' + (x.status || 'normal')), debts: JSON.stringify(gameState.promisedDebts) }));
    info(`после визита: склад [${s1.shelf.join(', ')}]; обещания на завтра ${s1.debts}`);
    bug(s1.shelf.includes(w.code + ':surplus'), `коробка #${w.code} сразу стала «излишком», хотя клиент за ней вернётся`);
    await playCustomers(p);
    await p.evaluate(() => YG.startNewDay());
    await p.waitForTimeout(900);
    await p.evaluate(() => { gameState.todayScandal = null; gameState.todayBomzh = null; gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0); });
    const inv = await p.evaluate(() => acceptance.invoice.map((x) => x.code + (x.isDebt ? ':ДОЛГ' : '')));
    info(`накладная нового дня: [${inv.join(', ')}]`);
    await playAcceptance(p);
    const s2 = await p.evaluate(() => gameState.shelfParcels.map((x) => x.code + ':' + (x.status || 'normal') + (x.isDebt ? ':долг' : '')));
    info(`склад после приёмки: [${s2.join(', ')}]`);
    bug(inv.includes(w.code + ':ДОЛГ') && s2.filter((x) => x.startsWith(w.code + ':')).length === 2,
      `на складе две коробки #${w.code}: старая «излишек» (курьер возьмёт 50 ₽) и новая «долг»`);
    await p.click('#btn-summary-continue');
    await p.waitForTimeout(300);
    const intro = await p.evaluate(() => { tapScene(); return [...document.querySelectorAll('#scene-text .scene-line')].map((x) => x.textContent).join(' | '); });
    info(`вход клиента: ${intro.slice(0, 260)}`);
    await waitChoices(p);
    const before = await state(p);
    await p.click('.scene-choice >> nth=0'); // «Да, вот он! Всё как обещал»
    await waitContinue(p);
    await p.click('#btn-scene-continue');
    await p.waitForSelector('.wh-plate-num');
    await p.evaluate((code) => { [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + code).click(); scanStart(); }, w.code);
    await p.waitForSelector('#screen-result.active', { timeout: 8000 });
    const res = await p.evaluate(() => ({ badge: document.getElementById('result-badge').textContent, tags: document.getElementById('result-tags-row').textContent, rating: gameState.rating }));
    info(`итог визита: «${res.badge}», ${res.tags}; рейтинг ${before.rating} → ${res.rating}`);
    bug(/Вчера вы лично пообещали/.test(intro) && /сдержал обещание/.test(res.tags),
      'выставленного клиента встречают как должника («вы лично пообещали») и дают +0.10 ⭐ «сдержал обещание»');
    await p.context().close();
  }
  {
    console.log('2. То же, но завтра его коробку не приняли (склад/спешка)');
    const p = await newGame(browser, { mobile: false });
    const w = await refuseHardFirstVisitor(p);
    await playCustomers(p);
    await p.evaluate(() => YG.startNewDay());
    await p.waitForTimeout(900);
    await p.evaluate((code) => {
      gameState.todayScandal = null; gameState.todayBomzh = null; gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
      // коробку-долг «не успели» принять: помечаем её рассортированной без приёма на склад
      acceptance.invoice.filter((x) => x.code === code).forEach((x) => { x.sorted = true; });
    }, w.code);
    await playAcceptance(p);
    await p.click('#btn-summary-continue');
    await waitChoices(p);
    await p.click('.scene-choice >> nth=0'); // «Да, вот он!» → коробки нет
    await waitChoices(p);
    const txt = await p.evaluate(() => [...document.querySelectorAll('#scene-text .scene-line')].map((x) => x.textContent).join(' | '));
    const labels = await p.evaluate(() => [...document.querySelectorAll('.scene-choice')].map((b) => b.textContent.trim()));
    info(`сцена: ${txt.slice(0, 240)}…`);
    info(`варианты: ${labels.join(' / ')}`);
    const before = await state(p);
    await p.click('.scene-choice >> nth=1'); // «Принять гнев клиента (−0.50⭐)»
    await waitContinue(p);
    await p.click('#btn-scene-continue');
    await p.waitForTimeout(300);
    const after = await state(p);
    info(`рейтинг ${before.rating} → ${after.rating}`);
    bug(/обещали/.test(txt) && Math.abs(before.rating - after.rating - 0.5) < 0.001,
      'за «нарушенное обещание», которого сотрудник не давал, снимают −0.50 ⭐');
    await p.context().close();
  }
} finally {
  await browser.close();
}
