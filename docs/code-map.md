# Карта кода

Сгенерировано `node tools/codemap.mjs` — перезапускай после заметных правок.
Номера строк — для `Read`/`sed -n`. Разделы — из комментариев `// === ... ===` в коде.

## src/yg.js (499 строк)

- `YG` — object, стр. 19

**Инициализация SDK**

- `waitForYaGames` — function, стр. 34
- `initSDK` — function, стр. 45

**LoadingAPI / GameplayAPI (п. 1.19.2, 1.19.3)**

- `loadingReady` — function, стр. 69

**Звук**

- `pauseAllAudio` — function, стр. 84
- `resumeAllAudio` — function, стр. 85

**Потеря фокуса (п. 1.3): тишина + пауза таймера**

- `isMenuPhase` — function, стр. 88
- `pauseGameForHide` — function, стр. 93
- `resumeGameFromHide` — function, стр. 112
- `rotateBlocked` — const, стр. 133

**Лонгтап / контекстное меню (п. 1.6.1.8, 1.6.2.7)**


**Сохранения (п. 1.9, 2.6)**

- `currentPhase` — function, стр. 147
- `collectSave` — function, стр. 157
- `isMidStep` — function, стр. 213
- `snapshot` — function, стр. 221
- `scheduleCloudSave` — function, стр. 249
- `restoreSprites` — function, стр. 270
- `applySave` — function, стр. 289
- `withTimeout` — function, стр. 350
- `loadSave` — function, стр. 359

**Реклама (раздел 4)**


**Загрузка игры**


## src/game.js (6333 строк)


**ЗВУК**

- `audio` — object, стр. 8
- `toggleSound` — function, стр. 88

**ЭКРАН ЗАГРУЗКИ**

- `hideGameLoading` — function, стр. 111

**ПАРАМЕТРЫ МИНИ-ИГРЫ**

- `PARCEL_SPRITES` — array, стр. 129
- `PARCEL_SPRITES_TORN` — array, стр. 157
- `PARCEL_LABEL_META` — array, стр. 175
- `ALL_PARCELS` — array, стр. 203

**ПЕРСОНАЖИ**


**СОСТОЯНИЕ ИГРЫ (база)**

- `gameState` — object, стр. 270
- `getDayLoad` — function, стр. 288
- `getDailyExpenses` — function, стр. 301
- `warehouseFree` — function, стр. 314
- `updateHUD` — function, стр. 318
- `updateStockHud` — function, стр. 332
- `during` — const, стр. 335
- `currentCount` — const, стр. 336
- `showScreen` — function, стр. 340
- `showToast` — function, стр. 359

**СОСТОЯНИЕ ПРИЁМКИ**


**ГЕНЕРАЦИЯ РАУНДА**

- `ensureAcceptanceStage` — function, стр. 374
- `invoiceBarcode` — function, стр. 387
- `rnd` — const, стр. 392
- `bar` — const, стр. 395
- `gap` — const, стр. 396
- `digit` — const, стр. 397
- `guard` — const, стр. 403
- `startAcceptance` — function, стр. 411
- `rawDebts` — const, стр. 439
- `todayDebts` — array, стр. 441

**СКАНДАЛИСТЫ: 35% шанс что сегодня придёт скандалист (со 2 дня)**


**БОМЖ: редкий гость 7% с 2 дня, не добавляем если уже есть скандалист на той же позиции**

- `allKnownItems` — array, стр. 492
- `debtParcels` — array, стр. 493
- `usedCodes` — const, стр. 503
- `todayVisitorRoster` — array, стр. 504
- `regularItems` — array, стр. 505
- `candidateVisitors` — const, стр. 508
- `debtVisitorIds` — const, стр. 509
- `todaySeenIds` — array, стр. 534
- `invoice` — array, стр. 560
- `others` — const, стр. 568
- `idxPool` — const, стр. 572
- `takeSprite` — const, стр. 573
- `startRoundEngine` — function, стр. 622

**ОБУЧЕНИЕ ПО ПРОЦЕССАМ**

- `GUIDE_DEFS` — object, стр. 645
- `buildGuide` — function, стр. 710
- `captureGuidePause` — function, стр. 729
- `p` — object, стр. 730
- `resumeGuidePause` — function, стр. 743
- `showGuide` — function, стр. 755
- `closeGuide` — function, стр. 767
- `markGuideSeen` — function, стр. 778
- `maybeShowGuide` — function, стр. 782
- `openContextGuide` — function, стр. 790
- `buildNextBox` — function, стр. 803
- `remainingOurs` — const, стр. 807
- `hasOthers` — const, стр. 808

**ГЕОМЕТРИЯ НОМЕРА НА КОРОбКЕ**

- `parcelVisualBox` — function, стр. 862
- `numTextWidth` — function, стр. 889
- `renderCurrentBox` — function, стр. 897
- `debtBadgeOnBox` — const, стр. 909
- `updateBinCounts` — function, стр. 975
- `displaceDeadloadForDebt` — function, стр. 1011
- `al` — const, стр. 1012
- `i` — const, стр. 1013
- `onSort` — function, стр. 1021
- `currentOccupiedBefore` — const, стр. 1025
- `correct` — const, стр. 1040
- `currentOccupied` — const, стр. 1141
- `allOursSorted` — const, стр. 1142
- `endAcceptanceNow` — function, стр. 1155
- `finishAcceptance` — function, стр. 1162
- `trolleyBonusPerBox` — const, стр. 1177
- `trolleyTotal` — const, стр. 1178
- `debtsArrived` — const, стр. 1185
- `otherArrived` — const, стр. 1186
- `stock` — const, стр. 1187
- `dropDead` — const, стр. 1189
- `arrived` — array, стр. 1202
- `placedDebts` — const, стр. 1210
- `sortedInv` — const, стр. 1217
- `surplusCount` — const, стр. 1219
- `brokenCount` — const, стр. 1220
- `isWarehouseFull` — const, стр. 1231
- `titleText` — const, стр. 1232
- `openDoorsAndStartFirstCustomer` — function, стр. 1259

**СЦЕНА ПОСЕТИТЕЛЯ**

- `pick` — const, стр. 1287
- `isMaleVisitor` — function, стр. 1288
- `said` — function, стр. 1289
- `shuffleInPlace` — function, стр. 1290
- `visitorIdsSeenRecently` — function, стр. 1297
- `pickTodaysVisitors` — function, стр. 1306
- `take` — const, стр. 1308
- `result` — array, стр. 1317

**МУЖСКИЕ ТОВАРЫ: код + название + реплики клиента про заказ**


**ЖЕНСКИЕ ТОВАРЫ**

- `FEMALE_ITEMS` — array, стр. 1336

**ТОВАРЫ ДЛЯ СТАРШЕГО ПОКОЛЕНИЯ (БАБУШКИ И ДЕДУШКИ)**

- `SENIOR_ITEMS` — array, стр. 1395
- `MALE_ITEMS` — array, стр. 1452

**ПЕРСОНАЖ: ОБЫЧНЫЙ МУЖЧИНА**

- `VISITOR_MAN` — object, стр. 1549

**ВЕТКА «ЗАКАЗ НЕ НАЙДЕН» (не принял на приёмке)**


**ПОСЕТИТЕЛЬ #2: АРТЁМ — молодой, самоуверенный, пучок, бомбер, цепочка**

- `VISITOR_MAN2` — object, стр. 1715

**ВЕТКА «ЗАКАЗ НЕ НАЙДЕН» (не принял на приёмке)**


**ПОСЕТИТЕЛЬ #3: ЕГОР — подросток, наушники, худи, «ну вы поняли»**

- `VISITOR_TEEN` — object, стр. 1876

**ВЕТКА «ЗАКАЗ НЕ НАЙДЕН» (не принял на приёмке)**


**ПЕРСОНАЖ: ДЕЛОВАЯ ДЕВУШКА**

- `VISITOR_BUSINESS` — object, стр. 2038

**ПЕРСОНАЖ: ДЕВУШКА В ЖЁЛТОМ ХУДИ**

- `VISITOR_GIRL` — object, стр. 2113

**ПЕРСОНАЖ: ЯРКАЯ ДЕВУШКА-ПОДРОСТОК**

- `VISITOR_TEEN_GIRL` — object, стр. 2188

**ПЕРСОНАЖ: БАБУШКА**

- `VISITOR_GRANNY` — object, стр. 2263

**ПЕРСОНАЖ: ДЕДУШКА**


**ПЕРСОНАЖ: ВТОРАЯ БАБУШКА (В ХАЛАТЕ)**

- `VISITOR_GRANNY2` — object, стр. 2339
- `VISITOR_GRANDPA` — object, стр. 2420

**ПЕРСОНАЖ: ВТОРОЙ ДЕДУШКА (В КЕПКЕ)**

- `VISITOR_GRANDPA2` — object, стр. 2496
- `VISITOR_BUSINESSMAN` — object, стр. 2598
- `VISITOR_BABKA` — object, стр. 2720
- `VISITOR_MAMA_TIRED` — object, стр. 2841
- `VISITOR_MAMA_BABY` — object, стр. 2962
- `VISITOR_STRANNIK` — object, стр. 3083
- `VISITOR_ZLAYA` — object, стр. 3204
- `VISITOR_DYADECHKA` — object, стр. 3326
- `VISITOR_GOPAR` — object, стр. 3447
- `VISITOR_GLAMOUR` — object, стр. 3565

**Аудит: подростковые варианты ответов о товаре**

- `VISITOR_BOMZH` — object, стр. 3715
- `VISITORS` — array, стр. 3764

**СКАНДАЛИСТЫ: ТИПЫ КОНФЛИКТОВ**

- `SCANDAL_TYPES` — array, стр. 3767

**ПОРЦИОННЫЙ ВЫВОД ТЕКСТА СЦЕНЫ**

- `sceneQueue` — array, стр. 3933
- `appendSceneLine` — function, стр. 3935
- `showMore` — function, стр. 3944
- `hideMore` — function, стр. 3945
- `pumpScene` — function, стр. 3947
- `finishScene` — function, стр. 3953
- `tapScene` — function, стр. 3959
- `queueSceneLines` — function, стр. 3964

**ЭКРАН СЦЕНЫ**

- `swapChoices` — function, стр. 3979
- `addSceneContinue` — function, стр. 4002
- `REFUSE_FOLLOWUP` — array, стр. 4024
- `renderRefuseFollowup` — function, стр. 4029
- `registerReturnVisit` — function, стр. 4046
- `onRefuseFollowup` — function, стр. 4064
- `follow` — const, стр. 4071
- `renderSceneChoices` — function, стр. 4094

**ХЕЛПЕРЫ ДИАЛОГА (аудит)**

- `SENIOR_IDS` — array, стр. 4110
- `visitorItemSource` — function, стр. 4111
- `findItemForVisitor` — function, стр. 4117
- `own` — const, стр. 4118
- `neutral` — const, стр. 4120
- `foreign` — array, стр. 4124
- `QUESTION_ITEM_HINTS` — array, стр. 4129
- `pickQuestion` — function, стр. 4141
- `pool` — const, стр. 4143
- `safe` — const, стр. 4146
- `pickThought` — function, стр. 4159
- `filtered` — const, стр. 4164
- `onSceneChoice` — function, стр. 4170

**СПЕЦИАЛЬНЫЕ ВЫБОРЫ ДЛЯ ВЕРНУВШЕГОСЯ КЛИЕНТА (ПО ДОЛГУ)**

- `DEBT_CHOICES` — array, стр. 4210
- `renderDebtChoices` — function, стр. 4231
- `onDebtChoice` — function, стр. 4244

**БОМЖ — РЕДКАЯ НЕОБЫЧНАЯ ЛИЧНОСТЬ**

- `BOMZH_EVENT` — object, стр. 4306

**СКАНДАЛИСТЫ: ЛОГИКА СЦЕНЫ**

- `startScandalScene` — function, стр. 4401
- `badgeMap` — object, стр. 4410
- `renderScandalChoices` — function, стр. 4455
- `onScandalChoice` — function, стр. 4472

**РИСКОВЫЕ ВАРИАНТЫ**


**БОНУСЫ ОТ УЛУЧШЕНИЙ**

- `youText` — const, стр. 4539

**БОМЖ: СЦЕНА И ЛОГИКА КРАЖИ**

- `startBomzhScene` — function, стр. 4565
- `renderBomzhChoices` — function, стр. 4599
- `onBomzhChoice` — function, стр. 4612
- `availableBuffs` — array, стр. 4622
- `startScene` — function, стр. 4712

**ПРОВЕРКА НА БОМЖА (редкий гость)**


**ПРОВЕРКА НА СКАНДАЛИСТА**

- `allKnown` — array, стр. 4791
- `item` — const, стр. 4792
- `onShelfList` — const, стр. 4793

**СКЛАД**

- `updateWarehouseBackground` — function, стр. 4842
- `getWarehouseAvailableSlots` — function, стр. 4854
- `WH_ART` — object, стр. 4867
- `WH_SLOTS` — array, стр. 4868
- `whMap` — function, стр. 4881
- `ox` — const, стр. 4907
- `oy` — const, стр. 4908
- `whPlace` — function, стр. 4916
- `removeDeadloadByRef` — function, стр. 4943
- `onDeadloadClick` — function, стр. 4952
- `typeName` — const, стр. 4954
- `showWarehouse` — function, стр. 5014
- `isVisuallyOnShelf` — const, стр. 5093

**ВЕТКА «ЗАКАЗ НЕ НАЙДЕН»**

- `LOST_CHOICES` — array, стр. 5111
- `startLostParcel` — function, стр. 5116
- `v` — const, стр. 5120
- `queueLostScene` — function, стр. 5160
- `renderLostChoices` — function, стр. 5171
- `registerDebtPromise` — function, стр. 5186
- `n` — const, стр. 5188
- `onLostChoice` — function, стр. 5214
- `follow` — const, стр. 5233
- `pool` — const, стр. 5235
- `onDebtFailChoice` — function, стр. 5247
- `deliverParcel` — function, стр. 5283
- `idx` — const, стр. 5284

**СКАНЕР ШК: зажми и держи**

- `openScan` — function, стр. 5303
- `scanStart` — function, стр. 5318
- `scanStop` — function, стр. 5331
- `scanDone` — function, стр. 5342
- `closeScan` — function, стр. 5362

**ПОСЛЕДСТВИЯ ВЫБОРА ДЛЯ РЕЙТИНГА**

- `VISIT_RATING` — object, стр. 5371
- `visitRatingKey` — function, стр. 5382
- `applyVisitOutcome` — function, стр. 5395
- `visitReactionLine` — function, стр. 5405
- `finishVisitWithoutParcel` — function, стр. 5417

**РЕЗУЛЬТАТ**

- `showResult` — function, стр. 5432
- `happy` — const, стр. 5442
- `wrapBonus` — const, стр. 5443
- `continueCustomerFlow` — function, стр. 5486

**СЦЕНА КУРЬЕРА ВОЗВРАТОВ (еженедельный визит)**

- `startCourierScene` — function, стр. 5526
- `deadload` — const, стр. 5544
- `surplusCount` — const, стр. 5545
- `brokenCount` — const, стр. 5546
- `costPerItem` — const, стр. 5548
- `renderCourierChoices` — function, стр. 5574
- `onCourierHandover` — function, стр. 5605
- `onCourierChat` — function, стр. 5641
- `onCourierRefuse` — function, стр. 5678
- `renderCourierCleanChoices` — function, стр. 5693
- `showDayEnd` — function, стр. 5715

**СИСТЕМА МАГАЗИНА УЛУЧШЕНИЙ И РАСХОДНИКОВ**

- `openShopScreen` — function, стр. 5859
- `switchShopTab` — function, стр. 5870
- `renderShop` — function, стр. 5878
- `createShopCard` — function, стр. 6255

**СТАРТ**

