// Повторяемость контента: через сколько дней игрок видит тех же персонажей, те же реплики,
// скандалы и события. Гоняет НАСТОЯЩИЕ данные и функцию подбора посетителей игры
// (pickTodaysVisitors, getDayLoad, pickQuestion, pickThought) внутри страницы.
// Запуск: node work/retention/repetition.mjs [--runs 300] [--days 100]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('--runs', 300));
const DAYS = Number(arg('--days', 100));
const browser = await chromium.launch();
const p = await (await browser.newContext()).newPage();
await p.goto('http://localhost:8805/');
await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
await p.waitForTimeout(500);

const res = await p.evaluate(({ RUNS, DAYS }) => {
  // глушим живую игру
  try { if (acceptance) { clearInterval(acceptance._timer); clearTimeout(acceptance._nextBoxTimeout); acceptance.running = false; } } catch (e) {}
  const pickR = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const save = { day: gameState.day, hist: gameState.visitorHistory, daily: gameState.daily };
  gameState.daily = { coffee: false, wrap: false, gloves: false, candy: false, promo: false };

  const perDay = Array.from({ length: DAYS + 1 }, () => ({ lines: 0, newLines: 0, visits: 0, newChars: 0, intros: 0, newIntros: 0, talkLines: 0, newTalkLines: 0, scandal: 0, newScandalLines: 0, scandalLines: 0 }));
  const firstAllSeen = []; // день, когда увидел всех 19
  const gaps = []; // промежутки между появлениями одного персонажа (дни)
  const firstIntroRepeatDay = []; // первый день, когда показан уже виденный вступительный абзац
  const firstGreetingRepeatDay = [];
  const scandalFirstRepeatType = []; const scandalAllTypes = []; const bomzhFirst = []; const scandalFirstOutcomeRepeat = [];
  const talkRepeatShareByWeek = {};

  for (let run = 0; run < RUNS; run++) {
    gameState.visitorHistory = [];
    const seen = new Set();
    const seenChars = new Set();
    const lastSeen = {};
    let allSeenDay = null, introRep = null, greetRep = null, scRep = null, scAll = null, bz = null, scOutRep = null;
    const scTypes = new Set(); const scOut = new Set();
    const seeLine = (key, d, bucket) => {
      const isNew = !seen.has(key);
      seen.add(key);
      perDay[d].lines++; if (isNew) perDay[d].newLines++;
      if (bucket) { perDay[d][bucket]++; if (isNew) perDay[d]['new' + bucket[0].toUpperCase() + bucket.slice(1)]++; }
      return isNew;
    };
    for (let d = 1; d <= DAYS; d++) {
      gameState.day = d;
      const load = getDayLoad(d);
      const picked = pickTodaysVisitors(VISITORS.slice(), load, []);
      gameState.visitorHistory = gameState.visitorHistory.filter((h) => h.day >= d - 8);
      gameState.visitorHistory.push({ day: d, ids: picked.map((v) => v.id) });
      // товары: уникальные в пределах дня из пула персонажа
      const used = new Set();
      picked.forEach((v) => {
        perDay[d].visits++;
        if (!seenChars.has(v.id)) { seenChars.add(v.id); perDay[d].newChars++; }
        if (lastSeen[v.id]) gaps.push(d - lastSeen[v.id]);
        lastSeen[v.id] = d;
        const intro = pickR(v.intros);
        const isNewIntro = seeLine('intro:' + v.id + ':' + intro, d, 'intros');
        if (!isNewIntro && introRep === null) introRep = d;
        const g = seeLine('greet:' + v.id, d);
        if (!g && greetRep === null) greetRep = d;
        // разговор (доминирующая стратегия)
        const src = visitorItemSource(v);
        let cand = src.filter((x) => !used.has(x.code));
        if (!cand.length) cand = src;
        const item = pickR(cand); used.add(item.code);
        const q = pickQuestion(v, item);
        seeLine('q:' + v.id + ':' + q, d, 'talkLines');
        let pool = item.replies || [];
        if (v.age === 'teen' && item.youngReplies && item.youngReplies.length) pool = item.youngReplies;
        seeLine('a:' + item.code + ':' + pickR(pool), d, 'talkLines');
        if (v.chatter && v.chatter.length) seeLine('c:' + v.id + ':' + pickR(v.chatter), d, 'talkLines');
        seeLine('t:' + v.id + ':' + pickThought(v, 'talk'), d, 'talkLines');
        seeLine('res:talk:' + (v.male ? 'm' : 'f'), d); // реакция на экране результата
      });
      if (seenChars.size === VISITORS.length && allSeenDay === null) allSeenDay = d;
      // скандал 35% со 2-го дня
      if (d > 1 && Math.random() < 0.35) {
        const t = pickR(SCANDAL_TYPES);
        perDay[d].scandal++;
        if (scTypes.has(t.id) && scRep === null) scRep = d;
        scTypes.add(t.id);
        if (scTypes.size === SCANDAL_TYPES.length && scAll === null) scAll = d;
        const i1 = seeLine('sc:i:' + pickR(t.intros), d, 'scandalLines');
        const i2 = seeLine('sc:v:' + pickR(t.vLines), d, 'scandalLines');
        const ch = t.choices[0]; // безопасный ответ — игрок быстро его выучивает
        const o = seeLine('sc:o:' + t.id + ':' + ch.act, d, 'scandalLines');
        const outKey = t.id + ':' + ch.act;
        if (scOut.has(outKey) && scOutRep === null) scOutRep = d;
        scOut.add(outKey);
      }
      if (d > 1 && Math.random() < BOMZH_EVENT.chance && bz === null) bz = d;
    }
    firstAllSeen.push(allSeenDay); firstIntroRepeatDay.push(introRep); firstGreetingRepeatDay.push(greetRep);
    scandalFirstRepeatType.push(scRep); scandalAllTypes.push(scAll); bomzhFirst.push(bz); scandalFirstOutcomeRepeat.push(scOutRep);
  }
  gameState.day = save.day; gameState.visitorHistory = save.hist; gameState.daily = save.daily;

  const avg = (a) => { const f = a.filter((x) => x !== null); return f.length ? +(f.reduce((s, x) => s + x, 0) / f.length).toFixed(1) : null; };
  const pct = (a, q) => { const f = a.filter((x) => x !== null).sort((x, y) => x - y); return f.length ? f[Math.floor(q * (f.length - 1))] : null; };
  const never = (a) => +(a.filter((x) => x === null).length / a.length * 100).toFixed(0);
  const daily = perDay.slice(1).map((x, i) => ({
    day: i + 1,
    visits: +(x.visits / RUNS).toFixed(2),
    newLinePct: x.lines ? +(x.newLines / x.lines * 100).toFixed(0) : null,
    newIntroPct: x.intros ? +(x.newIntros / x.intros * 100).toFixed(0) : null,
    newTalkPct: x.talkLines ? +(x.newTalkLines / x.talkLines * 100).toFixed(0) : null,
    newCharsPerDay: +(x.newChars / RUNS).toFixed(2),
    scandalNewPct: x.scandalLines ? +(x.newScandalLines / x.scandalLines * 100).toFixed(0) : null,
  }));
  // Сколько всего уникальных строк в «разговорном» пути
  const totalIntros = VISITORS.reduce((s, v) => s + v.intros.length, 0);
  return {
    runs: RUNS, days: DAYS,
    allCharsSeenDay: { avg: avg(firstAllSeen), p10: pct(firstAllSeen, 0.1), p90: pct(firstAllSeen, 0.9) },
    charGapDays: { avg: avg(gaps), p10: pct(gaps, 0.1), p50: pct(gaps, 0.5), p90: pct(gaps, 0.9) },
    firstIntroRepeatDay: { avg: avg(firstIntroRepeatDay), p10: pct(firstIntroRepeatDay, 0.1), p90: pct(firstIntroRepeatDay, 0.9) },
    firstGreetingRepeatDay: { avg: avg(firstGreetingRepeatDay), p10: pct(firstGreetingRepeatDay, 0.1), p90: pct(firstGreetingRepeatDay, 0.9) },
    scandalFirstTypeRepeatDay: { avg: avg(scandalFirstRepeatType), p10: pct(scandalFirstRepeatType, 0.1), p90: pct(scandalFirstRepeatType, 0.9) },
    scandalAllTypesDay: { avg: avg(scandalAllTypes), p10: pct(scandalAllTypes, 0.1), p90: pct(scandalAllTypes, 0.9), neverPct: never(scandalAllTypes) },
    scandalSameOutcomeRepeatDay: { avg: avg(scandalFirstOutcomeRepeat) },
    bomzhFirstDay: { avg: avg(bomzhFirst), p50: pct(bomzhFirst, 0.5), p90: pct(bomzhFirst, 0.9), neverPct: never(bomzhFirst) },
    totalIntros,
    daily,
  };
}, { RUNS, DAYS });

writeFileSync(new URL('./repetition.json', import.meta.url), JSON.stringify(res, null, 1));
const { daily, ...summary } = res;
console.log(JSON.stringify(summary, null, 1));
console.log('day\tvisits\tnew%\tnewIntro%\tnewTalk%\tnewChars\tscandalNew%');
for (const d of daily) if ([1, 2, 3, 4, 5, 7, 10, 14, 21, 28, 35, 42, 56, 70, 84, 100].includes(d.day)) console.log([d.day, d.visits, d.newLinePct, d.newIntroPct, d.newTalkPct, d.newCharsPerDay, d.scandalNewPct].join('\t'));
await browser.close();
