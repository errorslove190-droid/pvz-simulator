// Скриншот-доказательство: колесо мыши над сценой прокручивает страницу площадки.
import { chromium } from 'playwright';
import { OUT, initScript, playAcceptance } from './lib.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOST = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;height:3200px;font:16px sans-serif;background:repeating-linear-gradient(#e4e4e4 0 100px,#c9c9c9 100px 200px)">
<div style="height:56px;background:#222;color:#fff;padding:16px;box-sizing:border-box">Площадка (имитация страницы игры): шапка</div>
<iframe id="g" src="http://localhost:8812/?adMs=300" style="width:1280px;height:600px;border:0;display:block"></iframe>
<div style="padding:16px;font-size:22px">Описание игры, отзывы, похожие игры… (страница площадки)</div>
<div id="sy" style="position:fixed;right:10px;top:10px;background:#c00;color:#fff;padding:8px 12px;font:bold 18px sans-serif;border-radius:8px">scrollY площадки = 0</div>
<script>addEventListener('scroll',()=>{document.getElementById('sy').textContent='scrollY площадки = '+Math.round(scrollY)+' px'})</script>
</body></html>`;
const browser = await chromium.launch({ args: ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(initScript);
const page = await ctx.newPage();
await page.route('http://host.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: HOST }));
await page.goto('http://host.test/');
let f; for (let i = 0; i < 60 && !f; i++) { f = page.frames().find((x) => x.url().includes('localhost:8812')); await sleep(100); }
await f.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
await sleep(600);
await f.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); });
await playAcceptance(f, { input: 'eval' });
await f.evaluate(() => document.getElementById('btn-summary-continue').click());
await sleep(1000);
await f.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); });
await sleep(2600);
await page.mouse.move(640, 400);
await page.mouse.wheel(0, 330);
await sleep(700);
console.log('scrollY', await page.evaluate(() => scrollY));
await page.screenshot({ path: OUT + 'pc-iframe-wheel.jpg', type: 'jpeg', quality: 70 });
await browser.close();
