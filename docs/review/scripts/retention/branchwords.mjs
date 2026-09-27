// Сколько текста живёт в каждой ветке диалога (и как часто игрок туда попадает)
import { chromium } from 'playwright';
const browser = await chromium.launch();
const p = await (await browser.newContext()).newPage();
await p.goto('http://localhost:8805/');
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
const r = await p.evaluate(() => {
  const w = (s) => (s || '').split(/\s+/).filter(Boolean).length;
  const walk = (o) => { if (typeof o === 'string') return w(o); if (Array.isArray(o)) return o.reduce((s, x) => s + walk(x), 0); if (o && typeof o === 'object') return Object.entries(o).reduce((s, [k, v]) => s + (['id', 'img', 'icon', 'act'].includes(k) ? 0 : walk(v)), 0); return 0; };
  const B = { always: ['intros', 'greeting'], talk: ['questions', 'chatter', 'talkThoughts'], give: ['silentNotes'], refuse: ['objections', 'refuseLines', 'thoughts', 'refuseThoughts', 'hardEnds', 'giveEnds', 'refuseFollow'], lost: ['lostSearch', 'lostReactions', 'lostThoughts', 'lostFollow', 'lostEnds'], ui: ['choices', 'name'] };
  const res = {}; let lines = {};
  for (const [b, keys] of Object.entries(B)) { res[b] = VISITORS.reduce((s, v) => s + keys.reduce((ss, k) => ss + walk(v[k]), 0), 0); }
  res.itemReplies = [...MALE_ITEMS, ...FEMALE_ITEMS, ...SENIOR_ITEMS].reduce((s, it) => s + walk(it.replies) + walk(it.youngReplies || []), 0);
  res.neutralItemReplies = ALL_PARCELS.reduce((s, it) => s + walk(it.replies), 0);
  res.scandals = walk(SCANDAL_TYPES); res.bomzh = walk(BOMZH_EVENT);
  return res;
});
const total = Object.values(r).reduce((s, x) => s + x, 0);
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(20), String(v).padStart(6), (v / total * 100).toFixed(1) + '%');
console.log('total'.padEnd(20), total);
await browser.close();
