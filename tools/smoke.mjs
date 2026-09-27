#!/usr/bin/env node
// Дымовой тест: бот проходит несколько игровых дней и проверяет сохранения.
// Нужен Playwright: npm install (или глобальный playwright). Запуск: npm run smoke [-- --days 5]
// Другая папка с исходниками (например, разобранный бэкап): npm run smoke -- --root work/old
//
// Проверяет:
//   1. Несколько полных дней без ошибок в консоли (приёмка → посетители → отчёт → новый день).
//   2. Закрыли игру посреди утренней приёмки → после перезапуска НЕ пропускаем приёмку.
//   3. Закрыли игру посреди визита должника → после перезапуска приходит тот же должник.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', 3));
const PORT = Number(arg('--port', 8799));
const ROOT = arg('--root', 'src');
const URL_ = `http://localhost:${PORT}/`;

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), '--port', String(PORT), '--root', ROOT], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; };

// Сортирует коробки правильно, пока не соберёт накладную, затем завершает приёмку
async function playAcceptance(p) {
  for (let i = 0; i < 300; i++) {
    const st = await p.evaluate(() => {
      if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'guide'; }
      if (!acceptance || !acceptance.running) return 'done';
      const c = acceptance.current;
      if (!c || c.sorted) return 'wait';
      if (acceptance.invoice.every((x) => x.sorted)) { endAcceptanceNow(); return 'done'; }
      onSort(c.expected);
      return 'sorted';
    });
    if (st === 'done') return;
    await p.waitForTimeout(st === 'sorted' ? 520 : 150);
  }
  throw new Error('приёмка не закончилась');
}

// Посетители до отчёта смены: разговор или выдача, поиск коробки, сканирование
async function playCustomers(p) {
  for (let i = 0; i < 600; i++) {
    const r = await p.evaluate(() => {
      const act = document.querySelector('.screen-card.active').id;
      if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'guide'; }
      if (act === 'screen-dayend') return 'dayend';
      if (act === 'screen-morning') { const b = document.getElementById('btn-summary-continue'); if (b) b.click(); return 'doors'; }
      if (act === 'screen-scene') {
        if (sceneQueue.length) { tapScene(); return 'tap'; }
        const cont = document.querySelector('#btn-scene-continue:not([disabled])');
        if (cont) { cont.click(); return 'continue'; }
        const ch = [...document.querySelectorAll('.scene-choice:not(.disabled):not([disabled])')];
        if (ch.length) { ch[0].click(); return 'choice'; }
        return 'wait';
      }
      if (act === 'screen-warehouse') {
        if (document.getElementById('scan-overlay').classList.contains('show')) return 'scanning';
        const code = gameState.activeVisitor.orderCode;
        const plate = [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + code);
        if (plate) { plate.click(); scanStart(); return 'scan'; }
        const lost = document.querySelector('.refuse-btn');
        if (lost) { lost.click(); return 'lost'; }
        return 'wait';
      }
      if (act === 'screen-result') { const b = document.getElementById('btn-next-customer'); if (!b.disabled) b.click(); return 'next'; }
      return act;
    });
    if (r === 'dayend') return;
    await p.waitForTimeout(r === 'scan' ? 1500 : ['choice', 'continue', 'next', 'doors'].includes(r) ? 700 : 300);
  }
  throw new Error('смена не закончилась');
}

const snapshot = (p) => p.evaluate(() => ({
  day: gameState.day, money: gameState.money, rating: gameState.rating,
  screen: document.querySelector('.screen-card.active').id,
  visitor: gameState.activeVisitor && { name: gameState.activeVisitor.name, debt: gameState.activeVisitor.isDebtVisitor },
}));

async function reopen(p) {
  await p.goto('about:blank');
  await p.goto(URL_);
  await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await p.waitForTimeout(1500);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(URL_);
  await p.waitForTimeout(1200);

  console.log(`1. ${DAYS} дн. подряд`);
  for (let d = 1; d <= DAYS; d++) {
    await playAcceptance(p);
    await playCustomers(p);
    const s = await snapshot(p);
    console.log(`  день ${d}: баланс ${s.money} ₽, рейтинг ${s.rating}`);
    await p.evaluate(() => YG.startNewDay());
    await p.waitForTimeout(2200); // имитация полноэкранной рекламы 1,5 с
  }
  ok(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

  console.log('2. перезапуск посреди приёмки');
  const before = await snapshot(p);
  await p.evaluate(() => onSort(acceptance.current.expected));
  await reopen(p);
  const after = await snapshot(p);
  ok(after.screen === 'screen-dayend' || after.screen === 'screen-shop', `вернулись к отчёту дня, а не к посетителям (экран: ${after.screen})`);
  ok(after.day === before.day && after.money === before.money, `день и баланс не изменились (${after.day}, ${after.money} ₽)`);

  console.log('3. перезапуск посреди визита должника');
  await p.evaluate(() => {
    const v = VISITORS[3];
    const it = visitorItemSource(v)[0];
    gameState.promisedDebts = [{ visitorId: v.id, visitorName: v.name, orderCode: it.code, itemLabel: it.label, isMale: v.male, createdDay: gameState.day - 1 }];
    gameState.todayScandal = null; gameState.todayBomzh = null;
    YG.save({ phase: 'dayend' });
    startAcceptance();
    gameState.todayScandal = null; gameState.todayBomzh = null; // первым войдёт должник
  });
  await playAcceptance(p);
  await p.evaluate(() => document.getElementById('btn-summary-continue').click());
  await p.waitForTimeout(900);
  const debtor = (await snapshot(p)).visitor;
  ok(!!(debtor && debtor.debt), `первым пришёл должник (${debtor && debtor.name})`);
  await reopen(p);
  const again = (await snapshot(p)).visitor;
  ok(!!(again && debtor && again.debt && again.name === debtor.name), `после перезапуска — тот же должник (${again && again.name})`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `ПРОВАЛЕНО проверок: ${failed}` : 'Все проверки пройдены');
process.exit(failed ? 1 : 0);
