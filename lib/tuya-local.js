import crypto from "node:crypto";
import net from "node:net";
import { log } from "./logger.js";

const PREFIX_6699 = Buffer.from([0x00, 0x00, 0x66, 0x99]);
const SUFFIX_6699 = Buffer.from([0x00, 0x00, 0x99, 0x66]);
const PROTOCOL_35_HEADER = Buffer.concat([Buffer.from("3.5"), Buffer.alloc(12)]);
const PORT = 6668;
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 5000;
const CONNECT_RETRIES = 3;
const QUERY_RETRIES = 2;
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 10000;
const KEEPER_IDLE_MS = 5000;
const FAKE_IT_TIMEOUT_MS = 5000;
const DEBOUNCE_MS = 1000;
const FAILURE_ESCALATION_COUNT = 10;
const BENIGN_RETCODES = new Set([900, 904]);

const CMD = {
  SESS_START: 0x03,
  SESS_RESP: 0x04,
  SESS_FINISH: 0x05,
  HEARTBEAT: 0x09,
  DP_QUERY_NEW: 0x10,
  CONTROL: 0x07,
  CONTROL_NEW: 0x0D,
};

function buildFrame(seqno, cmd, plaintext, key) {
  const iv = crypto.randomBytes(12);
  const length = 12 + plaintext.length + 16;
  const header = Buffer.alloc(18);
  header.writeUInt32BE(0x00006699, 0);
  header.writeUInt16BE(0, 4);
  header.writeUInt32BE(seqno, 6);
  header.writeUInt32BE(cmd, 10);
  header.writeUInt32BE(length, 14);
  const aad = header.subarray(4, 18);
  const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([header, iv, ciphertext, tag, SUFFIX_6699]);
}

function parseFrame(data, key) {
  if (data.length < 22) return null;
  if (data.subarray(0, 4).compare(PREFIX_6699) !== 0) return null;
  const length = data.readUInt32BE(14);
  const expectedTotal = 18 + length + 4;
  if (data.length < expectedTotal) return null;
  if (data.subarray(expectedTotal - 4, expectedTotal).compare(SUFFIX_6699) !== 0) return null;
  const iv = data.subarray(18, 30);
  const tagStart = expectedTotal - 4 - 16;
  const ciphertext = data.subarray(30, tagStart);
  const tag = data.subarray(tagStart, tagStart + 16);
  const aad = data.subarray(4, 18);
  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(aad);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const seqno = data.readUInt32BE(6);
  const cmd = data.readUInt32BE(10);
  const retcode = plaintext.length >= 4 ? plaintext.readUInt32BE(0) : null;
  return { seqno, cmd, retcode, payload: plaintext.length >= 4 ? plaintext.subarray(4) : plaintext, totalLength: expectedTotal };
}

function recvExact(sock, n, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (sock._rxBuf && sock._rxBuf.length >= n) {
      const result = Buffer.alloc(n);
      sock._rxBuf.copy(result, 0, 0, n);
      sock._rxBuf = sock._rxBuf.length > n ? Buffer.from(sock._rxBuf.subarray(n)) : null;
      resolve(result);
      return;
    }
    const buf = Buffer.alloc(n);
    let offset = 0;
    if (sock._rxBuf && sock._rxBuf.length > 0) {
      const toCopy = Math.min(sock._rxBuf.length, n);
      sock._rxBuf.copy(buf, 0, 0, toCopy);
      offset = toCopy;
      sock._rxBuf = sock._rxBuf.length > n ? Buffer.from(sock._rxBuf.subarray(n)) : null;
      if (offset === n) { resolve(buf); return; }
    }
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      sock.removeListener("data", onData);
      sock.removeListener("error", onErr);
      sock.removeListener("close", onClose);
      sock.removeListener("end", onEnd);
    };
    const onData = (chunk) => {
      const needed = n - offset;
      const toCopy = Math.min(chunk.length, needed);
      chunk.copy(buf, offset, 0, toCopy);
      offset += toCopy;
      if (chunk.length > toCopy) {
        const excess = Buffer.from(chunk.subarray(toCopy));
        sock._rxBuf = sock._rxBuf ? Buffer.concat([sock._rxBuf, excess]) : excess;
      }
      if (offset === n) { cleanup(); resolve(buf); }
    };
    const onErr = (err) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); reject(new Error("Connection closed")); };
    const onEnd = () => { cleanup(); reject(new Error("Connection ended")); };
    sock.on("data", onData);
    sock.on("error", onErr);
    sock.on("close", onClose);
    sock.on("end", onEnd);
    if (timeoutMs > 0) {
      timer = setTimeout(() => { cleanup(); reject(new Error("Receive timeout")); }, timeoutMs);
    }
  });
}

async function recvFrame(sock, key, timeoutMs = TIMEOUT_MS) {
  const header = await recvExact(sock, 18, timeoutMs);
  const length = header.readUInt32BE(14);
  const bodyLen = length + 4;
  const body = await recvExact(sock, bodyLen, timeoutMs);
  return parseFrame(Buffer.concat([header, body]), key);
}

async function handshake(sock, localKey) {
  const t0 = Date.now();
  const clientNonce = crypto.randomBytes(16);
  const frame1 = buildFrame(1, CMD.SESS_START, clientNonce, localKey);
  sock.write(frame1);
  const resp = await recvFrame(sock, localKey);
  if (resp.cmd !== CMD.SESS_RESP) {
    throw new Error("Expected SESS_RESP, got cmd=0x" + resp.cmd.toString(16));
  }
  const deviceNonce = resp.payload.subarray(0, 16);
  const receivedHmac = resp.payload.subarray(16, 48);
  const expectedHmac = crypto.createHmac("sha256", localKey).update(clientNonce).digest();
  if (!receivedHmac.equals(expectedHmac)) {
    throw new Error("HMAC verification failed in handshake step 2");
  }
  const sendHmac = crypto.createHmac("sha256", localKey).update(deviceNonce).digest();
  const frame3 = buildFrame(2, CMD.SESS_FINISH, sendHmac, localKey);
  sock.write(frame3);
  const tmp = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) tmp[i] = deviceNonce[i] ^ clientNonce[i];
  const cipher = crypto.createCipheriv("aes-128-gcm", localKey, clientNonce.subarray(0, 12));
  const ct = cipher.update(tmp);
  cipher.final();
  const sessionKey = Buffer.from(ct);
  log.debug(`Handshake OK (${Date.now() - t0}ms)`);
  return sessionKey;
}

function parseDpsFromPayload(payload) {
  let p = payload;
  if (p.length > 15 && p.subarray(0, 3).toString() === "3.5") p = p.subarray(15);
  const s = p.toString("utf8").replace(/\x00+$/, "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(s.slice(first, last + 1)); } catch { return null; }
}

const deviceInstances = new Map();

export function getLocalDevice(device) {
  if (!device.ip || !device.localKey) return null;

  const cached = deviceInstances.get(device.id);
  if (cached) return cached;

  const keyBuffer = Buffer.from(device.localKey);
  if (keyBuffer.length !== 16) return null;

  let sock = null;
  let sessionKey = null;
  let seqno = 0;
  let connected = false;
  let connecting = null;
  let running = false;
  let keeperTask = null;
  let hbTimer = null;
  let pushBuf = null;
  let pushInstalled = false;
  let pushCallback = null;
  let cmdChain = Promise.resolve();

  const stateCache = { dps: {}, updatedAt: 0 };
  let pendingUpdates = {};
  let flushTimer = null;
  let flushPromise = null;
  let flushResolve = null;
  let flushReject = null;
  let lastSendAt = 0;
  let maxSimultaneousDps = 0;
  let consecutiveFailures = 0;

  function nextSeq() { return ++seqno; }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function errorHint(msg) {
    if (/handshake|HMAC|session|connect|timeout/i.test(msg || "")) {
      return " — if previously working, the device may need to be power cycled";
    }
    return "";
  }

  function recordFailure(msg) {
    consecutiveFailures++;
    if (consecutiveFailures === 1) {
      log.warn(msg + errorHint(msg));
    } else if (consecutiveFailures === FAILURE_ESCALATION_COUNT) {
      log.error(msg + " (repeated failures: " + consecutiveFailures + ")" + errorHint(msg));
    } else {
      log.debug(msg);
    }
  }

  function pendingOverlay() {
    const now = Date.now();
    const out = {};
    for (const [id, p] of Object.entries(pendingUpdates)) {
      if (now - p.updatedAt <= FAKE_IT_TIMEOUT_MS) out[id] = p.value;
    }
    return out;
  }

  function cacheSnapshot() {
    return { ...stateCache.dps, ...pendingOverlay() };
  }

  function confirmPending(dps) {
    const now = Date.now();
    for (const [id, p] of Object.entries(pendingUpdates)) {
      if (p.sent && Object.prototype.hasOwnProperty.call(dps, id) && dps[id] === p.value) {
        delete pendingUpdates[id];
      } else if (now - p.updatedAt > FAKE_IT_TIMEOUT_MS) {
        delete pendingUpdates[id];
      }
    }
  }

  function buildControlBody(dps) {
    return JSON.stringify({ protocol: 5, t: Math.floor(Date.now() / 1000), data: { dps } });
  }

  function closeSock(reason) {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    if (sock) {
      log.debug(`close ${device.id}${reason ? " (" + reason + ")" : ""}`);
      try {
        sock.removeAllListeners();
        sock.on("error", () => {});
        sock.destroy();
      } catch {}
    }
    sock = null;
    sessionKey = null;
    connected = false;
    pushInstalled = false;
    pushBuf = null;
  }

  function installPush(s) {
    if (!s) return;
    if (!pushInstalled) {
      s.on("data", onPushData);
      pushInstalled = true;
      if (s._rxBuf && s._rxBuf.length > 0) {
        onPushData(Buffer.from(s._rxBuf));
        s._rxBuf = null;
      }
    }
  }

  function onPushData(chunk) {
    pushBuf = pushBuf ? Buffer.concat([pushBuf, chunk]) : chunk;
    while (pushBuf && pushBuf.length >= 22) {
      let frame;
      try {
        frame = parseFrame(pushBuf, sessionKey);
      } catch (err) {
        log.warn('Push parse error for ' + device.id + ': ' + err.message + ', resetting connection');
        closeSock('push_parse_error');
        pushBuf = null;
        return;
      }
      if (!frame) break;
      pushBuf = pushBuf.length > frame.totalLength ? Buffer.from(pushBuf.subarray(frame.totalLength)) : null;
      try {
        const parsed = parseDpsFromPayload(frame.payload);
        if (parsed && parsed.dps) {
          Object.assign(stateCache.dps, parsed.dps);
          stateCache.updatedAt = Date.now();
          confirmPending(parsed.dps);
          if (pushCallback) pushCallback(parsed.dps, false);
        }
      } catch {}
    }
    if (pushBuf && pushBuf.length === 0) pushBuf = null;
  }

  function doConnect() {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      log.debug(`connect ${device.id} (${device.ip}):${PORT}...`);
      const s = net.createConnection({ host: device.ip, port: PORT });
      let settled = false;

      const swallowError = () => {};

      const finish = (err) => {
        if (settled) return;
        settled = true;
        s.removeListener("connect", onConnect);
        s.removeListener("timeout", onTimeout);
        s.removeListener("error", onError);
        s.on("error", swallowError);
        if (err) {
          s.destroy();
          reject(err);
        } else {
          resolve();
        }
      };

      function onConnect() {
        (async () => {
          sock = s;
          try {
            const t1 = Date.now();
            sessionKey = await handshake(s, keyBuffer);
            log.event({ type: "tuya_connect", deviceId: device.id, deviceName: device.name, ip: device.ip, event: "connected", tcpMs: t1 - t0, handshakeMs: Date.now() - t1, success: true });
            seqno = 2;
            connected = true;
            consecutiveFailures = 0;
            s.setKeepAlive(true, 10000);
            s.setTimeout(0);
            installPush(s);
            startHeartbeat();
            finish();
          } catch (err) {
            log.event({ type: "tuya_connect", deviceId: device.id, deviceName: device.name, ip: device.ip, event: "handshake_fail", tcpMs: Date.now() - t0, error: err.message, success: false });
            finish(err);
          }
        })();
      }

      function onTimeout() {
        log.event({ type: "tuya_connect", deviceId: device.id, deviceName: device.name, ip: device.ip, event: "timeout", elapsedMs: Date.now() - t0, success: false });
        finish(new Error("TCP connect timeout"));
      }

      function onError(err) {
        log.event({ type: "tuya_connect", deviceId: device.id, deviceName: device.name, ip: device.ip, event: "error", elapsedMs: Date.now() - t0, error: err.message, success: false });
        finish(err);
      }

      s.on("connect", onConnect);
      s.on("timeout", onTimeout);
      s.on("error", onError);
      if (TIMEOUT_MS > 0) s.setTimeout(TIMEOUT_MS);
    });
  }

  async function ensureConnected() {
    if (connected && sock && !sock.destroyed) return;
    if (connecting) return connecting;
    closeSock("reconnect");
    connecting = doConnect().catch(() => {}).finally(() => { connecting = null; });
    return connecting;
  }

  function startHeartbeat() {
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = setInterval(() => {
      if (!connected || !sock || !sessionKey) return;
      try {
        const frame = buildFrame(nextSeq(), CMD.HEARTBEAT, Buffer.alloc(0), sessionKey);
        sock.write(frame);
      } catch {}
    }, HEARTBEAT_INTERVAL_MS);
    hbTimer.unref();
  }

  function settleFlush(err) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (flushPromise) {
      const p = flushPromise;
      flushPromise = null;
      if (err) flushReject(err);
      else flushResolve(true);
    }
  }

  function schedulePendingFlush() {
    if (flushTimer) return flushPromise;
    const since = Date.now() - lastSendAt;
    const delay = since < DEBOUNCE_MS ? DEBOUNCE_MS - since : 0;
    flushPromise = new Promise((resolve, reject) => {
      flushResolve = resolve;
      flushReject = reject;
    });
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      const res = flushResolve;
      const rej = flushReject;
      flushPromise = null;
      try {
        await enqueue(sendPending);
        res(true);
      } catch (err) {
        log.error(`setDPs ${device.id}: control failed: ${err.message}`);
        rej(err);
      }
    }, delay);
    if (flushTimer.unref) flushTimer.unref();
    return flushPromise;
  }

  async function sendPending() {
    const now = Date.now();
    for (const [id, p] of Object.entries(pendingUpdates)) {
      if (now - p.updatedAt > FAKE_IT_TIMEOUT_MS) delete pendingUpdates[id];
    }
    const entries = Object.entries(pendingUpdates).filter(([, p]) => !p.sent);
    if (!entries.length) return true;
    try {
      if (maxSimultaneousDps > 0 && entries.length > maxSimultaneousDps) {
        for (const [id, p] of entries) {
          await sendControl(buildControlBody({ [id]: p.value }), [[id, p]]);
        }
      } else {
        await sendControl(
          buildControlBody(Object.fromEntries(entries.map(([id, p]) => [id, p.value]))),
          entries
        );
      }
      return true;
    } catch (err) {
      for (const [id] of entries) delete pendingUpdates[id];
      throw err;
    }
  }

  async function sendControl(body, entries) {
    const desc = entries.map(([id, p]) => "dp" + id + "=" + p.value).join(", ");
    for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
      try {
        await ensureConnected();
        const plaintext = Buffer.concat([PROTOCOL_35_HEADER, Buffer.from(body)]);
        const frame = buildFrame(nextSeq(), CMD.CONTROL_NEW, plaintext, sessionKey);
        await new Promise((resolve, reject) => {
          sock.write(frame, (err) => { if (err) reject(err); else resolve(); });
        });
        lastSendAt = Date.now();
        for (const [id, p] of entries) { p.sent = true; p.updatedAt = lastSendAt; }
        consecutiveFailures = 0;
        log.debug(`setDPs ${device.id}: ${desc} sent`);
        return true;
      } catch (err) {
        closeSock("control_retry_" + attempt);
        recordFailure(`setDPs ${device.id}: ${desc} attempt ${attempt}/${CONNECT_RETRIES} failed: ${err.message}`);
        if (attempt < CONNECT_RETRIES) {
          await sleep(1000);
        }
      }
    }
    if (entries.length > 1) {
      maxSimultaneousDps = 1;
      log.warn(`setDPs ${device.id}: multi-DP control failed — device may not support batched control, falling back to per-DP`);
      for (const [id, p] of entries) {
        await sendControl(buildControlBody({ [id]: p.value }), [[id, p]]);
      }
      return true;
    }
    throw new Error("Control failed after " + CONNECT_RETRIES + " attempts");
  }

  async function sendCommand(cmd, payload, prependHeader = false) {
    await ensureConnected();
    if (!sock || !sessionKey) throw new Error("Not connected");
    let plaintext = payload;
    if (prependHeader) {
      plaintext = Buffer.concat([PROTOCOL_35_HEADER, payload]);
    }
    const t0_ = Date.now();
    const frame = buildFrame(nextSeq(), cmd, plaintext, sessionKey);
    sock.write(frame);
    try {
      const resp = await recvFrame(sock, sessionKey, TIMEOUT_MS);
      log.debug(`sendCommand ${device.id}: cmd=0x${cmd.toString(16)} retcode=${resp.retcode} latency=${Date.now() - t0_}ms`);
      return resp;
    } catch (err) {
      closeSock("send_error: " + err.message);
      throw err;
    }
  }

  function enqueue(fn) {
    const p = cmdChain.then(() => fn(), () => fn());
    cmdChain = p.catch(() => {});
    return p;
  }

  async function executeQuery() {
    const resp = await sendCommand(CMD.DP_QUERY_NEW, Buffer.from("{}"));
    if (resp.retcode !== 0) {
      if (BENIGN_RETCODES.has(resp.retcode)) {
        log.debug(`query ${device.id}: benign retcode ${resp.retcode}, device reachable without data`);
        stateCache.updatedAt = Date.now();
        return { dps: {} };
      }
      throw new Error("Query failed retcode=" + resp.retcode);
    }
    const parsed = parseDpsFromPayload(resp.payload);
    if (!parsed || !parsed.dps) throw new Error("Invalid query response");
    Object.assign(stateCache.dps, parsed.dps);
    stateCache.updatedAt = Date.now();
    confirmPending(parsed.dps);
    consecutiveFailures = 0;
    return parsed;
  }

  async function keeperLoop() {
    running = true;
    let backoff = BACKOFF_INITIAL_MS;
    while (running) {
      try {
        await ensureConnected();
        if (connected) {
          backoff = BACKOFF_INITIAL_MS;
          const age = Date.now() - stateCache.updatedAt;
          if (age > CACHE_TTL_MS) {
            await executeQuery();
          }
        }
        await sleep(KEEPER_IDLE_MS);
      } catch (err) {
        recordFailure(`keeper ${device.id}: ${err.message}`);
        closeSock("keeper_retry");
        await sleep(backoff);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      }
    }
  }

  function startKeeper() {
    if (!keeperTask) {
      keeperTask = keeperLoop();
    }
  }

  function stopKeeper() {
    running = false;
    keeperTask = null;
  }

  const instance = {
    async queryAll() {
      return enqueue(async () => {
        const age = Date.now() - stateCache.updatedAt;
        if (age < CACHE_TTL_MS && Object.keys(stateCache.dps).length > 0) {
          return { dps: cacheSnapshot() };
        }
        let lastErr;
        for (let attempt = 1; attempt <= QUERY_RETRIES; attempt++) {
          try {
            const result = await executeQuery();
            if (attempt > 1) {
              log.debug(`queryAll ${device.id}: succeeded on attempt ${attempt}`);
            }
            return { dps: { ...result.dps, ...pendingOverlay() } };
          } catch (err) {
            lastErr = err;
            recordFailure(`queryAll ${device.id}: attempt ${attempt}/${QUERY_RETRIES} failed: ${err.message}`);
            if (attempt < QUERY_RETRIES) {
              await sleep(1000);
            }
          }
        }
        if (Object.keys(stateCache.dps).length > 0) {
          stateCache.updatedAt = 0;
          log.warn(`Local query failed for ${device.name}, using stale cache`);
          return { dps: cacheSnapshot() };
        }
        throw lastErr;
      });
    },

    async setDPs(dps) {
      const now = Date.now();
      for (const [id, value] of Object.entries(dps)) {
        if (Object.prototype.hasOwnProperty.call(pendingUpdates, id)) {
          if (pendingUpdates[id].value !== value) {
            pendingUpdates[id].value = value;
            pendingUpdates[id].sent = false;
          }
          pendingUpdates[id].updatedAt = now;
        } else {
          pendingUpdates[id] = { value, sent: false, updatedAt: now };
        }
      }
      return schedulePendingFlush();
    },

    async setDP(dpId, value) {
      return instance.setDPs({ [dpId]: value });
    },

    get connected() { return connected; },

    onPush(cb) {
      pushCallback = cb;
      startKeeper();
    },

    disconnect() {
      stopKeeper();
      settleFlush(new Error("disconnected"));
      pendingUpdates = {};
      closeSock("disconnect");
    },

    destroy() {
      stopKeeper();
      settleFlush(new Error("destroyed"));
      pendingUpdates = {};
      closeSock("destroy");
      deviceInstances.delete(device.id);
    },
  };

  startKeeper();
  deviceInstances.set(device.id, instance);
  return instance;
}

export function removeLocalDevice(deviceId) {
  const inst = deviceInstances.get(deviceId);
  if (inst) { inst.destroy(); }
}
