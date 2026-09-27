
'use strict';

// === ЗВУК ===
// Громкость фоновой музыки (0..1). Раньше было 0.3 — музыка перекрывала игру.
// Применяется через GainNode Web Audio: на iOS свойство volume у <audio> игнорируется.
const BGM_VOLUME = 0.12;
const audio = {
  enabled: true, ctx: null, bgmAudio: null, bgmGain: null, _bgmWired: false,
  ensure() {
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) this.ctx = new AC(); }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.enabled) this.startBGM();
  },
  play(freqs, dur, type, vol) {
    if (!this.enabled) return;
    this.ensure(); if (!this.ctx) return;
    const now = this.ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, now + i * 0.02);
      g.gain.setValueAtTime(vol || 0.15, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(now); o.stop(now + dur);
    });
  },
  good() { this.play([523, 659, 784], 0.25, 'triangle', 0.18); },
  bad() { this.play([180, 90], 0.18, 'sawtooth', 0.18); },
  coin() { this.play([1046, 1318, 1567, 2093], 0.2, 'sine', 0.13); },
  tap() { this.play([600, 200], 0.03, 'triangle', 0.1); },
  whoosh() { this.play([400, 200], 0.1, 'sine', 0.12); },
  startBGM() {
    if (!this.enabled) return;
    if (!this.bgmAudio) {
      this.bgmAudio = new Audio('assets/bgm-audio.mp3');
      this.bgmAudio.loop = true;
      this.bgmAudio.volume = BGM_VOLUME; // запасной вариант, если Web Audio недоступен
    }
    this._wireBGM();
    if (!this.bgmAudio.paused) return; // уже играет — не дёргаем play() на каждый SFX
    // До первого жеста браузер всё равно заблокирует play() — не шумим в консоль
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const p = this.bgmAudio.play();
    if (p && p.catch) p.catch(() => {});
    this._fadeInBGM();
  },
  // Музыка -> GainNode -> выход: громкость работает и на iOS
  _wireBGM() {
    if (this._bgmWired || !this.ctx || !this.bgmAudio) return;
    try {
      const src = this.ctx.createMediaElementSource(this.bgmAudio);
      const g = this.ctx.createGain();
      g.gain.value = BGM_VOLUME;
      src.connect(g); g.connect(this.ctx.destination);
      this.bgmGain = g;
      this.bgmAudio.volume = 1; // громкость целиком задаёт GainNode
    } catch (e) { /* остаёмся на element.volume */ }
    this._bgmWired = true;
  },
  // Плавный вход музыки (~1.2 с), чтобы не «врубалась» резко
  _fadeInBGM() {
    if (!this.bgmGain || !this.ctx) return;
    try {
      const g = this.bgmGain.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.001, t);
      g.exponentialRampToValueAtTime(BGM_VOLUME, t + 1.2);
    } catch (e) {}
  },
  stopBGM() {
    if (this.bgmAudio) {
      this.bgmAudio.pause();
    }
  },
  suspend() { 
    try { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); } catch (e) {} 
    if (this.bgmAudio) this.bgmAudio.pause();
  },
  resume() { 
    try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) {} 
    if (this.enabled && this.bgmAudio) this.bgmAudio.play().catch(()=>{});
  }
};

function toggleSound() {
  audio.enabled = !audio.enabled;
  const btn = document.getElementById('btn-sound-toggle');
  if (btn) btn.textContent = audio.enabled ? '🔊' : '🔇';
  if (audio.enabled) {
    audio.ensure(); // this will also start BGM
  } else {
    audio.stopBGM();
  }
  try { localStorage.setItem('pvz_sound_v1', audio.enabled ? '1' : '0'); } catch (e) {} // M-6
}
try {
  if (localStorage.getItem('pvz_sound_v1') === '0') {
    audio.enabled = false;
    const _sb = document.getElementById('btn-sound-toggle');
    if (_sb) _sb.textContent = '🔇'; // иконка должна соответствовать сохранённой настройке
  }
} catch (e) {}

// === ЭКРАН ЗАГРУЗКИ ===
// Хид-функция идемпотентна: вызывает showScreen() неоднократно, но экран
// загрузки гаснет ровно один раз — когда показан первый игровой экран.
let _loadingHidden = false;
function hideGameLoading() {
  if (_loadingHidden) return;
  _loadingHidden = true;
  const ls = document.getElementById('loading-screen');
  if (ls) ls.classList.add('hidden');
  // Через кадр полностью убираем из DOM, чтобы не перехватывал нажатия в CSS-переходе
  setTimeout(() => { if (ls && ls.parentNode) ls.parentNode.removeChild(ls); }, 600);
}
// Страховка: если boot() по какой-то причине не показал игровой экран
// (например, неожиданная ошибка), снимаем загрузку, чтобы не было вечного «тудера».
setTimeout(() => { hideGameLoading(); }, 12000);

// === ПАРАМЕТРЫ МИНИ-ИГРЫ ===
const ROUND_DURATION = 30; // секунд
const CORRECT_REWARD = 15; // ₽ за правильную сортировку (сбалансировано)
const WRONG_PENALTY = 25;  // ₽ за ошибку
const BROKEN_BONUS = 25;   // ₽ за поимку брака

const PARCEL_SPRITES = [
  "assets/parcel-sprites-01.webp",
  "assets/parcel-sprites-02.webp",
  "assets/parcel-sprites-03.webp",
  "assets/parcel-sprites-04.webp",
  "assets/parcel-sprites-05.webp",
  "assets/parcel-sprites-06.webp",
  "assets/parcel-sprites-07.webp",
  "assets/parcel-sprites-08.webp",
  "assets/parcel-sprites-09.webp",
  "assets/parcel-sprites-10.webp",
  "assets/parcel-sprites-11.webp",
  "assets/parcel-sprites-12.webp",
  "assets/parcel-sprites-13.webp",
  "assets/parcel-sprites-14.webp",
  "assets/parcel-sprites-15.webp",
  "assets/parcel-sprites-16.webp",
  "assets/parcel-sprites-17.webp",
  "assets/parcel-sprites-18.webp",
  "assets/parcel-sprites-19.webp",
  "assets/parcel-sprites-20.webp",
  "assets/parcel-sprites-21.webp",
  "assets/parcel-sprites-22.webp",
  "assets/parcel-sprites-23.webp",
  "assets/parcel-sprites-24.webp",
  "assets/parcel-sprites-25.webp"
];

const PARCEL_SPRITES_TORN = [
  "assets/parcel-sprites-torn-01.webp",
  "assets/parcel-sprites-torn-02.webp",
  "assets/parcel-sprites-torn-03.webp",
  "assets/parcel-sprites-torn-04.webp",
  "assets/parcel-sprites-torn-05.webp",
  "assets/parcel-sprites-torn-06.webp",
  "assets/parcel-sprites-torn-07.webp",
  "assets/parcel-sprites-torn-08.webp",
  "assets/parcel-sprites-torn-09.webp",
  "assets/parcel-sprites-torn-10.webp",
  "assets/parcel-sprites-torn-11.webp",
  "assets/parcel-sprites-torn-12.webp",
  "assets/parcel-sprites-torn-13.webp",
  "assets/parcel-sprites-torn-14.webp",
  "assets/parcel-sprites-torn-15.webp"
];

const PARCEL_LABEL_META = [
  { x: 66, y: 48, rot: 1.6, ink: '#2b241d', w: 210, h: 212 },
  { x: 47, y: 45, rot: 0.5, ink: '#2b241d', w: 280, h: 136 },
  { x: 74, y: 37, rot: 1.2, ink: '#2b241d', w: 194, h: 200 },
  { x: 29, y: 44, rot: -0.5, ink: '#2b241d', w: 94, h: 244 },
  { x: 51, y: 48, rot: 1.5, ink: '#2b241d', w: 196, h: 180 },
  { x: 49, y: 50, rot: -1.7, ink: '#2b241d', w: 182, h: 186 },
  { x: 35, y: 45, rot: -0.3, ink: '#2b241d', w: 200, h: 204 },
  { x: 49, y: 48, rot: -1.5, ink: '#2b241d', w: 208, h: 182 },
  { x: 52, y: 47, rot: -1.6, ink: '#2b241d', w: 202, h: 210 },
  { x: 47, y: 46, rot: -1.4, ink: '#2b241d', w: 278, h: 150 },
  { x: 50, y: 19, rot: 0.5, ink: '#2b241d', w: 198, h: 204 },
  { x: 74, y: 49, rot: 1.6, ink: '#2b241d', w: 200, h: 206 },
  { x: 53, y: 49, rot: 0.3, ink: '#2b241d', w: 280, h: 119 },
  { x: 50, y: 43, rot: 1.7, ink: '#2b241d', w: 214, h: 166 },
  { x: 29, y: 23, rot: 0.2, ink: '#2b241d', w: 188, h: 204 },
  { x: 47, y: 53, rot: -0.8, ink: '#2b241d', w: 207, h: 280 },
  { x: 46, y: 49, rot: 0.1, ink: '#2b241d', w: 263, h: 280 },
  { x: 50, y: 52, rot: -0.7, ink: '#2b241d', w: 180, h: 280 },
  { x: 57, y: 41, rot: -1.1, ink: '#2b241d', w: 242, h: 260 },
  { x: 50, y: 50, rot: 0.3, ink: '#2b241d', w: 169, h: 280 },
  { x: 47, y: 47, rot: -0.5, ink: '#2b241d', w: 266, h: 262 },
  { x: 27, y: 56, rot: 0.8, ink: '#2b241d', w: 168, h: 280 },
  { x: 50, y: 50, rot: -1.6, ink: '#2b241d', w: 248, h: 258 },
  { x: 51, y: 50, rot: -0.0, ink: '#2b241d', w: 242, h: 250 },
  { x: 47, y: 53, rot: -0.3, ink: '#2b241d', w: 190, h: 280 }
];

const ALL_PARCELS = [
  // Аудит: уникальные метки (без дублей с FEMALE/SENIOR-пулами) + реплики клиента
  // про заказ — раньше для этих товаров в диалоге была только заглушка «по мелочи».
  { code: '4829', label: 'Сковорода DEFAL', product: 'DEFAL Titanium 24см', replies: [
      'Сковорода DEFAL. Говорят, неубиваемая. Посмотрим.',
      'Titanium на 24 см — по отзывам беру, хвалят.',
      'Сковородка. Старая пригорает намертво, нужна замена.'] },
  { code: '7721', label: 'Тонометр M3', product: 'автоматический M3', replies: [
      'Тонометр автоматический: самому мерить, без танцев.',
      'М3 — врач сказал контролировать. Контролирую.',
      'Аппарат для давления. Для родителей — стесняются просить.'] },
  { code: '9015', label: 'Наушники SONICX', product: 'SONICX Pro Max', replies: [
      'SONICX с шумодавом — в автобусе спасение.',
      'Наушники Pro Max. По скидке, цена — сказка.',
      'Наушники. Старые отвалились, беру замену.'] },
  { code: '3318', label: 'Чехол для телефона', product: 'чехол для смартфона 15', replies: [
      'Чехол на телефон. Чтобы не разбить в первый же день.',
      'Чехол с кармашком — карты вечно врозь.',
      'Магнитный, с подставкой. Игрушка игрушкой, а полезная.'] },
  { code: '6677', label: 'Книга-бестселлер', product: 'Бестселлер 2024', replies: [
      'Бестселлер года — все читают, не хочу отставать.',
      'Книга. В бумаге — не то, что с экрана.',
      'Книга по акции. Давно присматриваю, вот и повод.'] },
  { code: '2204', label: 'Кофе MONARQ', product: 'зерновой MONARQ 1кг', replies: [
      'Кофе зерновой, килограмм. В доме не переводится.',
      'MONARQ — заваривать и никуда не спешить.',
      'Кофе. Без него утро не начинается.'] },
  { code: '8801', label: 'Плюшевый мишка', product: 'Плюшевый мишка 30см', replies: [
      'Мишка. Внучке на день рождения — обожает таких.',
      'Игрушка 30 см. Ребёнок просил, сердце не выдержало.',
      'Плюшевый мишка. Ну, для дивана. И для настроения.'] },
  { code: '5544', label: 'Лампа LUMOS', product: 'LUMOS Настольная', replies: [
      'Лампа LUMOS. Настольная, три режима — красота.',
      'Светильник. Для чтения — глаза скажут спасибо.',
      'Лампа. По скидке, в магазине вдвое дороже.'] },
  { code: '7766', label: 'Карандаши', product: 'набор 12 цветов', replies: [
      'Карандаши, 12 цветов. Скетчи, настроение.',
      'Набор карандашей. Разные грифели — для штриховки и обводки.',
      'Карандаши. Рисовать никогда не поздно, а начинать — с красивого.'] },
  { code: '9920', label: 'Кроссовки Air Run', product: 'кроссовки Air Run 42р', replies: [
      'Кроссовки Air Run, 42-й. По отзывам — размер в размер.',
      'Кроссовки. Для зала и для города — универсальные.',
      'Кроссы по скидке. Проверено: сидят как надо.'] },
  { code: '4455', label: 'Чайник BOCHSEN', product: 'BOCHSEN 2л', replies: [
      'Чайник BOCHSEN на два литра. Кипяток нужен всегда.',
      'Чайник. Со свистком старый надоел, беру тихий.',
      'Чайник металлический. Говорят, неубиваемый — проверим.'] },
  { code: '1122', label: 'Ручка Vector', product: 'ручка Vector синяя', replies: [
      'Ручка Vector. Писать — удовольствие.',
      'Синяя ручка. Для подписей, для списков, для открыток.',
      'Ручка. Надо было срочно, а тут ровно моя.'] },
  { code: '3366', label: 'Очки Skyfarer', product: 'очки Skyfarer', replies: [
      'Skyfarer. Глаза от солнца скажут спасибо.',
      'Очки. Имидж, солнце, защита — три в одном.',
      'Очки затемнённые. Лето близко, я готовлюсь заранее.'] },
  { code: '7788', label: 'Крем для рук', product: 'увлажняющий крем 200мл', replies: [
      'Крем увлажняющий, 200 мл. На зиму — спасение.',
      'Крем. Говорят, спасает после отопления — проверю на себе.',
      'Крем для рук. Кожа после отопления сохнет — лечим.'] }
];

// === ПЕРСОНАЖИ ===

// === СОСТОЯНИЕ ИГРЫ (база) ===
// Смена = DAY_LOAD визитов; у каждого визита есть текст сцены и варианты действий
// (см. startScene). Выбор игрока пишется в gameState.lastChoice и влияет на рейтинг.

const gameState = {
  day: 1, money: 150, rating: 3.5,
  warehouseCapacity: 3,
  shelfParcels: [],
  visitorCount: 3, visitorIndex: 0,
  totalVisits: 0,
  activeVisitor: null,
  lastChoice: null,
  upg: { routine: 0, scanner: 0 },
  daily: { coffee: false, wrap: false, gloves: false, candy: false, promo: false },
  
  expansion: { rack1: false, rack2: false, cctv: false },
  dayGrossIncome: 0,
  dayShopSpend: 0,
  tutorialShown: false,
  guidesSeen: {}
};

function getDayLoad(day) {
  // Баланс (растянут ~в 1.5 раза): рост нагрузки замедлен, чтобы прогрессия
  // не «схлопывалась» в первые 2 недели, а плавно шла через середину игры.
  let base = 3;
  if (day >= 4 && day <= 11) base = 4;
  else if (day >= 12 && day <= 21) base = 5;
  else if (day >= 22 && day <= 42) base = 6;
  else if (day >= 43 && day <= 63) base = 7;
  else if (day >= 64) base = 8;
  if (gameState.daily && gameState.daily.promo) base += 2;
  return base;
}

function getDailyExpenses(finishedDay) {
  // Аудит: расходы растут вместе с доходом — иначе с 22-го дня «пресс» исчезает совсем
  if (finishedDay <= 3) return { rent: 0, utilities: 0, total: 0, isHoliday: true, label: '0 ₽ (Каникулы ' + finishedDay + '/3 🎁)' };
  if (finishedDay <= 7) return { rent: 55, utilities: 15, total: 70, isHoliday: false, label: '-70 ₽' };
  if (finishedDay <= 14) return { rent: 105, utilities: 45, total: 150, isHoliday: false, label: '-150 ₽' };
  if (finishedDay <= 21) return { rent: 205, utilities: 55, total: 260, isHoliday: false, label: '-260 ₽' };
  if (finishedDay <= 28) return { rent: 285, utilities: 65, total: 350, isHoliday: false, label: '-350 ₽' };
  if (finishedDay <= 42) return { rent: 390, utilities: 90, total: 480, isHoliday: false, label: '-480 ₽' };
  return { rent: 495, utilities: 105, total: 600, isHoliday: false, label: '-600 ₽' };
}

// Сколько свободных мест на складе. Производная величина: счётчик в шапке физически
// не может разойтись с тем, что нарисовано на полках (раньше это были две разные переменные).
function warehouseFree() {
  return Math.max(0, gameState.warehouseCapacity - (gameState.shelfParcels || []).length);
}

function updateHUD() {
  const elDay = document.getElementById('hud-day');
  if (elDay) elDay.textContent = gameState.day;

  const elMoney = document.getElementById('hud-money');
  if (elMoney) elMoney.textContent = gameState.money + ' ₽';

  const elRating = document.getElementById('hud-rating');
  if (elRating) elRating.textContent = gameState.rating.toFixed(2);

  updateStockHud();
}

// E-6: производный счётчик склада — учитывает коробки, принятые в эту же утреннюю приёмку
function updateStockHud() {
  const elStock = document.getElementById('hud-stock');
  if (!elStock) return;
  const during = (acceptance && acceptance.running && acceptance.acceptedList) ? acceptance.acceptedList.length : 0;
  const currentCount = (gameState.shelfParcels || []).length + during;
  elStock.textContent = currentCount + ' / ' + gameState.warehouseCapacity;
}

function showScreen(id) {
  document.querySelectorAll('.screen-card').forEach(c => c.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  // Экран загрузки: скрываем, как только показан первый игровой экран.
  hideGameLoading();
  // Сбрасываем скролл области: на арт-экранах (склад/приёмка) он ломает совмещение с фоном
  const mn = document.querySelector('main');
  if (mn) mn.scrollTop = 0;
  // Всплывающее обучение не должно оставаться на других экранах
  const tov = document.getElementById('tutorial-overlay');
  if (tov && id !== 'screen-morning') tov.classList.remove('show');
  // Полноэкранные арт-фоны: приёмка и выдача заказов
  document.body.classList.toggle('phase-scene', id === 'screen-scene' || id === 'screen-result' || id === 'screen-dayend' || id === 'screen-shop');
  document.body.classList.toggle('phase-acceptance', id === 'screen-morning');
  document.body.classList.toggle('phase-warehouse', id === 'screen-warehouse');
  updateHUD();
}

function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}

// === СОСТОЯНИЕ ПРИЁМКИ ===
let acceptance = null;

// === ГЕНЕРАЦИЯ РАУНДА ===
// Шаблон разметки приёмки: finishAcceptance() заменяет содержимое стадии итогами,
// поэтому перед новым раундом (со 2-го дня) разметку нужно восстановить
let _acceptanceStageTemplate = null;

function ensureAcceptanceStage() {
  const stage = document.getElementById('acceptance-stage');
  if (!stage) return null;
  if (_acceptanceStageTemplate === null) {
    _acceptanceStageTemplate = stage.innerHTML; // первый запуск — разметка ещё нетронута
  } else if (!document.getElementById('invoice-list')) {
    stage.innerHTML = _acceptanceStageTemplate; // итоги прошлого дня затёрли разметку — восстанавливаем
  }
  return stage;
}

// Компактный мини-штрихкод для бирки накладной (~22×13px): узор из номера посылки,
// полосы переменной ширины + короткие ограничители по краям.
function invoiceBarcode(code, scale) {
  scale = scale || 1; // 1 — бирка накладной; 6 — крупно в сканере
  let seed = 0;
  const s = String(code);
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) / 65536; };
  let x = 1; // тихая зона слева
  let rects = '';
  const bar = (k, h) => { rects += '<rect x="' + x.toFixed(1) + '" y="0" width="' + k + '" height="' + h + '"/>'; x += k; };
  const gap = (k) => { x += k; };
  const digit = () => { // «цифра» = 2 полосы + 2 промежутка
    bar(rnd() < 0.55 ? 1 : 2, 10);
    gap(rnd() < 0.6 ? 1 : 1.5);
    bar(rnd() < 0.55 ? 1 : 2, 10);
    gap(1);
  };
  const guard = () => { bar(1, 13); gap(1); bar(1, 13); }; // ограничители чуть длиннее
  guard(); gap(1);
  digit(); digit(); digit();
  guard();
  const w = Math.ceil(x + 1); // тихая зона справа
  return '<svg class="chip-bc" viewBox="0 0 ' + w + ' 13" width="' + Math.round(w * scale) + '" height="' + Math.round(13 * scale) + '" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">' + rects + '</svg>';
}

function startAcceptance() {
  try { audio.ensure(); } catch (e) {}
  // M-4: если старая приёмка вдруг ещё «жива» — глушим её таймеры до пересоздания
  if (acceptance && acceptance.running) {
    if (acceptance._timer) clearInterval(acceptance._timer);
    if (acceptance._nextBoxTimeout) clearTimeout(acceptance._nextBoxTimeout);
    acceptance.running = false;
  }
  // Сброс потока сцены: сегодня посетителей по нагрузке дня, первый — номер 0
  const dayLoad = getDayLoad(gameState.day);
  gameState.visitorIndex = 0;
  gameState.activeVisitor = null;
  gameState.lastChoice = null;
  
  // Длительность приёмки: база + «Налаженная сортировка» + вчерашний кофе
  const roundDur = ROUND_DURATION + (gameState.upg ? (gameState.upg.routine || 0) * 8 : 0) + (gameState.daily && gameState.daily.coffee ? 10 : 0);
  // Сбрасываем только кофе (его эффект уже применён к roundDur), остальные расходники действуют весь день!
  if (gameState.daily) gameState.daily.coffee = false;

  // Счётчики дня: заработок и покупки (для отчёта смены)
  gameState.dayGrossIncome = 0;
  gameState.dayShopSpend = 0;
  gameState.dayCourierFee = 0;
  gameState.dayOtherCost = 0;
  ensureAcceptanceStage();
  showScreen('screen-morning'); // возвращаемся на экран приёмки

  // 1. Обработка вчерашних долгов (обещанных заказов): дедупликация и приоритет №1
  const rawDebts = (gameState.promisedDebts || []).concat(gameState.activeDebtsQueue || []);
  const seenDebtCodes = new Set();
  const todayDebts = [];
  let dupDebts = 0;
  rawDebts.forEach(d => {
    if (seenDebtCodes.has(d.orderCode)) { dupDebts++; return; }
    seenDebtCodes.add(d.orderCode);
    todayDebts.push(d);
  });
  if (dupDebts > 0) {
    // FIX E-3: два обещания на один код. Второму клиенту — компенсация сразу,
    // чтобы он не «испарялся» молча.
    gameState.money = Math.max(0, gameState.money - 25 * dupDebts);
    gameState.dayOtherCost = (gameState.dayOtherCost || 0) + 25 * dupDebts;
    gameState.rating = Math.max(1, +(gameState.rating - 0.03 * dupDebts).toFixed(2));
    showToast('💸 Двойное обещание на один заказ: компенсация −' + (25 * dupDebts) + ' ₽');
  }
  gameState.activeDebtsQueue = todayDebts.slice();
  gameState.todayDebtsCount = todayDebts.length;
  gameState.promisedDebts = []; // перенесли в активную очередь

  // Сегодня посетителей: не меньше количества долгов, чтобы все должники гарантированно пришли!
  gameState.visitorCount = Math.max(dayLoad, todayDebts.length);

  // === СКАНДАЛИСТЫ: 35% шанс что сегодня придёт скандалист (со 2 дня) ===
  gameState.todayScandal = null;
  gameState.todayBomzh = null;
  if (gameState.day > 1 && Math.random() < 0.35) {
    try {
      const scandalPool = SCANDAL_TYPES;
      const sType = scandalPool[Math.floor(Math.random() * scandalPool.length)];
      const safeVisitors = VISITORS.filter(v => v.id !== 'mama_baby');
      const sVisitor = safeVisitors[Math.floor(Math.random() * safeVisitors.length)];
      const sPos = Math.floor(Math.random() * gameState.visitorCount);
      gameState.todayScandal = { type: sType, visitor: sVisitor, pos: sPos, done: false };
      gameState.visitorCount += 1;
    } catch(e) { console.error('scandal gen fail', e); }
  }

  // === БОМЖ: редкий гость 7% с 2 дня, не добавляем если уже есть скандалист на той же позиции ===
  if (gameState.day > 1 && Math.random() < (typeof BOMZH_EVENT !== 'undefined' ? BOMZH_EVENT.chance : 0.07)) {
    try {
      // Не спавним бомжа если уже есть скандалист — чтобы не было два редких подряд (но можно и разрешить, тогда раскидываем позиции)
      let bPos = Math.floor(Math.random() * gameState.visitorCount);
      if (gameState.todayScandal && bPos === gameState.todayScandal.pos) {
        bPos = (bPos + 1) % gameState.visitorCount;
      }
      gameState.todayBomzh = { visitor: (typeof VISITOR_BOMZH !== 'undefined' ? VISITOR_BOMZH : VISITORS[0]), pos: bPos, done: false, stolen: null };
      gameState.visitorCount += 1;
    } catch(e) { console.error('bomzh gen fail', e); }
  }


  const allKnownItems = [...ALL_PARCELS, ...MALE_ITEMS, ...SENIOR_ITEMS, ...FEMALE_ITEMS];
  const debtParcels = [];
  todayDebts.forEach(d => {
    const item = allKnownItems.find(x => x.code === d.orderCode) || { code: d.orderCode, label: d.itemLabel || 'Заказ' };
    if (!debtParcels.some(p => p.code === item.code)) {
      debtParcels.push({ ...item, isDebt: true, debtVisitorName: d.visitorName, debtVisitorId: d.visitorId });
    }
  });

  // 2. Формируем список обычных посетителей: СЛУЧАЙНОЕ ПЕРЕМЕШИВАНИЕ КАЖДЫЙ ДЕНЬ!
  const regularVisitorsCount = Math.max(0, dayLoad - debtParcels.length);
  const usedCodes = new Set(debtParcels.map(p => p.code));
  const todayVisitorRoster = [];
  const regularItems = [];

  // Исключаем тех, кто уже в очереди по вчерашним долгам
  const candidateVisitors = VISITORS.filter(v => !debtParcels.some(d => d.debtVisitorId === v.id));
  const debtVisitorIds = debtParcels.map(d => d.debtVisitorId).filter(Boolean);
  const pickedVisitors = pickTodaysVisitors(candidateVisitors, regularVisitorsCount, debtVisitorIds);

  for (let i = 0; i < regularVisitorsCount; i++) {
    const v = pickedVisitors[i] || candidateVisitors[i % Math.max(1, candidateVisitors.length)] || VISITOR_MAN;
    const itemSource = visitorItemSource(v); // аудит: единый источник пула товаров
    
    // Подбираем уникальный товар под категорию посетителя
    let cand = itemSource.filter(p => !usedCodes.has(p.code));
    if (cand.length === 0) cand = ALL_PARCELS.filter(p => !usedCodes.has(p.code));
    if (cand.length === 0) cand = itemSource;
    
    const pickedItem = cand[Math.floor(Math.random() * cand.length)];
    usedCodes.add(pickedItem.code);
    regularItems.push(pickedItem);
    todayVisitorRoster.push({
      visitor: v,
      orderCode: pickedItem.code,
      itemLabel: pickedItem.label,
      itemObj: pickedItem
    });
  }
  gameState.todayVisitorRoster = todayVisitorRoster;

  if (!gameState.visitorHistory) gameState.visitorHistory = [];
  const todaySeenIds = [
    ...debtVisitorIds,
    ...todayVisitorRoster.map(r => r.visitor && r.visitor.id)
  ].filter(Boolean);
  gameState.visitorHistory = (gameState.visitorHistory || []).filter(h => h.day >= gameState.day - 8);
  gameState.visitorHistory.push({ day: gameState.day, ids: todaySeenIds });

  // Срок хранения: «ничьи» нормальные коробки со второго утра становятся излишком
  const protectedCodes = new Set([
    ...debtParcels.map(p => p.code),
    ...todayVisitorRoster.map(r => r.orderCode)
  ]);
  (gameState.shelfParcels || []).forEach(p => {
    if (p.status && p.status !== 'normal') return;
    if (p.isDebt || protectedCodes.has(p.code)) { p.daysOnShelf = 0; return; }
    p.daysOnShelf = (p.daysOnShelf || 0) + 1;
    if (p.daysOnShelf >= 2) {
      p.status = 'surplus';
      p.isDebt = false;
    }
  });

  // Долги обязательны и ВСЕГДА входят в накладную, даже если склад полон!
  // Обычные посылки формируются ровно под сегодняшних посетителей (ограничены свободным местом на складе).
  const freeSlots = warehouseFree();
  const regularCount = Math.min(regularItems.length, Math.max(0, freeSlots - debtParcels.length));
  let invoice = [...debtParcels, ...regularItems.slice(0, regularCount)];
  // Пустая накладная при свободных местах невозможна (регулярные посылки занимают все места) — страховка удалена (Б-13).

  if (debtParcels.length > 0 && freeSlots === 0) {
    showToast('⚠️ Склад полон! Обязательно примите обещанный долг (🔥)');
  }

  // Чужие: всё, что не в накладной
  const others = ALL_PARCELS.filter(p => !invoice.some(i => i.code === p.code));

  // Каждой посылке — уникальный вид тары на этот день (коробки + пакеты).
  // У коробок (первые 15 спрайтов) есть порванные версии — та же коробка, но с браком.
  const idxPool = PARCEL_SPRITES.map((_, i) => i).sort(() => Math.random() - 0.5);
  const takeSprite = () => {
    const i = idxPool.length ? idxPool.pop() : Math.floor(Math.random() * PARCEL_SPRITES.length);
    return { sprite: PARCEL_SPRITES[i], spriteTorn: (i < PARCEL_SPRITES_TORN.length) ? PARCEL_SPRITES_TORN[i] : null, spriteIdx: i };
  };

  acceptance = {
    invoice: invoice.map((p, i) => ({ ...p, uid: 'inv' + i + '-' + p.code, sorted: false, isDebt: !!p.isDebt, ...takeSprite() })),
    others: others.map(p => ({ ...p, ...takeSprite() })),
    current: null, // текущая коробка в сортировке
    acceptedList: [], // все принятые на склад посылки (и верные, и ошибочные)
    stats: { correct: 0, wrong: 0, bonus: 0, penalty: 0, timeLeft: roundDur, oursCorrect: 0 },
    // FIX E-1: дневной бюджет на «чужие»/брак. Свой лист накладной оплачивается всегда,
    // бесконечная утренняя «молотилка» коробок больше не кормит лучше, чем выдачи.
    rewardPool: 40 + 15 * invoice.length,
    paidOut: 0,
    duration: roundDur,
    running: true,
    binCounts: { ours: 0, others: 0, broken: 0 }
  };

  // Отрисовать накладную
  const list = document.getElementById('invoice-list');
  list.innerHTML = '';
  acceptance.invoice.forEach(item => {
    const chip = document.createElement('span');
    chip.className = 'invoice-chip' + (item.isDebt ? ' is-debt' : '');
    chip.id = 'chip-' + item.uid;
    const debtTag = item.isDebt ? '<span class="chip-debt-tag">🔥 ДОЛГ</span>' : '';
    chip.innerHTML = debtTag + invoiceBarcode(item.code) + '<span class="invoice-chip-code">#' + item.code + '</span>';
    list.appendChild(chip);
  });
  const elProg = document.getElementById('invoice-progress');
  if (elProg) elProg.textContent = '0 / ' + acceptance.invoice.length;
  const elC = document.getElementById('hud-correct');
  if (elC) elC.textContent = '✓ 0';
  const elW = document.getElementById('hud-wrong');
  if (elW) elW.textContent = '✗ 0';
  const elT = document.getElementById('hud-timer');
  if (elT) elT.textContent = '⏱️ ' + acceptance.duration + 'с';
  updateBinCounts();

  // Очередь коробок и таймер: в первый день — после обучения, дальше — сразу
  if (!gameState.guidesSeen.acceptance) {
    maybeShowGuide('acceptance', { autoStart: true, onClose: startRoundEngine });
  } else {
    startRoundEngine();
  }
}

function startRoundEngine() {
  if (!acceptance || !acceptance.running) return;
  YG.gameplayStart(); // разметка геймплея (п. 1.19.3)
  buildNextBox();

  // Таймер — на основе performance.now() (работает даже в фоновой вкладке)
  if (acceptance._timer) clearInterval(acceptance._timer);
  acceptance.startedAt = performance.now();
  acceptance._timer = setInterval(() => {
    if (!acceptance || !acceptance.running) return;
    if (acceptance._paused) return;
    const elapsed = (performance.now() - acceptance.startedAt) / 1000;
    const left = Math.max(0, Math.ceil(acceptance.duration - elapsed));
    acceptance.stats.timeLeft = left;
    document.getElementById('hud-timer').textContent = '⏱️ ' + left + 'с';
    if (left <= 0) finishAcceptance();
  }, 200);
}

// === ОБУЧЕНИЕ ПО ПРОЦЕССАМ ===
// Каждый игровой процесс (приёмка, выдача, склад, магазин, отчёт, курьер)
// имеет свой гайд. Он показывается автоматически один раз — при первом заходе
// в процесс — и дальше открывается по значку «?» в шапке (сверху справа).
const GUIDE_DEFS = {
  acceptance: {
    title: '📦 Приёмка: раскладываем коробки',
    sub: 'Сверяй номер на коробке с накладной сверху',
    rows: [
      { dot: 'dot-ours',   text: '<strong>Свои</strong> — номер есть в накладной → зелёная корзина' },
      { dot: 'dot-others', text: '<strong>Чужие</strong> — номера нет в накладной → красная корзина' },
      { dot: 'dot-broken', text: '<strong>Брак</strong> — мятая, порванная или без этикетки → оранжевая корзина' }
    ],
    footer: '⌨️ <b>Горячие клавиши:</b> [A / 1] Свои · [S / 2] Чужие · [D / 3] Брак. ' +
      'Свои приносят по 15 ₽; «чужие» и брак платят из ограниченного дневного бонуса. ' +
      'Утром важна точность, а не скорость: <b>забитый браком склад мешает выдаче.</b>'
  },
  issue: {
    title: '🛒 Выдача заказа',
    sub: 'Обслужи посетителя: найди его заказ и отсканируй',
    rows: [
      { icon: '🔍', text: 'Номер заказа клиента — сверху. Ищи коробку на полках склада.' },
      { icon: '🏷️', text: 'Тапни по коробке и <b>зажми штрихкод</b>, пока полоска не заполнится.' },
      { icon: '💬', text: 'С клиентом можно поговорить — поднимет рейтинг, или сразу выдать.' },
      { icon: '⚠️', text: 'Заказа нет на складе? Придётся объясняться (или взять обещание до завтра).' }
    ],
    footer: 'Выдача — главный источник дохода. За «свою» посылку платят больше, ' +
      'а рейтинг 5★ множит доход. Брак и излишки забирает курьер раз в неделю.'
  },
  shop: {
    title: '🛒 Магазин улучшений',
    sub: 'Вкладывай в склад, технику и расходники',
    rows: [
      { icon: '📚', text: '<b>Стеллажи</b> — больше мест на складе. Больше клиентов → больше денег.' },
      { icon: '🛒', text: '<b>Тележка</b> — +5 ₽ за каждую свою посылку из накладной.' },
      { icon: '🔍', text: '<b>Сканер</b> ускоряет штрихкод, <b>сортировка</b> даёт +8 с к таймеру.' },
      { icon: '☕', text: '<b>Расходники</b> — бонусы на следующий день (пакеты, кофе, конфеты).' },
      { icon: '📢', text: '<b>Реклама</b> — +2 клиента завтра, но они займут места на складе.' }
    ],
    footer: 'Покупай то, что окупается. Стеллаж и расходники — лучший старт; ' +
      'камеры и сканер — от ошибок и брака.'
  },
  dayend: {
    title: '🌙 Отчёт смены',
    sub: 'Итоги рабочего дня',
    rows: [
      { icon: '💰', text: '<b>Валовая</b> — сколько принесла смена (приёмка + выдача).' },
      { icon: '🏠', text: '<b>Расходы</b> — аренда, коммуналка, вывоз брака и ошибок.' },
      { icon: '📈', text: '<b>Чистая прибыль</b> = валовая − расходы. Баланс — на экране.' },
      { icon: '🎯', text: 'Стремись к <b>цели</b>: накопить 9 000 ₽ к 28-му дню и дальше.' }
    ],
    footer: 'В конце дня закупайся в магазине улучшений или сразу начинай новый день.'
  },
  courier: {
    title: '🚚 Курьер возвратов',
    sub: 'Раз в неделю забирает брак и излишки',
    rows: [
      { icon: '📦', text: '<b>Брак и излишки</b> «съедают» места на складе.' },
      { icon: '💸', text: 'Сдать их курьеру: <b>50 ₽/шт</b> (25 ₽ при установленных камерах).' },
      { icon: '🗑️', text: 'Отказаться — мёртвый груз останется и помешает приёмке завтра.' }
    ],
    footer: 'Вывозить мёртвый груз выгоднее сразу: чище склад → больше мест под новые заказы.'
  }
};

// Текущий открытый гайд и что было приостановлено на время показа
let _guideOnClose = null;
let _guidePause = null;

function buildGuide(id) {
  const def = GUIDE_DEFS[id];
  if (!def) return false;
  document.getElementById('tutorial-title').textContent = def.title;
  document.getElementById('tutorial-sub').textContent = def.sub;
  const rowsEl = document.getElementById('tutorial-rows');
  rowsEl.innerHTML = '';
  (def.rows || []).forEach(r => {
    const row = document.createElement('div');
    row.className = 'tut-row';
    const badge = r.dot ? ('<span class="tut-dot ' + r.dot + '"></span>') : ('<span class="tut-ico">' + r.icon + '</span>');
    row.innerHTML = badge + '<div>' + r.text + '</div>';
    rowsEl.appendChild(row);
  });
  document.getElementById('tutorial-footer').innerHTML = def.footer || '';
  return true;
}

// Пауза текущего процесса (приёмка или сцена) на время показа гайда
function captureGuidePause() {
  const p = { acc: false, scene: false };
  if (acceptance && acceptance.running && acceptance.startedAt && !acceptance._paused) {
    acceptance._paused = true;
    acceptance._pausedAt = performance.now();
    p.acc = true;
  }
  if (sceneTimer) {
    clearTimeout(sceneTimer);
    sceneTimer = null;
    p.scene = true;
  }
  return p;
}
function resumeGuidePause(p) {
  if (!p) return;
  if (p.acc && acceptance && acceptance._paused) {
    acceptance.startedAt += performance.now() - acceptance._pausedAt;
    acceptance._paused = false;
  }
  if (p.scene && typeof sceneQueue !== 'undefined' && sceneQueue && sceneIdx < sceneQueue.length) {
    sceneTimer = setTimeout(pumpScene, 900);
  }
}

// Показать гайд по id. opts.autoStart — текст кнопки «начнём»; opts.onClose — колбэк.
function showGuide(id, opts) {
  opts = opts || {};
  if (!buildGuide(id)) return;
  const btn = document.getElementById('tutorial-btn');
  btn.textContent = opts.autoStart ? 'Понятно, начнём! ▶' : 'Понятно ▶';
  _guideOnClose = opts.onClose || null;
  _guidePause = captureGuidePause();
  btn.onclick = () => closeGuide();
  const ov = document.getElementById('tutorial-overlay');
  if (ov) ov.classList.add('show');
}

function closeGuide() {
  const ov = document.getElementById('tutorial-overlay');
  if (ov) ov.classList.remove('show');
  resumeGuidePause(_guidePause);
  _guidePause = null;
  const cb = _guideOnClose;
  _guideOnClose = null;
  if (cb) cb();
}

// Гайд показывается один раз при первом заходе в процесс, дальше — только по кнопке «?»
function markGuideSeen(id) {
  if (!gameState.guidesSeen) gameState.guidesSeen = {};
  gameState.guidesSeen[id] = true;
}
function maybeShowGuide(id, opts) {
  if (gameState.guidesSeen && gameState.guidesSeen[id]) return;
  markGuideSeen(id);
  try { YG.save(); } catch (e) {} // фазу слой YG определяет сам
  showGuide(id, opts);
}

// Какой гайд открыть по значку «?» — зависит от текущего экрана
function openContextGuide() {
  const active = document.querySelector('.screen-card.active');
  const id = active ? active.id : '';
  let guide = 'acceptance';
  if (id === 'screen-morning') guide = 'acceptance';
  else if (id === 'screen-scene') guide = (gameState.courierVisitedToday ? 'courier' : 'issue');
  else if (id === 'screen-warehouse' || id === 'screen-result') guide = 'issue';
  else if (id === 'screen-dayend') guide = 'dayend';
  else if (id === 'screen-shop') guide = 'shop';
  showGuide(guide);
}

// Очередь коробок: смешиваем свои / чужие / брак
function buildNextBox() {
  if (!acceptance || !acceptance.running) return;

  // Сколько осталось несортированных своих в накладной?
  const remainingOurs = acceptance.invoice.filter(i => !i.sorted).length;
  const hasOthers = (acceptance.others || []).length > 0;
  if (!hasOthers && remainingOurs === 0) { finishAcceptance('full'); return; } // принимать больше нечего

  // Если все свои разобрали — продолжаем спамить чужими и браком
  let kind;
  const r = Math.random();
  if (r < 0.45 || !hasOthers) kind = 'ours';
  else if (r < 0.80) kind = 'others';
  else kind = 'broken';

  // Если своих осталось 0 — не спамим ими
  if (kind === 'ours' && remainingOurs === 0) {
    kind = Math.random() < 0.6 ? 'others' : 'broken';
  }

  let parcel, expected, isBroken = false;
  if (kind === 'ours') {
    // Если есть неотсортированные долги — подаем их в первую очередь
    const unsortedDebts = acceptance.invoice.filter(i => i.isDebt && !i.sorted);
    const unsorted = acceptance.invoice.filter(i => !i.sorted);
    parcel = (unsortedDebts.length > 0 && Math.random() < 0.75)
      ? unsortedDebts[Math.floor(Math.random() * unsortedDebts.length)]
      : unsorted[Math.floor(Math.random() * unsorted.length)];
    expected = 'ours';
  } else if (kind === 'others') {
    parcel = acceptance.others[Math.floor(Math.random() * acceptance.others.length)];
    expected = 'others';
  } else {
    // FIX E-9: брак приезжает ТОЛЬКО из чужих посылок (долги и свои по накладной — всегда целые).
    // Ловля брака больше не может тайно оставить клиента без заказа.
    const withTorn = acceptance.others.filter(p => p.spriteTorn);
    const source = withTorn.length ? withTorn : acceptance.others;
    parcel = source[Math.floor(Math.random() * source.length)];
    isBroken = true;
    expected = 'broken';
  }

  acceptance.current = {
    parcel,
    isBroken,
    expected, // 'ours' | 'others' | 'broken'
    sorted: false
  };

  renderCurrentBox();
}

// === ГЕОМЕТРИЯ НОМЕРА НА КОРОбКЕ ===
// Канвас для точного замера ширины текста («#1234», Arial bold)
let _numCtx = null;
try { _numCtx = document.createElement('canvas').getContext('2d'); } catch (e) { _numCtx = null; }
// Кэш «видимых» границ картона: у PNG вокруг коробки бывает прозрачная подложка,
// номер должен оставаться внутри картона, а не внутри файла
const _visualBoxCache = new Map();
function parcelVisualBox(imgEl, key) {
  if (_visualBoxCache.has(key)) return _visualBoxCache.get(key);
  let box = null;
  try {
    const natW = imgEl && imgEl.naturalWidth, natH = imgEl && imgEl.naturalHeight;
    if (natW && natH) {
      const c = document.createElement('canvas');
      c.width = natW; c.height = natH;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(imgEl, 0, 0);
      const d = ctx.getImageData(0, 0, natW, natH).data;
      let l = natW, t = natH, r = -1, b = -1;
      for (let py = 0; py < natH; py++) {
        for (let px = 0; px < natW; px++) {
          if (d[(py * natW + px) * 4 + 3] > 12) {
            if (px < l) l = px; if (px > r) r = px;
            if (py < t) t = py; if (py > b) b = py;
          }
        }
      }
      if (r >= 0) box = { l: l, t: t, r: r + 1, b: b + 1 };
    }
  } catch (e) { /* нет canvas — ниже используем весь кадр */ }
  if (!box) box = null; // размеры картинки неизвестны — вызывающий возьмёт весь кадр
  _visualBoxCache.set(key, box);
  return box;
}
function numTextWidth(fs, text) {
  if (_numCtx) {
    _numCtx.font = '800 ' + fs + 'px Arial, "Helvetica Neue", sans-serif';
    return _numCtx.measureText(text).width + text.length * 0.5; // + letter-spacing
  }
  return text.length * (fs * 0.56 + 0.5); // fallback-оценка ширины
}

function renderCurrentBox() {
  const zone = document.getElementById('sort-zone');
  const cur = acceptance.current;
  const p = cur.parcel;

  // Брак — этикетки нет вовсе: номер не печатаем, только значок «без этикетки»
  const useTorn = cur.isBroken && p.spriteTorn;
  const boxSrc = useTorn ? p.spriteTorn : p.sprite;
  const meta = PARCEL_LABEL_META[p.spriteIdx] || { x: 50, y: 40, rot: 0, ink: '#2b241d', w: 200, h: 200 };
  const numHtml = cur.isBroken ? '' :
    '<div class="sort-box-num" style="top: ' + meta.y + '%; left: ' + meta.x + '%; color: ' + meta.ink + '; transform: translate(-50%, -50%) rotate(' + meta.rot + 'deg);">#' + p.code + '</div>';
  const brokenBadge = cur.isBroken ? '<div class="sort-box-badge nolabel" title="Без этикетки">!</div>' : '';
  const debtBadgeOnBox = (p.isDebt && !cur.isBroken) ? '<div class="sort-box-badge is-debt-badge" title="Обещано клиенту вчера!">🔥 ДОЛГ</div>' : '';

  zone.innerHTML = `
    <div class="sort-box${cur.isBroken ? ' is-broken' : ''}${useTorn ? ' has-torn' : ''}" id="sort-box">
      <img class="sort-box-img" src="${boxSrc}" alt="${p.label}">
      ${numHtml}
      <div class="sort-box-badges">
        ${brokenBadge}
        ${debtBadgeOnBox}
      </div>
    </div>
  `;

  // Размер «печати» пропорционален коробке (как напечатанный на ней номер).
  // Номер должен ЛЕЖАТЬ внутри картона: считаем фактический размер отображения
  // картинки и видимые границы PNG, прижимаем позицию и уменьшаем шрифт,
  // если номер физически не помещается.
  const numEl = zone.querySelector('.sort-box-num');
  if (numEl) {
    const imgEl = zone.querySelector('.sort-box-img');
    const natW = (imgEl && imgEl.naturalWidth) || 0;
    const natH = (imgEl && imgEl.naturalHeight) || 0;
    let dispW = (imgEl && imgEl.offsetWidth) || 0;
    let dispH = (imgEl && imgEl.offsetHeight) || 0;
    if (!dispW || !dispH) {
      // тестовые окружения без layout: по CSS максимум 235×215 с сохранением пропорций
      const fw = natW || meta.w, fh = natH || meta.h;
      const s0 = Math.min(235 / fw, 215 / fh);
      dispW = fw * s0; dispH = fh * s0;
    }
    const imgScale = natW ? dispW / natW : dispW / (meta.w || 1);
    const vb = parcelVisualBox(imgEl, p.spriteIdx + (cur.isBroken ? '_t' : ''));
    const vl = vb ? vb.l * imgScale : 0, vt = vb ? vb.t * imgScale : 0;
    const vr = vb ? vb.r * imgScale : dispW, vbot = vb ? vb.b * imgScale : dispH;
    const labelW = meta.w * imgScale, labelH = meta.h * imgScale;
    const text = '#' + p.code;
    // базовый размер — как раньше
    const scale = Math.min(215 / meta.h, 235 / meta.w, 1);
    let fs = Math.max(13, Math.min(30, Math.min(meta.h * scale * 0.16, meta.w * scale / 3.6)));
    // сжимаем, пока номер не влезает в область этикетки/картона
    const maxW = Math.min(labelW, vr - vl, dispW) * 0.94;
    const maxH = Math.min(labelH, vbot - vt, dispH) * 0.92;
    while (fs > 11 && (numTextWidth(fs, text) > maxW || fs * 1.25 > maxH)) fs--;
    numEl.style.fontSize = Math.round(fs) + 'px';
    // позиция: центр этикетки, но зажатый так, чтобы текст не выходил за картон
    const tw = numTextWidth(fs, text), th = fs * 1.25;
    const loX = Math.max(vl + tw / 2 + 2, vl + 2), hiX = Math.max(vr - tw / 2 - 2, vl + 2);
    const loY = Math.max(vt + th / 2 + 2, vt + 2), hiY = Math.max(vbot - th / 2 - 2, vt + 2);
    const cx = Math.min(Math.max(meta.x / 100 * dispW, loX), hiX);
    const cy = Math.min(Math.max(meta.y / 100 * dispH, loY), hiY);
    numEl.style.left = cx + 'px';
    numEl.style.top = cy + 'px';
  }

  // Каждая коробка приезжает под своим случайным углом/смещением — живее выглядит
  const boxEl = document.getElementById('sort-box');
  if (boxEl) {
    boxEl.style.setProperty('--in-x', Math.round(Math.random() * 140 - 70) + 'px');
  }

  // Биндим клики по корзинам
  document.getElementById('bin-ours').onclick = () => onSort('ours');
  document.getElementById('bin-others').onclick = () => onSort('others');
  document.getElementById('bin-broken').onclick = () => onSort('broken');
}

function updateBinCounts() {
  const elOurs = document.getElementById('bin-ours-count');
  if (elOurs) elOurs.textContent = acceptance.binCounts.ours + ' шт';
  const elOthers = document.getElementById('bin-others-count');
  if (elOthers) elOthers.textContent = acceptance.binCounts.others + ' шт';
  const elBroken = document.getElementById('bin-broken-count');
  if (elBroken) elBroken.textContent = acceptance.binCounts.broken + ' шт';
}

// Горячие клавиши для приёмки коробок (A/S/D, 1/2/3, Стрелки)
window.addEventListener('keydown', (e) => {
  const screenMorning = document.getElementById('screen-morning');
  if (!screenMorning || !screenMorning.classList.contains('active')) return;
  if (!acceptance || !acceptance.running || !acceptance.current || acceptance.current.sorted) return;

  const key = e.key.toLowerCase();
  const code = e.code;

  if (key === 'a' || key === '1' || code === 'KeyA' || code === 'Digit1' || code === 'Numpad1' || code === 'ArrowLeft') {
    e.preventDefault();
    const btn = document.getElementById('bin-ours');
    if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
    onSort('ours');
  } else if (key === 's' || key === '2' || code === 'KeyS' || code === 'Digit2' || code === 'Numpad2' || code === 'ArrowDown') {
    e.preventDefault();
    const btn = document.getElementById('bin-others');
    if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
    onSort('others');
  } else if (key === 'd' || key === '3' || code === 'KeyD' || code === 'Digit3' || code === 'Numpad3' || code === 'ArrowRight') {
    e.preventDefault();
    const btn = document.getElementById('bin-broken');
    if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
    onSort('broken');
  }
});

function displaceDeadloadForDebt() {
  const al = (acceptance && acceptance.acceptedList) || [];
  let i = al.findIndex(p => p.status === 'surplus' || p.status === 'broken');
  if (i !== -1) { al.splice(i, 1); return true; }
  const sp = gameState.shelfParcels || [];
  i = sp.findIndex(p => p.status === 'surplus' || p.status === 'broken');
  if (i !== -1) { sp.splice(i, 1); updateHUD(); return true; }
  return false;
}

function onSort(bin) {
  if (!acceptance || !acceptance.running) return;
  if (!acceptance.current || acceptance.current.sorted) return;

  const currentOccupiedBefore = (gameState.shelfParcels || []).length + (acceptance.acceptedList ? acceptance.acceptedList.length : 0);
  if (bin === 'ours' && currentOccupiedBefore >= gameState.warehouseCapacity) {
    const isDebtBox = !!(acceptance.current.parcel && acceptance.current.parcel.isDebt);
    if (isDebtBox && displaceDeadloadForDebt()) {
      showToast('🔥 Долг вытеснил мёртвый груз — принимаем обещанный заказ');
    } else {
      showToast(isDebtBox
        ? '⚠️ Склад забит живыми заказами — долг пока некуда поставить'
        : '⚠️ Склад заполнен! Эту коробку принять нельзя — отсортируйте как чужую или завершите приёмку.');
      try { audio.bad(); } catch (e) {}
      return; // не завершаем всю приёмку и не сжигаем коробку
    }
  }

  const cur = acceptance.current;
  const correct = (bin === cur.expected);

  // Звук и анимация
  const box = document.getElementById('sort-box');
  if (correct) {
    box.classList.add('flash-good');
    audio.good();
    acceptance.stats.correct++;
    acceptance.binCounts[bin]++;

    let reward;
    if (cur.expected === 'ours') {
      reward = CORRECT_REWARD; // позиции накладной оплачиваются всегда
      acceptance.stats.oursCorrect = (acceptance.stats.oursCorrect || 0) + 1;
    } else {
      // FIX E-1: «чужие» и «брак» платят из ограниченного дневного пула
      const left = Math.max(0, (acceptance.rewardPool || 0) - (acceptance.paidOut || 0));
      reward = Math.min(cur.expected === 'broken' ? BROKEN_BONUS : CORRECT_REWARD, left);
      if (reward > 0) acceptance.paidOut = (acceptance.paidOut || 0) + reward;
      else if (!acceptance._poolNoticed) {
        acceptance._poolNoticed = true;
        showToast('💰 Дневной бонус приёмки исчерпан: сортировка дальше бесплатна');
      }
    }
    acceptance.stats.bonus += reward;

    // Помечаем свою коробку как отсортированную в накладной
    if (cur.expected === 'ours') {
      // cur.parcel — это и есть объект из накладной (та же ссылка), дубли кода больше не мешают
      const invItem = cur.parcel;
      if (invItem && !invItem.sorted) {
        invItem.sorted = true;
        const chip = invItem.uid ? document.getElementById('chip-' + invItem.uid) : null;
        if (chip) chip.classList.add('sorted');
        const sc = acceptance.invoice.filter(i => i.sorted).length;
        document.getElementById('invoice-progress').textContent = sc + ' / ' + acceptance.invoice.length;
      }
      acceptance.acceptedList.push({
        code: cur.parcel.code,
        sprite: cur.parcel.sprite,
        spriteIdx: cur.parcel.spriteIdx,
        spriteTorn: cur.parcel.spriteTorn || null,
        status: 'normal',
        isDebt: !!cur.parcel.isDebt,
        isBroken: false,
        daysOnShelf: 0
      });
    }
  } else {
    box.classList.add('flash-bad');
    audio.bad();
    acceptance.stats.wrong++;
    // «Бережное обращение»: сегодня без штрафов за промахи
    if (!gameState.daily.gloves) acceptance.stats.penalty += WRONG_PENALTY;

    // Ошибочно нажали «Свои» на чужой товар или брак:
    // он ТОЖЕ принимается на склад мёртвым грузом («излишек» или «брак»)!
    if (bin === 'ours') {
      acceptance.binCounts.ours++;
      if (cur.expected === 'broken') {
        acceptance.acceptedList.push({
          code: cur.parcel.code,
          sprite: cur.parcel.spriteTorn || cur.parcel.sprite,
          spriteIdx: cur.parcel.spriteIdx,
          status: 'broken',
          isBroken: true
        });
      } else { // cur.expected === 'others'
        acceptance.acceptedList.push({
          code: cur.parcel.code,
          sprite: cur.parcel.sprite,
          spriteIdx: cur.parcel.spriteIdx,
          status: 'surplus',
          isBroken: false
        });
      }
    }
  }

  // «Улетание»: коробка едет в ту корзину, куда кликнул игрок
  const binEl = document.getElementById(bin === 'ours' ? 'bin-ours' : (bin === 'broken' ? 'bin-broken' : 'bin-others'));
  if (binEl && box) {
    const bb = box.getBoundingClientRect();
    const br = binEl.getBoundingClientRect();
    box.style.setProperty('--fx', Math.round(br.left + br.width / 2 - (bb.left + bb.width / 2)) + 'px');
    box.style.setProperty('--fy', Math.round(br.top + br.height / 2 - (bb.top + bb.height / 2)) + 'px');
    box.style.setProperty('--fly-rot', Math.round((Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 14)) + 'deg');
    box.classList.add('fly-out');
  }

  cur.sorted = true;

  // Обновляем HUD (E-6: счётчик склада двигается и во время приёмки)
  try { updateStockHud(); } catch (e) {}
  const elSortC = document.getElementById('hud-correct');
  if (elSortC) elSortC.textContent = '✓ ' + acceptance.stats.correct;
  const elSortW = document.getElementById('hud-wrong');
  if (elSortW) elSortW.textContent = '✗ ' + acceptance.stats.wrong;
  updateBinCounts();

  // Проверяем заполненность склада (учитываем ВСЕ принятые посылки на склад)
  const currentOccupied = (gameState.shelfParcels || []).length + (acceptance.acceptedList ? acceptance.acceptedList.length : 0);
  const allOursSorted = acceptance.invoice.every(i => i.sorted);
  const isWarehouseFull = currentOccupied >= gameState.warehouseCapacity;

  if (acceptance._nextBoxTimeout) clearTimeout(acceptance._nextBoxTimeout);
  if (allOursSorted && isWarehouseFull) {
    showToast('📦 Накладная собрана, склад полон. Можно завершить приёмку.');
  }
  acceptance._nextBoxTimeout = setTimeout(() => {
    if (!acceptance || !acceptance.running) return;
    buildNextBox();
  }, 480);
}

function endAcceptanceNow() {
  if (!acceptance || !acceptance.running) return;
  audio.tap();
  showToast('⏹ Приёмка завершена');
  finishAcceptance();
}

function finishAcceptance(reason) {
  if (!acceptance) {
return; }
  if (!acceptance.running) {
return; }
  acceptance.running = false;
  if (acceptance._timer) { clearInterval(acceptance._timer); acceptance._timer = null; }
  if (acceptance._nextBoxTimeout) { clearTimeout(acceptance._nextBoxTimeout); acceptance._nextBoxTimeout = null; }
  // Снимаем бинды корзин
  document.getElementById('bin-ours').onclick = null;
  document.getElementById('bin-others').onclick = null;
  document.getElementById('bin-broken').onclick = null;

  const s = acceptance.stats;
  // FIX E-2: тележка доплачивает только за «свои» из накладной — фарм через апгрейд выключен
  const trolleyBonusPerBox = (gameState.upg && gameState.upg.trolley) ? gameState.upg.trolley * 5 : 0;
  const trolleyTotal = (s.oursCorrect || 0) * trolleyBonusPerBox;
  const net = s.bonus - s.penalty + trolleyTotal;
  gameState.dayGrossIncome = (gameState.dayGrossIncome || 0) + net; // E-5: отрицательный итог тоже в отчёте
  gameState.money = Math.max(0, gameState.money + net);
  // На склад едут все принятые коробки: долги гарантированно попадают на склад,
  // остальные коробки — насколько хватает свободных мест на полках.
  const incoming = acceptance.acceptedList || [];
  const debtsArrived = incoming.filter(p => p.isDebt);
  const otherArrived = incoming.filter(p => !p.isDebt);
  let stock = (gameState.shelfParcels || []).slice();
  const cap = gameState.warehouseCapacity;
  const dropDead = () => {
    const i = stock.findIndex(p => p.status === 'surplus' || p.status === 'broken');
    if (i !== -1) { stock.splice(i, 1); return true; }
    return false;
  };
  debtsArrived.forEach(d => {
    if (stock.length >= cap && !dropDead()) {
      // FIX: раньше долг терялся молча. Клиент придёт — сцена «коробки нет» отработает честно.
      showToast('⚠️ Обещанный заказ #' + d.code + ' не поместился на склад');
      return;
    }
    if (stock.length < cap) stock.push(d);
  });
  const arrived = [];
  let droppedCount = 0;
  otherArrived.forEach(p => {
    if (stock.length >= cap) { droppedCount++; return; }
    stock.push(p);
    arrived.push(p);
  });
  if (droppedCount > 0) showToast('📦 ' + droppedCount + ' кор. не влезли на полки — уехало обратно'); // E-4 честно
  const placedDebts = stock.filter(p => p.isDebt && debtsArrived.includes(p));
  arrived.unshift(...placedDebts);
  gameState.shelfParcels = stock;
  updateHUD();

  const stage = document.getElementById('acceptance-stage');
  const totalInv = acceptance.invoice.length;
  const sortedInv = acceptance.invoice.filter(i => i.sorted).length;
  const sortedTotal = s.correct + s.wrong;
  const surplusCount = arrived.filter(p => p.status === 'surplus').length;
  const brokenCount = arrived.filter(p => p.status === 'broken').length;
  const deadloadTotal = surplusCount + brokenCount;

  let deadloadRow = '';
  if (deadloadTotal > 0) {
    let parts = [];
    if (surplusCount > 0) parts.push(surplusCount + ' излишек');
    if (brokenCount > 0) parts.push(brokenCount + ' брак');
    deadloadRow = '<div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed var(--card-border);"><span style="color: var(--danger); font-weight: 600;">⚠️ Мёртвый груз на склад</span><strong style="color: var(--danger);">' + parts.join(', ') + '</strong></div>';
  }

  const isWarehouseFull = (gameState.shelfParcels || []).length >= gameState.warehouseCapacity;
  const titleText = (reason === 'full' || isWarehouseFull)
    ? '📦 Склад заполнен!'
    : '📋 Приёмка завершена!';

  stage.innerHTML = '<div class="acc-finish-wrapper">' +
    '<div class="acc-finish-card">' +
      '<div class="result-badge-pill">📦 ' + titleText + '</div>' +
      '<h3 style="margin: 6px 0 2px 0;">Утренняя смена готова</h3>' +
      '<div class="subtitle" style="margin-bottom: 8px;">Накладная: <strong>' + sortedInv + ' / ' + totalInv + '</strong> · Сортировано: <strong>' + sortedTotal + '</strong></div>' +
      '<div class="result-stats-row">' +
        '<div class="result-stat-box money"><span class="stat-label">Заработано</span><strong class="stat-val pos">' + (net >= 0 ? '+' : '') + net + ' ₽</strong></div>' +
        '<div class="result-stat-box info"><span class="stat-label">На складе</span><strong class="stat-val">' + arrived.length + ' шт</strong></div>' +
      '</div>' +
      (deadloadRow ? '<div style="margin: 8px 0 0 0;">' + deadloadRow + '</div>' : '') +
    '</div>' +
    '<button class="action-btn" id="btn-summary-continue" onclick="openDoorsAndStartFirstCustomer()" style="width: 100%; margin-top: auto; padding: 15px 20px; font-size: 15.5px; font-weight: 800; box-shadow: 0 6px 20px rgba(245, 165, 36, 0.45);">' +
      '🚪 Открыть двери ПВЗ (К клиентам)' +
    '</button>' +
  '</div>';

  if (net > 0) { try { audio.coin(); } catch(e) {} }

  // Сейв: приёмка завершена, дальше визиты (п. 1.9)
  YG.save({ phase: 'customers' });
}

let _doorLock = false;
function openDoorsAndStartFirstCustomer() {
  if (_doorLock) return;
  _doorLock = true;
  setTimeout(() => { _doorLock = false; }, 800);

  // Гарантируем, что acceptance корректно остановлен
  if (acceptance) {
    if (acceptance._countdownInterval) { clearInterval(acceptance._countdownInterval); acceptance._countdownInterval = null; }
    if (acceptance._autoContinueTimeout) { clearTimeout(acceptance._autoContinueTimeout); acceptance._autoContinueTimeout = null; }
    if (acceptance._timer) { clearInterval(acceptance._timer); acceptance._timer = null; }
    if (acceptance._nextBoxTimeout) { clearTimeout(acceptance._nextBoxTimeout); acceptance._nextBoxTimeout = null; }
    acceptance.running = false;
  }

  try { audio.tap(); } catch(e) {}
  showToast('🚪 Двери открыты!');
  gameState.visitorIndex = 0;
  startScene();
}

// === СЦЕНА ПОСЕТИТЕЛЯ ===
// Линейные персонажи. Каждый визит: вступление (несколько вариантов) + приветствие
// + три действия: «молча выдать», «поддержать диалог», «не выдать без объяснения».
// ТЕКСТ ИДЁТ ПОРЦИЯМИ: абзацы появляются по очереди (таймер 2.4с), тап по окну
// текста — следующий абзац сразу. Когда текст закончился — появляются плашки/кнопка.
// Реплики размечены бейджами: «ИМЯ» — посетитель, «Вы» — сотрудник.
// Мужские персонажи заказывают только мужские товары (MALE_ITEMS).

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function isMaleVisitor(v) { return !!(v && v.male); }
function said(v, m, f) { return isMaleVisitor(v) ? m : f; }
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}
function visitorIdsSeenRecently(daysBack) {
  const hist = gameState.visitorHistory || [];
  const cutoff = gameState.day - daysBack;
  const ids = new Set();
  hist.forEach(h => {
    if (h.day >= cutoff && h.day < gameState.day) (h.ids || []).forEach(id => ids.add(id));
  });
  return ids;
}
function pickTodaysVisitors(candidates, count, alreadyIds) {
  const used = new Set(alreadyIds || []);
  const take = (pool, dest) => {
    shuffleInPlace(pool);
    pool.forEach(v => {
      if (dest.length >= count) return;
      if (used.has(v.id)) return;
      dest.push(v);
      used.add(v.id);
    });
  };
  const result = [];
  take(candidates.filter(v => !visitorIdsSeenRecently(2).has(v.id) && !used.has(v.id)), result);
  if (result.length < count) take(candidates.filter(v => !visitorIdsSeenRecently(1).has(v.id) && !used.has(v.id)), result);
  if (result.length < count) take(candidates.filter(v => !used.has(v.id)), result);
  if (result.length < count && candidates.length) {
    const cyc = shuffleInPlace(candidates.slice());
    let k = 0;
    while (result.length < count && k < cyc.length * 3) {
      result.push(cyc[k % cyc.length]);
      k++;
    }
  }
  return result;
}


// === МУЖСКИЕ ТОВАРЫ: код + название + реплики клиента про заказ ===

// === ЖЕНСКИЕ ТОВАРЫ ===
const FEMALE_ITEMS = [
  {
    code: "7101",
    label: "Крем",
    replies: [
      "Крем для лица, увлажняющий. На зиму самое то, а то кожа сохнет от отопления.",
      "Увлажняющий крем. Подруга посоветовала, говорит, творит чудеса.",
      "Крем для ухода. Заказала по скидке, в магазине вдвое дороже."
    ]
  },
  {
    code: "7102",
    label: "Книга",
    replies: [
      "Книга по психологии. Буду разбираться, почему все вокруг такие сложные.",
      "Роман современный. Вечером перед сном почитать, отвлечься от отчетов.",
      "Книга. Давно хотела в бумажном переплёте, с экрана читать уже глаза устают."
    ]
  },
  {
    code: "7103",
    label: "Сковорода",
    replies: [
      "Сковорода с антипригарным покрытием. Блинчики печь — идеально.",
      "Сковорода новая. Старая уже всё, пригорает чуть что.",
      "Сковорода гранитная. Для завтраков самое то."
    ]
  },
  {
    code: "7104",
    label: "Очки",
    replies: [
      "Очки для компьютера. Глаза к вечеру жжёт от монитора жуть как.",
      "Имиджевые очки. На работу надевать, для солидности.",
      "Очки солнечные, к лету готовлюсь заранее."
    ]
  },
  {
    code: "7105",
    label: "Лампа",
    replies: [
      "Настольная лампа. Документы дома доделывать, света вечно не хватает.",
      "Лампа с мягким светом. Для чтения в самый раз.",
      "Светильник кольцевой. Для видеозвонков по работе."
    ]
  },
  {
    code: "7106",
    label: "Кофе",
    replies: [
      "Кофе зерновой. Утром без него проснуться физически невозможно.",
      "Кофе ароматный. На работу в баночке буду носить.",
      "Кофе. Запасы подошли к концу, а тут как раз доставка."
    ]
  }
];


// === ТОВАРЫ ДЛЯ СТАРШЕГО ПОКОЛЕНИЯ (БАБУШКИ И ДЕДУШКИ) ===
const SENIOR_ITEMS = [
  {
    code: "7201",
    label: "Тонометр",
    replies: [
      "Тонометр автоматический. Давление нынче у всех скачет, за здоровьем следить надо.",
      "Аппарат для давления. Внук помог заказать, говорит, старый уже барахлит.",
      "Тонометр. В аптеке в три раза дороже, а тут пенсия целее."
    ]
  },
  {
    code: "7202",
    label: "Игрушка / Пряжа",
    replies: [
      "Пряжа шерстяная, моток. Носки внукам на зиму — холода уже скоро.",
      "Нитки для вязания, разных цветов — на шарфик для внуков.",
      "Пряжа ангорская. Очень мягкая — внучке на кофточку в самый раз."
    ]
  },
  {
    code: "7203",
    label: "Чайник электрический",
    replies: [
      "Чайник электрический. Старый со свистком потёк — современный пора брать.",
      "Чайник со стеклянной колбой. Чтобы видно было, когда закипает.",
      "Электрочайник. С внуками чаи гонять вечерами — самое то."
    ]
  },
  {
    code: "7204",
    label: "Крем целебный",
    replies: [
      "Мазь суставная, с пчелиным ядом. Колени на погоду крутит — спасения нет.",
      "Крем для ног, от усталости. Побегаешь по магазинам — к вечеру гудят.",
      "Бальзам целебный. Соседу помог — теперь очередь за мной."
    ]
  },
  {
    code: "7205",
    label: "Лампа лупа",
    replies: [
      "Лампа настольная с лупой. Мелкий шрифт в газетах и кроссвордах разглядывать.",
      "Светильник с увеличением. Для мелкой работы вечерами незаменимая вещь.",
      "Лампа для чтения. Глаза уже не те, а вечером и газету, и книгу осилить хочется."
    ]
  },
  {
    code: "7206",
    label: "Книга рецептов",
    replies: [
      "Книга о вкусной и здоровой пище. Буду пироги по новым рецептам печь.",
      "Сборник заготовок на зиму. Огурчики, помидорчики — всё по проверенным рецептам.",
      "Кулинарная книга в твёрдом переплёте. На пенсии как раз время новые рецепты опробовать."
    ]
  }
];

const MALE_ITEMS = [
  {
    code: "6101",
    label: "Набор отвёрток",
    replies: [
      "Да отвёртки, набор. Полка в кладовке отпадает — надо подлатать.",
      "Отвёртки. Крестовые, плоские, с битами. У нас всё в доме на честном слове держится.",
      "Набор отвёрток взял. Жена говорит: сходи купи, а то мебель разобрал и собрать не могу."
    ]
  },
  {
    code: "6102",
    label: "Шуруповёрт",
    replies: [
      "Шуруповёрт. Полку на кухню обещал повесить. Третью неделю обещаю — теперь придётся.",
      "Дрель-шуруповёрт, аккумуляторная. Старую заклинило намертво, а ремонт не ждёт.",
      "Шуруповёрт заказал. Дом старый, всё скрипит — надо прикручивать, пока не развалилось."
    ]
  },
  {
    code: "6103",
    label: "Набор гаечных ключей",
    replies: [
      "Ключи гаечные, набор. Половина уже по гаражу в неизвестном направлении разошлась.",
      "Ключи рожковые. Машина старая — сама себя чинить просится.",
      "Ключи. Вечно нужны, а найти дома невозможно. Пусть теперь набор лежит, все сразу."
    ]
  },
  {
    code: "6104",
    label: "Мангал складной",
    replies: [
      "Мангал, складной. Дача, шашлыки — без комментариев.",
      "Гриль взял. Сосед уже все уши прожужжал своим — надо свой заводить.",
      "Мангал. Тёща приезжает в выходные — пусть всё по-взрослому будет."
    ]
  },
  {
    code: "6105",
    label: "Спиннинг с катушкой",
    replies: [
      "Спиннинг, катушка. В субботу на реку, погода обещает — надо успеть.",
      "Снасти. Рыбалка — это святое, тут уж не до экономии.",
      "Удочку взял. Хочу от всех отдохнуть, хоть на берегу."
    ]
  },
  {
    code: "6106",
    label: "Моторное масло",
    replies: [
      "Масло моторное, да фильтры. ТО сам делаю — так дешевле и надёжнее.",
      "Масло. Ласточка моя уже постукивает — надо ухаживать.",
      "Фильтры и масло. Гараж без этого — как баня без веника."
    ]
  },
  {
    code: "6107",
    label: "Термос",
    replies: [
      "Термос. На работе кофе по триста рублей — доигрался, буду свой возить.",
      "Термокружка. Чай должен быть горячим, а не просто мокрым.",
      "Термос взял. На рыбалку, или на работу. Скорее на работу."
    ]
  },
  {
    code: "6108",
    label: "Гантели разборные",
    replies: [
      "Гантели. Врач сказал: двигаться надо. Ну, двигаюсь. Пока покупаю.",
      "Гантели разборные. В гараже повешу, пусть висят. Зато есть.",
      "Эспандер взял. Суставы, дорогой, не камень — беречь надо."
    ]
  },
  {
    code: "6109",
    label: "Кроссовки",
    replies: [
      "Кроссовки, удобные. Ходить надо больше, а то засиделся совсем.",
      "Кроссовки. Спина сказала спасибо — я ей кроссовки купил.",
      "Кроссовки взял. Руки работать любят, а ноги пусть тоже не подводят."
    ]
  },
  {
    code: "6110",
    label: "Набор бит и свёрл",
    replies: [
      "Биты да свёрла, набор. Для шуруповёрта своего. Всё равно все куда-то деваются.",
      "Свёрла по металлу. Дверь скрипучую прикрутить, ворота подлатать.",
      "Набор бит. Полжизни ищу нужную — пусть теперь все в одном месте."
    ]
  }
];

// === ПЕРСОНАЖ: ОБЫЧНЫЙ МУЖЧИНА ===
const VISITOR_COURIER_IMG = "assets/visitor-courier.webp";
const VISITOR_MAN_IMG = 'assets/visitor-man.webp';

const VISITOR_MAN = {
  id: 'man', name: 'Николай', male: true, img: VISITOR_MAN_IMG,
  intros: [
    'Дверь открылась, и в пункт вошёл мужчина в синей рубашке с закатанными рукавами. Огляделся по-хозяйски, кивнул мне и достал из кармана телефон.',
    'В дверях показался знакомый силуэт — синяя рубашка, очки, усталый вид. Мужчина переступил порог, снял телефон с блокировки и посмотрел на меня поверх очков.',
    'Мужчина в синей рубашке вошёл быстро, по-деловому, придерживая рукой дверь. Пока он шёл к стойке, я успел заметить, что весь день у него явно прошёл в беготне.',
    'Колокольчик над дверью звякнул. Вошёл мужчина в очках и синей рубашке, стряхнул с рукава пылинку и встал у стойки, уже открывая телефон.'
  ],
  greeting: 'Здравствуйте. Заказ на меня, должен был уже прийти.',
  questions: [
    'Что заказали?',
    'Что-нибудь полезное?',
    'Что за покупка?',
    'Чем порадует посылка?',
    'Расскажете, что за заказ?'
  ],
  chatter: [
    'Хорошо, что пункт у дома — я через дорогу живу.',
    'А сами-то как? Смена длинная, поди?',
    'Доставили быстро. Приятно, когда без сюрпризов.',
    'Цены, конечно… Ладно, зато качество.',
    'Что-то вы притомились, гляжу. Работа такая.'
  ],
  // Возражения клиента: «как это — без причины?!»
  objections: [
    'В смысле „нет“? Как это — нет?! Я оплатил, заказ мой. Что значит „нет“?',
    'Погодите. То есть вы просто отказываете? Без причины? Так не бывает, это вы обязаны объяснить.',
    'Я двадцать минут назад оплатил. Приезжаю, а мне: „нет“? Вы вообще в своём уме?',
    '„Нет“ — это не ответ. Мне посылка нужна. Вы что, так просто отказываете людям?'
  ],
  // Отказ БЕЗ объяснений: коротко и холодно, причин не даём
  refuseLines: [
    'Нет. Не выдам.',
    'Просто нет.',
    'Отказываю. Причин не будет.',
    'Нет — и всё. Не просите объяснить.'
  ],
  silentNotes: [
    'Вы молча кивнули и пошли за заказом. Мужчина, похоже, только этого и ждал.',
    'Молчание — золото. Мужчина занялся телефоном, вы — делом.',
    'Без лишних слов. Он смотрел в телефон, вы искали коробку. Идеальная смена.'
  ],
  // Мысли сотрудника: и сам не знает, почему отказывает — просто не хочет
  thoughts: [
    'Я мог бы придумать причину — брак, сверка, ошибка в базе. Но не стал. Я просто не хотел его отпускать с этой коробкой. Или не хотел, чтобы он её получил. Не знаю, что из этого честнее.',
    '«Почему?» — спросит он. И будет прав. Причины нет. Просто что-то в этом заказе не давало мне покоя, а объяснить это словами я не мог.',
    'Иногда отказываешь не потому, что есть причина. Просто чувствуешь: не надо. А он сейчас будет полчаса доказывать, что я обязан. Обязан — что? Работать? Я и работаю.',
    'Самое смешное — я и сам не знал, почему отказываю. Но раз уж сказал «нет», придётся доводить. Гордость — штука упрямая.'
  ],
  talkThoughts: [
    'Он злится, но по делу. С таким проще: сказал прямо — получил прямо.',
    'Человек оплатил и приехал. Всё, что от меня требуется, — не тянуть время.',
    'Пока он говорит, я уже прикидываю, на какой полке искать его код.'
  ],
  refuseThoughts: [
    'Иногда отказываешь не потому, что есть причина. Просто чувствуешь: не надо. А он сейчас будет полчаса доказывать, что я обязан. Обязан — что? Работать? Я и работаю.',
    'Самое смешное — я и сам не знал, почему отказываю. Но раз уж сказал «нет», придётся доводить. Гордость — штука упрямая.',
    'Он оплатил и приехал, а я сказал «нет». Объяснить это себе я так и не смог.'
  ],
  // Концовка «стоять на своём»: реакция + мысль
  // Концовка «стоять на своём»: брошенная фраза клиента (несколько вариантов)
  // + реакция-мысль сотрудника + финальная строка-подпись визита.
  // Вариант выбирается случайно — каждый отказ звучит по-разному.
  hardEnds: [
    { v: 'Так. Всё понятно. ЗАВТРА зайду. И надеюсь, завтра у вас будет настроение работать по-человечески.',
      n: 'Сказал «завтра». Интересно, правда придёт или это так, для солидности. Дверь за ним закрылась мягко — почти как обещание.',
      out: 'Николай ушёл, пообещав вернуться завтра. Почему-то верится. И почему-то не хочется.' },
    { v: 'Ужасный сервис. Я такое в первый раз вижу. Вы хоть понимаете, что я об этом всем расскажу?',
      n: 'Расскажет. Я почти физически видел, как гневный отзыв рождается у него в голове — строчка за строчкой, с восклицательными знаками.',
      out: 'Николай ушёл, пригрозив гневным отзывом, — с явно задетым чувством достоинства.' },
    { v: 'Всё. Больше к вам не приду. Даже если вы останетесь единственным пунктом на весь район.',
      n: '«Не приду» — это громко. В нашем районе других пунктов просто нет, и он это прекрасно знал. Блефовал он вдохновенно.',
      out: 'Николай хлопнул дверью. Спустя десять минут мне почему-то почти жаль, что он не вернётся.' },
    { v: 'Отлично. Значит, пишу в поддержку. Посмотрим, что они скажут про ваше „просто нет“.',
      n: 'Поддержка. Пусть пишет. Хотя что они скажут — я и сам не знал, зачем отказал. Пусть теперь разбираются вместе с ним.',
      out: 'Ушёл набирать жалобу. Его заказ так и остался лежать в ячейке, бесхозный и тихий.' },
    { v: 'Знаете, я не буду скандалить. Просто запомните: я этого не забуду.',
      n: 'Вот это было хуже всего. Когда не скандалят, а запоминают. Потом такое возвращается — всегда и не вовремя.',
      out: 'Николай ушёл спокойно, но слишком ровной походкой. Такое не забывается. И мне это не нравится.' }
  ],
  // Концовка «всё же выдать»: реакция + мысль
  giveEnds: [
    { v: 'Вот и славно. А то я уж подумал, вы тут по ночам заказы разыгрываете.',
      n: 'Он выдохнул и отступил от стойки. Спорить с ним было странно, но выдать — почему-то правильнее.' },
    { v: 'Наконец-то по-человечески. Спасибо. Приятно, что вы хоть выслушали.',
      n: '«Выслушал» — сказал он. Хотя по-честному я как раз ничего не понял. Но коробка у него. Ладно.' },
    { v: 'Так-то лучше. Я понимаю, что правила. Но иногда надо просто доверять людям.',
      n: 'Доверять людям. Он сказал это так легко, будто за окном не наступала ночь и не запиралась дверь на два оборота.' }
  ],
  // Реплики сотрудника во второй волне отказа (единый стиль: плашка = ваша реплика)
  refuseFollow: {
    hard: [
      'Я сказал — нет. И это не обсуждается.',
      'Всё. Отказ окончательный. Вы свободны.',
      'Нет — значит нет. Хватит спорить.'
    ],
    give: [
      'Ладно. Забирайте. Но больше без фокусов.',
      'Так и быть. Берите — и в следующий раз без этих вопросов.',
      'Хорошо, вы меня убедили. Ваш заказ.'
    ]
  },
  // === ВЕТКА «ЗАКАЗ НЕ НАЙДЕН» (не принял на приёмке) ===
  lostSearch: [
    'Я прошёлся по полкам. Раз десять. Этого кода здесь не было — ни в ячейке, ни под стеллажом, нигде.',
    'Полки я знаю наизусть, каждый зазор между коробками. Этой посылки тут не было. Ни сегодня, ни вообще.',
    'Я проверил по базе, потом глазами, потом снова по базе. Тихо. Пусто. Заказ был — посылки не было.'
  ],
  lostReactions: [
    'Как это — нет? Вы мне сейчас говорите, что мой заказ просто… исчез?',
    'Стоп. Я вчера оплатил. Где моя посылка, я вас спрашиваю?',
    'Так. Ещё раз: я пришёл за заказом, а вы мне говорите, что его нет?',
    'Вы понимаете, что это уже не смешно? Я прихожу получать посылку, а не загадки разгадывать.'
  ],
  lostThoughts: [
    'Он был прав. Заказ стоял в накладной, а на полке его не было — и это была уже не его проблема, а моя.',
    'Самое паршивое: он не виноват ни в чём. Виноват я. И сейчас придётся это как-то произнести вслух.',
    'Мне оставалось только не смотреть ему в глаза. Полки смотрели на меня с немым укором.'
  ],
  // Реплики сотрудника в ветке «заказ не найден» (единый стиль)
  lostFollow: {
    sorry: [
      'Простите. Это моя ошибка. К завтрашнему дню всё будет.',
      'Извините, посылку не приняли вовремя — виноват я. Найду к завтра, обещаю.',
      'Поверьте, мне самому неловко. Завтра заказ будет здесь.'
    ],
    cold: [
      'Заказа нет. Ничего не могу поделать.',
      'Не приняли — значит, нет. Приходите, когда привезут.',
      'Чем могу. Посылки нет.'
    ]
  },
  lostEnds: {
    sorry: [
      { v: 'Ладно… хоть что-то. Но раз обещали найти — найдите. Я завтра подойду.',
        n: 'Пообещал найти к завтра. Сказал как отрезал. Теперь либо найду, либо придётся врать дальше.',
        out: 'Николай ушёл не злой — уставший. От этого было только хуже.' },
      { v: 'Извинились — уже приятно. Но посылка-то где? Ладно, завтра приду. Надеюсь, с хорошими новостями.',
        n: '«С хорошими новостями». Как будто я сам в них верил.',
        out: 'Он ушёл, оставив мне обещание, которое я ещё не придумал, как выполнить.' },
      { v: 'Я не злопамятный. Но завтра, пожалуйста, без сюрпризов.',
        n: '«Без сюрпризов». Если бы он знал, сколько сюрпризов я уже пережил за эту смену.',
        out: 'Дверь закрылась. Заказ я так и не нашёл. Обещание осталось.' }
    ],
    cold: [
      { v: 'Вот так просто? „Нет на складе“ — и всё? Приятного сервиса, конечно.',
        n: 'Холодность — тоже ответ. По крайней мере честный. Ему это не понравилось.',
        out: 'Николай ушёл, не сказав ни слова. Это было хуже любых слов.' },
      { v: 'Знаете, я даже не удивлён. В этом пункте у вас всё „нет на складе“.',
        n: 'Задел, но по делу. Коробки действительно не было.',
        out: 'Ушёл, бормоча что-то про отзыв. Пусть. Мне было не до этого.' },
      { v: 'Ясно. Значит, мне сюда больше ходить незачем.',
        n: '«Незачем». Ну да. На его месте я бы сказал то же самое.',
        out: 'Николай ушёл. Заказ так и остался лежать где-то, где его не было.' }
    ],
  },
  choices: [
    { icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give' },
    { icon: '💬', label: 'Поддержать диалог', hint: 'Спросить, что заказал', act: 'talk' },
    { icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Причин не будет', act: 'refuse' }
  ]
};

const VISITOR_MAN2_IMG = 'assets/visitor-man2.webp';

// ===== ПОСЕТИТЕЛЬ #2: АРТЁМ — молодой, самоуверенный, пучок, бомбер, цепочка =====
const VISITOR_MAN2 = {
  id: 'man2', name: 'Артём', male: true, img: VISITOR_MAN2_IMG,
  intros: [
    'Дверь распахнулась с лёгким стуком — в пункт вплыл парень с пучком на макушке, в сером бомбере и с серебряной цепочкой. Огляделся, как будто зашёл к себе домой, и поправил воротник.',
    'В дверях появился молодой человек: чёрный пучок, бомбер, цепочка. Походка особенная — так ходят люди, уверенные, что весь мир их уже ждёт.',
    'Колокольчик звякнул, и внутрь вошёл парень в серой куртке. Вытащил наушник, стряхнул несуществующую пылинку с рукава и посмотрел на меня с лёгким прищуром.',
    'Парень с пучком возник в дверях резко, будто выпал из кадра. Бомбер, цепочка, взгляд. Остановился у стойки и молча ждал, пока я первым скажу «здравствуйте».'
  ],
  greeting: 'Здравствуйте. Заказ на меня. Думаю, вы меня уже заждались.',
  questions: [
    'Что заказали?',
    'Что за покупка?',
    'Помочь найти вашу посылку?',
    'Что пришло на ваше имя?',
    'Какой заказ ищем?'
  ],
  chatter: [
    'У вас тут уютно. Прям как кофейня, только с коробками.',
    'Представьте, у меня весь день минута в минуту. Даже сюда успел.',
    'Доставили быстро, уважаю. Так и должно быть.',
    'А пункт у вас всегда такой спокойный? Мне нравится. Люблю, когда без суеты.',
    'Я вообще-то человек занятой. Но для хорошего сервиса могу и подождать.'
  ],
  // Возражения клиента: «как это — нет?!»
  objections: [
    'В смысле „нет“? Нет — это когда не хотят. А вы, получается, со мной работать не хотите?',
    'Стоп-стоп-стоп. Я оплатил, я пришёл. Что значит „нет“? Вы сейчас шутите?',
    'Так. Я человек простой: деньги отдал — товар получил. У вас, видимо, другая арифметика?',
    '„Объяснений не будет“? Партнёры так не делают. А я, между прочим, мог бы стать вашим самым лучшим клиентом.'
  ],
  // Отказ БЕЗ объяснений: коротко и холодно, причин не даём
  refuseLines: [
    'Нет. Объяснений не будет.',
    'Отказ. Причин не называю.',
    'Следующий, пожалуйста.',
  ],
  silentNotes: [
    'Вы молча кивнули, развернулись и пошли к полкам. Спиной чувствовался его взгляд — оценивающий, как на витрину.',
    'Словами тут было не помочь. Вы просто ушли за заказом, оставив его у стойки с поднятой бровью.',
    'Молчание — тоже ответ. Вы забрали накладную и зашагали к стеллажам, а он остался стоять, сложив руки на груди.'
  ],
  thoughts: [
    'Он стоял и смотрел на меня так, будто я только что сорвал его личное шоу. Ну и пусть.',
    'Самое обидное: он прав. Но «права» тут не было — был мой отказ.',
    'Я почувствовал себя официантом, который сообщил, что кухня закрыта, гостю с золотой картой.',
    'Про себя я отметил, что держится он лучше, чем я. Это раздражало.'
  ],
  talkThoughts: [
    'Он держится так, будто ведёт переговоры о слиянии. А речь про одну коробку.',
    'Костюм, часы, уверенный тон. И всё равно ждёт свою посылку, как все.',
    'Проще всего с теми, кто чётко знает, чего хочет. Он знает.'
  ],
  refuseThoughts: [
    'Самое обидное: он прав. Но «права» тут не было — был мой отказ.',
    'Он говорил как партнёр по переговорам, а я захлопнул дверь без причины.',
    'Мой отказ выбил его из роли уверенного человека. И мне это не понравилось.'
  ],
  // Концовки «Стоять на своём»: брошенная фраза клиента + мысль + финальная подпись
  hardEnds: [
    { v: 'Так. Всё понятно. Пойду туда, где со мной по-человечески. А вы тут сидите.',
      n: 'Ушёл ровно так же, как вошёл, — будто из кадра. Только без улыбки.',
      out: 'Дверь за ним закрылась. Пучок мелькнул в окне и растворился в толпе. Эффектно.' },
    { v: 'Ужасный сервис. Я такое только в отзывах видел, а теперь, значит, и вживую.',
      n: 'Отзыв он напишет — это читалось по лицу. Длинный, с абзацами.',
      out: 'Артём ушёл, пригрозив гневным отзывом, — с явно задетым чувством достоинства. Цепочка блестела как-то зло.' },
    { v: 'Всё. Больше к вам не приду. И друзьям расскажу. А у меня, между прочим, друзей много.',
      n: '«Друзей много». Ну да. У всех, кто так говорит, друзей обычно кот наплакал.',
      out: 'Артём хлопнул дверью. В окно было видно, как он уже кому-то звонит и энергично жестикулирует.' },
    { v: 'Отлично. Значит, я иду в поддержку. И это не шутка — у меня скриншоты все сохранены.',
      n: 'Скриншоты у него наверняка были. Судя по уверенности — целый альбом.',
      out: 'Ушёл набирать жалобу. Его заказ так и остался лежать в ячейке, бесхозный и тихий.' },
    { v: 'Знаете, я не злопамятный. Но вы запомните этот день. Я умею так, что запоминается.',
      n: 'Прозвучало как угроза и комплимент одновременно. Неприятно.',
      out: 'Артём ушёл ровной, слишком уверенной походкой. Такое не забывается.' }
  ],
  // Концовки «Всё же выдать»: реакция клиента + мысль
  giveEnds: [
    { v: 'Ну наконец-то. А то я уже начал думать, что тут какие-то свои правила.',
      n: '«Свои правила». Если бы он знал, какие правила у меня только что появились…' },
    { v: 'Вот за это уважаю. Вопросов больше не имею.',
      n: '«Уважаю» — громко сказано, но приятно. Цепочка его, правда, смотрела на меня с сомнением.' },
    { v: 'Другое дело. А то сижу тут, как у нотариуса.',
      n: 'Сравнение с нотариусом мне польстило. Пусть забирает и идёт.' }
  ],
  // Реплики сотрудника во второй волне отказа (единый стиль: плашка = ваша реплика)
  refuseFollow: {
    hard: [
      'Я сказал — нет. Это окончательно.',
      'Отказ остаётся в силе. Можете идти.',
      'Нет — значит нет. Словарь у меня небольшой.'
    ],
    give: [
      'Ладно. Забирайте. Но больше — без этих разговоров.',
      'Так и быть. Берите. Только без пафоса.',
      'Хорошо, вы победили. Ваш заказ.'
    ]
  },
  // === ВЕТКА «ЗАКАЗ НЕ НАЙДЕН» (не принял на приёмке) ===
  lostSearch: [
    'Я прошёлся по полкам. Три раза. Мимо моего взгляда этот код не прошёл — его просто не было.',
    'База говорит «есть», стеллаж говорит «нет». Стеллаж тут главный, я его давно знаю.',
    'Я заглянул в каждую щель. Даже туда, где обычно никто не прячется. Пусто.'
  ],
  lostReactions: [
    'Как это — нет? Я вчера оплатил, у меня чек в телефоне. Вы хотите сказать, что посылка испарилась?',
    'Стоп. У меня всё под контролем. Привык, что сюрпризы — это про других. А тут — сюрприз мне?',
    'Красиво. Заказ есть, посылки нет. Это вы сейчас так шутите?',
    'Так. Спокойно. Дышим. Значит, моя посылка просто… не приехала? Ко мне? Не может быть.'
  ],
  lostThoughts: [
    'Он был прав, и мы оба это знали. Заказ стоял в накладной, а на полке его не было.',
    'Самое паршивое: он не виноват ни в чём. Виноват я. И сейчас придётся это как-то произнести вслух.',
    'Я смотрел в пол. Пол смотрел на меня. Посылки не было ни там, ни там.'
  ],
  // Реплики сотрудника в потеряшке (единый стиль)
  lostFollow: {
    sorry: [
      'Простите. Это моя вина. К завтрашнему дню всё будет.',
      'Извините, посылку не приняли вовремя — виноват я. Завтра будет.',
      'Мне неловко. Завтра заказ будет здесь, обещаю.'
    ],
    cold: [
      'Заказа нет. Сами пересчитайте — всё равно не довозили.',
      'Принять не успели. Будет, когда привезут, а не до.',
      'Посылки нет. Искать её мне нечем.',
    ]
  },
  lostEnds: {
    sorry: [
      { v: 'Ладно… Раз уж вы извинились, я подожду до завтра. Но смотрите мне: я запомнил.',
        n: '«Я запомнил». Отлично. Теперь я должен найти то, чего нет, за одну ночь.',
        out: 'Артём ушёл не злой — снисходительный. Это было хуже злости.' },
      { v: 'Ну хоть что-то. Завтра, значит. Я зайду после обеда, у меня всё расписано.',
        n: '«Всё расписано». Надеюсь, в его расписании не значится «устроить скандал».',
        out: 'Он ушёл, оставив мне обещание, которое я ещё не придумал, как выполнить.' },
      { v: 'Договорились. Завтра. Если что — я очень хорошо помню, как выглядит моя посылка.',
        n: 'Он описал её до последнего шва. Теперь её надо было найти. В несуществующем месте.',
        out: 'Дверь закрылась. Я остался один на один с пустой ячейкой.' }
    ],
    cold: [
      { v: 'Вот так просто? Зашёл, спросил — „нет“, и до свидания? Красиво живёте.',
        n: 'Холодность — тоже ответ. По крайней мере честный. Ему это не понравилось.',
        out: 'Артём ушёл, не сказав ни слова. Это было хуже любых слов.' },
      { v: 'Ну и ну. А говорили — „пункт у дома“. Ладно, пойду искать справедливость где-нибудь ещё.',
        n: '«Справедливость» где-нибудь ещё. Обычно это ничем хорошим не кончается.',
        out: 'Ушёл, бормоча что-то про отзыв. Пусть. Мне было не до этого.' },
      { v: 'Ясно. Спасибо за сервис. Обязательно расскажу об этом всем, кого знаю.',
        n: '«Всем, кого знаю». Судя по уверенности — это примерно весь район.',
        out: 'Артём ушёл. Заказ так и остался лежать где-то, где его не было.' }
    ]
  },
  choices: [
    { icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give' },
    { icon: '💬', label: 'Поддержать диалог', hint: 'Спросить, что заказал', act: 'talk' },
    { icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Причин не будет', act: 'refuse' }
  ]
};

const VISITOR_TEEN_IMG = 'assets/visitor-teen.webp';

// ===== ПОСЕТИТЕЛЬ #3: ЕГОР — подросток, наушники, худи, «ну вы поняли» =====
const VISITOR_TEEN = {
  id: 'teen', name: 'Егор', male: true, img: VISITOR_TEEN_IMG,
  intros: [
    'Дверь приоткрылась ровно настолько, чтобы проскользнуть. Внутрь вступил подросток в серо-голубом худи с капюшоном и большими наушниками. Одна рука в кармане, взгляд сквозь меня.',
    'В дверях материализовался парень в худи. Наушники на голове, из них еле слышно долбит бит. Он остановился, покрутил головой, как будто искал, куда деть взгляд, и нашёл его в телефоне.',
    'Колокольчик звякнул дважды: дверь он придержал ногой. Подросток в мятом худи, с наушниками на шее, молча встал у стойки и продолжил листать телефон.',
    'В пункт вошёл парень лет семнадцати, в худи с капюшоном, наполовину утонувший в наушниках. Он снял один, поздоровался — тихо, как будто извиняясь за своё существование.'
  ],
  greeting: 'Здравствуйте. Тут заказ на меня должен быть… Родители сказали зайти.',
  questions: [
    'Что заказывал?',
    'Что за посылка?',
    'Что пришло?',
    'Что там за заказ?',
    'Что ищем?'
  ],
  chatter: [
    'А можно быстрее? У меня… ну, тренировка. Или не тренировка. Просто надо.',
    'Тут музыка играет, да? У вас лучше, чем на скамейке у дома.',
    'А вы тут один работаете? Не скучно? Я бы с ума сошёл.',
    'Народ в этом пункте нормальный, да? Просто мама сказала, что тут… ну вы поняли.',
    'А можете трек включить? Ну ладно, я пошутил. Наверное.'
  ],
  // Возражения клиента: «как это — нет?!»
  objections: [
    'Как это нет? Я оплатил… ну, мама оплатила. Неважно. Заказ МОЙ должен быть.',
    'Стоп. То есть вы мне просто „нет“ говорите? А чё сразу нет?',
    'Я за этим шёл через весь двор. Ну ладно, через половину. Но всё равно!',
    '„Нет“ — это не ответ. Мне мама сказала, чтобы я без заказа не приходил. Вы понимаете, что вы делаете?'
  ],
  // Отказ БЕЗ объяснений: коротко и холодно, причин не даём
  refuseLines: [
    'Нет. Без объяснений. Всё.',
    'Отказ. Причины — мои. Нет.',
    'Нет — и точка. Следующий.',
  ],
  silentNotes: [
    'Вы молча кивнули и пошли к полкам. Спиной было слышно, как он снова надел наушники — то ли от обиды, то ли от неловкости.',
    'Словами тут было не помочь. Вы развернулись и зашагали к стеллажам, оставив его в тишине, которую он тут же заполнил музыкой.',
    'Молчание — тоже ответ. Вы ушли за заказом, а он остался у стойки с наушником в одной руке и потерянным лицом.'
  ],
  thoughts: [
    'Он смотрел на меня так, будто я только что отменил ему все каникулы. Подросткам вообще легко что-то отменить — у них всё впервые.',
    'Самое обидное: он прав. Но права тут не было — был мой отказ, и вся эта сцена из-за него.',
    'Я почувствовал себя охранником, который не пустил школьника в кино на его же праздник.',
    'Про себя я отметил, что теперь мне ещё и маме его объяснять. Мысль была так себе.'
  ],
  talkThoughts: [
    'Семнадцать лет, чужой заказ и наушники. Разговаривать с ним нужно как со взрослым — тогда и отвечает по-взрослому.',
    'Он старается казаться равнодушным, но за коробку переживает больше, чем показывает.',
    'Подростки в пункте всегда немного напряжены. Достаточно не давить.'
  ],
  refuseThoughts: [
    'Он смотрел на меня так, будто я только что отменил ему все каникулы. Подросткам вообще легко что-то отменить — у них всё впервые.',
    'Самое обидное: он прав. Но права тут не было — был мой отказ, и вся эта сцена из-за него.',
    'Я почувствовал себя охранником, который не пустил школьника в кино на его же праздник.'
  ],
  // Концовки «Стоять на своём»: брошенная фраза клиента + мысль + финальная подпись
  hardEnds: [
    { v: 'Ладно… Я маме скажу. Она разберётся. Она у меня… вы не знаете, как она умеет.',
      n: 'Мама. Классика. Если она действительно умеет так, как он намекал, мне лучше сменить смену.',
      out: 'Егор ушёл, натягивая капюшон. В окно было видно, как он уже набирает чей-то номер. Наверняка мамин.' },
    { v: 'Ужасный сервис. Я в интернете напишу. У меня подписчики есть. Ну, немного… но есть!',
      n: '«Немного, но есть». Обычно после таких слов их «немного» оказывается тремя друзьями из чата класса.',
      out: 'Егор ушёл, пригрозив гневным отзывом, — с явно задетым чувством достоинства. Наушники он надел демонстративно громко.' },
    { v: 'Всё, больше сюда не приду. Буду на другой улице заказывать. Мои вещи, между прочим, не только тут живут.',
      n: '«На другой улице». Ну да. Если он сможет объяснить маме, почему отказался от посылки, — пусть.',
      out: 'Егор хлопнул дверью, но придержал её ногой — привычка. Даже уходя, он оставался собой.' },
    { v: 'Так. Я пишу в поддержку. И маме пишу. У вас всё. А я — всё.',
      n: 'Двойной удар: поддержка и мама. Из этих двух мама была страшнее.',
      out: 'Ушёл набирать жалобу. Его заказ так и остался лежать в ячейке, бесхозный и тихий.' },
    { v: 'Знаете, я не злопамятный. Просто запомню. У меня память на такое хорошая. Спросите у мамы.',
      n: '«Спросите у мамы» — прозвучало как приговор. Я решил не уточнять.',
      out: 'Егор ушёл, засунув руки в карманы. Из наушников на прощание долетел тяжёлый бас.' }
  ],
  // Концовки «Всё же выдать»: реакция клиента + мысль
  giveEnds: [
    { v: 'О, нормально. А то я уже думал, зря шёл. Спасибо. Ну, скажете тоже спасибо?',
      n: '«Скажете тоже спасибо» — в его исполнении это было почти нежно.' },
    { v: 'Вот это да. Вопросов нет. Вы, оказывается, нормальный. Я маме так и скажу.',
      n: '«Нормальный». От подростка это чуть ли не орден.' },
    { v: 'Красиво. Уважение. Я, кстати, в следующий раз ещё что-нибудь закажу. Если не забуду.',
      n: '«Если не забуду». Надеюсь, мама напомнит.' }
  ],
  // Реплики сотрудника во второй волне отказа (единый стиль: плашка = ваша реплика)
  refuseFollow: {
    hard: [
      'Я сказал — нет. Это окончательно.',
      'Отказ остаётся в силе. Можете идти.',
      'Нет — значит нет. И маме передайте то же самое.'
    ],
    give: [
      'Ладно. Забирай. Только без этих разговоров.',
      'Так и быть. Бери. И маме скажи, что пункт хороший.',
      'Хорошо. Держи свой заказ.'
    ]
  },
  // === ВЕТКА «ЗАКАЗ НЕ НАЙДЕН» (не принял на приёмке) ===
  lostSearch: [
    'Я прошёлся по полкам. Два раза. На третий уже просто смотрел в пустоту — кода не было.',
    'База говорит «есть», стеллаж говорит «нет». Стеллаж тут главный, я его давно знаю.',
    'Я заглянул в каждую ячейку, даже в ту, где обычно лежит забытая кем-то шапка. Пусто.'
  ],
  lostReactions: [
    'Как это — нет? Я же видел в приложении „доставлено“. Оно прямо так и написано. Мне мама показывала.',
    'Стоп. То есть заказ есть, а посылки нет? Это баг какой-то. Вы проверяли?',
    'Серьёзно? Я шёл, музыку слушал, настроение было… А теперь что?',
    'Так, спокойно. Значит, посылка не приехала. А я маме что скажу? Вы подумайте об этом.'
  ],
  lostThoughts: [
    'Он был прав, и мы оба это знали. Заказ стоял в накладной, а на полке его не было.',
    'Самое паршивое: он не виноват ни в чём. Виноват я. И сейчас придётся это как-то произнести вслух.',
    'Я смотрел в пол. Он смотрел в телефон. Посылки не было ни в телефоне, ни на полке.'
  ],
  // Реплики сотрудника в потеряшке (единый стиль)
  lostFollow: {
    sorry: [
      'Прости. Это моя вина. Завтра всё будет.',
      'Извини, посылку не приняли вовремя — виноват я. Завтра будет.',
      'Мне неловко. Завтра заказ будет здесь, обещаю.'
    ],
    cold: [
      'Заказа нет. Сам бы обрадовался, но нет.',
      'Не приняли — будет, когда привезут. Приходи, ладно?',
      'Чем помочь… Ну, ничем. Посылки нет.',
    ]
  },
  lostEnds: {
    sorry: [
      { v: 'Ладно… Раз вы извинились, я подожду. Но маме всё равно скажу, что тут чуть не случилось.',
        n: '«Чуть не случилось». Подростковая драма на пустом месте. Хотя место было не такое уж пустое.',
        out: 'Егор ушёл, натягивая капюшон. Походка у него была побеждённая, но с достоинством.' },
      { v: 'Завтра, значит. Я зайду после школы. Если меня, конечно, не задержат. Вы же знаете, как бывает.',
        n: '«Как бывает». Ещё как знаю. В его случае это обычно значит «после второго урока, если не вызовут к доске».',
        out: 'Он ушёл, оставив мне обещание, которое я ещё не придумал, как выполнить.' },
      { v: 'Договорились. Завтра. Только, чур, без сюрпризов. Мне завтра ещё контрольная.',
        n: 'Контрольная и пропавшая посылка. День у него задался. Надеюсь, хоть у меня он задастся.',
        out: 'Дверь закрылась. Я остался один на один с пустой ячейкой.' }
    ],
    cold: [
      { v: 'Вот так просто? Зашёл, спросил — „нет“? Ладно. Маме расскажу. Она сама с вами поговорит.',
        n: 'Он сказал это так, будто вынес приговор. Возможно, так оно и было.',
        out: 'Егор ушёл, не сказав ни слова. Только наушники надел — громко, на весь пункт.' },
      { v: 'Ну и сервис. Я вообще-то мог тут и не заказывать. Другие места есть.',
        n: '«Другие места» — в его случае это, вероятно, одна полка в ларьке у дома.',
        out: 'Ушёл, бормоча что-то про отзыв. Пусть. Мне было не до этого.' },
      { v: 'Ясно. Спасибо. Я всё понял. Вы тоже поймёте, когда мама придёт.',
        n: '«Когда мама придёт» — от этих слов у меня похолодело за ушами.',
        out: 'Егор ушёл. Заказ так и остался лежать где-то, где его не было.' }
    ]
  },
  choices: [
    { icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give' },
    { icon: '💬', label: 'Поддержать диалог', hint: 'Спросить, что заказал', act: 'talk' },
    { icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Причин не будет', act: 'refuse' }
  ]
};



// === ПЕРСОНАЖ: ДЕЛОВАЯ ДЕВУШКА ===
const VISITOR_BUSINESS_IMG = 'assets/visitor-business.webp';
const VISITOR_BUSINESS = {
  id: 'business', name: 'Марина', male: false, img: VISITOR_BUSINESS_IMG,
  intros: [
    'Дверь открылась, и в пункт уверенно вошла девушка в аккуратном терракотовом пиджаке и очках. Поправив оправу, она оглядела помещение и подошла к стойке.',
    'В пункт вошла девушка с деловой папкой под мышкой, в строгих очках и с собранными волосами. Вид у неё был сосредоточенный — человек явно спешил между встречами.',
    'Колокольчик звякнул, и у стойки появилась девушка в элегантном офисном костюме. Доставая из сумки телефон с QR-кодом, она слегка улыбнулась.',
    'Вошла девушка в очках и деловом пиджаке. Поставив сумку на пуфик, она уверенно положила на стойку телефон с открытым приложением.'
  ],
  greeting: 'Здравствуйте! Получение на имя Марины, код держу на экране.',
  questions: ['Что на этот раз в заказе?', 'Полезное для офиса?', 'Что за вещица?', 'Какая покупка сегодня?', 'Расскажете, что ехало?'],
  chatter: ['У вас тут на удивление тихо. Обычно в пунктах такой шум.', 'Я как раз с удаленки еду, решила заскочить по пути.', 'Доставка сработала минута в минуту, приятно удивлена.', 'Работа у вас беспокойная, столько людей каждый день.', 'Главное — успеть до вечерней планерки.'],
  objections: ['В смысле — нет? Как это нет, если в приложении чётко написано: „Доставлено в пункт“?! Вы проверяли вообще?', 'Погодите. Вы отказываетесь выдать заказ без объяснения причин? Я за него заплатила и рассчитываю получить вовремя.', 'Это шутка такая? Я из-за этого заказа специально сюда заехала в середине рабочего дня. Какой отказ?!', '„Правила есть правила“ — это не ответ. Давайте позовём старшего или откроем накладную. Я так не уйду.'],
  refuseLines: ['Нет. Сегодня не выдадим.', 'Отказ. Без объяснения причин.', 'К сожалению, нет. Приходите в другой раз.', 'Нет — и точка. Правила есть правила.'],
  silentNotes: ['Вы молча кивнули и направились к стеллажам. Марина вздохнула, убирая телефон в сумочку.', 'Без лишних слов вы пошли искать коробку. Она терпеливо ждала у стойки, постукивая пальцем по столешнице.', 'Вы развернулись к полкам. В тишине пункта послышался лишь шелест её пальто.'],
  thoughts: [
    'Я мог бы сослаться на сбой системы или задержку инвентаризации. Но правда в том, что мне просто захотелось посмотреть, как она будет отстаивать свои права. В её глазах уже читался будущий разгромный отзыв.',
    'Она выглядела как человек, у которого расписана каждая минута на три недели вперед. Отказывать таким — чистое безумие, но иногда хочется нарушить чужой идеальный график.',
    'Я чувствовал себя мелким бюрократом, который тормозит важный бизнес-процесс. Но отступать уже было поздно.',
    'Иногда мне кажется, что в этих деловых костюмах скрывается куда больше нервов, чем у всех остальных посетителей вместе взятых. И я только что добавил ей порцию.'
  ],
  talkThoughts: [
    'Она считает минуты, и это видно. Значит, лишних слов не надо.',
    'Деловой тон — не грубость, а экономия времени. Отвечу так же.',
    'У неё расписан день по клеточкам, а я — одна из клеточек. Постараюсь не подвести.'
  ],
  refuseThoughts: [
    'Она выглядела как человек, у которого расписана каждая минута на три недели вперед. Отказывать таким — чистое безумие, но иногда хочется нарушить чужой идеальный график.',
    'Я сказал «нет» человеку, у которого каждая минута на счету. Это было почти жестоко.',
    'Она искала логику в моём отказе. Логики там не было.'
  ],
  hardEnds: [
    {v: 'Прекрасно. Я пишу в службу поддержки и оставляю самый подробный отзыв. Вы доиграетесь.', n: 'Самый подробный отзыв. Звучало угрожающе. Судя по её очкам и осанке, отзыв будет написан по ГОСТу.', out: 'Марина развернулась на каблуках и вышла, хлопнув дверью так элегантно и громко, что зазвенели витрины.'},
    {v: 'Знаете что? Больше я услугами вашего сервиса пользоваться не буду. Есть масса других компаний.', n: '«Масса других компаний». Классика жанра при любом сбое.', out: 'Она ушла с прямой спиной, оставив после себя шлейф дорогого парфюма и ощущение надвигающейся проверки.'},
    {v: 'Это возмутительно! Я требую жалобную книгу! Хотя бы электронную!', n: 'Электронная жалобная книга. Если бы она существовала, сервер бы уже сгорел.', out: 'Ушла с гордо поднятой головой, оставив меня наедине с её невыданной коробкой.'},
    {v: 'Ладно. Вы своего добились. Но я так это не оставлю, у меня муж юрист.', n: 'Муж юрист. Стандартный аргумент в любой непонятной ситуации в ПВЗ.', out: 'Марина вышла на улицу, яростно набирая номер на телефоне. Наверное, того самого юриста.'},
    {v: 'Ужасно. Просто непрофессионально. Желаю вашему бизнесу процветания с таким подходом.', n: 'Сарказм в чистом виде. Самое страшное оружие офисного сотрудника.', out: 'Хлопнула дверью с достоинством английской королевы, решившей казнить садовника.'}
  ],
  giveEnds: [
    {v: 'Спасибо. Хотя нервов вы мне потрепали изрядно. Хорошего дня.', n: '«Нервов потрепали». И то правда. Зато сейчас получит своё.'},
    {v: 'Вот и славно. Не люблю пустые споры. Всего доброго.', n: 'Деловая женщина — деловой исход. Всё чётко и по делу.'},
    {v: 'Спасибо за понимание. Извините, если резко — на совещании жуткий аврал.', n: 'Аврал на совещании. Понимаю. Сами тут сидим в аврале.'}
  ],
  refuseFollow: {
    hard: ['Решение принято. Ничем не могу помочь.', 'Отказ окончательный. Всего доброго.', 'Спорить бесполезно. Следующий, пожалуйста.'],
    give: ['Ладно, держите ваш заказ. Больше не задерживаю.', 'Хорошо, забирайте. Извините за заминку.', 'Держите коробку. Удачного дня.']
  },
  lostSearch: ['Я просмотрел полки дважды. Для её заказа ячейка оказалась пуста.', 'База показывает приёмку, а на полке — пустота. Классический призрак пропавшей посылки.', 'Я обыскал весь сектор. Её коробки нигде не было.'],
  lostReactions: ['Как это нет?! У меня самолет через три часа, мне эта вещь в поездку нужна была!', 'Вы шутите? Я отпросилась с работы специально за заказом, а вы говорите — не нашли?', 'Прекрасно! И что мне делать? Где мой заказ?', 'Это просто невероятно. Вы можете нормально проверить склад?'],
  lostThoughts: ['Её взгляд резал острее любого скальпеля. И возразить было нечего.', 'Потерять заказ деловой женщины перед поездкой — худшее, что может случиться со сменой.', 'Я чувствовал себя школьником, забывшим дневник дома.'],
  lostFollow: {
    sorry: ['Прошу прощения. Моя вина, сделаем запрос на склад, найдём к утру.', 'Приношу извинения, накладка при приёмке. Завтра с утра первым делом выдадим.', 'Виноват. К утру всё проверим по инвентаризации, простите за неудобства.'],
    cold: ['Заказа нет на складе. Ничем помочь не могу.', 'Не нашли — значит, брак или утеря. Оформляйте возврат в приложении.', 'Ищите в другом пункте или ждите пересортицы.']
  },
  lostEnds: {
    sorry: [
      {v: 'Ладно… Надеюсь, к утру разыщите. До свидания.', n: 'Обещание разобраться спасло ситуацию, но осадок остался тяжёлый.', out: 'Марина быстро вышла, цокая каблуками по асфальту.'},
      {v: 'Завтра утром — значит, утром. Буду ждать звонка из пункта.', n: 'Утренняя выдача — моя личная зона ответственности теперь.', out: 'Она ушла, оставив меня разбираться с пропажей.'},
      {v: 'Хорошо. Надеюсь, вы слов на ветер не бросаете.', n: 'Слов на ветер я старался не бросать, но иногда они сами вылетали.', out: 'Дверь закрылась за ней с тихим шелестом.'}
    ],
    cold: [
      {v: 'Это просто безобразие. Больше я через ваш пункт заказывать не буду.', n: 'Категорично и справедливо. Обидно, но по делу.', out: 'Марина развернулась и ушла, хлопнув дверью.'},
      {v: 'Прекрасно. Придётся покупать в торговом центре втридорога.', n: 'Втридорога — зато сегодня. Логика железная.', out: 'Ушла, оставив меня с пустыми руками и тяжёлым чувством вины.'},
      {v: 'Ясно. Всего хорошего. Больше мы не увидимся.', n: '«Больше не увидимся» прозвучало как эпитафия.', out: 'Она ушла. Я остался один на один с пустым стеллажом.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give'},
    {icon: '💬', label: 'Поддержать диалог', hint: 'Спросить, что заказал', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Причин не будет', act: 'refuse'}
  ]
};


// === ПЕРСОНАЖ: ДЕВУШКА В ЖЁЛТОМ ХУДИ ===
const VISITOR_GIRL_IMG = 'assets/visitor-girl.webp';
const VISITOR_GIRL = {
  id: 'girl', name: 'Алиса', male: false, img: VISITOR_GIRL_IMG,
  intros: [
    'В пункт вошла молодая девушка в уютном жёлтом худи, не отрывая взгляд от экрана смартфона. Слегка улыбнувшись своим мыслям, она подошла к стойке.',
    'Колокольчик над дверью звякнул. Вошла девушка в жёлтой толстовке, уверенно держа в руках телефон с открытым штрих-кодом выдачи.',
    'Дверь распахнулась, впуская девушку в стильном худи солнечного цвета. Не выпуская гаджет из рук, она встала у прилавка.',
    'В пункт зашла девушка в жёлтом худи, параллельно переписываясь с кем-то в мессенджере. Подойдя к стойке, она подняла на меня глаза.'
  ],
  greeting: 'Привет! Я за заказом, вот код в приложении.',
  questions: ['Что интересного заказала?', 'Опять гаджеты или одежда?', 'Признавайся, что в коробке?', 'Что за вещица сегодня?', 'Что в посылке — не терпится взглянуть?'],
  chatter: ['Обожаю пункты у дома — никуда ехать специально не надо.', 'Мне тут подруга такую крутую штуку посоветовала, вот жду не дождусь.', 'У вас тут так уютно пахнет кофе и картонными коробками!', 'В приложении трек-номер обновился прямо перед тем, как я зашла.', 'Спасибо за работу, представляю сколько через вас людей проходит.'],
  objections: ['В смысле нет?! Алиса, то есть я — вот она, приложение передо мной, и там написано „в пункте“! Как так-то?', 'Погодите-погодите. Вы шутите? Я ради этого заказа с другого конца района ехала!', 'То есть как это „сегодня без выдачи“? Вы издеваетесь? У меня уведомление висит с утра!', 'Серьёзно? Давайте ещё раз поищем, ну не может же он испариться из базы!'],
  refuseLines: ['Нет. Сегодня без выдачи.', 'Отказываю. Без объяснения причин.', 'Не положено. Приходите в другой раз.', 'Нет — и точка. Такие правила.'],
  silentNotes: ['Вы молча развернулись и пошли к стеллажам. Алиса пожала плечами и продолжила листать ленту в телефоне.', 'Не говоря ни слова, вы отправились на поиски коробки. Она проводила вас взглядом, не выпуская смартфон из пальцев.', 'Вы направились к полкам. В тишине раздавался лишь тихий стук её пальцев по экрану телефона.'],
  thoughts: [
    'Я мог бы выдать коробку сразу и не портить человеку день. Но иногда так забавно наблюдать за искренним удивлением, которое тут же улетит в соцсети.',
    'Она выглядела так, будто заказывает по три посылки в день. Отказать такой — всё равно что отключить интернет посреди сериала.',
    'В её глазах читалось легкое недоумение: как это система дала сбой у такой милой девушки? Но порядок есть порядок.',
    'Иногда мне кажется, что смартфоны стали продолжением их рук. Даже спорить с нами они продолжают, глядя в экраны.'
  ],
  talkThoughts: [
    'Она говорит и одновременно листает ленту. Кажется, это у них давно один процесс.',
    'Приветливая, лёгкая, без претензий. С такими смена идёт быстрее.',
    'Ей явно не терпится распаковать заказ прямо у стойки.'
  ],
  refuseThoughts: [
    'Она выглядела так, будто заказывает по три посылки в день. Отказать такой — всё равно что отключить интернет посреди сериала.',
    'Она даже не сразу поверила в отказ — привыкла, что всё работает.',
    'Я сказал «нет» и понял, что через час это «нет» будет в чьей-то ленте.'
  ],
  hardEnds: [
    {v: 'Ну вы блин даете… Всё, пишу в чат поддержки и влеплю вам единицу! Больше ни ногой сюда.', n: 'Единица в рейтинг. Классика молодёжного гнева. Пальцы по клавиатуре забегали с пулемётной скоростью.', out: 'Алиса вышла из пункта, яростно стуча клавишами смартфона. Оценка в приложении явно пробила дно.'},
    {v: 'Капец сервис. Серьёзно, худший пункт из всех, где я была. Пойду в соседний заказывать!', n: '«В соседний пункт». Который в трех километрах отсюда. Ну-ну.', out: 'Она демонстративно надела наушники и вылетела из двери, хлопнув ею на прощание.'},
    {v: 'Это просто треш. Вы специально людей бесите или у вас это в должностной инструкции написано?', n: 'Должностная инструкция по бесячим выдачам. Звучит как отличный стартап.', out: 'Ушла со злобным видом, продолжая строчить гневный пост в сторис.'},
    {v: 'Ладно, я запомнила. Можете не улыбаться — отзывы я умею писать шедевральные.', n: 'Шедевральные отзывы. Предвкушаю литературный шедевр про мою профнепригодность.', out: 'Алиса ушла, оставив за собой шлейф молодёжного недовольства и громкий вздох.'},
    {v: 'Ну и ладно! Закажу в другом месте, благо выбор сейчас огромный. До свидания!', n: '«Выбор огромный». И то верно. Но осадочек у неё остался знатный.', out: 'Хлопнула дверью так резко, что колокольчик на косяке поперхнулся от неожиданности.'}
  ],
  giveEnds: [
    {v: 'Ура! Спасибо огромное, а то я уже испугалась, что потерялось.', n: 'Она убрала телефон и уже расчистила руки под коробку. Осталось её принести.'},
    {v: 'Спасибо! Вы спасли мой вечер, я как раз распаковку планировала снять.', n: 'Распаковка для сторис спасена. Миссия выполнена.'},
    {v: 'Спасибки! С меня сердечко в приложении. Хорошей смены!', n: '«Сердечко в приложении». Мелочь, а рейтинг поднялся.'}
  ],
  refuseFollow: {
    hard: ['Я сказал нет. И обсуждения тут излишни.', 'Решение окончательное. Можешь идти.', 'Правила есть правила. Ничем помочь не могу.'],
    give: ['Ладно, держи. Только больше без этих сцен.', 'Так и быть, забирай свою коробку. И удачи.', 'Держи заказ. И хорошего вечера.']
  },
  lostSearch: ['Я прошёлся по ячейкам дважды. Для её заказа место на полке оказалось пустым.', 'В базе значится, а на стеллаже шаром покати. Классический призрак пропавшей посылки.', 'Я перерыл весь сектор. Коробки с этим номером нигде не было.'],
  lostReactions: ['В смысле нет?! У меня трек-номер в телефоне светится зелёным!', 'Вы шутите? Я специально ради этой посылки с учебы отпросилась!', 'Как это пропала? Вы же сотрудник, найдите её где хотите!', 'Это издевательство… И что мне теперь подруге говорить?'],
  lostThoughts: ['Её расстроенный взгляд в экран телефона бил сильнее любых скандалов.', 'Потерять долгожданную посылку молодой девчонки перед выходными — кармический грех.', 'Мне стало даже немного стыдно за эту пропажу.'],
  lostFollow: {
    sorry: ['Прошу прощения, моя вина на приёмке. Завтра с утра первым делом отыщем и выдадим.', 'Извините, накладка на складе. К утру разберёмся и всё будет на месте.', 'Виноват. Ошиблись при разборе коробок, завтра точно всё выдадим.'],
    cold: ['Заказа нет на пункте. Ничем не могу помочь.', 'Не приняли — значит потерялся на логистике. Оформляйте возврат.', 'Ищите на другом складе или ждите пересортицы.']
  },
  lostEnds: {
    sorry: [
      {v: 'Ладно… Главное, чтобы к завтрашнему дню нашлось. Жду.', n: 'Обещание разобраться немного сгладило углы, но осадок остался.', out: 'Алиса вздохнула, убрала телефон в карман и вышла из пункта.'},
      {v: 'Ну ладно, верю на слово. Завтра после пары загляну!', n: '«После пары загляну». Жду с замиранием сердца и новой ревизией.', out: 'Она упорхнула, оставив меня наедине с пустыми полками.'},
      {v: 'Хорошо, буду надеяться на вашу честность. До завтра!', n: 'Честность — наше всё. Особенно когда посылки исчезают в никуда.', out: 'Дверь за ней закрылась, а я остался думать, где искать концы.'}
    ],
    cold: [
      {v: 'Ну и капец у вас сервис! Больше никогда сюда ничего не закажу!', n: 'Предсказуемая бурная реакция на холодный отказ.', out: 'Алиса развернулась и вылетела из пункта, хлопнув дверью.'},
      {v: 'Прекрасно просто! Придётся перезаказывать в другом месте втридорога.', n: 'Втридорога и дольше — зато без нервотрёпки с нами.', out: 'Ушла быстрым шагом, сердито дёрнув капюшон худи.'},
      {v: 'Ясно всё с вами. Поставлю вам заслуженный минус везде, где можно.', n: 'Заслуженный минус. Моя карьера сотрудника ПВЗ трещит по швам.', out: 'Хлопнула дверью с такой силой, что со стены чуть не упал плакат акции.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give'},
    {icon: '💬', label: 'Поддержать диалог', hint: 'Спросить, что заказал', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Причин не будет', act: 'refuse'}
  ]
};


// === ПЕРСОНАЖ: ЯРКАЯ ДЕВУШКА-ПОДРОСТОК ===
const VISITOR_TEEN_GIRL_IMG = 'assets/visitor-teen-girl.webp';
const VISITOR_TEEN_GIRL = {
  id: 'teen_girl', name: 'Мила', male: false, img: VISITOR_TEEN_GIRL_IMG,
  intros: [
    'Дверь распахнулась под звонкий звонок колокольчика. В пункт вприпрыжку влетела яркая девушка с цветными прядями в волосах, звеня фенечками на руках.',
    'В пункт зашла девчонка в оранжевой футболке и с яркими заколками. Уверенно держа в руке телефон в цветастом чехле, она жизнерадостно улыбнулась.',
    'Колокольчик звякнул, и у стойки появилась девушка-подросток с крутой прической и кучей браслетов. На ходу листая что-то в смартфоне, она подошла к прилавку.',
    'Влетела яркая девушка с цветными прядями, в полосатых рукавах и с сияющими глазами. Окинув пункт взглядом, она выставила вперёд телефон с QR-кодом.'
  ],
  greeting: 'Хай! Я за посылочкой, там самое долгожданное!',
  questions: ['Что за крутую штуку заказала?', 'Признавайся, что в коробке?', 'Опять мерч или косметика?', 'Что там ехало из интернет-магазина?', 'Покажете, что в коробке? Я жду!'],
  chatter: ['Я этот заказ ждала целую вечность! То есть три дня, но для меня это вечность.', 'У вас тут так эстетично, я бы тут фотосет устроила!', 'Мне трек-номер каждые пять минут приходил, я изнервничалась вся.', 'Спасибо за работу! Вы самый лучший сотрудник пункта эвер!', 'Тут такая погода классная, а я за посылкой побежала — и не зря!'],
  objections: ['В смысле нет?! Вы серьёзно?! Да у меня в приложении горит „доставлено“, я специально ради этого на скейте летела!', 'Эээ, погодите! Как это не выдадите? Вы шутите так неудачно, да?', 'То есть как — никаких выдач?! Вы что, её так и оставите на полке? Отдайте мой заказ, пожалуйста, мне очень надо!', 'Это какая-то ошибка! Перепроверьте, ну посмотрите внимательнее на экран!'],
  refuseLines: ['Неа. Сегодня без выдачи.', 'Отказываю. Без объяснения причин.', 'Никаких выдач. Правила такие.', 'Нет и всё. И даже не уговаривай.'],
  silentNotes: ['Вы молча кивнули и пошли к полкам. Мила обиженно надула губки и застучала ногтями по чехлу телефона.', 'Без лишних слов вы направились искать коробку. Она проводила вас удивленным и расстроенным взглядом.', 'Вы повернулись к стеллажам. В тишине пункта звякнули её многочисленные фенечки.'],
  thoughts: [
    'Она выглядела так, будто ей только что отменили самый главный концерт года. Отказывать подросткам — всегда мини-драма.',
    'Я чувствовал себя злодеем из мультика, который отобрал у ребенка конфету. Но игра есть игра.',
    'Интересно, через сколько минут после выхода она запишет гневно-грустный тикток про наш пункт?',
    'В её возрасте отсутствие посылки — это трагедия шекспировского масштаба. Держись, Мила.'
  ],
  talkThoughts: [
    'Скейт у стены, наушники на шее. Ждать она умеет ровно две минуты.',
    'Для неё эта коробка — событие дня. Приятно быть частью события.',
    'Она говорит быстро и вся в предвкушении. Не буду тянуть.'
  ],
  refuseThoughts: [
    'Она выглядела так, будто ей только что отменили самый главный концерт года. Отказывать подросткам — всегда мини-драма.',
    'Я чувствовал себя злодеем из мультика, который отобрал у ребенка конфету. Но игра есть игра.',
    'В её возрасте отказ — трагедия шекспировского масштаба. И устроил её я.'
  ],
  hardEnds: [
    {v: 'Всё, это краш! Больше сюда ни ногой, я всем друзьям расскажу, какие вы злые!', n: '«Краш» и «злые». Репутация пункта среди школьников стремительно летит в пропасть.', out: 'Мила развернулась и вылетела из пункта, обиженно звеня браслетами.'},
    {v: 'Ужас просто! Я напишу жалобу везде, где можно, и в поддержку, и в соцсетях!', n: 'Соцсети и поддержка. Страшная сила современного поколения.', out: 'Ушла со слезами на глазах и с гордо поднятой головой, хлопая дверью.'},
    {v: 'Ну и капец… Вы разрушили все мои планы на вечер! Ненавижу!', n: 'Разрушенные планы на вечер. Звучит трагично.', out: 'Хлопнула дверью так резко, что колокольчик жалобно звякнул и замолк.'},
    {v: 'Ладно, вы победили. Но карма вам за это вернётся, честно-честно!', n: 'Кармическая месть от подростка в фенечках. Надо срочно завязывать с плохим настроением.', out: 'Ушла, показывая в сторону двери шутливую «фигу» в кармане худи.'},
    {v: 'Худший пункт доставки в мире! Поставь ноль баллов, если бы можно было!', n: 'Ноль баллов из пяти. Шкала оценок пала смертью храбрых.', out: 'Быстро зашагала прочь, яростно сжимая в руке свой цветастый смартфон.'}
  ],
  giveEnds: [
    {v: 'Урааа! Спасибочки! Вы лучший, я вас обожаю!', n: 'Радости было столько, будто она выиграла в лотерею.'},
    {v: 'Йехуу! Побежала распаковывать в сторис! Хорошего дня!', n: 'Она подпрыгнула на месте и зазвенела браслетами. Теперь дело за коробкой.'},
    {v: 'Спасибки огромное! Вы супер! Держите мысленное сердечко!', n: 'Мысленное сердечко получено. Настроение у неё сразу взлетело до небес.'}
  ],
  refuseFollow: {
    hard: ['Я сказал нет. И точка.', 'Никаких обсуждений. Заказ не выдается.', 'Правила есть правила. Иди домой.'],
    give: ['Ладно, забирай свою коробку. Только не шуми.', 'Так и быть, держи. И больше не капризничай.', 'Хорошо, держи заказ. И улыбнись!']
  },
  lostSearch: ['Я перекопал весь стеллаж дважды. Для её заветной коробочки места не нашлось.', 'В накладной товар есть, а на полке — пустой воздух. Посылка испарилась.', 'Я облазил каждую ячейку в секторе. Увы, её заказа там не было.'],
  lostReactions: ['В смысле нет?! Как пропала?! Я же на неё весь месяц копила!', 'Вы шутите? Скажите, что это шутка! Где моя посылка?!', 'Я не уйду отсюда, пока вы её не найдете! Это мой долгожданный заказ!', 'Это просто катастрофа… И что мне теперь делать без неё?'],
  lostThoughts: ['Смотреть на её расстроенное лицо было тяжелее всего. Подростковые ожидания рушатся мгновенно.', 'Потерять посылку, которую кто-то ждал целый месяц — худшее завершение смены.', 'Мне искренне захотелось самому побежать на склад и найти эту несчастную коробку.'],
  lostFollow: {
    sorry: ['Прошу прощения, мой косяк на приёмке. Завтра с утра первым делом всё отыщем.', 'Извините, накладка на складе. К утру разберёмся и выдадим в лучшем виде.', 'Виноват. Перепутали коробки при разборе, завтра точно всё будет у нас.'],
    cold: ['Заказа нет на пункте. Ничего не поделаешь.', 'Не приняли на склад — значит утерян. Оформляй возврат денег.', 'Ищи в другом месте или жди новую доставку.']
  },
  lostEnds: {
    sorry: [
      {v: 'Ладно… Главное, чтобы к завтрашнему дню точно нашлось. Я приду!', n: 'Обещание исправить ошибку немного успокоило её бурю эмоций.', out: 'Мила вздохнула, поправила заколки и грустно вышла из пункта.'},
      {v: 'Ну ладно, верю вам! Завтра сразу после школы загляну, ждите!', n: 'Школьное расписание теперь включает проверку нашего ПВЗ.', out: 'Она выбежала на улицу, оставив за собой звон фенечек и легкую грусть.'},
      {v: 'Хорошо… Буду ждать звонка или смс. Пожалуйста, найдите!', n: '«Пожалуйста, найдите». После таких слов хочется стараться вдвойне.', out: 'Дверь тихо закрылась за ней.'}
    ],
    cold: [
      {v: 'Вы бессердечные! Больше никогда сюда ничего не закажу!', n: 'Буря и натиск. Подростковый максимализм во всей красе.', out: 'Мила смахнула слезинку и выбежала из пункта, громко хлопнув дверью.'},
      {v: 'Это просто кошмар! Вы испортили мне весь день!', n: 'Испорченный день. И моя совесть вместе с ним.', out: 'Ушла, яростно звякнув браслетами и оставив меня в тишине.'},
      {v: 'Ненавижу этот пункт! Больше вы меня тут не увидите!', n: '«Больше не увидите». До следующего дешевого товара на распродаже.', out: 'Хлопнула дверью с такой силой, что на секунду заложило уши.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give'},
    {icon: '💬', label: 'Поддержать диалог', hint: 'Спросить, что заказал', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Причин не будет', act: 'refuse'}
  ]
};


// === ПЕРСОНАЖ: БАБУШКА ===
const VISITOR_GRANNY_IMG = 'assets/visitor-granny.webp';
const VISITOR_GRANNY = {
  id: 'granny', name: 'Нина Павловна', male: false, img: VISITOR_GRANNY_IMG,
  intros: [
    'Дверь аккуратно приоткрылась, впуская в пункт приятную седую бабушку в цветастом платке и аккуратных очках. Опираясь на тросточку, она тепло улыбнулась.',
    'В пункт зашла пожилая женщина в уютной вязаной кофте. Достав из аккуратной сумочки бумажку с распечаткой кода, она подошла к стойке.',
    'Колокольчик над дверью звякнул тихо, будто из уважения. Вошла бабушка Нина Павловна, поправляя платок и доброжелательно глядя на меня поверх очков.',
    'Дверь затворилась, и у прилавка появилась женщина в годах, с доброй улыбкой и пакетиком для покупок в руке.'
  ],
  greeting: 'Здравствуйте, милок! Помоги бабушке заказ получить, внук мне всё в этом телефоне оформил.',
  questions: ['Что за полезную вещь вы заказали?', 'Для внуков или для дома — что в коробке?', 'Что там у вас в коробочке, Нина Павловна?', 'Расскажете, что за покупка?', 'К зиме что заказали или по мелочи?'],
  chatter: ['Молодёжь сейчас вся в гаджетах, а я вот тоже освоила — удобно-то как, из дома выходить не надо!', 'У внука день рождения на носу, вот заказала сюрприз, лишь бы угадать.', 'У вас в пункте так чистенько, порядок прямо как в аптеке!', 'Спасибо вам, сынок, за работу. Труд у вас тяжёлый, на ногах целый день.', 'Погода сегодня чудесная, солнышко светит — самое время погулять.'],
  objections: ['Как же нет, сынок?! Да внук мне чётко сказал — „Бабушка, всё на месте, иди забирай“! Поищи получше, родной.', 'Погоди-погоди, как это не выдашь? Я же специально с другого конца улицы шла, у меня ножки болят!', 'Ты что, милок, шутишь со старой? Вот бумажка с кодом, тут чёрным по белому написано!', 'Не может такого быть, чтобы не было! Внук три раза перепроверял!'],
  refuseLines: ['Ох, милок, без выдачи сегодня. Такие порядки.', 'Не положено, внучок. Придётся в другой раз прийти.', 'Нет уж, сегодня не выдам. Правила есть правила.', 'Не могу выдать, голубчик. Несите другие бумаги.'],
  silentNotes: ['Вы молча кивнули и отправились искать коробку. Нина Павловна терпеливо сложила руки на сумочке и стала ждать.', 'Без лишних слов вы пошли к стеллажам. База тихо гудела, а бабушка тихонько вздохнула.', 'Вы направились к полкам. Она стояла у стойки, ласково глядя вам вслед.'],
  thoughts: [
    'Отказывать пожилому человеку — это настоящее испытание на прочность совести. Смотреть в эти добрые глаза и говорить «нет» было почти физически больно.',
    'Она выглядела точь-в-точь как моя собственная бабушка. Сделать ей замечание или отказать казалось кощунством, но правила смены есть правила.',
    'Я чувствовал себя последним мерзавцем. Как можно было отказать человеку, который пришёл с такой светлой улыбкой?',
    'В такие моменты понимаешь, что работа в ПВЗ — это не просто коробки, это судьбы людей, которые приходят сюда за маленькой радостью.'
  ],
  talkThoughts: [
    'С ней разговариваешь — и смена как будто теплеет.',
    'Ей важна не только коробка, но и то, что её выслушали.',
    'Такие посетители приходят не спорить, а по-человечески поговорить.'
  ],
  refuseThoughts: [
    'Отказывать пожилому человеку — это настоящее испытание на прочность совести. Смотреть в эти добрые глаза и говорить «нет» было почти физически больно.',
    'Она выглядела точь-в-точь как моя собственная бабушка. Сделать ей замечание или отказать казалось кощунством, но правила смены есть правила.',
    'Я чувствовал себя последним мерзавцем. Как можно было отказать человеку, который пришёл с такой светлой улыбкой?'
  ],
  hardEnds: [
    {v: 'Ну ладно, сынок… Не расстраивай меня, да ладно уж, пойду домой. Пожалуюсь внуку, он разберется!', n: 'Пожаловаться внуку. Звучит как мягкая угроза от хакера-старшеклассника, который положит нашу базу за пять минут.', out: 'Нина Павловна тяжело вздохнула, опираясь на палочку, и медленно направилась к выходу.'},
    {v: 'Эх, молодёжь… Никакого уважения к старости. Пойду в другой пункт, там добрее работают.', n: '«В другой пункт». Который через три квартала. Мне стало ужасно стыдно перед ней.', out: 'Она покачала головой и аккуратно прикрыла за собой дверь.'},
    {v: 'Ну что за порядки пошли… Раньше такого не было. Ладно, не буду ругаться, здоровье дороже.', n: 'Здоровье дороже. И тут она абсолютно права. А моя совесть осталась где-то под плинтусом.', out: 'Ушла со спокойным достоинством, оставив меня наедине с тяжёлым осадком на душе.'},
    {v: 'Ишь ты, правила у них… Ладно, внук придет — он вам тут устроит проверки!', n: 'Внук-прокурор или внук-программист. Оба варианта сулили неприятности.', out: 'Нина Павловна строго посмотрела на меня поверх очков и потихоньку вышла на улицу.'},
    {v: 'Обижаешь старушку, сынок. Нехорошо. Бог тебе судья.', n: '«Бог тебе судья». После этой фразы хотелось немедленно уволиться и уйти в монастырь.', out: 'Дверь за ней закрылась тихо-тихо, будто уходящий упрёк.'}
  ],
  giveEnds: [
    {v: 'Спаси тебя бог, сынок! Здоровья тебе крепкого и зарплаты хорошей!', n: 'Бабушка тепло улыбнулась, перекрестила меня на прощание и счастливая пошла домой.'},
    {v: 'Спасибо огромное, голубчик! Внук будет рад, и чай попьем с пирогами!', n: 'На душе сразу стало теплее. Ради таких моментов и стоит работать.'},
    {v: 'Ну надо же, какая красота! Спасибо тебе, золотой человек, век буду молиться!', n: '«Век буду молиться». Кажется, карма ПВЗ сегодня пополнилась на сотню очков.'}
  ],
  refuseFollow: {
    hard: ['Простите, Нина Павловна, но правила едины для всех.', 'Ничем не могу помочь, таковы инструкции свыше.', 'Увы, бабушка, сегодня никак. Приходите завтра.'],
    give: ['Ладно, давайте ваш код, выдам коробку. Не обижайтесь.', 'Погодите, сейчас поищу получше. Вот ваш заказ, держите.', 'Специально для вас нашёл. Забирайте, здоровья вам!']
  },
  lostSearch: ['Я облазил каждую полку трижды. Для заказа Нины Павловны ячейка пуста.', 'В накладной значится, а на стеллаже ничего нет. Куда делась посылка — загадка.', 'Я пересмотрел весь склад по этому номеру. Увы, коробку не привезли.'],
  lostReactions: ['Как же нет, родной? Внук же говорил — всё погрузили, всё едет!', 'Ох ты ж ты… И что же мне теперь внуку сказать? Он так ждал подарок…', 'Сынок, поищи получше, может, на нижней полке завалялась?', 'Беда какая… Я ведь специально пришла, а теперь возвращаться ни с чем?'],
  lostThoughts: ['Смотреть на её расстроенное лицо было невыносимо. Хотелось провалиться сквозь землю.', 'Потерять бабушкин заказ — это абсолютное дно смены. Никакие деньги за смену этого не искупят.', 'Мне было до слёз стыдно перед ней. Самый тяжёлый момент в работе ПВЗ.'],
  lostFollow: {
    sorry: ['Прошу прощения, бабушка. Моя вина на приёмке. Завтра найдём!', 'Нина Павловна, милая, простите. Накладка на складе. К утру всё разыщем!', 'Виноват я, молодой балбес. Завтра первым делом найдём посылку!'],
    cold: ['Заказа нет на складе. Ничего поделать не могу.', 'Не приняли посылку — значит, привезут в следующий раз.', 'Обращайтесь в поддержку приложения, я здесь бессилен.']
  },
  lostEnds: {
    sorry: [
      {v: 'Ну ничего, сынок, всякое бывает… Главное, чтобы нашёлся к выходным. Жду.', n: 'Она простила меня быстрее, чем я сам себя. От этого стало ещё стыднее.', out: 'Нина Павловна вздохнула, опираясь на палочку, и тихо вышла из пункта.'},
      {v: 'Ладно, внучок, не переживай так, лицо вон совсем побледнело. Завтра зайду!', n: 'Она ещё и меня успокаивала! Святой человек.', out: 'Медленно и аккуратно прикрыла за собой дверь.'},
      {v: 'Хорошо, родной. Ты главное поищи хорошенько, я ведь старая, мне трудно ходить.', n: 'После этих слов я был готов сам пешком идти на центральный склад за её коробкой.', out: 'Дверь тихонько скрипнула на прощание.'}
    ],
    cold: [
      {v: 'Эх… Бессердечные вы все стали. Никакого сочувствия к пожилым людям.', n: 'Справедливый упрёк. Я заслужил каждое её слово.', out: 'Она молча развернулась и пошла к выходу, понурив голову.'},
      {v: 'Ну и ладно, внук мне в другом месте купит. А вам за чёрствость минус в карму.', n: 'Минус в карму похлеще любого рейтинга на площадке.', out: 'Ушла медленно и гордо, оставив меня наедине с тяжёлым чувством вины.'},
      {v: 'Горькое у вас обслуживание… Будь здоров, сынок, больше не приду.', n: '«Больше не приду». Самые страшные слова в устах бабушки.', out: 'Дверь закрылась. В пункте повисла звенящая тишина.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give'},
    {icon: '💬', label: 'Поговорить с бабушкой', hint: 'Улыбнуться, спросить о внуках', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};


// === ПЕРСОНАЖ: ДЕДУШКА ===
// === ПЕРСОНАЖ: ВТОРАЯ БАБУШКА (В ХАЛАТЕ) ===
const VISITOR_GRANNY2_IMG = 'assets/visitor-granny2.webp';
const VISITOR_GRANNY2 = {
  id: 'granny2', name: 'Анна Сергеевна', male: false, img: VISITOR_GRANNY2_IMG,
  intros: [
    'Дверь тихонько приоткрылась, и в пункт заглянула милая бабушка в домашнем уютном халате и с пушистыми седыми кудрями. С мягкой улыбкой она прошла к стойке.',
    'В пункт вошла Анна Сергеевна, поправляя воротник халата. Вид у нее был по-домашнему спокойный и доброжелательный.',
    'Колокольчик звякнул. Вошла пожилая женщина с добрыми глазами и аккуратной прической, держа в руках сумочку с номерком заказа.',
    'Дверь впустила бабушку в мягком халате и с доброй улыбкой. Оперевшись на стойку, она ласково посмотрела на меня.'
  ],
  greeting: 'Здравствуй, внучек! Я тут рядышком живу, решила в халате добежать за своим заказом.',
  questions: ['Что за полезную вещицу выписали, Анна Сергеевна?', 'Для дома или для души — что за покупка?', 'Что там у вас в коробочке притаилось?', 'Расскажете, что за покупка?', 'К чаю заказали или в хозяйстве пригодится?'],
  chatter: ['Я телевизор не смотрю, а вот в интернет заглядываю — столько всего интересного придумали!', 'Соседка подсказала заказать, говорит, в нашем возрасте без этого никак.', 'У вас в пункте так уютно, прям как дома у камина.', 'Спасибо за заботу, сынок. Сейчас молодёжь занятая, а ты всегда выслушаешь.', 'Погода сегодня благодать, я в халате добежала и не замёрзла вовсе!'],
  objections: ['Как же нету, солнышко? Да у меня в телефоне черным по белому написано — выдача в пункте. Поищи получше!', 'Погоди-погоди, милый. Как это не выдашь? Я же специально из дома в халате выскочила!', 'Да как же так? Внучка из другого города заказ оформила, неужто затерялся?', 'Не пугай старушку, сынок! Посмотри на нижней полочке, может, запрятался куда.'],
  refuseLines: ['Ох, милая, без выдачи сегодня. Такие правила.', 'Не положено, голубчик. Придётся завтра заглянуть.', 'Нет уж, сегодня никак. Инструкция не позволяет.', 'Не могу выдать, сынок. Порядки есть порядки.'],
  silentNotes: [
    'Вы молча кивнули и направились к полкам. Анна Сергеевна терпеливо сложила руки на поясе халата и стала ждать.',
    'Без лишних слов вы пошли искать коробку. Она проводила вас теплым, понимающим взглядом.',
    'Вы повернулись к стеллажам. В тишине пункта раздавался лишь мягкий шелест её домашней одежды.'
  ],
  thoughts: [
    'Она пахла домашними пирогами и ванилью. Отказать такой бабушке — настоящее испытание для совести.',
    'В её глазах не было ни капли злости — только светлая грусть. От этого отказывать становилось ещё тяжелее.',
    'Я чувствовал себя ужасно. Как можно расстраивать человека, который вышел в халате за своей посылкой?',
    'Старички приходят в пункт не за коробками — они приходят за капелькой внимания. И я только что его забрал.'
  ],
  talkThoughts: [
    'От неё пахнет пирогами, и в пункте становится уютнее.',
    'Она никуда не торопится, и от этого спокойно даже мне.',
    'Пара тёплых слов ей нужна не меньше, чем сама посылка.'
  ],
  refuseThoughts: [
    'Она пахла домашними пирогами и ванилью. Отказать такой бабушке — настоящее испытание для совести.',
    'В её глазах не было ни капли злости — только светлая грусть. От этого отказывать становилось ещё тяжелее.',
    'Отказать человеку, который вышел за посылкой в домашнем халате, — сомнительное достижение.'
  ],
  hardEnds: [
    {v: 'Эх, сынок… Ну ладно, не буду тебя волновать. Пойду чай пить с вареньем, авось завтра повезет.', n: 'Чай с вареньем как лекарство от всех бед. Мудрая женщина.', out: 'Анна Сергеевна ласково улыбнулась, покачала головой и тихонько направилась к выходу.'},
    {v: 'Ну и ладно, милый. Здоровье дороже всяких посылок. Попрошу внучку, она перезакажет.', n: 'Внучка выручит. Но осадок на душе остался тяжёлый.', out: 'Она аккуратно прикрыла за собой дверь, оставив после себя лёгкий шлейф уюта.'},
    {v: 'Обижаешь бабушку, сынок… Ну да ладно, бог тебе судья. Всего хорошего!', n: 'Снова упрёк. Эта фраза ранила сильнее любого крика.', out: 'Медленно и с достоинством пошла домой.'},
    {v: 'Ладно-ладно, не буду ругаться. Но порядок у вас тут хромает, сынок, ох хромает!', n: 'Порядок хромает. И не поспоришь же.', out: 'Дверь за ней закрылась мягко, без единого звука.'},
    {v: 'Ну что поделать, раз правила такие… Пойду в тапках до дома, пока не похолодало.', n: 'В тапках до дома. Она ведь реально в халате и тапках пришла!', out: 'Шурша тапочками, бабушка тихонько вышла на улицу.'}
  ],
  giveEnds: [
    {v: 'Спаси тебя господь, сынок! Будь здоров и счастлив!', n: 'Она заулыбалась и приготовила сумку под заветную коробочку.'},
    {v: 'Спасибо огромное, милый! Наконец-то дождалась моя душа радости.', n: 'На душе сразу стало теплее. Прекрасный выдался момент.'},
    {v: 'Ну какая же ты умница… то есть молодец! Спасибо тебе большое!', n: 'Она сложила ладони, будто уже держит коробку как самое дорогое сокровище.'}
  ],
  refuseFollow: {
    hard: ['Извините, Анна Сергеевна, но сегодня никак не могу выдать.', 'Правила есть правила, бабушка. Ничего не поделаешь.', 'Увы, порядок есть порядок. Приходите завтра с утра.'],
    give: ['Ладно, давайте ваш код, выдам коробку. Не расстраивайтесь.', 'Погодите, сейчас поищу повнимательнее. Вот ваш заказ, держите!', 'Специально для вас нашёл. Забирайте, на здоровье!']
  },
  lostSearch: ['Я пересмотрел весь стеллаж. Для заказа Анны Сергеевны ячейка пуста.', 'В базе числится, а на полке пустота. Посылка куда-то запропастилась.', 'Я обыскал весь сектор по этому номеру. Увы, коробки нет.'],
  lostReactions: ['Как же так, родной? Внучка говорила — всё отправлено, всё в пункте…', 'Ох ты ж ты… И что мне теперь делать? Я ведь так ждала эту вещь дома.', 'Сынок, может, на складе в машине ещё не разобрали? Поищи ещё разок!', 'Беда какая… Ну да ничего, главное, чтобы ты сам не хворал.'],
  lostThoughts: [
    'Она даже не ругалась — только сокрушённо покачала головой. От этого прощения было ещё стыднее.',
    'Потерять посылку у такой мягкой и доброй бабушки — просто верх профнепригодности.',
    'Хотелось бросить всё, пойти на центральный склад и лично найти её заветную коробку.'
  ],
  lostFollow: {
    sorry: ['Виноват, Анна Сергеевна. Моя ошибка при приёмке. Завтра с утра первыми найдём!', 'Простите меня, бабушка. Накладка на складе. Обязательно всё разыщем к утру!', 'Моя недоработка. Обещаю, завтра лично вручу вам посылку!'],
    cold: ['Заказа нет на складе. Ничем помочь не могу.', 'Не приняли на приёмке — значит утеряно в логистике. Оформляйте возврат.', 'Обращайтесь в поддержку приложения, я здесь отвечаю только за полки.']
  },
  lostEnds: {
    sorry: [
      {v: 'Ну ничего, милый, не переживай. Всякое в жизни бывает, главное — живы-здоровы.', n: 'Она опять меня утешила. Удивительной доброты человек.', out: 'Анна Сергеевна тихонько улыбнулась и пошла домой в своих домашних тапках.'},
      {v: 'Добро, сынок. Завтра так завтра, я никуда не спешу, на пенсии вечность впереди.', n: '«Вечность впереди». Контраст с нашими бешеными буднями ПВЗ.', out: 'Медленно и спокойно направилась к выходу.'},
      {v: 'Хорошо, родной. Ты главное найди, я ведь для дома заказывала.', n: 'Обещание дано, теперь надо кровь из носу разыскать коробку.', out: 'Дверь мягко закрылась за ней.'}
    ],
    cold: [
      {v: 'Эх, сурово у вас… Ну да ладно, переживу и без этого заказа.', n: 'Холодный ответ на её доброту резал без ножа.', out: 'Покачала головой и молча вышла на улицу.'},
      {v: 'Ну и ладно, милый. Не велика беда, лишь бы мирное небо над головой было.', n: 'Философия человека, прошедшего через многое. Наши проблемы с ПВЗ показались такой мелочью.', out: 'Ушла не спеша, оставив меня наедине с пустыми полками.'},
      {v: 'Печально всё это… Ну да бог вам судья, сынок. До свидания.', n: 'Ещё один тяжёлый упрёк в копилку смены.', out: 'Дверь закрылась. В пункте повисла звенящая тишина.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give'},
    {icon: '💬', label: 'Поговорить с бабушкой', hint: 'Поговорить о жизни, выпить чаю', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};

const VISITOR_GRANDPA_IMG = 'assets/visitor-grandpa.webp';
const VISITOR_GRANDPA = {
  id: 'grandpa', name: 'Иван Петрович', male: true, img: VISITOR_GRANDPA_IMG,
  intros: [
    'Дверь приоткрылась, и в пункт неторопливо вошёл интеллигентный дедушка в очках и с аккуратной седой бородой. Окинув помещение добрым взглядом, он подошел к стойке.',
    'В пункт вошёл пожилой мужчина в зелёном кардигане, уверенно держа в руках кнопочный телефон с распечаткой заказа. Приветливо кивнув мне, он встал у прилавка.',
    'Колокольчик над дверью звякнул. Вошёл Иван Петрович, поправил очки на носу и с улыбкой положил на стойку номерок заказа.',
    'Дверь впустила дедушку в очках с благородной сединой. Оперевшись на трость, он спокойно и терпеливо дождался, пока я освобожусь.'
  ],
  greeting: 'Здравия желаю! Принимай старшего по званию, пришёл за заказом.',
  questions: ['Что полезное выписали, Иван Петрович?', 'Для гаража или для сада-огорода — что в коробке?', 'Что там за посылка для вас приехала?', 'Расскажете, что за вещица в коробке?', 'Опять инструмент или на рыбалку?'],
  chatter: ['Я на пенсии, но сидеть без дела не привык — вечно что-то мастерю или чиню.', 'Внук помог на компьютере заказ оформить, а я потом по смскам отслеживал.', 'У вас тут порядок правильный, армейский. Уважаю дисциплину!', 'Спасибо за труд, сынок. Раньше за всем на почту в очереди стояли, а сейчас вон как удобно.', 'Погода нынче благодать, прогулялся до вас с удовольствием.'],
  objections: ['В смысле — нет в базе? Иван Петрович зря ходить не станет, сынок! Перепроверь-ка хорошенько.', 'Как это не выдашь? У меня и смска пришла, и внук квитанцию распечатал. Давай-ка поищем вместе.', 'Погоди-погоди, молодой человек. То есть как это „нет“? Ошибаешься, голубчик.', 'Так дело не пойдет. Я человек старой закалки, порядок должен быть во всем!'],
  refuseLines: ['Нет, Иван Петрович. Сегодня не выдадим.', 'Отказываю. Правила есть правила.', 'Не положено сегодня. Приходите завтра.', 'Нет — и точка. Инструкция не позволяет.'],
  silentNotes: ['Вы молча кивнули и пошли к стеллажам. Иван Петрович скрестил руки на груди и стал ждать с выдержкой старого солдата.', 'Без лишних слов вы направились искать коробку. Он проводил вас спокойным, рассудительным взглядом.', 'Вы повернулись к полкам. В тишине пункта раздавался лишь ваш уверенный шаг.'],
  thoughts: [
    'Он смотрел на меня с таким спокойным достоинством, что отказывать ему было совестно вдвойне. Никакого крика — только железобетонная уверенность.',
    'В его глазах читалась мудрость человека, который повидал в жизни куда больше, чем наши смены в ПВЗ. Старая советская школа.',
    'Я чувствовал себя кадетом, которого застал строгий полковник. Но отступать от правил было нельзя.',
    'Иногда старики умеют посмотреть так, что сразу чувствуешь себя мелким нарушителем дисциплины. Иван Петрович был как раз из таких.'
  ],
  talkThoughts: [
    'Держится ровно, говорит по существу. С ним легко.',
    'Старая школа: пришёл, поздоровался, назвал номер заказа.',
    'Такому человеку хочется выдать коробку быстро и аккуратно.'
  ],
  refuseThoughts: [
    'Он смотрел на меня с таким спокойным достоинством, что отказывать ему было совестно вдвойне. Никакого крика — только железобетонная уверенность.',
    'Я чувствовал себя кадетом, которого застал строгий полковник. Но отступать от правил было нельзя.',
    'Он не стал спорить с отказом, и от этого было ещё хуже.'
  ],
  hardEnds: [
    {v: 'Эх, молодёжь… Ладно, не буду нервы трепать ни тебе, ни себе. Но порядок наведите!', n: 'Порядок навести. Легко сказать, когда завал на складе и сотни коробок.', out: 'Иван Петрович развернулся с военной выправкой и вышел, оставив за собой тяжёлое чувство неловкости.'},
    {v: 'Слушай, сынок, а старшего по смене можно позвать? Или у вас тут самоуправство в чести?', n: 'Старший по смене. Перспектива объясняться с начальством из-за моего упрямства выглядела так себе.', out: 'Покачал головой, вздохнул и степенно направился к выходу.'},
    {v: 'Ну и ладно. Настоящий мужчина не станет спорить с глупыми правилами. Напишу в поддержку!', n: 'Поддержка от дедушки в зелёном кардигане. Это было неожиданно.', out: 'Ушёл с гордо поднятой головой, не проронив больше ни звука.'},
    {v: 'Ладно-ладно. Воевать из-за коробки я не буду, здоровье дороже. Но осадок остался.', n: 'Осадок у ветерана труда. Моя карьера сотрудника ПВЗ дала трещину.', out: 'Медленно вышел из пункта, опираясь на трость и постукивая ею по полу.'},
    {v: 'Ох уж этот ваш сервис… Ладно, внук разберется, он у меня юрист. До свидания!', n: 'Внук-юрист. Кажется, у каждого второго посетителя родственники работают в юриспруденции.', out: 'Хлопнул дверью сдержанно, но очень весомо.'}
  ],
  giveEnds: [
    {v: 'Вот это дело! Спасибо, сынок, сразу видно — толковый парень.', n: 'Он крепко пожал мне руку через стойку. Теперь надо оправдать рукопожатие.'},
    {v: 'Благодарю! Заказ в порядке, настроение тоже. Всего доброго!', n: 'Он расправил плечи, и в пункте будто прибавилось порядка.'},
    {v: 'Спасибо, Иван Петрович доволен! Хорошей тебе смены, молодой человек.', n: 'Иван Петрович держался победителем. И заслуженно.'}
  ],
  refuseFollow: {
    hard: ['Я сказал нет. Решение окончательное.', 'Никаких исключений. Инструкция есть инструкция.', 'Спорить бесполезно, Иван Петрович. Посылка останется на складе.'],
    give: ['Ладно, держите ваш заказ. Больше не задерживаю.', 'Хорошо, оформляем выдачу. Держите коробку, Иван Петрович.', 'Уговорили. Вот ваш заказ, приятного пользования.']
  },
  lostSearch: ['Я просмотрел весь стеллаж дважды. Для его заказа ячейка оказалась пуста.', 'База подтверждает поступление, а на полке — шаром покати. Пропажа.', 'Я обыскал весь сектор по этому номеру. Коробки Ивана Петровича нигде не было.'],
  lostReactions: ['Как же нет, молодой человек? Вы военный устав вообще читали? Вещь поступила — должна быть на месте!', 'Интересное кино получается. Внук отслеживал по треку, машина пришла, а посылки нет?', 'Полк солдат не мог затеряться, а тут коробка. Ищите тщательнее!', 'Ну и дела… И как мне теперь возвращаться домой без заказа?'],
  lostThoughts: ['Его пронзительный взгляд поверх очков пробирал до мурашек. Оправдываться было стыдно.', 'Потерять заказ пожилого человека — это удар по всем фронтам. Иван Петрович явно рассчитывал на эту вещь.', 'Мне было до слёз стыдно перед ним. Настоящий ветеранский выговор.'],
  lostFollow: {
    sorry: ['Виноват, Иван Петрович. Ошибка при приёмке. К утру всё разыщём и доставим честь по чести.', 'Приношу извинения за сбой на складе. Обязательно найдём заказ первыми в смену.', 'Моя недоработка при разборе накладной. Завтра лично проконтролирую выдачу.'],
    cold: ['Заказа нет на складе. Ничем помочь не могу.', 'Не приняли — значит утеряно в дороге. Оформляйте претензию в приложении.', 'Ищите правду у службы доставки. Я отвечаю только за то, что есть на полках.']
  },
  lostEnds: {
    sorry: [
      {v: 'Ну ладно, сынок. Ошибки у всех бывают, главное — вовремя признать. Жду звонка завтра!', n: 'Признание ошибки спасло ситуацию. Мужской подход.', out: 'Иван Петрович пожал плечами, попрощался и вышел с достоинством.'},
      {v: 'Добро. Завтра так завтра. Буду ждать от вас вестей, не подведите.', n: 'Не подвести ветерана — теперь дело чести.', out: 'Медленно направился к выходу, опираясь на трость.'},
      {v: 'Хорошо. Надеюсь, к утру порядок наведете. Всего доброго!', n: 'Порядок наведем. Обязательно наведем.', out: 'Дверь за ним закрылась с благородным стуком.'}
    ],
    cold: [
      {v: 'Безобразие! В наше время за такое разгильдяйство из партии исключали.', n: 'Сурово, но справедливо. Разгильдяйство налицо.', out: 'Развернулся и ушёл, гневно постукивая тростью по полу.'},
      {v: 'Худший пункт из всех, что я видел. Больше ноги моей здесь не будет.', n: 'Обида человека старой закалки. И ведь не поспоришь.', out: 'Хлопнул дверью резко и безапелляционно.'},
      {v: 'Яркий пример того, как нельзя работать. До свидания, молодой человек.', n: 'Получил публичный выговор от дедушки. Заслуженно.', out: 'Ушёл прямой походкой, оставив меня наедине с пустыми полками.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give'},
    {icon: '💬', label: 'Поговорить с дедушкой', hint: 'Спросить о делах, выслушать совет', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



// === ПЕРСОНАЖ: ВТОРОЙ ДЕДУШКА (В КЕПКЕ) ===
const VISITOR_GRANDPA2_IMG = 'assets/visitor-grandpa2.webp';
const VISITOR_GRANDPA2 = {
  id: 'grandpa2', name: 'Григорий Иванович', male: true, img: VISITOR_GRANDPA2_IMG,
  intros: [
    'Дверь широко распахнулась, впуская бодрого дедушку в стильной кепке-уточке и клетчатой рубашке. Широко улыбаясь в седые усы, он уверенно шагнул к стойке.',
    'В пункт зашёл дедушка Григорий Иванович, поправляя кепку и весело подмигивая. Вид у него был такой, будто он пришёл не за посылкой, а на рыбалку.',
    'Колокольчик звонко звякнул. Вошёл дедушка в кепке и кардигане, держа в руке телефон со скриншотом заказа и сияя добродушной улыбкой.',
    'Дверь тихонько скрипнула, и у прилавка появился жизнерадостный дедушка с аккуратными усами и в кепке. Сразу видно — мастер на все руки.'
  ],
  greeting: 'Здорово, начальник! Принимай пенсионера за посылкой. Самое ценное приехало!',
  questions: ['Что за диковинку выписал, Григорий Иванович?', 'На дачу или на рыбалку — что в коробке?', 'Признавайся, что в коробке спрятал?', 'Что за посылка такая важная?', 'Опять снасти или запчасти для мопеда?'],
  chatter: ['Я на даче забор починил, теплицу поставил — теперь можно и посылку забрать!', 'Мне сосед подсказал этот сайт, теперь всё через вас выписываю, красота!', 'У вас тут тепло и сухо, а на улице ветерок бодрящий.', 'Спасибо за работу, сынок! Без вас мы как без рук.', 'Главное в нашем деле — терпение. А посылка никуда не денется!'],
  objections: ['В смысле нету?! Ты в кепку мою посмотри — тут же удача нарисована, должна быть посылка!', 'Погоди-погоди, как это не выдашь? Я ради этой коробочки все дела на даче отложил!', 'Да быть того не может! Внук трижды перепроверял на своем смартфоне!', 'Ну-ка, сынок, дай я сам в компьютер гляну, тут какая-то путаница!'],
  refuseLines: ['Неа, Григорий Иванович. Сегодня без выдачи.', 'Отказываю. Правила пункта превыше всего.', 'Не положено сегодня. Приходи завтра.', 'Нет и всё. Инструкция не велит.'],
  silentNotes: [
    'Вы молча кивнули и направились к стеллажам. Григорий Иванович хитро подмигнул и заложил руки за спину.',
    'Без лишних слов вы пошли искать коробку. Он терпеливо ждал, насвистывая себе под нос веселый мотивчик.',
    'Вы повернулись к полкам. В тишине раздавался лишь его спокойный добродушный вздох.'
  ],
  thoughts: [
    'Отказать такому дедушке — всё равно что испортить праздник всему двору. Но правила есть правила.',
    'Он улыбался так искренне, что мне почти стало стыдно держать его у прилавка с отказом.',
    'В его глазах читался огромный жизненный опыт и запас анекдотов на три часа вперед.',
    'Иногда посетители в кепках оказываются самыми непредсказуемыми спорщиками.'
  ],
  talkThoughts: [
    'Он успевает рассказать анекдот, пока я ищу код. И это не мешает.',
    'Энергии в нём больше, чем у половины утренней очереди.',
    'С ним в пункте становится шумно, но как-то по-доброму.'
  ],
  refuseThoughts: [
    'Отказать такому дедушке — всё равно что испортить праздник всему двору. Но правила есть правила.',
    'Он улыбался так искренне, что мне почти стало стыдно держать его у прилавка с отказом.',
    'Я испортил настроение самому весёлому человеку за сегодня. Отличная работа.'
  ],
  hardEnds: [
    {v: 'Эх, молодёжь! Ну ладно, не буду портить тебе смену. Пойду в гараж, там работы непочатый край!', n: 'Гараж спасает от любых нервотрепок. Мудрый подход.', out: 'Григорий Иванович поправил кепку, весело махнул рукой и вышел на улицу.'},
    {v: 'Слушай, а давай я сам на склад зайду и поищу? Я в своем гараже быстрее порядок наведу, чем вы тут!', n: 'Сам на склад. Перспектива пустить дедушку на склад пугала своей эффективностью.', out: 'Ушёл с довольной усмешкой, оставив меня в лёгком оцепенении.'},
    {v: 'Ну и ладно! Поеду на рыбалку без новой катушки, рыбе всё равно пофиг на заказы!', n: 'Рыбалка важнее посылок. Философия высшего уровня.', out: 'Хлопнул дверью бодро и звонко, ни капли не расстроившись.'},
    {v: 'Ладно, начальник, прощаю! Но завтра я за ней всё равно приду, так и знай!', n: 'Завтра он вернётся. И с этим придётся жить.', out: 'Ушёл, насвистывая марш и постукивая кедами по крыльцу.'},
    {v: 'Ох уж эти ваши компьютеры… Ладно, внук приедет — разберется с вашими базами данных!', n: 'Внук-программист наносит ответный удар. Наша база замерла в страхе.', out: 'Покачал головой, улыбнулся в усы и степенно пошёл к выходу.'}
  ],
  giveEnds: [
    {v: 'Вот это по-нашему! Спасибо, сынок, век буду благодарен!', n: 'Он крякнул и размял руки — готов подхватить коробку, как молодой.'},
    {v: 'Красавец! Ну всё, теперь на даче жизнь заиграет новыми красками!', n: 'Он засиял так, что спорить дальше было невозможно. Иду за посылкой.'},
    {v: 'Спасибо огромное! Держи крепкое рукопожатие от ветерана огорода!', n: 'Крепко пожал руку — аж костяшки хрустнули. Настоящий дед!'}
  ],
  refuseFollow: {
    hard: ['Я сказал нет, дедушка. Порядок есть порядок.', 'Никаких исключений, даже для таких бравых дедушек.', 'Не положено сегодня. Приходи в другую смену.'],
    give: ['Ладно, уговорил, забирай свою коробку. И удачной рыбалки!', 'Так и быть, держи заказ. Только не шуми на улице.', 'Хорошо, держи. Заслужил своим настроением!']
  },
  lostSearch: ['Я перерыл весь стеллаж дважды. Для его посылки ячейка оказалась абсолютно пустой.', 'В накладной товар числится, а на полке пусто. Куда делась коробка — загадка века.', 'Я облазил все углы сектора. Заказа Григория Ивановича нигде не было.'],
  lostReactions: ['Как это нет, сынок?! Да у меня на эту коробку все планы на выходные завязаны!', 'Ты шутишь, что ли? Машина пришла, а моя посылка испарилась? Чудеса в решете!', 'Ну-ка, давай вместе поищем! Не может такого быть, чтобы снасти пропали!', 'Эх, беда… Ну ладно, не расстраивайся, ты же не специально её спрятал.'],
  lostThoughts: [
    'Даже когда он узнал о пропаже заказа, он умудрился успокаивать меня! Невероятный дед.',
    'Потерять посылку у такого позитивного человека — просто преступление перед вселенной.',
    'Мне стало безумно стыдно перед ним за эту дыру в логистике.'
  ],
  lostFollow: {
    sorry: ['Виноват, Григорий Иванович. Ошибка приёмщика. К утру всё найдём и выдадим вне очереди!', 'Прости, отец, накладка на складе. Завтра с утра первым делом отыщем твою коробку!', 'Мой косяк при разборе товара. Обещаю, завтра всё будет на месте!'],
    cold: ['Заказа нет на складе. Ничем помочь не могу.', 'Не приняли на приёмке — значит утеряно в пути. Оформляй возврат.', 'Ищи ветер в поле. Я отвечаю только за то, что лежит на полках.']
  },
  lostEnds: {
    sorry: [
      {v: 'Ну ладно, сынок, не кисни! Бывает. Завтра так завтра, подожду.', n: 'Он сам меня утешил! Потрясающий человек.', out: 'Григорий Иванович похлопал меня по плечу, развернулся и бодро зашагал домой.'},
      {v: 'Добро! Завтра загляну с утра пораньше, только ты уж постарайся найти!', n: 'Постараться найти — теперь дело чести и совести.', out: 'Поправил кепку и вышел под задорный звон колокольчика.'},
      {v: 'Ладно, не переживай так, всякое в жизни случается. До завтра, начальник!', n: 'После таких слов хочется горы свернуть, чтобы найти его заказ.', out: 'Ушёл с улыбкой, оставив меня в полном восхищении.'}
    ],
    cold: [
      {v: 'Эх, сурово у вас… Ну да ладно, переживём и это!', n: 'Даже холодный отказ он встретил с философской улыбкой.', out: 'Развернулся и вышел, покачивая головой.'},
      {v: 'Ну и ладно, заказами сыт не будешь! Пойду лучше картошку окучивать.', n: 'Картошка важнее потерянных коробок. Железная логика.', out: 'Ушёл со спокойным сердцем и бодрым шагом.'},
      {v: 'Плохо работаешь, сынок, плохо! Ну да бог тебе судья.', n: 'Выговор от дедушки в кепке ранил сильнее любого штрафа.', out: 'Хлопнул дверью сдержанно и пошёл своей дорогой.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без лишних слов — дело прежде всего', act: 'give'},
    {icon: '💬', label: 'Поговорить с дедушкой', hint: 'Послушать байку, улыбнуться', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



const VISITOR_BUSINESSMAN_IMG = 'assets/visitor-businessman.webp';

const VISITOR_BABKA_IMG = 'assets/visitor-babka.webp';

const VISITOR_MAMA_TIRED_IMG = 'assets/visitor-mama-tired.webp';

const VISITOR_MAMA_BABY_IMG = 'assets/visitor-mama-baby.webp';

const VISITOR_STRANNIK_IMG = 'assets/visitor-strannik.webp';

const VISITOR_ZLAYA_IMG = 'assets/visitor-zlaya.webp';

const VISITOR_DYADECHKA_IMG = 'assets/visitor-dyadechka.webp';

const VISITOR_GOPAR_IMG = 'assets/visitor-gopar.webp';

const VISITOR_GLAMOUR_IMG = 'assets/visitor-glamour.webp';



const VISITOR_BUSINESSMAN = {
  id: 'businessman', name: 'Дмитрий', male: true, img: VISITOR_BUSINESSMAN_IMG,
  intros: [
    'Дверь распахнулась, и в пункт вошёл мужчина в сером костюме и красном галстуке. Он смотрел на часы, будто пункт опоздал на его встречу.',
    'Колокольчик звякнул, и появился бизнесмен. Он смотрел на часы, хмурился и считал секунды.',
    'Дверь открылась, и возник мужчина в костюме. Он посмотрел на часы, а потом — на прилавок.',
    'Вход скрипнул, и вошёл мужчина в сером костюме. Он смотрел на часы, и пункт будто сжался.'
  ],
  greeting: 'Добрый день. У меня заказ. Дам вам шестьдесят секунд. У меня встреча.',
  questions: [
    'Что в коробке? Расскажите, что там?',
    'Масло моторное? Для какой тачки?',
    'Время впритык? Показывайте заказ скорее.',
    'Для встречи с поставщиками покупка?',
    'Как эффективность — забираете заказ и по делам?'
  ],
  chatter: [
    'Время — деньги. Минута — это шестьдесят секунд, а секунда — это уже что-то.',
    'Я договариваюсь с людьми. Я привык к дедлайнам.',
    'Часы у меня швейцарские. Они не врут.',
    'Я заказываю онлайн, потому что в магазин времени нет. В магазине часы, тут — просто зайти.',
    'Я Дмитрий. Я тороплюсь. Это вся история.'
  ],
  objections: [
    'Как это „нет“? У меня шестьдесят секунд, и я их трачу на это!',
    'Сайт „готов к выдаче“ показывает! А вы говорите — нет? Это сбой KPI.',
    'Подождите. Не тратьте время. Дайте мне комп посмотреть.',
    'Это не так должно быть. Я постоянный клиент, и впервые такое.'
  ],
  refuseLines: [
    'К сожалению, выдача сегодня невозможна. Это не обсуждается.',
    'Правила пункта не имеют исключений, даже для срочных встреч.',
    'Выдачи не будет. Следующий, пожалуйста.',
    'Сегодня не могу, приходите в другой день.',
  ],
  silentNotes: [
    'Вы молча кивнули и отвернулись к стеллажам. Он смотрел на часы и ждал.',
    'Без лишних слов вы начали искать заказ. Он снова посмотрел на часы.',
    'Вы повернулись к полкам. Он посмотрел на часы в третий раз. Секунды шли.'
  ],
  thoughts: [
    'Он не злится, он торопится. Это страшнее злости.',
    'Часы тикали, и пункт стал меньше.',
    'Серый костюм и красный галстук — это не страшно, но хочется помочь.',
    'Красный галстук и тикающие часы — это особый стресс.'
  ],
  talkThoughts: [
    'Он не злится, он торопится. Значит, лишние слова только мешают.',
    'Часы, встреча, шестьдесят секунд. Уложусь.',
    'Серый костюм и красный галстук — человек живёт по расписанию.'
  ],
  refuseThoughts: [
    'Он не злится, он торопится. Это страшнее злости.',
    'Часы тикали, и пункт стал меньше.',
    'Серый костюм и красный галстук — это не страшно, но хочется помочь.',
    'Красный галстук и тикающие часы — это особый стресс.'
  ],
  hardEnds: [
    {v: 'Ок. Приду через час. Когда встреча кончится. Это дедлайн.', n: 'Он ушёл, а часы тикали. Пункт выдохнул.', out: 'Дверь скрипнула, а коридор молчал.'},
    {v: 'Ладно. Закажу в другом пункте. Там, говорят, быстрее.', n: 'Тихая угроза. От бизнесмена.', out: 'Он исчез за дверью, а часы тикали.'},
    {v: 'Не буду сценить. У меня встреча. Но приду завтра.', n: 'Обещание, с дедлайном.', out: 'Колокольчик звякнул, и пункт выдохнул.'},
    {v: 'Ок, пошёл. Встреча ждёт. Завтра.', n: 'Встреча — универсальный язык. Завтра.', out: 'Дверь закрылась, а коридор молчал.'},
    {v: 'Ну. Подумаю. Может, в другое место закажу.', n: 'Угроза другим пунктом. От бизнесмена.', out: 'Он исчез за дверью, а часы тикали.'}
  ],
  giveEnds: [
    {v: 'Вот это. Быстро, без драмы. Пять звёзд, напишу в отзыве.', n: 'Он кивнул и снова посмотрел на часы. Секунды пошли.'},
    {v: 'Хорошо! Приду ещё. Пункт у вас неплохой.', n: 'Комплимент от бизнесмена стоит золотой медали.'},
    {v: 'Спасибо. Рекомендую вас коллегам.', n: 'Рекомендация от бизнесмена. Стоит повышения.'}
  ],
  refuseFollow: {
    hard: ['Не могу, я всё сказал.', 'Нет, сегодня — не могу. Порядок есть порядок.', 'Приходите в другой день, это финал.'],
    give: ['Ладно, забирайте коробку, не опаздывайте.', 'Так и быть, держите заказ. Идите на встречу.', 'Берите и идите. Хорошего вам дня.']
  },
  lostSearch: [
    'Я обыскал все полки, но его коробки не было.',
    'В накладной посылка числилась, а на полке — чья-то забытая коробка и пыль.',
    'Я перерыл весь сектор дважды. Ничего.'
  ],
  lostReactions: [
    'Как это „пропала“? У меня шестьдесят секунд, и я их трачу на это!',
    'Ох, это плохо. У меня встреча, а коробки нет. Это сбой KPI.',
    'Коробка пропала? Подумаем. Я человек дедлайнов, я найду.',
    'Ну, это плохо. Но я человек спокойный. Подожду.'
  ],
  lostThoughts: [
    'Он расстроился молча. Это страшнее любых сцен.',
    'Часы тикали, и ответственность вернулась.',
    'Потерять коробку у бизнесмена — это особый стресс.'
  ],
  lostFollow: {
    sorry: [
      'Это моя ошибка, коробка затерялась. К утру найду!',
      'Накладка при сортировке, признаю. Ваш заказ найду к завтрашнему утру.',
      'Извините, посылка потерялась. Утром — на месте, это моё слово.'
    ],
    cold: [
      'Заказ на складе отсутствует. По регламенту — возврат.',
      'Груз утерян в логистике. Письмо в поддержку — это к ним.',
      'По инвентаризации: коробки у нас не было.',
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ок, поверю. Завтра. Это дедлайн. Не опаздывайте.', n: 'Сделка была совершена с часами. Дедлайн реален.', out: 'Он ушёл, а часы тикали.'},
      {v: 'Хорошо, без сцен. Приду завтра. Надеюсь, коробка меня дождётся.', n: 'Он человек дедлайнов, но его надежды — тяжёлые.', out: 'Колокольчик звякнул, а коридор молчал.'},
      {v: 'Ок, подожду. Встреча учит терпению. Вам тоже стоит.', n: 'Совет от бизнесмена. Через часы.', out: 'Он исчез за дверью, а часы тикали.'}
    ],
    cold: [
      {v: 'Ого. Ладно. Пойду в другой пункт. Там, говорят, добрее.', n: 'Голоса он не повысил, но стало грустнее.', out: 'Дверь закрылась, а часы тикали.'},
      {v: 'Ок. Напишу отзыв. Я пишу честно.', n: 'Отзыв — новая форма грозы.', out: 'Он исчез за дверью, и пункт выдохнул.'},
      {v: 'Ладно. Всё, без разговоров. Приду завтра и проверю.', n: 'Тихая угроза, с часами.', out: 'Колокольчик звякнул, а коридор молчал.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без сцен, просто коробка', act: 'give'},
    {icon: '💬', label: 'Поговорить с Дмитрием', hint: 'Послушать про дедлайны, понять', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



const VISITOR_BABKA = {
  id: 'babka', name: 'Зинаида', male: false, img: VISITOR_BABKA_IMG,
  intros: [
    'Дверь распахнулась, и в пункт вошла бабка в цветастом платке и коричневом пальто. Она держала в руке пенсне и уже была в атакующей позе, руки на бёдрах.',
    'Колокольчик звякнул, и появилась энергичная старушка. Она хмурилась и искала виноватых — а виноватым, как водится, оказывался пункт.',
    'Дверь открылась, и возникла женщина в цветастом платке. Она поправила пенсне и уже начала атаку.',
    'Вход скрипнул, и вошла крепкая старушка. Она была в цветастом платке, с пенсне и горой энергии.'
  ],
  greeting: 'Слушай, молодой! У бабушки Зинаиды посылка — тащи сейчас же! Я с самого открытия жду!',
  questions: [
    'Что в коробке? Расскажите, что там?',
    'Пряжу заказали? Для внуков?',
    'Из наших мест? И что в посылке, не секрет?',
    'Что за посылка — кому старались?',
    'Чайник заказали? У меня тоже есть, если что — покажу.'
  ],
  chatter: [
    'Я тут десять лет хожу. Я каждую коробку знаю, я каждую полку знаю.',
    'Внукам носки вяжу. Четверо внуков, четыре размера. Работа не кончается.',
    'Я не старая, я опытная. Это большая разница.',
    'Если у вас пирог есть — я обменяю на рецепт. Честная сделка.',
    'Пенсне у меня шестидесятых. Музейная вещь, поверьте.'
  ],
  objections: [
    'Как это „нет“? Я к вам первая пришла! У меня колени гудят!',
    'Сайт „готов к выдаче“ показывает! Читайте! А вы тут стоите и говорите — нет!',
    'Подождите, молодой. Дайте мне менеджера. Сейчас же. У меня номер есть.',
    'Это не так должно быть! Десять лет я тут хожу, и впервые такое.'
  ],
  refuseLines: [
    'Нельзя, Зинаида, правила есть правила.',
    'Сегодня выдача не положена. Завтра заходите, может, довозят.',
    'Не выдам, и упрашивать бесполезно.',
    'Сегодня не могу, приходите в другой день.',
  ],
  silentNotes: [
    'Вы молча кивнули и отвернулись к стеллажам. Она смотрела на вас, стуча пальцем по прилавку.',
    'Без лишних слов вы начали искать заказ. Она ждала, руки на бёдрах, хмурясь.',
    'Вы повернулись к полкам. Она поправила пенсне и проводила вас взглядом.'
  ],
  thoughts: [
    'Она не злая, она просто громкая. И права на это у неё есть.',
    'Пенсне звенело по прилавку. Звук денег, или звук нетерпения.',
    'Она критиковала свет, полку и кофе. Но ходит сюда десять лет. Странно, но так.',
    'Платок и пенсне — это своего рода броня. Под ней просто человек, которому надоело ждать.'
  ],
  talkThoughts: [
    'Она не злая, она просто громкая. И права на это у неё есть.',
    'Ходит сюда десять лет и всё равно проверяет каждую наклейку.',
    'Платок и пенсне — своего рода броня. Под ней просто человек, который ждал.'
  ],
  refuseThoughts: [
    'Она ждала с самого открытия, а получила отказ. Такое не забывают — и правильно.',
    'Я сказал «нет» человеку, который ходит сюда десять лет. Аргументов у меня не было.',
    'Отказ пожилой женщине звучит вдвое громче. Даже если произнесён тихо.'
  ],
  hardEnds: [
    {v: 'Запомню. У меня много знакомых, и все они умеют читать отзывы.', n: 'Угроза, обёрнутая в цветастый платок.', out: 'Она ушла, а пенсне поймало свет.'},
    {v: 'Ладно. Закажу в пункте через улицу. Там, говорят, добрее.', n: 'Конкуренты. С пенсне шестидесятых.', out: 'Дверь закрылась, а цветастый платок исчез.'},
    {v: 'Подожду снаружи. Когда будет — вернусь. И тогда поговорим.', n: 'Пауза для размышлений. И для коленей.', out: 'Она исчезла за дверью, и пункт выдохнул.'},
    {v: 'Запомните этот день. Я всё запоминаю, я не забываю.', n: 'Некоторые клиенты ведут счёты. Эта — в блокноте.', out: 'Колокольчик звякнул, а коридор молчал.'},
    {v: 'Ок, ухожу. Но вернусь. Я всегда возвращаюсь — я упрямая.', n: 'Упрямство, с цветастым платком.', out: 'Она ушла, а пенсне звенело.'}
  ],
  giveEnds: [
    {v: 'Вот это по-нашему! Быстро, без драмы. Пять звёзд, напишу в отзыве.', n: 'Она поправила пенсне — довольный жест. Осталось принести коробку.'},
    {v: 'Хорошо! Приду ещё. Пункт у вас неплохой.', n: 'Комплимент от неё стоит золотой медали.'},
    {v: 'Спасибо. Вы нормальный молодой человек, не давите на себя.', n: 'Совет от женщины с пенсне шестидесятых.'}
  ],
  refuseFollow: {
    hard: ['Не могу, я всё сказал.', 'Нет, сегодня — не могу. Порядок есть порядок.', 'Приходите в другой день, это финал.'],
    give: ['Ладно, забирайте коробку, без сцен.', 'Так и быть, держите заказ. И пошла.', 'Берите и идите.']
  },
  lostSearch: [
    'Я обыскал все полки, но её коробки не было.',
    'В накладной посылка числилась, а на полке — чья-то забытая коробка и пыль.',
    'Я перерыл весь сектор дважды. Ничего.'
  ],
  lostReactions: [
    'Как это „пропала“?! Я к вам первая пришла! У меня колени гудят!',
    'Коробка исчезла? Это же скандал! Я менеджера позову, потом инспектора, потом — СМИ!',
    'Подождите. Подумайте. Десять лет я клиент, и впервые такое.',
    'Ну, это плохо. Но я женщина спокойная, подожду. Чуть-чуть.'
  ],
  lostThoughts: [
    'Даже её голос сник. Это знак: она по-настоящему расстроена.',
    'Пенсне притихло. Это плохой знак.',
    'Потерять коробку у женщины с пенсне шестидесятых — это особый стресс.'
  ],
  lostFollow: {
    sorry: [
      'Зинаида, это моя ошибка, коробка затерялась. К утру найду!',
      'Накладка при сортировке, признаю. Ваш заказ найду к завтрашнему утру.',
      'Извините, посылка потерялась. Утром — на месте, это моё слово.'
    ],
    cold: [
      'На складе ничего нет, матушка. Ничем помочь не могу.',
      'Похоже, везли её не в этот город. Возврат — сами заполните.',
      'Полки я обходил трижды. Коробки тут не бывало.',
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ладно, поверю. Завтра. Если я права — жду. И сосед со мной.', n: 'Завтра, в сопровождении соседа. Делегация от двора.', out: 'Она ушла, поправляя пенсне.'},
      {v: 'Хорошо, без сцен. Приду завтра. Надеюсь, коробка меня дождётся.', n: 'Она терпеливая, но её надежды — тяжёлые.', out: 'Колокольчик звякнул, а коридор молчал.'},
      {v: 'Ок, подожду. Я же женщина спокойная. Но запомню это.', n: 'Спокойствие заразно, а память — длинная.', out: 'Она ушла, а пенсне звенело.'}
    ],
    cold: [
      {v: 'Ого. Ладно. Пойду в другой пункт. Там, говорят, добрее.', n: 'Голоса она не повысила, но стало грустнее.', out: 'Дверь закрылась, а цветастый платок исчез.'},
      {v: 'Ок. Напишу отзыв. Я пишу честно.', n: 'Отзыв — новая форма грозы.', out: 'Она исчезла за дверью, и пункт выдохнул.'},
      {v: 'Ладно. Всё, без разговоров. Приду завтра и проверю.', n: 'Тихая угроза, с пенсне.', out: 'Колокольчик звякнул, а коридор молчал.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без сцен, просто коробка', act: 'give'},
    {icon: '💬', label: 'Поговорить с Зинаидой', hint: 'Послушать про внуков, получить рецепт', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



const VISITOR_MAMA_TIRED = {
  id: 'mama_tired', name: 'Ирина', male: false, img: VISITOR_MAMA_TIRED_IMG,
  intros: [
    'Дверь распахнулась, и в пункт вошла блондинка в шубе. Рядом с ней — мальчик в синей куртке, который смотрел в телефон и хмурился. Её глаза были тяжёлыми.',
    'Колокольчик звякнул, и появилась уставшая женщина. Она была в шубе, с красными губами, а за ней — мальчик в синей куртке.',
    'Дверь открылась, и возникла женщина в шубе. Она смотрела на прилавок, будто считала, сколько минут ей придётся ждать.',
    'Вход скрипнул, и вошла блондинка в шубе. Рядом с ней — мальчик в синей куртке, который вздохнул.'
  ],
  greeting: 'Привет. У меня посылка. Пожалуйста, быстрее, мы устали, и ребёнок тоже изнемогает.',
  questions: [
    'Что в коробке? Расскажите, что там?',
    'Заказ для сына или для себя?',
    'Это вам покупка или для семьи?',
    'Пять минут на всё — что в коробке?',
    'Из нашего двора? Тогда поскорее: что в посылке?'
  ],
  chatter: [
    'Две работы, школа, и вот мы тут снова. Это жизнь.',
    'Шуба — семейная реликвия. У мамы была, теперь у меня. Она держится.',
    'Ему двенадцать, он в таком возрасте. Не говорит, только вздыхает.',
    'Я заказываю онлайн, потому что в магазин времени нет. В магазине часы, тут — просто зайти.',
    'Я Ирина. А это мой сын, Лев. Он молчит, но он тут главный.'
  ],
  objections: [
    'Как это „нет“? Мы же специально приехали! Ребёнок изнемогает!',
    'Подождите, не ругайтесь, он сейчас обидится. Дайте мне комп посмотреть.',
    'Сайт „готов к выдаче“ показывает! А вы говорите — нет?',
    'Я не сценю, я просто устала. Давайте просто найдём коробку, ладно?'
  ],
  refuseLines: [
    'Сегодня без выдачи. Простите, я устал не меньше вас.',
    'Правила сегодня против меня. Приходите в другой день.',
    'Больше я сегодня ничего не выдаю. Простите.',
    'Сегодня не могу, приходите в другой день.',
  ],
  silentNotes: [
    'Вы молча кивнули и отвернулись к стеллажам. Она ждала, а мальчик вздохнул.',
    'Без лишних слов вы начали искать заказ. Она смотрела на вас, потом на телефон.',
    'Вы повернулись к полкам. Она поправила шубу, а мальчик пнул стену.'
  ],
  thoughts: [
    'Она не злится, она просто устала. Это страшнее злости.',
    'Мальчик вздохнул, и пункт стал меньше.',
    'Шуба — семейная реликвия, а усталость — наследственная. Отказать такому — сложно.',
    'Красные губы и тяжёлые глаза — это не страшно, но хочется помочь.'
  ],
  talkThoughts: [
    'Она не злится, она просто устала. С ребёнком на руках это нормально.',
    'Мальчик вздыхает у стойки, и хочется управиться быстрее.',
    'Шуба — семейная реликвия, а усталость — рабочая.'
  ],
  refuseThoughts: [
    'Шуба — семейная реликвия, а усталость — наследственная. Отказать такому — сложно.',
    'Она с ребёнком на руках, а я говорю «нет». Аргументов у меня не было.',
    'Мой отказ добавил ей ещё один тяжёлый день. Как будто их мало.'
  ],
  hardEnds: [
    {v: 'Ок, приду вечером. Ребёнок подождёт, я не могу.', n: 'Она ушла, а мальчик пнул стену. Пункт выдохнул.', out: 'Дверь скрипнула, а коридор молчал.'},
    {v: 'Ладно. Закажу в другом пункте. Там, говорят, быстрее.', n: 'Тихая угроза. От усталой мамы.', out: 'Она исчезла за дверью, а мальчик вздохнул.'},
    {v: 'Не буду сценить. У меня сын. Но приду завтра.', n: 'Обещание, со вздохом и шубой.', out: 'Колокольчик звякнул, и пункт выдохнул.'},
    {v: 'Ок, пошла. Мы устали. Завтра.', n: 'Усталость — универсальный язык. Завтра.', out: 'Дверь закрылась, а коридор молчал.'},
    {v: 'Ну. Подумаю. Может, в другое место закажу.', n: 'Угроза другим пунктом. От мамы.', out: 'Она исчезла за дверью, а мальчик вздохнул.'}
  ],
  giveEnds: [
    {v: 'Ура! Спасибо! Теперь можно домой и спать.', n: 'Она выдохнула, а мальчик, против воли, сказал «спасибо».'},
    {v: 'Хорошо! Приду ещё. Пункт у вас неплохой.', n: 'Комплимент от усталой женщины стоит золотой медали.'},
    {v: 'Спасибо. Ребёнок вам кивает.', n: 'Мальчик поднял голову от телефона и кивнул. Высокая оценка.'}
  ],
  refuseFollow: {
    hard: ['Не могу, я всё сказал.', 'Нет, сегодня — не могу. Порядок есть порядок.', 'Приходите в другой день, это финал.'],
    give: ['Ладно, забирайте коробку, только за ребёнком смотрите.', 'Так и быть, держите заказ. Несите домой.', 'Берите и идите. Хорошего вам дня.']
  },
  lostSearch: [
    'Я обыскал все полки, но её коробки не было.',
    'В накладной посылка числилась, а на полке — чья-то забытая коробка и пыль.',
    'Я перерыл весь сектор дважды. Ничего.'
  ],
  lostReactions: [
    'Как это „пропала“? Мы неделю ждали! Ребёнок уже спрашивает!',
    'Ох, это плохо. Мужу я обещала, что сегодня будет. Теперь скажу „ну, не вышло“.',
    'Коробка пропала? Подумаем. Лев найдёт, он в коробках разбирается.',
    'Ну, это плохо. Но я женщина спокойная. Подожду.'
  ],
  lostThoughts: [
    'Она расстроилась молча. Это страшнее любых сцен.',
    'Мальчик вздохнул, и ответственность вернулась.',
    'Потерять коробку у усталой мамы — это особый стресс.'
  ],
  lostFollow: {
    sorry: [
      'Это моя ошибка, коробка затерялась. К утру найду!',
      'Накладка при сортировке, признаю. Ваш заказ найду к завтрашнему утру.',
      'Извините, посылка потерялась. Утром — на месте, это моё слово.'
    ],
    cold: [
      'Заказа нет. Я проверил — правда нет.',
      'Утеряна, насколько понимаю. Поддержку попробуйте.',
      'Не было её здесь. Извините, что не могу радовать.',
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ок, поверю. Завтра. Ребёнок подождёт, я тоже подожду.', n: 'Сделка была совершена со вздохом. Лев терпелив.', out: 'Она ушла, а мальчик пнул стену.'},
      {v: 'Хорошо, без сцен. Приду завтра. Надеюсь, коробка меня дождётся.', n: 'Она терпеливая мама, но её надежды — тяжёлые.', out: 'Колокольчик звякнул, а коридор молчал.'},
      {v: 'Ок, подожду. Ребёнок учит терпению. Вам тоже стоит.', n: 'Совет от двенадцатилетнего. Через его маму.', out: 'Она исчезла за дверью, а мальчик вздохнул.'}
    ],
    cold: [
      {v: 'Ого. Ладно. Пойду в другой пункт. Там, говорят, добрее.', n: 'Голоса она не повысила, но стало грустнее.', out: 'Дверь закрылась, а мальчик вздохнул.'},
      {v: 'Ок. Скажу в мамином чате. Они умеют читать отзывы.', n: 'Маминый чат — новая форма грозы.', out: 'Она исчезла за дверью, и пункт выдохнул.'},
      {v: 'Ладно. Всё, без разговоров. Приду завтра и проверю.', n: 'Тихая угроза, с шубой.', out: 'Колокольчик звякнул, а коридор молчал.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без сцен, просто коробка', act: 'give'},
    {icon: '💬', label: 'Поговорить с Ириной', hint: 'Послушать про жизнь, понять', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



const VISITOR_MAMA_BABY = {
  id: 'mama_baby', name: 'Даша', male: false, img: VISITOR_MAMA_BABY_IMG,
  intros: [
    'Дверь скрипнула, и у прилавка появилась молодая женщина в бежевом свитере. На руках у неё был малыш в белой шапочке и зелёном боди. Малыш улыбался.',
    'Колокольчик звякнул, и вошла мама с малышом. Ребёнок пинал ножками, мама нервно улыбалась.',
    'Дверь открылась, и появилась уставшая, но довольная женщина. На руках — малыш в шапочке, который с интересом оглядывался.',
    'Вход распахнулся, и вошла мама с малышом. Ребёнок зевнул, мама улыбнулась.'
  ],
  greeting: 'Привет! Извините, с малышом, он ни с кем не остаётся. Нам коробочку, пожалуйста, без долгого.',
  questions: [
    'А что там внутри? Расскажете, пока я его укачиваю?',
    'Для малыша покупка или для себя?',
    'Пустяки для малыша или серьёзный заказ?',
    'Часто заказываете? У ребёнка вкус на вещи есть?',
    'Из нашего двора? Тогда поскорее: что в посылке?'
  ],
  chatter: [
    'Ему три месяца. Он уже требует коробки — характер в нём есть.',
    'Я заказываю онлайн, потому что с ребёнком в магазин — это подвиг. Тут хотя бы просто зайти.',
    'Он любит свет. Смотрит на полку и хлопает в ладошки.',
    'Муж говорит: меньше заказывай. Но дети растут быстро, и вещей нужно много.',
    'Я Даша. А это Митя. Он тут главный.'
  ],
  objections: [
    'Как это „нет“? Я тут с малышом стою! Он устал!',
    'Подождите, не ругайтесь, он сейчас закричит. Дайте мне комп посмотреть.',
    'Сайт „готов к выдаче“ показывает! А вы говорите — нет?',
    'Я не злюсь, я просто устала. Давайте просто найдём коробку, ладно?'
  ],
  refuseLines: [
    'Не могу выдать, мамочка. Сегодня выдача закрыта.',
    'Правила не пускают. Простите, мне тоже жаль.',
    'Сегодня не выдам. Приходите в другой раз.',
    'Сегодня не могу, приходите в другой день.',
  ],
  silentNotes: [
    'Вы молча кивнули и отвернулись к стеллажам. Она ждала с малышом, а тот хлопал в ладошки.',
    'Без лишних слов вы начали искать заказ. Она нервно улыбнулась и прижала малыша к себе.',
    'Вы повернулись к полкам. Она смотрела на вас, потом на малыша, потом снова на вас.'
  ],
  thoughts: [
    'Мама с малышом — это особый вид клиента. Её нельзя торопить, и её нельзя заставлять ждать.',
    'Малыш зевнул, и пункт замер.',
    'Она устала, но улыбается. Это сила, которую не каждый день видишь.',
    'Малыш пинал ножками, и коробка вдруг стала важнее.'
  ],
  talkThoughts: [
    'Мама с малышом — особый вид клиента: её нельзя торопить и нельзя заставлять ждать.',
    'Малыш зевнул, и захотелось всё сделать в два раза быстрее.',
    'Она устала, но улыбается. Это сила, которую не каждый день видишь.'
  ],
  refuseThoughts: [
    'Я отказал маме с малышом на руках. Оправдания придумывать даже не хочется.',
    'Она не стала спорить — просто поправила малышу шапочку. Это било сильнее слов.',
    'Мой отказ означал ещё одну дорогу сюда с коляской. Я это понимал.'
  ],
  hardEnds: [
    {v: 'Ок, приду вечером. Малыш подождёт, у него бутылочка есть.', n: 'Она ушла, а малыш помахал ручкой. Пункт выдохнул.', out: 'Дверь скрипнула, а коридор молчал.'},
    {v: 'Ладно. Закажу в другом пункте. Там, говорят, быстрее.', n: 'Тихая угроза. От мамы с малышом.', out: 'Она исчезла за дверью, а малыш помахал ручкой.'},
    {v: 'Не буду сценить. У меня малыш. Но приду завтра.', n: 'Обещание, с бутылочкой и шапочкой.', out: 'Колокольчик звякнул, и пункт выдохнул.'},
    {v: 'Ок, пошла. Малыш устал, я тоже устала. Завтра.', n: 'Усталость — универсальный язык. Завтра.', out: 'Дверь закрылась, а коридор молчал.'},
    {v: 'Ну. Подумаю. Может, в другое место закажу.', n: 'Угроза другим пунктом. От мамы.', out: 'Она исчезла за дверью, а малыш хлопал в ладошки.'}
  ],
  giveEnds: [
    {v: 'Ура! Спасибо! Малыш доволен, я тоже.', n: 'Она заулыбалась, а малыш захлопал в ладошки. Осталось принести коробку.'},
    {v: 'Хорошо! Приду ещё. Пункт у вас лучший, я всем мамам скажу.', n: 'Рекомендация из маминого чата. Стоит золотой медали.'},
    {v: 'Спасибо! Так держать. Малыш вам поцелуй шлёт.', n: 'Малыш открыл рот, и вы решили, что это поцелуй.'}
  ],
  refuseFollow: {
    hard: ['Не могу, я всё сказал.', 'Нет, сегодня — не могу. Порядок есть порядок.', 'Приходите в другой день, это финал.'],
    give: ['Ладно, забирайте коробку, только малыша не роняйте.', 'Так и быть, держите заказ. Берегите малыша.', 'Берите и идите. Хорошего вам дня.']
  },
  lostSearch: [
    'Я проверил каждую полку в её секторе — коробки не было.',
    'По документам приёмка была, а в ячейке — пусто, только ценник от чужого заказа.',
    'Обошёл стеллажи дважды, вплоть до верхних полок. Пусто.'
  ],
  lostReactions: [
    'Как это „пропала“? Я неделю жду! Там вещи для малыша!',
    'Ох, это плохо. Мужу я обещала, что сегодня будет. Теперь скажу „ну, не вышло“.',
    'Коробка пропала? Подождите… Мне без неё сегодня совсем никак.',
    'Плохо, конечно. Но с малышом кричать не будешь. Подожду.'
  ],
  lostThoughts: [
    'Она расстроилась молча. Это страшнее любых сцен.',
    'Малыш зевнул, и ответственность вернулась.',
    'Потерять коробку у мамы — это особый стресс.'
  ],
  lostFollow: {
    sorry: [
      'Это моя ошибка, коробка затерялась. К утру найду!',
      'Накладка при сортировке, признаю. Ваш заказ найду к завтрашнему утру.',
      'Извините, посылка потерялась. Утром — на месте, это моё слово.'
    ],
    cold: [
      'Посылки нет, простите. Пересчитал — её нет.',
      'Значит, потерялась в пути. Возврат — через приложение.',
      'На полках пусто. Честно, сам бы хотел её найти.',
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ок, поверю. Завтра. Малыш подождёт, я тоже подожду.', n: 'Сделка была совершена с бутылочкой. Малыш терпелив.', out: 'Она ушла, а малыш помахал ручкой.'},
      {v: 'Хорошо, без сцен. Завтра заедем с коляской ещё раз.', n: 'Она терпеливая мама, но её надежды — тяжёлые.', out: 'Колокольчик звякнул, и коляска простучала по крыльцу.'},
      {v: 'Ок, подожду. Малыш учит терпению. Вам тоже стоит.', n: 'Совет от трёхмесячного. Через его маму.', out: 'Она исчезла за дверью, а малыш хлопал в ладошки.'}
    ],
    cold: [
      {v: 'Понятно. Закажу в пункт у поликлиники, нам всё равно туда.', n: 'Она даже не расстроилась вслух — просто поправила малышу шапочку.', out: 'Дверь закрылась, а малыш помахал ручкой.'},
      {v: 'Ок. Скажу в мамином чате. Они умеют читать отзывы.', n: 'Маминый чат — новая форма грозы.', out: 'Она исчезла за дверью, и пункт выдохнул.'},
      {v: 'Ладно, не буду спорить при малыше. Приду завтра.', n: 'Тихая угроза, с шапочкой.', out: 'Колокольчик звякнул, а коридор молчал.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без сцен, просто коробка', act: 'give'},
    {icon: '💬', label: 'Поговорить с Дашей', hint: 'Послушать про малыша, улыбнуться', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



const VISITOR_STRANNIK = {
  id: 'strannik', name: 'Марк', male: true, img: VISITOR_STRANNIK_IMG,
  intros: [
    'Дверь скрипнула, и в пункт вошёл парень в сером худи. Он натянул капюшон, вцепился руками в карманы и смотрел вниз.',
    'Колокольчик звякнул тихо, и у прилавка оказался молодой парень. Он стоял неподвижно, будто ждал сигнала.',
    'Дверь открылась, и появился парень в худи. Он не смотрел на вас, а на полку. Будто коробка звала его оттуда.',
    'Вход распахнулся, и вошёл молчаливый парень. Он был тих, с опущенным капюшоном и тенью в глазах.'
  ],
  greeting: 'Коробка. Она ждёт. Вы знаете, где.',
  questions: [
    'Что там заказано? Расскажите, что внутри?',
    'Что зовёт вас с полки — посылка?',
    'Ради чего вы здесь? Покажете заказ?',
    'Для себя заказали?',
    'Заказ как всегда один? Что в этот раз?'
  ],
  chatter: [
    'Коробки гудят. Вы слышите? Они гудят, когда ждут.',
    'Я не много говорю. Я больше слушаю.',
    'Полка — это своего рода лес. Каждая коробка — просека.',
    'Я мало сплю. Я жду посылок.',
    'Время тут идёт иначе. Медленнее, чем снаружи.'
  ],
  objections: [
    'Коробка моя. Она ждёт. Почему вы не отдаёте?',
    'Я тут стою давно. Коробка уже остыла.',
    'Подождите. Я ждал раньше, подожду ещё. Но коробка не должна ждать.',
    'Вы не понимаете. Коробка уже здесь. Она просто… спряталась.'
  ],
  refuseLines: [
    'Сегодня выдача невозможна. Путь свободен.',
    'Правила — правила, а ветер — ветер. Сегодня не выдам.',
    'У меня нет коробки. И причин объяснять это.',
    'Сегодня не могу, приходите в другой день.',
  ],
  silentNotes: [
    'Вы молча кивнули и отвернулись к стеллажам. Он молча смотрел на вас, не отводя взгляда.',
    'Без лишних слов вы начали искать заказ. Он ждал, с опущенным капюшоном, неподвижно.',
    'Вы повернулись к полкам. Он молча стоял, будто тоже искал коробку.'
  ],
  thoughts: [
    'Он говорит тихо, но слова у него весомые. Нужно слушать.',
    'Капюшон и тень в глазах — это не страшно, но странно. Нужно помогать, а не стоять.',
    'Он говорит про коробку, как будто она живая. С этим не поспоришь.',
    'Тишина от него тяжелее любых слов. Нужно просто выдать коробку.'
  ],
  talkThoughts: [
    'Он говорит тихо, но слова у него весомые. Нужно слушать.',
    'Капюшон и тень в глазах — это не страшно, просто человек такой.',
    'Он говорит про коробку, как будто она живая. С этим не поспоришь.'
  ],
  refuseThoughts: [
    'Он не стал спорить с отказом. От этого было только хуже.',
    'Я отказал человеку, который говорит тише всех в этом пункте. Смелость сомнительная.',
    'Мой отказ повис в тишине, и тишина оказалась тяжелее любого скандала.'
  ],
  hardEnds: [
    {v: 'Ок. Коробка подождёт. Я приду.', n: 'Он ушёл молча, а пункт замер.', out: 'Дверь скрипнула, а коридор потемнел.'},
    {v: 'Коробка знает. Она уже всё решила.', n: 'Загадочное прощание. Коробка не торопится.', out: 'Он исчез за дверью, а свет моргнул.'},
    {v: 'Я не буду ругаться. Я не из таких. Но коробка будет ждать.', n: 'Тихое обещание. Коробка ждёт.', out: 'Колокольчик звякнул тихо, и пункт выдохнул.'},
    {v: 'Ок, ухожу. Коробка ждёт. Я вернусь.', n: 'Он человек слова. Коробка тоже человек слова.', out: 'Дверь закрылась, а коридор молчал.'},
    {v: 'Завтра. Коробка и я придём. Вместе.', n: 'Делегация от коробки. Завтра придётся быть готовым.', out: 'Он исчез за дверью, а свет померк.'}
  ],
  giveEnds: [
    {v: 'Вот. Она ждала.', n: 'Он чуть заметно кивнул, и на секунду свет в пункте будто стал теплее.'},
    {v: 'Спасибо. Коробка довольна.', n: 'Странная благодарность. Но искренняя.'},
    {v: 'Ок. Теперь я могу спать.', n: 'Коробка нашла владельца. Вы можете выдохнуть.'}
  ],
  refuseFollow: {
    hard: ['Не могу, я всё сказал.', 'Нет, сегодня — не могу. Порядок есть порядок.', 'Приходите в другой день, это финал.'],
    give: ['Ладно, забирайте коробку. И пошёл.', 'Так и быть, держите заказ. Только не роняйте.', 'Берите и идите.']
  },
  lostSearch: [
    'Я обыскал все полки, но его коробки не было.',
    'В накладной посылка числилась, а на полке — чья-то забытая коробка и пыль.',
    'Я перерыл весь сектор дважды. Ничего.'
  ],
  lostReactions: [
    'Коробка пропала? Она гудела. А теперь — тишина.',
    'Я ждал давно. Коробка уже остыла.',
    'Подождите. Подумайте. Коробка где-то есть. Она всегда где-то есть.',
    'Ну, это плохо. Но я подожду. Коробка учит терпению.'
  ],
  lostThoughts: [
    'Его голос был тихим, но грустным. Это была настоящая грусть.',
    'Капюшон чуть упал — видно, он думает.',
    'Потерять коробку у молчаливого парня — это особая тишина.'
  ],
  lostFollow: {
    sorry: [
      'Коробка затерялась, мой косяк. К утру найду.',
      'Накладка при сортировке. Ваш заказ найду к завтрашнему утру.',
      'Извините, посылка потерялась. Утром — на месте.'
    ],
    cold: [
      'На складе нет. Может, ветер унёс — не знаю.',
      'Оформляйте возврат. Ветер я остановить не смогу.',
      'Коробки не существует. Как и половина вашего разговора.',
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ок. Поверю. Коробка подождёт. Я приду завтра.', n: 'Сделка была совершена молча. Коробка не торопится.', out: 'Он ушёл, а пункт замер.'},
      {v: 'Хорошо. Коробка знает. Она уже всё решила.', n: 'Загадочное обещание. Коробка терпелива.', out: 'Дверь скрипнула, а коридор молчал.'},
      {v: 'Ок, подожду. Коробка учит терпению. Вам тоже стоит.', n: 'Тихий совет. От парня в капюшоне.', out: 'Он исчез за дверью, а свет померк.'}
    ],
    cold: [
      {v: 'Ого. Коробка теперь молчит. Это плохой знак.', n: 'Голоса он не повысил, но стало грустнее.', out: 'Дверь закрылась, а коридор потемнел.'},
      {v: 'Ок. Коробка подождёт. Я приду завтра.', n: 'Тихая угроза. Коробка терпелива.', out: 'Он исчез за дверью, и пункт выдохнул.'},
      {v: 'Ладно. Всё, без разговоров. Коробка знает.', n: 'Разговор окончен, а ощущение — нет.', out: 'Колокольчик звякнул тихо, а коридор молчал.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без сцен, просто коробка', act: 'give'},
    {icon: '💬', label: 'Поговорить с Марком', hint: 'Послушать тишину, понять коробку', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



const VISITOR_ZLAYA = {
  id: 'zlaya', name: 'Екатерина', male: false, img: VISITOR_ZLAYA_IMG,
  intros: [
    'Дверь распахнулась, и в пункт вошла женщина в лаймовом кардигане и леопардовой блузке. На ней была гора колец и огромная брошь, а руки уже были скрещены.',
    'Колокольчик звякнул, и появилась строгая тётка. Она оглядела пункт, будто проводила инспекцию интерьера.',
    'Дверь открылась, и возникла женщина с горой украшений. Её взгляд упал сначала на полку, потом на кофе, а потом — на вас.',
    'Вход скрипнул, и вошла дама в леопардовом принте. Она хмурилась, будто уже нашла три повода для недовольства.'
  ],
  greeting: 'Вы новый? Я тут три года хожу. Так что: коробка, номер, и давайте быстрее — у меня дела.',
  questions: [
    'И что же вам прислали? Любопытно.',
    'Крем заказали? Для лица — самое то.',
    'Без пауз: что в посылке?',
    'Что за срочная покупка у вас?',
    'Без потери времени — показывайте заказ.'
  ],
  chatter: [
    'Я не злая тётка, я просто не люблю, когда моё время тянут.',
    'Леопард — это семейная традиция. У мамы был, у бабушки был.',
    'Брошь у меня шестидесятых. Музейная вещь, поверьте.',
    'Кофе у вас есть? Налейте. Без сахара, но с щепоткой соли.',
    'Я всегда первая в очереди, у меня на это есть право. Я — постоянный клиент.'
  ],
  objections: [
    'Как это „нет“? Я тут двадцать минут стою! У меня давление подскочило!',
    'Сайт „готов к выдаче“ показывает! Читайте! А вы тут стоите и говорите — нет!',
    'Подождите, молодой. Дайте мне менеджера. Сейчас же.',
    'Это не так должно быть! Три года я тут хожу, и впервые такое.'
  ],
  refuseLines: [
    'Сегодня не выдам. Даже не спорьте.',
    'Правила — правила. Ваш голос их не отменяет.',
    'Не выдам. И всё. Следующий.',
    'Сегодня не могу, приходите в другой день.',
  ],
  silentNotes: [
    'Вы молча кивнули и отвернулись к стеллажам. Она смотрела на вас, стуча кольцом по прилавку.',
    'Без лишних слов вы начали искать заказ. Она ждала, скрестив руки и нахмурившись.',
    'Вы повернулись к полкам. Она поправила брошь и проводила вас взглядом.'
  ],
  thoughts: [
    'Она не злая, она просто громкая. И права на это у неё есть.',
    'Гора колец звенела по прилавку. Звук денег, или звук нетерпения.',
    'Она критиковала кофе, полку и свет. Но ходит сюда три года. Странно, но так.',
    'Леопард и брошь — это своего рода броня. Под ней просто человек, которому надоело ждать.'
  ],
  talkThoughts: [
    'Голос громкий, а претензии по делу. Это честнее молчания.',
    'Ходит сюда три года и знает наш пункт лучше некоторых сотрудников.',
    'Леопард и брошь — броня. Под ней человек, который просто ждал своей очереди.'
  ],
  refuseThoughts: [
    'Она не злая, она просто громкая. И права на это у неё есть.',
    'Гора колец звенела по прилавку. Звук денег, или звук нетерпения.',
    'Она критиковала кофе, полку и свет. Но ходит сюда три года. Странно, но так.',
    'Леопард и брошь — это своего рода броня. Под ней просто человек, которому надоело ждать.'
  ],
  hardEnds: [
    {v: 'Запомню. У меня много знакомых, и все они умеют читать отзывы.', n: 'Угроза, обёрнутая в гору колец.', out: 'Она ушла, а брошь поймала свет.'},
    {v: 'Ладно. Закажу в пункте через улицу. Там, говорят, добрее.', n: 'Конкуренты. С брошью шестидесятых.', out: 'Дверь закрылась, а леопард исчез.'},
    {v: 'Подожду снаружи. Когда будет — вернусь. И тогда поговорим.', n: 'Пауза для размышлений. И для давления.', out: 'Она исчезла за дверью, и пункт выдохнул.'},
    {v: 'Запомните этот день. Я всё запоминаю, я не забываю.', n: 'Некоторые клиенты ведут счёты. Эта — в блокноте.', out: 'Колокольчик звякнул, и в пункте стало непривычно тихо.'},
    {v: 'Ок, ухожу. Но вернусь. Я всегда возвращаюсь — я упрямая.', n: 'Упрямство, с леопардовым принтом.', out: 'Она ушла, а кольца звенели.'}
  ],
  giveEnds: [
    {v: 'Вот это по-нашему! Быстро, без драмы. Пять звёзд, напишу в отзыве.', n: 'Она поправила брошь — довольный жест. Осталось принести коробку.'},
    {v: 'Хорошо! Приду ещё. Пункт у вас неплохой.', n: 'Комплимент от неё стоит золотой медали.'},
    {v: 'Спасибо. Вы нормальный молодой человек, не давите на себя.', n: 'Совет от женщины с горой колец.'}
  ],
  refuseFollow: {
    hard: ['Не могу, я всё сказал.', 'Нет, сегодня — не могу. Порядок есть порядок.', 'Приходите в другой день, это финал.'],
    give: ['Ладно, забирайте коробку, без сцен.', 'Так и быть, держите заказ. И пошла.', 'Берите и идите.']
  },
  lostSearch: [
    'Я обыскал все полки, но её коробки не было.',
    'По накладной посылка была принята, а в ячейке — только пыль и старый стикер.',
    'Дважды прошёл сектор от начала до конца. Пусто.'
  ],
  lostReactions: [
    'Как это „пропала“?! Я тут двадцать минут стою! У меня давление!',
    'Коробка исчезла? Это же скандал! Я менеджера позову, потом инспектора, потом — СМИ!',
    'Подождите. Подумайте. Три года я клиент, и впервые такое.',
    'Скверно. Но я не из тех, кто устраивает сцены. Подожду.'
  ],
  lostThoughts: [
    'Даже её голос сник. Это знак: она по-настоящему расстроена.',
    'Гора колец притихла. Это плохой знак.',
    'Потерять коробку у женщины с брошью шестидесятых — это особый стресс.'
  ],
  lostFollow: {
    sorry: [
      'Это моя ошибка, коробка затерялась. К утру найду!',
      'Накладка при сортировке, признаю. Ваш заказ найду к завтрашнему утру.',
      'Извините, посылка потерялась. Утром — на месте, это моё слово.'
    ],
    cold: [
      'Нет на складе. Повторять не буду.',
      'Утеряна. Служба поддержки — это к ним, не ко мне.',
      'Коробки не было. Считайте, что не было.',
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ладно, поверю. Завтра. Если я права — жду. И сосед со мной.', n: 'Завтра, в сопровождении соседа. Делегация от двора.', out: 'Она ушла, поправляя брошь.'},
      {v: 'Хорошо. Завтра зайду. Надеюсь, к тому времени порядок наведёте.', n: 'Терпения у неё много. Ожиданий — ещё больше.', out: 'Колокольчик звякнул, а коридор молчал.'},
      {v: 'Ок, подожду. Я же женщина спокойная. Но запомню это.', n: 'Спокойствие заразно, а память — длинная.', out: 'Она ушла, а кольца звенели.'}
    ],
    cold: [
      {v: 'Вот как. Что ж, есть пункт на соседней улице. Там хотя бы не спорят.', n: 'Она не повысила голоса — и от этого стало только хуже.', out: 'Дверь закрылась, а леопард исчез.'},
      {v: 'Ок. Напишу отзыв. Я пишу честно.', n: 'Отзыв — новая форма грозы.', out: 'Она исчезла за дверью, и пункт выдохнул.'},
      {v: 'Ладно. Разговор окончен. Завтра приду и проверю лично.', n: 'Тихая угроза, с брошью.', out: 'Колокольчик звякнул, а коридор молчал.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Без сцен, просто коробка', act: 'give'},
    {icon: '💬', label: 'Поговорить с Екатериной', hint: 'Послушать про леопард, получить совет', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



const VISITOR_DYADECHKA = {
  id: 'dyadechka', name: 'Виктор Степанович', male: true, img: VISITOR_DYADECHKA_IMG,
  intros: [
    'Дверь скрипнула, и у прилавка появился полный мужчина в зелёной футболке. Он улыбался, щеки румяные, и оглядывал пункт с интересом, будто впервые в нём, хотя, казалось бы, бывал.',
    'Колокольчик звякнул, и вошёл добродушный дядечка, поправляя футболку и насвистывая. Он посмотрел на вас с признательностью, будто вы уже что-то для него сделали.',
    'Дверь открылась, и появился лысеющий мужчина в мятой зелёной футболке. Он улыбался так, будто только что из бани.',
    'Вход распахнулся, и зашёл полный, румяный дядька. Он кивнул вам — явно человек привычный, который здесь уже бывал.'
  ],
  greeting: 'Здарова, начальник! Это ты у нас за стойкой? Ну, как жизнь, брат? Коробочка моя есть, надеюсь?',
  questions: [
    'Что в коробке? Расскажите, что там?',
    'Для дачи заказали или для гаража — а?',
    'Что в коробке — дачная приблуда или семейная?',
    'Свой человек, вижу! А заказ покажешь?',
    'Мангал заказали? У меня тоже есть, если что — покажу.'
  ],
  chatter: [
    'На даче у меня баня стоит с девяносто третьего. Дед строил. Я только лавку сменил.',
    'Сосед по даче — он вино носит, я уголь. Мы так уже двадцать лет.',
    'Вам тут хорошо, чистенько, тихо. Работал бы я тут, если б взяли.',
    'Внук говорит: дед, закажи онлайн. Я заказал — вот и сижу.',
    'Я не старый, я опытный. Это большая разница.'
  ],
  objections: [
    'Как это „нет“? Я неделю жду! Сосед с вторника шашлыки спрашивает!',
    'Погоди-погоди, молодой. Дай я сам в комп гляну. Там что-то есть, я видел.',
    'Сайт „готов к выдаче“ показывает, а вы говорите — нет. Кому верить-то?',
    'Брат, не горячись. У меня давление уже подросло.'
  ],
  refuseLines: [
    'Нельзя, Виктор Степанович. Инструкция не позволяет.',
    'Сегодня выдача закрыта для всех, без исключений.',
    'Сегодня не выдам. Завтра, может быть.',
    'Сегодня не могу, приходите в другой день.',
  ],
  silentNotes: [
    'Вы молча кивнули и отвернулись к стеллажам. Он смотрел на вас, насвистывая себе под нос.',
    'Без лишних слов вы начали искать заказ. Он терпеливо ждал, постукивая ногой в такт.',
    'Вы повернулись к полкам. Он вздохнул, будто собирался рассказать историю, но передумал и просто ждал.'
  ],
  thoughts: [
    'Такой человек, которого не обидишь, и коробку ему не найдёшь. Парадокс.',
    'Футболка в пятнах, а глаза чистые. Судить людей по футболкам — плохая привычка.',
    'Он пах углём и укропом. Пункт пах картоном. Оба запаха — свои.',
    'Рассказ про баню у него на три минуты, а коробку так и не выдал. Стоит оно того?'
  ],
  talkThoughts: [
    'Свой в доску человек: и поздоровается, и про баню расскажет.',
    'Футболка в пятнах, а глаза чистые. Судить людей по футболкам — плохая привычка.',
    'Он пах углём и укропом. Пункт пах картоном. Оба запаха — свои.'
  ],
  refuseThoughts: [
    'Рассказ про баню у него на три минуты, а коробку так и не выдал. Стоит оно того?',
    'Он назвал меня братом, а я ответил отказом. Неловко вышло.',
    'Отказать человеку, который пришёл с открытой душой, — отдельный талант.'
  ],
  hardEnds: [
    {v: 'Ладно-ладно, не буду ругаться. Приду вечером. Шашлыки подождут, они маринованные.', n: 'Шашлыки подождут. А вам — нет.', out: 'Он ушёл, похлопав себя по животу.'},
    {v: 'Хорошо, молодой. Но сосед спросит. Скажу, что ты нормальный.', n: 'Ненавязчивая рекомендация. От дядьки в мятой футболке.', out: 'Он ушёл, насвистывая ту же мелодию.'},
    {v: 'Ладно, подумаю. Может, в другое место закажу. У меня три сайта.', n: 'Три сайта. И три пункта. Рынок конкурентный.', out: 'Он поправил футболку и вышел.'},
    {v: 'Не буду злиться, я не из таких. Но приду завтра. Утром, до открытия.', n: 'Утром, до открытия. Давление растёт.', out: 'Дверь скрипнула, и пункт выдохнул.'},
    {v: 'Ок, пошёл. Только не сиди за стойкой долго, шея затекет.', n: 'Он ушёл, а совет остался висеть в воздухе.', out: 'Колокольчик звякнул, и коридор на миг пах укропом.'}
  ],
  giveEnds: [
    {v: 'Вот это по-нашему! Быстро, честно, молодой. Я всему двору тебя порекомендую.', n: 'Он хлопнул ладонью по стойке и заранее засвистел. Иду за коробкой.'},
    {v: 'Спасибо, брат! Теперь соседу можно не ждать шашлыки.', n: 'Коробка на весь двор. Ответственность — тяжёлая.'},
    {v: 'Хорошо! Приду ещё, у меня уже заказанное есть. Пункт у вас лучший, я вам говорю.', n: 'Постоянный клиент. С дачей и баней.'}
  ],
  refuseFollow: {
    hard: ['Не могу, я всё сказал.', 'Нет, сегодня — не могу. Порядок есть порядок.', 'Приходите в другой день, это финал.'],
    give: ['Ладно, забирайте коробку. Хорошего дня.', 'Так и быть, держите заказ. Только не уроните в дороге.', 'Берите и идите. Хорошего вам дня.']
  },
  lostSearch: [
    'Я обыскал все полки, но его коробки не было.',
    'В накладной посылка числилась, а на полке — чья-то забытая коробка и пыль.',
    'Я перерыл весь сектор. Ничего, даже уголка коробки не было.'
  ],
  lostReactions: [
    'Как это „пропала“?! Я неделю жду! Сосед с вторника спрашивает!',
    'Ох, это плохо. Соседу я обещал, что сегодня будет. Теперь скажу „ну, не вышло“.',
    'Коробка пропала? У меня голова кругом. Погоди, давай вместе подумаем.',
    'Ну, это плохо. Но я не злюсь, я переживаю. Шашлыки не вечны.'
  ],
  lostThoughts: [
    'Он расстроился больше за соседа, чем за себя. Свой в доску мужик.',
    'Рассказ про потерянную коробку он выдавал с дрожащим голосом. Это не игра.',
    'Пах углём и чуть расстроен. Отказать такому — сложно.'
  ],
  lostFollow: {
    sorry: [
      'Виктор Степанович, это мой косяк. К утру найду, клянусь!',
      'Накладка при сортировке, признаю. Ваш заказ найду к завтрашнему утру.',
      'Извините, посылка затерялась. Утром — на месте, это моё слово.'
    ],
    cold: [
      'Виктор Степанович, заказа нет. По акту — нет.',
      'Утеряна в пути. Претензию оформляйте, я бессилен.',
      'Коробки у нас не стояло. Полки не врут.',
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ладно, поверю, молодой. Завтра. Если я прав — жду, сосед со мной.', n: 'Завтра, в сопровождении соседа. Делегация от двора.', out: 'Он ушёл, похлопав себя по животу.'},
      {v: 'Хорошо, без сцен. Приду завтра. Надеюсь, коробка меня дождётся.', n: 'Он терпеливый, но его надежды — тяжёлые.', out: 'Колокольчик звякнул, а коридор молчал.'},
      {v: 'Ок, подожду. Шашлыки подождут, коробка — чуть-чуть. Я же человек спокойный.', n: 'Спокойствие заразно, а ответственность — всё ещё ваша.', out: 'Он ушёл, насвистывая себе под нос.'}
    ],
    cold: [
      {v: 'Ого. Ладно. Пойду в другой пункт. Там, говорят, добрее.', n: 'Голоса он не повысил, но стало грустнее.', out: 'Дверь закрылась, а запах укропа рассеялся.'},
      {v: 'Ок. Подумаю. Может, в другое место закажу.', n: 'Угроза другим пунктом. Тихая, но настоящая.', out: 'Он исчез за дверью, и пункт выдохнул.'},
      {v: 'Ладно. Всё, без разговоров. Приду завтра и проверю.', n: 'Тихая угроза, как банка укропа в кладовке.', out: 'Колокольчик звякнул, а коридор молчал.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Дело прежде всего, байки потом', act: 'give'},
    {icon: '💬', label: 'Поговорить с Виктором Степановичем', hint: 'Послушать байку, получить рекомендацию', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};



const VISITOR_GOPAR = {
  id: 'gopar', name: 'Тимур', male: true, img: VISITOR_GOPAR_IMG,
  intros: [
    'Дверь шумно распахнулась от пинка, и в пункт ввалился парень в чёрной кепке и спортивках с лампасами. В одной руке у него был телефон с разбитым в паутину экраном, в другой — связка ключей от «четырки».',
    'Колокольчик над дверью звякнул, и у стойки нарисовался коренастый парень в олимпийке. Он смачно щёлкнул пальцами, повертел ключи на пальце и уставился на меня в упор.',
    'Дверь со скрипом открылась. Вошёл местный пацан с района: кепка на лоб, руки в карманах спортивок, из кармана торчит экран телефона. Окинул прилавок оценивающим взглядом.',
    'В пункт уверенной походкой зашёл парень в спортивном костюме. Достал потёртый телефон, быстро разблокировал экран пальцем и облокотился на стойку.'
  ],
  greeting: 'Здорово, командир. Чё посылка моя приехала? Давай по-бырому, я на аварийках во дворе стою.',
  questions: [
    'Что в посылке? Запчасти на тачку заказали?',
    'Что за посылка приехала, командир?',
    'Для себя заказывали или пацанам в гараж?',
    'Запчасть на „четырке“ — заказ приехал?',
    'Нормально доехали? Во дворе с парковкой вечно беда.'
  ],
  chatter: [
    'Да там накладки на педали и ручка КПП хрустальная. Пацаны в гараже ждут, надо прикрутить.',
    'Тачка у меня чёткая, шестнарь бодрый. Главное масло вовремя лить, и зверь-машина.',
    'Я сам с третьего микрорайона. Всех тут знаю, если кто права качать будет — скажи, что от Тимура.',
    'Не люблю, когда в пунктах вату катают. Пришёл, забрал, уехал по делам. Уважаю скорость.',
    'У меня сегодня движ плотный: гараж, мойка, потом на район с пацанами. Так что давай поживее.'
  ],
  objections: [
    'Слышь, ты берега не путай! Какое „не могу“? Я чё, порожняком сюда шёл?!',
    'Ты щас кого лечишь вообще? У меня в приложении чётко написано: „Готово к выдаче“!',
    'Э, начальник, давай без приколов. Коробка моя на складе лежит, не мороси.',
    'Я тут стою, время теряю, тачка греется. Быстро коробку на стол метни!'
  ],
  refuseLines: [
    'Сегодня выдать не могу. Причин не называю.',
    'Правила для всех одни, без исключений.',
    'Приходите завтра, сейчас коробку не отдам.',
    'Сегодня выдачи нет. И объяснять не стану.'
  ],
  silentNotes: [
    'Вы молча кивнули и пошли к полкам склада. Тимур остался у стойки, крутя ключи от машины на пальце.',
    'Без лишних разговоров вы отправились за коробкой. Парень одобрительно хмыкнул и залип в телефон.',
    'Вы развернулись к стеллажам. В тишине пункта слышно было только, как он постукивает ключами по столешнице.'
  ],
  thoughts: [
    'Парень резкий, с гонором, но на самом деле просто торопится по своим гаражным делам.',
    'Типичный пацан с района: чуть что — сразу в позу, но если говорить прямо и по делу — агрессия сразу сходит.',
    'Лучше не накалять обстановку, а быстро выдать ему деталь от машины.'
  ],
  talkThoughts: [
    'Парень резкий, с гонором, но на самом деле просто торопится по своим гаражным делам.',
    'Типичный пацан с района: чуть что — сразу в позу, но если говорить прямо и по делу — агрессия сходит.',
    'У него машина на подъёмнике. Отсюда и весь тон.'
  ],
  refuseThoughts: [
    'Я сказал «нет» — и напряжение в пункте выросло вдвое. Но отступать уже поздно.',
    'Отказ он воспринял как вызов. Кажется, разговор только начинается.',
    'Проще было выдать коробку. Но я уже отказал, и теперь дело принципа.'
  ],
  hardEnds: [
    {v: 'Слышь, я этот прилавок запомнил. Завтра приду с пацанами — будешь по-другому разговаривать.', n: 'Парень с силой хлопнул ладонью по стойке, развернулся и вышел.', out: 'Дверь громко хлопнула, а за окном взревел глушитель «четырки».'},
    {v: 'Ну ты и кадр, конечно. Ладно, порожняк гонять не буду. Но отзыв тебе влуплю отборный.', n: 'Тимур сплюнул в урну, поправил кепку и зашагал к выходу.', out: 'Колокольчик над дверью нервно звякнул.'},
    {v: 'Короче, разговор окончен. Сервис у вас — чисто помойка. Бывай.', n: 'Обида застряла у него в горле, но спорить дальше он не стал.', out: 'Он вышел на улицу, громко хлопнув дверью.'},
    {v: 'Запомни прилавок, командир. Завтра пацаны заедут — вежливее будешь.', n: 'Пустая бравада. Но на всякий случай я запомнил номер его «четырки».', out: 'Тимур вышел, оставив в воздухе запах бензина. Дверь закрылась тихо — это пугало больше, чем хлопок.'},
    {v: 'Ладно, уговорили — не буду тут базарить. Но ты меня запомнил, да?', n: '«Запомнил». Похоже, что да. И это было неприятнее любых угроз.', out: 'Тимур зашагал к выходу, посвистывая — показывал, что ему всё равно. Ему не было всё равно.'}
  ],
  giveEnds: [
    {v: 'От души, братуха! По-красоте сработал, чисто по-пацански. Уважуха!', n: 'Тимур крепко пожал руку через прилавок. Всё, конфликт исчерпан.'},
    {v: 'Красава! Быстро, чётко, без лишнего базара. Держи пять звёзд на сайте!', n: 'Он довольно ухмыльнулся и убрал телефон в карман спортивок.'},
    {v: 'Вот это сервис, уважаю. Если кто на районе будет права качать — обращайся к Тимуру.', n: 'Неожиданный комплимент от грозного пацана с района.'}
  ],
  refuseFollow: {
    hard: ['Я всё сказал. Выдачи не будет.', 'Хватит качать права, освободи стойку.', 'Никаких исключений, гуляй.'],
    give: ['Ладно, держи свою запчасть и не шуми.', 'Так и быть, забирай. И погнал.', 'На, забирай заказ и не задерживай людей.']
  },
  lostSearch: [
    'Я проверил все полки, но его коробки не оказалось на складе.',
    'Номер светился в накладной, но в ячейке было пусто.',
    'Я дважды перерыл весь стеллаж — посылка пропала.'
  ],
  lostReactions: [
    'В смысле „пропала“?! Вы чё, попутали там совсем?! Я за неё бабки кровные отдал!',
    'Слышь, ты мне зубы не заговаривай! У меня тачка на подъёмнике висит без этой детали!',
    'Это чё за кидалово на ровном месте?! Где моя посылка, алё?!'
  ],
  lostThoughts: [
    'Потерять посылку у вспыльчивого пацана с района — это гарантированный взрыв эмоций.',
    'Тимур багровеет на глазах. Надо либо извиниться и пообещать найти, либо готовиться к жёсткой перепалке.'
  ],
  lostFollow: {
    sorry: [
      'Брат, признаю косяк — на приёмке завал. Завтра утром лично найду, зуб даю!',
      'Слушай, накладка с доставкой. Завтра к открытию заказ будет на стойке, обещаю!',
      'Извини по-человечески. Завтра утром лично выдам в лучшем виде.'
    ],
    cold: [
      'На складе нет. Оформляйте претензию в приложении.',
      'Посылка утеряна логистикой. Ничем помочь не могу.',
      'Ничего не знаю, коробки нет.'
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ладно, чисто на пацанском слове сошлись. Завтра утром приеду — чтоб коробка на столе лежала. Бывай.', n: 'Честное обещание сработало. Напряжение спало, Тимур пожал плечами и ушёл.', out: 'Дверь закрылась, и парень зашагал к своей машине.'},
      {v: 'Смотри мне, за язык тебя никто не тянул. Завтра в это же время буду тут. Не подведи.', n: 'Он поверил на слово, но предупредил со всей серьёзностью.', out: 'Колокольчик звякнул, Тимур убрал телефон в карман и вышел.'},
      {v: 'Раз на раз не приходится. Бывай, командир. Только ты меня запомни.', n: 'Пацанское слово — тоже валюта. Надеюсь, курс не упадёт.', out: 'Тимур кивнул своим мыслям и вышел, насвистывая.'}
    ],
    cold: [
      {v: 'Да пошёл ты со своими претензиями! Всю контору вашу на уши поставлю, понял?!', n: 'Тимур со всей дури пнул мусорку у входа и вылетел на улицу.', out: 'Дверь с грохотом захлопнулась, во дворе взревел мотор.'},
      {v: 'Ну и черти вы тут все. Ноги моей больше в этой дыре не будет!', n: 'Холодный отказ превратился в яростную обиду с жалобами везде, где только можно.', out: 'Он ушёл, громко ругаясь на всю улицу.'},
      {v: 'Запиши, браток: ты меня кинул. Это не по-пацански. Разберёмся.', n: '«Разберёмся» прозвучало как обещание. Я сделал вид, что не заметил, — и зря.', out: 'Колокольчик дребезжал добрую минуту после того, как за ним закрылась дверь.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Быстро отдать и не задерживать пацана', act: 'give'},
    {icon: '💬', label: 'Поговорить с Тимуром', hint: 'Спросить про тачку и дела на районе', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Показать характер и послать по правилам', act: 'refuse'}
  ]
};



const VISITOR_GLAMOUR = {
  id: 'glamour', name: 'Вероника', male: false, img: VISITOR_GLAMOUR_IMG,
  intros: [
    'Дверь звякнула, и в пункт вошла женщина в бежевом платье, поправляя огромные очки. На шее блеснула золотая цепь, а в руке — телефон, уже включённый в запись.',
    'Вход открылся, и появилась платиновая причёска-каре, за ней — бежевое платье, и только потом — самодовольная улыбка за огромными очками. Вероника пришла, и весь пункт начал наблюдать за ней.',
    'Колокольчик звякнул, и в дверях оказалась женщина в шикарных очках. Она задержалась у окна, чтобы проверить свет — явно не для того, чтобы посмотреть на погоду.',
    'Дверь распахнулась: бежевое платье, золотая цепь, очки. Женщина огляделась, будто выбирала, какой угол пункта лучше ляжет в кадр.'
  ],
  greeting: 'Здрасьте! Я Вероника, меня, наверное, все видели в сторис. У меня коробка, а у подписчиков — уже вопросы. Так что давайте быстрее, а?',
  questions: [
    'Что в коробке? Показывайте, что там!',
    'Крем заказали? Для зимнего ухода — самое то.',
    'Часто заказываете? Подписчики тоже у вас берут?',
    'Доставка приехала быстро?',
    'Уголок фотогеничный — покажете покупку для влога?'
  ],
  chatter: [
    'Я у себя в сторис делаю распаковки! Это отдельный контент, вы поняли.',
    'Очки — лимитированная вещь, в стране три штуки. Не тянитесь к ним сканером.',
    'Свет у вас тут хуже, чем у меня в студии. Но для пункта — нормально.',
    'Если есть минутка — снимите мой „распаковочный ритуал“, я вас в сторис отблагодарю. Сто тысяч просмотров, поверьте.',
    'Я всегда опаздываю, не говорите менеджеру — я тут процесс снимаю.'
  ],
  objections: [
    'Как это „нет“?! Я в сторис напишу про это, посмотрите, как у пункта рейтинг упадёт!',
    'Я тут двадцать минут стою! Подписчики спрашивают! Что происходит?',
    'Сегодня не выдадите? А почему тогда сайт „готов к выдаче“ показывает? Это же обман, я к юристу пойду!',
    'Подождите, молодой человек. Посмотрите мне в глаза. В моих очках написано: коробка должна быть выдана.'
  ],
  refuseLines: [
    'К сожалению, Вероника, сегодня выдача невозможна.',
    'Без исключений, даже для звёзд.',
    'Правила — правила, они не смотрят на цепочку.',
    'Понимаю вас, но сегодня — не могу.'
  ],
  silentNotes: [
    'Вы молча кивнули и отвернулись к стеллажам. Вероника успела сфотографировать вас через стекло — явно для сторис.',
    'Без лишних слов вы начали искать коробку. Она нетерпеливо проверяла телефон и убирала его в сумочку.',
    'Вы повернулись к полкам. Она проводила вас взглядом, поправляя очки.'
  ],
  thoughts: [
    'Звезда зашла, а правила пункта для всех одинаковые: коробка и номер. Странно, но как-то уравнительно.',
    'Она так много говорит про «контент», что я почти забыл, что мне нужно делать.',
    'За этими огромными очками — очень внимательный взгляд. С такой клиенткой лучше не шутить.',
    'Отказать такой яркой даме сложно. Но «сложно» — не то же самое, что «невозможно».'
  ],
  talkThoughts: [
    'Звезда зашла, а правила пункта для всех одинаковые: коробка и номер.',
    'Она так много говорит про «контент», что я почти забыл, что мне нужно делать.',
    'За огромными очками — очень внимательный взгляд.'
  ],
  refuseThoughts: [
    'Отказать такой яркой даме сложно. Но «сложно» — не то же самое, что «невозможно».',
    'Я сказал «нет» человеку с аудиторией в сто тысяч. Смелость или глупость — узнаем завтра.',
    'Она восприняла отказ как сюжет для сторис. Возможно, так и будет.'
  ],
  hardEnds: [
    {v: 'Ну всё. Этот пункт теперь будет в моих сторис. „День в пункте, где не отдают коробки“ — пятьдесят тысяч просмотров, поверьте.', n: 'Угроза, обёрнутая в золото и беж. Пункт слегка сжался.', out: 'Она поправила очки, бросила последний взгляд и вышла за дверь.'},
    {v: 'Подожду в машине. Когда будет готова — позвоните мне в видеосвязь.', n: 'Видеосвязь из машины — новый уровень давления.', out: 'Она ушла, а колокольчик звякнул чуть грустнее, чем обычно.'},
    {v: 'Ладно. Закажу в пункте через улицу. Там коробки отдают с бантиком.', n: 'Конкуренты. В бежевом платье и с золотой цепью.', out: 'Она вышла быстро, чтобы не упустить свет.'},
    {v: 'Запомните этот день. Мои подписчики запомнят его за вас.', n: 'Вес аудитории лёг на пункт. Тяжёлый, как грузовик с доставкой.', out: 'Она выпрямила цепочку и исчезла за дверью.'},
    {v: 'Я вернусь завтра. Я всегда возвращаюсь — и всё запоминаю.', n: 'Обещание от человека с отличной памятью и аудиторией.', out: 'Колокольчик звякнул, и пункт выдохнул.'}
  ],
  giveEnds: [
    {v: 'Ура! Наконец-то! Сниму распаковку — вы будете в кадре!', n: 'Она сразу начала выставлять свет и кадр, не выпуская телефон.'},
    {v: 'Вот это сервис! Пять звёзд, напишу в посте с фото вас.', n: 'С фото вас. В посте. Придётся быть готовым к славе.'},
    {v: 'Спасибо! Так держать, у пункта потенциал.', n: 'Комплимент от женщины с цепью — стоит тройной смены.'}
  ],
  refuseFollow: {
    hard: ['Боюсь, не могу, Вероника. Порядок есть порядок.', 'Нет, сегодня — не могу. Приходите завтра.', 'Правила — правила. Для них нет ни цепочек, ни сторис.'],
    give: ['Ладно, уговорили, забирайте коробку. Только без съёмки прилавка.', 'Так и быть, держите заказ. И добро бы без видео.', 'Берите, и хорошего вам дня. Это приказ.']
  },
  lostSearch: [
    'Я перерыл все полки, но коробки с её заказом нигде не было.',
    'В накладной посылка числилась, а на полке — пыль и чья-то забытая коробка.',
    'Я обыскал весь сектор трижды. Ничего.'
  ],
  lostReactions: [
    'Как это „пропала“?! Я в сторис пишу про поиск своей коробки! Будет драма!',
    'Коробка исчезла? Это же катастрофа для моего контента! Я уже „распаковку“ планировала!',
    'Подождите. Подумайте. Я даже заплачу — найдите. Ну, не заплачу, я вас „отмечу“.',
    'Мои подписчики будут спрашивать: „а где коробка?“. Придётся отвечать.'
  ],
  lostThoughts: [
    'Потерять коробку у женщины с золотой цепью — это репутационный кейс. Для обоих.',
    'Она так расстроилась, что даже очки будто потемнели сами собой.',
    'Странно: яркая, шумная женщина, а голос у неё сник, когда коробка не нашлась.'
  ],
  lostFollow: {
    sorry: [
      'Вероника, это моя ошибка. К утру я её сам найду, клянусь!',
      'Накладка при сортировке, моя вина. Завтра найду, цепью клянусь.',
      'Посылка затерялась, косяк мой. Утром — на месте.'
    ],
    cold: [
      'На складе нет, к сожалению. Сторис об этом я не пишу.',
      'Утеряна в пути. Возврат оформите — я в курсе.',
      'Коробки не существует. Подписчики мои — существуют.',
    ]
  },
  lostEnds: {
    sorry: [
      {v: 'Ладно, поверю. Завтра в одиннадцать — видеосвязь. Не опаздывайте, я сниму.', n: 'Дедлайн с камерой. Понятно, что прятаться негде.', out: 'Она поправила платье и ушла, а колокольчик звякнул как уведомление.'},
      {v: 'Хорошо, подожду. Но я в сторис напишу — „день, когда коробка пропала“.', n: 'Контент из потерянной коробки. Современный мир не прощает.', out: 'Она ушла, а телефон у неё всё ещё записывал.'},
      {v: 'Ладно, молодой человек. Завтра приду и проверю распаковку. Если коробки не будет — в сторис.', n: 'Ультиматум, обёрнутый в беж. Жёсткая, но справедливая.', out: 'Она вышла, и золотая цепь поймала последний свет.'}
    ],
    cold: [
      {v: 'Ого. Сервис на минималках. Расскажу всем.', n: 'Даже холодный отказ она превратила в контент.', out: 'Она ушла, а телефон продолжал снимать.'},
      {v: 'Ладно. Напишу отзыв. Мои подписчики умеют читать.', n: 'Отзыв — новая форма грозы.', out: 'Она поправила очки и исчезла за дверью.'},
      {v: 'Запомните этот день. Я запомню его за вас.', n: 'Некоторые обещания тяжелее любой коробки.', out: 'Дверь закрылась, и пункт замер.'}
    ]
  },
  choices: [
    {icon: '📦', label: 'Молча выдать заказ', hint: 'Дело прежде всего, сторис потом', act: 'give'},
    {icon: '💬', label: 'Поговорить с Вероникой', hint: 'Послушать про фид, вдохновиться', act: 'talk'},
    {icon: '🚫', label: 'Отказать без объяснений', hint: 'Нет — и всё. Правила есть правила', act: 'refuse'}
  ]
};


// === Аудит: подростковые варианты ответов о товаре ===
// 17-летний Егор и 15-летняя Мила не должны отвечать «жена послала», «тёша приезжает»,
// «отчёты» и «документы дома» — для них свои формулировки.
const _YOUNG_REPLIES = {
  '6101': ['Отвёртки. Папа сказал забрать, он вечно что-то латает.', 'Набор отвёрток. На трудовик в школе, пригодится.', 'Отвёртки? Ну, для дома. Мелочь, а полезно.'],
  '6102': ['Шуруповёрт. Отцу, на заказ. Я просто курьер.', 'Дрель… мне бы в руки, но родители не доверят. Пока.', 'Шуруповёрт. Сам соберу полку. Ну… с братом. Вместе.'],
  '6103': ['Ключи. Для папы, он в гараже вечно крутит.', 'Рожковые. Для дома, честно. Никто не узнает, если что.', 'Набор ключей. В подарок дяде. Ну, почти в подарок.'],
  '6104': ['Мангал. Это родители просили… через меня, конечно.', 'Гриль. На шашлыки в выходные. Пацаны сказали — база.', 'Мангал складной. Привезу — не заберу, пусть стоит. У нас дача.'],
  '6105': ['Спиннинг! Ну наконец-то, я думал, доставка вечная.', 'Удочка с катушкой. На рыбалку с классом едем, в выходные.', 'Снасти. Друг просил забрать — он стесняется. Ну, я не.'],
  '6106': ['Масло? Это для машины родителей, я просто зашёл.', 'Фильтры и масло. Папин приказ: забрать и не задерживаться.', 'Масло моторное. Ну, для гаража. Мне-то что.'],
  '6107': ['Термос! Какао на тренировках — зло, а с термосом — нет.', 'Термокружка. Чтобы чай не остыл на последних уроках.', 'Термос. В поход с отрядом собрались, по списку.'],
  '6108': ['Гантели. Тренер сказал: нарастишь — пустит в сектор.', 'Гантели разборные. Дома заниматься удобнее, чем в зале.', 'Эспандер. Для физры, все такие таскают. Ну, почти все.'],
  '6109': ['Кроссовки! С подсветкой, я полмесяца уговаривал.', 'Кроссы. Для физры — обязательные, для улицы — крутые.', 'Кроссовки. Заказал, ага. Мама одобрила — и ладно.'],
  '6110': ['Биты со свёрлами. Не мои, честно! Для дома.', 'Набор бит. Папа коллекционирует, я только забираю.', 'Свёрла. В кружке по труду всё тупится, а тут новый набор.'],
  '7101': ['Крем! Маме в подарок, она не узнает — сюрприз.', 'Увлажняющий. После школы ветер и мороз — всё обветривается.', 'Крем. Подруга сказала — топ. Я пока не верю, но взяла.'],
  '7102': ['Книга. По списку на лето, все читают, я не отстану.', 'Роман. Ну, не учебник — и то свобода.', 'Книга по психологии. Мамин совет… ладно, мой. И читать буду сама.'],
  '7103': ['Сковорода. Мне? Ну, блинчики я пеку лучше всех в классе.', 'Сковородка гранитная. Для семьи, я в списке «кто заберёт». Всегда я.', 'Сковорода. Мамин заказ, я побегушки. Но выглядит классно.'],
  '7104': ['Очки для компа. Глаза после домашки гудят, честно.', 'Солнцезащитные! Имидж, как говорят в сети.', 'Очки. Зрение минус полтора, зато красиво — плюс сто.'],
  '7105': ['Лампа с кольцом! Для видео с одноклассниками, ну… и для домашки.', 'Настольная лампа. Уроки до ночи — без неё никак.', 'Лампа. Мягкий свет: и для зеркала, и для уюта, и для конспектов.'],
  '7106': ['Кофе? Мне рано… ладно, маме забираю, честно.', 'Зерновой. За главный по завтракам назначили. Давно пора.', 'Кофе. Я учусь, мама пьёт. Справедливый обмен.'],
};
(function () {
  const _apply = (arr) => (arr || []).forEach(it => { if (_YOUNG_REPLIES[it.code]) it.youngReplies = _YOUNG_REPLIES[it.code]; });
  _apply(MALE_ITEMS); _apply(FEMALE_ITEMS);
  VISITOR_TEEN.age = 'teen';
  VISITOR_TEEN_GIRL.age = 'teen';
})();

const VISITOR_BOMZH_IMG = "assets/visitor-bomzh.webp";

const VISITOR_BOMZH = {
  id: 'bomzh',
  name: 'Федор',
  male: true,
  img: VISITOR_BOMZH_IMG,
  greeting: 'Здрасьте... У вас тут тепло, а? Можно минутку погреться?',
  intros: [
    'Дверь скрипнула и впустила холодный воздух. На пороге — мужчина в потёртой кепке и залатанном пальто, с бородой и усталыми глазами. От него пахнет улицей, но взгляд добрый.',
    'Колокольчик звякнул тихо. В пункт зашёл бездомный — в старом пальто с заплатками, шарф обмотан дважды. Он мнётся у входа, не решаясь подойти.',
    'В ПВЗ заглянул редкий гость — дядька с улицы. Пальто велико, кепка набекрень, в руках — авоська. Он озирается, будто ищет не посылку, а просто угол потеплее.'
  ],
  questions: [
    'А у вас чаёк есть? Замёрз совсем...',
    'Можно я тут минут пять постою? На улице дубак.',
    'Вы не видели, тут никто варежку не забывал?'
  ],
  chatter: [
    'Я раньше на заводе работал, а потом... да ладно, не буду грузить.',
    'У вас тут уютно, пахнет картоном и теплом. Как дома почти.',
    'Я ничего не заказывал, просто погреться зашёл. Если мешаю — скажите, я уйду.'
  ],
  thoughts: [
    'Он ничего не заказывал. Просто человек с улицы, которому холодно.',
    'В ПВЗ заходят разные люди. Этот — точно не за посылкой.',
    'Редкий гость. От него пахнет улицей, но глаза честные.'
  ],
  talkThoughts: [
    'Я предложил ему погреться. Вроде мелочь, а человеку приятно.',
    'Мы поболтали пару минут. Он рассказал про жизнь на улице — без прикрас.',
    'Иногда достаточно просто выслушать.'
  ],
  refuseThoughts: [
    'Я выгнал его на мороз. Формально я прав — ПВЗ не ночлежка. Но осадочек остался.',
    'Он ушёл, сгорбившись. На улице минус, а я только что закрыл перед ним дверь.',
    'Может, стоило быть помягче? Он же просто погреться хотел.'
  ],
  silentNotes: [
    'Он стоит у батареи, греет руки и тихо улыбается.',
    'Федор не просит ничего, просто греется. Редкая птица в нашем ПВЗ.'
  ],
  // Заглушки для совместимости с обычной логикой
  refuseLines: ['Слушай, у нас тут пункт выдачи, а не ночлежка. Давай на выход.'],
  objections: ['Да я ж ничего... Просто погреться... Ладно, уйду, не шуми.'],
  hardEnds: [{v: 'Понял, понял... Ухожу. Спасибо хоть что не пинками.', n: 'Он сгорбился и побрёл к двери.', out: 'Дверь скрипнула и закрылась. На улице завыл ветер.'}],
  giveEnds: [{v: 'Спасибо, добрый человек...', n: 'Он кивнул.', out: 'Ушёл тихо.'}],
  refuseFollow: { hard: ['Уходи, сказал!'], give: ['Ладно, грейся пять минут.'] },
  lostSearch: [], lostReactions: [], lostThoughts: [], lostFollow: {}, lostEnds: {}
};

const VISITORS = [VISITOR_MAN, VISITOR_MAN2, VISITOR_TEEN, VISITOR_BUSINESS, VISITOR_GIRL, VISITOR_TEEN_GIRL, VISITOR_GRANNY, VISITOR_GRANNY2, VISITOR_GRANDPA, VISITOR_GRANDPA2, VISITOR_BUSINESSMAN, VISITOR_BABKA, VISITOR_MAMA_TIRED, VISITOR_MAMA_BABY, VISITOR_STRANNIK, VISITOR_ZLAYA, VISITOR_DYADECHKA, VISITOR_GOPAR, VISITOR_GLAMOUR];

 // === СКАНДАЛИСТЫ: ТИПЫ КОНФЛИКТОВ ===
const SCANDAL_TYPES = [
  {
    id: 'missing_order',
    badge: '💥 ПРОПАЛ ЗАКАЗ',
    title: 'Где мой заказ?!',
    intros: [
      'Дверь распахнулась с грохотом. В пункт влетел разъярённый клиент, размахивая телефоном с трек-номером.',
      'В ПВЗ ворвался клиент на взводе — телефон в руке дрожит, голос уже на повышенных.',
      'Колокольчик над дверью истерично звякнул. На пороге — человек, который явно пришёл скандалить.'
    ],
    vLines: [
      '«Где мой заказ #{{CODE}}?! У меня в приложении написано «готов к выдаче», а вы говорите нет?! Вы его украли?!»',
      '«Я третий раз прихожу! Три дня! Вы издеваетесь?! Заказ #{{CODE}} — где он?!»',
      '«Я всё заснял! Сейчас в поддержку напишу, в Роспотребнадзор! Где моя посылка?!»'
    ],
    choices: [
      {
        icon: '😔', label: 'Спокойно извиниться и поискать ещё раз', hint: 'Безопасно: -0.08⭐, обещание до завтра',
        act: 'apologize', deltaRating: -0.08, deltaMoney: 0, createsDebt: true,
        you: '«Понимаю ваше возмущение. Давайте я ещё раз проверю все полки и заднюю комнату. Если не найду — лично обещаю найти к завтра.»',
        vOk: '«Ладно... Но это последний раз! Завтра приду — чтобы был!»',
        narrOk: 'Клиент немного остыл, но всё ещё на взводе. Вы записали его заказ в долги.'
      },
      {
        icon: '📋', label: 'Потребовать чек и доказать', hint: 'Риск: -0.20⭐ или -0.05⭐ если повезёт',
        act: 'demand_proof', deltaRating: -0.15, deltaMoney: 0, risky: true,
        you: '«Покажите чек и паспорт. У нас по базе заказа #{{CODE}} нет — возможно, он ещё в пути.»',
        vOk: '«Вот! Смотрите! А у вас бардак! Ладно, поверю что в пути...»',
        vFail: '«Что?! Вы меня ещё и виноватым делаете?! Я вам этот чек сейчас...!»',
        narrOk: 'Проверка документов слегка остудила пыл. Клиент ушёл ворча.',
        narrFail: 'Клиент воспринял это как хамство. Скандал разгорелся ещё сильнее!'
      },
      {
        icon: '🚪', label: 'Выставить за дверь', hint: 'Жёстко: -0.40⭐, но быстро закончить',
        act: 'kick', deltaRating: -0.40, deltaMoney: 0,
        you: '«Выйдите и не мешайте работать! Нет заказа — значит нет!»',
        vOk: '«Ах так?! Я вам устрою! Я всем расскажу какой тут сервис! Отзыв накатаю!»',
        narrOk: 'Клиент вылетел, хлопнув дверью. В чате дома уже пишут про ваш ПВЗ...'
      }
    ]
  },
  {
    id: 'opened_parcel',
    badge: '💥 ВСКРЫТА КОРОБКА',
    title: 'Вы рылись в моей посылке?!',
    intros: [
      'Клиент держит в руках коробку со вскрытым скотчем. Лицо красное от злости.',
      'На стойку с грохотом ставится коробка. Скотч разрезан, угол помят — клиент в бешенстве.',
      'Посетитель зашёл с уже полученной коробкой и швырнул её на стойку.'
    ],
    vLines: [
      '«Вы что, вскрывали мою посылку #{{CODE}}?! Скотч разрезан! Вы там что, примеряли?!»',
      '«Я заказал телефон, а коробка вскрыта! Где гарантия что вы не подменили?!»',
      '«Это что за сервис?! Коробка будто её пинали! Кто за это ответит?!»'
    ],
    choices: [
      {
        icon: '📹', label: 'Показать камеры и извиниться', hint: 'Если есть CCTV — почти без штрафа',
        act: 'show_cctv', deltaRating: -0.05, deltaMoney: -15,
        you: '«Давайте посмотрим по камерам — у нас всё фиксируется. И приношу извинения за вид коробки, компенсирую пакетом.»',
        vOk: '«Ну... если по камерам всё чисто... Ладно, поверю. Но осадочек остался.»',
        narrOk: 'Наличие камер спасло. Клиент успокоился, вы потеряли 15₽ на компенсации.',
        cctvBonus: true
      },
      {
        icon: '🤷', label: 'Сказать что это курьер виноват', hint: '-0.12⭐, переводим стрелки',
        act: 'blame_courier', deltaRating: -0.12, deltaMoney: 0,
        you: '«Это курьеры так везут, мы получаем уже в таком виде. Мы тут ни при чём.»',
        vOk: '«Курьеры... Вечно у вас курьеры виноваты! Ладно, заберу, но отзыв оставлю.»',
        narrOk: 'Отмазка сработала наполовину. Клиент ушёл недовольный, но без крика.'
      },
      {
        icon: '😤', label: 'Наехать в ответ: сами вскрыли!', hint: 'Ва-банк: -0.50⭐ или +0.10⭐',
        act: 'counter_attack', deltaRating: -0.35, deltaMoney: 0, risky: true,
        you: '«Вы сами её вскрыли дома и теперь пришли качать права! У нас всё под камерами!»',
        vOk: '«Чего?! Да как вы смеете?! Я... я... Ладно, может и правда задел...»',
        vFail: '«ЧТО ТЫ СКАЗАЛ?! Да я тебя... Я на тебя заявление напишу! Хамло!»',
        narrOk: 'Жёсткий ответ внезапно сработал — клиент стушевался.',
        narrFail: 'Клиент взорвался ещё сильнее. Кажется, он реально будет жаловаться везде.'
      }
    ]
  },
  {
    id: 'queue_rage',
    badge: '💥 ОЧЕРЕДЬ',
    title: 'Почему так долго?!',
    intros: [
      'В пункте скопилась очередь, и один из клиентов не выдержал.',
      'Клиент уже 15 минут ждёт, пока вы возитесь с другими заказами. Терпение лопнуло.',
      'В дверь заглянула очередь из 3 человек, и самый нетерпеливый решил высказаться.'
    ],
    vLines: [
      '«Я тут полчаса стою! У вас что, один сотрудник на весь район?! Работайте быстрее!»',
      '«Это что за обслуживание?! Я опаздываю! Вы вообще шевелиться будете?!»',
      '«Позовите старшего! Почему я должен ждать из-за каких-то коробок?!»'
    ],
    choices: [
      {
        icon: '☕', label: 'Предложить конфетку и извиниться', hint: 'Если есть конфеты — почти без штрафа',
        act: 'offer_candy', deltaRating: -0.04, deltaMoney: 0,
        you: '«Простите за ожидание, у нас сегодня завал. Возьмите конфетку, я сейчас максимально ускорюсь.»',
        vOk: '«Ладно... Конфетка — это мило. Но в следующий раз — быстрее!»',
        narrOk: 'Конфеты и вежливость творят чудеса. Очередь немного успокоилась.',
        candyBonus: true
      },
      {
        icon: '😶', label: 'Молча продолжить работать', hint: 'Игнор: -0.18⭐',
        act: 'ignore', deltaRating: -0.18, deltaMoney: 0,
        you: '«...» (молча сканируете следующую коробку, игнорируя крики)',
        vOk: '«Игноришь?! Меня?! Да я... Да я в отзыве всё напишу!»',
        narrOk: 'Молчание было воспринято как неуважение. Клиент ушёл, хлопнув дверью.'
      },
      {
        icon: '🔥', label: 'Рявкнуть: «Не нравится — идите в другой ПВЗ!»', hint: '-0.45⭐, зато честно',
        act: 'rage_back', deltaRating: -0.45, deltaMoney: 0,
        you: '«Не нравится — валите в другой пункт! У меня тут не курорт!»',
        vOk: '«Ах так?! Да я вас... Я вас засужу! Вы ещё пожалеете!»',
        narrOk: 'Вы выпустили пар, но рейтинг — тоже. Клиенты в очереди в шоке.'
      }
    ]
  },
  {
    id: 'damaged_box',
    badge: '💥 ПОМЯТА КОРОБКА',
    title: 'Вы мне всё помяли!',
    intros: [
      'Клиент достаёт из пакета помятую коробку и трясёт ею перед вами.',
      'На коробке вмятина с кулак. Клиент уверен, что это вы уронили.',
      'Посетитель пришёл с претензией — его хрупкий заказ, похоже, кидали.'
    ],
    vLines: [
      '«Смотрите! Смотрите что вы сделали с моим заказом #{{CODE}}! Там же было хрупкое!»',
      '«Я за доставку платил! А вы мне помяли всё! Кто компенсировать будет?!»',
      '«Это же подарок был! Теперь дарить стыдно! Вы вообще руками умеете работать?!»'
    ],
    choices: [
      {
        icon: '🧤', label: 'Извиниться и предложить упаковку', hint: '-0.06⭐ -10₽, мягко',
        act: 'wrap_offer', deltaRating: -0.06, deltaMoney: -10,
        you: '«Приношу извинения, при транспортировке бывает. Давайте я бесплатно упакую в наш фирменный пакет и добавлю пупырки.»',
        vOk: '«Ну... пакет хоть нормальный. Ладно, давайте.»',
        narrOk: 'Клиент принял компенсацию. Упаковка сгладила конфликт.'
      },
      {
        icon: '📦', label: 'Сказать что это заводской брак', hint: '-0.14⭐, отмазка',
        act: 'factory_defect', deltaRating: -0.14, deltaMoney: 0,
        you: '«Это с завода так пришло, мы только выдаём. Обратитесь к продавцу за компенсацией.»',
        vOk: '«С завода? Ну... может быть. Ладно, сам разберусь с продавцом.»',
        narrOk: 'Клиент не до конца поверил, но спорить не стал.'
      },
      {
        icon: '💸', label: 'Послать и не компенсировать', hint: '-0.38⭐, жёстко',
        act: 'no_comp', deltaRating: -0.38, deltaMoney: 0,
        you: '«Помята коробка, а не товар. Забирайте как есть, не нравится — оформляйте возврат.»',
        vOk: '«Вы ещё и хамите?! Да я... Да я... Всё, я пишу жалобу!»',
        narrOk: 'Клиент ушёл в ярости, оставив коробку на стойке. Пришлось самому убирать.'
      }
    ]
  }
];

 // сюда добавляем остальных персонажей

// === ПОРЦИОННЫЙ ВЫВОД ТЕКСТА СЦЕНЫ ===
// Строка: { who: 'narr' | 'v' | 'you', t: 'текст' }
const SCENE_AUTO_MS = 2400; // авто-появление следующего абзаца (поставь 0 — только по тапу)
let sceneQueue = [], sceneIdx = 0, sceneTimer = null, sceneOnDone = null, sceneVisitorName = 'Посетитель';

function appendSceneLine(line) {
  const box = document.getElementById('scene-text');
  const el = document.createElement('div');
  el.className = 'scene-line ' + line.who + (line.cls ? ' ' + line.cls : '');
  el.innerHTML = (line.who === 'narr' ? '' : '<span class="who">' + (line.who === 'you' ? 'Вы' : sceneVisitorName) + '</span>')
    + '<p' + (line.who === 'v' ? ' class="q"' : '') + '>' + line.t + '</p>';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
function showMore() { const m = document.getElementById('scene-more'); if (m) m.classList.add('show'); }
function hideMore() { const m = document.getElementById('scene-more'); if (m) m.classList.remove('show'); }

function pumpScene() {
  if (sceneIdx >= sceneQueue.length) { finishScene(); return; }
  appendSceneLine(sceneQueue[sceneIdx++]);
  if (sceneIdx >= sceneQueue.length) sceneTimer = setTimeout(finishScene, Math.min(SCENE_AUTO_MS, 1500));
  else sceneTimer = setTimeout(pumpScene, SCENE_AUTO_MS);
}
function finishScene() {
  if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; }
  hideMore();
  const cb = sceneOnDone; sceneOnDone = null; sceneQueue = [];
  if (cb) cb();
}
function tapScene() {
  if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; }
  if (sceneIdx < sceneQueue.length) pumpScene();
  else finishScene();
}
function queueSceneLines(lines, onDone) {
  document.getElementById('scene-text').innerHTML = '';
  sceneQueue = lines.slice(); sceneIdx = 0; sceneOnDone = onDone || null;
  // перезапуск разворачивания панели (снять класс -> reflow -> вернуть)
  const narrEl = document.querySelector('.scene-narration');
  narrEl.classList.remove('panel-anim');
  void narrEl.offsetWidth;
  narrEl.classList.add('panel-anim');
  showMore();
  pumpScene();
}

// === ЭКРАН СЦЕНЫ ===
// Плавная замена содержимого блока вариантов: высота анимируется,
// поэтому панель диалога сжимается/разворачивается плавно, а не прыгает.
function swapChoices(buildFn) {
  const cont = document.getElementById('scene-choices');
  if (!cont) return;
  const currentH = cont.offsetHeight;
  cont.style.transition = 'none';
  cont.style.overflow = 'hidden';
  cont.style.height = currentH + 'px';
  cont.innerHTML = '';
  buildFn(cont);
  const targetH = cont.scrollHeight;
  requestAnimationFrame(() => {
    cont.style.transition = 'height 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    cont.style.height = targetH + 'px';
  });
  setTimeout(() => {
    if (cont) {
      cont.style.height = '';
      cont.style.transition = '';
      cont.style.overflow = '';
    }
  }, 320);
}

function addSceneContinue(label, fn) {
  swapChoices(cont => {
    const btn = document.createElement('button');
    btn.className = 'scene-continue';
    btn.id = 'btn-scene-continue';
    btn.textContent = label;
    let clicked = false;
    btn.onclick = () => {
      if (clicked) return;
      clicked = true;
      btn.disabled = true;
      try { audio.tap(); } catch(e) {}
      fn();
    };
    cont.appendChild(btn);
  });
}

// Вторая волна выбора после отказа — действия одинаковы для всех персонажей,
// концовки (тексты) у каждого свои (v.hardEnds / v.giveEnds).
// Вторая волна выбора после отказа — без «проверить вместе» (мы же отказали).
// Порядок всегда: реплика сотрудника -> реплика клиента -> мысль -> итог.
const REFUSE_FOLLOWUP = [
  { icon: '🚪', label: 'Стоять на своём', hint: 'Пусть уходит без заказа', act: 'hard' },
  { icon: '📦', label: 'Всё же выдать', hint: 'Хватит споров — выдать', act: 'give' }
];

function renderRefuseFollowup(v) {
  swapChoices(cont => {
    REFUSE_FOLLOWUP.forEach((ch, idx) => {
      const b = document.createElement('button');
      b.className = 'scene-choice';
      b.style.animationDelay = (0.06 * idx) + 's';
      b.innerHTML = '<div class="scene-choice-icon">' + ch.icon + '</div><div><b>' + ch.label + '</b><span>' + ch.hint + '</span></div>';
      b.onclick = () => onRefuseFollowup(v, ch);
      cont.appendChild(b);
    });
  });
}

// Аудит #10: клиент пообещал вернуться завтра — регистрируем повторный визит.
// В отличие от registerDebtPromise это не долг сотрудника: штрафов нет,
// просто заказ и клиент возвращаются на следующий день.
const RETURN_PROMISE_RE = /(завтра|на днях|приду ещё|вернусь|через час)/i;
function registerReturnVisit(v, line) {
  try {
    if (!line || !RETURN_PROMISE_RE.test(line)) return false;
    const cust = gameState.activeVisitor;
    if (!cust || !cust.orderCode) return false;
    if (cust.isDebtVisitor) return false; // долг уже в своей очереди
    if (!gameState.promisedDebts) gameState.promisedDebts = [];
    if (gameState.promisedDebts.some(d => d.orderCode === cust.orderCode)) return false;
    gameState.promisedDebts.push({
      visitorId: v.id, visitorName: v.name, orderCode: cust.orderCode,
      itemLabel: cust.itemLabel, isMale: v.male, createdDay: gameState.day,
      isReturn: true
    });
    showToast('🔁 ' + v.name + ' придёт за заказом #' + cust.orderCode + ' завтра');
    return true;
  } catch (e) { return false; }
}

function onRefuseFollowup(v, ch) {
  audio.tap();
  gameState.lastChoice = { act: 'refuse', sub: ch.act };
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));

  // Единый стиль: нажатие плашки = реплика сотрудника (v.refuseFollow[act]),
  // затем ответ клиента (v.hardEnds / v.giveEnds), мысль, итог.
  const follow = (v.refuseFollow && v.refuseFollow[ch.act]) ? v.refuseFollow[ch.act]
    : ['Хватит. Я сказал своё.'];
  const end = ch.act === 'hard' ? pick(v.hardEnds) : pick(v.giveEnds);

  if (ch.act === 'hard') {
    // Аудит #10: если клиент в реплике обещает вернуться («приду завтра»),
    // ставим его в очередь на следующий день — иначе обещание ничем не кончалось.
    registerReturnVisit(v, end.v);
    queueSceneLines([
      { who: 'you', t: '«' + pick(follow) + '»' },
      { who: 'v', t: '«' + end.v + '»' },
      { who: 'narr', t: end.n },
      { who: 'narr', t: end.out, cls: 'finale' }
    ], () => addSceneContinue('🚪 Завершить визит', () => finishVisitWithoutParcel()));
  } else {
    queueSceneLines([
      { who: 'you', t: '«' + pick(follow) + '»' },
      { who: 'v', t: '«' + end.v + '»' },
      { who: 'narr', t: end.n }
    ], () => addSceneContinue('📦 Найти заказ на складе', showWarehouse));
  }
}

function renderSceneChoices(v) {
  swapChoices(cont => {
    v.choices.forEach((ch, idx) => {
      const b = document.createElement('button');
      b.className = 'scene-choice';
      b.style.animationDelay = (0.06 * idx) + 's';
      b.innerHTML = '<div class="scene-choice-icon">' + ch.icon + '</div><div><b>' + ch.label + '</b><span>' + ch.hint + '</span></div>';
      b.onclick = () => onSceneChoice(v, ch);
      cont.appendChild(b);
    });
  });
}

// === ХЕЛПЕРЫ ДИАЛОГА (аудит) ===
// Пул товаров персонажа. Fallback на ALL_PARCELS — там нет гендерных форм,
// поэтому «чужой» код не заставит мужчину сказать «заказала».
const SENIOR_IDS = ['granny', 'granny2', 'grandpa', 'grandpa2', 'babka'];
function visitorItemSource(v) {
  if (SENIOR_IDS.indexOf(v.id) !== -1) return SENIOR_ITEMS;
  return v.male ? MALE_ITEMS : FEMALE_ITEMS;
}
// Ищем товар: сначала в «своём» пуле, потом в нейтральном ALL_PARCELS.
// В чужой гендерный пул НЕ лезем — иначе ломаются формы рода (фикс аудита).
function findItemForVisitor(v, code) {
  const own = visitorItemSource(v).find(m => m.code === code);
  if (own) return own;
  const neutral = ALL_PARCELS.find(m => m.code === code);
  if (neutral) return neutral;
  // крайний случай: код из чужого пула — берём метку, но реплики глушим,
  // чтобы не выдать реплику не того рода
  const foreign = [SENIOR_ITEMS, MALE_ITEMS, FEMALE_ITEMS].flat().find(m => m.code === code);
  return foreign ? { code: foreign.code, label: foreign.label, replies: [] } : null;
}
// Вопрос сотрудника: отсекаем те, что называют КОНКРЕТНЫЙ товар,
// если этот товар не совпадает с тем, что реально в коробке.
const QUESTION_ITEM_HINTS = [
  [/пряж|вязан/i,            /пряж|нитк|вязан/i],
  [/чайник/i,                /чайник/i],
  [/крем|для лица|ухода/i,   /крем|мазь|бальзам/i],
  [/масло моторное|для какой тачки/i, /масл/i],
  [/мангал|шашлык/i,         /мангал|гриль/i],
  [/снаст|рыбалк|спиннинг/i, /спиннинг|снаст|удочк/i],
  [/запчаст|четырк|на тачку/i, /масл|запчаст/i],
  [/инструмент/i,            /отвёрт|ключ|шурупов|бит|свёрл/i],
  [/гаджет|одежд/i,          /наушник|чехол|телефон/i],
  [/мерч|косметик/i,         /крем|косметик/i]
];
function pickQuestion(v, item) {
  const orderRe = /заказ|короб|посыл|покуп|вещиц|что там|что в|заказал|привез|ехал|полезн|штук|мерч|гаджет|пряж|масл|мангал|крем|инструмент|снаст|что пришло|что ищем|что за/i;
  let pool = (v.questions || []).filter(q => orderRe.test(q));
  const label = item ? (item.label || '') : '';
  // выкидываем вопросы, которые «угадывают» не тот товар
  const safe = pool.filter(q => {
    for (let i = 0; i < QUESTION_ITEM_HINTS.length; i++) {
      const qRe = QUESTION_ITEM_HINTS[i][0], itemRe = QUESTION_ITEM_HINTS[i][1];
      if (qRe.test(q) && !itemRe.test(label)) return false;
    }
    return true;
  });
  if (safe.length) pool = safe;
  if (!pool.length) pool = (v.questions && v.questions.length) ? [v.questions[0]] : ['Что за заказ?'];
  return pick(pool);
}
// Мысли сотрудника разведены по веткам: в мирном диалоге не должно быть
// «я и сам не знал, почему отказываю» (фикс аудита).
function pickThought(v, mode) {
  if (mode === 'talk' && v.talkThoughts && v.talkThoughts.length) return pick(v.talkThoughts);
  if (mode === 'refuse' && v.refuseThoughts && v.refuseThoughts.length) return pick(v.refuseThoughts);
  const refuseRe = /отказ|отказыва|отказать|не выдал|мой отказ|говорить «нет»|сказал «нет»/i;
  const all = v.thoughts || [];
  const filtered = (mode === 'talk')
    ? all.filter(t => !refuseRe.test(t))
    : all.filter(t => refuseRe.test(t));
  return pick(filtered.length ? filtered : all);
}

function onSceneChoice(v, ch) {
  audio.tap();
  gameState.lastChoice = { act: ch.act };
  // Плашки не исчезают резко (иначе панель прыгает) — гаснут и ждут конца текста
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));

  const layout = document.querySelector('.scene-layout');

  if (ch.act === 'give') {
    layout.classList.remove('big-mode');
    queueSceneLines([{ who: 'narr', t: pick(v.silentNotes) }], () =>
      addSceneContinue('📦 Найти заказ на складе', showWarehouse));

  } else if (ch.act === 'talk') {
    const item = findItemForVisitor(v, gameState.activeVisitor.orderCode);
    const q = pickQuestion(v, item);
    let _pool = item ? (item.replies || []) : [];
    if (item && v.age === 'teen' && item.youngReplies && item.youngReplies.length) _pool = item.youngReplies;
    const answer = _pool.length ? pick(_pool) : 'Да так, по мелочи. Вам оно и не интересно.';
    const lines = [
      { who: 'you', t: '«' + q + '»' },
      { who: 'v', t: '«' + answer + '»' }
    ];
    if (v.chatter && v.chatter.length) {
      lines.push({ who: 'v', t: '«' + pick(v.chatter) + '»' });
    }
    lines.push({ who: 'narr', t: pickThought(v, 'talk') });
    queueSceneLines(lines, () => addSceneContinue('📦 Найти заказ на складе', showWarehouse));

  } else { // refuse: отказ -> возражение -> мысли -> вторая волна выбора
    layout.classList.add('big-mode'); // диалог отказа — крупнее
    queueSceneLines([
      { who: 'you', t: '«' + pick(v.refuseLines) + '»' },
      { who: 'v', t: '«' + pick(v.objections) + '»' },
      { who: 'narr', t: pickThought(v, 'refuse') }
    ], () => renderRefuseFollowup(v));
  }
}

// === СПЕЦИАЛЬНЫЕ ВЫБОРЫ ДЛЯ ВЕРНУВШЕГОСЯ КЛИЕНТА (ПО ДОЛГУ) ===
const DEBT_CHOICES = [
  {
    icon: '📦',
    label: '«Да, вот он! Всё как обещал»',
    hint: 'Сдержать слово и сразу выдать коробку',
    act: 'debt-give'
  },
  {
    icon: '💬',
    label: '«Пришлось повозиться, но я нашёл!»',
    hint: 'Подчеркнуть старания перед выдачей',
    act: 'debt-talk'
  },
  {
    icon: '🚫',
    label: '«Не нашёл. Причин объяснять не буду»',
    hint: 'Сломать обещание прямо в лицо',
    act: 'debt-refuse'
  }
];

function renderDebtChoices(v) {
  swapChoices(cont => {
    DEBT_CHOICES.forEach((ch, idx) => {
      const b = document.createElement('button');
      b.className = 'scene-choice';
      b.style.animationDelay = (0.06 * idx) + 's';
      b.innerHTML = '<div class="scene-choice-icon">' + ch.icon + '</div><div><b>' + ch.label + '</b><span>' + ch.hint + '</span></div>';
      b.onclick = () => onDebtChoice(v, ch);
      cont.appendChild(b);
    });
  });
}

function onDebtChoice(v, ch) {
  audio.tap();
  gameState.lastChoice = { act: ch.act };
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));
  const layout = document.querySelector('.scene-layout');

  // FIX E-8: если обещанной посылки на складе нет — не врать «всё принёс»,
  // а честно вести в сцену разбора (обещание снова / принять гнев)
  if (ch.act === 'debt-give' || ch.act === 'debt-talk') {
    const av = gameState.activeVisitor;
    const onShelf = av && (gameState.shelfParcels || []).some(p => p.code === av.orderCode && (!p.status || p.status === 'normal'));
    if (!onShelf) {
      gameState.lastChoice = { act: 'debt-empty' };
      queueSceneLines([
        { who: 'you', t: '«Секунду — всё принесу!»' },
        { who: 'narr', t: 'Вы шагнули к стеллажам… и замерли: обещанной коробки на полке не было.' },
        { who: 'v', t: '«Ну? Чего остановились? Где моя посылка?!»' }
      ], () => startLostParcel());
      return;
    }
  }

  if (ch.act === 'debt-give') {
    layout.classList.remove('big-mode');
    queueSceneLines([
      { who: 'you', t: '«Да, всё в порядке! Как обещал вчера — сегодня посылка уже на складе.»' },
      { who: 'v', t: '«Надо же, не обманули! Честно признаться, ' + said(v, 'думал', 'думала') + ', придётся ругаться. Спасибо за ответственность!»' },
      { who: 'narr', t: 'Напряжение спало. Вы сдержали слово, и клиент это оценил.' }
    ], () => addSceneContinue('📦 Найти заказ на складе', showWarehouse));

  } else if (ch.act === 'debt-talk') {
    layout.classList.remove('big-mode');
    queueSceneLines([
      { who: 'you', t: '«Пришлось побегать и потрясти утреннюю доставку, но раз обещал — сделал. Заказ на складе!»' },
      { who: 'v', t: '«Вот это я понимаю — сервис! Приятно видеть, когда люди так относятся к своей работе.»' },
      { who: 'narr', t: 'Клиент расплылся в улыбке. Личная забота всегда производит лучшее впечатление.' }
    ], () => addSceneContinue('📦 Найти заказ на складе', showWarehouse));

  } else { // debt-refuse
    layout.classList.add('big-mode');
    const cust = gameState.activeVisitor;
    if (cust) {
      const idx = (gameState.shelfParcels || []).findIndex(p => p.code === cust.orderCode && (!p.status || p.status === 'normal'));
      if (idx !== -1) {
        gameState.shelfParcels[idx].status = 'surplus';
      }
    }
    queueSceneLines([
      { who: 'you', t: '«Нет вашей посылки. И объяснять ничего не стану.»' },
      { who: 'v', t: '«Что?! Вы вчера мне лично в глаза клялись найти заказ к утру! Это форменное издевательство!»' },
      { who: 'narr', t: v.name + ' в ярости ' + said(v, 'хлопнул по стойке и вышел', 'хлопнула по стойке и вышла') + ', пообещав написать жалобы во все инстанции.', cls: 'finale' }
    ], () => addSceneContinue('🚪 Принять гнев клиента (−0.50 ⭐)', () => {
      const change = applyVisitOutcome();
      showToast('💥 Нарушено обещание! Рейтинг ' + change.toFixed(2));
      continueCustomerFlow();
    }));
  }
}



// === БОМЖ — РЕДКАЯ НЕОБЫЧНАЯ ЛИЧНОСТЬ ===
const BOMZH_EVENT = {
  id: 'bomzh',
  chance: 0.07, // 7% редкий
  badgeText: 'необычный гость',
  intros: [
    'Дверь скрипнула и впустила холодный воздух. На пороге — мужчина в потёртой кепке и залатанном пальто, с бородой и усталыми глазами. От него пахнет улицей, но взгляд добрый.',
    'Колокольчик звякнул тихо. В пункт зашёл бездомный — в старом пальто с заплатками, шарф обмотан дважды. Он мнётся у входа, не решаясь подойти.'
  ],
  lines: [
    '«Здрасьте... У вас тут тепло, а? Можно минутку погреться? Я ничего не заказывал, просто с улицы...»',
    '«Извините, что без заказа... На улице дубак, а у вас батарея тёплая. Я на пять минуточек, а?»',
    '«Добрый день... Я не за посылкой. Просто погреться зашёл, если можно. Мешать не буду.»'
  ],
  choices: [
    {
      icon: '☕',
      label: 'Пустить погреться, предложить чай и конфетку',
      hint: 'Доброта: +0.05⭐, но 50% шанс что стащит что-то со стойки',
      act: 'kind',
      deltaRating: 0.05,
      stealChance: 0.5,
      you: '«Проходите, Федор, грейся. Хотите чаю? Вон конфетки берите, не стесняйтесь.»',
      vOk: '«Ой, спасибо, добрый человек... Давно ко мне так по-человечески...»',
      narrOk: 'Федор сел у батареи, греет руки. Глаза оттаяли.'
    },
    {
      icon: '😐',
      label: 'Нейтрально: 5 минут и уходи',
      hint: 'Нейтрально: 0⭐, 50% шанс кражи',
      act: 'neutral',
      deltaRating: 0.0,
      stealChance: 0.5,
      you: '«У нас ПВЗ, а не ночлежка, но пять минут погрейтесь. Только тихо.»',
      vOk: '«Понял, спасибо... Я тихонько, в уголочке постою.»',
      narrOk: 'Он кивнул и отошёл к стене, стараясь не мешать.'
    },
    {
      icon: '😠',
      label: 'Выгнать на мороз',
      hint: 'Хамство: -0.15⭐, но 75% шанс что стащит из вредности',
      act: 'rude',
      deltaRating: -0.15,
      stealChance: 0.75,
      you: '«Вали отсюда! У нас тут не приют! Ходят тут всякие...»',
      vOk: '«Ладно-ладно, не шуми... Ухожу уже...»',
      narrOk: 'Федор сгорбился и поплёлся к выходу, бормоча что-то под нос.'
    }
  ],
  // Реплики если украл
  stealLines: {
    candy: {
      toast: '🍬 Федор утащил вазочку с конфетами! Баф «Конфеты» пропал.',
      narr: [
        'Он ушёл, но вместе с вазочкой... На стойке, где стояли конфеты, теперь пусто. Только липкий кружок.',
        'Дверь закрылась. Вы глянули на стойку — вазочки нет. На полу — одна карамелька, оброненная впопыхах.',
        'Федор ушёл, шаркая. А вместе с ним — и все конфеты. Клиенты сегодня останутся без сладкого.'
      ]
    },
    wrap: {
      toast: '🛍️ Федор утащил брендированные пакеты! Баф «Пакеты» пропал.',
      narr: [
        'Он ушёл, прижимая к груди что-то шуршащее... Вы глянули — стопки фирменных пакетов нет. Утащил.',
        'Дверь скрипнула. Вы обернулись — пакеты исчезли. Наверное, пригодятся ему для вещей.',
        'Ушёл, но вместе с пакетами. Теперь нечем упаковывать довольным клиентам.'
      ]
    },
    both: {
      toast: '💔 Федор утащил и конфеты, и пакеты! Оба бафа пропали.',
      narr: [
        'Он ушёл, и вместе с ним — и вазочка, и пакеты. Стойка опустела. На полу — только фантик.',
        'Вы проводили его взглядом и поняли: стойка стала заметно беднее. И конфет нет, и пакетов.'
      ]
    }
  },
  noStealLines: {
    kind: [
      'Федор ушёл, поблагодарив. На стойке всё на месте — видимо, совесть не позволила.',
      'Он ушёл, оставив после себя только тепло у батареи и тихое «спасибо». Ничего не пропало.',
      'Дверь закрылась. Вы проверили стойку — всё на месте. Редкий честный гость.'
    ],
    neutral: [
      'Ушёл молча. Вы глянули — вроде ничего не пропало. Повезло.',
      'Пять минут прошли. Федор кивнул и вышел. Стойка на месте.',
      'Он ушёл, шаркая. Всё осталось на месте, но в воздухе ещё висит запах улицы.'
    ],
    rude: [
      'Выгнали, но, кажется, ничего не успел стащить. Или успел? Вы проверили — вроде всё на месте.',
      'Ушёл, хлопнув дверью. Вы быстро осмотрели стойку — повезло, ничего не пропало.',
      'Он ушёл, бормоча ругательства. На стойке всё цело — в этот раз пронесло.'
    ]
  }
};


// === СКАНДАЛИСТЫ: ЛОГИКА СЦЕНЫ ===
function startScandalScene() {
  const scandal = gameState.todayScandal;
  if (!scandal) { continueCustomerFlow(); return; }
  const v = scandal.visitor;
  const type = scandal.type;

  sceneVisitorName = v.name;
  document.getElementById('scene-name').innerHTML = v.name + ' <span class="scandal-badge">скандалист</span>';
    // Более естественные подписи вместо капса с эмодзи
  const badgeMap = {
    'missing_order': { text: 'пропал заказ', cls: 'missing' },
    'opened_parcel': { text: 'вскрытая коробка', cls: 'opened' },
    'queue_rage': { text: 'очередь', cls: 'queue' },
    'damaged_box': { text: 'помятая коробка', cls: 'damaged' }
  };
  const bInfo = badgeMap[type.id] || { text: type.badge.replace('💥','').trim().toLowerCase(), cls: '' };
  document.getElementById('scene-order-code').innerHTML = '<span class="scandal-badge type-badge ' + bInfo.cls + '">' + bInfo.text + '</span>';

  const modelHost = document.getElementById('scene-model');
  modelHost.innerHTML = '';
  const mImg = document.createElement('img');
  mImg.src = v.img;
  mImg.alt = v.name;
  mImg.className = 'model-enter model-scandal';
  mImg.style.setProperty('--from-x', Math.random() < 0.5 ? '-115%' : '115%');
  modelHost.appendChild(mImg);

  const layout = document.querySelector('.scene-layout');
  if (layout) layout.classList.add('big-mode');

  // Код «пропавшего» заказа — реальный товар из пула этого посетителя, которого
  // сейчас нет на полке. FIX: раньше брался случайный номер, и завтрашний долг
  // приходил безымянной посылкой «Заказ #NNNN (скандальный)» без реплик.
  const _onShelfCodes = (gameState.shelfParcels || []).map(p => p.code);
  const _fakePool = visitorItemSource(v).filter(m => _onShelfCodes.indexOf(m.code) === -1);
  const _fakeItem = _fakePool.length ? pick(_fakePool) : null;
  const fakeCode = _fakeItem ? _fakeItem.code : String(1000 + Math.floor(Math.random()*9000));
  const intro = pick(type.intros);
  const vLineRaw = pick(type.vLines);
  const vLine = vLineRaw.replace('{{CODE}}', fakeCode);

  // Сохраняем код для использования в диалогах и завтрашнего долга
  scandal.fakeCode = fakeCode;
  scandal.fakeLabel = _fakeItem ? _fakeItem.label : null;

  queueSceneLines([
    { who: 'narr', t: intro },
    { who: 'v', t: vLine }
  ], () => renderScandalChoices(v, type));

  showScreen('screen-scene');
  try { audio.bad(); } catch(e) {}
}

function renderScandalChoices(v, type) {
  swapChoices(cont => {
    type.choices.forEach((ch, idx) => {
      const b = document.createElement('button');
      b.className = 'scene-choice scandal-choice';
      b.style.animationDelay = (0.06 * idx) + 's';
      // Подсветка бонусов
      let hint = ch.hint;
      if (ch.cctvBonus && gameState.expansion && gameState.expansion.cctv) hint += ' (у вас есть CCTV — бонус!)';
      if (ch.candyBonus && gameState.daily && gameState.daily.candy) hint += ' (конфеты помогут!)';
      b.innerHTML = '<div class="scene-choice-icon">' + ch.icon + '</div><div><b>' + ch.label + '</b><span>' + hint + '</span></div>';
      b.onclick = () => onScandalChoice(v, type, ch);
      cont.appendChild(b);
    });
  });
}

function onScandalChoice(v, type, ch) {
  audio.tap();
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));

  let deltaRating = ch.deltaRating || 0;
  let deltaMoney = ch.deltaMoney || 0;
  let isSuccess = true;
  let vResponse = ch.vOk || '«Ладно...»';
  let narrOut = ch.narrOk || 'Конфликт исчерпан.';

  // === РИСКОВЫЕ ВАРИАНТЫ ===
  if (ch.risky) {
    // 45% шанс успеха для рисковых
    isSuccess = Math.random() < 0.45;
    if (!isSuccess) {
      vResponse = ch.vFail || '«Да как вы смеете?!»';
      narrOut = ch.narrFail || 'Ситуация вышла из-под контроля!';
      // Ужесточаем штраф
      deltaRating = Math.min(deltaRating, -0.30) - 0.10; // ещё -0.10
      if (ch.act === 'counter_attack') deltaRating = -0.50;
      if (ch.act === 'demand_proof') deltaRating = -0.25;
    } else {
      // Успех — смягчаем
      if (ch.act === 'counter_attack') deltaRating = 0.10; // неожиданно уважение
      if (ch.act === 'demand_proof') deltaRating = -0.05;
    }
  }

  // === БОНУСЫ ОТ УЛУЧШЕНИЙ ===
  if (ch.cctvBonus && gameState.expansion && gameState.expansion.cctv) {
    deltaRating = Math.max(deltaRating, -0.02); // почти без штрафа
    deltaMoney = Math.min(deltaMoney, 0); // убираем компенсацию если была
    if (deltaMoney < 0) deltaMoney = Math.floor(deltaMoney / 2);
    vResponse = '«Ну раз у вас камеры... Ладно, верю. Видно что вы честные.»';
    narrOut = 'Камеры видеонаблюдения спасли вас от серьёзного штрафа!';
  }
  if (ch.candyBonus && gameState.daily && gameState.daily.candy) {
    deltaRating = deltaRating + 0.04; // чуть лучше
    vResponse = '«О, конфетка... Ну ладно, вы милый. Прощаю на первый раз.»';
  }
  if (ch.act === 'offer_candy' && !(gameState.daily && gameState.daily.candy)) {
    // без конфет чуть хуже
    deltaRating = -0.08;
  }

  // Применяем
  const prevRating = gameState.rating;
  gameState.rating = Math.max(1, Math.min(5, +(gameState.rating + deltaRating).toFixed(2)));
  gameState.money = Math.max(0, gameState.money + deltaMoney);
  if (deltaMoney !== 0) {
    gameState.dayOtherCost = (gameState.dayOtherCost || 0) + (-deltaMoney);
  }

  // Если создаёт долг (как в missing_order)
  if (ch.createsDebt) {
    const fakeCode = (gameState.todayScandal && gameState.todayScandal.fakeCode) || String(1000 + Math.floor(Math.random()*9000));
    if (!gameState.promisedDebts) gameState.promisedDebts = [];
    if (!gameState.promisedDebts.some(d => d.orderCode === fakeCode)) {
      gameState.promisedDebts.push({
        visitorId: v.id, visitorName: v.name, orderCode: fakeCode,
        itemLabel: (gameState.todayScandal && gameState.todayScandal.fakeLabel) || ('Заказ #' + fakeCode),
        isMale: v.male, createdDay: gameState.day
      });
    }
  }

  // Тексты с подстановкой кода
  const youText = (ch.you || '«...»').replace('{{CODE}}', gameState.todayScandal.fakeCode || '0000');

  queueSceneLines([
    { who: 'you', t: youText },
    { who: 'v', t: vResponse },
    { who: 'narr', t: narrOut, cls: 'finale' }
  ], () => {
    const change = (gameState.rating - prevRating).toFixed(2);
    const sign = parseFloat(change) >= 0 ? '+' : '';
    const moneyTxt = deltaMoney !== 0 ? (deltaMoney > 0 ? ' +' + deltaMoney + '₽' : ' ' + deltaMoney + '₽') : '';
    showToast('💥 Скандал: ⭐ ' + sign + change + moneyTxt);

    // Завершаем визит скандалиста
    if (gameState.todayScandal) gameState.todayScandal.done = true;
    // Небольшая задержка для драматичности
    setTimeout(() => {
      addSceneContinue('🚪 Закончить скандал', () => {
        continueCustomerFlow();
      });
    }, 300);
  });
}



// === БОМЖ: СЦЕНА И ЛОГИКА КРАЖИ ===
function startBomzhScene() {
  const bomzhData = gameState.todayBomzh;
  if (!bomzhData) { continueCustomerFlow(); return; }
  const v = bomzhData.visitor || VISITOR_BOMZH;
  const ev = BOMZH_EVENT;

  sceneVisitorName = v.name;
  document.getElementById('scene-name').innerHTML = v.name + ' <span class="scandal-badge" style="background:#f3f4f6;color:#374151;border-color:#d1d5db;">необычный гость</span>';
  document.getElementById('scene-order-code').innerHTML = '<span class="scandal-badge type-badge" style="background:#fef3c7;color:#92400e;border-color:#fde68a;">погреться</span>';

  const modelHost = document.getElementById('scene-model');
  modelHost.innerHTML = '';
  const mImg = document.createElement('img');
  mImg.src = v.img;
  mImg.alt = v.name;
  mImg.className = 'model-enter';
  mImg.style.setProperty('--from-x', (Math.random() < 0.5 ? '-115%' : '115%'));
  modelHost.appendChild(mImg);

  const layout = document.querySelector('.scene-layout');
  if (layout) layout.classList.add('big-mode');

  const intro = pick(ev.intros);
  const line = pick(ev.lines);

  queueSceneLines([
    { who: 'narr', t: intro },
    { who: 'v', t: line }
  ], () => renderBomzhChoices(v, ev));

  showScreen('screen-scene');
  try { audio.tap(); } catch(e) {}
}

function renderBomzhChoices(v, ev) {
  swapChoices(cont => {
    ev.choices.forEach((ch, idx) => {
      const b = document.createElement('button');
      b.className = 'scene-choice';
      b.style.animationDelay = (0.06 * idx) + 's';
      b.innerHTML = '<div class="scene-choice-icon">' + ch.icon + '</div><div><b>' + ch.label + '</b><span>' + ch.hint + '</span></div>';
      b.onclick = () => onBomzhChoice(v, ev, ch);
      cont.appendChild(b);
    });
  });
}

function onBomzhChoice(v, ev, ch) {
  audio.tap();
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));

  let deltaRating = ch.deltaRating || 0;
  const stealChance = ch.stealChance || 0.5;

  // Какие бафы есть сейчас?
  const hasCandy = !!(gameState.daily && gameState.daily.candy);
  const hasWrap = !!(gameState.daily && gameState.daily.wrap);
  const availableBuffs = [];
  if (hasCandy) availableBuffs.push('candy');
  if (hasWrap) availableBuffs.push('wrap');

  let stolen = null; // 'candy', 'wrap', 'both'
  let willSteal = false;

  if (availableBuffs.length > 0) {
    willSteal = Math.random() < stealChance;
    if (willSteal) {
      if (availableBuffs.length === 2) {
        // 30% шанс украсть оба, иначе один случайный
        if (Math.random() < 0.3) {
          stolen = 'both';
        } else {
          stolen = availableBuffs[Math.floor(Math.random() * availableBuffs.length)];
        }
      } else {
        stolen = availableBuffs[0];
      }
    }
  }

  // Применяем рейтинг
  const prevRating = gameState.rating;
  gameState.rating = Math.max(1, Math.min(5, +(gameState.rating + deltaRating).toFixed(2)));

  // Применяем кражу — убираем бафы
  if (stolen) {
    if (stolen === 'candy' || stolen === 'both') {
      if (gameState.daily) gameState.daily.candy = false;
    }
    if (stolen === 'wrap' || stolen === 'both') {
      if (gameState.daily) gameState.daily.wrap = false;
    }
    if (gameState.todayBomzh) gameState.todayBomzh.stolen = stolen;
  }

  // Тексты исхода
  const youText = ch.you;
  const vResponse = ch.vOk;
  let finalNarr = ch.narrOk;
  let toastText = null;

  if (stolen) {
    const stealInfo = ev.stealLines[stolen];
    if (stealInfo) {
      finalNarr = pick(stealInfo.narr);
      toastText = stealInfo.toast;
    }
  } else {
    const noStealPool = ev.noStealLines[ch.act] || ev.noStealLines['neutral'];
    finalNarr = pick(noStealPool);
  }

  queueSceneLines([
    { who: 'you', t: '«' + youText.replace('«','').replace('»','') + '»' },
    { who: 'v', t: '«' + vResponse.replace('«','').replace('»','') + '»' },
    { who: 'narr', t: finalNarr, cls: 'finale' }
  ], () => {
    const change = (gameState.rating - prevRating).toFixed(2);
    const sign = parseFloat(change) >= 0 ? '+' : '';
    if (parseFloat(change) !== 0) {
      showToast('⭐ Рейтинг ' + sign + change + (stolen ? ' | ' + (BOMZH_EVENT.stealLines[stolen] ? BOMZH_EVENT.stealLines[stolen].toast : '') : ''));
    } else if (stolen) {
      showToast(BOMZH_EVENT.stealLines[stolen].toast);
    } else {
      showToast('🚪 Федор ушёл. Ничего не пропало.');
    }

    if (gameState.todayBomzh) gameState.todayBomzh.done = true;
    updateHUD();

    setTimeout(() => {
      addSceneContinue(stolen ? '😶 Проверить стойку...' : '🚪 Проводить гостя', () => {
        if (stolen) {
          // Дополнительная плашка с объяснением
          const extraInfo = (stolen === 'both') 
            ? 'Оба бафа пропали! Конфеты и пакеты теперь не работают до следующей покупки в магазине.'
            : (stolen === 'candy' 
              ? 'Баф «Вазочка с конфетами» пропал! +25% к рейтингу больше не работает сегодня.'
              : 'Баф «Брендированные пакеты» пропал! +15₽ за довольного клиента больше не будет.');
          showToast(extraInfo);
        }
        continueCustomerFlow();
      });
    }, 400);
  });
}

function startScene() {
  YG.gameplayStart();
  // === ПРОВЕРКА НА БОМЖА (редкий гость) ===
  if (gameState.todayBomzh && !gameState.todayBomzh.done) {
    // Учитываем что скандалист мог уже увеличить visitorCount и сдвинуть позиции
    // Для простоты проверяем по текущему индексу с учётом уже пройденных редких
    let bomzhEffectivePos = gameState.todayBomzh.pos;
    if (gameState.todayScandal && gameState.todayScandal.done && gameState.todayScandal.pos < bomzhEffectivePos) {
      // скандалист уже был до бомжа — позиция бомжа уже учтена в visitorCount, но индекс уже +1
      // фактически bomzhEffectivePos остаётся как есть, так как visitorIndex уже включает прошедшего скандалиста
    }
    if (gameState.visitorIndex === bomzhEffectivePos) {
      startBomzhScene();
      return;
    }
    // Также если бомж должен быть после скандалиста и скандалист ещё не прошёл, а индекс совпадает с бомжом+1 из-за скандалиста впереди
    if (gameState.todayScandal && !gameState.todayScandal.done && gameState.todayScandal.pos < bomzhEffectivePos && gameState.visitorIndex === bomzhEffectivePos + 1) {
      // пропускаем — на самом деле это ещё не бомж, это сдвиг из-за скандалиста, но мы уже проверили скандалиста выше
    }
  }
  // === ПРОВЕРКА НА СКАНДАЛИСТА ===
  if (gameState.todayScandal && !gameState.todayScandal.done && gameState.visitorIndex === gameState.todayScandal.pos) {
    // Если бомж был до скандалиста и уже done, позиция скандалиста сдвинута на +1
    let scandalEffectivePos = gameState.todayScandal.pos;
    if (gameState.todayBomzh && gameState.todayBomzh.done && gameState.todayBomzh.pos < scandalEffectivePos) {
      scandalEffectivePos += 1;
    }
    // Проверяем с учётом сдвига
    if (gameState.visitorIndex === scandalEffectivePos || gameState.visitorIndex === gameState.todayScandal.pos) {
      startScandalScene();
      return;
    }
  }
  // Дополнительная проверка для случая когда оба есть и позиции пересекаются — бомж приоритетнее если его pos == visitorIndex
  if (gameState.todayBomzh && !gameState.todayBomzh.done && gameState.visitorIndex === gameState.todayBomzh.pos) {
    startBomzhScene();
    return;
  }

  swapChoices(() => {});
  const layout = document.querySelector('.scene-layout');
  if (layout) layout.classList.remove('big-mode');

  let v, orderCode, itemLabel = null, isDebtVisitor = false, debtData = null;

  // Если в очереди есть вчерашний долг — этот клиент идёт ПЕРВЫМ!
  if (gameState.activeDebtsQueue && gameState.activeDebtsQueue.length > 0) {
    debtData = gameState.activeDebtsQueue.shift();
    v = VISITORS.find(x => x.id === debtData.visitorId) || VISITORS.find(x => x.name === debtData.visitorName) || VISITOR_MAN;
    orderCode = debtData.orderCode;
    itemLabel = debtData.itemLabel;
    isDebtVisitor = true;
  } else {
    // Обычная ротация посетителей на сегодня из запланированного ростера
    const scandalOffset = (gameState.todayScandal && gameState.todayScandal.done && gameState.visitorIndex > gameState.todayScandal.pos) ? 1 : 0;
    const bomzhOffset = (gameState.todayBomzh && gameState.todayBomzh.done && gameState.visitorIndex > gameState.todayBomzh.pos) ? 1 : 0;
    const rosterIdx = gameState.visitorIndex - (gameState.todayDebtsCount || 0) - scandalOffset - bomzhOffset;
    if (gameState.todayVisitorRoster && gameState.todayVisitorRoster[rosterIdx]) {
      const entry = gameState.todayVisitorRoster[rosterIdx];
      v = entry.visitor;
      orderCode = entry.orderCode;
      itemLabel = entry.itemLabel;
    } else {
      const g = gameState.totalVisits || 0;
      v = VISITORS[VISITORS.length - 1 - (g % VISITORS.length)];
      const itemSource = visitorItemSource(v);
      const deliverableParcels = (gameState.shelfParcels || []).filter(p => !p.status || p.status === 'normal');
      const onShelf = deliverableParcels.map(p => p.code);
      const shelfForPool = onShelf.filter(c => itemSource.some(m => m.code === c));
      // Приоритет: свой пул -> нейтральный ALL_PARCELS -> любой с полки.
      // Нейтральный пул вставлен, чтобы не выдать реплику чужого рода (фикс аудита).
      const shelfNeutral = onShelf.filter(c => ALL_PARCELS.some(m => m.code === c));
      orderCode = shelfForPool.length ? pick(shelfForPool)
        : (shelfNeutral.length ? pick(shelfNeutral)
        : (onShelf.length ? pick(onShelf) : pick(itemSource).code));
    }
  }

  sceneVisitorName = v.name;
  const allKnown = [...ALL_PARCELS, ...MALE_ITEMS, ...SENIOR_ITEMS, ...FEMALE_ITEMS];
  const item = allKnown.find(p => p.code === orderCode) || null;
  const onShelfList = (gameState.shelfParcels || []).filter(p => !p.status || p.status === 'normal').map(p => p.code);

  gameState.activeVisitor = {
    id: v.id, name: v.name, male: v.male,
    orderCode: orderCode,
    itemLabel: item ? item.label : (itemLabel || (debtData ? debtData.itemLabel : null) || 'Заказ'),
    isDebtVisitor: isDebtVisitor,
    onShelf: onShelfList.includes(orderCode)
  };
  gameState.lastChoice = null;

  document.getElementById('scene-name').textContent = isDebtVisitor ? (v.name + ' 🔥 (за вчерашним)') : v.name;
  document.getElementById('scene-order-code').textContent = '#' + orderCode;
  const modelHost = document.getElementById('scene-model');
  modelHost.innerHTML = '';
  const mImg = document.createElement('img');
  mImg.src = v.img;
  mImg.alt = v.name;
  mImg.className = 'model-enter';
  mImg.style.setProperty('--from-x', Math.random() < 0.5 ? '-115%' : '115%');
  modelHost.appendChild(mImg);

  if (isDebtVisitor) {
    queueSceneLines([
      { who: 'narr', t: 'В пункт решительно ' + said(v, 'вошёл ', 'вошла ') + v.name + '. Вчера вы лично пообещали, что заказ #' + orderCode + ' обязательно будет готов к выдаче сегодня. ' + said(v, 'Он подошёл', 'Она подошла') + ' к стойке с ожиданием.' },
      { who: 'v', t: '«Здравствуйте! Я за своим вчерашним заказом #' + orderCode + '. Вы обещали, что сегодня он точно будет на складе. Нашли?»' }
    ], () => renderDebtChoices(v));
  } else {
    queueSceneLines([
      { who: 'narr', t: pick(v.intros) },
      { who: 'v', t: '«' + v.greeting + '»' }
    ], () => renderSceneChoices(v));
  }

  showScreen('screen-scene');
  // Один раз — гайд по выдаче (пауза сцены уже обрабатывается в showGuide)
  maybeShowGuide('issue');
}

// Тап по окну текста — следующий абзац
document.querySelector('.scene-narration').addEventListener('click', () => { if (sceneQueue.length) tapScene(); });

// === СКЛАД ===
// Склад: геометрия в пикселях арт-фона (941×1672).
// surf — поверхность полки, на которой стоит коробка; plate — рамочка номера на полке.
const BG_WH_TIER1 = "assets/bg-layer-wh.webp";
const BG_WH_TIER2 = "assets/bg-wh-tier2.webp";
const BG_WH_TIER3 = "assets/bg-wh-tier3.webp";

function updateWarehouseBackground() {
  const bg = document.getElementById('bg-layer-wh');
  if (!bg) return;
  if (gameState.warehouseCapacity <= 3) {
    bg.style.backgroundImage = 'url("' + BG_WH_TIER1 + '")';
  } else if (gameState.warehouseCapacity <= 6) {
    bg.style.backgroundImage = 'url("' + BG_WH_TIER2 + '")';
  } else {
    bg.style.backgroundImage = 'url("' + BG_WH_TIER3 + '")';
  }
}

function getWarehouseAvailableSlots() {
  if (gameState.warehouseCapacity <= 3) {
    // 1 полка (средняя): слоты 3, 4, 5
    return [3, 4, 5];
  } else if (gameState.warehouseCapacity <= 6) {
    // 2 полки (средняя + нижняя): слоты 3, 4, 5, 6, 7, 8
    return [3, 4, 5, 6, 7, 8];
  } else {
    // 3 полки (все ярусы): слоты 0..8
    return [0, 1, 2, 3, 4, 5, 6, 7, 8];
  }
}

const WH_ART = { w: 941, h: 1672 };
const WH_SLOTS = [
  { x: 205.5, surf: 573,  plate: { x0: 173, x1: 238, y0: 579,  y1: 600 } },
  { x: 462.5, surf: 573,  plate: { x0: 430, x1: 495, y0: 579,  y1: 600 } },
  { x: 728.5, surf: 573,  plate: { x0: 696, x1: 761, y0: 579,  y1: 600 } },
  { x: 205.5, surf: 921,  plate: { x0: 173, x1: 238, y0: 927,  y1: 948 } },
  { x: 462.5, surf: 921,  plate: { x0: 430, x1: 495, y0: 927,  y1: 948 } },
  { x: 728.5, surf: 921,  plate: { x0: 696, x1: 761, y0: 927,  y1: 948 } },
  { x: 205.5, surf: 1262, plate: { x0: 173, x1: 238, y0: 1275, y1: 1295 } },
  { x: 462.5, surf: 1262, plate: { x0: 430, x1: 495, y0: 1275, y1: 1295 } },
  { x: 728.5, surf: 1262, plate: { x0: 696, x1: 761, y0: 1275, y1: 1295 } }
];

// Перевод координат арта в экранные (background-size: cover)
function whMap() {
  // Фон арта растянут cover'ом по ВСЕМУ #game-container (включая зону шапки),
  // а коробки позиционируются относительно .wh-shelves (карточка). Чтобы оба
  // легли в одну рамку: масштаб и смещение считаем от контейнера и
  // вычитаем оффсет хоста (фикс Б-3).
  // ВАЖНО: оффсет хоста берём из layout-геометрии (offsetLeft/offsetTop), а НЕ из
  // getBoundingClientRect(): при входе в склад карточка анимируется fadeUp
  // (translateY(8px) → 0, 0.3 с), и rect в этот момент «плывёт» вместе с анимацией
  // — плашки/коробки оказывались смещёнными на ~8 px до ресайза окна.
  const container = document.getElementById('game-container');
  const host = document.querySelector('.wh-shelves');
  const card = document.getElementById('screen-warehouse');
  const c = container.getBoundingClientRect(); // контейнер не анимируется
  const h = host ? host.getBoundingClientRect() : c; // только высота (translate её не меняет)
  const scale = Math.max(c.width / WH_ART.w, c.height / WH_ART.h);
  let hx = 0, hy = 0;
  if (card) {
    let x = 0, y = 0, n = card;
    while (n && n.id !== 'game-container') {
      x += n.offsetLeft; y += n.offsetTop;
      n = n.offsetParent;
    }
    const cs = getComputedStyle(card);
    hx = x + (parseFloat(cs.borderLeftWidth) || 0);
    hy = y + (parseFloat(cs.borderTopWidth) || 0);
  }
  const ox = (c.width - WH_ART.w * scale) / 2 - hx;
  const oy = (c.height - WH_ART.h * scale) / 2 - hy;
  return {
    r: h, scale,
    toX: x => ox + x * scale,
    toY: y => oy + y * scale
  };
}

function whPlace(el, slot, m, isNum) {
  if (isNum) {
    el.style.left = m.toX(slot.plate.x0) + 'px';
    el.style.top = m.toY(slot.plate.y0) + 'px';
    el.style.width = ((slot.plate.x1 - slot.plate.x0) * m.scale) + 'px';
    const ph = (slot.plate.y1 - slot.plate.y0) * m.scale;
    el.style.height = ph + 'px';
    el.style.fontSize = Math.max(8, Math.min(12, ph * 1.05)) + 'px';
  } else {
    el.style.left = m.toX(slot.x) + 'px';
    el.style.bottom = (m.r.height - m.toY(slot.surf)) + 'px';
  }
}

// При изменении окна — перепозиционировать коробки по арту
window.addEventListener('resize', () => {
  if (!document.body.classList.contains('phase-warehouse')) return;
  const m = whMap();
  document.querySelectorAll('.wh-box').forEach(el => {
    const s = WH_SLOTS[+el.dataset.slot]; if (s) whPlace(el, s, m, false);
  });
  document.querySelectorAll('.wh-plate-num').forEach(el => {
    const s = WH_SLOTS[+el.dataset.slot]; if (s) whPlace(el, s, m, true);
  });
});

// Убрать мёртвый груз со склада (по ссылке на объект — и из списка, и из раскладки полок)
function removeDeadloadByRef(p) {
  gameState.shelfParcels = (gameState.shelfParcels || []).filter(x => x !== p);
  if (gameState.shelfCells) {
    Object.keys(gameState.shelfCells).forEach(k => {
      if (k !== '_day' && gameState.shelfCells[k] === p) delete gameState.shelfCells[k];
    });
  }
}

function onDeadloadClick(p) {
  try { audio.bad(); } catch(e) {}
  const typeName = (p.status === 'broken') ? 'брак' : 'излишек';
  showToast('🚫 Это ' + typeName + ' (мёртвый груз) — выдать нельзя!');
  const fb = document.getElementById('warehouse-hint-feedback');
  if (fb) {
    fb.innerHTML = '<span style="color:var(--danger);font-weight:700;">🚫 Это ' + typeName + ' — мёртвый груз, выдать клиенту нельзя.<br>Обычно его забирает курьер возвратов раз в неделю.</span>';
    // Rewarded video: убрать этот мёртвый груз прямо сейчас (п. 4.5 —
    // добровольный бонус, играть можно и без него)
    const adBtn = document.createElement('button');
    adBtn.className = 'wh-ad-btn';
    adBtn.innerHTML = '▶ Убрать ' + typeName + ' сейчас — посмотреть рекламу';
    adBtn.onclick = () => {
      if (YG.adOpen) return;
      try { audio.tap(); } catch(e) {}
      YG.rewarded(() => {
        removeDeadloadByRef(p);
        if (fb && fb.contains(adBtn)) {
          adBtn.remove();
          fb.textContent = 'Тапни по коробке и отсканируй её ШК';
          fb.style.color = 'var(--text-muted)';
        }
        showToast('🚚 ' + typeName + ' передан на возврат — склад чище!');
        updateHUD();
        showWarehouse(); // перерисовать полки
        YG.save({ phase: 'customers' });
      });
    };
    fb.appendChild(adBtn);
    setTimeout(() => {
      if (document.body.classList.contains('phase-warehouse')) {
        const cust = gameState.activeVisitor;
        if (!cust) return;
        const onShelf = (gameState.shelfParcels || []).some(item => item.code === cust.orderCode && (!item.status || item.status === 'normal'));
        if (!onShelf) {
          if (fb.querySelector('.wh-ad-btn')) {
            // Кнопка RV ещё на полке (фикс Б-8): не перезаписываем её,
            // а дописываем кнопку к клиенту рядом.
            const btn2 = document.createElement('button');
            btn2.className = 'refuse-btn';
            btn2.textContent = '❗ Разобраться с клиентом';
            btn2.onclick = startLostParcel;
            fb.appendChild(btn2);
            return;
          }
          fb.innerHTML = 'Заказа #' + cust.orderCode + ' нет на складе — он не был принят.<br>';
          fb.style.color = 'var(--danger)';
          const btn = document.createElement('button');
          btn.className = 'refuse-btn';
          btn.textContent = '❗ Разобраться с клиентом';
          btn.onclick = startLostParcel;
          fb.appendChild(btn);
        } else {
          fb.textContent = 'Тапни по коробке и отсканируй её ШК';
          fb.style.color = 'var(--text-muted)';
        }
      }
    }, 6000);
  }
}

function showWarehouse() {
  const cust = gameState.activeVisitor;
  if (!cust) return;
  document.getElementById('target-search-box-code').textContent = '#' + cust.orderCode;
  updateWarehouseBackground();
  showScreen('screen-warehouse'); // экран должен быть виден до замера позиций

  const availSlots = getWarehouseAvailableSlots();

  // На полках — только принятые посылки. Раскладка по слотам новая каждый день.
  if (!gameState.shelfCells || gameState.shelfCells._day !== gameState.day) {
    const idxs = availSlots.slice().sort(() => Math.random() - 0.5);
    const map = { _day: gameState.day };
    // Размещаем на полках в первую очередь долги и доступные к выдаче посылки, затем мёртвый груз
    // Коробка текущего клиента всегда попадает на полку первой — иначе при полном
    // складе (9 ячеек на арте) нужная посылка могла не отобразиться.
    const _gsAll = (gameState.shelfParcels || []).slice();
    const _isNorm = p => !p.status || p.status === 'normal';
    const _first = (cust && _gsAll.find(p => p.code === cust.orderCode && _isNorm(p))) || null;
    const _rest = _first ? _gsAll.filter(p => p !== _first) : _gsAll;
    const shelfSorted = [
      ...(_first ? [_first] : []),
      ..._rest.filter(p => p.isDebt),
      ..._rest.filter(p => !p.isDebt && _isNorm(p)),
      ..._rest.filter(p => p.status === 'surplus' || p.status === 'broken')
    ];
    shelfSorted.forEach((p, i) => { if (i < idxs.length) map[idxs[i]] = p; });
    gameState.shelfCells = map;
  }
  const cellsMap = gameState.shelfCells;

  const cont = document.getElementById('warehouse-grid-shelves');
  cont.innerHTML = '';
  const m = whMap();
  WH_SLOTS.forEach((slot, i) => {
    // Если слот не входит в доступные ярусы склада — не отображаем его
    if (!availSlots.includes(i)) return;

    const p = cellsMap[i];
    if (!p) return;
    const isDeadload = (p.status === 'surplus' || p.status === 'broken');
    const isBroken = (p.status === 'broken' || p.isBroken);

    // коробка стоит на поверхности полки
    const box = document.createElement('div');
    box.className = 'wh-box' + (isDeadload ? ' is-deadload' : '');
    box.dataset.slot = i;
    whPlace(box, slot, m, false);

    const spriteSrc = (isBroken && p.spriteTorn) ? p.spriteTorn : p.sprite;
    let badgeHtml = '';
    if (p.status === 'broken') {
      badgeHtml = '<div class="wh-deadload-badge badge-broken">Брак</div>';
    } else if (p.status === 'surplus') {
      badgeHtml = '<div class="wh-deadload-badge badge-surplus">Излишек</div>';
    }

    box.innerHTML = '<img src="' + spriteSrc + '" alt="' + (p.status || p.code) + '">' + badgeHtml;
    if (isDeadload) {
      box.onclick = () => onDeadloadClick(p);
    } else {
      box.onclick = () => openScan(p.code, p.code === cust.orderCode);
    }
    cont.appendChild(box);

    // Номер в рамочке на полке — только для нормальных посылок
    if (!isDeadload) {
      const num = document.createElement('div');
      num.className = 'wh-plate-num';
      num.dataset.slot = i;
      whPlace(num, slot, m, true);
      num.textContent = '#' + p.code;
      num.onclick = () => openScan(p.code, p.code === cust.orderCode);
      cont.appendChild(num);
    }
  });

  // Подсказка: если заказ не на полке (не принят или не поместился на стеллаж) — показываем кнопку выхода
  const fb = document.getElementById('warehouse-hint-feedback');
  const isVisuallyOnShelf = Object.values(cellsMap).some(p => p && p.code === cust.orderCode && (!p.status || p.status === 'normal'));
  if (!isVisuallyOnShelf) {
    fb.innerHTML = 'Заказа #' + cust.orderCode + ' нет на полках склада.<br>';
    fb.style.color = 'var(--danger)';
    const btn = document.createElement('button');
    btn.className = 'refuse-btn';
    btn.textContent = '❗ Разобраться с клиентом';
    btn.onclick = startLostParcel;
    fb.appendChild(btn);
  } else {
    fb.textContent = 'Тапни по коробке и отсканируй её ШК';
    fb.style.color = 'var(--text-muted)';
  }
}

// === ВЕТКА «ЗАКАЗ НЕ НАЙДЕН» ===
// Если на приёмке посылку не приняли (нет на складе) — не просто «отказать»,
// а полноценная сцена: поиск -> реакция клиента -> выбор сотрудника -> концовка.
const LOST_CHOICES = [
  { icon: '😔', label: 'Извиниться и обещать найти к завтра', hint: 'Мягко — он же клиент', act: 'sorry' },
  { icon: '🚪', label: 'Холодно отказать', hint: 'Нет на складе — и всё', act: 'cold' },
];

function startLostParcel() {
  audio.tap();
  swapChoices(() => {});
  const vid = gameState.activeVisitor ? gameState.activeVisitor.id : null;
  const v = VISITORS.find(x => x.id === vid) || VISITOR_MAN;
  sceneVisitorName = v.name || 'Посетитель';
  const layout = document.querySelector('.scene-layout');
  if (layout) layout.classList.add('big-mode'); // длинный диалог — крупнее

  const isDebt = gameState.activeVisitor && gameState.activeVisitor.isDebtVisitor;

  if (isDebt) {
    // Нарушенное обещание: игрок сам выбирает исход (фикс Б-7) —
    // пообещать ещё раз (долг +1 день, −0.08⭐) или принять гнев (−0.50⭐, долг сгорает).
    queueLostScene(v, [
      { who: 'narr', t: 'Вы проверили все полки склада вдоль и поперёк. Заказа #' + gameState.activeVisitor.orderCode + ' снова нет… А ведь вчера вы лично поклялись найти его к сегодняшнему дню.' },
      { who: 'v', t: '«Вы же вчера мне в глаза обещали, что сегодня всё будет на складе! Это форменное издевательство! Никакой ответственности!»' }
    ], () => {
      swapChoices(cont => {
        const choices = [
          { icon: '📅', label: 'Пообещать ещё раз — будет к завтра (−0.08⭐)', hint: 'Долг продлевается ещё на день', act: 'promise' },
          { icon: '🚪', label: 'Принять гнев клиента (−0.50⭐)', hint: 'Долг сгорит, клиент в ярости', act: 'wrath' }
        ];
        choices.forEach((ch, idx) => {
          const b = document.createElement('button');
          b.className = 'scene-choice';
          b.style.animationDelay = (0.06 * idx) + 's';
          b.innerHTML = '<div class="scene-choice-icon">' + ch.icon + '</div><div><b>' + ch.label + '</b><span>' + ch.hint + '</span></div>';
          b.onclick = () => onDebtFailChoice(v, ch.act);
          cont.appendChild(b);
        });
      });
    });
  } else {
    queueLostScene(v, [
      { who: 'narr', t: pick(v.lostSearch) },
      { who: 'v', t: '«' + pick(v.lostReactions) + '»' },
      { who: 'narr', t: pick(v.lostThoughts) }
    ], () => renderLostChoices(v));
  }

  showScreen('screen-scene');
}

function queueLostScene(v, lines, onDone) {
  document.getElementById('scene-text').innerHTML = '';
  sceneQueue = lines.slice(); sceneIdx = 0; sceneOnDone = onDone || null;
  const narrEl = document.querySelector('.scene-narration');
  narrEl.classList.remove('panel-anim');
  void narrEl.offsetWidth;
  narrEl.classList.add('panel-anim');
  showMore();
  pumpScene();
}

function renderLostChoices(v) {
  swapChoices(cont => {
    LOST_CHOICES.forEach((ch, idx) => {
      const b = document.createElement('button');
      b.className = 'scene-choice';
      b.style.animationDelay = (0.06 * idx) + 's';
      b.innerHTML = '<div class="scene-choice-icon">' + ch.icon + '</div><div><b>' + ch.label + '</b><span>' + ch.hint + '</span></div>';
      b.onclick = () => onLostChoice(v, ch);
      cont.appendChild(b);
    });
  });
}

// FIX M-7: учёт обещаний «найду к завтра» — повторные обещания дороги,
// после третьего клиент перестаёт верить и уходит (долг сгорает)
function registerDebtPromise(v, orderCode, itemLabel) {
  if (!gameState.debtAttempts) gameState.debtAttempts = {};
  const n = (gameState.debtAttempts[orderCode] || 0) + 1;
  if (n >= 3) {
    delete gameState.debtAttempts[orderCode];
    gameState.rating = Math.max(1, +(gameState.rating - 0.15).toFixed(2));
    showToast('💔 ' + v.name + ' не верит обещаниям и уходит к конкурентам (−0.15 ⭐)');
    return 'burned';
  }
  gameState.debtAttempts[orderCode] = n;
  if (n >= 2) {
    gameState.money = Math.max(0, gameState.money - 10);
    gameState.dayOtherCost = (gameState.dayOtherCost || 0) + 10;
    gameState.rating = Math.max(1, +(gameState.rating - 0.02).toFixed(2));
    showToast('⚠️ Обещание №' + n + ' по #' + orderCode + ': неустойка −10 ₽ и −0.02 ⭐');
  } else {
    showToast('📝 Обещано найти к завтра: #' + orderCode);
  }
  if (!gameState.promisedDebts) gameState.promisedDebts = [];
  if (!gameState.promisedDebts.some(d => d.orderCode === orderCode)) {
    gameState.promisedDebts.push({
      visitorId: v.id, visitorName: v.name, orderCode: orderCode, itemLabel: itemLabel,
      isMale: v.male, createdDay: gameState.day
    });
  }
  return n >= 2 ? 'retry' : 'ok';
}

function onLostChoice(v, ch) {
  audio.tap();
  gameState.lastChoice = { act: 'lost', sub: ch.act };
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));

  // Если игрок пообещал найти к завтра — сохраняем долг на следующее утро
  if (ch.act === 'sorry') {
    const _res = registerDebtPromise(v, gameState.activeVisitor.orderCode, gameState.activeVisitor.itemLabel);
    if (_res === 'burned') {
      queueSceneLines([
        { who: 'you', t: '«' + ((v.lostFollow && v.lostFollow.sorry) ? pick(v.lostFollow.sorry) : 'Я всё исправлю, обещаю.') + '»' },
        { who: 'v', t: '«Хватит обещаний. Больше я вам не верю — решайте вопросы с поддержкой.»' },
        { who: 'narr', t: 'Клиент ушёл, не прощаясь. Заказ не выдан, доверие — не вернуть.', cls: 'finale' }
      ], () => addSceneContinue('🚪 Отпустить клиента', () => continueCustomerFlow()));
      return;
    }
  }

  // Единый стиль: плашка = реплика сотрудника, потом реакция клиента и итог
  const follow = (v.lostFollow && v.lostFollow[ch.act]) ? v.lostFollow[ch.act]
    : ['Разбирайтесь сами. Посылки нет.'];
  const pool = (v.lostEnds && v.lostEnds[ch.act]) ? v.lostEnds[ch.act] : v.lostEnds.sorry;
  const end = pick(pool);
  queueSceneLines([
    { who: 'you', t: '«' + pick(follow) + '»' },
    { who: 'v', t: '«' + end.v + '»' },
    { who: 'narr', t: end.n },
    { who: 'narr', t: end.out, cls: 'finale' }
  ], () => addSceneContinue('🚪 Завершить визит', () => finishVisitWithoutParcel()));
}

// Срыв долга: выбор игрока (фикс Б-7). 'promise' — долг продлевается на день
// (рейтинг как у «извиниться и пообещать»), 'wrath' — −0.50⭐ и долг сгорает.
function onDebtFailChoice(v, act) {
  audio.tap();
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));
  YG.save();

  if (act === 'promise') {
    gameState.lastChoice = { act: 'lost', sub: 'sorry' };
    const _res = registerDebtPromise(v, gameState.activeVisitor.orderCode, gameState.activeVisitor.itemLabel);
    if (_res === 'burned') {
      queueSceneLines([
        { who: 'v', t: '«Надоело. Обещаний ваших больше не слушаю.»' },
        { who: 'narr', t: v.name + ' ' + said(v, 'махнул рукой и ушёл', 'махнула рукой и ушла') + ' — кажется, навсегда: обещания кончились.', cls: 'finale' }
      ], () => addSceneContinue('🚪 Отпустить клиента', () => continueCustomerFlow()));
      return;
    }
    const follow = (v.lostFollow && v.lostFollow.sorry) ? pick(v.lostFollow.sorry)
      : 'Простите. Это моя ошибка. К завтрашнему дню всё будет.';
    queueSceneLines([
      { who: 'you', t: '«' + follow + ' И это — личное обещание, а не слова на ветер.»' },
      { who: 'v', t: '«' + said(v, 'Я уже почти перестал вам верить. Если завтра снова провал — уйду со всеми жалобами, что накопил.', 'Я уже почти перестала вам верить. Если завтра снова провал — уйду со всеми жалобами, что накопила.') + '»' },
      { who: 'narr', t: v.name + ' ' + said(v, 'отобрал посылку и буркнул: «Последнее обещание». Заказ остаётся в долгах ещё на день.', 'отобрала посылку и буркнула: «Последнее обещание». Заказ остаётся в долгах ещё на день.'), cls: 'finale' }
    ], () => addSceneContinue('🚪 Завершить визит', () => finishVisitWithoutParcel()));
  } else {
    gameState.lastChoice = { act: 'debt-failed' };
    queueSceneLines([
      { who: 'narr', t: v.name + ' в ярости ' + said(v, 'хлопнул по стойке и вышел', 'хлопнула по стойке и вышла') + ', пообещав написать жалобы во все инстанции.', cls: 'finale' }
    ], () => addSceneContinue('🚪 Завершить визит', () => {
      const change = applyVisitOutcome();
      showToast('💥 Нарушено обещание! Рейтинг ' + change.toFixed(2));
      continueCustomerFlow();
    }));
  }
}

// Выданный заказ исчезает со склада: убираем его из списка и из раскладки по слотам.
// (Счётчик ячеек hud-stock уменьшает showResult() — здесь только визуальная часть.)
function deliverParcel(code) {
  const idx = (gameState.shelfParcels || []).findIndex(p => p.code === code && (!p.status || p.status === 'normal'));
  if (idx !== -1) {
    gameState.shelfParcels.splice(idx, 1);
  } else {
    // FIX E-7: вырезаем только «обычные» дубликаты; мёртвый груз остаётся курьеру на возврат
    gameState.shelfParcels = (gameState.shelfParcels || []).filter(p => !(p.code === code && (!p.status || p.status === 'normal')));
  }
  if (gameState.shelfCells) {
    Object.keys(gameState.shelfCells).forEach(k => {
      if (k !== '_day' && gameState.shelfCells[k] && gameState.shelfCells[k].code === code && (!gameState.shelfCells[k].status || gameState.shelfCells[k].status === 'normal')) {
        delete gameState.shelfCells[k];
      }
    });
  }
}

// === СКАНЕР ШК: зажми и держи ===
let scanState = null; // { code, isTarget, progress, timer, done }

function openScan(code, isTarget) {
  audio.tap();
  if (!gameState.scanHintShown) {
    gameState.scanHintShown = true;
    showToast('👆 Зажми штрихкод и держи, пока полоска не заполнится');
  }
  document.getElementById('scan-code').textContent = '#' + code;
  document.getElementById('scan-bc').innerHTML = invoiceBarcode(code, 6);
  document.getElementById('scan-bc-wrap').className = 'scan-bc-wrap';
  document.getElementById('scan-progress').style.width = '0%';
  document.getElementById('scan-hint').textContent = '👆 Зажми штрихкод и удерживай';
  scanState = { code, isTarget, progress: 0, timer: null, done: false };
  document.getElementById('scan-overlay').classList.add('show');
}

function scanStart() {
  try { audio.ensure(); } catch(e){}
  if (!scanState || scanState.done || scanState.timer) return;
  document.getElementById('scan-bc-wrap').classList.add('scanning');
  document.getElementById('scan-hint').textContent = 'Сканирую… держи!';
  scanState.timer = setInterval(() => {
    if (!scanState || scanState.done) return;
    scanState.progress += 2.4 + (gameState.upg.scanner || 0) * 1.8; // Про-сканер ускоряет
    document.getElementById('scan-progress').style.width = Math.min(100, scanState.progress) + '%';
    if (scanState.progress >= 100) scanDone();
  }, 40);
}

function scanStop() {
  if (!scanState || scanState.done) return;
  if (scanState.timer) { clearInterval(scanState.timer); scanState.timer = null; }
  document.getElementById('scan-bc-wrap').classList.remove('scanning');
  if (scanState.progress > 0) {
    scanState.progress = 0;
    document.getElementById('scan-progress').style.width = '0%';
    document.getElementById('scan-hint').textContent = '✋ Отпустил! Держи до конца сканирования';
  }
}

function scanDone() {
  scanState.done = true;
  if (scanState.timer) { clearInterval(scanState.timer); scanState.timer = null; }
  const wrap = document.getElementById('scan-bc-wrap');
  wrap.classList.remove('scanning');
  const hint = document.getElementById('scan-hint');
  if (scanState.isTarget) {
    wrap.classList.add('done-ok');
    hint.textContent = '✅ Заказ #' + scanState.code + ' отсканирован!';
    audio.good();
    deliverParcel(scanState.code); // выданный заказ исчезает со склада
    setTimeout(() => { closeScan(); showResult(); }, 900);
  } else {
    wrap.classList.add('done-bad');
    hint.textContent = '❌ Не тот заказ! Это #' + scanState.code;
    audio.bad();
    setTimeout(closeScan, 1200);
  }
}

function closeScan() {
  document.getElementById('scan-overlay').classList.remove('show');
  if (scanState && scanState.timer) clearInterval(scanState.timer);
  scanState = null;
}

// === ПОСЛЕДСТВИЯ ВЫБОРА ДЛЯ РЕЙТИНГА ===
// Единственная таблица, откуда берётся изменение рейтинга, и единственная функция,
// которая его меняет. Ключ — исход визита, он выводится из gameState.lastChoice.
const VISIT_RATING = {
  'give':          { delta: +0.02, label: 'молча выдал заказ',  m: '«Забрал. Спасибо.»',             f: '«Забрала. Спасибо.»' },
  'talk':          { delta: +0.10, label: 'поддержал диалог',   m: 'Спасибо, что поинтересовались!',  f: 'Спасибо, что поинтересовались!' },
  'debt-success':  { delta: +0.10, label: 'сдержал обещание (+0.10 ⭐)', m: ': «Огромное спасибо! Слово сдержали, заказ на месте. Ставлю 5 звёзд!»', f: ': «Огромное спасибо! Слово сдержали, заказ на месте. Ставлю 5 звёзд!»' },
  'debt-fail':     { delta: -0.50, label: 'нарушил обещание',   m: 'ушёл с жалобой во все инстанции!', f: 'ушла с жалобой во все инстанции!' },
  'refuse-soft':   { delta: -0.05, label: 'спор, но заказ выдан', m: 'Ну ладно. Давайте уже.',        f: 'Ну ладно. Давайте уже.' },
  'refuse-hard':   { delta: -0.25, label: 'выставил клиента',   m: 'ушёл с жалобой!',                 f: 'ушла с жалобой!' },
  'lost-sorry':    { delta: -0.08, label: 'извинился за пропажу', m: 'Ну хоть извинились. Буду ждать.', f: 'Ну хоть извинились. Буду ждать.' },
  'lost-cold':     { delta: -0.20, label: 'холодно отказал',    m: 'ушёл, не сказав ни слова.',        f: 'ушла, не сказав ни слова.' }
};

function visitRatingKey() {
  const d = gameState.lastChoice;
  if (d && (d.act === 'debt-refuse' || d.act === 'debt-failed')) return 'debt-fail';
  if (d && (d.act === 'debt-give' || d.act === 'debt-talk')) return 'debt-success';
  if (d && d.act === 'refuse') return d.sub === 'hard' ? 'refuse-hard' : 'refuse-soft';
  if (d && d.act === 'lost')   return d.sub === 'cold' ? 'lost-cold'  : 'lost-sorry';
  if (gameState.activeVisitor && gameState.activeVisitor.isDebtVisitor) {
    if (d && (d.act === 'give' || d.act === 'talk' || !d.act)) return 'debt-success';
  }
  if (!d || !d.act) return 'give';
  return VISIT_RATING[d.act] ? d.act : 'give';
}

function applyVisitOutcome() {
  const row = VISIT_RATING[visitRatingKey()] || VISIT_RATING['give'];
  let delta = row.delta;
  if (delta > 0 && gameState.daily && gameState.daily.candy) {
    delta = +(delta * 1.25).toFixed(2);
  }
  gameState.rating = Math.max(1, Math.min(5, +(gameState.rating + delta).toFixed(2)));
  return delta;
}

function visitReactionLine() {
  const cust = gameState.activeVisitor || { name: 'Посетитель', male: true };
  const rkey = visitRatingKey();
  const o = VISIT_RATING[rkey] || VISIT_RATING['give'];
  const line = cust.male ? o.m : o.f;
  if (!line) return '«Спасибо за заказ!»';
  if (line.startsWith(': «')) return line.slice(2);
  if (line.startsWith('«')) return line;
  return '«' + line + '»';
}

// Визит закончился без выдачи заказа: денег нет, но выбор всё равно влияет на рейтинг.
function finishVisitWithoutParcel() {
  const cust = gameState.activeVisitor;
  if (cust) {
    const i = (gameState.shelfParcels || []).findIndex(p =>
      p.code === cust.orderCode && (!p.status || p.status === 'normal'));
    if (i !== -1) {
      gameState.shelfParcels[i].status = 'surplus'; // теперь это невостребованный груз, курьер его заберёт
    }
  }
  const change = applyVisitOutcome();
  showToast('⭐ Рейтинг ' + (change >= 0 ? '+' : '') + change.toFixed(2));
  continueCustomerFlow();
}

// === РЕЗУЛЬТАТ ===
function showResult() {
  const isDebt = gameState.activeVisitor && gameState.activeVisitor.isDebtVisitor;
  if (isDebt) { try { delete (gameState.debtAttempts || {})[gameState.activeVisitor.orderCode]; } catch (e) {} } // M-7: долг закрыт — счётчик обещаний сбрасываем
  const rkey = visitRatingKey();
  const ratingChange = applyVisitOutcome();
  const reaction = visitReactionLine();

  // Аудит: выдача — главный источник дохода; рейтинг заметно влияет (0.4…1.5)
  const base = 55;
  const ratingMult = 0.4 + (gameState.rating / 5) * 1.1;
  const happy = (rkey === 'give' || rkey === 'talk' || rkey === 'debt-success');
  const wrapBonus = (happy && gameState.daily && gameState.daily.wrap) ? 15 : 0;
  const total = Math.round((base + wrapBonus) * ratingMult);

  gameState.dayGrossIncome = (gameState.dayGrossIncome || 0) + total;
  gameState.money = Math.max(0, gameState.money + total);

  const cust = gameState.activeVisitor || { name: 'Посетитель' };

  document.getElementById('result-badge').textContent = (rkey === 'debt-success') ? '🔥 Обещание выполнено' : '✨ Заказ выдан';
  document.getElementById('result-author-name').textContent = cust.name;
  document.getElementById('result-visitor-speech').textContent = reaction;
  
  document.getElementById('result-money-earned').textContent = (total >= 0 ? '+' : '') + total + ' ₽';
  document.getElementById('result-money-earned').style.color = total >= 0 ? 'var(--success)' : 'var(--danger)';
  
  document.getElementById('result-rating-earned').textContent = '⭐ ' + (ratingChange >= 0 ? '+' : '') + ratingChange.toFixed(2);
  document.getElementById('result-rating-earned').style.color = ratingChange >= 0 ? 'var(--info)' : 'var(--danger)';

  // Компактные теги бонусов
  const tagsRow = document.getElementById('result-tags-row');
  let tagsHtml = '';
  if (VISIT_RATING[rkey]) tagsHtml += '<span class="result-tag-chip">' + VISIT_RATING[rkey].label + '</span>';
  if (wrapBonus > 0) tagsHtml += '<span class="result-tag-chip bonus">🎁 Пакет +' + wrapBonus + ' ₽</span>';
  if (gameState.daily && gameState.daily.candy) tagsHtml += '<span class="result-tag-chip bonus">🍬 Конфеты (+25% ⭐)</span>';
  tagsRow.innerHTML = tagsHtml;

  if (total > 0) audio.coin();

  const btnNext = document.getElementById('btn-next-customer');
  if (btnNext) {
    btnNext.disabled = false;
    btnNext.textContent = (gameState.visitorIndex + 1 < gameState.visitorCount)
      ? '➡️ Следующий посетитель (' + (gameState.visitorIndex + 2) + '/' + gameState.visitorCount + ')'
      : '🌙 Завершить смену';
    btnNext.onclick = () => {
      btnNext.disabled = true;
      continueCustomerFlow();
    };
  }
  showScreen('screen-result');
}

let _flowLock = false;
function continueCustomerFlow() {
  if (_flowLock) return;
  _flowLock = true;
  setTimeout(() => { _flowLock = false; }, 600);

  audio.tap();
  gameState.visitorIndex++;
  gameState.totalVisits = (gameState.totalVisits || 0) + 1;
  if (gameState.visitorIndex < gameState.visitorCount) {
    YG.save({ phase: 'customers' }); // сейв после каждого визита (п. 1.9)
    // FIX: те же смещения, что в startScene — иначе тост называл не того, кто войдёт
    const _sc = gameState.todayScandal, _bz = gameState.todayBomzh, _vi = gameState.visitorIndex;
    const _rareNext = (_bz && !_bz.done && _vi === _bz.pos) || (_sc && !_sc.done && _vi === _sc.pos);
    const _scOff = (_sc && _sc.done && _vi > _sc.pos) ? 1 : 0;
    const _bzOff = (_bz && _bz.done && _vi > _bz.pos) ? 1 : 0;
    const nxtRosterIdx = _vi - (gameState.todayDebtsCount || 0) - _scOff - _bzOff;
    let nextName = 'Посетитель';
    if (gameState.activeDebtsQueue && gameState.activeDebtsQueue.length > 0) {
      nextName = gameState.activeDebtsQueue[0].visitorName;
    } else if (gameState.todayVisitorRoster && gameState.todayVisitorRoster[nxtRosterIdx]) {
      nextName = gameState.todayVisitorRoster[nxtRosterIdx].visitor.name;
    }
    showToast(_rareNext ? '🔔 Кто-то входит в пункт…' : ('🔔 Новый посетитель: ' + nextName));
    setTimeout(startScene, 450);
  } else {
    // Еженедельный курьер возвратов (день 7, 14, 21...) — не приходит в день 1
    const isCourierDay = (gameState.day > 0 && gameState.day % 7 === 0);
    if (isCourierDay && !gameState.courierVisitedToday) {
      gameState.courierVisitedToday = true;
      showToast('🚚 Курьер возвратов прибыл!');
      setTimeout(startCourierScene, 500);
    } else {
      gameState.courierVisitedToday = false;
      gameState.day++;
      showDayEnd();
    }
  }
}

// === СЦЕНА КУРЬЕРА ВОЗВРАТОВ (еженедельный визит) ===
function startCourierScene() {
  swapChoices(() => {});
  const layout = document.querySelector('.scene-layout');
  if (layout) layout.classList.remove('big-mode');

  sceneVisitorName = 'Сергей (Курьер)';
  document.getElementById('scene-name').textContent = 'Сергей (Курьер возвратов)';
  document.getElementById('scene-order-code').textContent = 'Вывоз брака';

  const modelHost = document.getElementById('scene-model');
  modelHost.innerHTML = '';
  const mImg = document.createElement('img');
  mImg.src = VISITOR_COURIER_IMG;
  mImg.alt = 'Курьер возвратов';
  mImg.className = 'model-enter model-courier';
  mImg.style.setProperty('--from-x', '115%');
  modelHost.appendChild(mImg);

  const deadload = (gameState.shelfParcels || []).filter(p => p.status === 'surplus' || p.status === 'broken');
  const surplusCount = deadload.filter(p => p.status === 'surplus').length;
  const brokenCount = deadload.filter(p => p.status === 'broken').length;
  const totalCount = deadload.length;
  const costPerItem = (gameState.expansion && gameState.expansion.cctv) ? 25 : 50;
  const totalFee = totalCount * costPerItem;

  if (totalCount > 0) {
    let parts = [];
    if (surplusCount > 0) parts.push(surplusCount + ' шт. излишков');
    if (brokenCount > 0) parts.push(brokenCount + ' шт. брака');
    const partsDesc = parts.join(', ');

    queueSceneLines([
      { who: 'narr', t: 'Дверь открылась, и в пункт уверенно вошёл парень в синей кепке и футболке с курьерским кейсом в руке. Оглядел помещение, кивнул мне и подошёл к стойке.' },
      { who: 'v', t: '«Здорово! Я еженедельный курьер по возвратам. Приехал забрать накопившийся брак и излишки со склада. Что у нас на вывоз?»' }
    ], () => renderCourierChoices(totalCount, totalFee, partsDesc, costPerItem));
  } else {
    queueSceneLines([
      { who: 'narr', t: 'Дверь открылась, и в пункт заглянул курьер в синей кепке и с кейсом. Он заглянул в служебную дверь склада, присвистнул и с улыбкой подошёл к стойке.' },
      { who: 'v', t: '«Здорово! Заглянул к вам на склад — а там идеальная чистота! Ни брака, ни излишков. Забирать нечего, хвалю за аккуратность!»' }
    ], () => renderCourierCleanChoices());
  }

  YG.save({ phase: 'courier' });
  showScreen('screen-scene');
  // Один раз — гайд по курьеру возвратов
  maybeShowGuide('courier');
}

function renderCourierChoices(count, fee, partsDesc, costPerItem) {
  swapChoices(cont => {
    const hasEnoughMoney = gameState.money >= fee;

    const b1 = document.createElement('button');
    b1.className = 'scene-choice' + (hasEnoughMoney ? '' : ' disabled');
    if (!hasEnoughMoney) {
      b1.disabled = true;
      b1.style.opacity = '0.55';
      b1.style.cursor = 'not-allowed';
      b1.innerHTML = '<div class="scene-choice-icon">🔒</div><div><b style="color:var(--danger)">Недостаточно денег на вывоз (-' + fee + ' ₽)</b><span>Баланс: ' + gameState.money + ' ₽ (нужно ' + fee + ' ₽)</span></div>';
    } else {
      b1.innerHTML = '<div class="scene-choice-icon">📦</div><div><b>Сдать весь мёртвый груз (-' + fee + ' ₽)</b><span>Вывезти ' + count + ' шт. (' + partsDesc + ') по ' + costPerItem + ' ₽/шт</span></div>';
      b1.onclick = () => onCourierHandover(count, fee, partsDesc);
    }
    cont.appendChild(b1);

    const b2 = document.createElement('button');
    b2.className = 'scene-choice';
    b2.innerHTML = '<div class="scene-choice-icon">💬</div><div><b>Спросить про дорогу и тарифы</b><span>Поговорить с курьером</span></div>';
    b2.onclick = () => onCourierChat(count, fee, partsDesc, costPerItem);
    cont.appendChild(b2);

    const b3 = document.createElement('button');
    b3.className = 'scene-choice';
    b3.innerHTML = '<div class="scene-choice-icon">🚫</div><div><b>Оставить всё на складе</b><span>Отказаться от вывоза (коробки останутся)</span></div>';
    b3.onclick = () => onCourierRefuse();
    cont.appendChild(b3);
  });
}

function onCourierHandover(count, fee, partsDesc) {
  if (gameState.money < fee) {
    showToast('❌ Недостаточно средств для оплаты вывоза!');
    return;
  }
  audio.tap();
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));

  // Списываем плату (учитываем в отчёте смены — E-5)
  gameState.money = Math.max(0, gameState.money - fee);
  gameState.dayCourierFee = (gameState.dayCourierFee || 0) + fee;
  // Очищаем склад от мёртвого груза
  gameState.shelfParcels = (gameState.shelfParcels || []).filter(p => p.status !== 'surplus' && p.status !== 'broken');
  if (gameState.shelfCells) {
    Object.keys(gameState.shelfCells).forEach(k => {
      if (k !== '_day' && gameState.shelfCells[k] && (gameState.shelfCells[k].status === 'surplus' || gameState.shelfCells[k].status === 'broken')) {
        delete gameState.shelfCells[k];
      }
    });
  }
  updateHUD();

  try { audio.whoosh(); } catch(e) {}

  queueSceneLines([
    { who: 'you', t: '«Забирай. Вот накопилось: ' + partsDesc + '.»' },
    { who: 'v', t: '«Отлично! Загружаю всё в фургон. Склад теперь чистый, держи акт приёмки-передачи!»' },
    { who: 'narr', t: 'Курьер ловко перетаскал коробки в фургон. На полках снова появилось свободное место для новых доставок.' },
    { who: 'narr', t: '-' + fee + ' ₽ за вывоз (' + count + ' шт.). Склад полностью очищен!', cls: 'finale' }
  ], () => addSceneContinue('🌙 Завершить смену', () => {
    gameState.courierVisitedToday = false;
    gameState.day++;
    showDayEnd();
  }));
}

function onCourierChat(count, fee, partsDesc, costPerItem) {
  audio.tap();
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));

  const hasMoney = gameState.money >= fee;
  const replyText = hasMoney
    ? '«Да как обычно: пробки, адреса, километры коробок… Тариф официальный — ' + costPerItem + ' ₽ за штуку. Готов забрать всё прямо сейчас!»'
    : '«Слушай, денег на такой вывоз, похоже, не хватает — по ' + costPerItem + ' ₽ за штуку набегает ' + fee + ' ₽. В долг я оформить не могу — регламент логистики! Подкопи к следующему разу, либо оставляем на складе.»';

  queueSceneLines([
    { who: 'you', t: '«Тяжёлый день сегодня? Как обстановка на дорогах и по тарифам?»' },
    { who: 'v', t: replyText },
    { who: 'narr', t: hasMoney ? 'Курьер достал терминал и приготовился к погрузке.' : 'Курьер развёл руками.' }
  ], () => {
    swapChoices(cont => {
      const b1 = document.createElement('button');
      b1.className = 'scene-choice' + (hasMoney ? '' : ' disabled');
      if (!hasMoney) {
        b1.disabled = true;
        b1.style.opacity = '0.55';
        b1.style.cursor = 'not-allowed';
        b1.innerHTML = '<div class="scene-choice-icon">🔒</div><div><b style="color:var(--danger)">Недостаточно денег на вывоз (-' + fee + ' ₽)</b><span>Баланс: ' + gameState.money + ' ₽ (нужно ' + fee + ' ₽)</span></div>';
      } else {
        b1.innerHTML = '<div class="scene-choice-icon">📦</div><div><b>Сдать весь мёртвый груз (-' + fee + ' ₽)</b><span>Вывезти ' + count + ' шт. (' + partsDesc + ')</span></div>';
        b1.onclick = () => onCourierHandover(count, fee, partsDesc);
      }
      cont.appendChild(b1);

      const b2 = document.createElement('button');
      b2.className = 'scene-choice';
      b2.innerHTML = '<div class="scene-choice-icon">🚫</div><div><b>Оставить на складе</b><span>Не вывозить</span></div>';
      b2.onclick = () => onCourierRefuse();
      cont.appendChild(b2);
    });
  });
}

function onCourierRefuse() {
  audio.tap();
  document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));

  queueSceneLines([
    { who: 'you', t: '«Сегодня ничего отдавать не буду, пусть пока полежит.»' },
    { who: 'v', t: '«Хозяин — барин. Но смотри, место на складе не бесконечное! До следующей недели тогда.»' },
    { who: 'narr', t: 'Курьер пожал плечами, подхватил свой кейс и вышел. Мёртвый груз остался лежать на полках склада.' }
  ], () => addSceneContinue('🌙 Завершить смену', () => {
    gameState.courierVisitedToday = false;
    gameState.day++;
    showDayEnd();
  }));
}

function renderCourierCleanChoices() {
  swapChoices(cont => {
    const b = document.createElement('button');
    b.className = 'scene-choice';
    b.innerHTML = '<div class="scene-choice-icon">👍</div><div><b>«Спасибо, стараемся держать склад в чистоте!»</b><span>Проводить курьера</span></div>';
    b.onclick = () => {
      audio.tap();
      document.querySelectorAll('.scene-choice').forEach(el => el.classList.add('disabled'));
      queueSceneLines([
        { who: 'you', t: '«Спасибо! Стараемся работать аккуратно и без ошибок.»' },
        { who: 'v', t: '«Так держать! Поехал я дальше по маршруту. Хорошего вечера!»' },
        { who: 'narr', t: 'Курьер попрощался и ушёл. За вывоз платить не пришлось — на складе полный порядок.' }
      ], () => addSceneContinue('🌙 Завершить смену', () => {
        gameState.courierVisitedToday = false;
        gameState.day++;
        showDayEnd();
      }));
    };
    cont.appendChild(b);
  });
}

function showDayEnd(opts) {
  YG.gameplayStop(); // смена окончена — меню (п. 1.19.3)
  const currentDayFinished = gameState.day - 1;
  const gross = gameState.dayGrossIncome || 0;
  const exp = getDailyExpenses(currentDayFinished);

  if ((gameState._lastExpenseDay || 0) < currentDayFinished) {
    gameState.money = Math.max(0, gameState.money - exp.total);
    gameState._lastExpenseDay = currentDayFinished;
  }
  const courierFee = gameState.dayCourierFee || 0;
  const otherCost = gameState.dayOtherCost || 0;
  const netProfit = gross - exp.total - courierFee - otherCost; // E-4/E-5: честная «чистая прибыль»

  const keepDaily = !!(opts && opts.keepDaily);
  if (!keepDaily && (gameState._dailyResetDay || 0) < currentDayFinished) {
    gameState.daily = { coffee: false, wrap: false, gloves: false, candy: false, promo: false };
    gameState._dailyResetDay = currentDayFinished;
  }

  document.getElementById('dayend-title').textContent = '🌙 День ' + currentDayFinished + ' завершён';
  document.getElementById('dayend-subtitle').textContent = 'ПВЗ закрыт на ночь. Финансовый отчёт за рабочий день:';
  
  const elGross = document.getElementById('dayend-gross');
  if (elGross) elGross.textContent = '+' + gross + ' ₽';
  
  // 🏢 «Оплата ЖКХ» — выделенный блок (аренда + коммуналка), с акцентным состоянием «каникул»
  const expBanner = document.getElementById('dayend-expense-banner');
  if (expBanner) expBanner.classList.toggle('is-holiday', !!exp.isHoliday);
  const elExp = document.getElementById('dayend-expenses');
  if (elExp) {
    elExp.textContent = exp.isHoliday ? '0 ₽' : '-' + exp.total + ' ₽';
    elExp.className = 'expense-banner-total ' + (exp.isHoliday ? 'holiday' : 'neg');
  }
  const _exIcon = document.getElementById('dayend-expense-icon');
  if (_exIcon) _exIcon.textContent = exp.isHoliday ? '🎁' : '🏢';
  const _exName = document.getElementById('dayend-expense-name');
  if (_exName) _exName.textContent = exp.isHoliday
    ? 'Каникулы! Аренда не берётся' : 'Оплата ЖКХ';
  const _exSub = document.getElementById('dayend-expense-sub');
  if (_exSub) {
    if (exp.isHoliday) {
      _exSub.textContent = 'День ' + currentDayFinished + ' из 3 — район даёт бесплатный старт 🎉';
      _exSub.style.color = 'var(--info)';
    } else {
      _exSub.textContent = 'Аренда и коммунальные платежи за день';
      _exSub.style.color = '';
    }
  }
  const _exRent = document.getElementById('dayend-expense-rent');
  if (_exRent) { _exRent.textContent = exp.isHoliday ? '0 ₽' : '-' + exp.rent + ' ₽'; _exRent.className = 'expense-break-val ' + (exp.isHoliday ? 'free' : 'neg'); }
  const _exUtil = document.getElementById('dayend-expense-util');
  if (_exUtil) { _exUtil.textContent = exp.isHoliday ? '0 ₽' : '-' + exp.utilities + ' ₽'; _exUtil.className = 'expense-break-val ' + (exp.isHoliday ? 'free' : 'neg'); }
  const _courRow = document.getElementById('dayend-courier-row');
  const _cour = document.getElementById('dayend-courier');
  if (_courRow) _courRow.style.display = (courierFee + otherCost) > 0 ? 'flex' : 'none';
  if (_cour) { _cour.textContent = '-' + (courierFee + otherCost) + ' ₽'; _cour.className = 'fin-val neg'; }

  const elNet = document.getElementById('dayend-net');
  if (elNet) {
    elNet.textContent = (netProfit >= 0 ? '+' : '') + netProfit + ' ₽';
    elNet.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
  }

  const elPurch = document.getElementById('dayend-purchases');
  if (elPurch) elPurch.textContent = (gameState.dayShopSpend || 0) > 0 ? '-' + gameState.dayShopSpend + ' ₽' : '0 ₽';

  const elMoney = document.getElementById('dayend-money');
  if (elMoney) {
    elMoney.textContent = gameState.money + ' ₽';
    elMoney.style.color = gameState.money < 100 ? 'var(--danger)' : '';
  }

  const elRating = document.getElementById('dayend-rating');
  if (elRating) elRating.textContent = gameState.rating.toFixed(2);

  const elNext = document.getElementById('dayend-nextday');
  if (elNext) elNext.textContent = gameState.day;

  // 🎯 Прогрессия целей: 9 000 к 28-му дню → 24 000 к 56-му → 40 000 к 84-му (аудит: одна цель на месяц = пустые дни после D10)
  const elGoal = document.getElementById('dayend-goal28');
  if (elGoal) {
    const GOALS = [ { d: 28, sum: 9000 }, { d: 56, sum: 24000 }, { d: 84, sum: 40000 } ];
    let _cur = null, _gi = -1;
    for (let i = 0; i < GOALS.length; i++) { if (currentDayFinished <= GOALS[i].d) { _cur = GOALS[i]; _gi = i; break; } }
    if (!_cur) _cur = GOALS[GOALS.length - 1];
    elGoal.style.display = 'block';
    if (currentDayFinished > GOALS[GOALS.length - 1].d) {
      const _ok = gameState.money >= _cur.sum;
      elGoal.style.background = _ok ? 'rgba(16, 185, 129, 0.10)' : 'rgba(245, 158, 11, 0.10)';
      elGoal.style.borderColor = _ok ? 'var(--success)' : 'var(--accent)';
      elGoal.innerHTML = _ok
        ? '👑 <b>Все цели закрыты!</b> ПВЗ — легенда района: ' + gameState.money.toLocaleString('ru-RU') + ' ₽. Дальше — свободное плавание и рекорды.'
        : '🎯 <b>Финальная цель:</b> ' + gameState.money.toLocaleString('ru-RU') + ' ₽ из ' + _cur.sum.toLocaleString('ru-RU') + ' ₽. Держитесь — район вас знает!';
    } else if (currentDayFinished >= _cur.d) {
      const _ok = gameState.money >= _cur.sum;
      elGoal.style.background = _ok ? 'rgba(16, 185, 129, 0.10)' : 'rgba(245, 158, 11, 0.10)';
      elGoal.style.borderColor = _ok ? 'var(--success)' : 'var(--accent)';
      const _nx = GOALS[_gi + 1];
      elGoal.innerHTML = _ok
        ? '🏆 <b>Цель достигнута!</b> К ' + _cur.d + '-му дню накоплено ' + gameState.money.toLocaleString('ru-RU') + ' ₽' + (_nx ? ' (нужно было ' + _cur.sum.toLocaleString('ru-RU') + ' ₽). Дальше — ' + _nx.sum.toLocaleString('ru-RU') + ' ₽ к ' + _nx.d + '-му дню!' : '.')
        : '🎯 <b>До цели ' + _cur.sum.toLocaleString('ru-RU') + ' ₽ не хватило ' + (_cur.sum - gameState.money).toLocaleString('ru-RU') + ' ₽.</b> Стеллажи, реклама и камеры ещё впереди — догоним!';
    } else {
      const _left = _cur.d - currentDayFinished;
      const _need = Math.max(0, _cur.sum - gameState.money);
      elGoal.style.background = 'rgba(245, 158, 11, 0.08)';
      elGoal.style.borderColor = 'var(--card-border)';
      elGoal.innerHTML = '🎯 Цель: <b>' + _cur.sum.toLocaleString('ru-RU') + ' ₽ к ' + _cur.d + '-му дню</b> · осталось ' + _left + ' дн. · нужно ещё ' + _need.toLocaleString('ru-RU') + ' ₽';
    }
  }

  const nextLoad = getDayLoad(gameState.day);
  // Фикс Б-17: предупреждение учитывает мёртвый груз — он тоже «съедает» места.
  const _deadNow = (gameState.shelfParcels || []).filter(p => p.status === 'surplus' || p.status === 'broken').length;
  if (nextLoad > gameState.warehouseCapacity || (_deadNow > 0 && nextLoad + _deadNow > gameState.warehouseCapacity)) {
    const sub = document.getElementById('dayend-subtitle');
    if (sub) {
      let _warn = '⚠️ ';
      if (_deadNow > 0) _warn += _deadNow + ' мёртвого груза на складе — он займёт места, и завтра часть заказов не встанет на полку. ';
      _warn += 'Клиентов завтра: ' + nextLoad + ', мест всего: ' + gameState.warehouseCapacity + '. Срочный курьер увезёт брак, стеллаж добавит мест.';
      sub.textContent = _warn;
    }
  }

  // Анти-софтлок (аудит): нулевой баланс + забитый мёртвым грузом склад = районный аварийный вывоз
  try {
    const _deadList = (gameState.shelfParcels || []).filter(p => p.status === 'surplus' || p.status === 'broken');
    if (gameState.money < 60 && _deadList.length > 0 && warehouseFree() === 0) {
      gameState.shelfParcels = (gameState.shelfParcels || []).filter(p => p.status !== 'surplus' && p.status !== 'broken');
      gameState.shelfCells = null;
      showToast('🏛 Аварийный вывоз: район бесплатно забрал мёртвый груз');
    }
  } catch (e) {}

  updateHUD();
  showScreen('screen-dayend');
  YG.save({ phase: 'dayend' });
  // Один раз — гайд по отчёту смены
  maybeShowGuide('dayend');
}

// === СИСТЕМА МАГАЗИНА УЛУЧШЕНИЙ И РАСХОДНИКОВ ===
let currentShopTab = 'expansion';

function openShopScreen() {
  audio.tap();
  const elNext = document.getElementById('shop-nextday-num');
  if (elNext) elNext.textContent = gameState.day;
  switchShopTab(currentShopTab || 'expansion');
  showScreen('screen-shop');
  YG.save({ phase: 'shop' });
  // Один раз — гайд по магазину улучшений
  maybeShowGuide('shop');
}

function switchShopTab(tab) {
  currentShopTab = tab;
  document.querySelectorAll('.shop-tab-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderShop();
}

function renderShop() {
  const grid = document.getElementById('shop-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (currentShopTab === 'expansion') {
    // 1. Стеллаж ярус 2 (6 мест)
    const rack1Bought = gameState.warehouseCapacity >= 6;
    const rack1Cost = 450;
    const canBuyRack1 = !rack1Bought && gameState.money >= rack1Cost;
    grid.appendChild(createShopCard({
      icon: '📚',
      name: 'Стеллаж (Ярус 2)',
      effect: 'Увеличение склада до 6 коробок',
      cost: rack1Cost,
      isBought: rack1Bought,
      canBuy: canBuyRack1,
      btnText: rack1Bought ? 'Куплено ✓' : `Купить ${rack1Cost} ₽`,
      onBuy: () => {
        gameState.money -= rack1Cost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + rack1Cost;
        gameState.warehouseCapacity = 6;
        if (!gameState.expansion) gameState.expansion = {};
        gameState.expansion.rack1 = true;
        updateHUD();
        renderShop();
        showToast('📚 Склад расширен до 6 мест!');
      }
    }));

    // 2. Стеллаж ярус 3 (9 мест) — последний стеллаж, «денежный люк» поздней игры
    const rack2Bought = gameState.warehouseCapacity >= 9;
    const rack2Cost = 2250;
    const canBuyRack2 = !rack2Bought && gameState.warehouseCapacity === 6 && gameState.money >= rack2Cost;
    grid.appendChild(createShopCard({
      icon: '📚',
      name: 'Стеллаж (Ярус 3)',
      effect: 'Максимальный склад на 9 коробок',
      cost: rack2Cost,
      isBought: rack2Bought,
      canBuy: canBuyRack2,
      btnText: rack2Bought ? 'Куплено ✓' : (gameState.warehouseCapacity < 6 ? 'Нужен Ярус 2' : `Купить ${rack2Cost} ₽`),
      onBuy: () => {
        gameState.money -= rack2Cost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + rack2Cost;
        gameState.warehouseCapacity = 9;
        if (!gameState.expansion) gameState.expansion = {};
        gameState.expansion.rack2 = true;
        updateHUD();
        renderShop();
        showToast('📚 Склад расширен до 9 мест!');
      }
    }));

    // Примечание (фикс Б-18): на арте склада только 3 полки (9 ячеек), поэтому
    // максимальный склад = 9 мест; четвёртого яруса больше ячеек на арте нет.
    // Денежный «люк» перенесён на последний реальный стеллаж — Ярус 3.

    // 3. Камеры CCTV
    const cctvBought = !!(gameState.expansion && gameState.expansion.cctv);
    const cctvCost = 600;
    const canBuyCctv = !cctvBought && gameState.money >= cctvCost;
    grid.appendChild(createShopCard({
      icon: '📹',
      name: 'Камеры видеонаблюдения',
      effect: 'Вывоз брака курьером в 2 раза дешевле (25 ₽/шт)',
      cost: cctvCost,
      isBought: cctvBought,
      canBuy: canBuyCctv,
      btnText: cctvBought ? 'Установлено ✓' : `Купить ${cctvCost} ₽`,
      onBuy: () => {
        gameState.money -= cctvCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + cctvCost;
        if (!gameState.expansion) gameState.expansion = {};
        gameState.expansion.cctv = true;
        updateHUD();
        renderShop();
        showToast('📹 Камеры установлены! Скидка на вывоз брака 50%');
      }
    }));

    // 4. Экстренный вызов курьера
    const deadload = (gameState.shelfParcels || []).filter(p => p.status === 'surplus' || p.status === 'broken');
    const courierFee = (gameState.expansion && gameState.expansion.cctv) ? 25 : 50;
    const totalCourierCost = 50 + deadload.length * courierFee;
    const canCallCourier = deadload.length > 0 && gameState.money >= totalCourierCost;
    grid.appendChild(createShopCard({
      icon: '🚚',
      name: 'Экстренный курьер',
      effect: deadload.length > 0 ? `Немедленно вывезти мёртвый груз (${deadload.length} шт.)` : 'Склад чист (мёртвого груза нет)',
      cost: totalCourierCost,
      isBought: false,
      canBuy: canCallCourier,
      btnText: deadload.length === 0 ? 'Склад чист' : `Вызвать (${totalCourierCost} ₽)`,
      onBuy: () => {
        gameState.money -= totalCourierCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + totalCourierCost;
        const count = deadload.length;
        gameState.shelfParcels = (gameState.shelfParcels || []).filter(p => p.status !== 'surplus' && p.status !== 'broken');
        if (gameState.shelfCells) {
          Object.keys(gameState.shelfCells).forEach(k => {
            if (k !== '_day' && gameState.shelfCells[k] && (gameState.shelfCells[k].status === 'surplus' || gameState.shelfCells[k].status === 'broken')) {
              delete gameState.shelfCells[k];
            }
          });
        }
        updateHUD();
        renderShop();
        showToast(`🚚 Курьер немедленно вывез ${count} шт. мёртвого груза!`);
      }
    }));
  } else if (currentShopTab === 'equipment') {
    // 1. Тележка (trolley) max 3
    const trolleyLvl = (gameState.upg && gameState.upg.trolley) || 0;
    const trolleyCosts = [300, 525, 750];
    const trolleyMaxed = trolleyLvl >= 3;
    const trolleyCost = trolleyCosts[trolleyLvl] || 0;
    const canBuyTrolley = !trolleyMaxed && gameState.money >= trolleyCost;
    grid.appendChild(createShopCard({
      icon: '🛒',
      name: 'Складская тележка',
      level: trolleyLvl,
      maxLevel: 3,
      effect: trolleyMaxed ? '+15 ₽ за каждую свою посылку из накладной' : `+${(trolleyLvl + 1) * 5} ₽ за каждую свою посылку из накладной`,
      cost: trolleyCost,
      isBought: trolleyMaxed,
      canBuy: canBuyTrolley,
      btnText: trolleyMaxed ? 'МАКС ✓' : `Улучшить ${trolleyCost} ₽`,
      onBuy: () => {
        gameState.money -= trolleyCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + trolleyCost;
        if (!gameState.upg) gameState.upg = {};
        gameState.upg.trolley = trolleyLvl + 1;
        updateHUD();
        renderShop();
        showToast(`🛒 Тележка улучшена до ур. ${trolleyLvl + 1}!`);
      }
    }));

    // 2. 2D-сканер (scanner) max 2
    const scannerLvl = (gameState.upg && gameState.upg.scanner) || 0;
    const scannerCosts = [270, 570];
    const scannerMaxed = scannerLvl >= 2;
    const scannerCost = scannerCosts[scannerLvl] || 0;
    const canBuyScanner = !scannerMaxed && gameState.money >= scannerCost;
    grid.appendChild(createShopCard({
      icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="3" width="16" height="12" rx="2.5" fill="#d97706"/><rect x="6.5" y="5.5" width="11" height="4" rx="1.2" fill="#fff7ed"/><path d="M8 5.5v4M10.2 5.5v4M12.4 5.5v4M14.6 5.5v4M16.8 5.5v4" stroke="#b45309" stroke-width="1.3" stroke-linecap="round"/><path d="M9.5 15 8 21a2 2 0 0 0 1.9 2.5h4.2A2 2 0 0 0 16 21l-1.5-6" stroke="#7c3aed" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6.5l4.5 4.5" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 2"/></svg>',
      name: '2D-сканер ШК',
      level: scannerLvl,
      maxLevel: 2,
      effect: scannerMaxed ? 'ШК на складе сканируется почти сразу' : `Сканер ШК на складе быстрее (ур. ${scannerLvl + 1})`,
      cost: scannerCost,
      isBought: scannerMaxed,
      canBuy: canBuyScanner,
      btnText: scannerMaxed ? 'МАКС ✓' : `Улучшить ${scannerCost} ₽`,
      onBuy: () => {
        gameState.money -= scannerCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + scannerCost;
        if (!gameState.upg) gameState.upg = {};
        gameState.upg.scanner = scannerLvl + 1;
        updateHUD();
        renderShop();
        showToast(`🔍 Сканер прокачан до ур. ${scannerLvl + 1}!`);
      }
    }));

    // 3. Налаженная сортировка (routine) max 2
    const routineLvl = (gameState.upg && gameState.upg.routine) || 0;
    const routineCosts = [225, 480];
    const routineMaxed = routineLvl >= 2;
    const routineCost = routineCosts[routineLvl] || 0;
    const canBuyRoutine = !routineMaxed && gameState.money >= routineCost;
    grid.appendChild(createShopCard({
      icon: '⏱️',
      name: 'Налаженная сортировка',
      level: routineLvl,
      maxLevel: 2,
      effect: routineMaxed ? '+16 сек к таймеру приёмки' : `+${(routineLvl + 1) * 8} сек ко времени приёмки`,
      cost: routineCost,
      isBought: routineMaxed,
      canBuy: canBuyRoutine,
      btnText: routineMaxed ? 'МАКС ✓' : `Улучшить ${routineCost} ₽`,
      onBuy: () => {
        gameState.money -= routineCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + routineCost;
        if (!gameState.upg) gameState.upg = {};
        gameState.upg.routine = routineLvl + 1;
        updateHUD();
        renderShop();
        showToast(`⏱️ Таймер приёмки увеличен!`);
      }
    }));
  } else if (currentShopTab === 'daily') {
    // 1. Брендированные пакеты (50 ₽)
    const wrapActive = !!(gameState.daily && gameState.daily.wrap);
    const wrapCost = 75;
    grid.appendChild(createShopCard({
      icon: '🛍️',
      name: 'Брендированные пакеты',
      effect: '+15 ₽ чаевых за каждого довольного клиента',
      cost: wrapCost,
      isBought: wrapActive,
      canBuy: !wrapActive && gameState.money >= wrapCost,
      btnText: wrapActive ? 'На следующую смену ✓' : `Купить ${wrapCost} ₽`,
      onBuy: () => {
        gameState.money -= wrapCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + wrapCost;
        if (!gameState.daily) gameState.daily = {};
        gameState.daily.wrap = true;
        updateHUD();
        renderShop();
        showToast('🛍️ Пакеты закуплены на следующую смену!');
      },
      // rewarded video: тот же расходник бесплатно (п. 4.5)
      ad: {
        canUse: !wrapActive,
        label: '▶ Бесплатно за рекламу',
        onUse: () => YG.rewarded(() => {
          if (!gameState.daily) gameState.daily = {};
          gameState.daily.wrap = true;
          updateHUD();
          renderShop();
          showToast('🛍️ Пакеты получены — реклама просмотрена!');
          YG.save({ phase: 'shop' });
        })
      }
    }));

    // 2. Силиконовые перчатки (75 ₽)
    const glovesActive = !!(gameState.daily && gameState.daily.gloves);
    const glovesCost = 112;
    grid.appendChild(createShopCard({
      icon: '🧤',
      name: 'Силиконовые перчатки',
      effect: 'Защита от штрафов при ошибках сортировки',
      cost: glovesCost,
      isBought: glovesActive,
      canBuy: !glovesActive && gameState.money >= glovesCost,
      btnText: glovesActive ? 'На следующую смену ✓' : `Купить ${glovesCost} ₽`,
      onBuy: () => {
        gameState.money -= glovesCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + glovesCost;
        if (!gameState.daily) gameState.daily = {};
        gameState.daily.gloves = true;
        updateHUD();
        renderShop();
        showToast('🧤 Перчатки на следующую приёмку! Ошибки без штрафа');
      },
      // rewarded video: тот же расходник бесплатно (п. 4.5)
      ad: {
        canUse: !glovesActive,
        label: '▶ Бесплатно за рекламу',
        onUse: () => YG.rewarded(() => {
          if (!gameState.daily) gameState.daily = {};
          gameState.daily.gloves = true;
          updateHUD();
          renderShop();
          showToast('🧤 Перчатки получены — реклама просмотрена!');
          YG.save({ phase: 'shop' });
        })
      }
    }));

    // 3. Конфеты на стойку (35 ₽)
    const candyActive = !!(gameState.daily && gameState.daily.candy);
    const candyCost = 52;
    grid.appendChild(createShopCard({
      icon: '🍬',
      name: 'Вазочка с конфетами',
      effect: '+25% к приросту рейтинга за визиты',
      cost: candyCost,
      isBought: candyActive,
      canBuy: !candyActive && gameState.money >= candyCost,
      btnText: candyActive ? 'На следующую смену ✓' : `Купить ${candyCost} ₽`,
      onBuy: () => {
        gameState.money -= candyCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + candyCost;
        if (!gameState.daily) gameState.daily = {};
        gameState.daily.candy = true;
        updateHUD();
        renderShop();
        showToast('🍬 Конфеты на стойке! +25% к рейтингу');
      },
      // rewarded video: тот же расходник бесплатно (п. 4.5)
      ad: {
        canUse: !candyActive,
        label: '▶ Бесплатно за рекламу',
        onUse: () => YG.rewarded(() => {
          if (!gameState.daily) gameState.daily = {};
          gameState.daily.candy = true;
          updateHUD();
          renderShop();
          showToast('🍬 Конфеты получены — реклама просмотрена!');
          YG.save({ phase: 'shop' });
        })
      }
    }));

    // 4. Кофе (40 ₽)
    const coffeeActive = !!(gameState.daily && gameState.daily.coffee);
    const coffeeCost = 60;
    grid.appendChild(createShopCard({
      icon: '☕',
      name: 'Бодрящий кофе',
      effect: '+10 сек к таймеру утренней сортировки',
      cost: coffeeCost,
      isBought: coffeeActive,
      canBuy: !coffeeActive && gameState.money >= coffeeCost,
      btnText: coffeeActive ? 'Выпито на завтра ✓' : `Купить ${coffeeCost} ₽`,
      onBuy: () => {
        gameState.money -= coffeeCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + coffeeCost;
        if (!gameState.daily) gameState.daily = {};
        gameState.daily.coffee = true;
        updateHUD();
        renderShop();
        showToast('☕ Кофе зарядит на утреннюю приёмку (+10с)!');
      },
      // rewarded video: тот же расходник бесплатно (п. 4.5)
      ad: {
        canUse: !coffeeActive,
        label: '▶ Бесплатно за рекламу',
        onUse: () => YG.rewarded(() => {
          if (!gameState.daily) gameState.daily = {};
          gameState.daily.coffee = true;
          updateHUD();
          renderShop();
          showToast('☕ Кофе получен — реклама просмотрена!');
          YG.save({ phase: 'shop' });
        })
      }
    }));

    // 5. Реклама (50 ₽)
    const promoActive = !!(gameState.daily && gameState.daily.promo);
    const promoCost = 75;
    // Предупреждение (фикс С-6): если завтра с рекламой не влезет на склад — честно сказать.
    // FIX: gameState.day уже увеличен к моменту открытия магазина,
    // поэтому «завтра» = gameState.day (иначе предупреждение уходило на день послезавтра).
    const _tomorrowLoad = getDayLoad(gameState.day) - ((gameState.daily && gameState.daily.promo) ? 2 : 0);
    const _promoOver = _tomorrowLoad + 2 > gameState.warehouseCapacity;
    grid.appendChild(createShopCard({
      icon: '📢',
      name: 'Реклама на районе',
      effect: _promoOver
        ? '+2 клиента завтра. ⚠️ Завтра будет ' + (_tomorrowLoad + 2) + ' клиентов, а мест всего ' + gameState.warehouseCapacity + ' — без стеллажа они не встанут на полку'
        : '+2 дополнительных клиента в смену',
      cost: promoCost,
      isBought: promoActive,
      canBuy: !promoActive && gameState.money >= promoCost,
      btnText: promoActive ? 'На следующую смену ✓' : `Купить ${promoCost} ₽`,
      onBuy: () => {
        gameState.money -= promoCost;
        gameState.dayShopSpend = (gameState.dayShopSpend || 0) + promoCost;
        if (!gameState.daily) gameState.daily = {};
        gameState.daily.promo = true;
        updateHUD();
        renderShop();
        showToast('📢 Реклама привлечёт +2 клиентов!');
      },
      // rewarded video: тот же расходник бесплатно (п. 4.5)
      ad: {
        canUse: !promoActive,
        label: '▶ Бесплатно за рекламу',
        onUse: () => YG.rewarded(() => {
          if (!gameState.daily) gameState.daily = {};
          gameState.daily.promo = true;
          updateHUD();
          renderShop();
          showToast('📢 Реклама запущена — реклама просмотрена!');
          YG.save({ phase: 'shop' });
        })
      }
    }));
  }
}

function createShopCard(opts) {
  const card = document.createElement('div');
  card.className = 'shop-card' + (opts.isBought ? ' bought' : '');

  let pipsHtml = '';
  if (opts.maxLevel && opts.maxLevel > 1) {
    let pips = '';
    for (let i = 0; i < opts.maxLevel; i++) {
      pips += '<span class="shop-level-pip' + (i < (opts.level || 0) ? ' filled' : '') + '"></span>';
    }
    pipsHtml = '<div class="shop-level-tracker"><div class="shop-level-pips">' + pips + '</div><span class="shop-level-txt">' + (opts.level || 0) + '/' + opts.maxLevel + '</span></div>';
  }

  card.innerHTML = `
    <div class="shop-card-head">
      <div class="shop-card-icon">${opts.icon}</div>
      <div class="shop-card-info">
        <div class="shop-card-header-row">
          <span class="shop-card-name">${opts.name}</span>
          ${pipsHtml}
        </div>
        <span class="shop-card-effect">${opts.effect}</span>
      </div>
    </div>
    <div class="shop-card-action">
      <button class="shop-buy-btn ${opts.isBought ? 'bought' : (opts.canBuy ? '' : 'disabled')}" ${opts.isBought || !opts.canBuy ? 'disabled' : ''}>
        ${opts.btnText}
      </button>
    </div>
  `;

  if (!opts.isBought && opts.canBuy && opts.onBuy) {
    const btn = card.querySelector('.shop-buy-btn');
    btn.onclick = () => {
      audio.tap();
      opts.onBuy();
      YG.save({ phase: 'shop' }); // покупка сохраняется сразу (п. 1.9)
    };
  }

  // Кнопка «получить за рекламу» (rewarded video, п. 4.5):
  // компактная однострочная плашка: ▶ Бесплатно за рекламу [вместо N ₽].
  if (opts.ad && opts.ad.canUse && opts.ad.onUse) {
    const adBtn = document.createElement('button');
    adBtn.className = 'shop-ad-btn';
    const _save = opts.cost ? ('вместо ' + opts.cost + ' ₽') : 'за рекламу';
    adBtn.innerHTML =
      '<span class="ad-chip">▶</span>' +
      '<span>Бесплатно за рекламу</span>' +
      '<span class="ad-save">' + _save + '</span>';
    adBtn.onclick = () => {
      if (YG.adOpen) return;
      audio.tap();
      opts.ad.onUse();
    };
    // Реклама — сверху (красивая), обычная покупка — снизу (поменьше)
    card.querySelector('.shop-card-action').prepend(adBtn);
  }

  return card;
}



// === СТАРТ ===
// Загрузкой управляет слой YG: инициализация SDK Яндекс Игр, восстановление
// сохранения (локально + облако) и только затем старт игры (п. 1.19.2 —
// LoadingAPI.ready() вызывается, когда игрок может приступить к игре).
window.addEventListener('click', () => {
  try { audio.ensure(); } catch (e) {}
}, { once: true });
window.addEventListener('touchstart', () => {
  try { audio.ensure(); } catch (e) {}
}, { once: true });

window.addEventListener('DOMContentLoaded', () => {
  YG.boot();
});
