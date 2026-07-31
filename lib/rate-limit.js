const rateLimitBuckets = new Map();
const RATE_LIMIT_CAPACITY = 100;
const RATE_LIMIT_REFILL = 10;
const MAX_BUCKETS = 10000;
const BUCKET_TTL_MS = 10 * 60 * 1000;
let lastPrune = Date.now();

function _prune() {
  const now = Date.now();
  if (now - lastPrune < 60000) return;
  lastPrune = now;
  for (const [key, b] of rateLimitBuckets) {
    if (now - b.lastRefill > BUCKET_TTL_MS) rateLimitBuckets.delete(key);
  }
}

function rateLimit(ip, userKey) {
  const key = userKey ? 'u:' + userKey : 'i:' + ip;
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket) {
    if (rateLimitBuckets.size >= MAX_BUCKETS) rateLimitBuckets.clear();
    bucket = { tokens: RATE_LIMIT_CAPACITY, lastRefill: now };
  }
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(RATE_LIMIT_CAPACITY, bucket.tokens + elapsed * RATE_LIMIT_REFILL);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    rateLimitBuckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  rateLimitBuckets.set(key, bucket);
  _prune();
  return true;
}

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function getClientIp(req) {
  const direct = req.socket && req.socket.remoteAddress;
  const xff = req.headers['x-forwarded-for'];
  // Довіряємо X-Forwarded-For лише якщо безпосередній пір — loopback
  // (тобто за нами стоїть локальний reverse-proxy). Інакше клієнт міг би
  // підставити довільний заголовок і обійти ліміт.
  if (isLoopback(direct) && xff) {
    return String(xff).split(',')[0].trim() || direct;
  }
  return direct || 'unknown';
}

export { rateLimit, getClientIp };
