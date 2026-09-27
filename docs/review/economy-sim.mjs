#!/usr/bin/env node
// Симулятор экономики «Симулятор Сотрудника ПВЗ» — к обзору docs/review/03-economy.md.
// Копия рабочего work/economy/sim.mjs. Запускать из корня репозитория: node docs/review/economy-sim.mjs
// (зависимостей нет; Playwright нужен только для режима --calib-run).
//
// Повторяет формулы src/game.js без браузера (строки — по версии на момент обзора):
//   приёмка на время: поток коробок 45/35/20 (buildNextBox, стр. 803), +15 ₽ за свою, пул 40+15×накладная
//   на чужие/брак (startAcceptance, 586), −25 ₽ за ошибку, мёртвый груз, блок «Свои» при полном складе
//   (onSort, 1021), тележка (finishAcceptance, 1177); посетители: выдать / поговорить / отказать
//   (onSceneChoice, 4170), «заказ не найден» и долги (registerDebtPromise, 5186), VISIT_RATING (5371),
//   доход round((55 + пакеты) × (0.4 + рейтинг/5 × 1.1)) (showResult, 5432); скандалист 35 % и бомж 7 %
//   со 2-го дня (startAcceptance, 464–490; onScandalChoice, 4472; onBomzhChoice, 4612); курьер возвратов
//   в дни 7, 14, … (5526); аренда (getDailyExpenses, 301); аварийный вывоз (showDayEnd, 5838);
//   магазин (renderShop, 5878). Сверено с настоящей игрой ботом (режим --calib-run): 323 из 323
//   пошаговых проверок совпали.
//
// Запуск из корня репозитория, зависимостей нет (Node 18+):
//   node docs/review/economy-sim.mjs                       все таблицы: текущий и предложенный баланс (~1 мин)
//   node docs/review/economy-sim.mjs --runs 50             быстрее (по умолчанию 200 прогонов × 100 дней)
//   node docs/review/economy-sim.mjs --balance current     один баланс: current | minimal | proposed | both | all
//                                                   (minimal — «только числа», без новых механик)
//   node docs/review/economy-sim.mjs --only money,goals    часть разделов: money, purchases, payback, consumables,
//                                                   goals, dead, strategies, rating, time, curves, compare
//   node docs/review/economy-sim.mjs --trace average --days 14 [--balance proposed] [--seed 7]
//                                                   журнал одного прогона по дням
//   node docs/review/economy-sim.mjs --calib-run [--bot-runs 3 --bot-days 3 --errors 0.15 --norack]
//                                                   бот играет в настоящую игру (Playwright, порт 8803), затем сверка
//   node docs/review/economy-sim.mjs --calib [--calib-log work/economy/calib-log.json]
//                                                   только сверка с уже записанным журналом бота
//   node docs/review/economy-sim.mjs --json out.json       медианы и перцентили по дням в JSON

// ---------------------------------------------------------------- параметры запуска
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i > -1 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const RUNS = Number(arg('runs', 200));
const DAYS = Number(arg('days', 100));
const SEED = Number(arg('seed', 20260927));
const WHICH = arg('balance', 'both');
const SECTIONS = ['money', 'purchases', 'payback', 'consumables', 'goals', 'dead', 'strategies', 'rating', 'time', 'curves', 'compare'];
const ONLY = new Set(arg('only', SECTIONS.join(',')).split(','));
const TRACE = arg('trace', null);
const JSON_OUT = arg('json', null);
const fs = await import('node:fs');

// ---------------------------------------------------------------- случайные числа
// Отдельный поток на (прогон, день, подсистема): парные прогоны «с покупкой / без» видят те же
// события дня (скандалы, коробки, выборы) и расходятся только из-за самой покупки.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x9e3779b9; h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
const rngFor = (seed, day, stream) => mulberry32(hash(seed, day, stream));
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const pickW = (rng, w) => { let s = 0; for (const k in w) s += w[k]; let r = rng() * s; for (const k in w) { r -= w[k]; if (r < 0) return k; } return Object.keys(w).pop(); };
const r2 = (x) => +x.toFixed(2); // как +(…).toFixed(2) в игре

// ---------------------------------------------------------------- текущий баланс (как в src/game.js)
const CURRENT = {
  id: 'current', name: 'текущий',
  startMoney: 150, startRating: 3.5, startCap: 3,
  // приёмка
  roundSec: 30, routineSec: 8, coffeeSec: 10, nextBoxSec: 0.48,
  oursReward: 15, othersReward: 15, brokenReward: 25, wrongPenalty: 25,
  poolBase: 40, poolPerItem: 15, pOurs: 0.45, pOthers: 0.35, trolleyPerLvl: 5,
  fullSkip: false,           // false: при полном складе «Свои» блокируется, тост советует «как чужую» (−25 ₽)
  // посетители и рейтинг
  dayLoad: [[1, 3], [4, 4], [12, 5], [22, 6], [43, 7], [64, 8]], promoExtra: 2,
  incomeBase: 55, multA: 0.4, multB: 1.1, wrapBonus: 15, candyMult: 1.25,
  ratingModel: 'delta',
  rating: { give: 0.02, talk: 0.10, debtSuccess: 0.10, debtFail: -0.50, refuseSoft: -0.05,
            refuseHard: -0.25, lostSorry: -0.08, lostCold: -0.20 },
  debtFine2: 10, debtRating2: -0.02, debtBurn: -0.15, surplusAfter: 2,
  returnVisitP: 23 / 95, // доля реплик hardEnds с «завтра/вернусь…» (registerReturnVisit)
  scandalP: 0.35, scandalPcctv: 0.35, bomzhP: 0.07, rareFrom: 2, riskyP: 0.45,
  // расходы и вывоз
  expenses: [[1, 0], [4, 70], [8, 150], [15, 260], [22, 350], [29, 480], [43, 600]],
  courierEvery: 7, courierFee: 50, courierFeeCctv: 25, emergencyBase: 50, rescueBelow: 60,
  // магазин
  price: { rack1: 450, rack2: 2250, cctv: 600, trolley: [300, 525, 750], scanner: [270, 570], routine: [225, 480],
           wrap: 75, gloves: 112, candy: 52, coffee: 60, promo: 75 },
  unlock: {},                // уровень ПВЗ, с которого улучшение появляется в магазине
  scannerTip: 0,             // сканер сейчас только ускоряет сканирование, денег не даёт
  goals: [{ d: 28, sum: 9000 }, { d: 56, sum: 24000 }, { d: 84, sum: 40000 }],
  goalMode: 'balance',       // цель сравнивается с остатком на счёте в отчёте ровно этого дня; награды нет
  levels: null,              // уровней ПВЗ нет
  overdraft: false,          // аренда списывается до нуля: max(0, деньги − аренда), поражения нет
  extraUpgrades: [],
};

// ---------------------------------------------------------------- предложенный баланс
// Каждое изменение — в разделе «Новый баланс» docs/review/03-economy.md (было → стало, зачем).
// Порог уровня n (заработано за всё время): 300·n + 60·n² → 360, 840, 1 440, 2 160, 3 000, … 9 000 (10-й),
// 30 000 (20-й), 63 000 (30-й), 108 000 (40-й). У «среднего» — уровень в день первые 5 дней, потом раз в 2–3 дня.
const LEVELS = Array.from({ length: 60 }, (_, i) => 300 * (i + 1) + 60 * (i + 1) * (i + 1));
const PROPOSED = {
  ...CURRENT, id: 'proposed', name: 'предложенный',
  wrongPenalty: 15,          // 25 → 15: ошибка стоит одну коробку, а не две
  fullSkip: true,            // склад полон — «свои», которые не встанут, больше не подаются; штрафа нет
  ratingModel: 'reviews',    // рейтинг = среднее последних 20 отзывов (1–5 ★), как у настоящего ПВЗ
  reviewWindow: 20,
  reviewScore: { talk: 5, give: 4, debtSuccess: 5, refuseSoft: 3, refuseHard: 1, lostSorry: 3, lostCold: 1, debtFail: 1, burn: 1 },
  candyReview: 1,            // конфеты: +1 ★ к хорошему отзыву (молча выдать с конфетой = 5 ★)
  scandalScore: [3, 2, 1], riskyOkScore: 4, bonusScore: 1,
  multA: 0.25, multB: 1.25,  // выплата ×(0.25 + рейтинг/5 × 1.25): 5 ★ → ×1.50 (как было), 4 ★ → ×1.25, 3 ★ → ×1.00
  rentByLevel: { holiday: 3, base: 40, perLevel: 14 }, // аренда 40 + 14 × уровень ПВЗ (каникулы 3 дня — как было)
  courierEvery: 3,           // курьер возвратов: раз в 7 дней → раз в 3 дня
  courierDebt: true,         // не хватает денег — забирает мёртвый груз в долг (баланс уходит в минус)
  price: { rack1: 350, rack2: 1500, cctv: 500, trolley: [200, 450, 800], scanner: [250, 600], routine: [150, 400],
           wrap: 60, gloves: 80, candy: 40, coffee: 30, promo: 150 },
  unlock: { rack2: 4, cctv: 3, trolley2: 2, trolley3: 6, scanner1: 1, scanner2: 7, routine2: 5 },
  scannerTip: 5,             // сканер: +5 ₽ «за скорость» к каждой выдаче за уровень
  scandalPcctv: 0.20,        // камеры: скандалист 35 % → 20 % дней
  levels: LEVELS,            // уровни ПВЗ по заработку за всё время (не по остатку)
  levelBonus: 0,             // процента к выдаче за уровень нет — только премия и открытие товаров
  levelReward: (lvl) => (lvl % 5 === 0 ? 500 : 100), // премия за новый уровень: 100 ₽, каждый 5-й — 500 ₽
  // цели по заработку за всё время, три ступени: бронза / серебро / золото (сумма, премия)
  goals: [
    { d: 28, tiers: [[10000, 500], [20000, 1000], [30000, 2000]] },
    { d: 56, tiers: [[25000, 1000], [50000, 2000], [80000, 4000]] },
    { d: 84, tiers: [[40000, 1500], [85000, 3000], [125000, 6000]] },
    { d: 100, tiers: [[50000, 2000], [110000, 4000], [160000, 8000]] },
  ],
  goalMode: 'earned',
  overdraft: { days: 3, levelLoss: 1, cut: 0, cutDays: 0 }, // аренда в долг; 3 вечера подряд в минусе — санация (−1 уровень)
  extraUpgrades: [
    { key: 'coffeemachine', name: 'Кофемашина для клиентов', costs: [900], unlock: [6], effect: '+5 ₽ к выдаче довольному клиенту' },
    { key: 'repair', name: 'Ремонт зала', costs: [1500, 3000, 5000], unlock: [8, 15, 23], effect: '+6 % к выдаче за уровень' },
    { key: 'postamat', name: 'Постамат у входа', costs: [3000, 6000, 10000], unlock: [11, 19, 27], effect: '+100 / +220 / +380 ₽ в день пассивно' },
    { key: 'branch', name: 'Филиал (финал сезона)', costs: [40000], unlock: [33], effect: '+10 % к выдаче; открывает «второй сезон»' },
  ],
  postamatIncome: [0, 100, 220, 380],
};

// «Только числа»: дешёвый первый шаг без новых механик (уровней, отзывов, долга, новых улучшений).
// Меняются константы и две строки логики: цели — по заработку и с премией, сканер даёт +5 ₽, камеры снижают скандалы.
const MINIMAL = {
  ...CURRENT, id: 'minimal', name: 'только числа',
  wrongPenalty: 15, fullSkip: true,
  rating: { ...CURRENT.rating, give: 0.01, talk: 0.04, debtSuccess: 0.05 }, // рейтинг растёт в 2,5 раза медленнее
  expenses: [[1, 0], [4, 60], [8, 120], [15, 220], [22, 320], [29, 440], [43, 560], [64, 650]],
  courierEvery: 3,
  price: { ...PROPOSED.price },
  scannerTip: 5, scandalPcctv: 0.20,
  goals: [7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 91, 98].map((d) => ({ d, sum: Math.round((d * 260 + d * d * 4) / 100) * 100, reward: 150 + d * 5 })),
  goalMode: 'earned',
};

// ---------------------------------------------------------------- игроки
// Навык: точность приёмки, время реакции на коробку (с; плюс 0,48 с анимации до следующей),
// выборы в диалогах. Веса ответа скандалисту и бомжу — [лучший, средний, худший].
const SKILLS = {
  ideal: { acc: 1.00, rBase: 0.70, rItem: 0.06, visit: { talk: 1 }, refuseHard: 0, lostSorry: 1, debtRefuse: 0,
           emptyPromise: 1, scandal: [1, 0, 0], bomzh: [1, 0, 0], smartFull: true, fullPatience: 0 },
  average: { acc: 0.82, rBase: 0.90, rItem: 0.10, visit: { talk: 0.5, give: 0.5 }, refuseHard: 0.5, lostSorry: 0.85,
             debtRefuse: 0, emptyPromise: 0.8, scandal: [0.6, 0.3, 0.1], bomzh: [0.5, 0.4, 0.1], smartFull: false, fullPatience: 1 },
  careless: { acc: 0.60, rBase: 0.60, rItem: 0.04, visit: { talk: 0.2, give: 0.6, refuse: 0.2 }, refuseHard: 0.5,
              lostSorry: 0.5, debtRefuse: 0.1, emptyPromise: 0.5, scandal: [1, 1, 1], bomzh: [1, 1, 1], smartFull: false, fullPatience: 2 },
  // калибровочный бот (work/economy/calib.mjs): постоянный темп, без разброса
  bot: { acc: 1.00, rBase: 0.55, rItem: 0, noise: 0, visit: { talk: 1 }, refuseHard: 0, lostSorry: 1, debtRefuse: 0,
         emptyPromise: 1, scandal: [1, 0, 0], bomzh: [1, 0, 0], smartFull: true, fullPatience: 0 },
};
const PROFILES = [
  { id: 'ideal', name: 'идеальный', skill: 'ideal', policy: 'smart' },
  { id: 'average', name: 'средний', skill: 'average', policy: 'smart' },
  { id: 'careless', name: 'небрежный', skill: 'careless', policy: 'smart' },
  { id: 'adlover', name: 'любитель рекламы', skill: 'average', policy: 'ads' },
  { id: 'buyer', name: 'скупщик', skill: 'average', policy: 'buyer' },
  { id: 'miser', name: 'скупой', skill: 'average', policy: 'miser' },
];

// Скандалы: [лучший, средний, худший]; dr — рейтинг, dm — деньги (onScandalChoice)
const SCANDALS = [
  { id: 'missing_order', ch: [{ act: 'apologize', dr: -0.08, debt: true }, { act: 'demand_proof', risky: true, ok: -0.05, fail: -0.25 }, { act: 'kick', dr: -0.40 }] },
  { id: 'opened_parcel', ch: [{ act: 'show_cctv', dr: -0.05, dm: -15, cctv: true }, { act: 'blame_courier', dr: -0.12 }, { act: 'counter_attack', risky: true, ok: 0.10, fail: -0.50 }] },
  { id: 'queue_rage', ch: [{ act: 'offer_candy', dr: -0.04, candy: true }, { act: 'ignore', dr: -0.18 }, { act: 'rage_back', dr: -0.45 }] },
  { id: 'damaged_box', ch: [{ act: 'wrap_offer', dr: -0.06, dm: -10 }, { act: 'factory_defect', dr: -0.14 }, { act: 'no_comp', dr: -0.38 }] },
];
const BOMZH = [{ act: 'kind', dr: 0.05, steal: 0.5 }, { act: 'neutral', dr: 0, steal: 0.5 }, { act: 'rude', dr: -0.15, steal: 0.75 }];

// ---------------------------------------------------------------- формулы игры
const table = (tab, x) => { let v = tab[0][1]; for (const [from, val] of tab) if (x >= from) v = val; return v; };
const dayLoad = (B, day, promo) => table(B.dayLoad, day) + (promo ? B.promoExtra : 0);
// Аренда: сейчас — по номеру дня; в предложении — по уровню ПВЗ (после каникул первых дней)
const expensesFor = (B, finishedDay, st) => (B.rentByLevel && st
  ? (finishedDay <= B.rentByLevel.holiday ? 0 : B.rentByLevel.base + B.rentByLevel.perLevel * st.level)
  : table(B.expenses, finishedDay));
const deadCount = (st) => st.shelf.filter((p) => p.status !== 'normal').length;
const freeSlots = (st) => Math.max(0, st.cap - st.shelf.length);
const levelOf = (B, earned) => { if (!B.levels) return 0; let l = 0; while (l < B.levels.length && earned >= B.levels[l]) l++; return l; };

function newState(B) {
  const st = {
    day: 1, money: B.startMoney, rating: B.startRating, cap: B.startCap, cctv: false,
    upg: { trolley: 0, scanner: 0, routine: 0 }, extra: {},
    daily: { coffee: false, wrap: false, gloves: false, candy: false, promo: false },
    shelf: [], promised: [], attempts: new Map(), nextId: 1,
    earned: 0, level: 0, negDays: 0, cutDays: 0, sanations: 0,
    hist: [], goalsHit: [], seconds: 0,
  };
  if (B.ratingModel === 'reviews') st.reviews = Array(B.reviewWindow).fill(B.startRating);
  return st;
}

// Рейтинг. delta — как сейчас (applyVisitOutcome: конфеты ×1.25 к плюсу, округление до сотых);
// reviews — предложение: среднее последних N отзывов.
function addReview(st, B, score) {
  st.reviews.push(Math.max(1, Math.min(5, score)));
  if (st.reviews.length > B.reviewWindow) st.reviews.shift();
  st.rating = r2(st.reviews.reduce((a, b) => a + b, 0) / st.reviews.length);
}
function rateVisit(st, B, key) {
  if (B.ratingModel === 'reviews') {
    let s = B.reviewScore[key];
    if (st.daily.candy && s >= 4) s += B.candyReview;
    addReview(st, B, s);
    return;
  }
  let delta = B.rating[key];
  if (delta > 0 && st.daily.candy) delta = r2(delta * B.candyMult);
  st.rating = Math.max(1, Math.min(5, r2(st.rating + delta)));
}
const plainRating = (st, delta) => { st.rating = Math.max(1, Math.min(5, r2(st.rating + delta))); };
function payout(st, B, happy) { // showResult: рейтинг уже обновлён этим визитом
  let add = happy && st.daily.wrap ? B.wrapBonus : 0;
  add += (B.scannerTip || 0) * st.upg.scanner;
  if (happy && st.extra.coffeemachine) add += 5;
  let mult = B.multA + (st.rating / 5) * B.multB;
  if (B.levels) mult *= 1 + B.levelBonus * st.level;
  if (st.extra.repair) mult *= 1 + (B.repairStep || 0.06) * st.extra.repair;
  if (st.extra.branch) mult *= 1.1;
  if (st.cutDays > 0 && B.overdraft) mult *= 1 - B.overdraft.cut;
  return Math.round((B.incomeBase + add) * mult);
}

// registerDebtPromise: 1-е обещание бесплатно, 2-е −10 ₽ и −0.02, 3-е — клиент уходит (−0.15)
function promise(st, B, id, rec) {
  const n = (st.attempts.get(id) || 0) + 1;
  if (n >= 3) {
    st.attempts.delete(id); rec.burned++;
    if (B.ratingModel === 'reviews') addReview(st, B, B.reviewScore.burn); else plainRating(st, B.debtBurn);
    return 'burned';
  }
  st.attempts.set(id, n);
  if (n >= 2) {
    st.money = Math.max(Math.min(st.money, 0), st.money - B.debtFine2); rec.other += B.debtFine2;
    if (B.ratingModel !== 'reviews') plainRating(st, B.debtRating2);
  }
  if (!st.promised.some((d) => d.id === id)) st.promised.push({ id });
  return n >= 2 ? 'retry' : 'ok';
}

// ---------------------------------------------------------------- приёмка
function reactTime(sk, kind, n, rng) {
  const noise = sk.noise === 0 ? 1 : Math.exp(0.25 * gauss(rng));
  return (sk.rBase + sk.rItem * n) * (kind === 'broken' ? 0.75 : 1) * noise;
}
const wrongBin = (kind, rng) => ['ours', 'others', 'broken'].filter((b) => b !== kind)[rng() < 0.5 ? 0 : 1];

function runAcceptance(st, B, sk, inv, rng, rec) {
  const T = B.roundSec + st.upg.routine * B.routineSec + (st.daily.coffee ? B.coffeeSec : 0);
  st.daily.coffee = false; // кофе сгорает на старте приёмки
  const pool = B.poolBase + B.poolPerItem * inv.length;
  let t = 0, paid = 0, bonus = 0, penalty = 0, oursOk = 0, errors = 0, boxes = 0, end = 'timer';
  const unsorted = inv.slice();
  const accepted = [];
  const occupied = () => st.shelf.length + accepted.length;
  const hasDead = () => accepted.some((p) => p.status !== 'normal') || st.shelf.some((p) => p.status !== 'normal');
  const displaceDead = () => { // displaceDeadloadForDebt: сначала из принятого сегодня, потом с полки
    let i = accepted.findIndex((p) => p.status !== 'normal');
    if (i >= 0) { accepted.splice(i, 1); return true; }
    i = st.shelf.findIndex((p) => p.status !== 'normal');
    if (i >= 0) { st.shelf.splice(i, 1); return true; }
    return false;
  };
  for (;;) {
    if (B.fullSkip && occupied() >= st.cap) { // предложение: «свои», которым нет места, не подаются (кроме долгов)
      for (let i = unsorted.length - 1; i >= 0; i--) if (!(unsorted[i].isDebt && hasDead())) unsorted.splice(i, 1);
    }
    if (unsorted.length === 0 && paid >= pool) { end = 'done'; break; } // игрок жмёт «Завершить приёмку»
    const r = rng();
    let kind = r < B.pOurs ? 'ours' : r < B.pOurs + B.pOthers ? 'others' : 'broken';
    if (kind === 'ours' && unsorted.length === 0) kind = rng() < 0.6 ? 'others' : 'broken';
    let parcel = null;
    if (kind === 'ours') {
      const debts = unsorted.filter((p) => p.isDebt);
      parcel = debts.length && rng() < 0.75 ? debts[Math.floor(rng() * debts.length)] : unsorted[Math.floor(rng() * unsorted.length)];
    }
    const react = reactTime(sk, kind, inv.length, rng);
    if (t + react >= T) break; // таймер кончился раньше, чем игрок нажал
    t += react; boxes++;
    let bin = rng() < sk.acc ? kind : wrongBin(kind, rng);
    if (bin === 'ours' && occupied() >= st.cap) {
      if (kind === 'ours' && parcel.isDebt && displaceDead()) { /* долг вытеснил мёртвый груз */ }
      else if (kind === 'ours') {
        // своя коробка, склад полон: тост советует «отсортируйте как чужую» — это ошибка (−25 ₽);
        // игрок делает так fullPatience раз, потом жмёт «Завершить приёмку»
        if (sk.smartFull || rec.fullBlocks >= (sk.fullPatience || 0)) { end = 'full'; break; }
        bin = 'others'; t += 0.4; rec.fullBlocks++;
      } else { bin = kind; t += 0.4; } // ошибочное «Свои» не прошло — игрок исправился
    }
    if (bin === kind) {
      if (kind === 'ours') {
        bonus += B.oursReward; oursOk++;
        unsorted.splice(unsorted.indexOf(parcel), 1);
        accepted.push({ id: parcel.id, status: 'normal', isDebt: parcel.isDebt, days: 0 });
      } else {
        const got = Math.min(kind === 'broken' ? B.brokenReward : B.othersReward, Math.max(0, pool - paid));
        paid += got; bonus += got;
      }
    } else {
      errors++;
      if (!st.daily.gloves) penalty += B.wrongPenalty;
      if (bin === 'ours') { accepted.push({ id: 0, status: kind === 'broken' ? 'broken' : 'surplus' }); rec.deadMade++; }
    }
    t += B.nextBoxSec;
    if (t >= T) break;
  }
  // finishAcceptance: деньги (в текущей игре не ниже нуля) и раскладка на полки
  const trolley = st.upg.trolley * B.trolleyPerLvl * oursOk;
  const net = bonus - penalty + trolley;
  st.money = Math.max(Math.min(st.money, 0), st.money + net);
  const stock = st.shelf.slice();
  const dropDead = () => { const i = stock.findIndex((p) => p.status !== 'normal'); if (i >= 0) { stock.splice(i, 1); return true; } return false; };
  for (const d of accepted.filter((p) => p.isDebt)) { if (stock.length >= st.cap && !dropDead()) continue; if (stock.length < st.cap) stock.push(d); }
  for (const p of accepted.filter((p) => !p.isDebt)) if (stock.length < st.cap) stock.push(p);
  st.shelf = stock;
  Object.assign(rec, { accNet: net, pool, poolPaid: paid, boxes, errors, invSize: inv.length, invMissed: inv.filter((p) => !accepted.some((a) => a.id === p.id)).length,
    accEnd: end, accSec: end === 'timer' ? T : t, accT: T });
}

// ---------------------------------------------------------------- день
function simDay(st, B, prof, seed, rec) {
  const sk = SKILLS[prof.skill];
  const gen = rngFor(seed, st.day, 'gen'), acc = rngFor(seed, st.day, 'acc'), vis = rngFor(seed, st.day, 'vis');
  // --- startAcceptance
  const L = dayLoad(B, st.day, st.daily.promo);
  const debts = st.promised; st.promised = [];
  const K = debts.length;
  let visitorCount = Math.max(L, K);
  let scandal = null, bomzh = null;
  const sP = st.cctv ? B.scandalPcctv : B.scandalP;
  const u1 = gen(), u2 = gen(), u3 = gen();
  if (st.day >= B.rareFrom && u1 < sP) {
    scandal = { type: SCANDALS[Math.floor(u2 * SCANDALS.length)], pos: Math.floor(u3 * visitorCount) };
    visitorCount++;
  }
  const b1 = gen(), b2 = gen();
  if (st.day >= B.rareFrom && b1 < B.bomzhP) {
    let pos = Math.floor(b2 * visitorCount);
    if (scandal && pos === scandal.pos) pos = (pos + 1) % visitorCount;
    bomzh = { pos }; visitorCount++;
  }
  const regularN = Math.max(0, L - K);
  const regular = [];
  for (let i = 0; i < regularN; i++) regular.push({ id: st.nextId++ });
  // срок хранения: «ничьи» нормальные коробки со второго утра — излишек
  const protectedIds = new Set(debts.map((d) => d.id));
  for (const p of st.shelf) {
    if (p.status !== 'normal') continue;
    if (p.isDebt || protectedIds.has(p.id)) { p.days = 0; continue; }
    p.days = (p.days || 0) + 1;
    if (p.days >= B.surplusAfter) { p.status = 'surplus'; p.isDebt = false; }
  }
  const free = freeSlots(st);
  const regInInv = Math.min(regularN, Math.max(0, free - K));
  const inv = [...debts.map((d) => ({ id: d.id, isDebt: true })), ...regular.slice(0, regInInv).map((r) => ({ id: r.id, isDebt: false }))];
  Object.assign(rec, { day: st.day, load: L, debtsIn: K, regular: regularN, noSlot: regularN - regInInv, scandal: !!scandal, bomzh: !!bomzh,
    delivered: 0, lost: 0, burned: 0, refused: 0, income: 0, other: 0, deadMade: 0, fullBlocks: 0, courier: 0, rescue: false,
    spend: 0, bought: [], ads: 0, talk: 0, passive: 0, reward: 0, levelUp: 0, sanation: false });
  runAcceptance(st, B, sk, inv, acc, rec);

  // --- посетители: должники первыми, затем ростер; редкие гости на своих позициях
  const order = [...debts.map((d) => ({ kind: 'debt', id: d.id })), ...regular.map((r) => ({ kind: 'reg', id: r.id }))];
  if (scandal) order.splice(Math.min(scandal.pos, order.length), 0, { kind: 'scandal' });
  if (bomzh) order.splice(Math.min(bomzh.pos, order.length), 0, { kind: 'bomzh' });
  const onShelf = (id) => st.shelf.findIndex((p) => p.id === id && p.status === 'normal');
  const deliver = (id, key, happy) => {
    st.shelf.splice(onShelf(id), 1);
    rateVisit(st, B, key);
    const m = payout(st, B, happy);
    st.money += m; rec.income += m; rec.delivered++;
  };
  const lostFlow = (id) => { // startLostParcel → onLostChoice
    rec.lost++;
    if (vis() < sk.lostSorry) { if (promise(st, B, id, rec) !== 'burned') rateVisit(st, B, 'lostSorry'); }
    else rateVisit(st, B, 'lostCold');
  };
  let secs = 0;
  const scanSec = [1.67, 0.95, 0.68][st.upg.scanner] + 0.9;
  for (const v of order) {
    if (v.kind === 'debt') {
      const i = onShelf(v.id);
      if (i >= 0) {
        if (vis() < sk.debtRefuse) { st.shelf[i].status = 'surplus'; rateVisit(st, B, 'debtFail'); rec.refused++; secs += 14; }
        else { st.attempts.delete(v.id); deliver(v.id, 'debtSuccess', true); secs += 16 + scanSec; }
      } else { // обещанной коробки нет: пообещать ещё раз или принять гнев
        rec.lost++; secs += 16;
        if (vis() < sk.emptyPromise) { if (promise(st, B, v.id, rec) !== 'burned') rateVisit(st, B, 'lostSorry'); }
        else rateVisit(st, B, 'debtFail');
      }
    } else if (v.kind === 'reg') {
      const choice = pickW(vis, sk.visit);
      if (choice === 'refuse') {
        rec.refused++; secs += 20;
        if (vis() < sk.refuseHard) { // «стоять на своём»: коробка — излишек, иногда клиент вернётся завтра
          if (vis() < B.returnVisitP && !st.promised.some((d) => d.id === v.id)) st.promised.push({ id: v.id });
          const i = onShelf(v.id); if (i >= 0) st.shelf[i].status = 'surplus';
          rateVisit(st, B, 'refuseHard');
        } else if (onShelf(v.id) >= 0) { deliver(v.id, 'refuseSoft', false); secs += scanSec; }
        else lostFlow(v.id);
      } else {
        if (choice === 'talk') rec.talk++;
        secs += choice === 'talk' ? 18 : 12;
        if (onShelf(v.id) >= 0) { deliver(v.id, choice, true); secs += scanSec + 3; }
        else { lostFlow(v.id); secs += 10; }
      }
    } else if (v.kind === 'scandal') {
      secs += 16;
      const idx = +pickW(vis, { 0: sk.scandal[0], 1: sk.scandal[1], 2: sk.scandal[2] });
      const ch = scandal.type.ch[idx];
      let dr = ch.dr || 0, dm = ch.dm || 0, okRisk = true;
      if (ch.risky) { okRisk = vis() < B.riskyP; dr = okRisk ? ch.ok : ch.fail; }
      const bonusUsed = (ch.cctv && st.cctv) || (ch.candy && st.daily.candy);
      if (ch.cctv && st.cctv) { dr = Math.max(dr, -0.02); dm = Math.min(dm, 0); if (dm < 0) dm = Math.floor(dm / 2); }
      if (ch.candy) dr = st.daily.candy ? dr + 0.04 : -0.08;
      if (B.ratingModel === 'reviews') addReview(st, B, ch.risky ? (okRisk ? B.riskyOkScore : 1) : B.scandalScore[idx] + (bonusUsed ? B.bonusScore : 0));
      else plainRating(st, dr);
      if (dm) { st.money = Math.max(Math.min(st.money, 0), st.money + dm); rec.other += -dm; }
      if (ch.debt) st.promised.push({ id: st.nextId++ }); // «пропал заказ» → завтра должник
    } else { // бомж
      secs += 14;
      const ch = BOMZH[+pickW(vis, { 0: sk.bomzh[0], 1: sk.bomzh[1], 2: sk.bomzh[2] })];
      const buffs = ['candy', 'wrap'].filter((b) => st.daily[b]);
      if (buffs.length && vis() < ch.steal) {
        if (buffs.length === 2 && vis() < 0.3) { st.daily.candy = false; st.daily.wrap = false; }
        else st.daily[buffs[Math.floor(vis() * buffs.length)]] = false;
        rec.stolen = true;
      }
      if (B.ratingModel !== 'reviews') plainRating(st, ch.dr);
    }
  }
  // --- курьер возвратов (конец дня 7, 14, …)
  if (st.day % B.courierEvery === 0) {
    const dead = deadCount(st);
    const fee = dead * (st.cctv ? B.courierFeeCctv : B.courierFee);
    if (dead > 0 && (st.money >= fee || B.courierDebt)) { st.money -= fee; rec.courier = fee; st.shelf = st.shelf.filter((p) => p.status === 'normal'); }
    secs += 14;
  }
  // --- пассивный доход (предложение: постамат)
  if (B.postamatIncome && st.extra.postamat) { rec.passive = B.postamatIncome[st.extra.postamat]; st.money += rec.passive; }
  // --- showDayEnd: аренда, сброс расходников, аварийный вывоз, цели
  const finished = st.day;
  st.day++;
  const rent = expensesFor(B, finished, st);
  rec.rent = rent;
  if (B.overdraft) { // предложение: аренда уходит в минус; 3 вечера подряд в минусе — санация
    st.money -= rent;
    st.negDays = st.money < 0 ? st.negDays + 1 : 0;
    if (st.negDays >= B.overdraft.days) {
      st.money = 0; st.negDays = 0; st.sanations++; rec.sanation = true;
      st.cutDays = B.overdraft.cutDays || 0;
      if (B.levels) { const lvl = Math.max(0, st.level - B.overdraft.levelLoss); st.earned = lvl > 0 ? B.levels[lvl - 1] : 0; st.level = lvl; }
    }
  } else st.money = Math.max(0, st.money - rent);
  if (st.cutDays > 0 && !rec.sanation) st.cutDays--;
  st.daily = { coffee: false, wrap: false, gloves: false, candy: false, promo: false };
  if (st.money < B.rescueBelow && deadCount(st) > 0 && freeSlots(st) === 0) { st.shelf = st.shelf.filter((p) => p.status === 'normal'); rec.rescue = true; }
  rec.gross = rec.accNet + rec.income + rec.passive;
  rec.operating = rec.gross - rec.courier - rec.other; // без аренды и покупок
  if (!rec.sanation) st.earned += rec.gross;
  if (B.levels) {
    const lvl = levelOf(B, st.earned);
    while (st.level < lvl) { st.level++; rec.levelUp++; const rw = B.levelReward ? B.levelReward(st.level) : 0; st.money += rw; rec.reward += rw; }
  }
  rec.goal = null;
  for (const g of B.goals) if (g.d === finished) {
    const value = B.goalMode === 'earned' ? st.earned : st.money;
    const tiers = g.tiers || [[g.sum, g.reward || 0]];
    let tier = 0;
    tiers.forEach(([sum], i) => { if (value >= sum) tier = i + 1; });
    rec.goal = { d: g.d, hit: tier > 0, tier };
    if (tier > 0) { st.goalsHit.push(g.d); const rw = tiers[tier - 1][1]; if (rw) { st.money += rw; rec.reward += rw; } }
  }
  rec.moneyReport = st.money; // деньги в отчёте смены (до магазина)
  rec.rating = st.rating;
  rec.level = st.level;
  rec.earned = st.earned;
  rec.dead = deadCount(st);
  rec.secs = (rec.accSec + 6) + secs + 25 + (finished === 1 ? 45 : 0);
}

// ---------------------------------------------------------------- магазин: политики покупок
function upgradeOptions(st, B) {
  const P = B.price, o = [];
  const open = (key) => (B.unlock[key] || 0) <= st.level;
  if (st.cap < 6) o.push({ key: 'rack1', cost: P.rack1, apply: () => { st.cap = 6; } });
  else if (st.cap < 9 && open('rack2')) o.push({ key: 'rack2', cost: P.rack2, apply: () => { st.cap = 9; } });
  if (!st.cctv && open('cctv')) o.push({ key: 'cctv', cost: P.cctv, apply: () => { st.cctv = true; } });
  for (const [u, n] of [['trolley', 3], ['scanner', 2], ['routine', 2]]) {
    const lvl = st.upg[u];
    if (lvl < n && open(u + (lvl + 1))) o.push({ key: u + (lvl + 1), cost: P[u][lvl], apply: () => { st.upg[u]++; } });
  }
  for (const u of B.extraUpgrades) {
    const lvl = st.extra[u.key] || 0;
    if (lvl < u.costs.length && u.unlock[lvl] <= st.level) o.push({ key: u.key + (lvl + 1), cost: u.costs[lvl], apply: () => { st.extra[u.key] = lvl + 1; }, extra: u });
  }
  return o;
}
const CONSUMABLES = ['promo', 'wrap', 'gloves', 'candy', 'coffee'];

// Политики покупок (сформулированы явно в отчёте):
//   smart («разумная»): держит запас «аренда завтра + 60 ₽»; стеллаж яруса 2 — как только по карману;
//     ярус 3 — с 11-го дня или когда реклама не влезает в 6 мест; тележка — если после покупки ≥ 100 ₽ сверх
//     запаса; сортировка — если за последние 3 дня не успел принять накладную (или ≥ 1500 ₽ сверх запаса);
//     камеры — при ≥ 1500 ₽ сверх запаса; сканер — при ≥ 1500 ₽ (сейчас) или ≥ 100 ₽ (в предложении он даёт
//     деньги); новые улучшения предложения — при ≥ 300 ₽ сверх запаса. Экстренный курьер — если мёртвый груз
//     завтра отнимет места и до курьера > 1 дня. Расходники на завтра: реклама — если завтра все (+2) встанут
//     на полки; пакеты — если завтра ≥ 4 выдач; перчатки — если ошибок за 3 дня в среднем × штраф ≥ цены;
//     конфеты — если рейтинг < 4.8; кофе — если за 3 дня не успевал принять накладную.
//   ads («любитель рекламы»): улучшения как smart, но все 5 расходников каждый день бесплатно за рекламу
//     (и рекламу на районе, даже если места нет) и мёртвый груз — за рекламу в тот же день.
//   buyer («скупщик»): любое улучшение, как только хватает денег (дешёвые первыми), без запаса; расходники — как smart.
//   miser («скупой»): ничего не покупает; курьеру платит, если хватает.
function shop(st, B, prof, rec) {
  const P = B.price;
  const L = dayLoad(B, st.day, false);
  const reserve = expensesFor(B, st.day, st) + 60;
  const recent = st.hist.slice(-3);
  const timeLimited = recent.some((h) => h.invMissed > 0 && h.accEnd === 'timer');
  const avgErr = recent.length ? recent.reduce((s, h) => s + h.errors, 0) / recent.length : 0;
  const buy = (key, cost, apply) => { st.money -= cost; rec.spend += cost; apply(); rec.bought.push(key); };
  const spare = (cost) => st.money - cost - reserve;
  const emergency = () => {
    const dead = deadCount(st);
    if (!dead) return;
    const cost = B.emergencyBase + dead * (st.cctv ? B.courierFeeCctv : B.courierFee);
    const daysToCourier = B.courierEvery - ((st.day - 1) % B.courierEvery);
    if (freeSlots(st) < L && daysToCourier > 1 && spare(cost) >= 0) buy('emergency', cost, () => { st.shelf = st.shelf.filter((p) => p.status === 'normal'); });
  };
  const consumables = (free) => {
    const want = {
      promo: freeSlots(st) >= L + B.promoExtra,
      wrap: Math.min(L + (st.daily.promo ? B.promoExtra : 0), st.cap) >= 4,
      gloves: avgErr * B.wrongPenalty >= P.gloves,
      candy: st.rating < 4.8,
      coffee: timeLimited,
    };
    for (const c of CONSUMABLES) {
      if (st.daily[c] || !want[c]) continue;
      if (free) { st.daily[c] = true; rec.ads++; rec.bought.push(c + '(ad)'); }
      else if (spare(P[c]) >= 0) buy(c, P[c], () => { st.daily[c] = true; });
    }
  };
  if (prof.policy === 'miser') return;
  if (prof.policy === 'buyer') {
    for (;;) {
      const u = upgradeOptions(st, B).filter((x) => x.cost <= st.money).sort((a, b) => a.cost - b.cost)[0];
      if (!u) break;
      buy(u.key, u.cost, u.apply);
    }
    emergency(); consumables(false);
    return;
  }
  if (prof.policy === 'ads') {
    const dead = deadCount(st);
    if (dead) { st.shelf = st.shelf.filter((p) => p.status === 'normal'); rec.ads += dead; rec.bought.push('dead(ad)×' + dead); }
  } else emergency();
  for (let guard = 0; guard < 16; guard++) {
    const u = upgradeOptions(st, B).find((x) => {
      const s = spare(x.cost);
      if (s < 0) return false;
      if (x.key === 'rack1') return true;
      if (x.key === 'rack2') return st.day >= 11 || L + B.promoExtra > 6;
      if (x.key.startsWith('trolley')) return s >= 100;
      if (x.key.startsWith('routine')) return timeLimited || s >= 1500;
      if (x.key === 'cctv') return s >= 1500;
      if (x.key.startsWith('scanner')) return s >= (B.scannerTip ? 100 : 1500);
      if (x.extra) return s >= 300;
      return false;
    });
    if (!u) break;
    buy(u.key, u.cost, u.apply);
  }
  consumables(prof.policy === 'ads');
  if (prof.policy === 'ads') for (const c of CONSUMABLES) if (!st.daily[c]) { st.daily[c] = true; rec.ads++; rec.bought.push(c + '(ad)'); }
}

// ---------------------------------------------------------------- прогон
function simRun(B, prof, seed, days, hooks = {}) {
  const st = newState(B);
  const recs = [];
  for (let d = 1; d <= days; d++) {
    if (hooks.beforeDay) hooks.beforeDay(st, d);
    const rec = {};
    simDay(st, B, prof, seed, rec);
    st.hist.push(rec);
    if (hooks.shop) hooks.shop(st, B, prof, rec); else shop(st, B, prof, rec);
    rec.moneyAfterShop = st.money;
    rec.cap = st.cap;
    st.seconds += rec.secs + rec.ads * 25 + rec.bought.length * 3;
    rec.minutes = st.seconds / 60;
    recs.push(rec);
  }
  return { st, recs };
}

// ---------------------------------------------------------------- статистика и вывод
const quant = (arr, q) => { if (!arr.length) return NaN; const a = arr.slice().sort((x, y) => x - y); const i = (a.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN;
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, ' ') : '—');
const pct = (x) => (Number.isFinite(x) ? Math.round(x * 100) + ' %' : '—');
const REPORT_DAYS = [1, 3, 7, 14, 21, 28, 42, 56, 84, 100];
const band = (v, d = 0) => `${fmt(quant(v, 0.5), d)} [${fmt(quant(v, 0.1), d)}; ${fmt(quant(v, 0.9), d)}]`;
function mdTable(head, rows) {
  const line = (cells) => '| ' + cells.join(' | ') + ' |';
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}
const dayValues = (runs, day, f) => runs.map((recs) => recs[day - 1]).filter(Boolean).map(f);
function monteCarlo(B, prof, runs = RUNS, days = DAYS) {
  const out = [];
  for (let r = 0; r < runs; r++) out.push(simRun(B, prof, hash(SEED, r), days).recs);
  return out;
}
const upgradeKeys = (B) => ['rack1', 'trolley1', 'routine1', 'scanner1', 'cctv', 'trolley2', 'routine2', 'scanner2', 'trolley3', 'rack2',
  ...B.extraUpgrades.flatMap((u) => u.costs.map((_, i) => u.key + (i + 1)))];
function priceOf(B, k) {
  const P = B.price;
  if (k === 'rack1' || k === 'rack2' || k === 'cctv') return P[k];
  const m = /^([a-z]+)(\d)$/.exec(k);
  if (m && Array.isArray(P[m[1]])) return P[m[1]][+m[2] - 1];
  const u = m && B.extraUpgrades.find((x) => x.key === m[1]);
  return u ? u.costs[+m[2] - 1] : 0;
}
// «Прогресс-событие» — купленное улучшение, новый уровень ПВЗ или закрытая цель.
function progressDays(B, recs) {
  const keys = upgradeKeys(B);
  return recs.filter((r) => r.bought.some((k) => keys.includes(k)) || r.levelUp > 0 || (r.goal && r.goal.hit)).map((r) => r.day);
}

function printAll(B, res) {
  const P = PROFILES;
  if (ONLY.has('money')) {
    console.log('## Деньги в отчёте смены (до магазина): медиана [10 %; 90 %]\n');
    console.log(mdTable(['день', ...P.map((p) => p.name)], REPORT_DAYS.filter((d) => d <= DAYS).map((d) => [d, ...P.map((p) => band(dayValues(res[p.id], d, (r) => r.moneyReport)))])));
    console.log('\n## Рейтинг в конце дня: медиана [10 %; 90 %]\n');
    console.log(mdTable(['день', ...P.map((p) => p.name)], REPORT_DAYS.filter((d) => d <= DAYS).map((d) => [d, ...P.map((p) => band(dayValues(res[p.id], d, (r) => r.rating), 2))])));
    console.log('\n## Чистый доход дня (выручка − аренда − курьер − штрафы, без покупок), медиана\n');
    console.log(mdTable(['день', ...P.map((p) => p.name)], REPORT_DAYS.filter((d) => d <= DAYS).map((d) => [d, ...P.map((p) => fmt(quant(dayValues(res[p.id], d, (r) => r.operating - r.rent), 0.5)))])));
    if (B.levels) {
      console.log('\n## Уровень ПВЗ в конце дня: медиана [10 %; 90 %]\n');
      console.log(mdTable(['день', ...P.map((p) => p.name)], REPORT_DAYS.filter((d) => d <= DAYS).map((d) => [d, ...P.map((p) => band(dayValues(res[p.id], d, (r) => r.level)))])));
    }
  }
  if (ONLY.has('purchases')) {
    const keys = upgradeKeys(B);
    const buyers = P.filter((p) => p.policy !== 'miser');
    console.log('\n## День покупки улучшения: медиана [10 %; 90 %] (доля прогонов, где куплено за 100 дней)\n');
    console.log(mdTable(['улучшение', 'цена', ...buyers.map((p) => p.name)], keys.map((k) => [k, fmt(priceOf(B, k)),
      ...buyers.map((p) => {
        const days = res[p.id].map((recs) => { const r = recs.find((x) => x.bought.includes(k)); return r ? r.day : null; });
        const got = days.filter((x) => x !== null);
        return got.length ? `${band(got)} (${pct(got.length / days.length)})` : 'нет';
      })])));
    console.log('\n## Всё куплено: день и минута игры (медиана), доля прогонов\n');
    console.log(mdTable(['игрок', 'день', 'минута игры', 'доля прогонов', 'всего на улучшения, ₽'], buyers.map((p) => {
      const lastDays = [], lastMin = [], spent = [];
      for (const recs of res[p.id]) {
        let s = 0; for (const r of recs) for (const k of r.bought) if (keys.includes(k)) s += priceOf(B, k);
        spent.push(s);
        const i = recs.findIndex((r, j) => keys.every((k) => recs.slice(0, j + 1).some((x) => x.bought.includes(k))));
        if (i >= 0) { lastDays.push(i + 1); lastMin.push(recs[i].minutes); }
      }
      return [p.name, lastDays.length ? fmt(quant(lastDays, 0.5)) : 'не всё', lastMin.length ? fmt(quant(lastMin, 0.5)) : '—', pct(lastDays.length / res[p.id].length), fmt(quant(spent, 0.5))];
    })));
  }
  if (ONLY.has('payback')) printPayback(B);
  if (ONLY.has('consumables')) printConsumables(B);
  if (ONLY.has('goals')) {
    const tiered = B.goals.some((g) => g.tiers);
    console.log('\n## Цели: доля прогонов, где цель выполнена' + (B.goalMode === 'earned' ? ' (заработано за всё время)' : ' (остаток на счёте в отчёте этого дня)') + (tiered ? '; бронза / серебро / золото' : '') + '\n');
    const head = B.goals.map((g) => g.tiers ? `к ${g.d}-му: ${g.tiers.map((t) => fmt(t[0] / 1000) + 'k').join(' / ')}` : `${fmt(g.sum)} к ${g.d}-му`);
    console.log(mdTable(['игрок', ...head, B.goalMode === 'earned' ? 'заработано к дню 28 / 56 / 84 / 100 (медиана)' : 'остаток в день 28 / 56 / 84 (медиана)'], P.map((p) => [p.name,
      ...B.goals.map((g) => {
        const tiers = res[p.id].map((recs) => { const r = recs[g.d - 1]; return r && r.goal ? r.goal.tier : 0; });
        const n = (g.tiers || [0]).length;
        return Array.from({ length: n }, (_, i) => pct(mean(tiers.map((t) => (t >= i + 1 ? 1 : 0))))).join(' / ');
      }),
      (B.goalMode === 'earned' ? [28, 56, 84, 100] : [28, 56, 84]).filter((d) => d <= DAYS).map((d) => fmt(quant(dayValues(res[p.id], d, (r) => (B.goalMode === 'earned' ? r.earned : r.moneyReport)), 0.5))).join(' / ')])));
  }
  if (ONLY.has('dead')) {
    console.log('\n## Мёртвые зоны, тупики, угроза\n');
    console.log('Прогресс-событие — купленное улучшение, новый уровень ПВЗ или выполненная цель. «Копить без смысла» — дни, после которых до следующего события > 4 дней. Тупик — вечер, когда денег меньше завтрашней аренды и завтра часть заказов не встанет на полку.\n');
    console.log(mdTable(['игрок', 'самый длинный промежуток без события, дней', 'дней «копить без смысла» из 100', 'первый такой день', 'дней-тупиков', 'дней с деньгами < 50 ₽', 'мёртвый груз / день', 'потеряно визитов / день', 'санаций (банкротств)'],
      P.map((p) => {
        const gaps = [], deadDays = [], firstDead = [], stuck = [], broke = [], dead = [], lost = [], san = [];
        for (const recs of res[p.id]) {
          const ev = progressDays(B, recs);
          let prev = 0, maxGap = 0, cnt = 0, first = null;
          for (const d of [...ev, recs.length + 1]) { maxGap = Math.max(maxGap, d - prev - 1); prev = d; }
          for (let d = 1; d <= recs.length; d++) {
            const nx = ev.find((x) => x > d);
            if ((nx === undefined ? recs.length + 1 : nx) - d > 4) { cnt++; if (first === null) first = d; }
          }
          gaps.push(maxGap); deadDays.push(cnt); if (first !== null) firstDead.push(first);
          stuck.push(recs.filter((r, i) => { const nx = recs[i + 1]; return nx && r.moneyAfterShop < nx.rent && nx.noSlot > 0; }).length);
          broke.push(recs.filter((r) => r.moneyReport < 50).length);
          dead.push(mean(recs.map((r) => r.deadMade)));
          lost.push(mean(recs.map((r) => r.lost)));
          san.push(recs.filter((r) => r.sanation).length);
        }
        return [p.name, band(gaps), fmt(quant(deadDays, 0.5)), firstDead.length ? fmt(quant(firstDead, 0.5)) : '—', fmt(mean(stuck), 1), fmt(mean(broke), 1), fmt(mean(dead), 2), fmt(mean(lost), 2),
          B.overdraft ? `${fmt(mean(san), 2)} (хотя бы одна: ${pct(mean(san.map((x) => (x > 0 ? 1 : 0))))})` : 'нет механики'];
      })));
  }
  if (ONLY.has('strategies')) printStrategies(B);
  if (ONLY.has('rating')) {
    console.log('\n## Рейтинг: когда упирается в 5.0\n');
    console.log(mdTable(['игрок', 'первый день с 5.00: медиана [10 %; 90 %]', 'доля прогонов', 'дней на 5.00 из 100', 'средний рейтинг дней 30–100'], P.map((p) => {
      const first = [], at5 = [], avgLate = [];
      for (const recs of res[p.id]) {
        const i = recs.findIndex((r) => r.rating >= 5);
        if (i >= 0) first.push(i + 1);
        at5.push(recs.filter((r) => r.rating >= 5).length);
        avgLate.push(mean(recs.slice(29).map((r) => r.rating)));
      }
      return [p.name, first.length ? band(first) : 'никогда', pct(first.length / res[p.id].length), fmt(quant(at5, 0.5)), fmt(quant(avgLate, 0.5), 2)];
    })));
  }
  if (ONLY.has('time')) {
    console.log('\n## Время игры (модель): минута к концу дня (медиана) и покупки в начале\n');
    console.log(mdTable(['игрок', 'день 1', 'день 3', 'день 7', 'день 14', 'день 28', 'дней за 15 мин', 'покупок улучшений за 15 мин', 'всех покупок за 15 мин', 'дней за 60 мин'], P.map((p) => {
      const at = (d) => fmt(quant(dayValues(res[p.id], d, (r) => r.minutes), 0.5), 1);
      const keys = upgradeKeys(B);
      const upg15 = res[p.id].map((recs) => recs.filter((r) => r.minutes <= 15).reduce((s, r) => s + r.bought.filter((k) => keys.includes(k)).length, 0));
      const all15 = res[p.id].map((recs) => recs.filter((r) => r.minutes <= 15).reduce((s, r) => s + r.bought.length, 0));
      const d15 = res[p.id].map((recs) => recs.filter((r) => r.minutes <= 15).length);
      const d60 = res[p.id].map((recs) => recs.filter((r) => r.minutes <= 60).length);
      return [p.name, at(1), at(3), at(7), at(14), at(28), fmt(quant(d15, 0.5)), fmt(quant(upg15, 0.5)), fmt(quant(all15, 0.5)), fmt(quant(d60, 0.5))];
    })));
  }
  if (ONLY.has('curves')) {
    console.log('\n## Кривая денег (медиана, отчёт смены), тыс. ₽\n');
    console.log('```');
    console.log(asciiChart(P.map((p) => ({ name: p.name, ys: Array.from({ length: DAYS }, (_, i) => quant(dayValues(res[p.id], i + 1, (r) => r.moneyReport), 0.5) / 1000) }))));
    console.log('```');
  }
}

// ---------------------------------------------------------------- окупаемость улучшений (парные прогоны)
// Обе ветки играют одну политику и одинаковые события; ветка A покупает X в первый день ≥ D, когда хватает
// денег, ветка B — никогда. Окупаемость — сколько дней после покупки накопленная разница операционного
// дохода (выручка − курьер − штрафы; аренда в ветках одинакова) покроет цену.
function scheduledShop(B, schedule, withX) {
  return (st, B2, prof, rec) => {
    for (const [k, d] of schedule) {
      if (k === withX.key && !withX.on) continue;
      if (st.day - 1 < d) continue;
      const u = upgradeOptions(st, B).find((x) => x.key === k);
      if (u && st.money >= u.cost) { st.money -= u.cost; u.apply(); rec.bought.push(k); }
    }
    const L = dayLoad(B, st.day, false);
    if (freeSlots(st) >= L + B.promoExtra && st.money >= B.price.promo) { st.money -= B.price.promo; st.daily.promo = true; }
    if (st.money >= B.price.wrap) { st.money -= B.price.wrap; st.daily.wrap = true; }
  };
}
function printPayback(B) {
  const sched = B.id !== 'proposed'
    ? [['rack1', 3], ['trolley1', 5], ['trolley2', 9], ['trolley3', 14], ['rack2', 16], ['routine1', 20], ['routine2', 22], ['cctv', 24], ['scanner1', 25], ['scanner2', 26]]
    : [['rack1', 2], ['trolley1', 3], ['scanner1', 4], ['routine1', 5], ['trolley2', 6], ['cctv', 8], ['rack2', 9], ['routine2', 12], ['coffeemachine1', 14], ['trolley3', 15], ['scanner2', 17], ['repair1', 20], ['postamat1', 26], ['repair2', 32], ['postamat2', 40], ['repair3', 48], ['postamat3', 58], ['branch1', 64]];
  console.log('\n## Окупаемость улучшений (парные прогоны)\n');
  console.log('Покупки по расписанию (день — ориентир, покупка в первый день, когда хватает денег); реклама на районе — если завтра всем хватит места, пакеты — каждый день. Ветка A покупает улучшение, B — нет, остальное одинаково (те же события дня). Окупаемость — дней от покупки, пока накопленная разница дохода не покроет цену (медиана); прирост — средняя разница дохода в первые 14 дней после покупки.\n');
  const rows = [];
  const pairs = Math.min(RUNS, 120);
  for (const prof of [PROFILES[0], PROFILES[1], PROFILES[2]]) {
    for (const [k] of sched) {
      const pb = [], gain = [], bought = [];
      for (let r = 0; r < pairs; r++) {
        const seed = hash(SEED, 'pay', r);
        const a = simRun(B, prof, seed, DAYS, { shop: scheduledShop(B, sched, { key: k, on: true }) }).recs;
        const b = simRun(B, prof, seed, DAYS, { shop: scheduledShop(B, sched, { key: k, on: false }) }).recs;
        const i0 = a.findIndex((x) => x.bought.includes(k));
        if (i0 < 0) { pb.push(Infinity); continue; }
        bought.push(i0 + 1);
        let cum = 0, p = Infinity;
        for (let i = i0 + 1; i < a.length; i++) { cum += a[i].operating - b[i].operating; if (cum >= priceOf(B, k)) { p = i - i0; break; } }
        pb.push(p);
        gain.push(mean(a.slice(i0 + 1, i0 + 15).map((x, j) => x.operating - b[i0 + 1 + j].operating)));
      }
      const med = quant(pb, 0.5);
      rows.push([prof.name, k, fmt(priceOf(B, k)), bought.length ? `${fmt(quant(bought, 0.5))} (${pct(bought.length / pairs)})` : 'не куплено', Number.isFinite(med) ? fmt(med) : 'не окупается', fmt(mean(gain), 1), pct(pb.filter(Number.isFinite).length / pb.length)]);
    }
  }
  console.log(mdTable(['игрок', 'улучшение', 'цена', 'день покупки (медиана, доля)', 'окупаемость, дней', 'прирост ₽/день', 'окупилось к 100-му дню'], rows));
}

// Расходники: выгода одного дня (парный прогон того же дня с расходником и без)
function cloneState(st) { const c = structuredClone({ ...st, attempts: [...st.attempts] }); c.attempts = new Map(c.attempts); return c; }
function printConsumables(B) {
  console.log('\n## Расходники: выгода за день (для конфет — за 10 дней), ₽, до вычета цены\n');
  console.log('Состояние к утру дня — из прогона «разумной» политики этого игрока; тот же день играется с расходником и без (остальные расходники выключены). Реклама на районе: без скобок — когда завтра хватает места на складе, в скобках — когда не хватает.\n');
  const rows = [];
  for (const prof of [PROFILES[0], PROFILES[1], PROFILES[2]]) {
    for (const c of CONSUMABLES) {
      const cells = [prof.name, c, B.price[c]];
      for (const day of [2, 5, 15, 30, 60]) {
        const gains = [], noRoom = [];
        for (let r = 0; r < Math.min(RUNS, 100); r++) {
          const seed = hash(SEED, 'cons', r);
          const snap = simRun(B, prof, seed, day - 1).st;
          const horizon = c === 'candy' ? 10 : 1;
          const play = (withIt) => {
            const st = cloneState(snap);
            for (const k of CONSUMABLES) st.daily[k] = false;
            if (withIt) st.daily[c] = true;
            let op = 0;
            for (let i = 0; i < horizon; i++) { const rec = {}; simDay(st, B, prof, seed, rec); st.hist.push(rec); op += rec.operating; }
            return op;
          };
          const g = play(true) - play(false);
          if (c === 'promo' && freeSlots(snap) < dayLoad(B, snap.day, false) + B.promoExtra) noRoom.push(g); else gains.push(g);
        }
        cells.push((gains.length ? fmt(mean(gains)) : '—') + (noRoom.length ? ` (${fmt(mean(noRoom))})` : ''));
      }
      rows.push(cells);
    }
  }
  console.log(mdTable(['игрок', 'расходник', 'цена', 'день 2', 'день 5', 'день 15', 'день 30', 'день 60'], rows));
}

// ---------------------------------------------------------------- доминирующие стратегии
function printStrategies(B) {
  console.log('\n## Выбор у стойки: что выгоднее (навык приёмки «среднего», разумные покупки, те же события)\n');
  const variants = [
    ['всегда «поговорить»', { visit: { talk: 1 } }],
    ['всегда «молча выдать»', { visit: { give: 1 } }],
    ['через раз', { visit: { talk: 0.5, give: 0.5 } }],
    ['«поговорить» до 5.0, потом «выдать»', { visit: { talk: 1 }, talkUntilCap: true }],
    ['20 % «отказать» → «всё же выдать»', { visit: { talk: 0.8, refuse: 0.2 }, refuseHard: 0 }],
    ['20 % «отказать» → «стоять на своём»', { visit: { talk: 0.8, refuse: 0.2 }, refuseHard: 1 }],
    ['пропажа: всегда «холодно отказать»', { visit: { talk: 1 }, lostSorry: 0 }],
    ['скандал: всегда худший ответ', { visit: { talk: 1 }, scandal: [0, 0, 1] }],
  ];
  const rows = [];
  for (const [name, patch] of variants) {
    const sk = { ...SKILLS.average, scandal: [1, 0, 0], bomzh: [1, 0, 0], lostSorry: 1, emptyPromise: 1, ...patch };
    SKILLS.__tmp = sk;
    const prof = { id: 'tmp', name, skill: '__tmp', policy: 'smart' };
    const m28 = [], m100 = [], r14 = [], r60 = [], t = [];
    for (let r = 0; r < Math.min(RUNS, 200); r++) {
      const hooks = patch.talkUntilCap ? { beforeDay: (st) => { SKILLS.__tmp.visit = st.rating >= 5 ? { give: 1 } : { talk: 1 }; } } : {};
      const { recs } = simRun(B, prof, hash(SEED, 'strat', r), DAYS, hooks);
      m28.push(recs[27].earned); m100.push(recs[DAYS - 1].earned); r14.push(recs[13].rating); r60.push(recs[59].rating);
      t.push(recs[27].minutes);
    }
    rows.push([name, fmt(quant(r14, 0.5), 2), fmt(quant(r60, 0.5), 2), fmt(quant(m28, 0.5)), fmt(quant(m100, 0.5)), fmt(quant(t, 0.5))]);
  }
  delete SKILLS.__tmp;
  console.log(mdTable(['выбор', 'рейтинг, день 14', 'рейтинг, день 60', 'заработано к 28-му', 'заработано к 100-му', 'минут к 28-му дню'], rows));
  if (B.id !== 'current') return;
  console.log('\n### Ответы скандалисту и бомжу (текущий баланс): ожидаемое изменение рейтинга\n');
  const srows = [];
  for (const s of SCANDALS) s.ch.forEach((ch) => {
    const ev = ch.risky ? B.riskyP * ch.ok + (1 - B.riskyP) * ch.fail : ch.dr;
    srows.push([s.id, ch.act, fmt(ev, 3) + (ch.cctv ? ' (с камерами −0.02)' : '') + (ch.candy ? ' (с конфетами 0.00; без −0.08)' : ''), ch.dm ? ch.dm + ' ₽' + (ch.cctv ? ' (с камерами −8)' : '') : '0', ch.debt ? 'завтра должник: +0.10 и выдача' : (ch.risky ? `риск: ${pct(B.riskyP)} успех` : '')]);
  });
  BOMZH.forEach((b) => srows.push(['бомж', b.act, fmt(b.dr, 2), '0', `кража пакетов/конфет ${pct(b.steal)}`]));
  console.log(mdTable(['ситуация', 'ответ', 'рейтинг (ожид.)', 'деньги', 'примечание'], srows));
}

// ---------------------------------------------------------------- сравнение «до / после»
function printCompare(resCur, resNew) {
  console.log('\n# Сравнение «до / после»: медиана денег (отчёт смены) и рейтинга\n');
  const P = PROFILES;
  console.log(mdTable(['день', ...P.map((p) => p.name + ': до → после')], REPORT_DAYS.filter((d) => d <= DAYS).map((d) => [d, ...P.map((p) =>
    `${fmt(quant(dayValues(resCur[p.id], d, (r) => r.moneyReport), 0.5))} → ${fmt(quant(dayValues(resNew[p.id], d, (r) => r.moneyReport), 0.5))}`)])));
  console.log('');
  console.log(mdTable(['день', ...P.map((p) => p.name + ': до → после')], REPORT_DAYS.filter((d) => d <= DAYS).map((d) => [d, ...P.map((p) =>
    `${fmt(quant(dayValues(resCur[p.id], d, (r) => r.rating), 0.5), 2)} → ${fmt(quant(dayValues(resNew[p.id], d, (r) => r.rating), 0.5), 2)}`)])));
  for (const p of [P[0], P[1], P[2]]) {
    console.log(`\n### ${p.name}: деньги (медиана), тыс. ₽ — до (●) и после (○)\n`);
    console.log('```');
    console.log(asciiChart([
      { name: 'до', ys: Array.from({ length: DAYS }, (_, i) => quant(dayValues(resCur[p.id], i + 1, (r) => r.moneyReport), 0.5) / 1000) },
      { name: 'после', ys: Array.from({ length: DAYS }, (_, i) => quant(dayValues(resNew[p.id], i + 1, (r) => r.moneyReport), 0.5) / 1000) },
    ], 12));
    console.log('```');
  }
  console.log('\n### Рейтинг (медиана), «средний» игрок: до (●) и после (○)\n');
  console.log('```');
  console.log(asciiChart([
    { name: 'до', ys: Array.from({ length: DAYS }, (_, i) => quant(dayValues(resCur.average, i + 1, (r) => r.rating), 0.5)) },
    { name: 'после', ys: Array.from({ length: DAYS }, (_, i) => quant(dayValues(resNew.average, i + 1, (r) => r.rating), 0.5)) },
  ], 10, 100, 1, 5));
  console.log('```');
}

// Сводка по вариантам баланса: одна строка на игрока
function printVariants(all) {
  console.log('\n# Сводка по вариантам баланса (медианы)\n');
  const rows = [];
  for (const [id, res] of Object.entries(all)) {
    const B = BALANCES[id];
    for (const p of PROFILES) {
      const runs = res[p.id];
      const keys = upgradeKeys(B);
      const allDay = runs.map((recs) => { const i = recs.findIndex((r, j) => keys.every((k) => recs.slice(0, j + 1).some((x) => x.bought.includes(k)))); return i >= 0 ? i + 1 : Infinity; });
      const dead = runs.map((recs) => { const ev = progressDays(B, recs); let c = 0; for (let d = 1; d <= recs.length; d++) { const nx = ev.find((x) => x > d); if ((nx === undefined ? recs.length + 1 : nx) - d > 4) c++; } return c; });
      const goals = runs.map((recs) => recs.filter((r) => r.goal && r.goal.hit).length / B.goals.length);
      const zero = runs.map((recs) => recs.filter((r) => r.moneyReport < 50).length);
      const san = runs.map((recs) => recs.filter((r) => r.sanation).length);
      const q = (arr) => quant(arr, 0.5);
      rows.push([B.name, p.name, fmt(q(dayValues(runs, 28, (r) => r.moneyReport))), fmt(q(dayValues(runs, 100, (r) => r.moneyReport))), fmt(q(dayValues(runs, 100, (r) => r.earned))),
        fmt(q(dayValues(runs, 28, (r) => r.rating)), 2), Number.isFinite(q(allDay)) ? fmt(q(allDay)) : 'не всё', fmt(q(dead)), pct(mean(goals)), fmt(mean(zero), 1), B.overdraft ? fmt(mean(san), 2) : '—']);
    }
  }
  console.log(mdTable(['баланс', 'игрок', 'деньги, день 28', 'деньги, день 100', 'заработано за 100 дней', 'рейтинг, день 28', 'всё куплено, день', 'дней «копить без смысла»', 'целей выполнено (любая ступень)', 'дней с деньгами < 50 ₽', 'санаций'], rows));
}

// ---------------------------------------------------------------- журнал одного прогона
function trace(profId) {
  const B = BALANCES[WHICH] || CURRENT;
  const prof = PROFILES.find((p) => p.id === profId) || PROFILES[0];
  const { recs } = simRun(B, prof, SEED, DAYS);
  console.log(`Журнал: ${prof.name}, баланс ${B.name}, seed ${SEED}`);
  console.log(mdTable(['день', 'клиентов', 'долгов', 'накл.', 'коробок', 'ошибок', 'не принято', 'приёмка ₽', 'выдач', 'потер.', 'выдачи ₽', 'аренда', 'курьер', 'премии', 'деньги', 'рейтинг', 'ур.', 'склад', 'мёртв.', 'куплено', 'мин'],
    recs.map((r) => [r.day, r.load + (r.scandal ? '+С' : '') + (r.bomzh ? '+Б' : ''), r.debtsIn, r.invSize, r.boxes, r.errors, r.invMissed + r.noSlot, r.accNet, r.delivered, r.lost, r.income, r.rent, r.courier, r.reward,
      r.moneyAfterShop + (r.sanation ? ' САНАЦИЯ' : ''), r.rating.toFixed(2), r.level, r.cap, r.dead, r.bought.join(' '), fmt(r.minutes, 1)])));
}

// ---------------------------------------------------------------- ASCII-график
function asciiChart(series, height = 16, width = 100, yMin = 0, yMaxFixed = null) {
  const maxY = yMaxFixed ?? Math.max(...series.flatMap((s) => s.ys.filter(Number.isFinite)));
  const marks = '●○■□▲△◆◇';
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));
  series.forEach((s, si) => s.ys.forEach((y, x) => {
    if (!Number.isFinite(y) || x >= width) return;
    const row = height - 1 - Math.round(((y - yMin) / (maxY - yMin)) * (height - 1));
    grid[Math.max(0, Math.min(height - 1, row))][x] = marks[si % marks.length];
  }));
  const lab = (i) => fmt(yMin + ((maxY - yMin) * (height - 1 - i)) / (height - 1), maxY - yMin < 20 ? 1 : 0).padStart(6);
  const lines = grid.map((row, i) => lab(i) + ' ┤' + row.join(''));
  lines.push(' '.repeat(7) + '└' + '─'.repeat(width));
  lines.push(' '.repeat(8) + 'день 1' + ' '.repeat(width - 14) + 'день ' + width);
  lines.push(series.map((s, si) => marks[si % marks.length] + ' ' + s.name).join('   '));
  return lines.join('\n');
}

// ---------------------------------------------------------------- калибровка
// --calib: журнал настоящей игры (work/economy/calib.mjs → calib-log*.json) пересчитывается шаг за шагом
// формулами симулятора: приёмка (по списку разобранных коробок), рейтинг визита, выплата, скандал, бомж,
// обещание, аренда. Затем та же политика бота прогоняется в симуляторе 2000 раз для сравнения распределений.
function calibPrediction() {
  const log = JSON.parse(fs.readFileSync(arg('calib-log', 'work/economy/calib-log.json'), 'utf8'));
  const B = CURRENT;
  const happyKeys = new Set(['give', 'talk', 'debt-success']);
  const keyDelta = { give: 'give', talk: 'talk', 'debt-success': 'debtSuccess', 'debt-fail': 'debtFail', 'refuse-soft': 'refuseSoft', 'refuse-hard': 'refuseHard', 'lost-sorry': 'lostSorry', 'lost-cold': 'lostCold' };
  let checks = 0, ok = 0; const bad = []; const daysRows = [];
  const cmp = (what, pred, act, run, day) => { checks++; if (Math.abs(pred - act) < 1e-9) ok++; else bad.push([run, day, what, pred, act]); };
  for (const run of log.runs) {
    let sorts = [], lastKey = null, day = 1;
    for (const e of run.events) {
      if (e.t === 'start') { day = e.day; sorts = []; cmp('клиентов по дню (getDayLoad)', dayLoad(B, e.day, e.load > table(B.dayLoad, e.day)), e.load, run.run, day); }
      else if (e.t === 'sort') sorts.push(e);
      else if (e.t === 'acc') {
        const pool = B.poolBase + B.poolPerItem * e.inv; let paid = 0, bonus = 0, penalty = 0, oursOk = 0;
        for (const { kind: k, bin } of sorts) {
          if (bin !== k) { if (!e.gloves) penalty += B.wrongPenalty; continue; }
          if (k === 'ours') { bonus += B.oursReward; oursOk++; }
          else { const got = Math.min(k === 'broken' ? B.brokenReward : B.othersReward, Math.max(0, pool - paid)); paid += got; bonus += got; }
        }
        const net = bonus - penalty + e.trolley * B.trolleyPerLvl * oursOk;
        cmp('пул приёмки 40+15×накладная', pool, e.pool, run.run, day);
        cmp('деньги после приёмки', Math.max(0, e.m0 + net), e.money, run.run, day);
        const cnt = (k) => sorts.filter((x) => x.kind === k).length;
        daysRows.push([run.run + 1, day, e.inv, sorts.length, sorts.filter((x) => x.bin !== x.kind).length, e.sec.toFixed(1), e.duration, `${cnt('ours')}/${cnt('others')}/${cnt('broken')}`, net]);
        sorts = [];
      } else if (e.t === 'visit') {
        lastKey = e.key;
        let d = B.rating[keyDelta[e.key]];
        if (d > 0 && e.candy) d = r2(d * B.candyMult);
        cmp('рейтинг визита (' + e.key + (e.candy ? ', конфеты' : '') + ')', Math.max(1, Math.min(5, r2(e.r0 + d))), e.rating, run.run, day);
      } else if (e.t === 'pay') {
        const pay = Math.round((B.incomeBase + (happyKeys.has(lastKey) && e.wrap ? B.wrapBonus : 0)) * (B.multA + (e.rating / 5) * B.multB));
        cmp('выплата за выдачу' + (e.wrap ? ' (пакеты)' : ''), e.m0 + pay, e.money, run.run, day);
      } else if (e.t === 'scandal') {
        const ch = SCANDALS.find((x) => x.id === e.type).ch.find((c) => c.act === e.act);
        const preds = (ch.risky ? [ch.ok, ch.fail] : [ch.dr]).map((x) => { let r = x, m = ch.dm || 0; if (ch.cctv && e.cctv) { r = Math.max(r, -0.02); if (m < 0) m = Math.floor(m / 2); } if (ch.candy) r = e.candy ? r + 0.04 : -0.08; return [Math.max(1, Math.min(5, r2(e.r0 + r))), Math.max(0, e.m0 + m)]; });
        const hit = preds.find(([r, m]) => Math.abs(r - e.rating) < 1e-9 && m === e.money) || preds[0];
        cmp('скандал ' + e.type + '/' + e.act + ' рейтинг', hit[0], e.rating, run.run, day);
        cmp('скандал ' + e.type + '/' + e.act + ' деньги', hit[1], e.money, run.run, day);
      } else if (e.t === 'bomzh') {
        cmp('бомж ' + e.act, Math.max(1, Math.min(5, r2(e.r0 + BOMZH.find((b) => b.act === e.act).dr))), e.rating, run.run, day);
      } else if (e.t === 'promise') {
        const pr = e.res === 'retry' ? [Math.max(1, r2(e.r0 + B.debtRating2)), Math.max(0, e.m0 - B.debtFine2)] : e.res === 'burned' ? [Math.max(1, r2(e.r0 + B.debtBurn)), e.m0] : [e.r0, e.m0];
        cmp('обещание (' + e.res + ') рейтинг', pr[0], e.rating, run.run, day);
        cmp('обещание (' + e.res + ') деньги', pr[1], e.money, run.run, day);
      } else if (e.t === 'dayend') cmp('аренда за день ' + e.finished, Math.max(0, e.m0 - expensesFor(B, e.finished)), e.money, run.run, day);
    }
  }
  console.log('## Калибровка: пошаговая сверка с журналом настоящей игры\n');
  console.log(`Журнал: ${arg('calib-log', 'work/economy/calib-log.json')} (темп бота ${log.pace} мс, ошибок ${pct(log.errors || 0)}, ${log.norack ? 'без стеллажа' : 'стеллаж после 2-го дня'})`);
  console.log(`Проверок: ${checks}, совпало: ${ok}, расхождений: ${bad.length}\n`);
  if (bad.length) console.log(mdTable(['прогон', 'день', 'шаг', 'модель', 'игра'], bad.map((b) => [b[0] + 1, ...b.slice(1)])) + '\n');
  console.log(mdTable(['прогон', 'день', 'накладная', 'коробок', 'ошибок', 'сек приёмки', 'таймер', 'свои/чужие/брак', 'приёмка ₽'], daysRows));
  const kinds = {}; for (const r of log.runs) for (const e of r.events) if (e.t === 'visit') kinds[e.key] = (kinds[e.key] || 0) + 1;
  console.log('\nИсходы визитов в журнале: ' + Object.entries(kinds).map(([k, v]) => k + ' ×' + v).join(', '));
  const nd = Math.max(...log.runs.map((r) => r.days.length));
  const prof = { id: 'bot', name: 'бот', skill: 'bot', policy: 'calib' };
  const botShop = (st, B2, p, rec) => {
    const b = (k, c, f) => { if (st.money >= c) { st.money -= c; f(); rec.bought.push(k); } };
    if (st.day - 1 === 1) { b('candy', 52, () => { st.daily.candy = true; }); b('wrap', 75, () => { st.daily.wrap = true; }); }
    if (st.day - 1 === 2 && !log.norack) { b('rack1', 450, () => { st.cap = 6; }); if (st.cap >= 6) b('promo', 75, () => { st.daily.promo = true; }); }
  };
  SKILLS.bot.rBase = log.pace / 1000 - B.nextBoxSec + 0.03;
  SKILLS.bot.acc = 1 - (log.errors || 0);
  const res = [];
  for (let r = 0; r < 2000; r++) res.push(simRun(B, prof, hash(SEED, 'calib', r), nd, { shop: botShop }).recs);
  console.log('\nСимулятор, та же политика (2000 прогонов): медиана [10 %; 90 %]; игра — прогоны бота');
  console.log(mdTable(['день', 'деньги: модель', 'деньги: игра', 'рейтинг: модель', 'рейтинг: игра'], Array.from({ length: nd }, (_, i) => i + 1).map((d) => {
    const m = res.map((x) => x[d - 1].moneyReport), rt = res.map((x) => x[d - 1].rating);
    return [d, band(m), log.runs.map((r) => r.days[d - 1] && r.days[d - 1].end.money).join(', '), band(rt, 2), log.runs.map((r) => r.days[d - 1] && r.days[d - 1].end.rating.toFixed(2)).join(', ')];
  })));
}


// ---------------------------------------------------------------- калибровочный бот (настоящая игра)
// --calib-run: поднимает tools/serve.mjs, бот (Playwright) играет в настоящую игру и пишет журнал событий,
// затем тот же журнал сверяется формулами симулятора (--calib). Playwright нужен только для этого режима.
//   node docs/review/economy-sim.mjs --calib-run [--bot-runs 3] [--bot-days 3] [--pace 1000] [--errors 0.15] [--norack]
//                                         [--port 8803] [--calib-log work/economy/calib-log.json]
// Бот: сортирует в заданном темпе до конца накладной и пула (с долей ошибок --errors), всегда «поговорить»,
// в скандале — первый ответ, бомжу — «пустить погреться», пропажа — «извиниться». Покупки: после 1-го дня
// конфеты и пакеты, после 2-го — стеллаж яруса 2 и реклама на районе (без --norack).
async function calibRun() {
  const { spawn } = await import('node:child_process');
  const { chromium } = await import('playwright');
  const BOT_RUNS = Number(arg('bot-runs', 3)), BOT_DAYS = Number(arg('bot-days', 3));
  const PACE = Number(arg('pace', 1000)), PORT = Number(arg('port', 8803)), ERR = Number(arg('errors', 0));
  const NORACK = flag('norack'), OUT = arg('calib-log', 'work/economy/calib-log.json');
  const URL_ = `http://localhost:${PORT}/?adMs=200`;
  const server = spawn(process.execPath, ['tools/serve.mjs', '--port', String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const HOOKS = () => {
    const L = (window.__econ = { events: [] });
    const push = (e) => L.events.push({ ...e, money: gameState.money, rating: gameState.rating, day: gameState.day });
    const wrap = (name, before, after) => {
      const orig = window[name];
      window[name] = function (...a) { const ctx = before ? before(...a) : {}; const r = orig.apply(this, a); if (after) after(ctx, r, ...a); return r; };
    };
    wrap('onSort', () => { const c = acceptance && acceptance.current; return { kind: c && !c.sorted ? c.expected : null }; },
      (ctx, r, bin) => { if (ctx.kind && acceptance.current && acceptance.current.sorted) push({ t: 'sort', kind: ctx.kind, bin }); });
    wrap('finishAcceptance', () => ({ m0: gameState.money, running: acceptance && acceptance.running }), (ctx) => {
      if (!ctx.running) return;
      const st = acceptance.stats;
      push({ t: 'acc', m0: ctx.m0, inv: acceptance.invoice.length, pool: acceptance.rewardPool, trolley: gameState.upg.trolley || 0,
        gloves: !!gameState.daily.gloves, sec: acceptance.duration - st.timeLeft, duration: acceptance.duration });
    });
    wrap('applyVisitOutcome', () => ({ r0: gameState.rating, key: visitRatingKey(), candy: !!gameState.daily.candy }), (ctx, delta) => push({ t: 'visit', ...ctx, delta }));
    wrap('showResult', () => ({ m0: gameState.money, wrap: !!gameState.daily.wrap }), (ctx) => push({ t: 'pay', ...ctx }));
    wrap('onScandalChoice', (v, type, ch) => ({ r0: gameState.rating, m0: gameState.money, type: type.id, act: ch.act, candy: !!gameState.daily.candy, cctv: !!gameState.expansion.cctv }), (ctx) => push({ t: 'scandal', ...ctx }));
    wrap('onBomzhChoice', (v, ev, ch) => ({ r0: gameState.rating, act: ch.act }), (ctx) => push({ t: 'bomzh', ...ctx }));
    wrap('registerDebtPromise', () => ({ r0: gameState.rating, m0: gameState.money }), (ctx, res) => push({ t: 'promise', ...ctx, res }));
    wrap('showDayEnd', () => ({ m0: gameState.money, finished: gameState.day - 1 }), (ctx) => push({ t: 'dayend', ...ctx }));
    wrap('startAcceptance', () => ({}), () => push({ t: 'start', load: getDayLoad(gameState.day) }));
  };
  const playAcceptance = async (p) => {
    for (let i = 0; i < 400; i++) {
      const st = await p.evaluate((err) => {
        if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'guide'; }
        if (!acceptance || !acceptance.running) return 'done';
        const c = acceptance.current;
        if (!c || c.sorted) return 'wait';
        if (acceptance.invoice.every((x) => x.sorted) && (acceptance.paidOut || 0) >= acceptance.rewardPool) { endAcceptanceNow(); return 'done'; }
        let bin = c.expected;
        if (Math.random() < err) { const o = ['ours', 'others', 'broken'].filter((b) => b !== c.expected); bin = o[Math.random() < 0.5 ? 0 : 1]; }
        onSort(bin);
        if (!acceptance.current.sorted) { if (c.expected === 'ours') { endAcceptanceNow(); return 'done'; } onSort(c.expected); }
        return 'sorted';
      }, ERR);
      if (st === 'done') return;
      await p.waitForTimeout(st === 'sorted' ? PACE : 60);
    }
    throw new Error('приёмка не закончилась');
  };
  const playCustomers = async (p) => {
    for (let i = 0; i < 900; i++) {
      const r = await p.evaluate(() => {
        const act = document.querySelector('.screen-card.active').id;
        if (document.getElementById('tutorial-overlay').classList.contains('show')) { document.getElementById('tutorial-btn').click(); return 'guide'; }
        if (act === 'screen-dayend') return 'dayend';
        if (act === 'screen-morning') { const b = document.getElementById('btn-summary-continue'); if (b) b.click(); return 'doors'; }
        if (act === 'screen-scene') {
          if (sceneQueue.length) { tapScene(); return 'tap'; }
          const cont = document.querySelector('#btn-scene-continue:not([disabled])');
          if (cont) { cont.click(); return 'continue'; }
          const ch = [...document.querySelectorAll('.scene-choice:not(.disabled):not([disabled])')];
          if (!ch.length) return 'wait';
          (ch.find((b) => /Поговорить|Поддержать диалог/.test(b.textContent)) || ch[0]).click();
          return 'choice';
        }
        if (act === 'screen-warehouse') {
          if (document.getElementById('scan-overlay').classList.contains('show')) return 'scanning';
          const code = gameState.activeVisitor.orderCode;
          const plate = [...document.querySelectorAll('.wh-plate-num')].find((n) => n.textContent === '#' + code);
          if (plate) { plate.click(); scanStart(); return 'scan'; }
          const lost = document.querySelector('.refuse-btn');
          if (lost) { lost.click(); return 'lost'; }
          return 'wait';
        }
        if (act === 'screen-result') { const b = document.getElementById('btn-next-customer'); if (!b.disabled) b.click(); return 'next'; }
        return act;
      });
      if (r === 'dayend') return;
      await p.waitForTimeout(r === 'scan' ? 1500 : ['choice', 'continue', 'next', 'doors'].includes(r) ? 700 : 250);
    }
    throw new Error('смена не закончилась');
  };
  const botShop = (p, day) => p.evaluate(({ day, norack }) => {
    const bought = [];
    const buy = (key, cost, apply) => { if (gameState.money >= cost) { gameState.money -= cost; gameState.dayShopSpend += cost; apply(); bought.push(key); } };
    if (day === 1) { buy('candy', 52, () => { gameState.daily.candy = true; }); buy('wrap', 75, () => { gameState.daily.wrap = true; }); }
    if (day === 2 && !norack) { buy('rack1', 450, () => { gameState.warehouseCapacity = 6; gameState.expansion.rack1 = true; }); if (gameState.warehouseCapacity >= 6) buy('promo', 75, () => { gameState.daily.promo = true; }); }
    YG.save({ phase: 'shop' });
    return { bought, money: gameState.money };
  }, { day, norack: NORACK });
  const out = { pace: PACE, errors: ERR, norack: NORACK, runs: [] };
  const browser = await chromium.launch();
  try {
    for (let run = 0; run < BOT_RUNS; run++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await ctx.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(URL_);
      await p.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'));
      await p.waitForTimeout(600);
      await p.evaluate(HOOKS);
      await p.evaluate(() => window.__econ.events.push({ t: 'start', load: getDayLoad(gameState.day), day: gameState.day, money: gameState.money, rating: gameState.rating }));
      const start = await p.evaluate(() => ({ money: gameState.money, rating: gameState.rating }));
      const days = [];
      for (let d = 1; d <= BOT_DAYS; d++) {
        await playAcceptance(p);
        await playCustomers(p);
        const end = await p.evaluate(() => ({ money: gameState.money, rating: gameState.rating, day: gameState.day }));
        const purchases = await botShop(p, d);
        days.push({ day: d, end, purchases });
        console.log(`бот ${run + 1}, день ${d}: ${end.money} ₽, рейтинг ${end.rating}; куплено: ${purchases.bought.join(', ') || '—'}`);
        if (d < BOT_DAYS) { await p.evaluate(() => YG.startNewDay()); await p.waitForTimeout(900); }
      }
      out.runs.push({ run, start, days, events: await p.evaluate(() => window.__econ.events), errors });
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  const dir = OUT.split('/').slice(0, -1).join('/');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('журнал: ' + OUT + '\n');
  calibPrediction();
}

// ---------------------------------------------------------------- main
// --fit-levels: медиана и 25-й перцентиль «заработано всего» у среднего игрока по дням — для порогов уровней и целей
function fitLevels() {
  const B = { ...PROPOSED, levels: null, goals: [], unlock: {}, extraUpgrades: PROPOSED.extraUpgrades.map((u) => ({ ...u, unlock: u.unlock.map(() => 0) })) };
  const runs = monteCarlo(B, PROFILES[1]);
  const at = (d, q) => Math.round(quant(dayValues(runs, d, (r) => r.earned), q) / 50) * 50;
  const step = Number(arg('step', 2.5));
  console.log('Пороги уровней (уровень n ≈ день ' + step + '·n у среднего): [' + Array.from({ length: 40 }, (_, i) => at(Math.min(DAYS, Math.max(1, Math.round(step * (i + 1)))), 0.5)).join(', ') + ']');
  console.log('Заработано к дню 28/56/84, 25-й перцентиль: ' + [28, 56, 84].map((d) => at(d, 0.25)).join(' / ') + '; медиана: ' + [28, 56, 84].map((d) => at(d, 0.5)).join(' / '));
}

const BALANCES = { current: CURRENT, minimal: MINIMAL, proposed: PROPOSED };
function main() {
  if (flag('fit-levels')) return fitLevels();
  if (flag('calib-run')) return calibRun();
  if (flag('calib')) return calibPrediction();
  if (TRACE) return trace(TRACE);
  const balances = WHICH === 'both' ? [CURRENT, PROPOSED] : WHICH === 'all' ? [CURRENT, MINIMAL, PROPOSED] : [BALANCES[WHICH] || CURRENT];
  const all = {};
  const json = {};
  for (const B of balances) {
    console.log(`\n# Баланс: ${B.name} (${RUNS} прогонов × ${DAYS} дней, seed ${SEED})\n`);
    const res = {};
    for (const prof of PROFILES) res[prof.id] = monteCarlo(B, prof);
    all[B.id] = res;
    printAll(B, res);
    json[B.id] = Object.fromEntries(PROFILES.map((p) => [p.id, Array.from({ length: DAYS }, (_, i) => {
      const m = dayValues(res[p.id], i + 1, (r) => r.moneyReport), rt = dayValues(res[p.id], i + 1, (r) => r.rating);
      return { d: i + 1, m10: quant(m, 0.1), m50: quant(m, 0.5), m90: quant(m, 0.9), r10: quant(rt, 0.1), r50: quant(rt, 0.5), r90: quant(rt, 0.9) };
    })]));
  }
  if (all.current && all.proposed && ONLY.has('compare')) printCompare(all.current, all.proposed);
  if (Object.keys(all).length > 1 && ONLY.has('compare')) printVariants(all);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(json));
}
main();
