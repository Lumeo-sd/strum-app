// diagnostic-snapshot.js
//
// Діагностичний snapshot без HTTP: читає файли DATA_DIR напряму
// (конфіг, сцени, пристрої, нотифікації, трейси сцен, daily, RRD-історію)
// і друкує компактний звіт (markdown за замовчуванням, `--json` для машинного виводу).
//
// Запуск:
//   node scripts/diagnostic-snapshot.js [DATA_DIR] [--json] [--traces N]
//
// Без секретів: вивід проходить через sanitizeConfig (whitelist),
// значення паролів/токенів/ключів не потрапляють у звіт.
// Нічого не пише, тільки читає.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiagnostics, buildMarkdown } from '../lib/diagnostics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  let dataDir = path.join(REPO_ROOT, 'data');
  let json = false;
  let traces = 200;
  for (const a of argv.slice(2)) {
    if (a === '--json') json = true;
    else if (a.startsWith('--traces=')) traces = parseInt(a.slice(9)) || 200;
    else if (!a.startsWith('--')) dataDir = a;
  }
  return { dataDir, json, traces };
}

function readJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function loadTraceLog(dataDir, len) {
  const out = [];
  for (const file of [path.join(dataDir, 'scene-traces.jsonl.old'), path.join(dataDir, 'scene-traces.jsonl')]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { out.push(JSON.parse(t)); } catch { continue; }
      }
    } catch {}
  }
  return out.slice(-len);
}

function main() {
  const { dataDir, json, traces } = parseArgs(process.argv);
  const cfg = readJson(path.join(dataDir, 'config.json')) || {};
  const scenes = readJson(path.join(dataDir, 'scenes.json')) || [];
  const devices = readJson(path.join(dataDir, 'devices.json')) || [];
  const notifs = readJson(path.join(dataDir, 'notifications.json')) || [];
  const daily = readJson(path.join(dataDir, 'daily.json')) || [];
  const history = readJson(path.join(dataDir, 'history_1m.json')) || [];
  const historyPoints = Array.isArray(history) ? history : (history.points || []);
  const sceneTraceLog = loadTraceLog(dataDir, traces);
  const logBuffer = [];
  const mapPower = (p) => ({ ts: p.ts, w: (p.w ?? p.load ?? p.pv ?? 0) });

  const snap = buildDiagnostics({
    now: Date.now(),
    uptimeSec: Math.round(process.uptime()),
    memRss: process.memoryUsage().rss,
    memHeap: process.memoryUsage().heapUsed,
    cfg,
    inverterData: {},
    tuyaDevices: devices,
    scenes,
    traces: sceneTraceLog,
    notifs,
    dailyRecords: daily,
    history1m: historyPoints.map(mapPower),
    logBuffer,
    inverterFails: 0,
  });

  if (json) {
    process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
  } else {
    process.stdout.write(buildMarkdown(snap));
  }
}

main();
