export function createCycleDetector(opts = {}) {
  const defaults = { startWatts: opts.startWatts ?? 3, minDuration: opts.minDuration ?? 15 * 60000, settle: opts.settle ?? 5 * 60000 };
  const devices = new Map();

  function ensure(id) {
    let d = devices.get(id);
    if (!d) {
      d = { cfg: null, phase: 'idle', startTs: 0, lowSince: 0, lastPower: 0, lastSampleTs: 0, pending: null };
      devices.set(id, d);
    }
    return d;
  }

  function cfg(d) {
    return d.cfg ? { ...defaults, ...d.cfg } : defaults;
  }

  function setConfig(id, c) {
    ensure(id).cfg = { ...defaults, ...c };
  }

  function onSample(id, powerW, now = Date.now()) {
    const d = ensure(id);
    const c = cfg(d);
    d.lastPower = powerW;
    d.lastSampleTs = now;
    if (d.phase === 'idle' && powerW > c.startWatts) {
      d.phase = 'running';
      d.startTs = now;
      d.lowSince = 0;
    } else if (d.phase === 'running') {
      if (powerW <= c.startWatts && !d.lowSince) d.lowSince = now;
      else if (powerW > c.startWatts) d.lowSince = 0;
    }
  }

  function checkNow(now = Date.now()) {
    for (const [id, d] of devices) {
      if (d.phase !== 'running') continue;
      const c = cfg(d);
      if (!d.lowSince && d.lastPower <= c.startWatts) d.lowSince = d.lastSampleTs;
      if (!d.lowSince || now - d.lowSince < c.settle) continue;
      const elapsed = now - d.startTs;
      if (elapsed >= c.minDuration) d.pending = { minutes: Math.round(elapsed / 60000), startedAt: d.startTs };
      d.phase = 'idle';
      d.startTs = 0;
      d.lowSince = 0;
    }
  }

  function consume(id) {
    const d = devices.get(id);
    if (!d || !d.pending) return null;
    const ev = d.pending;
    d.pending = null;
    return ev;
  }

  function takeEvents() {
    const out = [];
    for (const [id, d] of devices) {
      if (d.pending) {
        out.push([id, d.pending]);
        d.pending = null;
      }
    }
    return out;
  }

  return { onSample, checkNow, consume, takeEvents, setConfig };
}