import fs from 'node:fs';
import path from 'node:path';

function countLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const raw = fs.readFileSync(filePath, 'utf8');
    let n = 0;
    for (const line of raw.split('\n')) if (line.trim()) n++;
    return n;
  } catch {
    return 0;
  }
}

function readAll(np) {
  try {
    if (!fs.existsSync(np)) return [];
    const raw = fs.readFileSync(np, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch { continue; }
    }
    return out;
  } catch {
    return [];
  }
}

export function createSceneTraceLog(filePath, opts) {
  opts = opts || {};
  const maxLines = opts.maxLines || 2000;
  const oldPath = filePath + '.old';

  function rotateIfNeeded() {
    if (countLines(filePath) >= maxLines) {
      fs.rmSync(oldPath, { force: true });
      try {
        fs.renameSync(filePath, oldPath);
      } catch {}
    }
  }

  return {
    append(entry) {
      rotateIfNeeded();
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
    },
    readTail(len) {
      const all = readAll(oldPath).concat(readAll(filePath));
      return all.slice(Math.max(0, all.length - len));
    },
  };
}
