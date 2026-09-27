# AGENTS.md — контекст проекта для ИИ-инструментов

Этот файл читают Claude Code (через `CLAUDE.md`), Codex, Cursor, Copilot и другие агенты.
Держи его актуальным: всё, что нужно знать новому инструменту, — здесь или по ссылкам отсюда.

## Что это

**«Симулятор Сотрудника ПВЗ»** — казуальная браузерная игра для **Яндекс Игр**, портретный
режим на телефоне, на компьютере — колонка шириной до 600 px. Чистый JavaScript без фреймворков
и без сборщиков пакетов. На платформу загружается **один файл `index.html`** (все картинки и
музыка внутри в base64), поэтому в репозитории исходники разобраны на части, а сборка склеивает
их обратно.

Игровой день: утренняя **приёмка** (сортировка коробок на время) → **посетители** (диалоги с
выбором, поиск заказа на складе, сканирование штрихкода) → **отчёт смены** (аренда, прибыль)
→ **магазин улучшений** → следующий день. Раз в неделю — курьер возвратов. Подробно — в
[docs/game-design.md](docs/game-design.md).

## Карта репозитория

| Путь | Что там |
|---|---|
| `src/index.html` | разметка экранов (HUD, приёмка, сцена, склад, результат, отчёт, магазин, сканер, подсказки) |
| `src/styles.css` | все стили (~80 КБ) |
| `src/yg.js` | слой Яндекс Игр: SDK, пауза при потере фокуса, **сохранения**, реклама, загрузка |
| `src/game.js` | вся игра (~6300 строк, ~480 КБ; больше половины — тексты диалогов посетителей) |
| `src/assets/` | 66 картинок webp + музыка mp3 (вынуты из base64) |
| `src/build.json` | что встраивать при сборке: стили, скрипты, ассеты с MIME |
| `tools/build.mjs` | сборка `dist/index.html` + `dist/pvz-simulator.zip` для загрузки |
| `tools/extract.mjs` | обратная операция: цельный `index.html`/zip → исходники (для бэкапов) |
| `tools/serve.mjs`, `tools/sdk-mock.js` | локальный сервер и имитация SDK Яндекс Игр |
| `tools/smoke.mjs` | бот проходит несколько дней и проверяет сохранения (Playwright) |
| `tools/codemap.mjs` | генерирует [docs/code-map.md](docs/code-map.md) — функции с номерами строк |
| `backups/` | исходные версии игры как есть, не править |
| `docs/` | дизайн, сохранения, требования Яндекса, журнал изменений, обзоры |
| `dist/`, `work/`, `node_modules/` | генерируется, в git не попадает |

## Команды

```bash
npm run dev        # http://localhost:8080 — игра из src/ с имитацией SDK (без npm install)
npm run build      # dist/index.html и dist/pvz-simulator.zip (его загружать в консоль Яндекс Игр)
npm run dev:dist   # http://localhost:8081 — проверить собранный файл
npm install && npx playwright install chromium   # один раз, только ради smoke-теста
npm run smoke      # бот: 3 дня + проверки сохранений; должен заканчиваться «Все проверки пройдены»
node tools/codemap.mjs   # обновить карту кода после заметных правок
```

Параметры имитации SDK в адресе: `?lang=en` — язык, `?adMs=300` — длительность «рекламы».
В консоли браузера: `__ygMock.events` (журнал вызовов SDK), `__ygMock.pause()/resume()`,
`__ygMock.clearCloud()`. Сброс прогресса: очистить localStorage (`pvz_sim_save_v1`, `__ygMockCloud`).

## Правила работы с кодом

1. **Правь только `src/`**. `dist/` собирается, `backups/` — неизменяемые оригиналы.
2. **base64 руками не трогай.** Новая картинка — файл в `src/assets/`, ссылка в коде как
   строка `'assets/имя.webp'` (в CSS — `url("assets/имя.webp")`) и запись в `src/build.json`
   (`"имя.webp": "image/webp"`). Сборка сама заменит ссылку на data URI.
3. **Скрипты — обычные (не модули) и делят глобальную область.** `yg.js` грузится первым и
   обращается к `gameState`, `acceptance`, `sceneQueue` из `game.js` во время работы. Порядок
   `<script>` в `index.html` не менять; `import/export` не использовать.
4. **Сохранения — только на границе шагов** (подробно [docs/saves.md](docs/saves.md)):
   `YG.save({ phase })` вызывается, когда состояние согласовано: конец приёмки, после визита
   (`continueCustomerFlow`), отчёт, магазин, курьер. Посреди приёмки или визита `YG.save()`
   без фазы пишет последний согласованный снимок — не ломай это правило.
5. **Требования Яндекс Игр** ([docs/yandex-games.md](docs/yandex-games.md)): никаких внешних
   запросов и ссылок; `LoadingAPI.ready()` — один раз, когда можно играть; `GameplayAPI.start/stop`
   — вокруг активной игры; реклама только в логических паузах, звук и таймеры на паузе во время
   рекламы и при уходе со вкладки; прокрутки страницы и контекстного меню нет.
6. **Тексты — по-русски**, сотрудник говорит клиентам «вы». Род персонажа — через
   `said(v, 'мужской', 'женский')` (`v.male`). Мужчинам — товары из `MALE_ITEMS`, пожилым —
   `SENIOR_ITEMS` (см. `visitorItemSource`).
7. **Баланс** — константы в начале `game.js` и в `getDayLoad`, `getDailyExpenses`,
   `VISIT_RATING`, `showResult`, `renderShop`. Меняешь цифры — обнови таблицы в
   [docs/game-design.md](docs/game-design.md).
8. После правок: `npm run build` без ошибок и `npm run smoke` с «Все проверки пройдены».
   Изменение, заметное игроку, — строка в [docs/changelog.md](docs/changelog.md).

## Как читать большой `game.js`

- Сначала [docs/code-map.md](docs/code-map.md): функции и разделы с номерами строк.
- Читай диапазонами строк, ищи по именам функций. Данные персонажей (`VISITOR_*`, `*_ITEMS`) —
  это тексты, логика в них почти не живёт.
- Поток дня: `startAcceptance` → `startRoundEngine` → `buildNextBox`/`onSort` →
  `finishAcceptance` → `openDoorsAndStartFirstCustomer` → `startScene` (или `startScandalScene`,
  `startBomzhScene`) → выбор (`onSceneChoice`, `onDebtChoice`, …) → `showWarehouse` →
  `openScan`/`scanDone` → `showResult` → `continueCustomerFlow` → … → `startCourierScene`
  (дни 7, 14, …) → `showDayEnd` → `openShopScreen` → `YG.startNewDay` (реклама) → `startAcceptance`.
- Порядок посетителей дня: сначала должники (`activeDebtsQueue`), затем `todayVisitorRoster`;
  скандалист и бомж занимают свои позиции `pos`, смещения считаются в `startScene` и
  `continueCustomerFlow` — меняй их вместе.

## Состояние и планы

- Журнал изменений: [docs/changelog.md](docs/changelog.md).
- Обзор от 27.09.2026 и найденные проблемы: [docs/review/](docs/review/) — начинай со сводки
  [`00-summary.md`](docs/review/00-summary.md): десять проблем по приоритету, формула
  залипательности, план. Проверенные исправления ошибок — `docs/review/01-bugs-fixes.diff`
  (`git apply -p0 …`), симулятор экономики — `node docs/review/economy-sim.mjs`.
- Бэкапы других версий: [backups/README.md](backups/README.md).
