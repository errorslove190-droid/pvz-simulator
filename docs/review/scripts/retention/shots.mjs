// Скриншоты отчёта смены и магазина (телефон 390×844) — посмотреть, где место под «анонс завтра»
import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, Math.max(0, (ms || 0) * 0.1), ...a); });
const p = await ctx.newPage();
await p.goto('http://localhost:8805/?adMs=30');
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
await p.waitForTimeout(300);
for (let i = 0; i < 3000; i++) {
  const r = await p.evaluate(() => {
    if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'g'; }
    const act = document.querySelector('.screen-card.active').id;
    if (act === 'screen-dayend') return 'end';
    if (acceptance && acceptance.running) { const c = acceptance.current; if (c && !c.sorted) { if (acceptance.invoice.every((x) => x.sorted)) { endAcceptanceNow(); return 'e'; } onSort(c.expected); } return 'a'; }
    if (act === 'screen-morning') { const b = document.getElementById('btn-summary-continue'); if (b) b.click(); return 'd'; }
    if (act === 'screen-scene') { if (sceneQueue.length) { tapScene(); return 't'; } const cont = document.querySelector('#btn-scene-continue:not([disabled])'); if (cont) { cont.click(); return 'c'; } const ch = [...document.querySelectorAll('.scene-choice:not(.disabled):not([disabled])')]; if (ch.length) ch[1 < ch.length ? 1 : 0].click(); return 'ch'; }
    if (act === 'screen-warehouse') { if (document.getElementById('scan-overlay').classList.contains('show')) return 's'; const code = gameState.activeVisitor.orderCode; const plate = [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + code); if (plate) { plate.click(); scanStart(); } else { const l = document.querySelector('.refuse-btn'); if (l) l.click(); } return 'w'; }
    if (act === 'screen-result') { const b = document.getElementById('btn-next-customer'); if (!b.disabled) b.click(); return 'n'; }
    return act;
  });
  if (r === 'end') break;
  await p.waitForTimeout(r === 'a' ? 80 : 30);
}
await p.waitForTimeout(400);
await p.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click(); });
await p.waitForTimeout(300);
await p.screenshot({ path: 'work/retention/dayend.png' });
await p.evaluate(() => openShopScreen());
await p.waitForTimeout(300);
await p.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click(); });
await p.waitForTimeout(300);
await p.screenshot({ path: 'work/retention/shop.png' });
await browser.close();
