#!/usr/bin/env node
// Карта кода: функции и крупные константы верхнего уровня с номерами строк → docs/code-map.md.
// Перезапускать после заметных правок: node tools/codemap.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['src/yg.js', 'src/game.js'];
const DECL = /^(\s{0,2})(?:async\s+)?(?:function\s+([\w$]+)|(?:const|let)\s+([A-Z][\w$]*|[a-z][\w$]*)\s*=\s*(\{|\[|\(|function|async|[^;]{0,40}=>))/;
const SECTION = /^\s*\/\/\s*={2,}\s*(.+?)\s*={0,}\s*$|^\s*\/\*\s*-{3,}\s*(.+?)\s*-{3,}\s*\*\/\s*$/;

let md = '# Карта кода\n\nСгенерировано `node tools/codemap.mjs` — перезапускай после заметных правок.\n' +
  'Номера строк — для `Read`/`sed -n`. Разделы — из комментариев `// === ... ===` в коде.\n';
for (const f of FILES) {
  const lines = readFileSync(f, 'utf8').split('\n');
  md += `\n## ${f} (${lines.length} строк)\n\n`;
  lines.forEach((line, i) => {
    const s = line.match(SECTION);
    if (s) { md += `\n**${(s[1] || s[2]).replace(/[=*]+$/, '').trim()}**\n\n`; return; }
    const m = line.match(DECL);
    if (!m) return;
    const name = m[2] || m[3];
    const kind = m[2] ? 'function' : (m[4] === '{' ? 'object' : m[4] === '[' ? 'array' : 'const');
    md += `- \`${name}\` — ${kind}, стр. ${i + 1}\n`;
  });
}
writeFileSync('docs/code-map.md', md);
console.log('docs/code-map.md обновлён');
