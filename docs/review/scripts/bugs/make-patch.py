# Применяет предложенные исправления к копии src → work/bugs/patched (src/ не меняется)
import re, sys
P = 'work/bugs/patched/game.js'
s = open(P, encoding='utf-8').read()
def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n < 1: sys.exit('не найдено: ' + old[:80])
    if count == 1 and n != 1: sys.exit(f'неоднозначно ({n}): ' + old[:80])
    s = s.replace(old, new)

# 1. K1: варианты выбора блокируются атрибутом disabled (клавиатура), фокус снимается
rep("""function addSceneContinue(label, fn) {""", """// Блокировка вариантов после выбора. Одного класса .disabled мало: он гасит только
// указатель, а Enter/Пробел по кнопке, оставшейся в фокусе после клика, запускают
// обработчик ещё раз (двойной штраф скандала, двойная оплата курьера и т.п.).
function lockChoices() {
  document.querySelectorAll('#scene-choices button').forEach(b => { b.classList.add('disabled'); b.disabled = true; });
  const a = document.activeElement; if (a && a.blur) a.blur();
}

function addSceneContinue(label, fn) {""")
rep("document.querySelectorAll('.scene-choice').forEach(b => b.classList.add('disabled'));", "lockChoices();", count=0)
rep("document.querySelectorAll('.scene-choice').forEach(el => el.classList.add('disabled'));", "lockChoices();")

# 2. K2: подсказка — повторное открытие не перезаписывает паузу, фокус на «Понятно»,
#    смена экрана всегда закрывает подсказку
rep("""  _guideOnClose = opts.onClose || null;
  _guidePause = captureGuidePause();
  btn.onclick = () => closeGuide();
  const ov = document.getElementById('tutorial-overlay');
  if (ov) ov.classList.add('show');
}""", """  const ov = document.getElementById('tutorial-overlay');
  const already = !!(ov && ov.classList.contains('show'));
  if (!already) { _guideOnClose = opts.onClose || null; _guidePause = captureGuidePause(); }
  else if (opts.onClose) _guideOnClose = opts.onClose;
  btn.onclick = () => closeGuide();
  if (ov) ov.classList.add('show');
  setGuideInert(true);
  try { btn.focus({ preventScroll: true }); } catch (e) {} // Enter/Пробел закрывают подсказку
}
// Под модальной подсказкой кнопки недоступны и для клавиатуры (Tab)
function setGuideInert(on) {
  ['game-hud'].forEach(id => { const el = document.getElementById(id); if (el) el.inert = on; });
  const mn = document.querySelector('main'); if (mn) mn.inert = on;
}""")
rep("""function closeGuide() {
  const ov = document.getElementById('tutorial-overlay');
  if (ov) ov.classList.remove('show');""", """function closeGuide() {
  const ov = document.getElementById('tutorial-overlay');
  if (ov) ov.classList.remove('show');
  setGuideInert(false);""")
rep("""  if (tov && id !== 'screen-morning') tov.classList.remove('show');""", """  if (tov && tov.classList.contains('show')) {
    // экран сменился — подсказка прежнего шага и его пауза больше не нужны
    tov.classList.remove('show');
    _guidePause = null; _guideOnClose = null;
    setGuideInert(false);
  }""")

# 3. SC1: таймер закрытия неверного скана не трогает новый скан; «Отмена» после успеха выключена
rep("""  document.getElementById('scan-hint').textContent = '👆 Зажми штрихкод и удерживай';
  scanState = { code, isTarget, progress: 0, timer: null, done: false };""", """  document.getElementById('scan-hint').textContent = '👆 Зажми штрихкод и удерживай';
  const _cancel = document.querySelector('#scan-overlay .scan-cancel'); if (_cancel) _cancel.disabled = false;
  scanState = { code, isTarget, progress: 0, timer: null, done: false };""")
rep("""    deliverParcel(scanState.code); // выданный заказ исчезает со склада
    setTimeout(() => { closeScan(); showResult(); }, 900);""", """    deliverParcel(scanState.code); // выданный заказ исчезает со склада
    const _cancel = document.querySelector('#scan-overlay .scan-cancel'); if (_cancel) _cancel.disabled = true; // заказ уже выдан
    setTimeout(() => { closeScan(); showResult(); }, 900);""")
rep("""    audio.bad();
    setTimeout(closeScan, 1200);""", """    audio.bad();
    const s = scanState;
    setTimeout(() => { if (scanState === s) closeScan(); }, 1200); // игрок мог уже открыть другую коробку""")

# 4. D1: один таймер подсказки мёртвого груза, сбрасывается при новом тапе и новом клиенте
rep("""function onDeadloadClick(p) {""", """let _deadloadHintTimer = null;
function onDeadloadClick(p) {""")
rep("""    fb.appendChild(adBtn);
    setTimeout(() => {""", """    fb.appendChild(adBtn);
    clearTimeout(_deadloadHintTimer);
    _deadloadHintTimer = setTimeout(() => {""")
rep("""function showWarehouse() {
  const cust = gameState.activeVisitor;
  if (!cust) return;""", """function showWarehouse() {
  const cust = gameState.activeVisitor;
  if (!cust) return;
  clearTimeout(_deadloadHintTimer);""")

# 5. E1: в «валовую» — фактическое изменение баланса; знак у отрицательной валовой
rep("""  gameState.dayGrossIncome = (gameState.dayGrossIncome || 0) + net; // E-5: отрицательный итог тоже в отчёте
  gameState.money = Math.max(0, gameState.money + net);""", """  const _moneyBefore = gameState.money;
  gameState.money = Math.max(0, gameState.money + net);
  // E-5: отрицательный итог тоже в отчёте, но не больше, чем реально ушло с баланса
  gameState.dayGrossIncome = (gameState.dayGrossIncome || 0) + (gameState.money - _moneyBefore);""")
rep("""  if (elGross) elGross.textContent = '+' + gross + ' ₽';""", """  if (elGross) elGross.textContent = (gross >= 0 ? '+' : '') + gross + ' ₽';""")

# 6. RS7: «аварийный вывоз» — только при первом показе отчёта за день
rep("""  if ((gameState._lastExpenseDay || 0) < currentDayFinished) {
    gameState.money = Math.max(0, gameState.money - exp.total);
    gameState._lastExpenseDay = currentDayFinished;
  }""", """  let _firstReport = false;
  if ((gameState._lastExpenseDay || 0) < currentDayFinished) {
    gameState.money = Math.max(0, gameState.money - exp.total);
    gameState._lastExpenseDay = currentDayFinished;
    _firstReport = true;
  }""")
rep("""    if (gameState.money < 60 && _deadList.length > 0 && warehouseFree() === 0) {""", """    if (_firstReport && gameState.money < 60 && _deadList.length > 0 && warehouseFree() === 0) {""")

# 7. W1: «свою», которую некуда поставить, не подаём; «Чужие» на ней — возврат без штрафа
rep("""  let parcel, expected, isBroken = false;
  if (kind === 'ours') {
    // Если есть неотсортированные долги — подаем их в первую очередь
    const unsortedDebts = acceptance.invoice.filter(i => i.isDebt && !i.sorted);
    const unsorted = acceptance.invoice.filter(i => !i.sorted);""", """  // «Свои», которые некуда поставить, не подаём: склад полон, а вытеснить можно только
  // мёртвый груз и только ради долга. Иначе коробка крутится по кругу (−25 ₽ за каждый «возврат»).
  const _occ = (gameState.shelfParcels || []).length + acceptance.acceptedList.length;
  const _room = _occ < gameState.warehouseCapacity;
  const _dead = (gameState.shelfParcels || []).concat(acceptance.acceptedList).some(p => p.status === 'surplus' || p.status === 'broken');
  const _placeable = acceptance.invoice.filter(i => !i.sorted && (_room || (i.isDebt && _dead)));
  if (kind === 'ours' && _placeable.length === 0) kind = (hasOthers ? (Math.random() < 0.6 ? 'others' : 'broken') : 'ours');
  if (kind === 'ours' && _placeable.length === 0) { finishAcceptance('full'); return; }

  let parcel, expected, isBroken = false;
  if (kind === 'ours') {
    // Если есть неотсортированные долги — подаем их в первую очередь
    const unsortedDebts = _placeable.filter(i => i.isDebt);
    const unsorted = _placeable;""")
rep("""        : '⚠️ Склад заполнен! Эту коробку принять нельзя — отсортируйте как чужую или завершите приёмку.');""", """        : '⚠️ Склад заполнен! Эту коробку некуда поставить — «Чужие» вернёт её отправителю без штрафа.');""")
rep("""  const cur = acceptance.current;
  const correct = (bin === cur.expected);""", """  const cur = acceptance.current;
  // Коробка накладной, которой нет места: «Чужие»/«Брак» — вернуть отправителю, без штрафа
  if (cur.expected === 'ours' && bin !== 'ours' && currentOccupiedBefore >= gameState.warehouseCapacity) {
    cur.sorted = true;
    if (cur.parcel && !cur.parcel.sorted) { cur.parcel.sorted = true; cur.parcel.returned = true; }
    const box0 = document.getElementById('sort-box'); if (box0) box0.classList.add('fly-out');
    if (acceptance._nextBoxTimeout) clearTimeout(acceptance._nextBoxTimeout);
    acceptance._nextBoxTimeout = setTimeout(() => { if (acceptance && acceptance.running) buildNextBox(); }, 480);
    return;
  }
  const correct = (bin === cur.expected);""")
open(P, 'w', encoding='utf-8').write(s)
print('ok')
