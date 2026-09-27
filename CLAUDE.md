@AGENTS.md

## Для Claude Code

- `src/game.js` большой: открывай его диапазонами строк по [docs/code-map.md](docs/code-map.md)
  и ищи по именам функций, не читай файл целиком.
- `src/assets/` и `backups/` — бинарные файлы, читать их не нужно.
- Проверка изменений в браузере: `npm run smoke` (Playwright). Если нужен свой сценарий —
  бери за основу функции `playAcceptance` и `playCustomers` из `tools/smoke.mjs`: они
  играют через глобальные функции игры (`onSort`, `tapScene`, `scanStart`, …).
- Разобрать присланный бэкап: `node tools/extract.mjs <архив.zip> work/<имя>`, сравнить с
  текущей версией: `git diff --no-index work/<имя>/game.js src/game.js`.
