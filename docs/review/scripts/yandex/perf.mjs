// Загрузка собранного файла: время до LoadingAPI.ready и до первого экрана, с замедлением CPU ×4 и сетью Fast 3G.
// Без сжатия — tools/serve.mjs на 8812; со сжатием gzip (как отдаёт CDN) — встроенный сервер на 8832.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { PROFILES, OUT, initScript, playAcceptance, playCustomers, save } from './lib.mjs';

const html = readFileSync(new URL('./dist/index.html', import.meta.url));
const gz = gzipSync(html, { level: 6 });
const mock = readFileSync(new URL('../../tools/sdk-mock.js', import.meta.url));
const gzServer = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/sdk.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(mock); }
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' }); return res.end(gz); }
  res.writeHead(404).end();
}).listen(8832);

// DevTools: Fast 3G = 1,6 Мбит/с ×0,9 вниз, 750 кбит/с ×0,9 вверх, задержка 150 мс ×3,75
const FAST3G = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1e6 / 8) * 0.9, uploadThroughput: (750 * 1e3 / 8) * 0.9 };
// DevTools: Fast 4G = 9 Мбит/с ×0,9 вниз, 1,5 Мбит/с ×0,9 вверх, задержка 60 мс ×2,75
const FAST4G = { offline: false, latency: 165, downloadThroughput: (9 * 1e6 / 8) * 0.9, uploadThroughput: (1.5 * 1e6 / 8) * 0.9 };
const ALL_CONFIGS = [
  { name: 'телефон, Fast 4G, gzip', prof: 'phone', url: 'http://localhost:8832/', net: FAST4G, tag: '4g' },
  { name: 'телефон, Fast 4G, без сжатия', prof: 'phone', url: 'http://localhost:8812/', net: FAST4G, tag: '4g' },
  { name: 'телефон, CPU ×4 + Fast 4G, gzip', prof: 'phone', url: 'http://localhost:8832/', cpu: 4, net: FAST4G, tag: '4g' },
  { name: 'ПК, без замедления', prof: 'pc720', url: 'http://localhost:8812/' },
  { name: 'телефон, без замедления', prof: 'phone', url: 'http://localhost:8812/' },
  { name: 'телефон, CPU ×4', prof: 'phone', url: 'http://localhost:8812/', cpu: 4 },
  { name: 'телефон, Fast 3G, без сжатия', prof: 'phone', url: 'http://localhost:8812/', net: FAST3G },
  { name: 'телефон, Fast 3G, gzip', prof: 'phone', url: 'http://localhost:8832/', net: FAST3G },
  { name: 'телефон, CPU ×4 + Fast 3G, gzip', prof: 'phone', url: 'http://localhost:8832/', cpu: 4, net: FAST3G, shot: true },
  { name: 'телефон, CPU ×4 + Fast 3G, без сжатия', prof: 'phone', url: 'http://localhost:8812/', cpu: 4, net: FAST3G },
];
const ONLY = process.argv[2];
const CONFIGS = ALL_CONFIGS.filter((c) => (ONLY ? c.tag === ONLY : !c.tag));

const browser = await chromium.launch();
const bcdp = await browser.newBrowserCDPSession();
async function rendererRssMB() {
  try {
    const { processInfo } = await bcdp.send('SystemInfo.getProcessInfo');
    const pids = processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
    const rss = pids.map((pid) => { try { return Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024; } catch { return 0; } });
    return +Math.max(...rss).toFixed(0);
  } catch (e) { return 'n/a: ' + e.message; }
}

const results = [];
for (const c of CONFIGS) {
  const ctx = await browser.newContext(PROFILES[c.prof]);
  await ctx.addInitScript(initScript);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (c.net) await cdp.send('Network.emulateNetworkConditions', c.net);
  if (c.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.cpu });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  const t0 = Date.now();
  await p.goto(c.url, { waitUntil: 'commit', timeout: 120000 });
  if (c.shot) { await p.waitForTimeout(6000); await p.screenshot({ path: OUT + 'phone-loading-slow.jpg', type: 'jpeg', quality: 70 }); }
  await p.waitForFunction(() => window.__ygMock && __ygMock.events.some((e) => e.name === 'LoadingAPI.ready'), null, { timeout: 120000, polling: 250 });
  await p.waitForFunction(() => 'loadingHidden' in window.__marks, null, { timeout: 120000, polling: 250 });
  const wall = Date.now() - t0;
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const ready = __ygMock.events.find((e) => e.name === 'LoadingAPI.ready');
    const lt = window.__longtasks || [];
    return {
      responseStart: Math.round(nav.responseStart), responseEnd: Math.round(nav.responseEnd),
      dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
      fcp: window.__marks['first-contentful-paint'], ready: ready && ready.t, loadingHidden: window.__marks.loadingHidden,
      longTasks: lt.length, longTaskMax: Math.max(0, ...lt.map((x) => x[1])), longTaskSum: lt.reduce((s, x) => s + x[1], 0),
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  });
  r.transferKB = Math.round(bytes / 1024);
  r.wallMs = wall;
  r.rssMB = await rendererRssMB();
  if (!c.cpu && !c.net && c.prof === 'pc720') {
    // память после полного дня
    await p.click('#tutorial-btn');
    await playAcceptance(p, { input: 'eval' });
    await playCustomers(p);
    await p.waitForTimeout(500);
    r.afterDay1 = { heapMB: await p.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)), rssMB: await rendererRssMB() };
  }
  results.push({ config: c.name, ...r });
  console.log(c.name, JSON.stringify(r));
  await ctx.close();
}
save(ONLY ? `perf-${ONLY}.json` : 'perf.json', { htmlBytes: html.length, gzipBytes: gz.length, results });
await browser.close();
gzServer.close();
