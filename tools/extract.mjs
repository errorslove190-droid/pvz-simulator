#!/usr/bin/env node
// Разбирает цельный index.html (формат загрузки в Яндекс Игры) на читаемые исходники:
// index.html, styles.css, yg.js, game.js, assets/* (картинки и звук из base64) и build.json.
// Обратная операция — tools/build.mjs; сборка разобранного файла совпадает с ним байт в байт.
//
//   node tools/extract.mjs <index.html | архив.zip> [папка]      (папка по умолчанию — src)
//
// Бэкапы старых версий удобно разбирать в work/: node tools/extract.mjs backups/x.zip work/x
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip } from './lib/zip.mjs';

const [input, outDir = 'src'] = process.argv.slice(2);
if (!input) {
  console.error('usage: node tools/extract.mjs <index.html | archive.zip> [outDir]');
  process.exit(1);
}

function load(path) {
  const buf = readFileSync(path);
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const f = readZip(buf).find((e) => /(^|\/)index\.html$/i.test(e.name));
    if (!f) throw new Error('в архиве нет index.html');
    return f.data.toString('utf8');
  }
  return buf.toString('utf8');
}

const EXT = {
  'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'audio/mp3': 'mp3', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'font/woff2': 'woff2', 'font/woff': 'woff',
};
const DATA_RE = /data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;

// 1. Инлайн-скрипты и стили — в отдельные файлы (скрипты первыми: в JS бывают строки с «<style>»)
let html = load(input);
const scripts = [];
const styles = [];
html = html.replace(/<script>([\s\S]*?)<\/script>/g, (_, js) => {
  const base = /window\.YG\s*=\s*YG/.test(js) ? 'yg' : /gameState/.test(js) ? 'game' : 'script';
  let f = base + '.js';
  for (let n = 2; scripts.some((s) => s.file === f); n++) f = `${base}-${n}.js`;
  scripts.push({ file: f, kind: 'js', text: js });
  return `<script src="${f}"></script>`;
});
html = html.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => {
  const f = styles.length ? `styles-${styles.length + 1}.css` : 'styles.css';
  styles.push({ file: f, kind: 'css', text: css });
  return `<link rel="stylesheet" href="${f}">`;
});
const parts = [...styles, { file: 'index.html', kind: 'html', text: html }, ...scripts];

// 2. base64-ассеты: имя берём из контекста (const VISITOR_MAN_IMG → visitor-man.webp)
const slug = (s) => s.replace(/_?(IMG|IMAGE|SRC)$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'asset';

function contextName(clean, kind) {
  const tail = clean.slice(-800);
  let best = null;
  const consider = (re, pick) => {
    for (const m of tail.matchAll(re)) {
      const end = m.index + m[0].length;
      if (!best || end >= best.end) best = { end, name: pick(m) };
    }
  };
  if (kind === 'css') {
    consider(/([^{};/]+)\{[^{}]*$/g, (m) => m[1].trim().split(',').pop().trim().split(/\s+/).pop());
  } else {
    consider(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, (m) => m[1]);
    consider(/\b([A-Za-z_$][\w$]*)\s*:\s*(?=["'`[{(]|$)/g, (m) => m[1]);
    consider(/\bthis\.([A-Za-z_$][\w$]*)\s*=/g, (m) => m[1]);
    if (kind === 'html') consider(/\bid="([\w-]+)"[^>]*$/g, (m) => m[1]);
  }
  return best ? slug(best.name) : 'asset';
}

const unique = new Map(); // mime,b64 → asset
const hits = [];
for (const part of parts) {
  let clean = '';
  let last = 0;
  for (const m of part.text.matchAll(DATA_RE)) {
    clean += part.text.slice(last, m.index);
    last = m.index + m[0].length;
    const key = m[1] + ',' + m[2];
    if (!unique.has(key)) unique.set(key, { mime: m[1], b64: m[2], base: contextName(clean, part.kind) });
    hits.push({ part, start: m.index, end: last, asset: unique.get(key) });
    clean += '__ASSET__';
  }
}
const perBase = new Map();
for (const a of unique.values()) perBase.set(a.base, (perBase.get(a.base) || 0) + 1);
const seen = new Map();
const taken = new Set();
for (const a of unique.values()) {
  const ext = EXT[a.mime] || 'bin';
  const n = (seen.get(a.base) || 0) + 1;
  seen.set(a.base, n);
  let file = perBase.get(a.base) > 1 ? `${a.base}-${String(n).padStart(2, '0')}.${ext}` : `${a.base}.${ext}`;
  for (let k = 2; taken.has(file); k++) file = `${a.base}-${k}.${ext}`;
  taken.add(file);
  a.file = file;
}
for (let i = hits.length - 1; i >= 0; i--) {
  const h = hits[i];
  h.part.text = h.part.text.slice(0, h.start) + 'assets/' + h.asset.file + h.part.text.slice(h.end);
}

// 3. Запись
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'assets'), { recursive: true });
const manifest = { styles: styles.map((s) => s.file), scripts: scripts.map((s) => s.file), assets: {} };
for (const a of unique.values()) {
  const bytes = Buffer.from(a.b64, 'base64');
  if (bytes.toString('base64') === a.b64) {
    writeFileSync(join(outDir, 'assets', a.file), bytes);
    manifest.assets[a.file] = a.mime;
  } else { // нестандартный base64 — храним текстом, чтобы сборка вернула его как было
    writeFileSync(join(outDir, 'assets', a.file + '.b64'), a.b64);
    manifest.assets[a.file] = { mime: a.mime, raw: true };
  }
}
for (const p of parts) writeFileSync(join(outDir, p.file), p.text);
writeFileSync(join(outDir, 'build.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${outDir}: ${parts.map((p) => p.file).join(', ')} + ${unique.size} ассетов`);
