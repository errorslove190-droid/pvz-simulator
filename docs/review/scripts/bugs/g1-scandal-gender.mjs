// G1. Скандалист — любой персонаж из VISITORS (51 % — женщины), а реплики SCANDAL_TYPES
// написаны в мужском роде и не проходят через said(). Показываем реплики на сцене у бабушки.
import { launch, newGame, skipGuides, waitChoices, waitContinue, bug, info } from './lib.mjs';

const browser = await launch();
const cases = [
  { type: 'queue_rage', field: 'vLines', re: /должен ждать/, choice: 0 },
  { type: 'opened_parcel', field: 'vLines', re: /Я заказал телефон/, choice: 0 },
  { type: 'damaged_box', field: 'vLines', re: /платил/, choice: 1, vOk: /сам разберусь/ },
  { type: 'missing_order', field: 'vLines', re: /заснял/, choice: 0 },
];
let hits = 0;
try {
  for (const c of cases) {
    const p = await newGame(browser, { mobile: true });
    await skipGuides(p);
    await p.evaluate((c) => {
      gameState.day = 5; gameState.money = 1000; gameState.warehouseCapacity = 9;
      gameState.shelfParcels = []; gameState.promisedDebts = []; gameState.activeDebtsQueue = [];
      startAcceptance();
      if (acceptance._timer) clearInterval(acceptance._timer);
      if (acceptance._nextBoxTimeout) clearTimeout(acceptance._nextBoxTimeout);
      acceptance.running = false;
      const t = SCANDAL_TYPES.find((x) => x.id === c.type);
      t[c.field] = t[c.field].filter((l) => new RegExp(c.re).test(l)); // из случайных реплик берём нужную
      gameState.todayBomzh = null;
      gameState.visitorCount = Math.max(getDayLoad(gameState.day), gameState.todayDebtsCount || 0) + 1;
      gameState.todayScandal = { type: t, visitor: VISITOR_GRANNY, pos: 0, done: false };
      openDoorsAndStartFirstCustomer();
    }, { ...c, re: c.re.source });
    await waitChoices(p);
    let text = await p.evaluate(() => document.getElementById('scene-name').textContent + ': ' + [...document.querySelectorAll('#scene-text .scene-line.v')].map((x) => x.textContent).join(' '));
    if (c.vOk) {
      await p.click(`.scene-choice >> nth=${c.choice}`);
      await waitContinue(p);
      text += ' … ' + await p.evaluate(() => [...document.querySelectorAll('#scene-text .scene-line.v')].map((x) => x.textContent).join(' '));
    }
    info(text.slice(0, 260));
    if (c.re.test(text) || (c.vOk && c.vOk.test(text))) hits++;
    await p.context().close();
  }
  bug(hits === cases.length, `бабушка-скандалистка говорит о себе в мужском роде (${hits} из ${cases.length} реплик)`);
} finally {
  await browser.close();
}
