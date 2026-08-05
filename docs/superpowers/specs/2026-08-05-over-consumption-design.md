# Over-Consumption While Off-Grid Automation — Design

Дата: 2026-08-05
Статус: затверджено

## Мета

Сповіщати користувача про **незареєстроване** (невиміряне розетками) споживання
понад поріг, коли мережа вимкнена: сцена з новою умовою `over_consumption`
(«інвертор від мережі + невиміряні споживачі тягнуть батарею»).

## Контекст (що вже є)

- «Незареєстроване» споживання вже обчислюється в `index.js:234`:
  `otherLoad = max(0, loadPower − Σ power(Tuya-розетки))` — графік «Unregistered» у UI.
- `checkScenes` (30с) будує `ctx` з `inverterData`, `tuyaDevices`, `gridIsDown`,
  `lastGridWasDown`, `inverterConsecutiveFails`, `now`.
- `gridIsDown` вже вимагає `inverterFresh` (lastUpdate ≤ 30с) — ігнорує протухлі дані.
- Облік початку вимкнення: `_gridOutage.since` в `checkScenes`.
- `expandNotifyTemplate` підставляє шаблони з `_lastOutageReport`
  ({{duration}}, {{soc_start}}, {{start_time}}, …); невідомі `{{...}}` → «—».

## Нова умова сцени `over_consumption`

Поля умови (калібрування «на льоту» з UI):
- `threshold` (W, дефолт 60) — поріг незареєстрованої потужності;
- `stabilityMins` (хв, дефолт 5) — безперервна тривалість перевищення;
- `oncePerOutage` (bool, дефолт true) — режим спрацювання.

Поведінка:
- Активна лише при `gridIsDown` + `inverterFresh`.
- Стабільна фаза: від першого семпла з `otherLoad > threshold` (строго `>`);
  будь-який семпл `otherLoad ≤ threshold` **перериває** і запускає відлік наново.
- Після `stabilityMins` безперервного перевищення:
  - `oncePerOutage=true` — подія спрацьовує один раз за вимкнення, мріоблана
    (не повторюється) до повернення мережі;
  - `oncePerOutage=false` — умова лишається `true`, поки триває перевищення
    (повторні спрацювання — через інтервали notify/сцену).
- Скидання стану: повернення мережі (`grid ON`), протухання даних інвертора
  (stale), падіння нижче порогу.

## Компоненти

### 1. `lib/over-consumption.js` (новий, нуль залежностей)

`createOverConsumeDetector({ threshold, stabilityMs, oncePerOutage })` → API:
- `onSample(watts, now?)` — спостереження `otherLoad`; веде стан
  (startTs / exceeded / firedOnce);
- `onGridUp(now?)` — скидання всього стану (вимкнення завершилось);
- `takeEvent(now?)` — разова подія (для once-режиму): віддає і мріоблана;
- `isExceeded(now?)` — стійке перевищення активне зараз (для persistent-режиму).
- `setConfig(cfg)` — переконфігурація зі сцен.

Внутрішній стан: `{ phase: 'idle'|'stable', startTs, exceededSince, fired }`.

### 2. `lib/app-state.js` (інтеграція)

- `ctx.otherLoad` — обчислюється в `checkScenes` тією ж формулою, що в
  `index.js` (`max(0, loadPower − Σ dev.power)`), тож `index.js` НЕ змінюється.
- `_overConsume` — Map **sceneName → детектор** (у різних сценах різні пороги,
  тому стан прив'язаний до сцени, а не глобально):
  - синхронізація: нова `_syncOverConsumeConfigs()`, викликається з
    `_rebuildSceneDeps` — ітерує сцени, для першої умови `over_consumption`
    кожної сцени створює/оновлює детектор
    (`setConfig({ threshold, stabilityMs: mins*60000, oncePerOutage })`),
    видаляє детектори видалених сцен;
  - `_analyzeCondDeps` case `over_consumption`: позначити залежність від
    inverter (щоб сцена не оцінювалась без свіжих даних);
  - контекст: `checkScenes` додає `ctx.sceneName` (і `runSceneNow` для
    if-дій) — `evaluateCondition` за ним знаходить детектор сцени.
- `checkScenes` (перед оцінкою умов):
  - якщо `gridIsDown` (fresh) → для кожного детектора
    `onSample(ctx.otherLoad, now)`; інакше — `onGridUp(now)` для всіх;
  - `takeEvent` → події в `_overConsumeEvents` (споживаються умовою в once-режимі).
- `evaluateCondition` case `over_consumption`:
  - once-режим: `_overConsumeEvents` має подію для `ctx.sceneName` → спожити і
    `true`, інакше `false`;
  - persistent-режим: `detector.isExceeded(now)` (без споживання).
- Публічний фід для тестів: `feedOtherLoad(watts, now?)` → `onSample` усіх
  детекторів; `setGridState(down: bool, now?)` → `onGridUp` при поверненні.
- `_lastOverConsume` — об'єкт `{ watts, soc, outageMin, ts }`, оновлюється при
  спрацюванні (для шаблонів повідомлення).

### 3. `lib/app-state.js` — шаблони `expandNotifyTemplate`

Додати підстановку з `_lastOverConsume`:
- `{{unreg_w}}` — поточна незареєстрована потужність (W, round);
- `{{soc}}` — SOC батареї (%);
- `{{outage_min}}` — тривалість вимкнення на момент спрацювання (хв).
Без даних — «—» (як існуючі шаблони). Сумісно з сценою «Grid Restored Report».

### 4. UI `public/index.html`

- `COND_TYPES` (обидва місця): `{ type:'over_consumption', label:'Over-Consumption (Grid Off)', group:'Grid', icon:'lightning-charge' }`.
- `condFieldsHTML` case: `input` поріг (W), `input` стабільність (хв),
  тогл/селект «once per outage / persistent», коротка підказка.
- `readCondFields` — зчитування полів; `condSummary`/`condText` — короткий опис.
- `DEFAULT_COND` entry: `{ type:'over_consumption', threshold:60, stabilityMins:5, oncePerOutage:true }`.
- Пресет повідомлення: юзер пише notify-текст з `{{unreg_w}}` тощо як зазвичай;
  спеціального пресет-кнопки не додаємо (зберігаємо мінімалізм).

## Тести

- `tests/over-consumption.test.js` (новий, чиста логіка):
  - стабільне перевищення тривалістю ≥ stability → спрацювання;
  - падіння нижче порогу перериває відлік, потім новий цикл починає наново;
  - поріг строго `>` (рівно threshold — не перевищення);
  - once-режим: одна подія до `onGridUp`, потім можна знову;
  - persistent-режим: `isExceeded` true, поки триває; падіння → false;
  - `onGridUp` скидає всі стани.
- `tests/scene-engine.test.js`: сценарний тест `feedOtherLoad` + `runCheck`
  (патерн `appliance_done`: фід минулого часу, потім перевірка);
  перевірка, що notify-повідомлення з `{{unreg_w}}` підставляє значення.
- Повний `npm test` зелений.

## Поза межами (YAGNI)

- Перенос розрахунку `otherLoad` з `index.js` у спільний модуль — не робимо
  (формула дублюється явно, змін не вимагає).
- Налаштування порогів у конфігу (не в сцені) — ні, конфіг лише у сцені.
- Інтеграція з графіком/історією — ні.
- Push-сповіщення незалежно від сцен — ні, лише через сцени.

## Деплой

`git push origin master:main` → на Pi:
`cd /opt/energy-controller && git fetch strum main && git reset --hard strum/main &&
sudo systemctl restart energy-controller` → перевірка сервісу.
