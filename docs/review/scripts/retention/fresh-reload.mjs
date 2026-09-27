// Проверка: новый игрок перезагружает страницу во время первой приёмки — что он увидит?
import { chromium } from 'playwright';
const URL_ = 'http://localhost:8805/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
await p.goto(URL_);
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
await p.waitForTimeout(500);
const before = await p.evaluate(() => ({ screen: document.querySelector('.screen-card.active').id, ls: localStorage.getItem('pvz_sim_save_v1'), cloud: localStorage.getItem('__ygMockCloud'), ev: __ygMock.events.map(e=>e.name) }));
console.log('before', before.screen, 'ls:', before.ls ? JSON.parse(before.ls).phase : null, 'cloud:', before.cloud ? 'yes' : null, before.ev.join(','));
await p.evaluate(() => localStorage.clear());
await p.goto(URL_);
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
await p.waitForTimeout(800);
const after = await p.evaluate(() => ({ screen: document.querySelector('.screen-card.active').id, ls: localStorage.getItem('pvz_sim_save_v1'), day: gameState.day }));
console.log('after clear+reload', after.screen, 'ls:', after.ls ? JSON.parse(after.ls).phase : null, 'day', after.day);
await browser.close();
