# Over-Consumption While Off-Grid Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати умову сцени `over_consumption` — сповіщення, коли мережа вимкнена і незареєстроване споживання (loadPower − Σ розеток) стабільно перевищує поріг.

**Architecture:** Чистий детектор `lib/over-consumption.js` (як `appliance-detect.js`), per-scene екземпляри синхронізуються зі сцен у `_rebuildSceneDeps`; `checkScenes` (30с) фідить семпли, `evaluateCondition` читає стан через `ctx.sceneName`; шаблони повідомлень через `_lastOverConsume` + `expandNotifyTemplate`.

**Tech Stack:** Node.js 22 ES modules, нуль npm-залежностей, `node --test`.

## Global Constraints

- Без npm-залежностей; тільки ES modules, `import`/`export`.
- Робоча мова UI — англійська (як існуючі умови), код без коментарів.
- Команди: `node --check lib/*.js`, тести `npm test` (`node --test tests/*.test.js`).
- Стиль: йдемо за існуючими патернами `appliance_done` (див. `lib/app-state.js`, `public/index.html`).
- Після кожної задачі — commit. Спека: `docs/superpowers/specs/2026-08-05-over-consumption-design.md`.

---

### Task 1: Детектор `lib/over-consumption.js` + unit-тести

**Files:**
- Create: `lib/over-consumption.js`
- Test: `tests/over-consumption.test.js`

**Interfaces:**
- Produces: `createOverConsumeDetector(cfg = {})` → `{ onSample(watts, now?), takeEvent(now?), isExceeded(now?), onGridUp(now?), setConfig(cfg) }`
  - `cfg`: `{ threshold?: number (60), stabilityMs?: number (300000), oncePerOutage?: boolean (true) }`
  - Стан: `phase: 'idle' | 'stable'`, `startTs` (перший семпл > threshold), `fired` (once-режим).

- [ ] **Step 1: Write the failing unit tests**

`tests/over-consumption.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOverConsumeDetector } from '../lib/over-consumption.js';

const H = 3600000;

test('fires once after stabilityMins of continuous exceedance (once mode)', () => {
  const d = createOverConsumeDetector({ threshold: 60, stabilityMs: 5 * 60000, oncePerOutage: true });
  const t0 = 1000 * H;
  d.onSample(0, t0);
  d.onSample(80, t0 + 60000);      // startTs = t0+60000 (first sample above threshold)
  assert.equal(d.takeEvent(t0 + 4 * 60000), null, '3 min elapsed < 5 min');
  d.onSample(90, t0 + 6 * 60000);  // still exceeding; elapsed = 5 min
  assert.ok(d.takeEvent(t0 + 6 * 60000), 'elapsed 5 min ≥ stability → fires');
  assert.equal(d.takeEvent(t0 + 7 * 60000), null, 'once mode: no second event');
});

test('equal to threshold is NOT an exceedance (strict >)', () => {
  const d = createOverConsumeDetector({ threshold: 60, stabilityMs: 5 * 60000, oncePerOutage: true });
  const t0 = 1000 * H;
  d.onSample(60, t0);
  d.onSample(60, t0 + 60000);
  assert.equal(d.takeEvent(t0 + 6 * 60000), null, '60 is not > 60, never starts');
  d.onSample(61, t0 + 2 * 60000);  // startTs = t0+2*60000
  d.onSample(61, t0 + 3 * 60000);
  d.onSample(61, t0 + 7 * 60000);  // elapsed 5 min
  assert.ok(d.takeEvent(t0 + 7 * 60000), '61 > 60 exceeded for 5 min → fires');
});

test('a sample below threshold resets the stability window', () => {
  const d = createOverConsumeDetector({ threshold: 60, stabilityMs: 5 * 60000, oncePerOutage: true });
  const t0 = 1000 * H;
  d.onSample(80, t0);
  d.onSample(90, t0 + 60000);
  d.onSample(10, t0 + 2 * 60000);   // drop -> reset
  d.onSample(80, t0 + 3 * 60000);   // new start
  assert.equal(d.takeEvent(t0 + 4 * 60000), null, 'only 1 min of new run');
  d.onSample(80, t0 + 8 * 60000);
  assert.ok(d.takeEvent(t0 + 8 * 60000), '5 min of second run fires');
});

test('once mode: one event per outage, re-arms after onGridUp', () => {
  const d = createOverConsumeDetector({ threshold: 60, stabilityMs: 5 * 60000, oncePerOutage: true });
  const t0 = 1000 * H;
  for (let i = 0; i < 6; i++) d.onSample(100, t0 + i * 60000);
  assert.ok(d.takeEvent(t0 + 6 * 60000));
  assert.equal(d.takeEvent(t0 + 7 * 60000), null, 'no second event');
  for (let i = 0; i < 6; i++) d.onSample(100, t0 + 8 * 60000 + i * 60000);
  assert.equal(d.takeEvent(t0 + 14 * 60000), null, 'fired flag blocks until grid up');
  d.onGridUp(t0 + 15 * 60000);
  for (let i = 0; i < 6; i++) d.onSample(100, t0 + 16 * 60000 + i * 60000);
  assert.ok(d.takeEvent(t0 + 22 * 60000), 're-armed after grid returns');
});

test('persistent mode: isExceeded stays true while exceedance lasts, takeEvent always null', () => {
  const d = createOverConsumeDetector({ threshold: 60, stabilityMs: 5 * 60000, oncePerOutage: false });
  const t0 = 1000 * H;
  for (let i = 0; i < 6; i++) d.onSample(100, t0 + i * 60000);
  assert.equal(d.isExceeded(t0 + 3 * 60000), false);
  assert.equal(d.isExceeded(t0 + 5 * 60000), true);
  assert.equal(d.takeEvent(t0 + 6 * 60000), null, 'persistent has no events');
  d.onSample(0, t0 + 6 * 60000);    // drop
  assert.equal(d.isExceeded(t0 + 7 * 60000), false, 'drop clears persistent');
});

test('onGridUp resets everything', () => {
  const d = createOverConsumeDetector({ threshold: 60, stabilityMs: 5 * 60000, oncePerOutage: true });
  const t0 = 1000 * H;
  for (let i = 0; i < 6; i++) d.onSample(100, t0 + i * 60000);
  assert.ok(d.takeEvent(t0 + 6 * 60000));
  d.onGridUp(t0 + 10 * 60000);
  assert.equal(d.isExceeded(t0 + 10 * 60000), false);
  for (let i = 0; i < 6; i++) d.onSample(100, t0 + 11 * 60000 + i * 60000);
  assert.ok(d.takeEvent(t0 + 17 * 60000), 'can fire again after grid up');
});

test('setConfig changes threshold and stability', () => {
  const d = createOverConsumeDetector({ threshold: 60, stabilityMs: 5 * 60000, oncePerOutage: true });
  d.setConfig({ threshold: 200, stabilityMs: 2 * 60000 });
  const t0 = 1000 * H;
  d.onSample(150, t0);
  d.onSample(150, t0 + 60000);
  assert.equal(d.takeEvent(t0 + 2 * 60000), null, '150 below new threshold 200');
  d.onSample(250, t0 + 2 * 60000);
  d.onSample(250, t0 + 3 * 60000);
  assert.ok(d.takeEvent(t0 + 4 * 60000), 'new 2min stability applies');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/over-consumption.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND .../lib/over-consumption.js`

- [ ] **Step 3: Write minimal implementation**

`lib/over-consumption.js`:

```js
export function createOverConsumeDetector(cfg = {}) {
  let config = {
    threshold: cfg.threshold ?? 60,
    stabilityMs: cfg.stabilityMs ?? 5 * 60000,
    oncePerOutage: cfg.oncePerOutage ?? true,
  };
  let phase = 'idle';
  let startTs = 0;
  let fired = false;

  function setConfig(c) {
    config = { ...config, ...c };
  }

  function onSample(watts, now = Date.now()) {
    if (config.oncePerOutage && fired) return;
    if (watts > config.threshold) {
      if (phase !== 'stable') {
        phase = 'stable';
        startTs = now;
      }
    } else {
      phase = 'idle';
      startTs = 0;
    }
  }

  function takeEvent(now = Date.now()) {
    if (!config.oncePerOutage) return null;
    if (fired || phase !== 'stable' || now - startTs < config.stabilityMs) return null;
    fired = true;
    return { ts: now, startedAt: startTs };
  }

  function isExceeded(now = Date.now()) {
    if (config.oncePerOutage) return false;
    return phase === 'stable' && now - startTs >= config.stabilityMs;
  }

  function onGridUp() {
    phase = 'idle';
    startTs = 0;
    fired = false;
  }

  return { onSample, takeEvent, isExceeded, onGridUp, setConfig };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/over-consumption.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/over-consumption.js tests/over-consumption.test.js
git commit -m "feat: over-consumption detector (off-grid unregistered load)"
```

---

### Task 2: Інтеграція в `lib/app-state.js` + сценарні тести

**Files:**
- Modify: `lib/app-state.js`
- Test: `tests/scene-engine.test.js` (append)

**Interfaces:**
- Consumes: `createOverConsumeDetector` (Task 1).
- Produces: `ctx.otherLoad` (number), `ctx.sceneName` (string), exports `feedOtherLoad(watts, now?)`, `resetOverConsume(now?)`; `_lastOverConsume = { watts, soc, outageMin, ts } | null`.

- [ ] **Step 1: Write failing scene-engine tests** (append to `tests/scene-engine.test.js`)

```js
test('over_consumption: once mode fires once per outage, template values filled', async () => {
  env.setInverter({ gridPower: false, loadPower: 200 });
  const scene = {
    name: 'over',
    if: { type: 'over_consumption', threshold: 60, stabilityMins: 5, oncePerOutage: true },
    then: { actions: [{ type: 'notify', message: 'Unreg {{unreg_w}}W soc {{soc}}% {{outage_min}}min' }] },
  };
  await env.addScene(scene);

  let t = Date.now() - 8 * 60000;
  for (let i = 0; i < 8; i++) { env.app.feedOtherLoad(200, t); t += 60000; }

  await env.runCheck();
  assert.equal(env.notifs.length, 1, 'fires after 5min stability');
  assert.match(env.notifs[0].message, /^Unreg 200W soc 50% \d+min$/);

  await env.runCheck();
  assert.equal(env.notifs.length, 1, 'once mode does not re-fire');

  env.setInverter({ gridPower: true });
  await env.runCheck();
  env.setInverter({ gridPower: false, loadPower: 200 });
  t = Date.now() - 8 * 60000;
  for (let i = 0; i < 8; i++) { env.app.feedOtherLoad(200, t); t += 60000; }
  await env.runCheck();
  assert.equal(env.notifs.length, 2, 're-arms after grid returns and re-outage');
});

test('over_consumption: persistent mode stays true while exceedance lasts', async () => {
  env.setInverter({ gridPower: false, loadPower: 200 });
  const scene = {
    name: 'overp',
    if: { type: 'over_consumption', threshold: 60, stabilityMins: 5, oncePerOutage: false },
    then: { actions: [{ type: 'notify', message: 'P' }] },
  };
  await env.addScene(scene);

  let t = Date.now() - 8 * 60000;
  for (let i = 0; i < 8; i++) { env.app.feedOtherLoad(200, t); t += 60000; }

  await env.runCheck();
  assert.equal(env.notifs.length, 1, 'fires after stability');
  await env.runCheck();
  assert.equal(env.notifs.length, 2, 'persistent stays true, notify fires again');

  env.setInverter({ loadPower: 30 });
  await env.runCheck();
  assert.equal(env.notifs.length, 2, 'drop below threshold clears condition');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scene-engine.test.js`
Expected: FAIL — `ctx.otherLoad` undefined / `feedOtherLoad is not a function`

- [ ] **Step 3: Implement integration in `lib/app-state.js`**

3a. Import (після `appliance-detect.js`):

```js
import { createOverConsumeDetector } from './over-consumption.js';
```

3b. Стан (поруч із `let _lastOutageReport = null;` на ~l.975):

```js
const _overConsume = new Map();
let _overConsumeEvents = {};
let _overGridDownSince = 0;
let _lastOverConsume = null;
```

3c. Синк конфігів — додати функцію перед `_rebuildSceneDeps` і виклик в її кінці:

```js
function _syncOverConsumeConfigs() {
  const seen = new Set();
  for (const scene of scenes) {
    let found = null;
    const walk = (node) => {
      if (found || !node || typeof node !== 'object') return;
      if (Array.isArray(node.and)) { for (const c of node.and) walk(c); return; }
      if (Array.isArray(node.or)) { for (const c of node.or) walk(c); return; }
      if (node.not) { walk(node.not); return; }
      if (node.type === 'over_consumption') found = node;
    };
    walk(normalizeConditions(scene.if));
    if (!found) continue;
    seen.add(scene.name);
    let det = _overConsume.get(scene.name);
    if (!det) {
      det = createOverConsumeDetector();
      _overConsume.set(scene.name, det);
    }
    det.setConfig({
      threshold: typeof found.threshold === 'number' ? found.threshold : 60,
      stabilityMs: Math.round((typeof found.stabilityMins === 'number' ? found.stabilityMins : 5) * 60000),
      oncePerOutage: found.oncePerOutage !== false,
    });
  }
  for (const name of [..._overConsume.keys()]) {
    if (!seen.has(name)) _overConsume.delete(name);
  }
}
```

У `_rebuildSceneDeps()` — останнім рядком додати `_syncOverConsumeConfigs();`

3d. `_analyzeCondDeps` — додати case (після `appliance_done`):

```js
case 'over_consumption': deps.inverter = true; break;
```

3e. Семплінг у `checkScenes` — одразу після блоку `_cycleDetector...takeEvents()` (після `for (const k of Object.keys(_applianceEvents)) ...`), перед `const inverterFresh = ...`:

```js
const socketSum = tuyaDevices.reduce((a, d) => a + (d.power || 0), 0);
      const otherLoad = Math.max(0, Math.round((inverterData.loadPower - socketSum) * 10) / 10);
      if (gridIsDown) {
        if (!_overGridDownSince) _overGridDownSince = now;
        for (const det of _overConsume.values()) det.onSample(otherLoad, now);
      } else {
        _overGridDownSince = 0;
        _overConsumeEvents = {};
        for (const det of _overConsume.values()) det.onGridUp(now);
      }
      for (const [name, det] of _overConsume) {
        const ev = det.takeEvent(now);
        if (ev) {
          _overConsumeEvents[name] = ev;
          _lastOverConsume = { watts: otherLoad, soc: inverterData.batterySOC, outageMin: Math.round((now - _overGridDownSince) / 60000), ts: now };
        }
      }
```

**Увага:** цей блок використовує `gridIsDown`, який оголошується **пізніше** (наступним рядком). Тому порядок: спочатку `inverterFresh` + `gridIsDown` (перенести їх декларацію вище, перед блоком семплінгу), потім `otherLoad`-блок. В результаті ділянка виглядає так:

```js
const inverterFresh = !!inverterData.lastUpdate && !inverterData._isDemo && (Date.now() - inverterData.lastUpdate.getTime()) <= 30000;
      const gridIsDown = inverterFresh && inverterData.gridPower === false;
      const socketSum = tuyaDevices.reduce((a, d) => a + (d.power || 0), 0);
      const otherLoad = Math.max(0, Math.round((inverterData.loadPower - socketSum) * 10) / 10);
      if (gridIsDown) { ... } else { ... }
      for (const [name, det] of _overConsume) { ... }
```

(старі рядки `const inverterFresh = ...` / `const gridIsDown = ...` нижче — видалити, замінивши на `const ctx = { ..., otherLoad, now };`).

3f. `ctx` — додати `otherLoad`:

```js
const ctx = { inverterData, tuyaDevices, healthCache: _healthCache, gridIsDown, lastGridWasDown: _lastGridWasDown, inverterConsecutiveFails: _inverterConsecutiveFails, otherLoad, now };
```

3g. Оцінка умов у циклі `for (const scene of scenes)` — додати `sceneName`:

```js
const conditionsMet = condRoot ? evaluateCondition(condRoot, { ...ctx, sceneName: scene.name }) : false;
```

і в `_executeSceneAction(scene, action, conditionsMet, { ...ctx, isOneshot, sceneName: scene.name }, false, runId);`

3h. `evaluateCondition` — додати case (після `appliance_done`):

```js
case 'over_consumption': {
        const det = ctx.sceneName ? _overConsume.get(ctx.sceneName) : null;
        if (!det) return false;
        if (cond.oncePerOutage !== false) {
          const ev = _overConsumeEvents[ctx.sceneName];
          if (ev) { delete _overConsumeEvents[ctx.sceneName]; return true; }
          return false;
        }
        return det.isExceeded(ctx.now);
      }
```

3i. `runSceneNow` — ctx додати `sceneName: scene.name` (щоб if-дії знаходили детектор):

```js
const ctx = { inverterData, tuyaDevices, healthCache: _healthCache, gridIsDown, lastGridWasDown: _lastGridWasDown, inverterConsecutiveFails: _inverterConsecutiveFails, now: Date.now(), manual: true, results, sceneName: scene.name };
```

3j. Експорти в `return { ... }` (поруч із `feedDevicePower`):

```js
feedOtherLoad: (watts, now) => { for (const det of _overConsume.values()) det.onSample(watts, now); },
    resetOverConsume: (now) => { for (const det of _overConsume.values()) det.onGridUp(now); _overConsumeEvents = {}; _overGridDownSince = 0; },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --check lib/app-state.js && node --test tests/scene-engine.test.js tests/over-consumption.test.js`
Expected: PASS (всі scene-engine + 6 нових)

- [ ] **Step 5: Commit**

```bash
git add lib/app-state.js tests/scene-engine.test.js
git commit -m "feat: over_consumption scene condition wired into app-state engine"
```

---

### Task 3: Шаблони `{{unreg_w}}` / `{{soc}}` / `{{outage_min}}`

**Files:**
- Modify: `lib/app-state.js` (`expandNotifyTemplate` ~l.984)

**Interfaces:**
- Consumes: `_lastOverConsume` (Task 2).
- Produces: розширений `expandNotifyTemplate(message)`.

- [ ] **Step 1: Write failing test** (append to `tests/scene-engine.test.js`)

```js
test('notify template: over-consumption placeholders expand from last event', async () => {
  env.setInverter({ gridPower: false, loadPower: 200 });
  const scene = {
    name: 'overT',
    if: { type: 'over_consumption', threshold: 60, stabilityMins: 5, oncePerOutage: true },
    then: { actions: [{ type: 'notify', message: 'U={{unreg_w}} S={{soc}} O={{outage_min}}' }] },
  };
  await env.addScene(scene);
  let t = Date.now() - 8 * 60000;
  for (let i = 0; i < 8; i++) { env.app.feedOtherLoad(200, t); t += 60000; }
  await env.runCheck();
  assert.equal(env.notifs.length, 1);
  assert.match(env.notifs[0].message, /^U=200 S=50% O=\d+$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scene-engine.test.js`
Expected: FAIL — message містить невідомі `{{...}}` → «—» (спад `notifs[0].message` не збігається).

- [ ] **Step 3: Implement**

Замінити `expandNotifyTemplate` у `lib/app-state.js` на:

```js
function expandNotifyTemplate(message) {
    if (!message) return message;
    let out = message;
    if (_lastOutageReport) {
      out = out
        .replace(/{{duration}}/g, _lastOutageReport.durationMin + ' min')
        .replace(/{{duration_h}}/g, String(_lastOutageReport.durationH))
        .replace(/{{duration_m}}/g, String(_lastOutageReport.durationM))
        .replace(/{{soc_start}}/g, _lastOutageReport.socStart + '%')
        .replace(/{{soc_end}}/g, _lastOutageReport.socEnd + '%')
        .replace(/{{soc_used}}/g, _lastOutageReport.socUsed + '%')
        .replace(/{{energy}}/g, _lastOutageReport.energyKwh + ' kWh')
        .replace(/{{start_time}}/g, _lastOutageReport.startTime)
        .replace(/{{end_time}}/g, _lastOutageReport.endTime);
    }
    if (_lastOverConsume) {
      out = out
        .replace(/{{unreg_w}}/g, String(Math.round(_lastOverConsume.watts)))
        .replace(/{{soc}}/g, Math.round(_lastOverConsume.soc) + '%')
        .replace(/{{outage_min}}/g, String(_lastOverConsume.outageMin));
    }
    return out.replace(/\{\{[^}]+\}\}/g, '—');
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scene-engine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/app-state.js tests/scene-engine.test.js
git commit -m "feat: notify templates {{unreg_w}}/{{soc}}/{{outage_min}} for over-consumption"
```

---

### Task 4: UI `public/index.html`

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: поля умови `{ threshold, stabilityMins, oncePerOutage }`.
- Produces: нова умова в COND_TYPES + fields + summary.

- [ ] **Step 1: COND_TYPES — два місця**

У першому списку груп (група `Grid`, ~l.602, поряд із `grid_restored`):

```js
{type:'over_consumption',label:'Over-Consumption (Grid Off)'}
```

У `COND_TYPES` (~l.773, поряд із `grid_restored`):

```js
{ type:'over_consumption', label:'Over-Consumption (Grid Off)', group:'Grid', icon:'lightning-charge' },
```

- [ ] **Step 2: `condFieldsHTML`** — додати case (після `grid_restored`):

```js
case 'over_consumption':
      return 'Unreg &gt; <input class="cf-threshold" data-ci="'+idx+'" type="number" min="0" step="1" value="'+(cond.threshold||60)+'" onchange="eCField('+idx+')" style="max-width:70px">W × <input class="cf-stab" data-ci="'+idx+'" type="number" min="1" step="1" value="'+(cond.stabilityMins||5)+'" onchange="eCField('+idx+')" style="max-width:60px">min <select class="cf-once" data-ci="'+idx+'" onchange="eCField('+idx+')" style="max-width:150px"><option value="true"'+(cond.oncePerOutage!==false?' selected':'')+'>once per outage</option><option value="false"'+(cond.oncePerOutage===false?' selected':'')+'>persistent</option></select>';
```

- [ ] **Step 3: `readCondFields`** — додати після блоку `if (c.type === 'appliance_done') {...}`:

```js
if (c.type === 'over_consumption') {
    const thEl = document.querySelector('.cf-threshold[data-ci="'+idx+'"]');
    const stEl = document.querySelector('.cf-stab[data-ci="'+idx+'"]');
    const onEl = document.querySelector('.cf-once[data-ci="'+idx+'"]');
    if (thEl) c.threshold = Math.max(0, parseFloat(thEl.value) || 0);
    if (stEl) c.stabilityMins = Math.max(1, parseInt(stEl.value) || 1);
    if (onEl) c.oncePerOutage = onEl.value === 'true';
  }
```

- [ ] **Step 4: `condSummary`** — після `appliance_done` блоку:

```js
if (c.type === 'over_consumption') {
    return 'unreg > ' + (c.threshold || 60) + 'W × ' + (c.stabilityMins || 5) + 'min (' + (c.oncePerOutage === false ? 'persistent' : 'once') + ')';
  }
```

- [ ] **Step 5: `condText`** (один рядок, поряд із `appliance_done`):

```js
if(c.type==='over_consumption')return 'unreg &gt; <b>'+(c.threshold||60)+'W</b> × '+(c.stabilityMins||5)+'min';
```

- [ ] **Step 6: `DEFAULT_COND`** (поряд із `appliance_done`):

```js
over_consumption: { type:'over_consumption', threshold:60, stabilityMins:5, oncePerOutage:true },
```

- [ ] **Step 7: Verify syntax and commit**

Run: `node -e "const src=require('fs').readFileSync('public/index.html','utf8');const m=src.match(/<script>([\s\S]*?)<\/script>/g)||[];for(const s of m){new Function(s.replace(/^<script>/,'').replace(/<\/script>$/,''));}console.log('UI JS OK');"`
Expected: `UI JS OK`

```bash
git add public/index.html
git commit -m "feat: over-consumption (grid off) condition in automations UI"
```

---

### Task 5: AGENTS.md, повний прогон, деплой

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Документація**

Додати розділ після «Appliance Cycle Detect»:

```markdown
## Over-Consumption Detect (умова сцени `over_consumption`)
- Сповіщення про незареєстроване споживання при вимкненій мережі: `otherLoad =
  max(0, loadPower − Σ power(Tuya-розетки))` (та сама формула, що в `index.js` для графіка
  Unregistered; в app-state дублюється в `checkScenes`, `ctx.otherLoad`).
- `lib/over-consumption.js` — чистий детектор: `createOverConsumeDetector({threshold,
  stabilityMs, oncePerOutage})` → `onSample(watts, now?)`, `takeEvent(now?)`,
  `isExceeded(now?)`, `onGridUp(now?)`, `setConfig(cfg)`. Поріг строго `>`, семпл нижче
  порогу перериває відлік.
- Інтеграція: per-scene детектори в `_overConsume` (Map sceneName→detector),
  синхронізуються в `_syncOverConsumeConfigs` (з `_rebuildSceneDeps`); `checkScenes`
  фідить семпли тільки при `gridIsDown` (+fresh), інакше `onGridUp`; once-режим —
  подія в `_overConsumeEvents`, persistent — `isExceeded`; `evaluateCondition` шукає
  детектор через `ctx.sceneName` (додається в `checkScenes` і `runSceneNow`).
- Шаблони повідомлень: `{{unreg_w}}`, `{{soc}}`, `{{outage_min}}` (з `_lastOverConsume`).
- Публічні фіди для тестів: `feedOtherLoad(watts, now?)`, `resetOverConsume(now?)`.
- Тести: `tests/over-consumption.test.js` (чиста логіка) + сценарні в
  `tests/scene-engine.test.js` (once/persistent + шаблони).
```

- [ ] **Step 2: Повний прогон**

Run: `npm test`
Expected: `tests` ≥ 109 (102 + 6 детектор + 3 сценарних), `pass` = `tests`, `fail` 0.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: over-consumption detect section in AGENTS.md"
```

- [ ] **Step 4: Push + деплой на Pi**

```bash
git push origin master:main
ssh hb-service@raspberrypi.local "cd /opt/energy-controller && git fetch strum main && git reset --hard strum/main && sudo systemctl restart energy-controller"
```

- [ ] **Step 5: Перевірка**

```bash
ssh hb-service@raspberrypi.local "systemctl is-active energy-controller; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8583/api/scenes"
```
Expected: `active`, HTTP 302 (редирект на login — сервіс живий і слухає).
