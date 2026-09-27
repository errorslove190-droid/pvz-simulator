// S1. Скандалист выбирается из всех VISITORS без учёта тех, кто уже придёт сегодня
// (ростер и должники). Считаем на 2000 настоящих вызовах startAcceptance, как часто
// в день со скандалом тот же персонаж приходит ещё и обычным посетителем/должником.
import { launch, newGame, skipGuides, bug, info } from './lib.mjs';
const browser = await launch();
try {
  const p = await newGame(browser, { mobile: false });
  await skipGuides(p);
  const r = await p.evaluate(() => {
    let days = 0, same = 0, sameDebt = 0, fem = 0; const ex = [];
    for (let i = 0; i < 2000; i++) {
      gameState.day = 2 + (i % 60); gameState.money = 1000; gameState.warehouseCapacity = 9;
      gameState.shelfParcels = []; gameState.activeDebtsQueue = [];
      // день с одним должником — как часто бывает после «найду к завтра»
      const dv = VISITORS[i % VISITORS.length]; const it = visitorItemSource(dv)[0];
      gameState.promisedDebts = [{ visitorId: dv.id, visitorName: dv.name, orderCode: it.code, itemLabel: it.label, isMale: dv.male, createdDay: gameState.day - 1 }];
      startAcceptance();
      if (acceptance._timer) clearInterval(acceptance._timer);
      if (acceptance._nextBoxTimeout) clearTimeout(acceptance._nextBoxTimeout);
      acceptance.running = false;
      const sc = gameState.todayScandal; if (!sc) continue;
      days++;
      if (!sc.visitor.male) fem++;
      const ids = gameState.todayVisitorRoster.map((x) => x.visitor.id);
      if (ids.includes(sc.visitor.id)) { same++; if (ex.length < 3) ex.push(`день ${gameState.day}: ${sc.visitor.name} — и скандалист (поз. ${sc.pos}), и посетитель №${ids.indexOf(sc.visitor.id) + 1 + (gameState.todayDebtsCount || 0)}`); }
      if (gameState.activeDebtsQueue.some((d) => d.visitorId === sc.visitor.id)) sameDebt++;
    }
    return { days, same, sameDebt, fem, ex };
  });
  info(`дней со скандалом: ${r.days}; скандалист = обычный посетитель того же дня: ${r.same} (${(100 * r.same / r.days).toFixed(0)} %); = должник того же дня: ${r.sameDebt}`);
  info(`скандалист — женщина: ${r.fem} (${(100 * r.fem / r.days).toFixed(0)} %)`);
  r.ex.forEach((x) => info(x));
  bug(r.same > 0, 'один и тот же персонаж в один день приходит и спокойным клиентом, и скандалистом');
} finally { await browser.close(); }
