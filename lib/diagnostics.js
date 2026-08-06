const SECRET_KEY_RE = /(password|passwd|secret|token|accessid|accesskey|localkey|apikey|authorization|credential)/i;

function isSecretKey(k) {
  return SECRET_KEY_RE.test(k);
}

export function sanitizeConfig(cfg) {
  cfg = cfg || {};
  const inv = cfg.inverter || {};
  const tuya = cfg.tuya || {};
  const netbird = cfg.netbird || {};
  const webpush = cfg.webpush || {};
  const charging = cfg.charging || {};
  return {
    inverter: {
      ip: inv.ip || '',
      port: inv.port || 8899,
      serial: inv.serial || '',
      autoResolve: !!inv.autoResolve,
      resolveAfterFails: inv.resolveAfterFails ?? 5,
    },
    tuya: {
      controlMode: tuya.controlMode || 'unknown',
      countryCode: tuya.countryCode ?? 0,
      appSchema: tuya.appSchema || 'unknown',
      hasCloudCreds: !!(tuya.accessId && tuya.accessKey && tuya.username),
      hasLocalKey: !!tuya.localKey,
    },
    netbird: {
      hasPublicUrl: !!netbird.publicUrl,
    },
    webpush: {
      hasSubject: !!webpush.subject,
    },
    charging: {
      startVoltage: charging.startVoltage ?? null,
      maxCharge: charging.maxCharge ?? null,
    },
    batteryCapacityWh: cfg.batteryCapacityWh ?? null,
  };
}

export function summarizeSeries(points, key) {
  points = points || [];
  let count = 0;
  let last = 0;
  let lastTs = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of points) {
    const v = p[key];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    count++;
    last = v;
    lastTs = p.ts || 0;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  if (!count) return { count: 0, last: 0, lastTs: 0, min: 0, max: 0, avg: 0 };
  return { count, last, lastTs, min, max, avg: Math.round((sum / count) * 10) / 10 };
}

export function countByType(notifs, sinceTs) {
  notifs = notifs || [];
  const out = { total: 0, info: 0, warn: 0, error: 0 };
  for (const n of notifs) {
    if (n.time < sinceTs) continue;
    out.total++;
    const t = n.type === 'warn' ? 'warn' : (n.type === 'error' ? 'error' : 'info');
    out[t]++;
  }
  return out;
}

export function summarizeTraces(traces) {
  traces = traces || [];
  const map = new Map();
  for (const t of traces) {
    let e = map.get(t.scene);
    if (!e) { e = { scene: t.scene, count: 0, lastAction: '', lastTs: 0 }; map.set(t.scene, e); }
    e.count++;
    if (t.ts > e.lastTs) { e.lastTs = t.ts; e.lastAction = t.action || ''; }
  }
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
}

export function summarizeDevices(devices) {
  devices = devices || [];
  const byGroup = {};
  let online = 0;
  for (const d of devices) {
    if (d.online) online++;
    const g = d.group || 'Uncategorized';
    byGroup[g] = (byGroup[g] || 0) + 1;
  }
  return { total: devices.length, online, offline: devices.length - online, byGroup };
}

export function buildDiagnostics(opts) {
  const now = opts.now || Date.now();
  const inv = opts.inverterData || {};
  const lastUpdateMs = inv.lastUpdate instanceof Date ? inv.lastUpdate.getTime() : inv.lastUpdate;
  const online = !!(lastUpdateMs && (now - lastUpdateMs) < 60000);
  const dailyRecords = opts.dailyRecords || [];
  const dayKwhSum = dailyRecords.reduce((a, r) => a + (r.dayKwh || 0), 0);
  const history = summarizeSeries(opts.history1m || [], 'w');
  const logBuffer = opts.logBuffer || [];
  let errors24h = 0;
  let warns24h = 0;
  for (const line of logBuffer) {
    if (line.includes('ERROR')) errors24h++;
    else if (line.includes('WARN')) warns24h++;
  }
  return {
    generatedAt: now,
    runtime: {
      uptimeSec: opts.uptimeSec || 0,
      memRssMB: Math.round((opts.memRss || 0) / 1024 / 1024),
      memHeapMB: Math.round((opts.memHeap || 0) / 1024 / 1024),
    },
    inverter: {
      online,
      ip: (opts.cfg && opts.cfg.inverter && opts.cfg.inverter.ip) || '',
      grid: !!inv.gridPower,
      soc: inv.batterySOC || 0,
      loadW: inv.loadPower || 0,
      pvW: inv.pvPower || 0,
      batteryW: inv.batteryPower || 0,
      lastUpdateAgoSec: lastUpdateMs ? Math.max(0, Math.round((now - lastUpdateMs) / 1000)) : null,
      consecutiveFails: opts.inverterFails || 0,
    },
    tuya: summarizeDevices(opts.tuyaDevices || []),
    scenes: {
      total: (opts.scenes || []).length,
      enabled: (opts.scenes || []).filter(s => s.enabled !== false).length,
      disabled: (opts.scenes || []).filter(s => s.enabled === false).length,
    },
    sceneTraces: {
      total: (opts.traces || []).length,
      byScene: summarizeTraces(opts.traces),
    },
    notifications: {
      last24h: (() => {
        const c = countByType(opts.notifs || [], now - 86400000);
        return { total: c.total, byType: { info: c.info, warn: c.warn, error: c.error } };
      })(),
      unread: (opts.notifs || []).filter(n => !n.read).length,
    },
    daily: {
      records: dailyRecords.length,
      avgDayKwh: dailyRecords.length ? Math.round((dayKwhSum / dailyRecords.length) * 100) / 100 : 0,
      lastDate: dailyRecords.length ? dailyRecords[dailyRecords.length - 1].date : null,
    },
    history: (() => {
      const h = summarizeSeries(opts.history1m || [], 'w');
      return { count: h.count, lastW: h.last, minW: h.min, maxW: h.max, avgW: h.avg };
    })(),
    log: { errors24h, warns24h },
    config: sanitizeConfig(opts.cfg),
  };
}

export function buildMarkdown(snap) {
  const lines = [];
  lines.push('# Strum Diagnostics Snapshot');
  lines.push('');
  lines.push('Generated: ' + new Date(snap.generatedAt).toISOString());
  lines.push('');
  lines.push('## Runtime');
  lines.push('- Uptime: ' + Math.floor(snap.runtime.uptimeSec / 60) + ' min');
  lines.push('- Memory: ' + snap.runtime.memRssMB + ' MB RSS / ' + snap.runtime.memHeapMB + ' MB heap');
  lines.push('');
  lines.push('## Inverter');
  lines.push('- **Inverter**: ' + (snap.inverter.online ? 'online' : 'offline') + (snap.inverter.ip ? ' @ ' + snap.inverter.ip : ''));
  lines.push('- Grid: ' + (snap.inverter.grid ? 'connected' : 'island'));
  lines.push('- SOC: ' + snap.inverter.soc + '%, Load: ' + snap.inverter.loadW + ' W, PV: ' + snap.inverter.pvW + ' W, Battery: ' + snap.inverter.batteryW + ' W');
  lines.push('- Last update: ' + (snap.inverter.lastUpdateAgoSec === null ? 'never' : snap.inverter.lastUpdateAgoSec + ' s ago'));
  lines.push('- Consecutive fails: ' + snap.inverter.consecutiveFails);
  lines.push('');
  lines.push('## Tuya Devices');
  lines.push('- Total: ' + snap.tuya.total + ', online: ' + snap.tuya.online + ', offline: ' + snap.tuya.offline);
  lines.push('- Groups: ' + Object.entries(snap.tuya.byGroup).map(([g, c]) => g + '=' + c).join(', '));
  lines.push('');
  lines.push('## Scenes');
  lines.push('- Total: ' + snap.scenes.total + ' (enabled: ' + snap.scenes.enabled + ', disabled: ' + snap.scenes.disabled + ')');
  lines.push('- Traces: ' + snap.sceneTraces.total + ' in log');
  for (const s of snap.sceneTraces.byScene.slice(0, 10)) {
    lines.push('  - ' + s.scene + ': ' + s.count + 'x, last=' + s.lastAction + ' @ ' + new Date(s.lastTs).toISOString());
  }
  lines.push('');
  lines.push('## Notifications (24h)');
  const nb = snap.notifications.last24h;
  lines.push('- Total: ' + nb.total + ' (info: ' + nb.byType.info + ', warn: ' + nb.byType.warn + ', error: ' + nb.byType.error + '), unread: ' + snap.notifications.unread);
  lines.push('');
  lines.push('## Daily Records');
  lines.push('- Records: ' + snap.daily.records + ', avg: ' + snap.daily.avgDayKwh + ' kWh/day, last: ' + snap.daily.lastDate);
  lines.push('');
  lines.push('## History (1m)');
  lines.push('- Points: ' + snap.history.count + ', last: ' + snap.history.lastW + ' W, min: ' + snap.history.minW + ' W, avg: ' + snap.history.avgW + ' W, max: ' + snap.history.maxW + ' W');
  lines.push('');
  lines.push('## Log Buffer');
  lines.push('- Errors: ' + snap.log.errors24h + ', warns: ' + snap.log.warns24h);
  lines.push('');
  lines.push('## Config');
  lines.push('- Inverter: ' + snap.config.inverter.ip + ':' + snap.config.inverter.port + ' (autoResolve: ' + snap.config.inverter.autoResolve + ')');
  lines.push('- Tuya: mode=' + snap.config.tuya.controlMode + ', cloud creds ' + (snap.config.tuya.hasCloudCreds ? 'present' : 'MISSING') + ', local key ' + (snap.config.tuya.hasLocalKey ? 'present' : 'missing'));
  lines.push('- Netbird public URL: ' + (snap.config.netbird.hasPublicUrl ? 'yes' : 'no'));
  lines.push('- WebPush subject: ' + (snap.config.webpush.hasSubject ? 'yes' : 'no'));
  return lines.join('\n') + '\n';
}
