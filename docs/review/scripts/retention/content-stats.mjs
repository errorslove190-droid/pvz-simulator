// Считает объём контента по данным игры (персонажи, реплики, товары, скандалы, бомж)
// Запуск: node work/retention/content-stats.mjs  (нужен сервер на 8805)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL_ = 'http://localhost:8805/';
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await p.goto(URL_);
await p.waitForTimeout(1200);

const stats = await p.evaluate(() => {
  const len = (a) => Array.isArray(a) ? a.length : (a ? 1 : 0);
  const visitors = VISITORS.map((v) => {
    const src = visitorItemSource(v);
    const itemReplies = src.reduce((s, it) => s + len(it.replies), 0);
    return {
      id: v.id, name: v.name, male: !!v.male, age: v.age || null,
      intros: len(v.intros), greeting: len(v.greeting), questions: len(v.questions), chatter: len(v.chatter),
      objections: len(v.objections), refuseLines: len(v.refuseLines), silentNotes: len(v.silentNotes),
      thoughts: len(v.thoughts), talkThoughts: len(v.talkThoughts), refuseThoughts: len(v.refuseThoughts),
      hardEnds: len(v.hardEnds), giveEnds: len(v.giveEnds),
      refuseFollowHard: len(v.refuseFollow && v.refuseFollow.hard), refuseFollowGive: len(v.refuseFollow && v.refuseFollow.give),
      lostSearch: len(v.lostSearch), lostReactions: len(v.lostReactions), lostThoughts: len(v.lostThoughts),
      lostEndsSorry: len(v.lostEnds && v.lostEnds.sorry), lostEndsCold: len(v.lostEnds && v.lostEnds.cold),
      choices: len(v.choices),
      itemPool: src === SENIOR_ITEMS ? 'SENIOR' : (src === MALE_ITEMS ? 'MALE' : 'FEMALE'),
      itemPoolSize: src.length, itemReplies,
      keys: Object.keys(v),
    };
  });
  const items = {
    ALL_PARCELS: ALL_PARCELS.length, MALE_ITEMS: MALE_ITEMS.length, FEMALE_ITEMS: FEMALE_ITEMS.length, SENIOR_ITEMS: SENIOR_ITEMS.length,
    repliesPerItem: {
      ALL: ALL_PARCELS.map((i) => len(i.replies)), MALE: MALE_ITEMS.map((i) => len(i.replies)),
      FEMALE: FEMALE_ITEMS.map((i) => len(i.replies)), SENIOR: SENIOR_ITEMS.map((i) => len(i.replies)),
    },
    youngReplies: [...MALE_ITEMS, ...FEMALE_ITEMS].filter((i) => i.youngReplies).length,
  };
  const scandals = SCANDAL_TYPES.map((s) => ({ id: s.id, intros: len(s.intros), vLines: len(s.vLines), choices: len(s.choices),
    deltas: s.choices.map((c) => c.act + ':' + c.deltaRating + (c.risky ? '(risky)' : '')) }));
  const bomzh = { intros: len(BOMZH_EVENT.intros), lines: len(BOMZH_EVENT.lines), choices: len(BOMZH_EVENT.choices),
    stealNarr: Object.values(BOMZH_EVENT.stealLines).reduce((s, x) => s + len(x.narr), 0),
    noSteal: Object.values(BOMZH_EVENT.noStealLines).reduce((s, x) => s + len(x), 0) };
  return { visitors, items, scandals, bomzh, visitorsCount: VISITORS.length, sceneAutoMs: SCENE_AUTO_MS };
});
writeFileSync(new URL('./content-stats.json', import.meta.url), JSON.stringify(stats, null, 2));

// Сводная таблица
const cols = ['intros', 'greeting', 'questions', 'chatter', 'silentNotes', 'talkThoughts', 'objections', 'refuseLines', 'hardEnds', 'giveEnds', 'lostReactions', 'lostEndsSorry', 'lostEndsCold', 'itemPoolSize', 'itemReplies'];
console.log(['id', 'name', 'pool', ...cols].join('\t'));
for (const v of stats.visitors) console.log([v.id, v.name, v.itemPool, ...cols.map((c) => v[c])].join('\t'));
console.log('items', JSON.stringify({ ALL: stats.items.ALL_PARCELS, MALE: stats.items.MALE_ITEMS, FEMALE: stats.items.FEMALE_ITEMS, SENIOR: stats.items.SENIOR_ITEMS, young: stats.items.youngReplies }));
console.log('scandals', JSON.stringify(stats.scandals));
console.log('bomzh', JSON.stringify(stats.bomzh));
const byPool = {};
stats.visitors.forEach((v) => { byPool[v.itemPool] = (byPool[v.itemPool] || 0) + 1; });
console.log('visitors by item pool', JSON.stringify(byPool));
const extraKeys = new Set();
stats.visitors.forEach((v) => v.keys.forEach((k) => extraKeys.add(k)));
console.log('all visitor keys', [...extraKeys].join(','));
await browser.close();
