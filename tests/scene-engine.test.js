import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppState } from '../lib/app-state.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let env;

beforeEach(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strum-scene-'));
  const config = {
    inverter: { ip: '127.0.0.1', serial: 0, port: 1, autoResolve: false },
    tuya: { controlMode: 'local' },
  };
  const notifs = [];
  const pushNotification = (title, message, type) => notifs.push({ title, message, type });
  const app = createAppState(dataDir, async () => config, async () => {}, (s) => s, pushNotification, async () => ['ok']);

  const setInverter = (patch) => {
    Object.assign(app.inverterData, {
      lastUpdate: new Date(),
      _isDemo: false,
      gridPower: true,
      batterySOC: 50,
      loadPower: 1000,
      batteryPower: 0,
    }, patch);
  };
  const addScene = async (scene) => { app.scenes.push(scene); await app.saveScenes(); };
  const runCheck = async () => {
    await app.checkScenes();
    await sleep(120);
    app.saveSceneTimers();
  };
  const evalCond = async (cond) => {
    const scene = {
      name: 'cond',
      then: { actions: [{ type: 'if', condition: cond, then: [{ type: 'notify', message: 'M' }], else: [] }] },
    };
    const results = await app.runSceneNow(scene);
    return results.some((r) => r.action === 'notify');
  };
  const readTimers = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'scene-timers.json'), 'utf8'));
  const writeTimers = (timers) => {
    fs.writeFileSync(path.join(dataDir, 'scene-timers.json'), JSON.stringify(timers));
    app.loadSceneTimers();
  };

  env = { app, dataDir, config, notifs, setInverter, addScene, runCheck, evalCond, readTimers, writeTimers };
});

afterEach(() => {
  fs.rmSync(env.dataDir, { recursive: true, force: true });
});

// ============================================================
// CONDITION TYPES
// ============================================================

test('battery: <, > and = are strict against the threshold', async () => {
  env.setInverter({ batterySOC: 30 });
  assert.equal(await env.evalCond({ type: 'battery', operator: '<', value: 40 }), true);
  assert.equal(await env.evalCond({ type: 'battery', operator: '<', value: 30 }), false);
  assert.equal(await env.evalCond({ type: 'battery', operator: '>', value: 20 }), true);
  assert.equal(await env.evalCond({ type: 'battery', operator: '>', value: 30 }), false);
  assert.equal(await env.evalCond({ type: 'battery', operator: '=', value: 30 }), true);
  assert.equal(await env.evalCond({ type: 'battery', operator: '=', value: 31 }), false);
});

test('battery: operator defaults to =', async () => {
  env.setInverter({ batterySOC: 42 });
  assert.equal(await env.evalCond({ type: 'battery', value: 42 }), true);
  assert.equal(await env.evalCond({ type: 'battery', value: 41 }), false);
});

test('grid: matches the current grid power flag', async () => {
  env.setInverter({ gridPower: true });
  assert.equal(await env.evalCond({ type: 'grid', value: true }), true);
  assert.equal(await env.evalCond({ type: 'grid', value: false }), false);
  env.setInverter({ gridPower: false });
  assert.equal(await env.evalCond({ type: 'grid', value: false }), true);
});

test('load: defaults to > and is strict', async () => {
  env.setInverter({ loadPower: 1500 });
  assert.equal(await env.evalCond({ type: 'load', value: 1000 }), true);
  assert.equal(await env.evalCond({ type: 'load', value: 1500 }), false);
  assert.equal(await env.evalCond({ type: 'load', value: 2000 }), false);
  assert.equal(await env.evalCond({ type: 'load', operator: '<', value: 2000 }), true);
  assert.equal(await env.evalCond({ type: 'load', operator: '<', value: 1500 }), false);
});

test('inverter: online requires a fresh lastUpdate, offline is the inverse', async () => {
  env.setInverter({ gridPower: true });
  assert.equal(await env.evalCond({ type: 'inverter', value: 'online' }), true);
  assert.equal(await env.evalCond({ type: 'inverter', value: 'offline' }), false);
  env.app.inverterData.lastUpdate = new Date(Date.now() - 120000);
  assert.equal(await env.evalCond({ type: 'inverter', value: 'online' }), false);
  assert.equal(await env.evalCond({ type: 'inverter', value: 'offline' }), true);
});

test('time: window is inclusive on both ends', async () => {
  const cur = new Date();
  const curMin = cur.getHours() * 60 + cur.getMinutes();
  const today = String(cur.getHours()).padStart(2, '0') + ':' + String(cur.getMinutes()).padStart(2, '0');
  assert.equal(await env.evalCond({ type: 'time', after: '00:00', before: '23:59' }), true);
  assert.equal(await env.evalCond({ type: 'time', after: today, before: today }), true);
  assert.equal(await env.evalCond({ type: 'time', after: '23:59', before: '00:00' }), false);
  assert.equal(await env.evalCond({ type: 'time', before: '00:00' }), false);
  assert.ok(curMin >= 0);
});

test('weekday: matches explicit days and the weekday/weekend buckets', async () => {
  const today = new Date().getDay();
  const tomorrow = (today + 1) % 7;
  assert.equal(await env.evalCond({ type: 'weekday', days: [today] }), true);
  assert.equal(await env.evalCond({ type: 'weekday', days: [tomorrow] }), false);
  assert.equal(await env.evalCond({ type: 'weekday', value: 'weekday' }), ![0, 6].includes(today));
  assert.equal(await env.evalCond({ type: 'weekday', value: 'weekend' }), [0, 6].includes(today));
});

test('device_online: matches expectedStatus and is false for unknown devices', async () => {
  env.app.tuyaDevices.push({ id: 'd1', name: 'D1', online: true });
  assert.equal(await env.evalCond({ type: 'device_online', value: 'd1', expectedStatus: true }), true);
  assert.equal(await env.evalCond({ type: 'device_online', value: 'd1', expectedStatus: false }), false);
  assert.equal(await env.evalCond({ type: 'device_online', value: 'ghost', expectedStatus: true }), false);
});

test('disk_free: < threshold, defaults and <= semantics', async () => {
  assert.equal(await env.evalCond({ type: 'disk_free', operator: '<', value: 101 }), true);
  assert.equal(await env.evalCond({ type: 'disk_free', operator: '<', value: 100 }), false);
  assert.equal(await env.evalCond({ type: 'disk_free', operator: '>', value: -1 }), true);
  assert.equal(await env.evalCond({ type: 'disk_free', operator: '=', value: 100 }), true);
  assert.equal(await env.evalCond({ type: 'disk_free', operator: '=', value: 99 }), false);
});

test('cpu_temp: > threshold is strict, = means >=', async () => {
  assert.equal(await env.evalCond({ type: 'cpu_temp', operator: '>', value: -1 }), true);
  assert.equal(await env.evalCond({ type: 'cpu_temp', operator: '>', value: 0 }), false);
  assert.equal(await env.evalCond({ type: 'cpu_temp', operator: '<', value: 1 }), true);
  assert.equal(await env.evalCond({ type: 'cpu_temp', operator: '=', value: 0 }), true);
  assert.equal(await env.evalCond({ type: 'cpu_temp', operator: '=', value: 1 }), false);
});

test('cpu_load: > threshold is strict, = means >=', async () => {
  assert.equal(await env.evalCond({ type: 'cpu_load', operator: '>', value: -1 }), true);
  assert.equal(await env.evalCond({ type: 'cpu_load', operator: '<', value: 0 }), false);
  assert.equal(await env.evalCond({ type: 'cpu_load', operator: '=', value: 0 }), true);
});

test('memory_free: < threshold is strict, = means <=', async () => {
  assert.equal(await env.evalCond({ type: 'memory_free', operator: '<', value: 101 }), true);
  assert.equal(await env.evalCond({ type: 'memory_free', operator: '<', value: 100 }), false);
  assert.equal(await env.evalCond({ type: 'memory_free', operator: '=', value: 100 }), true);
  assert.equal(await env.evalCond({ type: 'memory_free', operator: '=', value: 99 }), false);
});

// ============================================================
// COMPOUND CONDITIONS
// ============================================================

test('and: all children must be true', async () => {
  env.setInverter({ batterySOC: 30, loadPower: 1500 });
  const cond = { and: [{ type: 'battery', operator: '<', value: 40 }, { type: 'load', operator: '>', value: 1000 }] };
  assert.equal(await env.evalCond(cond), true);
  const bad = { and: [{ type: 'battery', operator: '<', value: 40 }, { type: 'load', operator: '>', value: 2000 }] };
  assert.equal(await env.evalCond(bad), false);
});

test('or: any child being true is enough', async () => {
  env.setInverter({ batterySOC: 30, loadPower: 1500 });
  const cond = { or: [{ type: 'battery', operator: '<', value: 40 }, { type: 'load', operator: '>', value: 2000 }] };
  assert.equal(await env.evalCond(cond), true);
  const bad = { or: [{ type: 'battery', operator: '<', value: 20 }, { type: 'load', operator: '>', value: 2000 }] };
  assert.equal(await env.evalCond(bad), false);
});

test('not: inverts the child condition', async () => {
  env.setInverter({ batterySOC: 50 });
  assert.equal(await env.evalCond({ not: { type: 'battery', operator: '<', value: 20 } }), true);
  assert.equal(await env.evalCond({ not: { type: 'battery', operator: '<', value: 60 } }), false);
});

test('nested and/or/not combinations evaluate depth-first', async () => {
  env.setInverter({ batterySOC: 30, loadPower: 1500, gridPower: false });
  const cond = {
    and: [
      { or: [{ type: 'battery', operator: '<', value: 40 }, { type: 'load', operator: '>', value: 5000 }] },
      { not: { type: 'grid', value: true } },
    ],
  };
  assert.equal(await env.evalCond(cond), true);
});

test('a condition with enabled:false always passes', async () => {
  env.setInverter({ batterySOC: 50 });
  assert.equal(await env.evalCond({ type: 'battery', enabled: false, operator: '<', value: 20 }), true);
});

// ============================================================
// ONE-SHOT CONDITIONS (checkScenes path)
// ============================================================

test('grid_restored fires only after a recorded outage ends', async () => {
  env.setInverter({ gridPower: false });
  await env.addScene({ name: 'gr', if: { type: 'grid_restored' }, then: { actions: [{ type: 'notify', message: 'R' }] } });
  await env.runCheck();
  assert.deepEqual(env.notifs.map((n) => n.message), []);

  env.setInverter({ gridPower: true });
  await env.runCheck();
  assert.deepEqual(env.notifs.map((n) => n.message), ['R']);
});

test('inverter_offline: does not fire while consecutive fails are below minFailures', async () => {
  await env.addScene({ name: 'io', if: { type: 'inverter_offline', minFailures: 5 }, then: { actions: [{ type: 'notify', message: 'O' }] } });
  await env.runCheck();
  assert.equal(env.app.getInverterConsecutiveFails(), 0);
  assert.deepEqual(env.notifs.map((n) => n.message), []);
});

test('inverter_offline: fires once consecutive fails reach minFailures', async () => {
  env.setInverter({ batterySOC: 50 });
  for (let i = 0; i < 3; i++) await env.app.pollInverter();
  assert.ok(env.app.getInverterConsecutiveFails() >= 5);
  await env.addScene({ name: 'io', if: { type: 'inverter_offline', minFailures: 5 }, then: { actions: [{ type: 'notify', message: 'O' }] } });
  await env.runCheck();
  assert.ok(env.notifs.some((n) => n.message === 'O'));
});

// ============================================================
// SCENE EVALUATION EDGE CASES
// ============================================================

test('disabled scenes are skipped entirely', async () => {
  env.setInverter({ batterySOC: 50 });
  await env.addScene({ name: 'off', enabled: false, if: { type: 'battery', operator: '>', value: 10 }, then: { actions: [{ type: 'notify', message: 'X' }] } });
  await env.runCheck();
  assert.deepEqual(env.notifs, []);
  assert.equal(env.app.sceneTraces.length, 0);
});

test('a scene without conditions never triggers', async () => {
  await env.addScene({ name: 'nul', then: { actions: [{ type: 'notify', message: 'X' }] } });
  await env.runCheck();
  assert.deepEqual(env.notifs, []);
});

test('multiple scenes with matching conditions all fire', async () => {
  env.setInverter({ batterySOC: 50 });
  for (const m of ['A', 'B', 'C']) {
    await env.addScene({ name: 's' + m, if: { type: 'battery', operator: '>', value: 10 }, then: { actions: [{ type: 'notify', message: m }] } });
  }
  await env.runCheck();
  const fired = env.notifs.map((n) => n.message).sort();
  assert.deepEqual(fired, ['A', 'B', 'C']);
});

test('a scene action referencing a missing device fails gracefully', async () => {
  env.setInverter({ batterySOC: 50 });
  env.app.tuyaDevices.push({ id: 'sock1', name: 'Sock1' });
  await env.addScene({ name: 'ghost', if: { type: 'battery', operator: '>', value: 10 }, then: { actions: [{ type: 'tuya', device: 'ghost', value: true }] } });
  await env.runCheck();
  const trace = env.app.sceneTraces.find((t) => t.scene === 'ghost');
  assert.ok(trace && trace.action === 'apply:error');
  assert.match(trace.detail, /Device not found: ghost/);
  assert.ok(env.notifs.some((n) => n.title === 'Automation "ghost"' && n.type === 'error'));
});

// ============================================================
// ACTION TIMING (cooldown / interval / duration)
// ============================================================

test('notify action respects the interval cooldown after a revert', async () => {
  env.setInverter({ batterySOC: 50 });
  const scene = { name: 'int', if: { type: 'battery', operator: '>', value: 10 }, then: { actions: [{ type: 'notify', message: 'T', interval: 1 }] } };
  await env.addScene(scene);

  await env.runCheck();
  assert.deepEqual(env.notifs.map((n) => n.message), ['T']);

  await env.runCheck();
  assert.deepEqual(env.notifs.map((n) => n.message), ['T']);

  env.setInverter({ batterySOC: 5 });
  await env.runCheck();
  assert.deepEqual(env.notifs.map((n) => n.message), ['T']);
  assert.equal(env.readTimers()['int:notify'].active, false);

  env.setInverter({ batterySOC: 50 });
  await env.runCheck();
  assert.deepEqual(env.notifs.map((n) => n.message), ['T'], 'still inside the 1-minute interval');

  env.writeTimers({ 'int:notify': { active: false, appliedAt: 0, revertedAt: Date.now() - 2 * 60000 } });
  await env.runCheck();
  assert.deepEqual(env.notifs.map((n) => n.message), ['T', 'T'], 'fired again once the interval elapsed');
});

test('duration actions revert when the appliedAt age crosses the duration', async () => {
  env.setInverter({ batterySOC: 50 });
  env.app.tuyaDevices.push({ id: 'sock1', name: 'Sock1' });
  const scene = { name: 'dur', if: { type: 'battery', operator: '>', value: 10 }, then: { actions: [{ type: 'tuya', device: 'sock1', value: true, duration: 1 }] } };
  await env.addScene(scene);

  await env.runCheck();
  assert.ok(env.notifs.some((n) => n.message.startsWith('Failed:')), 'local-only control fails deterministically');

  env.writeTimers({ 'dur:sock1': { active: true, appliedAt: Date.now() - 2 * 60000, revertedAt: 0 } });
  await env.runCheck();
  assert.ok(env.notifs.some((n) => n.message.startsWith('Revert failed:')));
});

test('one-shot scenes do not revert when the condition turns false', async () => {
  env.setInverter({ gridPower: false });
  await env.addScene({ name: 'gs', if: { type: 'grid_restored' }, then: { actions: [{ type: 'notify', message: 'R' }] } });
  await env.runCheck();

  env.setInverter({ gridPower: true });
  await env.runCheck();
  assert.deepEqual(env.notifs.map((n) => n.message), ['R']);
  assert.equal(env.readTimers()['gs:notify'].active, true);

  env.setInverter({ gridPower: false });
  await env.runCheck();
  assert.equal(env.readTimers()['gs:notify'].active, true, 'one-shot scene stays applied');
});

test('appliance_done: notifies once a running cycle settles below threshold', async () => {
  env.setInverter({ loadPower: 0 });
  const scene = { name: 'dryer-done', if: { type: 'appliance_done', device: 'dryer' }, then: { actions: [{ type: 'notify', message: 'Прання готове' }] } };
  await env.addScene(scene);

  let t = Date.now() - 55 * 60000;
  for (let i = 0; i < 45; i++) {
    env.app.feedDevicePower('dryer', 1200, t);
    t += 60000;
  }
  assert.equal(env.notifs.length, 0, 'no notification while the cycle is still running');

  for (let i = 0; i < 8; i++) {
    env.app.feedDevicePower('dryer', 0, t);
    t += 60000;
  }

  await env.runCheck();
  assert.equal(env.notifs.length, 1, 'fires once the idle settle elapses');
  assert.equal(env.notifs[0].message, 'Прання готове');

  await env.runCheck();
  assert.equal(env.notifs.length, 1, 'event is consumed, does not re-fire');
});

test('appliance_done: short burst does not fire (minDuration)', async () => {
  env.setInverter({ loadPower: 0 });
  const scene = { name: 'kettle', if: { type: 'appliance_done', device: 'kettle', startWatts: 100, minDuration: 5, settle: 1 }, then: { actions: [{ type: 'notify', message: 'Чайник закипів' }] } };
  await env.addScene(scene);

  let t = Date.now() - 4 * 60000;
  for (let i = 0; i < 3; i++) {
    env.app.feedDevicePower('kettle', 1800, t);
    t += 60000;
  }
  for (let i = 0; i < 3; i++) {
    env.app.feedDevicePower('kettle', 0, t);
    t += 60000;
  }

  await env.runCheck();
  assert.equal(env.notifs.length, 0, '3-minute burst is below the 5-minute minDuration');

  let s = Date.now() - 12 * 60000;
  for (let i = 0; i < 6; i++) {
    env.app.feedDevicePower('kettle', 1800, s);
    s += 60000;
  }
  for (let i = 0; i < 6; i++) {
    env.app.feedDevicePower('kettle', 0, s);
    s += 60000;
  }
  await env.runCheck();
  assert.equal(env.notifs.length, 1, 'longer cycle on the same device fires');
});
