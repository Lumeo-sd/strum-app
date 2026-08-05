import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { probeTcp, findInverterByPort } from '../lib/app-state.js';

test('probeTcp: resolves true when TCP connect succeeds', async () => {
  const server = net.createServer((s) => s.destroy());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.equal(await probeTcp('127.0.0.1', port, 1000), true);
  } finally {
    server.close();
  }
});

test('probeTcp: resolves false when connection refused', async () => {
  const server = net.createServer((s) => s.destroy());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  assert.equal(await probeTcp('127.0.0.1', port, 1000), false);
});

test('probeTcp: resolves false on timeout', async () => {
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const t0 = Date.now();
    assert.equal(await probeTcp('10.255.255.1', port, 200), false);
    assert.ok(Date.now() - t0 < 5000, 'should not wait for OS-level timeout');
  } finally {
    server.close();
  }
});

test('findInverterByPort: returns hosts with open port', async () => {
  const server = net.createServer((s) => s.destroy());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const hits = await findInverterByPort(['127.0.0.1', '127.0.0.2'], port, 500);
    assert.deepEqual(hits, ['127.0.0.1']);
  } finally {
    server.close();
  }
});

test('findInverterByPort: empty when no host responds', async () => {
  const server = net.createServer((s) => s.destroy());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const hits = await findInverterByPort(['127.0.0.1', '127.0.0.2'], port, 200);
  assert.deepEqual(hits, []);
});
