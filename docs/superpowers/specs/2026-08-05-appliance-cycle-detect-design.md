# Design: Appliance Cycle Finished Automation

Date: 2026-08-05
Status: Approved (user approved baseline design + sensitivity presets)

## Goal

Detect when a washing machine / dishwasher (or, at high sensitivity, a kettle /
small appliance) finishes its cycle from per-device smart-plug power readings,
then fire a scene `notify` action ("Прання готове" / "Посудомистку вимкнено").

Power pattern (validated on real data, dishwasher, 08-05):
`~0 W → 25 W → 1370 W / peak 2265 W (heating) → ~28 W (wash) → 2104 W (final heating/drying) → 0 W (done)`. A 143-minute cycle. Mid-cycle pauses are ~1 minute at 0 W.

## Approach

A clean stateful detector module + a new scene condition type `appliance_done`.

### 1. `lib/appliance-detect.js` — pure, dependency-free

State machine per device: `idle → running → done` (fires once per cycle).

```js
createCycleDetector({ startWatts = 3, minDuration = 15 * 60000, settle = 5 * 60000 })
```

- `onSample(devId, powerW)` — feed a power reading; returns nothing.
- `checkNow(now)` — advance time-based logic (handles a device going silent on 0 W
  with no further pushes); returns nothing.
- `consume(devId)` → `{ minutes, startedAt } | null` — returns the pending "done"
  event for a device and clears it (one-shot, like `grid_restored`).

Transitions:
- `idle`: if `power > startWatts` → `running`, record `startTs`.
- `running`: track `lowSince` (timestamp when power last ≤ `startWatts`, computed
  in `checkNow` from last sample + silence). If `lowSince != null` and
  `now - lowSince >= settle` and `startTs` is set and `now - startTs >= minDuration`
  → `done`: stage event (minutes = round((now - startTs)/60000)).
- `running`: if `startTs` set but `now - startTs < minDuration` while power already
  low → abort (false start: kettle-style short appliance) → back to `idle`, no event.
- `done` event staged once; after `consume` → `idle`.

### 2. `lib/app-state.js` integration

- Feed: in `applyDpsToDevice` (single choke point for push + query + cloud) after
  `dev.power` update → `detector.onSample(dev.id, dev.power)`.
- Tick: in `checkScenes` (30 s) → `detector.checkNow(Date.now())` before evaluating.
- Events: `_applianceEvents = {}` map `deviceId → { minutes, startedAt }`. Set by
  detector's staged events each tick.
- Condition `evaluateCondition` new case:
  ```js
  case 'appliance_done': {
    const ev = _applianceEvents[cond.device];
    if (ev) { delete _applianceEvents[cond.device]; return true; }
    return false;
  }
  ```
- Deps: `_analyzeCondDeps` — `case 'appliance_done': deps.devices[cond.device] = true`
  (so device pushes trigger `requestSceneCheck`, reusing device_online wiring).
- Persistence: detector state is in-memory only. On restart the detector
  re-initializes from current `dev.power` (correct ~). A staged-but-unconsumed
  event is lost on restart (no duplicate notifications — acceptable).

### 3. Scene schema

```json
{
  "type": "appliance_done",
  "device": "<tuya device id>",
  "startWatts": 3,
  "minDuration": 30,
  "settle": 5
}
```
(minutes for `minDuration` and `settle` in scene JSON; converted to ms in detector.)

Full scene example (user-created in UI):
```json
{
  "name": "Dishwasher Done",
  "if": { "and": [{ "type": "appliance_done", "device": "bf36...", "startWatts": 3, "minDuration": 30, "settle": 5 }] },
  "then": { "actions": [{ "type": "notify", "title": "Посудомийка", "message": "Посудомийка завершила миття ✓" }] },
  "enabled": true, "group": ""
}
```

### 4. UI (public/index.html)

- New `COND_TYPES` entry: `{ type:'appliance_done', label:'Device cycle finished', group:'Devices' }`.
- `condFieldsHTML` case `appliance_done`:
  - Device `<select>` (from `S.devices`, stores `id`).
  - Preset `<select>` "Preset": Washing/Dishwasher (default), Kettle / small (high sensitivity), Manual.
    - Washing preset → startWatts 3, minDuration 30, settle 5.
    - Kettle preset → startWatts 100, minDuration 1, settle 1.
    - Manual → free numeric fields (startWatts W, minDuration min, settle min).
  - Warning chip on high-sensitivity presets: "High sensitivity → false triggers from
    short devices on this socket (blender, compressor…)".
- `condSummary` / `condText` add readable rendering.
- No server route changes: scene POST/PATCH validation already accepts any condition
  with a name/condition/action.

### 5. Tests — `tests/appliance-detect.test.js`

Pure module tests (no app-state):
1. Replay real dishwasher 1-min samples → exactly one `done`, duration ≈ 143 min.
2. Dishwasher mid-cycle 1-min silence (12:20 pattern) does NOT trigger before settle.
3. Short kettle burst (2.5 min, 2000 W) with kettle preset → exactly one `done`.
4. Same burst with washing preset (minDuration 15) → no event.
5. Compressor-style quick 3-min bursts → no event (washing preset).
6. Duplicate: `consume` twice → second returns null; no re-fire while still running.
7. Restart resilience: detector created fresh while device at 28 W → starts running,
   later low for settle → one event.
8. Silence handling: feed sample then no more samples; `checkNow` advances past
   settle → event fires.

### 6. Files

- `lib/appliance-detect.js` (new)
- `lib/app-state.js` (detector wiring, condition, deps)
- `public/index.html` (UI)
- `tests/appliance-detect.test.js` (new)
- `AGENTS.md` (documentation note)

## Out of scope

- Persistent detector state across restarts (event loss acceptable, no duplicates).
- Multi-device per scene (one device per scene).
- Notify template variables (`{{device_name}}`, `{{minutes}}`) — static text for now.