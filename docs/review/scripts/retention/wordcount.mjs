// Сколько слов читает игрок за визит (разговор) — для оценки времени чтения
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const browser = await chromium.launch();
const p = await (await browser.newContext()).newPage();
await p.goto('http://localhost:8805/');
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
const r = await p.evaluate(() => {
  const w = (s) => (s || '').split(/\s+/).filter(Boolean).length;
  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const out = {};
  const intro = [], greet = [], q = [], chat = [], th = [], silent = [], ans = [];
  VISITORS.forEach((v) => {
    v.intros.forEach((x) => intro.push(w(x))); greet.push(w(v.greeting));
    v.questions.forEach((x) => q.push(w(x))); v.chatter.forEach((x) => chat.push(w(x)));
    (v.talkThoughts || []).forEach((x) => th.push(w(x))); v.silentNotes.forEach((x) => silent.push(w(x)));
    visitorItemSource(v).forEach((it) => (it.replies || []).forEach((x) => ans.push(w(x))));
  });
  out.intro = avg(intro); out.greeting = avg(greet); out.question = avg(q); out.chatter = avg(chat); out.talkThought = avg(th); out.silentNote = avg(silent); out.itemAnswer = avg(ans);
  out.talkVisitWords = out.intro + out.greeting + out.question + out.itemAnswer + out.chatter + out.talkThought;
  out.giveVisitWords = out.intro + out.greeting + out.silentNote;
  // скандал
  const sc = []; SCANDAL_TYPES.forEach((t) => { sc.push(avg(t.intros.map(w)) + avg(t.vLines.map(w)) + avg(t.choices.map((c) => w(c.you) + w(c.vOk) + w(c.narrOk)))); });
  out.scandalWords = avg(sc);
  // Всего слов в данных персонажей
  let total = 0; const walk = (o) => { if (typeof o === 'string') total += w(o); else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => { if (!['id', 'img', 'icon', 'act'].includes(k)) walk(v); }); };
  VISITORS.forEach(walk); out.totalVisitorWords = total;
  return out;
});
console.log(JSON.stringify(r, (k, v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v, 1));
await browser.close();
