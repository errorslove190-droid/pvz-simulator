import { chromium } from 'playwright';
const b = await chromium.launch();
for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8804/?adMs=300');
  await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await p.waitForTimeout(600);
  await p.evaluate(() => { gameState.guidesSeen = { acceptance: true, issue: true, dayend: true, shop: true, courier: true }; document.getElementById('tutorial-btn').click(); });
  for (let i = 0; i < 200; i++) {
    const st = await p.evaluate(() => { if (!acceptance.running) return 'done'; if (acceptance.invoice.every((x) => x.sorted)) { endAcceptanceNow(); return 'done'; } const c = acceptance.current; if (c && !c.sorted) onSort(c.expected); return 's'; });
    if (st === 'done') break; await p.waitForTimeout(500);
  }
  await p.evaluate(() => document.getElementById('btn-summary-continue').click());
  await p.waitForFunction(() => document.querySelectorAll('.scene-choice:not(.disabled)').length === 3, null, { timeout: 20000 });
  // «Отказать» → «Стоять на своём»: 4 длинные строки
  await p.evaluate(() => [...document.querySelectorAll('.scene-choice')].find((x) => /Отказать/.test(x.innerText)).click());
  await p.waitForFunction(() => document.querySelectorAll('.scene-choice:not(.disabled)').length === 2, null, { timeout: 20000 });
  await p.evaluate(() => [...document.querySelectorAll('.scene-choice')].find((x) => /Стоять/.test(x.innerText)).click());
  await p.waitForFunction(() => document.getElementById('btn-scene-continue'), null, { timeout: 30000 });
  await p.waitForTimeout(600);
  const m = await p.evaluate(() => {
    const n = document.querySelector('.scene-narration'); const lines = [...document.querySelectorAll('#scene-text .scene-line')];
    const nr = n.getBoundingClientRect(); const last = lines[lines.length - 1].getBoundingClientRect();
    return { narr: { top: Math.round(nr.top), bottom: Math.round(nr.bottom), sh: n.scrollHeight, ch: n.clientHeight, scrollTop: n.scrollTop }, lastLine: { top: Math.round(last.top), bottom: Math.round(last.bottom), text: lines[lines.length - 1].innerText.slice(0, 60) }, lastVisible: last.bottom <= nr.bottom + 1 };
  });
  console.log(vp.width + 'x' + vp.height, JSON.stringify(m));
  await p.screenshot({ path: `work/playtest/shots/narr-${vp.width}.jpg`, type: 'jpeg', quality: 70 });
  await ctx.close();
}
await b.close();
