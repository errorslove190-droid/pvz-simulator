// K2. Подсказка «?» и переходы экранов.
//  a) На сцене клик по «?» останавливает автопрокрутку реплик; Enter (фокус остался на «?»)
//     открывает подсказку повторно и перезаписывает сохранённую паузу → после «Понятно»
//     реплики больше не идут сами.
//  b) Подсказка, открытая в магазине, остаётся поверх приёмки нового дня (showScreen не
//     прячет её для screen-morning), таймер идёт под ней, клавиши A/S/D сортируют вслепую.
//     b1 — клавиатура: Tab до «Начать рабочий день» под модальным окном + Enter;
//     b2 — мышь: реклама на платформе показывается не мгновенно (эмулируем задержку 700 мс
//          поверх имитации SDK), игрок успевает нажать «?» между кнопкой и рекламой.
import { launch, newGame, skipGuides, bug, info } from './lib.mjs';

const browser = await launch();
const timerText = (p) => p.evaluate(() => document.getElementById('hud-timer').textContent);
const acceptanceState = (p) => p.evaluate(() => ({
  scr: document.querySelector('.screen-card.active').id,
  guide: document.getElementById('tutorial-overlay').classList.contains('show'),
  title: document.getElementById('tutorial-title').textContent,
  running: !!(acceptance && acceptance.running), paused: !!(acceptance && acceptance._paused),
}));
try {
  {
    console.log('a) сцена: «?» + Enter → автопрокрутка реплик не возвращается');
    const p = await newGame(browser, { mobile: false });
    await skipGuides(p);
    await p.evaluate(() => { gameState.day = 3; startAcceptance(); gameState.todayScandal = null; gameState.todayBomzh = null; endAcceptanceNow(); });
    await p.click('#btn-summary-continue');
    await p.waitForTimeout(300); // первая реплика уже показана, вторая по таймеру через 2,4 с
    await p.click('#btn-help');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(200);
    const still = await p.evaluate(() => document.getElementById('tutorial-overlay').classList.contains('show'));
    info(`после Enter подсказка ${still ? 'открыта (Enter снова нажал «?»)' : 'закрылась'}`);
    if (still) await p.click('#tutorial-btn');
    const n1 = await p.evaluate(() => document.querySelectorAll('#scene-text .scene-line').length);
    await p.waitForTimeout(6000);
    const n2 = await p.evaluate(() => ({ lines: document.querySelectorAll('#scene-text .scene-line').length, left: Math.max(0, sceneQueue.length - sceneIdx), timer: !!sceneTimer }));
    info(`реплик на экране: ${n1} → через 6 с ${n2.lines}; в очереди осталось ${n2.left}; таймер автопрокрутки: ${n2.timer}`);
    bug(n2.lines === n1 && n2.left > 0 && !n2.timer, 'после повторного открытия подсказки реплики сцены больше не идут сами (только тапом)');
    await p.context().close();
  }
  {
    console.log('b1) подсказка магазина → Tab до «Начать рабочий день» → Enter');
    const p = await newGame(browser, { mobile: false });
    await skipGuides(p);
    await p.evaluate(() => { if (acceptance) { clearInterval(acceptance._timer); clearTimeout(acceptance._nextBoxTimeout); acceptance.running = false; } gameState.day = 3; gameState._lastExpenseDay = 2; showDayEnd(); openShopScreen(); });
    await p.waitForTimeout(500);
    await p.click('#btn-help');
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await p.keyboard.press('Tab');
      reached = await p.evaluate(() => { const a = document.activeElement; return !!(a && a.tagName === 'BUTTON' && a.textContent.includes('Начать рабочий день')); });
    }
    info(`фокус дошёл до «Начать рабочий день» под модальной подсказкой: ${reached}`);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1000);
    const t1 = await timerText(p);
    await p.waitForTimeout(3000);
    const t2 = await timerText(p);
    const st = await acceptanceState(p);
    info(`экран ${st.scr}; подсказка «${st.title}» видна: ${st.guide}; приёмка идёт: ${st.running}, пауза: ${st.paused}; таймер «${t1}» → «${t2}»`);
    bug(st.scr === 'screen-morning' && st.guide && st.running && t1 !== t2, 'подсказка магазина висит над приёмкой, таймер идёт под ней');
    await p.context().close();
  }
  {
    console.log('b2) реклама с задержкой: «Начать рабочий день» → «?» до появления рекламы');
    const p = await newGame(browser, { mobile: true, query: '?adMs=1500' });
    await skipGuides(p);
    await p.evaluate(() => {
      if (acceptance) { clearInterval(acceptance._timer); clearTimeout(acceptance._nextBoxTimeout); acceptance.running = false; }
      gameState.day = 3; gameState._lastExpenseDay = 2; showDayEnd(); openShopScreen();
      // как на платформе: рекламный блок загружается, прежде чем закрыть экран
      const orig = YG.ysdk.adv.showFullscreenAdv;
      YG.ysdk.adv.showFullscreenAdv = (o) => setTimeout(() => orig(o), 700);
    });
    await p.waitForTimeout(400);
    await p.click('#screen-shop .shop-bottom-actions .action-btn'); // «Начать рабочий день»
    await p.waitForTimeout(150);
    await p.click('#btn-help'); // успел до рекламы
    await p.waitForTimeout(2600); // 0,7 с загрузка + 1,5 с реклама
    const t1 = await timerText(p);
    await p.waitForTimeout(3000);
    const t2 = await timerText(p);
    const st = await acceptanceState(p);
    info(`экран ${st.scr}; подсказка «${st.title}» видна: ${st.guide}; приёмка идёт: ${st.running}, пауза: ${st.paused}; таймер «${t1}» → «${t2}»`);
    await p.screenshot({ path: 'work/bugs/k2-guide-over-acceptance.png' });
    bug(st.scr === 'screen-morning' && st.guide && st.running && t1 !== t2, 'подсказка магазина висит над приёмкой, таймер идёт под ней (скриншот k2-guide-over-acceptance.png)');
    await p.context().close();
  }
} finally {
  await browser.close();
}
