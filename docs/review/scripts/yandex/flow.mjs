// 3 полных дня на телефоне и компьютере: журнал SDK, пауза, реклама, консоль, скриншоты.
// node work/yandex/flow.mjs [phone|pc720|pc1080 ...]   (сервер: node tools/serve.mjs --port 8802)
import { chromium } from 'playwright';
import { PROFILES, OUT, initScript, watchConsole, playAcceptance, playCustomers, analyze, compactEvents, hideTab, showTab, state, save } from './lib.mjs';

const BASE = process.env.BASE || 'http://localhost:8802/';
const which = process.argv.slice(2).length ? process.argv.slice(2) : ['phone', 'pc720', 'pc1080'];
const INPUT = { phone: 'tap', pc720: 'key', pc1080: 'click' };
const browser = await chromium.launch();

async function shot(p, name) { await p.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 70 }); }
const clickish = (p, prof, sel) => (prof === 'phone' ? p.tap(sel) : p.click(sel));

for (const prof of which) {
  const ctx = await browser.newContext(PROFILES[prof]);
  await ctx.addInitScript(initScript);
  const p = await ctx.newPage();
  const cons = await watchConsole(p, ctx);
  const checks = {};
  const t0 = Date.now();
  await p.goto(BASE + '?adMs=1500');
  await p.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await p.waitForFunction(() => 'loadingHidden' in window.__marks, null, { timeout: 15000 });
  checks.marks = await p.evaluate(() => window.__marks);
  checks.beforeGesture = await state(p);
  checks.userActivationBefore = await p.evaluate(() => navigator.userActivation && navigator.userActivation.hasBeenActive);
  if (prof !== 'phone') await shot(p, `${prof}-guide`);

  for (let day = 1; day <= 3; day++) {
    // --- приёмка ---
    if (prof === 'phone' && day === 2) {
      // пауза платформы (game_api_pause) посреди приёмки
      await p.waitForFunction(() => acceptance && acceptance.running && acceptance.startedAt && acceptance.current);
      await p.waitForTimeout(1200);
      const a = await state(p);
      await p.evaluate(() => __ygMock.pause());
      await p.waitForTimeout(300);
      const b1 = await state(p);
      await p.waitForTimeout(3000);
      const b2 = await state(p);
      await p.evaluate(() => __ygMock.resume());
      await p.waitForTimeout(1300);
      const c = await state(p);
      checks.pauseDuringAcceptance = { before: a, paused300ms: b1, paused3s: b2, resumed: c };
      // уход со вкладки (эмуляция document.hidden) посреди приёмки
      await p.waitForTimeout(500);
      const d = await state(p);
      await hideTab(p);
      await p.waitForTimeout(300);
      const e1 = await state(p);
      await p.waitForTimeout(3000);
      const e2 = await state(p);
      await showTab(p);
      await p.waitForTimeout(1300);
      const f = await state(p);
      checks.hiddenDuringAcceptance = { before: d, hidden300ms: e1, hidden3s: e2, visible: f };
      // настоящее переключение вкладки: новая страница на передний план
      const p2 = await ctx.newPage();
      await p2.bringToFront();
      await p.waitForTimeout(600);
      checks.realTabSwitch = { visibilityAfterOtherTab: await p.evaluate(() => document.visibilityState), state: await state(p) };
      await p.bringToFront();
      await p2.close();
      await p.waitForTimeout(600);
      checks.realTabSwitch.back = await p.evaluate(() => document.visibilityState);
    }
    if (prof === 'pc1080' && day === 1) {
      await p.waitForFunction(() => document.getElementById('tutorial-overlay').classList.contains('show'));
      await p.click('#tutorial-btn');
      await p.waitForTimeout(1600);
      await shot(p, `${prof}-acceptance`);
    }
    await playAcceptance(p, { input: day === 1 ? INPUT[prof] : 'eval' });
    if (day === 1) {
      checks.afterGesture = await state(p);
      checks.userActivationAfter = await p.evaluate(() => navigator.userActivation && navigator.userActivation.hasBeenActive);
      if (prof === 'pc720') await shot(p, `${prof}-acceptance-summary`);
    }

    // --- посетители ---
    if (prof === 'phone' && day === 2) {
      // уход со вкладки, пока реплики сцены появляются сами (SCENE_AUTO_MS = 2,4 с)
      await p.evaluate(() => document.getElementById('btn-summary-continue').click());
      await p.waitForFunction(() => document.getElementById('screen-scene').classList.contains('active') && sceneQueue.length && sceneIdx < sceneQueue.length && sceneTimer, null, { timeout: 5000 }).catch(() => {});
      const s0 = await state(p);
      await hideTab(p);
      await p.waitForTimeout(5000);
      const s1 = await state(p);
      await showTab(p);
      await p.waitForTimeout(3500);
      const s2 = await state(p);
      checks.hiddenDuringScene = { before: s0, hidden5s: s1, visible3_5s: s2 };
    }
    let shotScene = false, shotWh = false;
    await playCustomers(p, {
      onStep: async (r) => {
        if (prof === 'phone') return;
        const act = await p.evaluate(() => document.querySelector('.screen-card.active').id);
        if (!shotScene && act === 'screen-scene' && day === 1) { shotScene = true; await p.waitForTimeout(400); await shot(p, `${prof}-scene`); }
        if (!shotWh && act === 'screen-warehouse' && day === 1) { shotWh = true; await p.waitForTimeout(400); await shot(p, `${prof}-warehouse`); }
      },
    });
    if (day === 1 && prof !== 'phone') await shot(p, `${prof}-dayend`);

    // --- отчёт → магазин → реклама за вознаграждение ---
    if (day === 1) {
      await p.waitForTimeout(400);
      if (await p.evaluate(() => document.getElementById('tutorial-overlay').classList.contains('show'))) await clickish(p, prof, '#tutorial-btn');
      await clickish(p, prof, '#screen-dayend .action-btn');
      await p.waitForTimeout(500);
      if (await p.evaluate(() => document.getElementById('tutorial-overlay').classList.contains('show'))) await clickish(p, prof, '#tutorial-btn');
      await clickish(p, prof, '.shop-tab-pill[data-tab="daily"]');
      await p.waitForTimeout(300);
      await shot(p, `${prof}-shop-daily`);
      const adBtns = await p.$$('.shop-ad-btn');
      checks.shopAdButtons = adBtns.length;
      const before = await state(p);
      await adBtns[0].click();
      await p.waitForTimeout(350);
      const mid = await state(p);
      if (prof === 'phone') await shot(p, `${prof}-rewarded-mock`);
      await p.waitForTimeout(1700);
      const after = await state(p);
      checks.shopRewarded = { before, mid, after, daily: await p.evaluate(() => gameState.daily) };
      // новый день из магазина — полноэкранная реклама
      await clickish(p, prof, '#screen-shop .action-btn');
      await p.waitForTimeout(350);
      const imid = await state(p);
      await p.waitForTimeout(1800);
      checks.interstitialDay2 = { mid: imid, after: await state(p) };
    } else {
      // «Начать день (без покупок)» прямо с отчёта
      const ts = Date.now();
      await clickish(p, prof, '#screen-dayend .dayend-next-btn');
      await p.waitForTimeout(350);
      checks['startDay' + (day + 1)] = { mid: await state(p), sinceStartS: Math.round((ts - t0) / 1000) };
      await p.waitForTimeout(1800);
    }
  }
  const events = await p.evaluate(() => __ygMock.events);
  const mem = await p.evaluate(() => performance.memory ? { usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) } : null);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  const pm = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  checks.memoryAfter3Days = { ...mem, JSHeapUsedMB: +(pm.JSHeapUsedSize / 1048576).toFixed(1), Nodes: pm.Nodes, JSEventListeners: pm.JSEventListeners, Documents: pm.Documents };
  checks.scroll = await p.evaluate(() => ({ htmlTop: document.documentElement.scrollTop, bodyTop: document.body.scrollTop, gcTop: document.getElementById('game-container').scrollTop, scrollH: document.documentElement.scrollHeight, innerH: innerHeight }));
  const result = { profile: prof, durationS: Math.round((Date.now() - t0) / 1000), analysis: analyze(events), checks, console: cons.filter((c) => !c.text.startsWith('[yg-mock]')), mockConsoleLines: cons.filter((c) => c.text.startsWith('[yg-mock]')).length, journal: compactEvents(events) };
  save(`flow-${prof}.json`, result);
  console.log(`== ${prof}: ${result.durationS} s, ready x${result.analysis.readyCount}, start ${result.analysis.starts}/stop ${result.analysis.stops}, dups ${result.analysis.duplicates}, ads ${result.analysis.ads.map((a) => a.ad + '@' + a.screen + '/' + a.lastGameplay).join(', ')}, console ${result.console.length}`);
  await ctx.close();
}
await browser.close();
