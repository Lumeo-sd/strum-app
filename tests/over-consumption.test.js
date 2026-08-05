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
