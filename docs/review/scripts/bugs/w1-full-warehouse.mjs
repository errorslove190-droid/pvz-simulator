// W1. Склад заполнился во время приёмки, а в накладной ещё есть «свои» коробки.
// onSort не даёт принять «свою», тост советует «отсортируйте как чужую» — но это ошибка
// (−25 ₽), а коробка остаётся в накладной несортированной и приезжает снова и снова.
//  a) одна ошибка «Свои» на чужой коробке (мёртвый груз) → последняя коробка накладной не влезает;
//  b) долгов больше, чем мест (4 долга при складе 3) → лишний долг крутится по кругу.
import { launch, newGame, skipGuides, bug, info } from './lib.mjs';

const browser = await launch();

async function runRound(p, { makeDeadload }) {
  // играем 24 с: сначала одна ошибка (если нужно), потом «свои» → «Свои»,
  // на «свою», которую не принимают, — совет тоста: «Чужие»
  const log = { rejectedToast: '', rejected: 0, advisedWrong: 0, sameBoxAgain: 0, deadMade: 0 };
  const seen = {};
  const t0 = Date.now();
  while (Date.now() - t0 < 24000) {
    const r = await p.evaluate((makeDeadload) => {
      if (!acceptance || !acceptance.running) return { end: true };
      const c = acceptance.current;
      if (!c || c.sorted) return { wait: true };
      const occupied = gameState.shelfParcels.length + acceptance.acceptedList.length;
      const full = occupied >= gameState.warehouseCapacity;
      if (c.expected === 'ours') {
        if (full) {
          onSort('ours'); // не примут
          const toast = document.getElementById('toast').textContent;
          const stillThere = acceptance.current === c && !c.sorted;
          onSort('others'); // совет тоста
          return { rejected: stillThere, toast, uid: c.parcel.uid, penalty: acceptance.stats.penalty };
        }
        onSort('ours'); return { ok: true, uid: c.parcel.uid };
      }
      onSort(c.expected); return { ok: true };
    }, makeDeadload);
    if (r.end) break;
    if (r.dead) log.deadMade++;
    if (r.rejected) {
      log.rejected++; log.advisedWrong++; log.rejectedToast = r.toast; log.penalty = r.penalty;
      seen[r.uid] = (seen[r.uid] || 0) + 1;
    }
    await p.waitForTimeout(r.wait ? 100 : 520);
  }
  log.sameBoxAgain = Math.max(0, ...Object.values(seen)) ;
  log.invoice = await p.evaluate(() => acceptance.invoice.filter((x) => x.sorted).length + ' / ' + acceptance.invoice.length);
  log.penaltyTotal = await p.evaluate(() => acceptance.stats.penalty);
  return log;
}

try {
  {
    console.log('a) склад 3, одна ошибочная «Свои» на чужой коробке');
    const p = await newGame(browser, { mobile: true });
    await skipGuides(p);
    await p.evaluate(() => {
      gameState.day = 5; gameState.money = 500; gameState.warehouseCapacity = 3;
      gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
      gameState.daily.gloves = false;
      startAcceptance();
      acceptance.duration = 600; // растягиваем раунд, чтобы спокойно посчитать повторы
      // первой приехала чужая коробка, игрок по ошибке нажал «Свои» (обычная ошибка новичка)
      acceptance.current = { parcel: acceptance.others[0], isBroken: false, expected: 'others', sorted: false };
      renderCurrentBox();
      onSort('ours');
    });
    await p.waitForTimeout(600);
    const log = await runRound(p, { makeDeadload: false });
    log.deadMade = await p.evaluate(() => acceptance.acceptedList.filter((x) => x.status === 'surplus').length);
    info(`мёртвый груз сделан: ${log.deadMade}; «свою» не приняли ${log.rejected} раз; одна и та же коробка возвращалась до ${log.sameBoxAgain} раз`);
    info(`тост: «${log.rejectedToast}»`);
    info(`накладная ${log.invoice}; штрафы за «совет» тоста: ${log.penaltyTotal} ₽`);
    bug(log.rejected >= 2 && log.sameBoxAgain >= 2 && log.penaltyTotal >= 25 + 50,
      'коробка накладной, которую некуда поставить, приезжает снова и снова; совет тоста («как чужую») — каждый раз −25 ₽');
    await p.context().close();
  }
  {
    console.log('b) склад 3, четыре долга, мёртвого груза нет');
    const p = await newGame(browser, { mobile: true });
    await skipGuides(p);
    await p.evaluate(() => {
      gameState.day = 5; gameState.money = 500; gameState.warehouseCapacity = 3;
      gameState.shelfParcels = []; gameState.activeDebtsQueue = [];
      const vs = [VISITORS[0], VISITORS[1], VISITORS[3], VISITORS[4]];
      gameState.promisedDebts = vs.map((v, i) => { const it = visitorItemSource(v)[i]; return { visitorId: v.id, visitorName: v.name, orderCode: it.code, itemLabel: it.label, isMale: v.male, createdDay: 4 }; });
      gameState.daily.gloves = false;
      startAcceptance();
      acceptance.duration = 600;
    });
    const inv = await p.evaluate(() => acceptance.invoice.map((x) => x.code + (x.isDebt ? ':ДОЛГ' : '')).join(', '));
    info(`накладная: ${inv}`);
    const log = await runRound(p, { makeDeadload: false });
    info(`долг не приняли ${log.rejected} раз, одна и та же коробка — до ${log.sameBoxAgain} раз; тост: «${log.rejectedToast}»`);
    info(`накладная ${log.invoice}; штрафы: ${log.penaltyTotal} ₽`);
    bug(log.rejected >= 2 && log.sameBoxAgain >= 2, 'лишний долг крутится по кругу; каждая попытка «убрать» его — ошибка −25 ₽');
    await p.context().close();
  }
} finally {
  await browser.close();
}
