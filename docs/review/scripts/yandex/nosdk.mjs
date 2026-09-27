// 1) Без SDK: node tools/serve.mjs --no-sdk (порт 8822, поднимается и гасится здесь же).
// 2) Консоль при запуске без единого evaluate до старта (page.evaluate даёт странице «жест» и прячет предупреждение AudioContext).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { PROFILES, OUT, initScript, watchConsole, playAcceptance, playCustomers, save } from './lib.mjs';

const server = spawn(process.execPath, ['tools/serve.mjs', '--port', '8822', '--no-sdk'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = {};
try {
  // ---- 1. без SDK ----
  {
    const ctx = await browser.newContext(PROFILES.pc720);
    await ctx.addInitScript(initScript);
    const p = await ctx.newPage();
    const cons = await watchConsole(p, ctx);
    await p.goto('http://localhost:8822/');
    await sleep(7000); // без evaluate: ждём, пока игра сама снимет экран загрузки
    const marks = await p.evaluate(() => window.__marks);
    const sdk = await p.evaluate(() => ({ ysdk: !!YG.ysdk, player: !!YG.player, booted: YG.booted, screen: document.querySelector('.screen-card.active').id, guide: document.getElementById('tutorial-overlay').classList.contains('show') }));
    await p.click('#tutorial-btn');
    await playAcceptance(p, { input: 'key' });
    await playCustomers(p);
    await p.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); });
    await p.click('#screen-dayend .action-btn');
    await sleep(400);
    await p.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) closeGuide(); });
    await p.click('.shop-tab-pill[data-tab="daily"]');
    await sleep(300);
    await p.click('.shop-ad-btn');
    await sleep(200);
    const toast = await p.evaluate(() => document.getElementById('toast').textContent);
    await p.screenshot({ path: OUT + 'pc720-nosdk-rv-toast.jpg', type: 'jpeg', quality: 70 });
    const t = Date.now();
    await p.click('#screen-shop .action-btn');
    await p.waitForFunction(() => document.getElementById('screen-morning').classList.contains('active') && acceptance && acceptance.running);
    const startDelay = Date.now() - t;
    const saved = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('pvz_sim_save_v1') || 'null'); return s && { phase: s.phase, day: s.day }; });
    res.noSdk = { marks, sdk, rvToast: toast, newDayWithoutAdMs: startDelay, localSave: saved, console: cons.map((c) => `${c.src}/${c.type}: ${c.text}`) };
    await ctx.close();
  }
  // ---- 2. чистый запуск с SDK: телефон и ПК, без evaluate первые 4 с ----
  for (const prof of ['phone', 'pc720', 'pc1080']) {
    const ctx = await browser.newContext(PROFILES[prof]);
    await ctx.addInitScript(initScript);
    const p = await ctx.newPage();
    const cons = await watchConsole(p, ctx);
    await p.goto('http://localhost:8812/');
    await sleep(4000);
    const a = await p.evaluate(() => ({ ctx: audio.ctx && audio.ctx.state, activated: navigator.userActivation.hasBeenActive }));
    res['cleanStart_' + prof] = { audio: a, console: cons.filter((c) => !c.text.startsWith('[yg-mock]')).map((c) => `${c.src}/${c.type}: ${c.text}`) };
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
save('nosdk.json', res);
console.log(JSON.stringify(res, null, 1));
