// Подсчёт уникальных реплик персонажей и повторов между персонажами (данные берутся из живой игры).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { OUT } from './lib.mjs';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8804/');
await page.waitForFunction(() => typeof VISITORS !== 'undefined');
const data = await page.evaluate(() => ({
  visitors: VISITORS.map((v) => JSON.parse(JSON.stringify(v))),
  bomzhVisitor: JSON.parse(JSON.stringify(VISITOR_BOMZH)),
  bomzh: JSON.parse(JSON.stringify(BOMZH_EVENT)),
  scandals: JSON.parse(JSON.stringify(SCANDAL_TYPES)),
  items: { ALL: ALL_PARCELS.length, MALE: MALE_ITEMS.length, FEMALE: FEMALE_ITEMS.length, SENIOR: SENIOR_ITEMS.length },
  itemReplies: {
    ALL: ALL_PARCELS.reduce((s, i) => s + (i.replies || []).length, 0),
    MALE: MALE_ITEMS.reduce((s, i) => s + (i.replies || []).length, 0),
    FEMALE: FEMALE_ITEMS.reduce((s, i) => s + (i.replies || []).length, 0),
    SENIOR: SENIOR_ITEMS.reduce((s, i) => s + (i.replies || []).length, 0),
    YOUNG: [...MALE_ITEMS, ...FEMALE_ITEMS].reduce((s, i) => s + (i.youngReplies || []).length, 0),
  },
  pools: VISITORS.map((v) => ({ id: v.id, pool: SENIOR_IDS.includes(v.id) ? 'SENIOR' : (v.male ? 'MALE' : 'FEMALE'), teen: v.age === 'teen' })),
}));
await browser.close();

const SPOKEN = ['greeting', 'chatter', 'objections', 'lostReactions'];
const STAFF = ['questions', 'refuseLines'];
const NARR = ['intros', 'silentNotes', 'thoughts', 'talkThoughts', 'refuseThoughts', 'lostSearch', 'lostThoughts'];
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const rows = [];
const owner = new Map(); // текст -> Set(имён)
const add = (name, t) => { if (!t) return; const k = t.trim(); if (!owner.has(k)) owner.set(k, new Set()); owner.get(k).add(name); };
for (const v of data.visitors) {
  const spoken = new Set(), staff = new Set(), narr = new Set();
  SPOKEN.forEach((f) => arr(v[f]).forEach((t) => spoken.add(t)));
  STAFF.forEach((f) => arr(v[f]).forEach((t) => staff.add(t)));
  NARR.forEach((f) => arr(v[f]).forEach((t) => narr.add(t)));
  arr(v.hardEnds).forEach((e) => { spoken.add(e.v); narr.add(e.n); narr.add(e.out); });
  arr(v.giveEnds).forEach((e) => { spoken.add(e.v); narr.add(e.n); });
  ['sorry', 'cold'].forEach((k) => arr(v.lostEnds && v.lostEnds[k]).forEach((e) => { spoken.add(e.v); narr.add(e.n); narr.add(e.out); }));
  ['hard', 'give'].forEach((k) => arr(v.refuseFollow && v.refuseFollow[k]).forEach((t) => staff.add(t)));
  ['sorry', 'cold'].forEach((k) => arr(v.lostFollow && v.lostFollow[k]).forEach((t) => staff.add(t)));
  const all = [...spoken, ...staff, ...narr].filter(Boolean);
  all.forEach((t) => add(v.name, t));
  const pool = data.pools.find((p) => p.id === v.id);
  rows.push({ id: v.id, name: v.name, male: v.male, spoken: [...spoken].filter(Boolean).length, staff: [...staff].filter(Boolean).length, narr: [...narr].filter(Boolean).length, total: new Set(all).size, pool: pool.pool + (pool.teen ? '+teen' : '') });
}
// повторы между персонажами
const shared = [...owner.entries()].filter(([, s]) => s.size > 1).map(([t, s]) => ({ t, n: s.size, who: [...s] })).sort((a, b) => b.n - a.n);
// уникальные в пределах персонажа, но общие у ≥2 — доля
for (const r of rows) {
  let own = 0, sh = 0;
  for (const [t, s] of owner) if (s.has(r.name)) { if (s.size > 1) sh++; else own++; }
  r.sharedWithOthers = sh; r.onlyHis = own;
}
// частые шаблонные фразы
const allTexts = [...owner.keys()];
const phrases = ['часы тикали', 'коридор молчал', 'пункт выдохнул', 'пункт замер', 'новая форма грозы', 'особый стресс', 'надежды — тяжёлые', 'Сделка была совершена', 'Тихая угроза', 'стоит золотой медали', 'не сценить', 'сценю', 'Дайте мне комп', 'Сайт „готов к выдаче“', 'Ушёл набирать жалобу', 'оставив мне обещание', 'Холодность — тоже ответ', 'бормоча что-то про отзыв', 'с явно задетым чувством', 'не сказав ни слова', 'один на один с пустой', 'Самое паршивое'];
const phraseCount = phrases.map((p) => ({ p, n: allTexts.filter((t) => t.includes(p)).reduce((s, t) => s + owner.get(t).size, 0) }));
const out = { rows, items: data.items, itemReplies: data.itemReplies, sharedCount: shared.length, sharedTop: shared.slice(0, 40), phraseCount,
  bomzh: { intros: data.bomzh.intros.length, lines: data.bomzh.lines.length, choices: data.bomzh.choices.length, steal: Object.values(data.bomzh.stealLines).reduce((s, x) => s + x.narr.length, 0), noSteal: Object.values(data.bomzh.noStealLines).reduce((s, x) => s + x.length, 0) },
  scandals: data.scandals.map((s) => ({ id: s.id, intros: s.intros.length, vLines: s.vLines.length, choices: s.choices.length })) };
writeFileSync(OUT + 'count.json', JSON.stringify(out, null, 1));
console.table(rows);
console.log('items', data.items, data.itemReplies);
console.log('общих строк у ≥2 персонажей:', shared.length);
console.log(phraseCount.filter((x) => x.n > 1));
console.log(shared.slice(0, 25).map((s) => s.n + '× ' + s.t.slice(0, 70) + ' — ' + s.who.join(', ')).join('\n'));
console.log(out.bomzh, out.scandals);
