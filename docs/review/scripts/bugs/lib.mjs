// Общие помощники для сценариев ревью «Ошибки» (агент №1).
// Сервер: node tools/serve.mjs --port 8801 (запущен отдельно).
import { chromium } from 'playwright';

export const BASE = process.env.PVZ_URL || 'http://localhost:8801/';

let failed = 0;
export const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; return cond; };
export const bug = (cond, msg) => { console.log((cond ? '  БАГ ПОДТВЕРЖДЁН: ' : '  не воспроизвелось: ') + msg); return cond; };
export const info = (msg) => console.log('    · ' + msg);
export const failures = () => failed;

export async function launch() {
  return chromium.launch();
}

// mobile: 390×844 с тачем; desktop: 1280×800 мышь+клавиатура
export async function newGame(browser, { mobile = true, query = '?adMs=200', keepStorage = null } = {}) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : { viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p._errors = [];
  p.on('pageerror', (e) => p._errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') p._errors.push(m.text()); });
  if (keepStorage) {
    // подкладываем сейв до загрузки игры: пустая страница того же origin
    await p.route(BASE + '__blank.html', (r) => r.fulfill({ body: '<html></html>', contentType: 'text/html' }));
    await p.goto(BASE + '__blank.html');
    await p.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, keepStorage);
  }
  await p.goto(BASE + query);
  await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await p.waitForTimeout(400);
  return p;
}

export async function reopen(p, query = '?adMs=200') {
  await p.goto('about:blank');
  await p.goto(BASE + query);
  await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await p.waitForTimeout(1200);
}

export const screen = (p) => p.evaluate(() => document.querySelector('.screen-card.active').id);
export const state = (p) => p.evaluate(() => ({
  day: gameState.day, money: gameState.money, rating: gameState.rating,
  screen: document.querySelector('.screen-card.active').id,
  vi: gameState.visitorIndex, vc: gameState.visitorCount,
  visitor: gameState.activeVisitor && { name: gameState.activeVisitor.name, id: gameState.activeVisitor.id, code: gameState.activeVisitor.orderCode, debt: gameState.activeVisitor.isDebtVisitor },
  shelf: (gameState.shelfParcels || []).map((x) => x.code + (x.status && x.status !== 'normal' ? ':' + x.status : '') + (x.isDebt ? ':debt' : '')),
  gross: gameState.dayGrossIncome, other: gameState.dayOtherCost, courier: gameState.dayCourierFee,
}));

export async function closeGuideIfAny(p) {
  await p.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click(); });
}

// Отметить все гайды просмотренными (чтобы не мешали сценариям)
export async function skipGuides(p) {
  await p.evaluate(() => {
    gameState.guidesSeen = { acceptance: true, issue: true, shop: true, dayend: true, courier: true };
    if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click();
  });
}

// Из tools/smoke.mjs: правильная сортировка до сбора накладной
export async function playAcceptance(p) {
  for (let i = 0; i < 400; i++) {
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

// Из tools/smoke.mjs + журнал: кто входил, какой тост был перед входом
export async function playCustomers(p, { log = null, maxSteps = 900 } = {}) {
  for (let i = 0; i < maxSteps; i++) {
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

// Дождаться, пока на сцене появятся варианты выбора (текст пролистываем)
export async function waitChoices(p, sel = '.scene-choice:not(.disabled):not([disabled])') {
  for (let i = 0; i < 80; i++) {
    const n = await p.evaluate((s) => {
      if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click();
      if (sceneQueue.length) tapScene();
      return document.querySelectorAll(s).length;
    }, sel);
    if (n) return n;
    await p.waitForTimeout(150);
  }
  throw new Error('варианты выбора не появились');
}

// Пролистать текст до кнопки «продолжить» сцены
export async function waitContinue(p) {
  for (let i = 0; i < 80; i++) {
    const n = await p.evaluate(() => {
      if (sceneQueue.length) tapScene();
      return !!document.querySelector('#btn-scene-continue:not([disabled])');
    });
    if (n) return true;
    await p.waitForTimeout(150);
  }
  return false;
}

// Начать новую игру «с чистого листа» в нужный день: без гайдов, с заданными деньгами
export async function freshDay(p, { day = 5, money = 1000, capacity = 3, scandal = null, bomzh = null } = {}) {
  await p.evaluate(({ day, money, capacity }) => {
    gameState.guidesSeen = { acceptance: true, issue: true, shop: true, dayend: true, courier: true };
    if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click();
    gameState.day = day; gameState.money = money; gameState.warehouseCapacity = capacity;
    gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
  }, { day, money, capacity });
}
