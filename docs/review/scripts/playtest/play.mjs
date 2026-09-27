// Плейтест «как новичок»: играет через интерфейс (тапы, удержание, клики), пишет хронометраж.
//   node work/playtest/play.mjs --device mobile --days 2 --minutes 11
//   node work/playtest/play.mjs --device desktop --days 1
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { BASE, OUT, INIT, makeLog, hookSound, activeScreen, guideOpen, press, hold, audit, shot } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DEVICE = arg('--device', 'mobile');
const DAYS = Number(arg('--days', 2));
const MINUTES = Number(arg('--minutes', 11));
const touch = DEVICE !== 'desktop';
const VIEW = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 }, small: { width: 360, height: 640 } }[DEVICE];

const log = makeLog('play-' + DEVICE);
const audits = [];
const visits = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEW, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, locale: 'ru-RU' });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const cdp = touch ? await ctx.newCDPSession(page) : null;
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); log('❗ pageerror', e.message); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(m.type() + ': ' + m.text()); log('❗ console.' + m.type(), m.text().slice(0, 160)); } });

const P = DEVICE; // префикс снимков
const seen = new Set();
const once = (k) => { if (seen.has(k)) return false; seen.add(k); return true; };
const doAudit = async (k) => { const a = await audit(page, k); audits.push(a); return a; };

// ---------- ЗАГРУЗКА ----------
log('goto');
await page.goto(BASE, { waitUntil: 'commit' });
await page.waitForSelector('#loading-screen', { timeout: 10000 }).catch(() => {});
await shot(page, P + '-00-loading', log);
await page.waitForFunction(() => window.__ygMock && window.__ygMock.events.some((e) => e.name === 'LoadingAPI.ready'), null, { timeout: 20000 });
log('LoadingAPI.ready');
await page.waitForFunction(() => !document.getElementById('loading-screen') || document.getElementById('loading-screen').classList.contains('hidden'), null, { timeout: 20000 });
log('экран загрузки скрыт');
await hookSound(page);

let day = 1, visitNo = 0, curVisit = null, dayStart = log.t();
let accBoxes = 0, accMistakeDone = {}, warehouseFirst = true, scanEarlyDone = false;
const choicePlan = {
  1: ['talk', 'give', 'refuse:give'],
  2: ['talk', 'refuse:hard', 'give', 'talk'],
  3: ['give', 'talk', 'give', 'talk', 'give'],
};
const choiceFor = (d, n) => ((choicePlan[d] || choicePlan[3])[n - 1] || 'talk');

async function readGuide() {
  const g = await page.evaluate(() => ({ title: document.getElementById('tutorial-title').textContent, len: document.querySelector('#tutorial-overlay .tutorial-card').innerText.length, btn: document.getElementById('tutorial-btn').textContent }));
  const key = 'guide:' + g.title;
  if (once(key)) {
    log('🟡 гайд открыт', g);
    await shot(page, P + '-guide-' + g.title.replace(/[^А-Яа-яA-Za-z0-9]+/g, '_').slice(0, 30), log);
    await doAudit('гайд ' + g.title);
  }
  // Новичок читает ~20 символов/с, но не дольше 12 с
  const readMs = Math.min(12000, Math.round(g.len / 20 * 1000));
  await page.waitForTimeout(readMs);
  const r = await press(page, '#tutorial-btn', touch);
  log('гайд закрыт через ' + (readMs / 1000).toFixed(1) + ' с чтения', r.ok ? '' : r);
}

async function acceptanceStep() {
  const st = await page.evaluate(() => {
    const running = !!(acceptance && acceptance.running);
    const box = document.getElementById('sort-box');
    const num = box && box.querySelector('.sort-box-num');
    const inv = [...document.querySelectorAll('.invoice-chip')].map((c) => ({ code: c.querySelector('.invoice-chip-code').textContent, sorted: c.classList.contains('sorted') }));
    return {
      running, hasBox: !!box && !box.classList.contains('fly-out'),
      num: num ? num.textContent : null, broken: !!(box && box.querySelector('.sort-box-badge.nolabel')),
      debt: !!(box && box.querySelector('.is-debt-badge')),
      inv, timer: document.getElementById('hud-timer').textContent,
      summary: !!document.getElementById('btn-summary-continue'),
    };
  });
  if (st.summary) {
    if (once('summary' + day)) {
      log('✅ итоги приёмки на экране', await page.evaluate(() => document.querySelector('.acc-finish-card').innerText.replace(/\s+/g, ' ')));
      await shot(page, P + '-d' + day + '-acc-summary', log);
      await doAudit('итоги приёмки д' + day);
      await page.waitForTimeout(2500);
    }
    const r = await press(page, '#btn-summary-continue', touch);
    log('нажал «Открыть двери ПВЗ»', r.ok ? '' : r);
    await page.waitForTimeout(600);
    return;
  }
  if (!st.running || !st.hasBox) { await page.waitForTimeout(150); return; }
  if (once('firstbox' + day)) {
    log('первая коробка на экране (' + st.timer + ')', { invoice: st.inv.map((i) => i.code) });
    if (day === 1) { await shot(page, P + '-d1-acceptance', log); await doAudit('приёмка'); }
  }
  // День 2+: накладная собрана — жмём «Завершить приёмку»
  const allSorted = st.inv.length && st.inv.every((i) => i.sorted);
  if (allSorted && day >= 2) {
    const r = await press(page, '#btn-end-acceptance', touch);
    log('накладная собрана — нажал «Завершить приёмку» (' + st.timer + ')', r.ok ? '' : r);
    await page.waitForTimeout(500);
    return;
  }
  // Решение «как у человека» по тому, что видно на экране
  let bin = st.broken ? 'broken' : (st.num && st.inv.some((i) => i.code === st.num) ? 'ours' : 'others');
  accBoxes++;
  // намеренная ошибка новичка: день 1 — «чужую» в «свои» не кладём (склад мал), кладём брак в «чужие»; день 2 — «чужую» в «свои»
  if (day === 1 && !accMistakeDone[1] && bin === 'broken') { bin = 'others'; accMistakeDone[1] = true; log('⚠️ намеренная ошибка: брак → «Чужие»'); }
  if (day === 2 && !accMistakeDone[2] && bin === 'others' && accBoxes > 3) { bin = 'ours'; accMistakeDone[2] = true; log('⚠️ намеренная ошибка: чужая → «Свои»'); }
  // время на чтение номера: первые коробки дольше
  await page.waitForTimeout(accBoxes <= 3 && day === 1 ? 1400 : 750);
  let r;
  if (!touch && accBoxes % 2 === 0) {
    await page.keyboard.press({ ours: 'a', others: 's', broken: 'd' }[bin]);
    r = { ok: true, key: true };
  } else r = await press(page, '#bin-' + bin, touch, { timeout: 2000 });
  const after = await page.evaluate(() => ({ c: document.getElementById('hud-correct').textContent, w: document.getElementById('hud-wrong').textContent, timer: document.getElementById('hud-timer').textContent, stock: document.getElementById('hud-stock').textContent }));
  log(`коробка ${st.num || '(без номера)'}${st.broken ? ' [брак]' : ''}${st.debt ? ' [долг]' : ''} → ${bin}${r.key ? ' (клавиша)' : ''}`, { ...after, ok: r.ok, err: r.err });
  await page.waitForTimeout(250);
}

async function sceneStep() {
  const st = await page.evaluate(() => {
    const choices = [...document.querySelectorAll('.scene-choice')].map((b, i) => ({ i, t: b.innerText.replace(/\s+/g, ' ').trim(), dis: b.classList.contains('disabled') || b.disabled }));
    const cont = document.getElementById('btn-scene-continue');
    return {
      name: document.getElementById('scene-name').textContent, code: document.getElementById('scene-order-code').textContent,
      lines: document.querySelectorAll('#scene-text .scene-line').length, queue: sceneQueue.length,
      choices, cont: cont && !cont.disabled ? cont.textContent : null,
    };
  });
  const key = st.name + st.code + day;
  if (!curVisit || curVisit.key !== key) {
    visitNo++;
    curVisit = { key, day, n: visitNo, name: st.name, code: st.code, t0: log.t(), marks: {} };
    visits.push(curVisit);
    log(`👤 посетитель ${visitNo}: ${st.name} ${st.code}`);
  }
  const live = st.choices.filter((c) => !c.dis);
  if (live.length) {
    if (!curVisit.marks.choices) {
      curVisit.marks.choices = +(log.t() - curVisit.t0).toFixed(1);
      log('варианты ответа появились через ' + curVisit.marks.choices + ' с', live.map((c) => c.t));
      if (once('choices-shot')) { await shot(page, P + '-scene-choices', log); await doAudit('сцена с выбором'); }
    }
    await page.waitForTimeout(1500); // чтение вариантов
    const plan = choiceFor(day, visitNo);
    const [first, second] = plan.split(':');
    const want = curVisit.stage === 'refuse' ? second : first;
    let idx = 0;
    const label = (c) => c.t.toLowerCase();
    const find = (re) => live.findIndex((c) => re.test(label(c)));
    if (want === 'talk') idx = find(/поддержать|поговорить|пришлось|спросить/);
    else if (want === 'give') idx = find(/молча|всё же выдать|да, вот|сдать весь|спасибо/);
    else if (want === 'refuse') idx = find(/отказать/);
    else if (want === 'hard') idx = find(/стоять/);
    if (idx < 0) idx = 0;
    const c = live[idx];
    if (want === 'refuse') curVisit.stage = 'refuse';
    const r = await press(page, page.locator('.scene-choice:not(.disabled)').nth(idx), touch);
    log('выбор: ' + c.t, r.ok ? '' : r);
    curVisit.choice = (curVisit.choice ? curVisit.choice + ' → ' : '') + c.t.split(' ').slice(1, 4).join(' ');
    await page.waitForTimeout(400);
    return;
  }
  if (st.cont) {
    if (!curVisit.marks.cont) curVisit.marks.cont = +(log.t() - curVisit.t0).toFixed(1);
    await page.waitForTimeout(1200);
    const r = await press(page, '#btn-scene-continue', touch);
    log('кнопка «' + st.cont.trim() + '»', r.ok ? '' : r);
    await page.waitForTimeout(500);
    return;
  }
  // текст ещё идёт: первый посетитель дня — ждём автопрокрутку, дальше — тап по окну текста
  if (st.queue && visitNo % 2 === 0) {
    await page.waitForTimeout(1600);
    const r = await press(page, '.scene-narration', touch, { timeout: 1500 });
    if (!r.ok) log('тап по тексту не прошёл', r);
    return;
  }
  await page.waitForTimeout(300);
}

async function warehouseStep() {
  const st = await page.evaluate(() => ({
    target: document.getElementById('target-search-box-code').textContent,
    plates: [...document.querySelectorAll('.wh-plate-num')].map((p) => ({ t: p.textContent, slot: p.dataset.slot })),
    boxes: [...document.querySelectorAll('.wh-box')].map((b) => ({ slot: b.dataset.slot, dead: b.classList.contains('is-deadload') })),
    lost: !!document.querySelector('.refuse-btn'),
    scan: document.getElementById('scan-overlay').classList.contains('show'),
    hint: document.getElementById('warehouse-hint-feedback').innerText,
  }));
  if (st.scan) { await page.waitForTimeout(200); return; }
  if (!curVisit.marks.wh) {
    curVisit.marks.wh = +(log.t() - curVisit.t0).toFixed(1);
    log('🏬 склад: ищем ' + st.target, { plates: st.plates.map((p) => p.t), dead: st.boxes.filter((b) => b.dead).length, hint: st.hint });
    if (once('wh-shot')) { await page.waitForTimeout(500); await shot(page, P + '-warehouse', log); await doAudit('склад'); }
    await page.waitForTimeout(1200); // глазами ищет номер
  }
  if (st.lost) {
    const r = await press(page, '.refuse-btn', touch);
    log('заказа нет на полке → «Разобраться с клиентом»', r.ok ? '' : r);
    curVisit.lost = true;
    await page.waitForTimeout(500);
    return;
  }
  const tgt = st.plates.find((p) => p.t === st.target);
  if (!tgt) { await page.waitForTimeout(300); return; }
  // первый заход: новичок сначала тапает не ту коробку
  if (warehouseFirst) {
    warehouseFirst = false;
    const wrong = st.plates.find((p) => p.t !== st.target);
    if (wrong) {
      const r = await press(page, `.wh-box[data-slot="${wrong.slot}"]`, touch);
      log('тап по чужой коробке ' + wrong.t, r.ok ? '' : r);
      await page.waitForTimeout(700);
      await hold(page, '#scan-bc-wrap', 2100, touch, cdp);
      await page.waitForTimeout(300);
      log('сканер чужой: ' + await page.locator('#scan-hint').textContent());
      await shot(page, P + '-scan-wrong', log);
      await page.waitForTimeout(1500);
    }
  }
  const r = await press(page, `.wh-box[data-slot="${tgt.slot}"]`, touch);
  log('тап по коробке ' + tgt.t + ' (слот ' + tgt.slot + ')', r.ok ? '' : r);
  if (!r.ok) { const r2 = await press(page, `.wh-plate-num[data-slot="${tgt.slot}"]`, touch); log('тап по табличке номера', r2.ok ? '' : r2); }
  await page.waitForTimeout(600);
  if (!(await page.evaluate(() => document.getElementById('scan-overlay').classList.contains('show')))) { log('сканер не открылся'); return; }
  if (!curVisit.marks.scanOpen) curVisit.marks.scanOpen = +(log.t() - curVisit.t0).toFixed(1);
  if (once('scan-shot')) { await shot(page, P + '-scan', log); await doAudit('сканер'); }
  if (!scanEarlyDone) {
    scanEarlyDone = true;
    await hold(page, '#scan-bc-wrap', 600, touch, cdp);
    await page.waitForTimeout(200);
    log('отпустил сканер раньше: ' + await page.locator('#scan-hint').textContent());
    await page.waitForTimeout(800);
  }
  const t = Date.now();
  await hold(page, '#scan-bc-wrap', 2000, touch, cdp);
  log('держал штрихкод 2.0 с: ' + await page.locator('#scan-hint').textContent());
  curVisit.scanMs = Date.now() - t;
  await page.waitForTimeout(1000);
}

async function resultStep() {
  const st = await page.evaluate(() => ({
    badge: document.getElementById('result-badge').textContent, who: document.getElementById('result-author-name').textContent,
    speech: document.getElementById('result-visitor-speech').textContent, money: document.getElementById('result-money-earned').textContent,
    rating: document.getElementById('result-rating-earned').textContent, tags: document.getElementById('result-tags-row').innerText.replace(/\s+/g, ' '),
    btn: document.getElementById('btn-next-customer').textContent.trim(),
  }));
  if (!curVisit.marks.result) {
    curVisit.marks.result = +(log.t() - curVisit.t0).toFixed(1);
    curVisit.money = st.money; curVisit.rating = st.rating;
    log('💰 результат', st);
    if (once('result-shot')) { await shot(page, P + '-result', log); await doAudit('результат'); }
    await page.waitForTimeout(1800);
  }
  const r = await press(page, '#btn-next-customer', touch);
  log('нажал «' + st.btn + '»', r.ok ? '' : r);
  curVisit.total = +(log.t() - curVisit.t0).toFixed(1);
  await page.waitForTimeout(700);
}

async function dayendStep() {
  if (once('dayend' + day)) {
    const rep = await page.evaluate(() => document.querySelector('.dayend-top-card').innerText.replace(/\n+/g, ' | '));
    log(`🌙 отчёт дня ${day} (день занял ${(log.t() - dayStart).toFixed(0)} с)`, rep);
    await page.waitForTimeout(600);
    if (day === 1) { await shot(page, P + '-dayend', log); await doAudit('отчёт'); }
    await page.waitForTimeout(3000);
    const r = await press(page, 'button[onclick="openShopScreen()"]', touch);
    log('нажал «Перейти в магазин»', r.ok ? '' : r);
    await page.waitForTimeout(600);
    return;
  }
  await page.waitForTimeout(300);
}

async function shopStep() {
  if (once('shop' + day)) {
    const money = await page.evaluate(() => gameState.money);
    log('🛒 магазин, баланс ' + money);
    if (day === 1) { await shot(page, P + '-shop', log); await doAudit('магазин'); }
    for (const tab of ['equipment', 'daily', 'expansion']) {
      await page.waitForTimeout(1200);
      const r = await press(page, `.shop-tab-pill[data-tab="${tab}"]`, touch);
      const cards = await page.evaluate(() => [...document.querySelectorAll('.shop-card')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
      log('вкладка ' + tab + (r.ok ? '' : ' (не нажалась)'), cards);
      if (day === 1 && tab === 'daily') { await shot(page, P + '-shop-daily', log); await doAudit('магазин расходники'); }
    }
    // Покупка: стеллаж, если хватает; иначе кофе бесплатно за рекламу
    const canRack = await page.evaluate(() => gameState.money >= 450 && gameState.warehouseCapacity < 6);
    if (canRack) {
      const r = await press(page, '.shop-card:first-child .shop-buy-btn', touch);
      log('купил стеллаж', r.ok ? '' : r);
    } else {
      await press(page, '.shop-tab-pill[data-tab="daily"]', touch);
      await page.waitForTimeout(800);
      const coffee = page.locator('.shop-card', { hasText: 'кофе' }).locator('.shop-ad-btn');
      const r = await press(page, coffee, touch);
      log('кофе за рекламу', r.ok ? '' : r);
      await page.waitForTimeout(900);
      log('после рекламы', await page.evaluate(() => ({ coffee: gameState.daily.coffee, toasts: window.__toasts.slice(-2).map((t) => t.text) })));
    }
    await page.waitForTimeout(1200);
    const r = await press(page, '#screen-shop .shop-bottom-actions .action-btn', touch);
    log('нажал «Начать рабочий день»', r.ok ? '' : r);
    day++;
    dayStart = log.t();
    visitNo = 0; accBoxes = 0; warehouseFirst = day === 1;
    await page.waitForTimeout(1200);
    return;
  }
  await page.waitForTimeout(300);
}

const limit = MINUTES * 60;
let last = '';
while (log.t() < limit && day <= DAYS) {
  if (await guideOpen(page)) { await readGuide(); continue; }
  const scr = await activeScreen(page);
  if (scr !== last) { log('— экран ' + scr); last = scr; }
  try {
    if (scr === 'screen-morning') await acceptanceStep();
    else if (scr === 'screen-scene') await sceneStep();
    else if (scr === 'screen-warehouse') await warehouseStep();
    else if (scr === 'screen-result') await resultStep();
    else if (scr === 'screen-dayend') await dayendStep();
    else if (scr === 'screen-shop') await shopStep();
    else await page.waitForTimeout(300);
  } catch (e) { log('ошибка шага', e.message.split('\n')[0]); await page.waitForTimeout(500); }
}

const tail = await page.evaluate(() => ({ toasts: window.__toasts, lines: window.__lines, snd: window.__snd, ev: window.__ygMock.events.map((e) => e.name), audio: { ctx: audio.ctx && audio.ctx.state, bgm: audio.bgmAudio ? !audio.bgmAudio.paused : null, enabled: audio.enabled }, gs: { day: gameState.day, money: gameState.money, rating: gameState.rating } }));
writeFileSync(OUT + 'play-' + DEVICE + '.json', JSON.stringify({ visits, audits, errors, ...tail }, null, 1));
log('итог', { day: tail.gs, errors: errors.length, visits: visits.length });
await browser.close();
