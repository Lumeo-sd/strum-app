import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildFrame, parseFrame, parseDpsFromPayload, overlayPending, confirmPending } from '../lib/tuya-local.js';

const KEY = Buffer.from('0123456789abcdef');
const FAKE_IT_TIMEOUT_MS = 5000;

test('buildFrame lays out the v3.5 header correctly', () => {
  const plaintext = Buffer.from('hello');
  const frame = buildFrame(7, 0x0d, plaintext, KEY);

  assert.equal(frame.length, 18 + 12 + plaintext.length + 16 + 4);
  assert.deepEqual([...frame.subarray(0, 4)], [0x00, 0x00, 0x66, 0x99]);
  assert.equal(frame.readUInt16BE(4), 0);
  assert.equal(frame.readUInt32BE(6), 7);
  assert.equal(frame.readUInt32BE(10), 0x0d);
  assert.equal(frame.readUInt32BE(14), 12 + plaintext.length + 16);
  assert.deepEqual([...frame.subarray(frame.length - 4)], [0x00, 0x00, 0x99, 0x66]);
});

test('buildFrame+parseFrame roundtrip returns retcode and payload', () => {
  const plaintext = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('{"dps":{"1":true}}')]);
  const frame = buildFrame(3, 0x10, plaintext, KEY);
  const parsed = parseFrame(frame, KEY);

  assert.equal(parsed.seqno, 3);
  assert.equal(parsed.cmd, 0x10);
  assert.equal(parsed.retcode, 0);
  assert.equal(parsed.payload.toString(), '{"dps":{"1":true}}');
  assert.equal(parsed.totalLength, frame.length);
});

test('parseFrame returns null for too-short buffer', () => {
  assert.equal(parseFrame(Buffer.alloc(10), KEY), null);
});

test('parseFrame returns null for wrong prefix', () => {
  const plaintext = Buffer.from([0, 0, 0, 0]);
  const frame = buildFrame(1, 0x10, plaintext, KEY);
  frame[0] = 0xff;
  assert.equal(parseFrame(frame, KEY), null);
});

test('parseFrame returns null for wrong suffix', () => {
  const plaintext = Buffer.from([0, 0, 0, 0]);
  const frame = buildFrame(1, 0x10, plaintext, KEY);
  frame[frame.length - 1] = 0xff;
  assert.equal(parseFrame(frame, KEY), null);
});

test('parseFrame returns null when length field exceeds available data', () => {
  const plaintext = Buffer.from([0, 0, 0, 0]);
  const frame = buildFrame(1, 0x10, plaintext, KEY);
  const truncated = frame.subarray(0, frame.length - 2);
  assert.equal(parseFrame(truncated, KEY), null);
});

test('parseFrame throws on GCM auth failure when ciphertext is tampered', () => {
  const plaintext = Buffer.from([0, 0, 0, 0]);
  const frame = buildFrame(1, 0x10, plaintext, KEY);
  frame[30] ^= 0xff;
  assert.throws(() => parseFrame(frame, KEY));
});

test('parseFrame tolerates extra trailing bytes', () => {
  const plaintext = Buffer.from([0, 0, 0, 0]);
  const frame = buildFrame(2, 0x10, plaintext, KEY);
  const padded = Buffer.concat([frame, Buffer.from([0xde, 0xad])]);
  const parsed = parseFrame(padded, KEY);
  assert.equal(parsed.totalLength, frame.length);
  assert.equal(parsed.retcode, 0);
});

test('parseFrame reports null retcode for empty plaintext (heartbeat)', () => {
  const frame = buildFrame(1, 0x09, Buffer.alloc(0), KEY);
  const parsed = parseFrame(frame, KEY);
  assert.equal(parsed.retcode, null);
  assert.equal(parsed.payload.length, 0);
});

test('parseDpsFromPayload strips the 3.5 version header', () => {
  const versioned = Buffer.concat([
    Buffer.from('3.5'),
    Buffer.alloc(12),
    Buffer.from('{"dps":{"1":true,"2":false}}'),
  ]);
  const parsed = parseDpsFromPayload(versioned);
  assert.deepEqual(parsed, { dps: { 1: true, 2: false } });
});

test('parseDpsFromPayload parses unversioned json payload', () => {
  const parsed = parseDpsFromPayload(Buffer.from('{"dps":{"20":"v"}}'));
  assert.deepEqual(parsed, { dps: { 20: 'v' } });
});

test('parseDpsFromPayload returns null for payload without braces', () => {
  assert.equal(parseDpsFromPayload(Buffer.from('no json here')), null);
  assert.equal(parseDpsFromPayload(Buffer.from('')), null);
});

test('parseDpsFromPayload extracts json embedded after the retcode', () => {
  const payload = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('{"dps":{"1":1}}')]);
  const parsed = parseDpsFromPayload(payload);
  assert.deepEqual(parsed, { dps: { 1: 1 } });
});

test('overlayPending includes fresh pending values and drops expired ones', () => {
  const now = 1_000_000;
  const pending = {
    '1': { value: true, sent: false, updatedAt: now - 1000 },
    '2': { value: false, sent: true, updatedAt: now - FAKE_IT_TIMEOUT_MS - 1 },
  };
  assert.deepEqual(overlayPending(pending, now), { 1: true });
});

test('overlayPending includes entries exactly at the timeout boundary', () => {
  const now = 1_000_000;
  const pending = { '1': { value: 42, sent: false, updatedAt: now - FAKE_IT_TIMEOUT_MS } };
  assert.deepEqual(overlayPending(pending, now), { 1: 42 });
});

test('confirmPending removes a sent entry once the device echoes the value', () => {
  const now = 1_000_000;
  const pending = { '1': { value: true, sent: true, updatedAt: now } };
  confirmPending(pending, { 1: true }, now);
  assert.deepEqual(pending, {});
});

test('confirmPending keeps a sent entry whose echoed value differs', () => {
  const now = 1_000_000;
  const pending = { '1': { value: true, sent: true, updatedAt: now } };
  confirmPending(pending, { 1: false }, now);
  assert.deepEqual(pending, { 1: { value: true, sent: true, updatedAt: now } });
});

test('confirmPending keeps an unsent entry even when the value matches', () => {
  const now = 1_000_000;
  const pending = { '1': { value: true, sent: false, updatedAt: now } };
  confirmPending(pending, { 1: true }, now);
  assert.deepEqual(pending, { 1: { value: true, sent: false, updatedAt: now } });
});

test('confirmPending drops expired entries regardless of echo', () => {
  const now = 1_000_000;
  const pending = {
    '1': { value: true, sent: true, updatedAt: now - FAKE_IT_TIMEOUT_MS - 1 },
    '2': { value: false, sent: false, updatedAt: now - FAKE_IT_TIMEOUT_MS - 1 },
  };
  confirmPending(pending, {}, now);
  assert.deepEqual(pending, {});
});

test('confirmPending removes a matching sent entry while keeping an unrelated fresh one', () => {
  const now = 1_000_000;
  const pending = {
    '1': { value: true, sent: true, updatedAt: now },
    '2': { value: false, sent: false, updatedAt: now },
  };
  confirmPending(pending, { 1: true }, now);
  assert.deepEqual(pending, { 2: { value: false, sent: false, updatedAt: now } });
});
