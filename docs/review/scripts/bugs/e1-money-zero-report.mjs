// E1. Деньги у нуля: finishAcceptance прибавляет к «валовой» полный минус приёмки,
// а баланс обрезает до 0. Отчёт смены показывает «+-100 ₽» и «чистую прибыль»,
// которая не совпадает с изменением баланса.
import { launch, newGame, skipGuides, playAcceptance, waitChoices, waitContinue, bug, info } from './lib.mjs';

const browser = await launch();

async function badAcceptance(p, money, { sortInvoice, errors }) {
  await skipGuides(p);
  await p.evaluate((money) => {
    gameState.day = 5; gameState.money = money; gameState._lastExpenseDay = 4; gameState._dailyResetDay = 4;
    gameState.warehouseCapacity = 6; gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
    gameState.daily = { coffee: false, wrap: false, gloves: false, candy: false, promo: false };
    startAcceptance();
    acceptance.duration = 600;
    gameState.todayScandal = null; gameState.todayBomzh = null;
    gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
  }, money);
  let made = 0;
  for (let i = 0; i < 200; i++) {
    const r = await p.evaluate(({ sortInvoice, errors, made }) => {
      const c = acceptance.current;
      if (!c || c.sorted) return 'wait';
      const invLeft = acceptance.invoice.some((x) => !x.sorted);
      if (sortInvoice && invLeft && c.expected === 'ours') { onSort('ours'); return 'ok'; }
      if (made < errors && c.expected !== 'ours') { onSort(c.expected === 'broken' ? 'others' : 'broken'); return 'err'; }
      if (made >= errors && (!sortInvoice || !invLeft)) { endAcceptanceNow(); return 'end'; }
      if (c.expected === 'ours') { onSort('others'); return 'err'; } // ошибка на «своей» тоже −25
      onSort(c.expected); return 'ok';
    }, { sortInvoice, errors, made });
    if (r === 'err') made++;
    if (r === 'end') break;
    await p.waitForTimeout(r === 'wait' ? 120 : 520);
  }
  return p.evaluate(() => ({ money: gameState.money, gross: gameState.dayGrossIncome, penalty: acceptance.stats.penalty, bonus: acceptance.stats.bonus }));
}

async function playDay(p, mode) {
  // mode 'refuse': всем отказать (без выручки); 'give': всем выдать
  for (let i = 0; i < 400; i++) {
    const r = await p.evaluate((mode) => {
      const act = document.querySelector('.screen-card.active').id;
      if (act === 'screen-dayend') return 'dayend';
      if (act === 'screen-morning') { document.getElementById('btn-summary-continue').click(); return 'doors'; }
      if (act === 'screen-scene') {
        if (sceneQueue.length) { tapScene(); return 'tap'; }
        const cont = document.querySelector('#btn-scene-continue:not([disabled])');
        if (cont) { cont.click(); return 'continue'; }
        const ch = [...document.querySelectorAll('.scene-choice:not(.disabled):not([disabled])')];
        if (ch.length) { (mode === 'refuse' ? (ch.length === 3 ? ch[2] : ch[0]) : ch[0]).click(); return 'choice'; }
        return 'wait';
      }
      if (act === 'screen-warehouse') {
        if (document.getElementById('scan-overlay').classList.contains('show')) return 'scanning';
        const code = gameState.activeVisitor.orderCode;
        const plate = [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + code);
        if (plate) { plate.click(); scanStart(); return 'scan'; }
        const lost = document.querySelector('.refuse-btn'); if (lost) { lost.click(); return 'lost'; }
        return 'wait';
      }
      if (act === 'screen-result') { const b = document.getElementById('btn-next-customer'); if (!b.disabled) b.click(); return 'next'; }
      return act;
    }, mode);
    if (r === 'dayend') return;
    await p.waitForTimeout(r === 'scan' ? 1500 : 350);
  }
}
const report = (p) => p.evaluate(() => ({
  gross: document.getElementById('dayend-gross').textContent, exp: document.getElementById('dayend-expenses').textContent,
  net: document.getElementById('dayend-net').textContent, money: document.getElementById('dayend-money').textContent, bal: gameState.money,
}));

try {
  {
    console.log('a) баланс 30 ₽, приёмка: 5 ошибок и сразу «завершить», всем посетителям отказ');
    const p = await newGame(browser, { mobile: true });
    const acc = await badAcceptance(p, 30, { sortInvoice: false, errors: 5 });
    info(`после приёмки: бонусы +${acc.bonus}, штрафы −${acc.penalty}; баланс 30 → ${acc.money} ₽, валовая ${acc.gross} ₽`);
    await playDay(p, 'refuse');
    const r = await report(p);
    info(`отчёт: валовая «${r.gross}», расходы «${r.exp}», чистая «${r.net}», баланс «${r.money}»`);
    await p.screenshot({ path: 'work/bugs/e1-dayend-negative.png' });
    bug(/^\+-/.test(r.gross), `валовая показана как «${r.gross}» (плюс перед минусом)`);
    bug(r.bal === 0 && parseInt(r.net.replace(/[^\d-]/g, ''), 10) < -30, `чистая прибыль ${r.net}, хотя баланс уменьшился всего на 30 ₽ (30 → 0)`);
    await p.context().close();
  }
  {
    console.log('b) баланс 30 ₽, приёмка: накладная собрана + 8 ошибок, всем посетителям выдача');
    const p = await newGame(browser, { mobile: true });
    const acc = await badAcceptance(p, 30, { sortInvoice: true, errors: 8 });
    info(`после приёмки: бонусы +${acc.bonus}, штрафы −${acc.penalty}; баланс 30 → ${acc.money} ₽, валовая ${acc.gross} ₽`);
    await playDay(p, 'give');
    const r = await report(p);
    const net = parseInt(r.net.replace(/[^\d-]/g, ''), 10);
    info(`отчёт: валовая «${r.gross}», расходы «${r.exp}», чистая «${r.net}», баланс «${r.money}» (изменение за день ${r.bal - 30} ₽)`);
    bug(net !== r.bal - 30, `чистая прибыль ${net} ₽ ≠ изменение баланса ${r.bal - 30} ₽`);
    await p.context().close();
  }
} finally {
  await browser.close();
}
