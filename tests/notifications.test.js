import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert';

import { createNotifications } from '../lib/notifications.js';

function setup() {
  const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'strum-notif-test-'));
  const sent = [];
  const notifs = createNotifications(DATA_DIR, async () => ({}), n => sent.push(n));
  return { DATA_DIR, sent, notifs };
}

let clock = 1000000;
const now = () => clock;

test('first push sends and writes history', () => {
  const { sent, notifs } = setup();
  const id = notifs.pushNotification('Title', 'Body', 'warn', now);
  assert.ok(id > 0);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].title, 'Title');
  assert.strictEqual(sent[0].message, 'Body');
  assert.strictEqual(sent[0].type, 'warn');
  assert.strictEqual(notifs._notifHistory.length, 1);
});

test('identical title+message within cooldown window is dropped silently', () => {
  const { sent, notifs } = setup();
  clock = 5000;
  notifs.pushNotification('Reconnecting', 'Too many inverter failures — reconnecting...', 'warn', now);
  clock = 6000;
  const id = notifs.pushNotification('Reconnecting', 'Too many inverter failures — reconnecting...', 'warn', now);
  assert.strictEqual(id, null);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(notifs._notifHistory.length, 1);
});

test('same key sent again after cooldown window passes', () => {
  const { sent, notifs } = setup();
  clock = 1000;
  notifs.pushNotification('Reconnecting', 'Too many inverter failures — reconnecting...', 'warn', now);
  clock = 1000 + 600000;
  const id = notifs.pushNotification('Reconnecting', 'Too many inverter failures — reconnecting...', 'warn', now);
  assert.ok(id > 0);
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(notifs._notifHistory.length, 2);
});

test('different title or type bypasses cooldown', () => {
  const { sent, notifs } = setup();
  clock = 100;
  notifs.pushNotification('Reconnecting', 'Same body', 'warn', now);
  const a = notifs.pushNotification('Other', 'Same body', 'warn', now);
  const b = notifs.pushNotification('Reconnecting', 'Same body', 'info', now);
  assert.ok(a > 0);
  assert.ok(b > 0);
  assert.strictEqual(sent.length, 3);
});

test('deduped push does not write to history file', () => {
  const { DATA_DIR, notifs } = setup();
  clock = 1;
  notifs.pushNotification('T', 'M', 'info', now);
  notifs.pushNotification('T', 'M', 'info', now);
  const stored = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'notifications.json'), 'utf8'));
  assert.strictEqual(stored.length, 1);
});

test('default clock uses real time', () => {
  const { sent, notifs } = setup();
  const id = notifs.pushNotification('Real', 'Time');
  assert.ok(id > 0);
  assert.strictEqual(sent.length, 1);
});
