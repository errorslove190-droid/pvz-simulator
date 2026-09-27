// Проверка: что происходит, если отпустить штрихкод раньше времени (палец / мышь)
import { chromium } from 'playwright';
const browser = await chromium.launch();
for (const mode of ['touch', 'mouse']) {
  const touch = mode === 'touch';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto('http://localhost:8804/?adMs=300');
  await page.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.getElementById('tutorial-btn').click(); });
  // быстрая приёмка
  for (let i = 0; i < 200; i++) {
    const st = await page.evaluate(() => {
      if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'g'; }
      if (!acceptance.running) return 'done';
      if (acceptance.invoice.every((x) => x.sorted)) { endAcceptanceNow(); return 'done'; }
      const c = acceptance.current; if (c && !c.sorted) onSort(c.expected); return 's';
    });
    if (st === 'done') break;
    await page.waitForTimeout(520);
  }
  await page.evaluate(() => document.getElementById('btn-summary-continue').click());
  await page.waitForTimeout(700);
  await page.evaluate(() => { if (document.getElementById('tutorial-overlay').classList.contains('show')) document.getElementById('tutorial-btn').click(); finishScene(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { tapScene(); });
  await page.evaluate(() => { const b = document.querySelector('.scene-choice'); if (b) b.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { finishScene(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('btn-scene-continue').click());
  await page.waitForTimeout(800);
  const code = await page.evaluate(() => gameState.activeVisitor.orderCode);
  const slot = await page.evaluate((c) => [...document.querySelectorAll('.wh-plate-num')].find((p) => p.textContent === '#' + c).dataset.slot, code);
  if (touch) await page.locator(`.wh-box[data-slot="${slot}"]`).tap(); else await page.locator(`.wh-box[data-slot="${slot}"]`).click();
  await page.waitForTimeout(600);
  const box = await page.locator('#scan-bc-wrap').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const probe = () => page.evaluate(() => ({ hint: document.getElementById('scan-hint').textContent, w: document.getElementById('scan-progress').style.width, timer: !!(scanState && scanState.timer), progress: scanState && Math.round(scanState.progress) }));
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(600);
    console.log(mode, 'во время удержания', await probe());
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(600);
    console.log(mode, 'во время удержания', await probe());
    await page.mouse.up();
  }
  await page.waitForTimeout(100);
  console.log(mode, 'сразу после отпускания', await probe());
  await page.waitForTimeout(1500);
  console.log(mode, 'через 1.5 с после отпускания', await probe());
  // палец соскользнул с штрихкода (движение за пределы) — отпускание вне элемента
  await ctx.close();
}
await browser.close();
