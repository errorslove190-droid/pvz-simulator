import { chromium } from 'playwright';
const b = await chromium.launch();
for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
  const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8804/');
  await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('tutorial-btn').click());
  await p.waitForTimeout(500);
  console.log(vp.width, await p.evaluate(() => {
    const e = document.getElementById('btn-end-acceptance').getBoundingClientRect();
    const bins = ['bin-ours', 'bin-others', 'bin-broken'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; });
    return { end: { top: Math.round(e.top), bottom: Math.round(e.bottom), h: Math.round(e.height) }, gap: Math.round(bins[0].top - e.bottom), bins };
  }));
  await ctx.close();
}
await b.close();
