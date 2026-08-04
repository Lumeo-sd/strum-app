import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, getCrc, addCrc, verifyCrc } from '../lib/crc16.js';

test('crc16 matches the known Modbus vector for 01 03 00 00 00 0A', () => {
  const data = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]);
  assert.equal(crc16(data), 0xcdc5);
});

test('crc16 of a one-byte payload matches the hand-derived value', () => {
  const data = Buffer.from([0x41]);
  let expected = 0xffff;
  expected ^= 0x41;
  for (let j = 0; j < 8; j++) expected = expected & 1 ? (expected >>> 1) ^ 0xa001 : expected >>> 1;
  assert.equal(crc16(data), expected);
});

test('getCrc emits the checksum little-endian', () => {
  const buf = getCrc(Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]));
  assert.deepEqual([...buf], [0xc5, 0xcd]);
});

test('addCrc appends the little-endian checksum', () => {
  const data = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]);
  const framed = addCrc(data);
  assert.equal(framed.length, data.length + 2);
  assert.equal(framed[framed.length - 2], 0xc5);
  assert.equal(framed[framed.length - 1], 0xcd);
});

test('verifyCrc accepts a valid frame', () => {
  assert.equal(verifyCrc(Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0xc5, 0xcd])), true);
});

test('verifyCrc rejects a corrupted frame', () => {
  assert.equal(verifyCrc(Buffer.from([0x01, 0x03, 0x00, 0x01, 0x00, 0x0a, 0xc5, 0xcd])), false);
});

test('verifyCrc rejects frames shorter than 4 bytes', () => {
  assert.equal(verifyCrc(Buffer.from([0x01, 0x03, 0x00])), false);
});

test('addCrc+verifyCrc roundtrip holds', () => {
  const data = Buffer.from([0x11, 0x03, 0x00, 0x2a, 0x00, 0x02]);
  assert.equal(verifyCrc(addCrc(data)), true);
});
