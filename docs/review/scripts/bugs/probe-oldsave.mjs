import { launch, BASE } from './lib.mjs';
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const old1 = { v: 1, t: Date.now(), phase: 'dayend', day: 9, money: 500, rating: 3.6, warehouseCapacity: 6, upg: { routine: 0, scanner: 0 }, expansion: { rack1: true, rack2: false, cctv: false }, daily: { coffee: false, wrap: false, gloves: false, candy: false, promo: false }, tutorialShown: true, dayGross: 300, shelfParcels: [] };
// подкладываем сейв ДО загрузки игры: страница-пустышка того же origin
await p.route(BASE + 'blank.html', (r) => r.fulfill({ body: '<html></html>', contentType: 'text/html' }));
await p.goto(BASE + 'blank.html');
await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('pvz_sim_save_v1', s); }, JSON.stringify(old1));
await p.goto(BASE + '?adMs=200');
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
await p.waitForTimeout(800);
console.log(await p.evaluate(() => ({ scr: document.querySelector('.screen-card.active').id, day: gameState.day, money: gameState.money, exp: document.getElementById('dayend-expenses').textContent, last: gameState._lastExpenseDay })));
await b.close();
