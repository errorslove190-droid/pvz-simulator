// Ускоренный прогон настоящей игры (таймеры ×0.1): хороший игрок, «разговаривает», сортирует без ошибок,
// в конце дня покупает самое дешёвое доступное улучшение (расходники не берёт).
// Цель — понять, когда у игрока заканчивается «что хотеть» в магазине (мета).
// Запуск: node work/retention/turbo-meta.mjs --days 40 [--ads 1]  (ads=1 — берёт все расходники за рекламу)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', 40));
const ADS = arg('--ads', '0') === '1';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  const st = window.setTimeout, si = window.setInterval;
  window.setTimeout = (f, ms, ...a) => st(f, Math.max(0, (ms || 0) * 0.1), ...a);
  window.setInterval = (f, ms, ...a) => si(f, Math.max(4, (ms || 0) * 0.1), ...a);
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto('http://localhost:8805/?adMs=30');
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
await p.waitForTimeout(200);

const log = [];
for (let d = 1; d <= DAYS; d++) {
  // приёмка
  for (let i = 0; i < 2000; i++) {
    const st = await p.evaluate(() => {
      if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'g'; }
      if (!acceptance || !acceptance.running) return 'done';
      const c = acceptance.current; if (!c || c.sorted) return 'w';
      const invDone = acceptance.invoice.every((x) => x.sorted);
      const poolLeft = (acceptance.rewardPool || 0) - (acceptance.paidOut || 0);
      const full = (gameState.shelfParcels.length + acceptance.acceptedList.length) >= gameState.warehouseCapacity;
      if (invDone && poolLeft <= 0) { endAcceptanceNow(); return 'done'; }
      let bin = c.expected;
      if (bin === 'ours' && full) bin = 'others'; // «свою» некуда поставить — по правилам игры сортируем как чужую
      onSort(bin); return 's';
    });
    if (st === 'done') break;
    await p.waitForTimeout(st === 's' ? 60 : 20);
  }
  // посетители
  for (let i = 0; i < 3000; i++) {
    const r = await p.evaluate(() => {
      if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'g'; }
      const act = document.querySelector('.screen-card.active').id;
      if (act === 'screen-dayend') return 'end';
      if (act === 'screen-morning') { const b = document.getElementById('btn-summary-continue'); if (b) b.click(); return 'doors'; }
      if (act === 'screen-scene') {
        if (sceneQueue.length) { tapScene(); return 'tap'; }
        const cont = document.querySelector('#btn-scene-continue:not([disabled])'); if (cont) { cont.click(); return 'c'; }
        const ch = [...document.querySelectorAll('.scene-choice:not(.disabled):not([disabled])')];
        if (ch.length) { const t = ch.find((b) => /Поддержать диалог|Поговорить/.test(b.textContent)); (t || ch[0]).click(); return 'ch'; }
        return 'w';
      }
      if (act === 'screen-warehouse') {
        if (document.getElementById('scan-overlay').classList.contains('show')) { if (scanState && !scanState.done && !scanState.timer) scanStart(); return 'scan'; }
        const code = gameState.activeVisitor.orderCode;
        const plate = [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + code);
        if (plate) { plate.click(); scanStart(); return 'sc'; }
        const lost = document.querySelector('.refuse-btn'); if (lost) { lost.click(); return 'lost'; }
        return 'w';
      }
      if (act === 'screen-result') { const b = document.getElementById('btn-next-customer'); if (!b.disabled) b.click(); return 'n'; }
      return act;
    });
    if (r === 'end') break;
    await p.waitForTimeout(25);
  }
  // магазин: жадно покупаем самое дешёвое доступное улучшение (все вкладки, кроме расходников)
  const info = await p.evaluate(async (ADS) => {
    const bought = [];
    openShopScreen();
    if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click();
    for (let k = 0; k < 10; k++) {
      let best = null;
      for (const tab of ['expansion', 'equipment']) {
        switchShopTab(tab);
        document.querySelectorAll('#shop-grid .shop-card').forEach((card) => {
          const btn = card.querySelector('.shop-buy-btn');
          const name = card.querySelector('.shop-card-name').textContent;
          if (/Экстренный/.test(name)) return;
          const m = btn.textContent.match(/(\d[\d\s]*)\s*₽/);
          if (!btn.disabled && m) { const cost = +m[1].replace(/\s/g, ''); if (!best || cost < best.cost) best = { tab, name, cost }; }
        });
      }
      if (!best) break;
      switchShopTab(best.tab);
      const card = [...document.querySelectorAll('#shop-grid .shop-card')].find((c) => c.querySelector('.shop-card-name').textContent === best.name);
      card.querySelector('.shop-buy-btn').click();
      bought.push(best.name + ' ' + best.cost);
    }
    if (ADS) {
      switchShopTab('daily');
      document.querySelectorAll('#shop-grid .shop-ad-btn').forEach((b) => b.click());
    }
    return { day: gameState.day - 1, money: gameState.money, rating: gameState.rating, cap: gameState.warehouseCapacity, bought, visitors: gameState.visitorCount, gross: gameState.dayGrossIncome };
  }, ADS);
  if (ADS) await p.waitForTimeout(400);
  log.push(info);
  console.log(JSON.stringify(info));
  await p.evaluate(() => YG.startNewDay());
  await p.waitForTimeout(150);
}
writeFileSync(new URL(`./turbo-meta${ADS ? '-ads' : ''}.json`, import.meta.url), JSON.stringify({ log, errors }, null, 1));
console.log('errors', errors.slice(0, 3));
await browser.close();
