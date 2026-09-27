// P1. Порядок посетителей: перебор всех позиций скандалиста и бомжа при 0 / 2 / 5 долгах
// (день 5: 4 обычных посетителя; 5 долгов > 4 — «долгов больше нагрузки дня»).
// Для каждой комбинации проходим день через настоящие startScene / continueCustomerFlow
// и проверяем: каждый должник и каждый из ростера — ровно один раз и по порядку,
// скандалист и бомж — ровно один раз на своей позиции, нет «запасных» случайных
// посетителей, тост «Новый посетитель: X» называет того, кто входит.
import { launch, newGame, skipGuides, info } from './lib.mjs';

const browser = await launch();
const combos = [];
for (const D of (process.env.CONTROL ? [2] : [0, 2, 5])) {
  const N = Math.max(4, D);
  for (let s = -1; s < N; s++) {
    const bMax = s >= 0 ? N : N - 1; // бомж выбирается из visitorCount уже с учётом скандалиста
    for (let b = -1; b <= bMax; b++) {
      if (b >= 0 && b === s) continue; // совпадение сдвигается кодом startAcceptance
      combos.push({ D, s, b });
    }
  }
}
info(`комбинаций: ${combos.length}`);

async function runCombo(p, { D, s, b }) {
  await p.evaluate(({ D, s, b }) => {
    gameState.day = 5; gameState.money = 1000; gameState.warehouseCapacity = 9;
    gameState.shelfParcels = []; gameState.activeDebtsQueue = []; gameState.debtAttempts = {};
    const pool = VISITORS.filter((v) => v.id !== 'mama_baby');
    gameState.promisedDebts = pool.slice(0, D).map((v, i) => { const it = visitorItemSource(v)[i % 5]; return { visitorId: v.id, visitorName: v.name, orderCode: it.code, itemLabel: it.label, isMale: v.male, createdDay: 4 }; });
    startAcceptance();
    if (acceptance._timer) clearInterval(acceptance._timer);
    if (acceptance._nextBoxTimeout) clearTimeout(acceptance._nextBoxTimeout);
    acceptance.running = false;
    const regular = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0);
    gameState.visitorCount = regular;
    gameState.todayScandal = null; gameState.todayBomzh = null;
    if (s >= 0) { gameState.todayScandal = { type: SCANDAL_TYPES[2], visitor: VISITORS[0], pos: s, done: false }; gameState.visitorCount++; }
    if (b >= 0) { gameState.todayBomzh = { visitor: VISITOR_BOMZH, pos: b, done: false, stolen: null }; gameState.visitorCount++; }
    if (window.__sabotage) gameState.todayDebtsCount = 0;
    window.__exp = { debts: gameState.activeDebtsQueue.map((d) => d.visitorName), roster: gameState.todayVisitorRoster.map((r) => r.visitor.name), vc: gameState.visitorCount };
    openDoorsAndStartFirstCustomer();
  }, { D, s, b });
  const seq = [];
  let toast = null;
  for (let step = 0; step < 20; step++) {
    await p.waitForTimeout(step === 0 ? 50 : 480);
    const r = await p.evaluate(() => {
      const scr = document.querySelector('.screen-card.active').id;
      if (scr === 'screen-dayend') return { end: true };
      const nameHtml = document.getElementById('scene-name').innerHTML;
      const kind = /скандалист/.test(nameHtml) ? 'scandal' : (/необычный гость/.test(nameHtml) ? 'bomzh' : (gameState.activeVisitor && gameState.activeVisitor.isDebtVisitor ? 'debt' : 'roster'));
      const name = kind === 'scandal' ? gameState.todayScandal.visitor.name : kind === 'bomzh' ? 'Федор' : gameState.activeVisitor.name;
      const vi = gameState.visitorIndex;
      if (kind === 'scandal') gameState.todayScandal.done = true;
      if (kind === 'bomzh') gameState.todayBomzh.done = true;
      _flowLock = false;
      continueCustomerFlow();
      const t = document.getElementById('toast').textContent;
      return { kind, name, vi, nextToast: t };
    });
    if (r.end) break;
    seq.push({ ...r, toast });
    toast = r.nextToast;
  }
  const exp = await p.evaluate(() => window.__exp);
  // проверки
  const errs = [];
  if (seq.length !== exp.vc) errs.push(`визитов ${seq.length}, ожидалось ${exp.vc}`);
  const debts = seq.filter((x) => x.kind === 'debt').map((x) => x.name);
  if (JSON.stringify(debts) !== JSON.stringify(exp.debts)) errs.push(`должники ${JSON.stringify(debts)} ≠ ${JSON.stringify(exp.debts)}`);
  const roster = seq.filter((x) => x.kind === 'roster').map((x) => x.name);
  if (JSON.stringify(roster) !== JSON.stringify(exp.roster)) errs.push(`ростер ${JSON.stringify(roster)} ≠ ${JSON.stringify(exp.roster)}`);
  const sc = seq.filter((x) => x.kind === 'scandal');
  if (s >= 0 && (sc.length !== 1 || sc[0].vi !== s)) errs.push(`скандалист: ${JSON.stringify(sc.map((x) => x.vi))}, ожидалась позиция ${s}`);
  if (s < 0 && sc.length) errs.push('лишний скандалист');
  const bz = seq.filter((x) => x.kind === 'bomzh');
  if (b >= 0 && (bz.length !== 1 || bz[0].vi !== b)) errs.push(`бомж: ${JSON.stringify(bz.map((x) => x.vi))}, ожидалась позиция ${b}`);
  seq.forEach((x, i) => {
    if (i === 0 || !x.toast) return;
    const want = (x.kind === 'scandal' || x.kind === 'bomzh') ? 'Кто-то входит' : 'Новый посетитель: ' + x.name;
    if (!x.toast.includes(want)) errs.push(`тост перед №${i + 1} «${x.toast}», а вошёл ${x.kind} ${x.name}`);
  });
  return { errs, seq };
}

let bad = 0;
try {
  const pages = [];
  for (let i = 0; i < 4; i++) { const p = await newGame(browser, { mobile: false }); await skipGuides(p); if (process.env.CONTROL) { await p.evaluate(() => { window.__sabotage = true; }); } pages.push(p); }
  let next = 0;
  await Promise.all(pages.map(async (p) => {
    while (next < combos.length) {
      const c = combos[next++];
      const { errs, seq } = await runCombo(p, c);
      if (errs.length) { bad++; console.log(`  ✗ D=${c.D} скандалист=${c.s} бомж=${c.b}: ${errs.join('; ')}`); console.log('     ' + seq.map((x) => x.vi + ':' + x.kind + ':' + x.name).join(' → ')); }
    }
  }));
  for (const p of pages) { if (p._errors.length) console.log('  ошибки консоли: ' + p._errors.slice(0, 3).join(' | ')); }
} finally {
  await browser.close();
}
console.log(bad ? `  НАЙДЕНО проблемных комбинаций: ${bad} из ${combos.length}` : `  ✓ все ${combos.length} комбинаций: каждый ровно один раз, по порядку, тосты верные`);
