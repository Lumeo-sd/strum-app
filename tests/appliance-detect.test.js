import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCycleDetector } from '../lib/appliance-detect.js';

const MIN = 60000;
const t0 = 1785900000000;

// Approximate real dishwasher profile (08-05, Pi data):
// 09:50 1.2W (power-on, below threshold) -> 25W -> 1370W heating -> ~28W wash -> 2104W final -> 0W
function dishwasherSamples(t0) {
  const pts = [
    [0, 1.2], [10, 25.3], [20, 1370], [30, 27], [40, 28.7], [50, 28.8], [60, 28.8],
    [70, 28.8], [80, 28.8], [90, 28.7], [100, 21.6], [110, 232.9], [120, 2104],
    [130, 420.8], [140, 0], [150, 0], [160, 0],
  ];
  return pts.map(([m, w]) => [t0 + m * MIN, w]);
}

function feed(det, samples) {
  for (const [ts, w] of samples) det.onSample('dev', w, ts);
}

test('replays real dishwasher profile -> exactly one done, plausible duration', () => {
  const det = createCycleDetector({ startWatts: 3, minDuration: 15 * MIN, settle: 5 * MIN });
  const samples = dishwasherSamples(t0);
  feed(det, samples);
  assert.equal(det.consume('dev'), null);
  det.checkNow(t0 + 145 * MIN);
  const ev = det.consume('dev');
  assert.ok(ev, 'expected a done event after settle');
  assert.ok(ev.minutes >= 120 && ev.minutes <= 150, 'duration ~135min, got ' + ev.minutes);
  assert.equal(det.consume('dev'), null);
});

test('mid-cycle one-minute silence does not trigger done', () => {
  const det = createCycleDetector({ startWatts: 3, minDuration: 15 * MIN, settle: 5 * MIN });
  feed(det, [
    [0, 25], [1, 28], [2, 28], [3, 0], [4, 28], [5, 28], [6, 28], [7, 28],
  ].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 20 * MIN);
  assert.equal(det.consume('dev'), null);
});

test('kettle preset (high sensitivity): 2.5 min burst -> done', () => {
  const det = createCycleDetector({ startWatts: 100, minDuration: 1 * MIN, settle: 1 * MIN });
  feed(det, [[0, 0], [1, 2000], [2, 0]].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 3 * MIN);
  assert.ok(det.consume('dev'));
});

test('same kettle burst with washing preset -> no event (false start aborted)', () => {
  const det = createCycleDetector({ startWatts: 3, minDuration: 15 * MIN, settle: 5 * MIN });
  feed(det, [[0, 0], [1, 2000], [2, 0]].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 8 * MIN);
  assert.equal(det.consume('dev'), null);
  // detector is back in idle: a new long cycle can start
  feed(det, [[10, 28]].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 40 * MIN);
  assert.equal(det.consume('dev'), null);
});

test('compressor-style short bursts separated by long pauses never fire', () => {
  const det = createCycleDetector({ startWatts: 3, minDuration: 15 * MIN, settle: 5 * MIN });
  const by = new Map([[0, 500], [1, 0], [8, 500], [9, 0], [16, 500], [17, 0], [24, 500], [25, 0]]);
  for (let m = 0; m <= 35; m++) {
    if (by.has(m)) det.onSample('dev', by.get(m), t0 + m * MIN);
    det.checkNow(t0 + m * MIN);
  }
  assert.equal(det.consume('dev'), null);
});

test('dedupe: event fires once per cycle, next cycle fires again', () => {
  const det = createCycleDetector({ startWatts: 3, minDuration: 15 * MIN, settle: 5 * MIN });
  feed(det, [[0, 25], [20, 0]].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 25 * MIN);
  assert.ok(det.consume('dev'));
  assert.equal(det.consume('dev'), null);
  // second cycle
  feed(det, [[30, 25], [50, 0]].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 55 * MIN);
  assert.ok(det.consume('dev'));
});

test('fresh detector started mid-cycle still detects the end', () => {
  const det = createCycleDetector({ startWatts: 3, minDuration: 15 * MIN, settle: 5 * MIN });
  feed(det, [[0, 28], [10, 28], [20, 28]].map(([m, w]) => [t0 + m * MIN, w]));
  feed(det, [[30, 0]].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 31 * MIN);
  assert.equal(det.consume('dev'), null);
  det.checkNow(t0 + 36 * MIN);
  const ev = det.consume('dev');
  assert.ok(ev, 'mid-cycle start must still detect completion');
  assert.ok(ev.minutes >= 30, 'duration measured from detector start');
});

test('silent device (no further samples after 0W) fires via checkNow', () => {
  const det = createCycleDetector({ startWatts: 3, minDuration: 15 * MIN, settle: 5 * MIN });
  feed(det, [[0, 28], [20, 0]].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 21 * MIN);
  assert.equal(det.consume('dev'), null);
  det.checkNow(t0 + 26 * MIN);
  assert.ok(det.consume('dev'));
});

test('device below threshold at idle never starts a cycle', () => {
  const det = createCycleDetector({ startWatts: 3, minDuration: 15 * MIN, settle: 5 * MIN });
  feed(det, [[0, 1.2], [10, 1.2], [20, 2.9]].map(([m, w]) => [t0 + m * MIN, w]));
  det.checkNow(t0 + 30 * MIN);
  assert.equal(det.consume('dev'), null);
});
