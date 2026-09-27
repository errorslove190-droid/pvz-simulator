# Бэкапы

Исходные версии игры как есть — **не править**. Имя: `ГГГГ-ММ-ДД-описание.zip` (или `.html`).

| Файл | Что это |
|---|---|
| `2026-09-04-original.zip` | версия, с которой начат репозиторий; `src/` в первом коммите — она же, байт в байт |

## Добавить бэкап и сравнить с текущей версией

```bash
cp ~/Downloads/старая-версия.zip backups/2026-08-20-ранняя.zip
node tools/extract.mjs backups/2026-08-20-ранняя.zip work/2026-08-20
git diff --no-index --stat work/2026-08-20 src
git diff --no-index work/2026-08-20/game.js src/game.js
npm run smoke -- --root work/2026-08-20     # прогнать бота по старой версии
```

`tools/extract.mjs` принимает и zip, и `index.html`; `work/` в git не попадает.
