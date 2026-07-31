import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Атомарний запис файлів: спершу тимчасовий файл у тій самій директорії,
// потім rename (atomic на POSIX). Захищає від пошкодження даних при
// конкурентних записах або падінні процесу посеред запису.

function tmpName(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  return path.join(dir, '.' + base + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp');
}

function cleanupSync(tmp) {
  try { fs.unlinkSync(tmp); } catch {}
}

export function atomicWriteFileSync(file, data, opts = {}) {
  const tmp = tmpName(file);
  try {
    fs.writeFileSync(tmp, data, { mode: opts.mode || 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    cleanupSync(tmp);
    throw err;
  }
}

export async function atomicWriteFile(file, data, opts = {}) {
  const tmp = tmpName(file);
  try {
    await fs.promises.writeFile(tmp, data, { mode: opts.mode || 0o600 });
    await fs.promises.rename(tmp, file);
  } catch (err) {
    try { await fs.promises.unlink(tmp); } catch {}
    throw err;
  }
}

export function atomicWriteJsonSync(file, obj, opts = {}) {
  atomicWriteFileSync(file, JSON.stringify(obj, null, 2), opts);
}

export async function atomicWriteJson(file, obj, opts = {}) {
  await atomicWriteFile(file, JSON.stringify(obj, null, 2), opts);
}
