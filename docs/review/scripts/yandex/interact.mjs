// Прокрутка страницы-площадки вокруг iframe, контекстное меню, выделение, клавиатура, ориентация.
// Серверы: 8802 (src) и 8812 (dist), оба с имитацией SDK.
import { chromium } from 'playwright';
import { PROFILES, OUT, IMG, initScript, watchConsole, playAcceptance, state, save } from './lib.mjs';

const browser = await chromium.launch();
const res = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. Компьютер: игра в iframe на длинной странице, как на yandex.ru/games ----------
{
  const HOST = `<!doctype html><html><head><meta charset="utf-8"><title>host</title></head>
  <body style="margin:0;height:3200px;font:16px sans-serif;background:linear-gradient(#e8e8e8,#777)">
  <div style="height:56px;background:#222;color:#fff;padding:16px">Площадка (имитация страницы игры)</div>
  <iframe id="g" src="http://localhost:8812/?adMs=300" style="width:1280px;height:600px;border:0;display:block" allow="autoplay; fullscreen"></iframe>
  <div style="padding:16px">Описание игры, похожие игры…</div></body></html>`;
  // флаги: без них Chromium не пускает страницу host.test во фрейм localhost (Local Network Access)
  const hb = await chromium.launch({ args: ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks'] });
  const ctx = await hb.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  await page.route('http://host.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: HOST }));
  await page.goto('http://host.test/');
  const fr = () => page.frames().find((f) => f.url().includes('localhost:8812'));
  await page.waitForFunction(() => true);
  for (let i = 0; i < 50 && !fr(); i++) await sleep(100);
  const f = fr();
  await f.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await sleep(800);
  const hostY = () => page.evaluate(() => Math.round(scrollY));
  const log = [];
  const tryKey = async (label, key) => { const b = await hostY(); await page.keyboard.press(key); await sleep(350); log.push({ label, key, hostScrollBefore: b, hostScrollAfter: await hostY() }); await page.evaluate(() => scrollTo(0, 0)); await sleep(100); };
  // клик внутрь игры — фокус в iframe (кнопка обучения)
  await page.click('#g', { position: { x: 640, y: 560 } }).catch(() => {});
  await sleep(300);
  const guide = await f.evaluate(() => document.getElementById('tutorial-overlay').classList.contains('show'));
  if (guide) { const b = await f.$('#tutorial-btn'); await b.click(); await sleep(400); }
  const focusedInFrame = await f.evaluate(() => document.hasFocus());
  // приёмка идёт: стрелки заняты игрой (preventDefault), остальное — нет
  for (const k of ['ArrowDown', 'Space', 'PageDown', 'End', 'ArrowUp']) await tryKey('acceptance', k);
  // клик по «пустому» месту игры (фон), чтобы фокус был на body, не на кнопке
  await page.mouse.click(40 + 340, 56 + 120); await sleep(200);
  for (const k of ['Space', 'PageDown', 'End']) await tryKey('acceptance, фокус на фоне', k);
  // колесо мыши над игрой
  { const b = await hostY(); await page.mouse.move(640, 400); await page.mouse.wheel(0, 800); await sleep(500); log.push({ label: 'wheel над игрой (приёмка)', hostScrollBefore: b, hostScrollAfter: await hostY() }); await page.evaluate(() => scrollTo(0, 0)); }
  // доиграть приёмку и перейти к сцене — там стрелки игрой не заняты
  await playAcceptance(f, { input: 'eval' });
  await f.evaluate(() => document.getElementById('btn-summary-continue').click());
  await sleep(900);
  await page.mouse.click(640, 56 + 300); await sleep(200);
  for (const k of ['ArrowDown', 'Space', 'PageDown', 'End']) await tryKey('сцена посетителя', k);
  { const b = await hostY(); await page.mouse.move(640, 400); await page.mouse.wheel(0, 800); await sleep(500); log.push({ label: 'wheel над игрой (сцена)', hostScrollBefore: b, hostScrollAfter: await hostY() }); await page.evaluate(() => scrollTo(0, 0)); }
  // магазин: внутри есть свой прокручиваемый список
  await f.evaluate(() => { showDayEnd({ keepDaily: true }); openShopScreen(); if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); });
  await sleep(500);
  { const b = await hostY(); await page.mouse.move(640, 300); for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 400); await sleep(120); } await sleep(500); log.push({ label: 'wheel над списком магазина (до конца списка и дальше)', hostScrollBefore: b, hostScrollAfter: await hostY(), shopScroll: await f.evaluate(() => { const s = document.querySelector('.shop-cards-scroll-container'); return s ? Math.round(s.scrollTop) + '/' + (s.scrollHeight - s.clientHeight) : null; }) }); }
  await page.evaluate(() => scrollTo(0, 0)); await sleep(200);
  await page.mouse.click(640, 56 + 100); await sleep(200);
  for (const k of ['ArrowDown', 'Space', 'End']) await tryKey('магазин', k);
  // Tab-навигация: не сдвигает ли фокус внутреннюю раскладку
  const before = await f.evaluate(() => ({ gc: document.getElementById('game-container').scrollTop, html: document.documentElement.scrollTop, hud: Math.round(document.getElementById('game-hud').getBoundingClientRect().top) }));
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); await sleep(60); }
  const after = await f.evaluate(() => ({ gc: document.getElementById('game-container').scrollTop, html: document.documentElement.scrollTop, hud: Math.round(document.getElementById('game-hud').getBoundingClientRect().top), focused: document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) }));
  res.hostIframe = { focusedInFrame, keys: log, tab: { before, after, hostScroll: await hostY() } };
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: OUT + 'host-iframe-shop.jpg', type: 'jpeg', quality: 70 });
  await ctx.close();
  await hb.close();
}

// ---------- 2. Компьютер 1280×720: правый клик, выделение текста ----------
{
  const ctx = await browser.newContext(PROFILES.pc720);
  await ctx.addInitScript(initScript);
  const p = await ctx.newPage();
  await p.goto('http://localhost:8802/?adMs=300');
  await p.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await sleep(600);
  await p.click('#tutorial-btn');
  await sleep(500);
  const pts = [['таймер приёмки', '#hud-timer'], ['корзина', '#bin-ours'], ['фон слева от колонки', null]];
  for (const [label, sel] of pts) {
    if (sel) await p.click(sel, { button: 'right' }); else await p.mouse.click(100, 400, { button: 'right' });
    await sleep(100);
  }
  const ctxm = await p.evaluate(() => window.__ctx);
  // выделение: тройной клик по тексту и Ctrl+A
  await p.click('#bin-ours .sort-bin-hint', { clickCount: 3 });
  const sel1 = await p.evaluate(() => String(getSelection()).length);
  await p.keyboard.press('Control+A');
  const sel2 = await p.evaluate(() => String(getSelection()).length);
  const us = await p.evaluate(() => ({ body: getComputedStyle(document.body).userSelect, sceneText: getComputedStyle(document.getElementById('scene-text')).userSelect, callout: getComputedStyle(document.body).webkitTouchCallout }));
  // перетаскивание картинки коробки (drag ghost)
  const imgDraggable = await p.evaluate(() => { const i = document.querySelector('#sort-zone img'); return i ? { draggable: i.draggable, dragCss: getComputedStyle(i).webkitUserDrag } : null; });
  res.pcInput = { contextmenu: ctxm, selectionTripleClick: sel1, selectionCtrlA: sel2, userSelect: us, imgDraggable };
  await ctx.close();
}

// ---------- 3. Телефон: лонгтап, альбомная ориентация ----------
{
  const ctx = await browser.newContext(PROFILES.phone);
  await ctx.addInitScript(initScript);
  const p = await ctx.newPage();
  await p.goto('http://localhost:8802/?adMs=300');
  await p.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await sleep(600);
  await p.tap('#tutorial-btn');
  await sleep(600);
  const cdp = await ctx.newCDPSession(p);
  const longTap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(1200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
  };
  const box = await p.locator('#bin-others').boundingBox();
  await longTap(box.x + box.width / 2, box.y + box.height / 2);
  const hud = await p.locator('#hud-timer').boundingBox();
  await longTap(hud.x + 10, hud.y + 5);
  const lt = { contextmenu: await p.evaluate(() => window.__ctx), selection: await p.evaluate(() => String(getSelection()).length) };
  // свайп по экрану (прокрутка жестом)
  await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 500, yDistance: -500, gestureSourceType: 'touch', speed: 1200 }).catch((e) => (lt.swipeErr = e.message));
  await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 300, yDistance: 500, gestureSourceType: 'touch', speed: 1200 }).catch((e) => (lt.swipeErr2 = e.message));
  lt.afterSwipe = await p.evaluate(() => ({ html: document.documentElement.scrollTop, body: document.body.scrollTop, gc: document.getElementById('game-container').scrollTop, main: document.querySelector('main').scrollTop, hudTop: Math.round(document.getElementById('game-hud').getBoundingClientRect().top) }));
  res.phoneTouch = lt;
  // альбомная ориентация посреди приёмки
  const a0 = await state(p);
  await p.setViewportSize({ width: 844, height: 390 });
  await sleep(1500);
  const a1 = await state(p);
  const hint = await p.evaluate(() => ({ mq: matchMedia('(orientation: landscape) and (max-height: 500px) and (hover: none) and (pointer: coarse)').matches, display: getComputedStyle(document.getElementById('rotate-hint')).display, hover: matchMedia('(hover: none)').matches, coarse: matchMedia('(pointer: coarse)').matches }));
  await p.screenshot({ path: OUT + 'phone-landscape.jpg', type: 'jpeg', quality: 70 });
  await sleep(2000);
  const a2 = await state(p);
  await p.setViewportSize({ width: 390, height: 844 });
  await sleep(1200);
  const a3 = await state(p);
  res.landscape = { before: a0, landscape: a1, hint, landscape3_5s: a2, portraitAgain: a3, events: await p.evaluate(() => __ygMock.events.filter((e) => e.name.startsWith('GameplayAPI')).map((e) => e.name + '@' + e.t + (e.hidden ? ' hidden' : ''))) };
  await ctx.close();
}

// ---------- 4. Телефон: игра открыта сразу в альбомной, сейв посреди дня (фаза customers) ----------
{
  const ctx = await browser.newContext({ ...PROFILES.phone, viewport: { width: 844, height: 390 } });
  await ctx.addInitScript(initScript);
  const p = await ctx.newPage();
  // подготовить сейв: пройти приёмку в портрете в отдельной вкладке того же контекста
  const prep = await ctx.newPage();
  await prep.setViewportSize({ width: 390, height: 844 });
  await prep.goto('http://localhost:8802/?adMs=300');
  await prep.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await sleep(500);
  await playAcceptance(prep, { input: 'eval' });
  await sleep(300);
  await prep.close();
  await p.goto('http://localhost:8802/?adMs=300');
  await sleep(1500);
  const s1 = await state(p);
  await sleep(5000);
  const s2 = await state(p);
  const ev = await p.evaluate(() => __ygMock.events.map((e) => e.name + '@' + e.t + (e.hidden ? ' hidden' : '')));
  res.openedInLandscape = { after1_5s: s1, after6_5s: s2, events: ev, hintShown: await p.evaluate(() => getComputedStyle(document.getElementById('rotate-hint')).display) };
  await ctx.close();
}

save('interact.json', res);
console.log(JSON.stringify(res, null, 1).slice(0, 6000));
await browser.close();
