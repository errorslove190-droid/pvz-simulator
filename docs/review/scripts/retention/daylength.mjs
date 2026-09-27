// Бот-замер длины игрового дня. Играет через глобальные функции игры (как tools/smoke.mjs),
// но с «человеческими» задержками и без пропуска текста (персона auto) или с пропуском (skip).
// Запуск: node work/retention/daylength.mjs --persona auto --days 4 [--port 8805] [--adMs 1500]
// Пишет work/retention/daylength-<persona>.json: хронометраж фаз по дням.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PERSONA = arg('--persona', 'auto');
const DAYS = Number(arg('--days', 3));
const PORT = Number(arg('--port', 8805));
const AD_MS = Number(arg('--adMs', 1500));
const URL_ = `http://localhost:${PORT}/?adMs=${AD_MS}`;

// Параметры персон (мс)
const P = {
  auto: { sortReact: 1100, accuracy: 0.9, skipText: false, thinkChoice: 1800, findBox: 1500, resultRead: 2000, reportRead: 6000, shopTime: 8000, act: 'talk', endWhenDone: true },
  skip: { sortReact: 600, accuracy: 1.0, skipText: true, thinkChoice: 400, findBox: 600, resultRead: 400, reportRead: 800, shopTime: 1000, act: 'give', endWhenDone: true },
}[PERSONA];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL_); // новый контекст — чистое хранилище, новая игра
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
await p.waitForTimeout(300);

// Наблюдатель в странице: пишет смену экранов, индекса посетителя, оверлеев
await p.evaluate(() => {
  window.__tl = [];
  let last = '';
  setInterval(() => {
    const act = (document.querySelector('.screen-card.active') || {}).id || '';
    const guide = document.getElementById('tutorial-overlay').classList.contains('show');
    const scan = document.getElementById('scan-overlay').classList.contains('show');
    const key = [act, gameState.day, gameState.visitorIndex, guide ? 'G' : '', scan ? 'S' : '', (acceptance && acceptance.running) ? 'A' : '', YG.adOpen ? 'AD' : ''].join('|');
    if (key !== last) { last = key; window.__tl.push({ t: Math.round(performance.now()), act, day: gameState.day, vi: gameState.visitorIndex, vc: gameState.visitorCount, guide, scan, acc: !!(acceptance && acceptance.running), ad: YG.adOpen, name: sceneVisitorName }); }
  }, 50);
});

const sleep = (ms) => p.waitForTimeout(ms);
const rnd = (a, b) => a + Math.random() * (b - a);

async function closeGuideIfAny() {
  const g = await p.evaluate(() => document.getElementById('tutorial-overlay').classList.contains('show'));
  if (g) { await sleep(PERSONA === 'auto' ? 7000 : 500); await p.evaluate(() => document.getElementById('tutorial-btn').click()); }
  return g;
}

async function playAcceptance() {
  for (let i = 0; i < 400; i++) {
    if (await closeGuideIfAny()) continue;
    const st = await p.evaluate(({ endWhenDone }) => {
      if (!acceptance || !acceptance.running) return 'done';
      const c = acceptance.current;
      if (!c || c.sorted) return 'wait';
      const invDone = acceptance.invoice.every((x) => x.sorted);
      const poolLeft = (acceptance.rewardPool || 0) - (acceptance.paidOut || 0);
      const full = (gameState.shelfParcels.length + acceptance.acceptedList.length) >= gameState.warehouseCapacity;
      if (endWhenDone && invDone && (poolLeft <= 0 || full)) { endAcceptanceNow(); return 'done'; }
      return 'box';
    }, P);
    if (st === 'done') return;
    if (st === 'wait') { await sleep(100); continue; }
    await sleep(rnd(P.sortReact * 0.7, P.sortReact * 1.3));
    await p.evaluate(({ accuracy }) => {
      if (!acceptance || !acceptance.running || !acceptance.current || acceptance.current.sorted) return;
      const c = acceptance.current;
      let bin = c.expected;
      if (Math.random() > accuracy) bin = ['ours', 'others', 'broken'].filter((b) => b !== c.expected)[Math.floor(Math.random() * 2)];
      onSort(bin);
      // Склад полон — «свою» нельзя принять: игрок сортирует её в чужие
    }, P);
  }
}

async function waitText() {
  // ждём окончания порционного текста (или пропускаем)
  for (let i = 0; i < 400; i++) {
    const q = await p.evaluate(() => sceneQueue.length);
    if (!q) return;
    if (P.skipText) { await p.evaluate(() => tapScene()); await sleep(250); } else await sleep(200);
  }
}

async function playCustomers() {
  for (let i = 0; i < 800; i++) {
    if (await closeGuideIfAny()) continue;
    const act = await p.evaluate(() => document.querySelector('.screen-card.active').id);
    if (act === 'screen-dayend') return;
    if (act === 'screen-morning') { await sleep(P.resultRead); await p.evaluate(() => { const b = document.getElementById('btn-summary-continue'); if (b) b.click(); }); await sleep(600); continue; }
    if (act === 'screen-scene') {
      await waitText();
      const r = await p.evaluate(({ act }) => {
        const cont = document.querySelector('#btn-scene-continue:not([disabled])');
        if (cont) return 'cont';
        const ch = [...document.querySelectorAll('.scene-choice:not(.disabled):not([disabled])')];
        if (!ch.length) return 'wait';
        return 'choice';
      }, P);
      if (r === 'wait') { await sleep(150); continue; }
      await sleep(r === 'cont' ? P.thinkChoice / 2 : P.thinkChoice);
      await p.evaluate(({ act }) => {
        const cont = document.querySelector('#btn-scene-continue:not([disabled])');
        if (cont) { cont.click(); return; }
        const ch = [...document.querySelectorAll('.scene-choice:not(.disabled):not([disabled])')];
        if (!ch.length) return;
        // обычный визит: talk (2-я кнопка) или give (1-я); должник/скандал/бомж — 1-я (самая мягкая)
        const want = act === 'talk' && ch.length === 3 && /Поддержать диалог|Поговорить|диалог/i.test(ch[1].textContent) ? ch[1] : ch[0];
        want.click();
      }, P);
      await sleep(300);
      continue;
    }
    if (act === 'screen-warehouse') {
      const scanning = await p.evaluate(() => document.getElementById('scan-overlay').classList.contains('show'));
      if (scanning) { await sleep(200); continue; }
      await sleep(P.findBox);
      const r = await p.evaluate(() => {
        const code = gameState.activeVisitor.orderCode;
        const plate = [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + code);
        if (plate) { plate.click(); return 'plate'; }
        const lost = document.querySelector('.refuse-btn');
        if (lost) { lost.click(); return 'lost'; }
        return 'wait';
      });
      if (r === 'plate') { await sleep(PERSONA === 'auto' ? 700 : 200); await p.evaluate(() => scanStart()); await sleep(2800); }
      continue;
    }
    if (act === 'screen-result') {
      await sleep(P.resultRead);
      await p.evaluate(() => { const b = document.getElementById('btn-next-customer'); if (b && !b.disabled) b.click(); });
      await sleep(600);
      continue;
    }
    await sleep(200);
  }
  throw new Error('смена не закончилась');
}

const days = [];
for (let d = 1; d <= DAYS; d++) {
  const t0 = await p.evaluate(() => performance.now());
  await playAcceptance();
  const tAccEnd = await p.evaluate(() => performance.now());
  await playCustomers();
  const tDayEnd = await p.evaluate(() => performance.now());
  await sleep(P.reportRead);
  // магазин: заглянуть и купить самое дешёвое доступное (как «средний» игрок)
  await p.evaluate(() => openShopScreen());
  await closeGuideIfAny();
  await sleep(P.shopTime);
  const info = await p.evaluate(() => ({ day: gameState.day - 1, money: gameState.money, rating: gameState.rating, visitors: gameState.visitorCount, scandal: !!gameState.todayScandal, bomzh: !!gameState.todayBomzh }));
  const tShopEnd = await p.evaluate(() => performance.now());
  await p.evaluate(() => YG.startNewDay());
  await sleep(AD_MS + 700);
  const tNext = await p.evaluate(() => performance.now());
  const rec = { ...info, accSec: +((tAccEnd - t0) / 1000).toFixed(1), customersSec: +((tDayEnd - tAccEnd) / 1000).toFixed(1), reportShopSec: +((tShopEnd - tDayEnd) / 1000).toFixed(1), adSec: +((tNext - tShopEnd) / 1000).toFixed(1), totalSec: +((tNext - t0) / 1000).toFixed(1) };
  rec.perVisitSec = +(rec.customersSec / rec.visitors).toFixed(1);
  days.push(rec);
  console.log(JSON.stringify(rec));
}
const tl = await p.evaluate(() => window.__tl);
writeFileSync(new URL(`./daylength-${PERSONA}.json`, import.meta.url), JSON.stringify({ persona: PERSONA, params: P, days, errors, timeline: tl }, null, 1));
console.log('errors:', errors.length ? errors.slice(0, 5) : 'нет');
await browser.close();
