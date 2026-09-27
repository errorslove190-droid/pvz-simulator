# Сценарии проверок из обзора

Скрипты, которыми агенты обзора подтверждали находки (Playwright и Node). Отчёты ссылаются на них
по именам. Писались для запуска из `work/<роль>/`, поэтому перед запуском скопируй их туда:

```bash
mkdir -p work/bugs && cp docs/review/scripts/bugs/* work/bugs/
node tools/serve.mjs --port 8801 &     # порт — как в отчёте роли
node work/bugs/k1-keyboard-double.mjs
```

| Папка | Отчёт | Порт сервера |
|---|---|---|
| `bugs/` | [01-bugs.md](../01-bugs.md) | 8801 |
| `yandex/` | [02-yandex.md](../02-yandex.md) | 8802, собранный файл — 8812 |
| `playtest/` | [04-playtest.md](../04-playtest.md) | 8804 |
| `retention/` | [05-retention.md](../05-retention.md) | 8805 |

Симулятор экономики — отдельным файлом [../economy-sim.mjs](../economy-sim.mjs).
Выводы прогонов (`*.out`, скриншоты, данные) в репозиторий не сохранялись.
