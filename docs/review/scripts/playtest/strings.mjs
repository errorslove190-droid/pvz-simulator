// Извлекает все строковые литералы из JS-файла с номерами строк (простая лексика).
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2] || 'src/game.js';
const src = readFileSync(file, 'utf8');
const out = [];
let i = 0, line = 1, lastSig = '';
const push = (startLine, text, q) => out.push({ line: startLine, text, q });
while (i < src.length) {
  const c = src[i], n = src[i + 1];
  if (c === '\n') { line++; i++; continue; }
  if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
  if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
  if (c === '"' || c === "'") {
    const st = line; let s = ''; i++;
    while (i < src.length && src[i] !== c) { if (src[i] === '\\') { s += src[i] + src[i + 1]; i += 2; continue; } if (src[i] === '\n') line++; s += src[i++]; }
    i++; push(st, s, c); lastSig = 'str'; continue;
  }
  if (c === '`') {
    const st = line; let s = ''; i++; let depth = 0;
    while (i < src.length) {
      if (src[i] === '\\') { s += src[i] + src[i + 1]; i += 2; continue; }
      if (depth === 0 && src[i] === '`') break;
      if (src[i] === '$' && src[i + 1] === '{') { depth++; s += '${'; i += 2; continue; }
      if (depth > 0 && src[i] === '}') { depth--; s += '}'; i++; continue; }
      if (src[i] === '\n') line++;
      s += src[i++];
    }
    i++; push(st, s, '`'); lastSig = 'str'; continue;
  }
  if (c === '/') {
    // regex or division
    if (!lastSig || /[(,=:\[!&|?{};+\-*%<>~^]$/.test(lastSig) || lastSig === 'return') {
      i++; let inClass = false;
      while (i < src.length) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false; else if (src[i] === '/' && !inClass) break; i++; }
      i++; while (/[a-z]/.test(src[i])) i++; lastSig = 'rx'; continue;
    }
  }
  if (/\s/.test(c)) { i++; continue; }
  if (/[A-Za-z0-9_$]/.test(c)) { let w = ''; while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) w += src[i++]; lastSig = w === 'return' ? 'return' : 'id'; continue; }
  lastSig = c; i++;
}
const cyr = out.filter((o) => /[А-Яа-яЁё]/.test(o.text));
writeFileSync(process.argv[3] || 'work/playtest/strings.tsv', cyr.map((o) => o.line + '\t' + o.text.replace(/\n/g, '\\n')).join('\n'));
console.log('всего строк-литералов:', out.length, 'с кириллицей:', cyr.length);
