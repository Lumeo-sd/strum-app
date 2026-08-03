import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { log } from './logger.js';
import { atomicWriteJsonSync } from './atomic-write.js';

export function createNotifications(DATA_DIR, loadConfig, onNotify) {
  const NOTIF_FILE = path.join(DATA_DIR, 'notifications.json');
  let _notifHistory = [];
  try {
    _notifHistory = JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8'));
  } catch { _notifHistory = []; }
  let _notifId = _notifHistory.reduce((max, n) => Math.max(max, n.id || 0), 0);

  function saveNotifHistory() {
    try {
      if (_notifHistory.length > 200) _notifHistory = _notifHistory.slice(-200);
      atomicWriteJsonSync(NOTIF_FILE, _notifHistory);
    } catch {}
  }

  function pushNotification(title, message, type) {
    const id = ++_notifId;
    _notifHistory.push({ id, title, message, type: type || 'info', time: Date.now(), dismissed: false, read: false });
    if (_notifHistory.length > 200) _notifHistory.shift();
    saveNotifHistory();
    const unread = _notifHistory.filter(n => !n.dismissed && !n.read).length;
    try { if (onNotify) onNotify({ id, title, message, type: type || 'info', unread }); } catch {}
  }

  async function sendNotification(title, message, critical) {
    pushNotification(title, message, critical ? 'error' : 'info');
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function _sendNtfy(title, message) {
    const cfg = await loadConfig();
    const n = cfg.notifications || {};
    if (!n.ntfyTopic || n.ntfyEnabled === false || n.ntfyNotifEnabled === false) return ['ntfy: disabled'];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = JSON.stringify({ topic: n.ntfyTopic, title, message, priority: 4 });
        await new Promise((resolve, reject) => {
          const req2 = https.request({ hostname: 'ntfy.sh', port: 443, path: '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 25000 }, res2 => { res2.on('data', () => {}); res2.on('end', () => { if (res2.statusCode >= 200 && res2.statusCode < 300) resolve(); else reject(new Error('ntfy HTTP ' + res2.statusCode)); }); });
          req2.on('error', e => reject(new Error('ntfy: ' + (e.code || e.message || typeof e))));
          req2.on('timeout', () => { req2.destroy(); reject(new Error('ntfy timeout')); });
          req2.write(body);
          req2.end();
        });
        return ['ntfy: OK'];
      } catch (e) {
        if (attempt < 2) { await _sleep(2000); continue; }
        return ['ntfy: ' + e.message];
      }
    }
  }

  async function _sendTelegram(title, message) {
    const cfg = await loadConfig();
    const n = cfg.notifications || {};
    if (!n.telegramToken || !n.telegramChatId || n.telegramEnabled === false || n.telegramNotifEnabled === false) return ['telegram: disabled'];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = JSON.stringify({ chat_id: n.telegramChatId, text: '*' + title + '*\n' + message, parse_mode: 'Markdown' });
        await new Promise((resolve, reject) => {
          const url = new URL('https://api.telegram.org/bot' + n.telegramToken + '/sendMessage');
          const req2 = https.request({ hostname: url.hostname, port: 443, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 25000 }, res2 => { res2.on('data', () => {}); res2.on('end', () => { if (res2.statusCode >= 200 && res2.statusCode < 300) resolve(); else reject(new Error('telegram HTTP ' + res2.statusCode)); }); });
          req2.on('error', e => reject(new Error('tg: ' + (e.code || e.message || typeof e))));
          req2.on('timeout', () => { req2.destroy(); reject(new Error('telegram timeout')); });
          req2.write(body);
          req2.end();
        });
        return ['telegram: OK'];
      } catch (e) {
        if (attempt < 2) { await _sleep(2000); continue; }
        return ['telegram: ' + e.message];
      }
    }
  }

  async function sendChannel(kind, title, message) {
    try {
      const cfg = await loadConfig();
      const n = cfg.notifications || {};
      if (n.notifEnabled === false) return [];
      if (kind === 'ntfy') return _sendNtfy(title, message);
      if (kind === 'telegram') return _sendTelegram(title, message);
      return ['error: unknown channel'];
    } catch (e) { return ['error: ' + e.message]; }
  }

  async function _sendExtNotification(title, message, critical) {
    try {
      const cfg = await loadConfig();
      const n = cfg.notifications || {};
      if (n.criticalEnabled === false && critical) return [];
      if (n.notifEnabled === false) return [];
      const results = (await _sendNtfy(title, message)).concat(await _sendTelegram(title, message)).filter(r => r !== 'ntfy: disabled' && r !== 'telegram: disabled');
      if (results.length) log.info('Notification (' + title + '): ' + results.join(', '));
      return results;
    } catch (e) { return ['error: ' + e.message]; }
  }

  return { pushNotification, sendNotification, sendChannel, _sendExtNotification, _notifHistory, _notifId, saveNotifHistory };
}
