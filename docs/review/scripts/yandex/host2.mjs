// Игра во фрейме на длинной странице: колесо/клавиши/свайп прокручивают площадку? И помогает ли исправление.
import { chromium } from 'playwright';
import { OUT, initScript, playAcceptance, save } from './lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLAGS = ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks'];
const host = (w, h) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;height:3200px;font:16px sans-serif;background:repeating-linear-gradient(#ddd 0 100px,#bbb 100px 200px)">
<div style="height:56px;background:#222;color:#fff;padding:16px;box-sizing:border-box">Площадка: шапка</div>
<iframe id="g" src="http://localhost:8812/?adMs=300" style="width:${w}px;height:${h}px;border:0;display:block" allow="autoplay"></iframe>
<div style="padding:16px">Описание игры, отзывы, похожие игры…</div></body></html>`;
// Предлагаемое исправление (то же, что в отчёте): не отдавать колесо и клавиши прокрутки площадке
const FIX = () => {
  window.addEventListener('wheel', (e) => {
    const sc = e.target.closest && e.target.closest('.shop-cards-scroll-container, #scene-text, .tutorial-card, main');
    if (sc && sc.scrollHeight > sc.clientHeight) sc.scrollTop += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'Home', 'End', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  });
};
const res = {};
const browser = await chromium.launch({ args: FLAGS });

async function open(ctxOpts, w, h) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  await page.route('http://host.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: host(w, h) }));
  await page.goto('http://host.test/');
  let f;
  for (let i = 0; i < 60 && !f; i++) { f = page.frames().find((x) => x.url().includes('localhost:8812')); await sleep(100); }
  await f.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await sleep(600);
  await f.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); });
  await playAcceptance(f, { input: 'eval' });
  await f.evaluate(() => document.getElementById('btn-summary-continue').click());
  await sleep(1000);
  await f.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); });
  return { ctx, page, f };
}
const hostY = (page) => page.evaluate(() => Math.round(scrollY));

// --- ПК 1280×720 ---
{
  const { ctx, page, f } = await open({ viewport: { width: 1280, height: 720 } }, 1280, 600);
  const run = async (label) => {
    const out = {};
    await page.mouse.click(640, 56 + 250); await sleep(200);
    await page.mouse.move(640, 400); await page.mouse.wheel(0, 800); await sleep(600);
    out.wheel = await hostY(page);
    if (label === 'before') await page.screenshot({ path: OUT + 'pc-iframe-wheel.jpg', type: 'jpeg', quality: 70 });
    for (const k of ['PageDown', 'End', 'ArrowDown', 'Space']) { await page.evaluate(() => scrollTo(0, 0)); await sleep(150); await page.mouse.click(640, 56 + 250); await page.keyboard.press(k); await sleep(400); out[k] = await hostY(page); }
    await page.evaluate(() => scrollTo(0, 0)); await sleep(200);
    return out;
  };
  res.pc = { before: await run('before') };
  await f.evaluate(FIX);
  res.pc.afterFix = await run('after');
  // магазин: колесо над списком до конца и дальше — с исправлением
  await f.evaluate(() => { showDayEnd({ keepDaily: true }); openShopScreen(); if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); });
  await sleep(500);
  await page.mouse.move(640, 56 + 250);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 400); await sleep(150); }
  await sleep(500);
  res.pc.afterFix.shopWheel = await hostY(page);
  res.pc.afterFix.shopListScrolled = await f.evaluate(() => { const s = document.querySelector('.shop-cards-scroll-container'); return Math.round(s.scrollTop) + '/' + (s.scrollHeight - s.clientHeight); });
  await ctx.close();
}
// --- телефон 390×844: свайп внутри фрейма ---
{
  const { ctx, page, f } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 390, 700);
  const cdp = await ctx.newCDPSession(page);
  const swipe = async () => { await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 500, yDistance: -400, gestureSourceType: 'touch', speed: 1500 }); await sleep(700); const y = await hostY(page); await page.evaluate(() => scrollTo(0, 0)); await sleep(200); return y; };
  res.phone = { swipeOnScene: await swipe() };
  await f.evaluate(FIX);
  res.phone.swipeAfterWheelFix = await swipe(); // wheel-исправление на тач не влияет — для контроля
  await ctx.close();
}
save('host2.json', res);
console.log(JSON.stringify(res, null, 1));
await browser.close();
