export function createOverConsumeDetector(cfg = {}) {
  let config = {
    threshold: cfg.threshold ?? 60,
    stabilityMs: cfg.stabilityMs ?? 5 * 60000,
    oncePerOutage: cfg.oncePerOutage ?? true,
  };
  let phase = 'idle';
  let startTs = 0;
  let fired = false;

  function setConfig(c) {
    config = { ...config, ...c };
  }

  function onSample(watts, now = Date.now()) {
    if (config.oncePerOutage && fired) return;
    if (watts > config.threshold) {
      if (phase !== 'stable') {
        phase = 'stable';
        startTs = now;
      }
    } else {
      phase = 'idle';
      startTs = 0;
    }
  }

  function takeEvent(now = Date.now()) {
    if (!config.oncePerOutage) return null;
    if (fired || phase !== 'stable' || now - startTs < config.stabilityMs) return null;
    fired = true;
    return { ts: now, startedAt: startTs };
  }

  function isExceeded(now = Date.now()) {
    if (config.oncePerOutage) return false;
    return phase === 'stable' && now - startTs >= config.stabilityMs;
  }

  function onGridUp() {
    phase = 'idle';
    startTs = 0;
    fired = false;
  }

  return { onSample, takeEvent, isExceeded, onGridUp, setConfig };
}
