// 360×640: быстрый проход по экранам (через функции игры) + снимки и аудит; поворот телефона; медленная сеть.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { BASE, OUT, INIT, audit, shot } from './lib.mjs';

const browser = await chromium.launch();
const res = { audits: [], notes: [] };
const note = (k, v) => { res.notes.push({ k, v }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };

async function ready(page) {
  await page.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'), null, { timeout: 30000 });
  await page.waitForTimeout(700);
}
const closeGuide = (page) => page.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click(); });
async function fastAcceptance(page) {
  await closeGuide(page);
  for (let i = 0; i < 200; i++) {
    const st = await page.evaluate(() => {
      if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'g'; }
      if (!acceptance || !acceptance.running) return 'done';
      if (acceptance.invoice.every((x) => x.sorted)) { endAcceptanceNow(); return 'done'; }
      const c = acceptance.current; if (c && !c.sorted) onSort(c.expected); return 's';
    });
    if (st === 'done') return;
    await page.waitForTimeout(520);
  }
}
const waitChoices = (page) => page.waitForFunction(() => document.querySelectorAll('.scene-choice:not(.disabled)').length > 0 || document.getElementById('btn-scene-continue'), null, { timeout: 20000 });

// ---------- 1. 360×640 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await ready(page);
  await shot(page, 's360-guide');
  res.audits.push(await audit(page, '360 гайд приёмки'));
  await closeGuide(page);
  await page.waitForTimeout(900);
  await shot(page, 's360-acceptance');
  res.audits.push(await audit(page, '360 приёмка'));
  await fastAcceptance(page);
  await page.waitForTimeout(400);
  await shot(page, 's360-acc-summary');
  await page.evaluate(() => document.getElementById('btn-summary-continue').click());
  await page.waitForTimeout(700);
  await closeGuide(page);
  await waitChoices(page);
  await page.waitForTimeout(900); // анимация плашек
  await shot(page, 's360-scene-choices');
  res.audits.push(await audit(page, '360 сцена'));
  // отказ -> крупный режим, длинный текст
  await page.evaluate(() => [...document.querySelectorAll('.scene-choice')].find((b) => /Отказать/.test(b.innerText)).click());
  await page.waitForFunction(() => document.querySelectorAll('.scene-choice:not(.disabled)').length === 2, null, { timeout: 20000 });
  await page.waitForTimeout(900);
  await shot(page, 's360-scene-refuse');
  res.audits.push(await audit(page, '360 сцена отказа'));
  note('360: текст сцены (прокрутка внутри окна)', await page.evaluate(() => { const t = document.getElementById('scene-text'); const r = t.getBoundingClientRect(); return { sh: t.scrollHeight, ch: t.clientHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), overflowY: getComputedStyle(t).overflowY }; }));
  note('360: плашки выбора', await page.evaluate(() => [...document.querySelectorAll('.scene-choice')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.innerText.split('\n')[0], top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight }; })));
  await page.evaluate(() => [...document.querySelectorAll('.scene-choice')].find((b) => /Всё же/.test(b.innerText)).click());
  await page.waitForFunction(() => document.getElementById('btn-scene-continue'), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('btn-scene-continue').click());
  await page.waitForTimeout(900);
  await shot(page, 's360-warehouse');
  res.audits.push(await audit(page, '360 склад'));
  const code = await page.evaluate(() => gameState.activeVisitor.orderCode);
  await page.evaluate((c) => [...document.querySelectorAll('.wh-plate-num')].find((p) => p.textContent === '#' + c).click(), code);
  await page.waitForTimeout(500);
  await shot(page, 's360-scan');
  await page.evaluate(() => scanStart());
  await page.waitForTimeout(2600);
  await shot(page, 's360-result');
  res.audits.push(await audit(page, '360 результат'));
  // до конца дня
  for (let i = 0; i < 400; i++) {
    const r = await page.evaluate(() => {
      const act = document.querySelector('.screen-card.active').id;
      if (document.getElementById('tutorial-overlay').classList.contains('show')) return 'guide';
      if (act === 'screen-dayend') return 'dayend';
      if (act === 'screen-scene') {
        if (sceneQueue.length) { tapScene(); return 'tap'; }
        const cont = document.querySelector('#btn-scene-continue:not([disabled])'); if (cont) { cont.click(); return 'c'; }
        const ch = [...document.querySelectorAll('.scene-choice:not(.disabled)')]; if (ch.length) { ch[0].click(); return 'ch'; }
        return 'w';
      }
      if (act === 'screen-warehouse') {
        if (document.getElementById('scan-overlay').classList.contains('show')) return 'sc';
        const c = gameState.activeVisitor.orderCode; const p = [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + c);
        if (p) { p.click(); scanStart(); return 'scan'; }
        const l = document.querySelector('.refuse-btn'); if (l) { l.click(); return 'lost'; } return 'w';
      }
      if (act === 'screen-result') { const b = document.getElementById('btn-next-customer'); if (!b.disabled) b.click(); return 'n'; }
      return act;
    });
    if (r === 'dayend') break;
    if (r === 'guide') { await page.waitForTimeout(300); await shot(page, 's360-guide-dayend'); await closeGuide(page); }
    await page.waitForTimeout(r === 'scan' ? 1500 : 450);
  }
  await page.waitForTimeout(600);
  await shot(page, 's360-dayend');
  res.audits.push(await audit(page, '360 отчёт'));
  note('360: кнопки отчёта', await page.evaluate(() => [...document.querySelectorAll('#screen-dayend button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.innerText.trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; })));
  await page.evaluate(() => openShopScreen());
  await page.waitForTimeout(500);
  await closeGuide(page);
  await page.evaluate(() => switchShopTab('daily'));
  await page.waitForTimeout(400);
  await shot(page, 's360-shop-daily');
  res.audits.push(await audit(page, '360 магазин расходники'));
  // прокрутка списка до конца: видна ли последняя карточка целиком
  note('360: магазин — прокрутка', await page.evaluate(() => {
    const sc = document.querySelector('.shop-cards-scroll-container'); sc.scrollTop = sc.scrollHeight;
    const last = [...document.querySelectorAll('.shop-card')].pop().getBoundingClientRect();
    const bar = document.querySelector('.shop-bottom-actions').getBoundingClientRect();
    return { lastBottom: Math.round(last.bottom), barTop: Math.round(bar.top), overlap: last.bottom > bar.top + 1, scrollH: sc.scrollHeight, clientH: sc.clientHeight };
  }));
  await page.waitForTimeout(300);
  await shot(page, 's360-shop-daily-bottom');
  await ctx.close();
}

// ---------- 2. Поворот телефона (390×844 → 844×390) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await ready(page);
  await closeGuide(page);
  await page.waitForTimeout(2000);
  const t1 = await page.evaluate(() => document.getElementById('hud-timer').textContent);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(3000);
  await shot(page, 'rotate-landscape');
  const rot = await page.evaluate(() => ({ hint: getComputedStyle(document.getElementById('rotate-hint')).display, timer: document.getElementById('hud-timer').textContent, paused: acceptance && acceptance._paused, ev: __ygMock.events.slice(-3).map((e) => e.name) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => ({ hint: getComputedStyle(document.getElementById('rotate-hint')).display, timer: document.getElementById('hud-timer').textContent, paused: acceptance && acceptance._paused, ev: __ygMock.events.slice(-2).map((e) => e.name) }));
  note('поворот', { before: t1, landscape: rot, portraitAgain: back });
  await ctx.close();
}

// ---------- 3. Медленная сеть: экран загрузки ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'commit' });
  await page.waitForSelector('#loading-screen', { timeout: 20000 });
  await page.waitForTimeout(400);
  await shot(page, 'loading-slow');
  const tl = { };
  await page.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'), null, { timeout: 60000 });
  tl.ready = (Date.now() - t0) / 1000;
  await page.waitForFunction(() => !document.getElementById('loading-screen') || document.getElementById('loading-screen').classList.contains('hidden'), null, { timeout: 60000 });
  tl.hidden = (Date.now() - t0) / 1000;
  await shot(page, 'loading-slow-after');
  await page.waitForLoadState('load', { timeout: 90000 }).catch(() => {});
  tl.load = (Date.now() - t0) / 1000;
  tl.imgs = await page.evaluate(() => [...document.images].filter((i) => !i.complete).length);
  note('медленная сеть 1.6 Мбит/с', tl);
  await ctx.close();
}
writeFileSync(OUT + 'small.json', JSON.stringify(res, null, 1));
await browser.close();
