import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 900, height: 520 } });
await p.goto('http://localhost:8804/');
await p.waitForFunction(() => typeof VISITORS !== 'undefined');
await p.evaluate(() => {
  document.body.innerHTML = '<div id="g" style="display:flex;flex-wrap:wrap;gap:4px;background:#fff;padding:4px"></div>';
  const g = document.getElementById('g');
  for (const v of VISITORS) { const d = document.createElement('div'); d.style.cssText = 'width:140px;font:12px sans-serif;text-align:center'; d.innerHTML = '<img src="' + v.img + '" style="height:150px;max-width:140px;object-fit:contain"><br>' + v.name + ' (' + v.id + ')'; g.appendChild(d); }
});
await p.waitForTimeout(1500);
await p.screenshot({ path: 'work/playtest/shots/all-visitors.jpg', type: 'jpeg', quality: 70, fullPage: true });
await b.close();
