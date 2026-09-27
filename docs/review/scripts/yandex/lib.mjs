// Общие помощники для проверок 02-yandex (черновик, в сборку не идёт).
import { mkdirSync, writeFileSync } from 'node:fs';

export const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
export const IMG = new URL('../../docs/review/img/', import.meta.url).pathname;
mkdirSync(IMG, { recursive: true });
export const save = (name, data) => writeFileSync(OUT + name, JSON.stringify(data, null, 2));

export const PROFILES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  pc720: { viewport: { width: 1280, height: 720 } },
  pc1080: { viewport: { width: 1920, height: 1080 } },
};

// Скрипт до загрузки страницы: помечает каждое событие имитации SDK состоянием игры,
// ловит момент скрытия экрана загрузки, paint/LCP/longtask.
export function initScript() {
  let _m;
  const snap = () => {
    const o = {};
    try {
      const act = document.querySelector('.screen-card.active'); o.screen = act ? act.id.replace('screen-', '') : null;
      const ls = document.getElementById('loading-screen'); o.loading = !!(ls && !ls.classList.contains('hidden'));
      const tov = document.getElementById('tutorial-overlay'); o.guide = !!(tov && tov.classList.contains('show'));
      if (typeof gameState !== 'undefined') o.day = gameState.day;
      if (typeof acceptance !== 'undefined' && acceptance) o.acc = !!acceptance.running;
      if (typeof audio !== 'undefined') { o.ctx = audio.ctx ? audio.ctx.state : null; o.bgmPaused = audio.bgmAudio ? audio.bgmAudio.paused : null; }
      if (typeof YG !== 'undefined') { o.adOpen = YG.adOpen; o.hidden = YG.hidden; }
    } catch (e) {}
    return o;
  };
  window.__snap = snap;
  Object.defineProperty(window, '__ygMock', {
    configurable: true,
    get() { return _m; },
    set(v) {
      _m = v; const orig = v.log;
      v.log = function (name, detail) { orig.call(this, name, detail); Object.assign(this.events[this.events.length - 1], snap()); };
    },
  });
  window.__marks = {};
  const mark = (k) => { if (!(k in window.__marks)) window.__marks[k] = Math.round(performance.now()); };
  window.__mark = mark;
  document.addEventListener('DOMContentLoaded', () => {
    mark('dcl');
    const ls = document.getElementById('loading-screen');
    if (ls) new MutationObserver(() => { if (ls.classList.contains('hidden')) mark('loadingHidden'); }).observe(ls, { attributes: true });
  });
  window.addEventListener('load', () => mark('load'));
  window.__longtasks = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => mark(e.name))).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => { const es = l.getEntries(); window.__marks.lcp = Math.round(es[es.length - 1].startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longtasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  // Проверка контекстного меню: слушатель на window срабатывает после игрового (document)
  window.__ctx = [];
  window.addEventListener('contextmenu', (e) => window.__ctx.push({ prevented: e.defaultPrevented, target: e.target && (e.target.id || e.target.className) }));
}

// Консоль: и console.*, и сообщения самого браузера (Log.entryAdded — туда падает предупреждение AudioContext)
export async function watchConsole(page, ctx) {
  const log = [];
  page.on('console', (m) => log.push({ src: 'console', type: m.type(), text: m.text().slice(0, 300) }));
  page.on('pageerror', (e) => log.push({ src: 'pageerror', type: 'error', text: String(e.message).slice(0, 300) }));
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Log.enable');
    cdp.on('Log.entryAdded', ({ entry }) => log.push({ src: 'browser:' + entry.source, type: entry.level, text: String(entry.text).slice(0, 300), url: entry.url }));
  } catch (e) { log.push({ src: 'harness', type: 'info', text: 'Log.enable failed: ' + e.message }); }
  return log;
}

// Из tools/smoke.mjs: сортирует правильно, пока не соберёт накладную
export async function playAcceptance(p, { input = 'eval' } = {}) {
  const KEY = { ours: 'a', others: 's', broken: 'd' };
  for (let i = 0; i < 400; i++) {
    const st = await p.evaluate(() => {
      if (document.getElementById('tutorial-overlay').classList.contains('show')) return 'guide';
      if (!acceptance || !acceptance.running) return 'done';
      const c = acceptance.current;
      if (!c || c.sorted) return 'wait';
      if (acceptance.invoice.every((x) => x.sorted)) return 'end';
      return 'sort:' + c.expected;
    });
    if (st === 'done') return;
    if (st === 'guide') {
      if (input === 'tap') await p.tap('#tutorial-btn'); else await p.click('#tutorial-btn');
    } else if (st === 'end') {
      if (input === 'tap') await p.tap('#btn-end-acceptance'); else if (input === 'key' || input === 'click') await p.click('#btn-end-acceptance'); else await p.evaluate(() => endAcceptanceNow());
      continue;
    } else if (st.startsWith('sort:')) {
      const exp = st.slice(5);
      if (input === 'key') await p.keyboard.press(KEY[exp]);
      else if (input === 'tap') await p.tap('#bin-' + exp);
      else if (input === 'click') await p.click('#bin-' + exp);
      else await p.evaluate((e) => onSort(e), exp);
    }
    await p.waitForTimeout(st.startsWith('sort:') ? 520 : 150);
  }
  throw new Error('приёмка не закончилась');
}

// Из tools/smoke.mjs: посетители до отчёта смены
export async function playCustomers(p, { onStep } = {}) {
  for (let i = 0; i < 700; i++) {
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
    if (onStep) await onStep(r);
    if (r === 'dayend') return;
    await p.waitForTimeout(r === 'scan' ? 1500 : ['choice', 'continue', 'next', 'doors'].includes(r) ? 700 : 300);
  }
  throw new Error('смена не закончилась');
}

// Разбор журнала имитации SDK
export function analyze(events) {
  const ready = events.filter((e) => e.name === 'LoadingAPI.ready');
  const gp = events.filter((e) => e.name.startsWith('GameplayAPI.'));
  const dups = [];
  for (let i = 1; i < gp.length; i++) if (gp[i].name === gp[i - 1].name) dups.push({ a: gp[i - 1], b: gp[i] });
  const firstStart = gp.find((e) => e.name === 'GameplayAPI.start');
  const ads = events.filter((e) => e.name.startsWith('adv:')).map((ad) => {
    const prev = gp.filter((g) => g.t <= ad.t).pop();
    return { ad: ad.name, t: ad.t, screen: ad.screen, day: ad.day, lastGameplay: prev ? prev.name : null, bgmPaused: ad.bgmPaused, adOpen: ad.adOpen };
  });
  return {
    readyCount: ready.length,
    readyAt: ready[0] && ready[0].t,
    readyWhileLoadingScreen: ready[0] && ready[0].loading,
    firstGameplayStartAt: firstStart && firstStart.t,
    readyBeforeFirstStart: ready[0] && firstStart ? ready[0].t <= firstStart.t : null,
    starts: gp.filter((e) => e.name === 'GameplayAPI.start').length,
    stops: gp.filter((e) => e.name === 'GameplayAPI.stop').length,
    duplicates: dups.length,
    dupSamples: dups.slice(0, 5),
    startsOnMenu: gp.filter((e) => e.name === 'GameplayAPI.start' && ['dayend', 'shop'].includes(e.screen)).length,
    stopsOutsideMenu: gp.filter((e) => e.name === 'GameplayAPI.stop' && !['dayend', 'shop'].includes(e.screen)).map((e) => ({ t: e.t, screen: e.screen, adOpen: e.adOpen, hidden: e.hidden })),
    ads,
    adsWhileGameplayActive: ads.filter((a) => a.lastGameplay === 'GameplayAPI.start').length,
    setData: events.filter((e) => e.name === 'player.setData').length,
  };
}

export const compactEvents = (events) => events.map((e) => `${String(e.t).padStart(7)} ${e.name.padEnd(18)} ${e.screen || ''}${e.day ? ' d' + e.day : ''}${e.detail ? ' ' + JSON.stringify(e.detail) : ''}${e.adOpen ? ' adOpen' : ''}${e.hidden ? ' hidden' : ''}${e.guide ? ' guide' : ''}${e.loading ? ' LOADING' : ''}`);

export const hideTab = (p) => p.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
export const showTab = (p) => p.evaluate(() => {
  delete document.hidden; delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
});
export const state = (p) => p.evaluate(() => ({
  screen: (document.querySelector('.screen-card.active') || {}).id,
  timer: (document.getElementById('hud-timer') || {}).textContent,
  timeLeft: (typeof acceptance !== 'undefined' && acceptance) ? acceptance.stats.timeLeft : null,
  accPaused: (typeof acceptance !== 'undefined' && acceptance) ? !!acceptance._paused : null,
  ctx: audio.ctx ? audio.ctx.state : null,
  bgmPaused: audio.bgmAudio ? audio.bgmAudio.paused : null,
  bgmTime: audio.bgmAudio ? +audio.bgmAudio.currentTime.toFixed(2) : null,
  hidden: YG.hidden, adOpen: YG.adOpen, gameplayActive: YG.gameplayActive,
  sceneLines: document.querySelectorAll('#scene-text .scene-line').length,
  sceneIdx: typeof sceneIdx !== 'undefined' ? sceneIdx : null,
  sceneQueueLen: typeof sceneQueue !== 'undefined' ? sceneQueue.length : null,
}));
