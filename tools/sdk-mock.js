// Имитация SDK Яндекс Игр для локального запуска (tools/serve.mjs отдаёт её по /sdk.js).
// В сборку не попадает: на платформе /sdk.js — настоящий SDK.
//
// Что умеет:
//   - YaGames.init(), environment.i18n.lang (?lang=en в адресе — сменить язык)
//   - LoadingAPI.ready, GameplayAPI.start/stop — пишутся в консоль и в window.__ygMock.events
//   - getPlayer().getData/setData — «облако» в localStorage (ключ __ygMockCloud)
//   - реклама: полноэкранная и за вознаграждение — серая плашка на 1,5 с
//   - window.__ygMock.pause() / resume() — события game_api_pause / game_api_resume
//   - window.__ygMock.clearCloud() — стереть «облачный» сейв
(function () {
  const CLOUD_KEY = '__ygMockCloud';
  const params = new URLSearchParams(location.search);
  const handlers = {};
  const mock = {
    events: [],
    log(name, detail) {
      this.events.push({ name, detail, t: Math.round(performance.now()) });
      console.info('[yg-mock]', name, detail === undefined ? '' : detail);
    },
    pause() { (handlers.game_api_pause || []).forEach((f) => f()); },
    resume() { (handlers.game_api_resume || []).forEach((f) => f()); },
    clearCloud() { localStorage.removeItem(CLOUD_KEY); },
  };
  window.__ygMock = mock;

  function fakeAd(kind, callbacks, rewarded) {
    mock.log('adv:' + kind);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;'
      + 'background:rgba(20,20,20,.88);color:#fff;font:600 20px system-ui;text-align:center';
    el.textContent = rewarded ? 'Реклама за вознаграждение (имитация)' : 'Полноэкранная реклама (имитация)';
    document.body.appendChild(el);
    try { callbacks.onOpen && callbacks.onOpen(); } catch (e) { console.error(e); }
    setTimeout(() => {
      el.remove();
      if (rewarded) { try { callbacks.onRewarded && callbacks.onRewarded(); } catch (e) { console.error(e); } }
      try { callbacks.onClose && callbacks.onClose(true); } catch (e) { console.error(e); }
    }, Number(params.get('adMs')) || 1500);
  }

  window.YaGames = {
    init: async () => ({
      environment: { i18n: { lang: params.get('lang') || 'ru' } },
      features: {
        LoadingAPI: { ready: () => mock.log('LoadingAPI.ready') },
        GameplayAPI: { start: () => mock.log('GameplayAPI.start'), stop: () => mock.log('GameplayAPI.stop') },
      },
      on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
      getPlayer: async () => ({
        getData: async () => JSON.parse(localStorage.getItem(CLOUD_KEY) || '{}'),
        setData: async (data, flush) => {
          localStorage.setItem(CLOUD_KEY, JSON.stringify(data));
          mock.log('player.setData', { phase: data && data.save && data.save.phase, flush: !!flush });
        },
      }),
      adv: {
        showFullscreenAdv: ({ callbacks = {} } = {}) => fakeAd('fullscreen', callbacks, false),
        showRewardedVideo: ({ callbacks = {} } = {}) => fakeAd('rewarded', callbacks, true),
      },
    }),
  };
})();
