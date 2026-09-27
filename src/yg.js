
/* ============================================================
   ЯНДЕКС ИГРЫ: слой интеграции (YG)
   - инициализация SDK + локальный режим без SDK (для разработки)
   - LoadingAPI.ready() / GameplayAPI.start() / stop()
   - пауза звука и таймера при потере фокуса (п. 1.3)
   - сохранения: localStorage + облачные сейвы Яндекса (п. 1.9, 2.6)
   - реклама: interstitial (конец смены) и rewarded video (п. 1.12, 4.x)
   Скрипт стоит ДО игрового: YG обязан существовать к моменту boot.
   Все ссылки на игровые сущности (gameState и т.п.) — в рантайме.
   ============================================================ */
(function () {
  'use strict';

  const SAVE_KEY = 'pvz_sim_save_v1';     // localStorage
  const CLOUD_KEY = 'save';               // ключ в player.setData
  const CLOUD_MIN_INTERVAL_MS = 30000;    // троттлинг облака (лимит 100 зап/5мин)

  const YG = {
    ysdk: null,
    player: null,
    lang: 'ru',            // автоопределение языка (п. 2.14)
    booted: false,
    adOpen: false,
    gameplayActive: false,
    hidden: false,
    _lastCloudSaveAt: 0,
    _cloudSaveTimer: null,
    _interstitialAt: 0
  };
  window.YG = YG;

  /* ---------- Инициализация SDK ---------- */
  function waitForYaGames(timeoutMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        if (typeof window.YaGames !== 'undefined') return resolve(true);
        if (Date.now() - t0 > timeoutMs) return resolve(false);
        setTimeout(poll, 100);
      })();
    });
  }

  async function initSDK() {
    const found = await waitForYaGames(5000); // B-3: запас на медленную загрузку sdk.js
    if (!found) {
      return;
    }
    try {
      YG.ysdk = await YaGames.init();
      // Автоопределение языка (требование 2.14). Игра русскоязычная: для прочих
      // языков остаётся русский — это допустимый минимум для ru/be/kk/uk/uz.
      try { YG.lang = (YG.ysdk.environment && YG.ysdk.environment.i18n && YG.ysdk.environment.i18n.lang) || 'ru'; } catch (e) {}
      try { YG.player = await YG.ysdk.getPlayer({ signed: false }); } catch (e) { try { YG.player = await YG.ysdk.getPlayer(); } catch (e2) { YG.player = null; } }
      // game_api_pause / game_api_resume (п. 1.19.4)
      if (typeof YG.ysdk.on === 'function') {
        try {
          YG.ysdk.on('game_api_pause', pauseGameForHide);
          YG.ysdk.on('game_api_resume', resumeGameFromHide);
        } catch (e) {}
      }
    } catch (e) {
      YG.ysdk = null;
    }
  }

  /* ---------- LoadingAPI / GameplayAPI (п. 1.19.2, 1.19.3) ---------- */
  function loadingReady() {
    try { YG.ysdk && YG.ysdk.features && YG.ysdk.features.LoadingAPI && YG.ysdk.features.LoadingAPI.ready(); } catch (e) {}
  }
  YG.gameplayStart = function () {
    if (YG.gameplayActive || YG.hidden || YG.adOpen) return;
    YG.gameplayActive = true;
    try { YG.ysdk && YG.ysdk.features && YG.ysdk.features.GameplayAPI && YG.ysdk.features.GameplayAPI.start(); } catch (e) {}
  };
  YG.gameplayStop = function () {
    if (!YG.gameplayActive) return;
    YG.gameplayActive = false;
    try { YG.ysdk && YG.ysdk.features && YG.ysdk.features.GameplayAPI && YG.ysdk.features.GameplayAPI.stop(); } catch (e) {}
  };

  /* ---------- Звук ---------- */
  function pauseAllAudio() { try { audio.suspend(); } catch (e) {} }
  function resumeAllAudio() { try { audio.resume(); } catch (e) {} }

  /* ---------- Потеря фокуса (п. 1.3): тишина + пауза таймера ---------- */
  function isMenuPhase() {
    const de = document.getElementById('screen-dayend');
    const sh = document.getElementById('screen-shop');
    return !!(de && de.classList.contains('active')) || !!(sh && sh.classList.contains('active'));
  }
  function pauseGameForHide() {
    if (YG.hidden) return;
    YG.hidden = true;
    pauseAllAudio();
    YG.gameplayStop();
    // Пауза таймера приёмки (как в туториале): сдвинем старт при возврате.
    // try/catch — на случай события до инициализации игровой переменной.
    try {
      if (typeof acceptance !== 'undefined' && acceptance && acceptance.running && !acceptance._paused) {
        acceptance._paused = true;
        acceptance._pausedAt = performance.now();
        acceptance._hidePaused = true;
      }
      // M-5: пауза авторазворота текста сцены — уход из вкладки не должен «съедать» реплики
      if (typeof sceneQueue !== 'undefined' && sceneQueue && sceneQueue.length && sceneIdx < sceneQueue.length && sceneTimer) {
        clearTimeout(sceneTimer); sceneTimer = null; YG._sceneResume = true;
      }
    } catch (e) {}
  }
  function resumeGameFromHide() {
    if (!YG.hidden) return;
    YG.hidden = false;
    resumeAllAudio();
    try {
      if (typeof acceptance !== 'undefined' && acceptance && acceptance.running && acceptance._paused && acceptance._hidePaused) {
        acceptance.startedAt += performance.now() - acceptance._pausedAt;
        acceptance._paused = false;
        acceptance._hidePaused = false;
      }
      if (YG._sceneResume) {
        YG._sceneResume = false;
        if (sceneQueue && sceneIdx < sceneQueue.length) sceneTimer = setTimeout(pumpScene, 900);
      }
    } catch (e) {}
    if (!isMenuPhase() && !YG.adOpen) YG.gameplayStart();
  }
  // Подсказка «поверните телефон» (телефон в альбомной): пока она на экране,
  // игра стоит на паузе — таймер приёмки, автопрокрутка реплик, звук.
  let mqRotate = null;
  try { mqRotate = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (hover: none) and (pointer: coarse)'); } catch (e) {}
  const rotateBlocked = () => !!(mqRotate && mqRotate.matches);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGameForHide(); else if (!rotateBlocked()) resumeGameFromHide();
  });
  if (mqRotate) {
    const onRotate = () => { if (rotateBlocked()) pauseGameForHide(); else if (!document.hidden) resumeGameFromHide(); };
    try { if (mqRotate.addEventListener) mqRotate.addEventListener('change', onRotate); else if (mqRotate.addListener) mqRotate.addListener(onRotate); } catch (e) {}
    if (rotateBlocked()) pauseGameForHide(); // игра открыта сразу в альбомной
  }

  /* ---------- Лонгтап / контекстное меню (п. 1.6.1.8, 1.6.2.7) ---------- */
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- Сохранения (п. 1.9, 2.6) ---------- */
  function currentPhase() {
    if (isMenuPhase()) {
      const sh = document.getElementById('screen-shop');
      return (sh && sh.classList.contains('active')) ? 'shop' : 'dayend';
    }
    const sc = document.getElementById('screen-scene');
    if (sc && sc.classList.contains('active') && gameState && gameState.courierVisitedToday) return 'courier';
    return 'customers';
  }

  function collectSave(phase) {
    const gs = gameState;
    return {
      v: 1,
      t: Date.now(),
      phase: phase || currentPhase(),
      day: gs.day,
      money: gs.money,
      rating: gs.rating,
      warehouseCapacity: gs.warehouseCapacity,
      upg: gs.upg,
      expansion: gs.expansion,
      daily: gs.daily,
      tutorialShown: gs.tutorialShown,
      guidesSeen: gs.guidesSeen || {},
      totalVisits: gs.totalVisits || 0,
      lastExpenseDay: gs._lastExpenseDay || 0,
      dailyResetDay: gs._dailyResetDay || 0,
      scanHintShown: !!gs.scanHintShown,
      courierVisitedToday: !!gs.courierVisitedToday,
      visitorIndex: gs.visitorIndex || 0,
      visitorCount: gs.visitorCount || 0,
      todayDebtsCount: gs.todayDebtsCount || 0,
      dayGross: gs.dayGrossIncome || 0,
      daySpend: gs.dayShopSpend || 0,
      dayCourier: gs.dayCourierFee || 0,
      dayOther: gs.dayOtherCost || 0,
      debtAttempts: gs.debtAttempts || {},
      todayScandal: gs.todayScandal ? { typeId: gs.todayScandal.type.id, visitorId: gs.todayScandal.visitor.id, pos: gs.todayScandal.pos, done: !!gs.todayScandal.done, fakeCode: gs.todayScandal.fakeCode } : null,
      todayBomzh: gs.todayBomzh ? { pos: gs.todayBomzh.pos, done: !!gs.todayBomzh.done, stolen: gs.todayBomzh.stolen || null } : null,
      // Склад: без base64-спрайтов (восстановим по spriteIdx)
      shelfParcels: (gs.shelfParcels || []).map(p => ({
        code: p.code,
        spriteIdx: p.spriteIdx,
        status: p.status || null,
        isDebt: !!p.isDebt,
        isBroken: !!p.isBroken,
        daysOnShelf: p.daysOnShelf || 0,
        debtVisitorName: p.debtVisitorName || null,
        debtVisitorId: p.debtVisitorId || null
      })),
      promisedDebts: gs.promisedDebts || [],
      activeDebtsQueue: gs.activeDebtsQueue || [],
      visitorHistory: gs.visitorHistory || [],
      todayVisitorRoster: (gs.todayVisitorRoster || []).map(r => ({
        visitorId: r.visitor && r.visitor.id,
        orderCode: r.orderCode,
        itemLabel: r.itemLabel
      }))
    };
  }

  // Посреди приёмки или визита состояние изменено наполовину: коробки ещё не на
  // складе, должник уже вынут из очереди, заказ выдан, а счётчик визитов не сдвинут.
  // Такой сейв после перезапуска пропускал приёмку и терял должников, поэтому в эти
  // моменты пишем последний согласованный снимок (YG._checkpoint).
  function isMidStep() {
    try { if (acceptance && acceptance.running) return true; } catch (e) {}
    if (isMenuPhase()) return false;
    const on = (id) => { const el = document.getElementById(id); return !!(el && el.classList.contains('active')); };
    if (on('screen-scene') && gameState && gameState.courierVisitedToday) return false;
    return on('screen-scene') || on('screen-warehouse') || on('screen-result');
  }
  // Явная фаза — вызывающий сохраняет на границе шагов; без фазы решаем сами.
  function snapshot(phase) {
    if (!phase && isMidStep()) {
      if (YG._checkpoint) YG._checkpoint.t = Date.now();
      return YG._checkpoint;
    }
    // глубокая копия: collectSave отдаёт ссылки на живые массивы игры (очередь долгов и т.п.)
    const d = JSON.parse(JSON.stringify(collectSave(phase || currentPhase())));
    YG._checkpoint = d;
    return d;
  }
  YG._checkpoint = null;

  YG.save = function (opts) {
    if (!YG.booted) return; // сейв ещё не загружен — не перезаписываем прогресс
    let data;
    try { data = snapshot(opts && opts.phase); } catch (e) { return; }
    if (!data) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
    scheduleCloudSave(data, false);
  };
  // Мёртвый груз убран за рекламу посреди визита — убираем его и из снимка
  YG.forgetParcel = function (p) {
    const c = YG._checkpoint;
    if (!c || !c.shelfParcels || !p) return;
    const i = c.shelfParcels.findIndex(x => x.code === p.code && (x.status || null) === (p.status || null));
    if (i !== -1) c.shelfParcels.splice(i, 1);
  };

  function scheduleCloudSave(data, immediate) {
    if (!YG.player) return;
    const send = (d, flush) => {
      try { YG.player.setData({ [CLOUD_KEY]: d }, !!flush).catch(() => {}); } catch (e) {}
    };
    const now = Date.now();
    if (immediate) { YG._lastCloudSaveAt = now; send(data, true); return; }
    const wait = now - YG._lastCloudSaveAt;
    if (wait >= CLOUD_MIN_INTERVAL_MS) {
      YG._lastCloudSaveAt = now;
      send(data, false);
    } else if (!YG._cloudSaveTimer) {
      // Отложенный доссенд: возьмёт самое свежее состояние на момент срабатывания
      YG._cloudSaveTimer = setTimeout(() => {
        YG._cloudSaveTimer = null;
        YG._lastCloudSaveAt = Date.now();
        try { const d = snapshot(); if (YG.player && d) YG.player.setData({ [CLOUD_KEY]: d }, false).catch(() => {}); } catch (e) {}
      }, CLOUD_MIN_INTERVAL_MS - wait);
    }
  }

  function restoreSprites(arr) {
    return (arr || []).map(p => {
      const idx = (typeof p.spriteIdx === 'number' && p.spriteIdx >= 0 && p.spriteIdx < PARCEL_SPRITES.length) ? p.spriteIdx : 0;
      const obj = {
        code: p.code,
        sprite: PARCEL_SPRITES[idx],
        spriteTorn: (idx < PARCEL_SPRITES_TORN.length) ? PARCEL_SPRITES_TORN[idx] : null,
        spriteIdx: idx,
        isDebt: !!p.isDebt,
        isBroken: !!p.isBroken
      };
      if (p.status) obj.status = p.status;
      if (p.debtVisitorName) obj.debtVisitorName = p.debtVisitorName;
      if (p.debtVisitorId) obj.debtVisitorId = p.debtVisitorId;
      obj.daysOnShelf = p.daysOnShelf || 0;
      return obj;
    });
  }

  function applySave(d) {
    const gs = gameState;
    gs.day = d.day || 1;
    gs.money = (typeof d.money === 'number') ? d.money : 150;
    gs.rating = (typeof d.rating === 'number') ? d.rating : 3.5;
    gs.warehouseCapacity = d.warehouseCapacity || 3;
    if (d.upg) gs.upg = d.upg;
    if (d.expansion) gs.expansion = d.expansion;
    gs.daily = d.daily || { coffee: false, wrap: false, gloves: false, candy: false, promo: false };
    gs.tutorialShown = !!d.tutorialShown;
    gs.guidesSeen = d.guidesSeen || {};
    // Преемственность: старый флаг tutorialShown приравниваем к «гайд приёмки показан»
    if (d.tutorialShown && !gs.guidesSeen.acceptance) gs.guidesSeen.acceptance = true;
    gs.totalVisits = d.totalVisits || 0;
    gs._lastExpenseDay = d.lastExpenseDay || 0;
    gs._dailyResetDay = d.dailyResetDay || 0;
    gs.scanHintShown = !!d.scanHintShown;
    gs.courierVisitedToday = !!d.courierVisitedToday;
    gs.visitorIndex = d.visitorIndex || 0;
    gs.visitorCount = d.visitorCount || 0;
    gs.todayDebtsCount = d.todayDebtsCount || 0;
    gs.dayGrossIncome = d.dayGross || 0;
    gs.dayShopSpend = d.daySpend || 0;
    gs.dayCourierFee = d.dayCourier || 0;
    gs.dayOtherCost = d.dayOther || 0;
    gs.debtAttempts = d.debtAttempts || {};
    // Восстановление скандалиста
    if (d.todayScandal && d.todayScandal.typeId) {
      try {
        const sType = (typeof SCANDAL_TYPES !== 'undefined' ? SCANDAL_TYPES.find(t => t.id === d.todayScandal.typeId) : null);
        const sVisitor = (typeof VISITORS !== 'undefined' ? VISITORS.find(v => v.id === d.todayScandal.visitorId) : null) || (typeof VISITOR_MAN !== 'undefined' ? VISITOR_MAN : null);
        if (sType && sVisitor) {
          gs.todayScandal = { type: sType, visitor: sVisitor, pos: d.todayScandal.pos || 0, done: !!d.todayScandal.done, fakeCode: d.todayScandal.fakeCode };
        } else {
          gs.todayScandal = null;
        }
      } catch(e) { gs.todayScandal = null; }
    } else {
      gs.todayScandal = null;
    }
    // Восстановление бомжа
    if (d.todayBomzh) {
      try {
        gs.todayBomzh = { visitor: (typeof VISITOR_BOMZH !== 'undefined' ? VISITOR_BOMZH : null), pos: d.todayBomzh.pos || 0, done: !!d.todayBomzh.done, stolen: d.todayBomzh.stolen || null };
      } catch(e) { gs.todayBomzh = null; }
    } else {
      gs.todayBomzh = null;
    }
    gs.shelfParcels = restoreSprites(d.shelfParcels);
    gs.promisedDebts = d.promisedDebts || [];
    gs.activeDebtsQueue = d.activeDebtsQueue || [];
    gs.visitorHistory = d.visitorHistory || [];
    gs.todayVisitorRoster = (d.todayVisitorRoster || []).map(r => {
      const v = VISITORS.find(x => x.id === r.visitorId) || VISITOR_MAN;
      return { visitor: v, orderCode: r.orderCode, itemLabel: r.itemLabel, itemObj: null };
    });
    gs.shelfCells = null; // раскладка по слотам пересоберётся под текущий день
    gs.activeVisitor = null;
    gs.lastChoice = null;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve) => {
      let settled = false;
      const t = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, ms);
      promise.then((v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } },
                   () => { if (!settled) { settled = true; clearTimeout(t); resolve(null); } });
    });
  }

  async function loadSave() {
    let cloud = null;
    let local = null;
    if (YG.player) {
      try {
        const data = await withTimeout(YG.player.getData([CLOUD_KEY]), 3500);
        if (data && data[CLOUD_KEY]) cloud = data[CLOUD_KEY];
      } catch (e) {}
    }
    try { local = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) {}
    const newer = (a, b) => {
      if (!a) return b || null;
      if (!b) return a;
      return (b.t || 0) > (a.t || 0) ? b : a;
    };
    const chosen = newer(cloud, local);
    if (chosen && chosen.v === 1 && chosen.phase) return chosen;
    return null;
  }

  /* ---------- Реклама (раздел 4) ---------- */
  // Interstitial — только в логической паузе: переход к новому дню (п. 4.4).
  // Звук и геймплей ставятся на паузу на время показа (п. 4.7).
  YG.startNewDay = function () {
    try { audio.ensure(); } catch (e) {}
    YG.interstitial(() => { startAcceptance(); });
  };

  YG.interstitial = function (after) {
    if (YG.adOpen) return; // M-3: повторный клик во время показа — молча игнорируем
    const run = () => { try { after && after(); } catch (e) { console.error('[YG]', e); } };
    if (!YG.ysdk || !YG.ysdk.adv) { run(); return; }           // локальный режим
    const now = Date.now();
    if (now - YG._interstitialAt < 60000) { run(); return; }    // мягкий лимит поверх платформённого
    YG._interstitialAt = now;
    YG.adOpen = true;
    YG.gameplayStop();
    pauseAllAudio();
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      YG.adOpen = false;
      resumeAllAudio();
      run();
      // FIX п. 1.19.3: после рекламы геймплей нужно разметить заново
      if (!isMenuPhase() && !YG.hidden) YG.gameplayStart();
    };
    try {
      YG.ysdk.adv.showFullscreenAdv({
        callbacks: {
          onClose: () => done(),
          onError: () => done()
        }
      });
    } catch (e) { done(); }
  };

  // Rewarded video — только по осознанному действию игрока (п. 4.5).
  YG.rewarded = function (onReward, onFail) {
    if (YG.adOpen) return;
    if (!YG.ysdk || !YG.ysdk.adv) {
      try { showToast('🔒 Реклама доступна только на платформе Яндекс Игр'); } catch (e) {}
      if (onFail) { try { onFail(); } catch (e) {} }
      return;
    }
    YG.adOpen = true;
    YG.gameplayStop();
    pauseAllAudio();
    let rewarded = false;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      YG.adOpen = false;
      resumeAllAudio();
      if (rewarded) { try { onReward(); } catch (e) { console.error('[YG]', e); } }
      else if (onFail) { try { onFail(); } catch (e) {} }
      // FIX п. 1.19.3: после rewarded-видео на складе геймплей оставался «остановленным»
      if (!isMenuPhase() && !YG.hidden) YG.gameplayStart();
    };
    try {
      YG.ysdk.adv.showRewardedVideo({
        callbacks: {
          onRewarded: () => { rewarded = true; },
          onClose: () => done(),
          onError: () => done()
        }
      });
    } catch (e) { done(); }
  };

  /* ---------- Загрузка игры ---------- */
  YG.boot = async function () {
    if (YG.booted) return;
    await initSDK();
    let save = null;
    try { save = await loadSave(); } catch (e) {}
    YG.booted = true;
    // Game Ready ДО старта геймплея (п. 1.19.2)
    loadingReady();
    try {
      if (save) {
        YG._checkpoint = JSON.parse(JSON.stringify(save)); // копия до applySave: игра меняет массивы сейва
        applySave(save);
        updateHUD();
        showToast('☁️ Прогресс восстановлен');
        if (save.phase === 'customers') {
          acceptance = null;
          startScene();
        } else if (save.phase === 'courier') {
          acceptance = null;
          startCourierScene();
        } else if (save.phase === 'shop') {
          showDayEnd({ keepDaily: true });
          openShopScreen();
        } else {
          showDayEnd({ keepDaily: true });
        }
      } else {
        setTimeout(startAcceptance, 100); // новая игра
      }
    } catch (e) {
      console.error('[YG] Восстановление не удалось, начинаем новую игру:', e);
      try { localStorage.removeItem(SAVE_KEY); } catch (e2) {}
      setTimeout(startAcceptance, 100);
    }
  };

  // Последний шанс отправить облако при уходе со страницы
  window.addEventListener('pagehide', () => {
    if (!YG.booted) return;
    try {
      const data = snapshot();
      if (!data) return;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
      if (YG.player) YG.player.setData({ [CLOUD_KEY]: data }, true).catch(() => {});
    } catch (e) {}
  });
})();
