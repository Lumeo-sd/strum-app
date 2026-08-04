import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';

import { createConfig } from '../lib/config.js';
import { createAuth } from '../lib/auth.js';
import { createServerState } from '../lib/server.js';
import { registerRoutes } from '../lib/routes.js';
import { getCryptoHelpers } from '../lib/crypto.js';
import { parseBody, sendJson, sendHtml, sendText, setCookie, clearCookie, route, matchRoute } from '../lib/router.js';
import { rateLimit, getClientIp } from '../lib/rate-limit.js';
import { log } from '../lib/logger.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_PASSWORD = 'OldPassw0rd';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'strum-auth-test-'));
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CERT_FILE = path.join(DATA_DIR, 'cert.pem');
const KEY_FILE = path.join(DATA_DIR, 'key.pem');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SCENES_FILE = path.join(DATA_DIR, 'scenes.json');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

const { MASTER_KEY, encryptSecret, decryptSecret } = getCryptoHelpers(DATA_DIR);
const { loadConfig, saveConfig, netbirdExec } = createConfig(DATA_DIR, { MASTER_KEY, encryptSecret, decryptSecret });
const auth = createAuth(DATA_DIR, { loadConfig, saveConfig });

let fakeIp = '10.0.0.1';
const serverState = createServerState({
  log, path, fs, exec, __dirname: REPO_ROOT,
  CERT_FILE, KEY_FILE,
  parseCookies: auth.parseCookies, isSessionValid: auth.isSessionValid,
  getSessionCsrf: auth.getSessionCsrf, getSessionUser: auth.getSessionUser, sendJson,
  matchRoute, parseBody, rateLimit, getClientIp: () => fakeIp,
});
const { getLoginPage, getWebUI, createRequestHandler } = serverState;

const ctx = {
  route, sendJson, sendHtml, sendText, setCookie, clearCookie,
  loadConfig, saveConfig, netbirdExec,
  encryptSecret,
  pushNotification: () => {}, sendNotification: () => {}, sendChannel: () => {},
  _sendExtNotification: () => {}, _notifHistory: [], saveNotifHistory: () => {},
  inverterData: {}, costState: {}, dailyRecords: [], tuyaDevices: [], scenes: [], sceneTraces: [],
  controlDevice: async () => { throw new Error('not used in auth tests'); },
  fetchDeviceStatuses: async () => {}, syncDeviceNamesFromCloud: async () => {}, initTuya: () => {},
  loadScenes: async () => {}, saveScenes: async () => {}, checkScenes: () => {},
  requestSceneCheck: () => {}, loadSceneTimers: () => {},
  deviceName: () => '', resolveInverterIP: async () => {}, saveDevices: async () => {},
  resetInverterConnection: () => {}, getInverterConsecutiveFails: () => 0, runSceneNow: async () => {},
  loadAuthFile: auth.loadAuthFile, verifyPassword: auth.verifyPassword,
  hashPassword: auth.hashPassword, createSession: auth.createSession,
  getSessionUser: auth.getSessionUser, getSessionCsrf: auth.getSessionCsrf,
  isSessionValid: auth.isSessionValid, destroySession: auth.destroySession,
  parseCookies: auth.parseCookies, loginAttempts: auth.loginAttempts,
  sessions: auth.sessions, clearSessions: auth.clearSessions,
  getClientIp: () => fakeIp,
  log, logBuffer: () => {},
  rrdPickLevel: () => {}, rrdGetPower: () => {}, rrdGetSocket: () => {},
  fs, path, exec, execFile, os, __dirname: REPO_ROOT,
  CONFIG_FILE, AUTH_FILE, SCENES_FILE, DEVICES_FILE, SESSIONS_FILE, DATA_DIR, USERS_FILE,
  getLoginPage, getWebUI,
  webpush: {
    getVapidPublicKeyB64: () => 'vp_test_key',
    addSubscription: () => true,
    removeSubscription: () => {},
  },
};
registerRoutes(ctx);

let server;
let base;

test.before(async () => {
  server = http.createServer(createRequestHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test.beforeEach(async () => {
  fakeIp = '10.0.0.' + (100 + Math.floor(Math.random() * 100));
  for (const k of Object.keys(auth.sessions)) delete auth.sessions[k];
  for (const k of Object.keys(auth.loginAttempts)) delete auth.loginAttempts[k];
  const { salt, hash } = auth.hashPassword(TEST_PASSWORD);
  await fs.promises.writeFile(AUTH_FILE, JSON.stringify({ username: 'admin', salt, hash, mustChangePassword: false }, null, 2));
  await fs.promises.writeFile(USERS_FILE, JSON.stringify({ admin: { role: 'admin', createdAt: Date.now() } }, null, 2));
});

async function login(username, password) {
  const res = await fetch(base + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  const cookie = res.headers.get('set-cookie') || '';
  const token = (cookie.match(/ecm_session=([^;]+)/) || [])[1] || null;
  return { status: res.status, body, token, csrf: body.csrfToken || null };
}

async function req(method, url, { token, csrf, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.cookie = 'ecm_session=' + token;
  if (csrf !== undefined) h['x-csrf-token'] = csrf;
  const res = await fetch(base + url, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();
  else data = await res.text();
  return { status: res.status, data };
}

test('unauthorized /api request without a session returns 401', async () => {
  const r = await req('GET', '/api/user-prefs');
  assert.equal(r.status, 401);
  assert.equal(r.data.success, false);
});

test('valid login sets session cookie and returns csrf token', async () => {
  const r = await login('admin', TEST_PASSWORD);
  assert.equal(r.status, 200);
  assert.ok(r.token, 'cookie token present');
  assert.ok(r.csrf, 'csrf token present');
  assert.equal(r.body.success, true);
  assert.equal(r.body.mustChangePassword, false);
});

test('failed login returns 401 without creating a session', async () => {
  const r = await login('admin', 'wrong-password');
  assert.equal(r.status, 401);
  assert.equal(r.token, null);
});

test('authenticated session reads user prefs', async () => {
  const { token } = await login('admin', TEST_PASSWORD);
  const r = await req('GET', '/api/user-prefs', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.username, 'admin');
  assert.equal(r.data.role, 'admin');
});

test('logout destroys the session; reuse of the token is rejected', async () => {
  const { token, csrf } = await login('admin', TEST_PASSWORD);
  const out = await req('POST', '/api/logout', { token, csrf, body: {} });
  assert.equal(out.status, 200);
  const r = await req('GET', '/api/user-prefs', { token });
  assert.equal(r.status, 401);
});

test('POST /api without CSRF header is rejected 403', async () => {
  const { token } = await login('admin', TEST_PASSWORD);
  const r = await req('POST', '/api/user-prefs', { token, body: { prefs: { accent: 'red' } } });
  assert.equal(r.status, 403);
  assert.match(r.data.message, /CSRF token invalid/);
});

test('POST /api with a wrong CSRF header is rejected 403', async () => {
  const { token } = await login('admin', TEST_PASSWORD);
  const r = await req('POST', '/api/user-prefs', { token, csrf: 'deadbeef', body: { prefs: { accent: 'red' } } });
  assert.equal(r.status, 403);
});

test('POST /api with the correct CSRF header passes', async () => {
  const { token, csrf } = await login('admin', TEST_PASSWORD);
  const r = await req('POST', '/api/user-prefs', { token, csrf, body: { prefs: { accent: 'red' } } });
  assert.equal(r.status, 200);
  const read = await req('GET', '/api/user-prefs', { token });
  assert.equal(read.data.prefs.accent, 'red');
});

test('push subscribe is whitelisted from CSRF (but still requires a session)', async () => {
  const { token } = await login('admin', TEST_PASSWORD);
  const body = { subscription: { endpoint: 'https://push.example/ep', keys: {} }, origin: 'https://example.netbird.services' };
  const r = await req('POST', '/api/push/subscribe', { token, body });
  assert.equal(r.status, 200);
});

test('session without a stored username does not escalate to admin (no fallback)', async () => {
  const { token } = auth.createSession(undefined);
  const r = await req('GET', '/api/users', { token });
  assert.equal(r.status, 403);
  assert.match(r.data.message, /Admin required/);
});

test('viewer session is denied admin-only /api/users', async () => {
  const { token } = auth.createSession('viewer1');
  const r = await req('GET', '/api/users', { token });
  assert.equal(r.status, 403);
});

test('admin session can list users', async () => {
  const { token } = await login('admin', TEST_PASSWORD);
  const r = await req('GET', '/api/users', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data.users), ['admin']);
});

test('deleting a user revokes their existing sessions', async () => {
  const { token: adminToken, csrf } = await login('admin', TEST_PASSWORD);
  const create = await req('POST', '/api/users', { token: adminToken, csrf, body: { username: 'bob', password: 'bobpass123' } });
  assert.equal(create.status, 200);
  const { token: bobToken } = auth.createSession('bob');
  const read = await req('GET', '/api/user-prefs', { token: bobToken });
  assert.equal(read.status, 200);
  assert.equal(read.data.username, 'bob');
  const del = await req('DELETE', '/api/users/bob', { token: adminToken, csrf });
  assert.equal(del.status, 200);
  const after = await req('GET', '/api/user-prefs', { token: bobToken });
  assert.equal(after.status, 401);
});

test('deleting a user revokes sessions created after clearSessions()', async () => {
  const { token: adminToken, csrf } = await login('admin', TEST_PASSWORD);
  const create = await req('POST', '/api/users', { token: adminToken, csrf, body: { username: 'carol', password: 'carolpass123' } });
  assert.equal(create.status, 200);

  auth.clearSessions();
  const { token: adminToken2, csrf: csrf2 } = await login('admin', TEST_PASSWORD);
  const { token: carolToken } = auth.createSession('carol');

  const read = await req('GET', '/api/user-prefs', { token: carolToken });
  assert.equal(read.status, 200);
  assert.equal(read.data.username, 'carol');

  const del = await req('DELETE', '/api/users/carol', { token: adminToken2, csrf: csrf2 });
  assert.equal(del.status, 200);

  const after = await req('GET', '/api/user-prefs', { token: carolToken });
  assert.equal(after.status, 401, 'post-clear session must be revoked');
});

test('login attempts: 5 failures allowed, 6th is rate-limited 429', async () => {
  for (let i = 1; i <= 5; i++) {
    const r = await login('admin', 'wrong-pass');
    assert.equal(r.status, 401, 'attempt ' + i);
  }
  const blocked = await login('admin', 'wrong-pass');
  assert.equal(blocked.status, 429);
});

test('login rate limit is per-IP: another IP is not affected', async () => {
  for (let i = 0; i < 5; i++) await login('admin', 'wrong-pass');
  fakeIp = '10.10.10.' + (1 + Math.floor(Math.random() * 200));
  const r = await login('admin', 'wrong-pass');
  assert.equal(r.status, 401);
});

test('successful login resets the per-IP failure counter', async () => {
  for (let i = 0; i < 3; i++) await login('admin', 'wrong-pass');
  const ok = await login('admin', TEST_PASSWORD);
  assert.equal(ok.status, 200);
  const again = await login('admin', 'wrong-pass');
  assert.equal(again.status, 401, 'not blocked after reset');
});

test('repeated correct-password logins are not rate-limited', async () => {
  for (let i = 0; i < 6; i++) {
    const r = await login('admin', TEST_PASSWORD);
    assert.equal(r.status, 200, 'attempt ' + i);
  }
});

test('change-password rejects a wrong current password', async () => {
  const { token, csrf } = await login('admin', TEST_PASSWORD);
  const r = await req('POST', '/api/change-password', { token, csrf, body: { currentPassword: 'nope', newPassword: 'NewPassw0rd' } });
  assert.equal(r.status, 401);
});

test('change-password rejects a too-short new password', async () => {
  const { token, csrf } = await login('admin', TEST_PASSWORD);
  const r = await req('POST', '/api/change-password', { token, csrf, body: { currentPassword: TEST_PASSWORD, newPassword: 'abc' } });
  assert.equal(r.status, 400);
});

test('change-password is rate-limited after 5 wrong currentPassword attempts', async () => {
  const { token, csrf } = await login('admin', TEST_PASSWORD);
  for (let i = 1; i <= 5; i++) {
    const r = await req('POST', '/api/change-password', { token, csrf, body: { currentPassword: 'nope', newPassword: 'NewPassw0rd' } });
    assert.equal(r.status, 401, 'attempt ' + i);
  }
  const blocked = await req('POST', '/api/change-password', { token, csrf, body: { currentPassword: 'nope', newPassword: 'NewPassw0rd' } });
  assert.equal(blocked.status, 429);
});

test('change-password invalidates old password and existing sessions', async () => {
  const { token, csrf } = await login('admin', TEST_PASSWORD);
  const ch = await req('POST', '/api/change-password', { token, csrf, body: { currentPassword: TEST_PASSWORD, newPassword: 'NewPassw0rd!' } });
  assert.equal(ch.status, 200);
  const old = await login('admin', TEST_PASSWORD);
  assert.equal(old.status, 401, 'old password rejected');
  const fresh = await login('admin', 'NewPassw0rd!');
  assert.equal(fresh.status, 200, 'new password accepted');
  const stale = await req('GET', '/api/user-prefs', { token });
  assert.equal(stale.status, 401, 'old session invalidated');
});

test('hashPassword produces a 16-byte hex salt and 64-byte hash', () => {
  const { salt, hash } = auth.hashPassword('sekret');
  assert.equal(salt.length, 32);
  assert.equal(hash.length, 128);
  assert.match(salt, /^[0-9a-f]+$/);
  assert.match(hash, /^[0-9a-f]+$/);
});

test('verifyPassword accepts the right password, rejects wrong and empty', () => {
  const { salt, hash } = auth.hashPassword('sekret');
  assert.equal(auth.verifyPassword('sekret', salt, hash), true);
  assert.equal(auth.verifyPassword('wrong', salt, hash), false);
  assert.equal(auth.verifyPassword('', salt, hash), false);
  assert.equal(auth.verifyPassword('sekret', 'badsalt', hash), false);
});

test('password comparison uses constant-time timingSafeEqual', async () => {
  const src = await fs.promises.readFile(new URL('../lib/auth.js', import.meta.url), 'utf8');
  assert.match(src, /crypto\.timingSafeEqual/);
});

test('GET /api/metrics bypasses session auth and is gated by its own token', async () => {
  const r = await req('GET', '/api/metrics?token=');
  assert.equal(r.status, 401);
  assert.match(r.data, /unauthorized/);
});