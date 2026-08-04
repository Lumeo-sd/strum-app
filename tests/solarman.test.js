import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SolarmanV5 } from '../lib/solarman.js';

const MODBUS_REQ = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0xc5, 0xcd]);

function checksumOf(frame) {
  let sum = 0;
  for (let i = 1; i < frame.length - 2; i++) sum = (sum + frame[i]) & 0xff;
  return sum;
}

function makeInstance() {
  const inst = new SolarmanV5('127.0.0.1', 123456);
  inst.sequenceNumber = 5;
  return inst;
}

function makeResponseFrame(inst, seqByte) {
  const seq = Buffer.from([seqByte, 0x00]);
  const header = inst.v5Header(14 + MODBUS_REQ.length, 0x45, seq);
  const body = Buffer.concat([header, Buffer.alloc(14), MODBUS_REQ]);
  const frame = Buffer.alloc(body.length + 2);
  body.copy(frame);
  frame[frame.length - 1] = 0x15;
  frame[frame.length - 2] = checksumOf(frame);
  return frame;
}

test('calculateChecksum sums every byte of the data it is given', () => {
  assert.equal(SolarmanV5.calculateChecksum(Buffer.from([0x01, 0x02, 0x03, 0x04])), 10);
  assert.equal(SolarmanV5.calculateChecksum(Buffer.from([0x10, 0x20, 0x30, 0x40])), 0xa0);
});

test('v5Header lays out start, length, control suffix, control code, seq and serial', () => {
  const inst = makeInstance();
  const seq = Buffer.from([0x07, 0x00]);
  const header = inst.v5Header(23, 0x45, seq);
  assert.equal(header.length, 11);
  assert.equal(header[0], 0xa5);
  assert.equal(header.readUInt16LE(1), 23);
  assert.equal(header[3], 0x10);
  assert.equal(header[4], 0x45);
  assert.equal(header[5], 0x07);
  assert.equal(header[6], 0x00);
  assert.equal(header.readUInt32LE(7), 123456);
});

test('v5FrameEncoder builds a request with the 15-byte data prefix and valid trailer', () => {
  const inst = makeInstance();
  const frame = inst.v5FrameEncoder(MODBUS_REQ);

  assert.equal(frame[0], 0xa5);
  assert.equal(frame[frame.length - 1], 0x15);
  assert.equal(frame.readUInt16LE(1), 15 + MODBUS_REQ.length);
  assert.equal(frame[4], 0x45);
  assert.equal(frame[5], 6);
  assert.equal(frame[frame.length - 2], checksumOf(frame));
  assert.deepEqual([...frame.subarray(26, 26 + MODBUS_REQ.length)], [...MODBUS_REQ]);
});

test('v5FrameDecoder returns the modbus frame at offset 25 (response layout)', () => {
  const inst = makeInstance();
  const frame = makeResponseFrame(inst, 0x05);
  assert.deepEqual([...inst.v5FrameDecoder(frame)], [...MODBUS_REQ]);
});

test('v5FrameDecoder rejects a frame with wrong start/end bytes', () => {
  const inst = makeInstance();
  const bad = makeResponseFrame(inst, 0x05);
  bad[0] = 0x00;
  assert.throws(() => inst.v5FrameDecoder(bad), /invalid start\/end/);
  const badEnd = makeResponseFrame(inst, 0x05);
  badEnd[badEnd.length - 1] = 0x00;
  assert.throws(() => inst.v5FrameDecoder(badEnd), /invalid start\/end/);
});

test('v5FrameDecoder rejects a frame with a bad checksum', () => {
  const inst = makeInstance();
  const bad = makeResponseFrame(inst, 0x05);
  bad[bad.length - 2] = (bad[bad.length - 2] + 1) & 0xff;
  assert.throws(() => inst.v5FrameDecoder(bad), /invalid checksum/);
});

test('v5FrameDecoder rejects a frame with a mismatched sequence number', () => {
  const inst = makeInstance();
  const frame = makeResponseFrame(inst, 0x09);
  assert.throws(() => inst.v5FrameDecoder(frame), /sequence number mismatch/);
});

test('getNextSequenceNumber starts random and increments modulo 256', () => {
  const inst = makeInstance();
  inst.sequenceNumber = null;
  const first = inst.getNextSequenceNumber();
  assert.ok(first >= 1 && first <= 254);
  assert.equal(inst.getNextSequenceNumber(), (first + 1) & 0xff);
});

test('v5TimeResponseFrame echoes a protocol response with the response control code', () => {
  const inst = makeInstance();
  const seq = Buffer.from([0x05, 0x00]);
  const reqHeader = inst.v5Header(6, 0x41, seq);
  const req = Buffer.concat([reqHeader, Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00])]);
  const resp = inst.v5TimeResponseFrame(Buffer.concat([req, Buffer.from([checksumOf(req), 0x15])]));

  assert.equal(resp[0], 0xa5);
  assert.equal(resp[4], 0x11);
  assert.equal(resp.readUInt16LE(1), 10);
  assert.equal(resp[5], (seq[0] + 1) & 0xff);
  assert.equal(resp[resp.length - 1], 0x15);
  assert.equal(resp[resp.length - 2], checksumOf(resp));
});

test('handleProtocolFrame answers non-request control codes and passes requests through', () => {
  const inst = makeInstance();
  const seq = Buffer.from([0x05, 0x00]);
  const dataFrame = Buffer.concat([inst.v5Header(6, 0x41, seq), Buffer.alloc(6)]);
  assert.equal(inst.handleProtocolFrame(dataFrame), false);

  const requestFrame = Buffer.concat([inst.v5Header(6, 0x45, seq), Buffer.alloc(6)]);
  assert.equal(inst.handleProtocolFrame(requestFrame), true);
});
