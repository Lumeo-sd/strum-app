import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert';
import { createWebPush } from '../lib/webpush.js';

const loadConfig = async () => ({});
const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'strum-wp-'));

function makeSub(i) {
  return { endpoint: `https://push.example.com/ep${i}`, keys: { p256dh: 'abc', auth: 'def' }, userAgent: 'TestAgent', origin: 'https://strum.example.com' };
}

test('vapid key: base64url 87 chars, stable across instances, persisted to disk', () => {
  const d = freshDir();
  const wp = createWebPush(d, loadConfig);
  const k1 = wp.getVapidPublicKeyB64();
  assert.match(k1, /^[A-Za-z0-9_-]{87}$/);
  const k2 = wp.getVapidPublicKeyB64();
  assert.strictEqual(k2, k1);
  const wp2 = createWebPush(d, loadConfig);
  assert.strictEqual(wp2.getVapidPublicKeyB64(), k1);
  assert.ok(fs.existsSync(path.join(d, 'vapid.json')));
});

test('addSubscription persists and dedupes by endpoint', () => {
  const d = freshDir();
  const wp = createWebPush(d, loadConfig);
  assert.strictEqual(wp.addSubscription(makeSub(1)), true);
  const dup = { ...makeSub(1), userAgent: 'UpdatedAgent' };
  assert.strictEqual(wp.addSubscription(dup), true);
  assert.strictEqual(wp.getSubscriptionCount(), 1);
  const saved = JSON.parse(fs.readFileSync(path.join(d, 'push-subscriptions.json'), 'utf8'));
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].ua, 'UpdatedAgent');
  assert.strictEqual(saved[0].origin, 'https://strum.example.com');
  assert.strictEqual(typeof saved[0].added, 'number');
});

test('addSubscription accepts missing origin/userAgent (SW pushsubscriptionchange)', () => {
  const d = freshDir();
  const wp = createWebPush(d, loadConfig);
  assert.strictEqual(wp.addSubscription({ endpoint: 'https://push.example.com/sw-ep', keys: { p256dh: 'x', auth: 'y' } }), true);
  const saved = JSON.parse(fs.readFileSync(path.join(d, 'push-subscriptions.json'), 'utf8'));
  assert.strictEqual(saved[0].origin, null);
  assert.strictEqual(saved[0].ua, '');
});

test('addSubscription rejects invalid endpoints', () => {
  const wp = createWebPush(freshDir(), loadConfig);
  assert.strictEqual(wp.addSubscription({ endpoint: 'http://insecure.example.com' }), false);
  assert.strictEqual(wp.addSubscription({}), false);
  assert.strictEqual(wp.addSubscription(null), false);
  assert.strictEqual(wp.getSubscriptionCount(), 0);
});

test('subscriptions capped at 50 (oldest evicted)', () => {
  const d = freshDir();
  const wp = createWebPush(d, loadConfig);
  for (let i = 0; i < 55; i++) wp.addSubscription(makeSub(i));
  assert.strictEqual(wp.getSubscriptionCount(), 50);
  const saved = JSON.parse(fs.readFileSync(path.join(d, 'push-subscriptions.json'), 'utf8'));
  assert.ok(!saved.some(s => s.endpoint.includes('ep0')));
  assert.ok(saved.some(s => s.endpoint.includes('ep54')));
});

test('removeSubscription deletes by endpoint, no-op for unknown', () => {
  const d = freshDir();
  const wp = createWebPush(d, loadConfig);
  wp.addSubscription(makeSub(1));
  wp.addSubscription(makeSub(2));
  wp.removeSubscription('https://push.example.com/ep1');
  assert.strictEqual(wp.getSubscriptionCount(), 1);
  const saved = JSON.parse(fs.readFileSync(path.join(d, 'push-subscriptions.json'), 'utf8'));
  assert.strictEqual(saved[0].endpoint, 'https://push.example.com/ep2');
  wp.removeSubscription('https://push.example.com/unknown');
  assert.strictEqual(wp.getSubscriptionCount(), 1);
});

test('broadcast with empty subscription list is a safe no-op', async () => {
  const wp = createWebPush(freshDir(), loadConfig);
  assert.strictEqual(wp.broadcast({ title: 't', message: 'm', type: 'info', unread: 0 }), undefined);
  await new Promise(r => setTimeout(r, 2200));
  assert.strictEqual(wp.getSubscriptionCount(), 0);
});
