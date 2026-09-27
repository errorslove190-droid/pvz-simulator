#!/usr/bin/env node
// Собирает игру в один файл для Яндекс Игр: стили, скрипты и ассеты встраиваются в index.html.
//
//   node tools/build.mjs                  → dist/index.html и dist/pvz-simulator.zip (его и грузить в консоль)
//   node tools/build.mjs --check <файл>   → ещё и сравнить результат с файлом байт в байт
//   node tools/build.mjs --src work/x --out work/x-dist
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, writeZip } from './lib/zip.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const src = arg('--src', 'src');
const out = arg('--out', 'dist');
const check = arg('--check', null);

const cfg = JSON.parse(readFileSync(join(src, 'build.json'), 'utf8'));
const read = (f) => readFileSync(join(src, f), 'utf8');

const refs = Object.entries(cfg.assets).map(([file, a]) => {
  const mime = typeof a === 'string' ? a : a.mime;
  const b64 = typeof a === 'object' && a.raw
    ? read(join('assets', file + '.b64'))
    : readFileSync(join(src, 'assets', file)).toString('base64');
  return ['assets/' + file, `data:${mime};base64,${b64}`];
});
// split/join — буквальная замена (в base64 нет «.» и «-», поэтому ссылки не пересекаются с данными)
const inlineAssets = (text) => refs.reduce((t, [ref, uri]) => t.split(ref).join(uri), text);

function replaceOnce(text, tag, content) {
  const i = text.indexOf(tag);
  if (i < 0 || text.indexOf(tag, i + 1) >= 0) throw new Error(`в index.html нужен ровно один ${tag}`);
  return text.slice(0, i) + content + text.slice(i + tag.length);
}

let html = inlineAssets(read('index.html'));
for (const f of cfg.styles) html = replaceOnce(html, `<link rel="stylesheet" href="${f}">`, `<style>${inlineAssets(read(f))}</style>`);
for (const f of cfg.scripts) html = replaceOnce(html, `<script src="${f}"></script>`, `<script>${inlineAssets(read(f))}</script>`);

const bytes = Buffer.from(html, 'utf8');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), bytes);
writeFileSync(join(out, 'pvz-simulator.zip'), writeZip([{ name: 'index.html', data: bytes }]));
console.log(`${out}/index.html — ${(bytes.length / 1048576).toFixed(2)} МБ, ${out}/pvz-simulator.zip — для загрузки в Яндекс Игры`);

if (check) {
  const raw = readFileSync(check);
  const ref = raw.readUInt32LE(0) === 0x04034b50
    ? readZip(raw).find((e) => /(^|\/)index\.html$/i.test(e.name)).data
    : raw;
  if (ref.equals(bytes)) console.log(`совпадает с ${check} байт в байт`);
  else {
    let i = 0;
    while (i < ref.length && ref[i] === bytes[i]) i++;
    console.error(`НЕ совпадает с ${check}: первое отличие на байте ${i}`);
    process.exit(1);
  }
}
