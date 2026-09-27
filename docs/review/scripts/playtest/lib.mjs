// Общие помощники плейтеста: игра через интерфейс (тапы/клики), журнал времени, аудит экрана.
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

export const BASE = 'http://localhost:8804/?adMs=300';
export const OUT = new URL('./', import.meta.url).pathname;
mkdirSync(OUT + 'shots', { recursive: true });

export function makeLog(name) {
  const file = OUT + name + '.log';
  writeFileSync(file, '');
  const t0 = Date.now();
  const rows = [];
  const log = (ev, extra) => {
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    const line = `[${t.padStart(6)}s] ${ev}${extra !== undefined ? ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`;
    rows.push({ t: +t, ev, extra });
    appendFileSync(file, line + '\n');
    console.log(line);
  };
  log.t = () => (Date.now() - t0) / 1000;
  log.rows = rows;
  return log;
}

// Скрипт до загрузки страницы: журнал тостов и видимых реплик
export const INIT = () => {
  window.__toasts = [];
  window.__lines = [];
  document.addEventListener('DOMContentLoaded', () => {
    const t = document.getElementById('toast');
    if (t) new MutationObserver(() => {
      if (t.classList.contains('show')) window.__toasts.push({ t: performance.now(), text: t.textContent });
    }).observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
    const st = document.getElementById('scene-text');
    if (st) new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType === 1) window.__lines.push({ t: performance.now(), who: (n.className || '').replace('scene-line ', ''), text: n.innerText.replace(/\s+/g, ' ').trim() });
    }))).observe(st, { childList: true });
  });
};

// Обёртка звуков после загрузки
export async function hookSound(page) {
  await page.evaluate(() => {
    window.__snd = [];
    ['good', 'bad', 'coin', 'tap', 'whoosh'].forEach((k) => {
      const f = audio[k].bind(audio);
      audio[k] = (...a) => { const s = document.querySelector('.screen-card.active'); window.__snd.push({ k, t: performance.now(), scr: s && s.id, on: audio.enabled }); return f(...a); };
    });
  });
}

export const activeScreen = (page) => page.evaluate(() => { const s = document.querySelector('.screen-card.active'); return s ? s.id : null; });
export const guideOpen = (page) => page.evaluate(() => document.getElementById('tutorial-overlay').classList.contains('show'));

// Нажатие как у человека: tap на телефоне, click мышью на компьютере
export async function press(page, target, touch, opts = {}) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  const t = Date.now();
  try {
    if (touch) await loc.tap({ timeout: opts.timeout || 4000 });
    else await loc.click({ timeout: opts.timeout || 4000 });
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, err: String(e.message).split('\n').slice(0, 3).join(' | ') };
  }
}

// Удержание пальцем/мышью (для сканера): CDP touch или mouse down/up
export async function hold(page, selector, ms, touch, cdp) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return false;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  }
  return true;
}

// Аудит видимых нажимаемых элементов и текста на текущем экране
export async function audit(page, label) {
  return page.evaluate((label) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05
        && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };
    const nm = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.classList.length ? '.' + [...el.classList].join('.') : '')
      + ' «' + (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 42) + '»';
    const clickSel = 'button, [onclick], .wh-box, .wh-plate-num, .scene-narration, .scan-bc-wrap, .shop-tab-pill';
    const clickables = [...document.querySelectorAll(clickSel)].filter(vis).filter((el) => !el.closest('#loading-screen'));
    const small = [], covered = [];
    clickables.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) small.push({ el: nm(el), w: Math.round(r.width), h: Math.round(r.height) });
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return;
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el) && !top.closest('.toast-msg')) covered.push({ el: nm(el), by: nm(top) });
    });
    // обрезанный текст и мелкий шрифт
    const cut = [], tiny = new Map();
    document.querySelectorAll('#game-container *, .toast-msg, #tutorial-overlay *').forEach((el) => {
      if (!vis(el)) return;
      const cs = getComputedStyle(el);
      const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (ownText) {
        const fs = parseFloat(cs.fontSize);
        if (fs < 12) { const k = Math.round(fs * 10) / 10 + 'px'; if (!tiny.has(k)) tiny.set(k, []); if (tiny.get(k).length < 6) tiny.get(k).push(ownText.slice(0, 40)); }
        const clip = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap';
        if (clip && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') cut.push({ el: nm(el), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
      }
      // выход за край экрана
      const r = el.getBoundingClientRect();
      if (ownText && (r.right > innerWidth + 1 || r.left < -1)) cut.push({ el: nm(el), offscreen: [Math.round(r.left), Math.round(r.right)] });
    });
    const de = document.documentElement;
    return {
      label, vw: innerWidth, vh: innerHeight,
      pageScroll: { x: de.scrollWidth > de.clientWidth, y: de.scrollHeight > de.clientHeight },
      small, covered, cut: cut.slice(0, 15), tiny: Object.fromEntries(tiny),
    };
  }, label);
}

export async function shot(page, name, log) {
  const p = OUT + 'shots/' + name + '.jpg';
  await page.screenshot({ path: p, type: 'jpeg', quality: 70 });
  if (log) log('📸 ' + name);
  return p;
}
