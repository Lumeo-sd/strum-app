import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { log } from './logger.js';
import { atomicWriteFileSync } from './atomic-write.js';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function derToRaw(sig) {
  if (!sig || sig[0] !== 0x30) return null;
  let i = 2;
  if (sig[1] & 0x80) i = 2 + (sig[1] & 0x7f);
  if (sig[i] !== 0x02) return null;
  let rl = sig[i + 1]; i += 2;
  const r = sig.subarray(i, i + rl); i += rl;
  if (sig[i] !== 0x02) return null;
  const sl = sig[i + 1]; i += 2;
  const s = sig.subarray(i, i + sl);
  const r0 = r[0] === 0 ? r.subarray(1) : r;
  const s0 = s[0] === 0 ? s.subarray(1) : s;
  if (r0.length > 32 || s0.length > 32) return null;
  const out = Buffer.alloc(64);
  r0.copy(out, 32 - r0.length);
  s0.copy(out, 64 - s0.length);
  return out;
}

function hmac(key, ...parts) {
  const h = crypto.createHmac('sha256', key);
  for (const p of parts) h.update(p);
  return h.digest();
}

function rfc8291Encrypt(payload, sub) {
  if (!payload || !sub || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return null;
  const uaPublic = Buffer.from(sub.keys.p256dh, 'base64url');
  const authSecret = Buffer.from(sub.keys.auth, 'base64url');
  if (uaPublic.length !== 65 || authSecret.length < 16) return null;
  const asKey = crypto.createECDH('prime256v1');
  asKey.generateKeys();
  const asPublic = asKey.getPublicKey();
  const salt = crypto.randomBytes(16);
  const ecdhSecret = asKey.computeSecret(uaPublic);
  const PRK_key = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const IKM = hmac(PRK_key, keyInfo, Buffer.from([1]));
  const PRK = hmac(salt, IKM);
  const CEK = hmac(PRK, Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])).subarray(0, 16);
  const NONCE = hmac(PRK, Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])).subarray(0, 12);
  const gcm = crypto.createCipheriv('aes-128-gcm', CEK, NONCE);
  const ct = Buffer.concat([gcm.update(Buffer.concat([payload, Buffer.from([2])])), gcm.final(), gcm.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([65]), asPublic, ct]);
}

function buildPayload(notification, origin) {
  const unread = Math.min(99, Math.max(0, (notification && notification.unread) || 0));
  const base = (origin || '/').replace(/\/+$/, '') + '/';
  const badge = String(unread);
  return JSON.stringify({
    web_push: 8030,
    app_badge: badge,
    notification: {
      title: String((notification && notification.title) || 'Strum'),
      body: String((notification && notification.message) || ''),
      navigate: base,
      app_badge: badge,
    },
  });
}

export function createWebPush(DATA_DIR, loadConfig) {
  const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
  const SUBS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');
  let _keys = null;

  function getKeys() {
    if (_keys) return _keys;
    try {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      if (saved && saved.privateKey && saved.publicKey) { _keys = saved; return _keys; }
    } catch {}
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    _keys = {
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    };
    try { atomicWriteFileSync(VAPID_FILE, JSON.stringify(_keys, null, 2), { mode: 0o600 }); } catch (e) { log.error('VAPID save: ' + e.message); }
    return _keys;
  }

  function getVapidPublicKeyB64() {
    const key = crypto.createPublicKey(getKeys().publicKey);
    const der = key.export({ type: 'spki', format: 'der' });
    return b64url(der.subarray(der.length - 65));
  }

  async function makeJwt(aud) {
    let subject = 'mailto:strum@localhost';
    try {
      const cfg = await loadConfig();
      if (cfg.webpush && cfg.webpush.subject) subject = cfg.webpush.subject;
      else if (cfg.netbird && cfg.netbird.publicUrl) subject = 'mailto:strum@' + new URL(cfg.netbird.publicUrl).hostname;
    } catch {}
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const now = Math.floor(Date.now() / 1000);
    const claims = b64url(JSON.stringify({ aud, exp: now + 3600, sub: subject }));
    const payload = header + '.' + claims;
    const key = crypto.createPrivateKey(getKeys().privateKey);
    const raw = derToRaw(crypto.sign('sha256', Buffer.from(payload), key));
    if (!raw) throw new Error('VAPID signature conversion failed');
    return payload + '.' + b64url(raw);
  }

  function loadSubscriptions() {
    try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
  }

  function saveSubscriptions(subs) {
    try { atomicWriteFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), { mode: 0o600 }); } catch (e) { log.error('WebPush save subs: ' + e.message); }
  }

  function addSubscription(sub) {
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//i.test(sub.endpoint)) return false;
    const subs = loadSubscriptions();
    const rec = { endpoint: sub.endpoint, keys: sub.keys || null, origin: sub.origin || null, ua: (sub.userAgent || '').slice(0, 200), added: Date.now() };
    const idx = subs.findIndex(s => s.endpoint === sub.endpoint);
    if (idx >= 0) subs[idx] = rec; else subs.push(rec);
    if (subs.length > 50) subs.splice(0, subs.length - 50);
    saveSubscriptions(subs);
    return true;
  }

  function removeSubscription(endpoint) {
    if (!endpoint) return;
    const subs = loadSubscriptions();
    const next = subs.filter(s => s.endpoint !== endpoint);
    if (next.length !== subs.length) saveSubscriptions(next);
  }

  async function sendPush(sub, notification) {
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//i.test(sub.endpoint)) return;
    let origin = sub.origin;
    try {
      const cfg = await loadConfig();
      if (cfg.netbird && cfg.netbird.publicUrl) origin = cfg.netbird.publicUrl;
    } catch {}
    let body = null;
    try {
      body = rfc8291Encrypt(Buffer.from(buildPayload(notification, origin)), sub);
    } catch (e) { log.warn('WebPush encrypt: ' + e.message); }
    const url = new URL(sub.endpoint);
    const jwt = await makeJwt(url.origin);
    const client = url.protocol === 'http:' ? http : https;
    const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'http:' ? 80 : 443);
    const headers = {
      'Authorization': 'vapid t=' + jwt + ', k=' + getVapidPublicKeyB64(),
      'TTL': String(sub.ttl || 3600),
      'Content-Length': body ? body.length : 0,
    };
    if (body) {
      headers['Content-Encoding'] = 'aes128gcm';
      headers['Content-Type'] = 'application/octet-stream';
    }
    await new Promise((resolve, reject) => {
      const req = client.request({ hostname: url.hostname, port, path: url.pathname + url.search, method: 'POST', headers, timeout: 15000 }, res => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode === 404 || res.statusCode === 410) { removeSubscription(sub.endpoint); resolve('gone'); }
          else if (res.statusCode === 429) { log.warn('WebPush throttled (429)'); resolve('throttled'); }
          else if (res.statusCode >= 400) { log.warn('WebPush HTTP ' + res.statusCode + ' for ' + sub.endpoint); resolve('failed'); }
          else resolve('ok');
        });
      });
      req.on('error', e => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('push timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }

  let _timer = null;
  let _lastNotif = null;
  function broadcast(notification) {
    if (notification) _lastNotif = notification;
    if (!_lastNotif) return;
    if (_timer) return;
    _timer = setTimeout(async () => {
      _timer = null;
      try {
        const subs = loadSubscriptions();
        if (!subs.length) return;
        await Promise.allSettled(subs.map(sub => sendPush(sub, _lastNotif)));
      } catch (e) { log.error('WebPush broadcast: ' + e.message); }
    }, 2000);
  }

  return { getVapidPublicKeyB64, addSubscription, removeSubscription, broadcast, getSubscriptionCount: () => loadSubscriptions().length };
}
