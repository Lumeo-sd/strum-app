export function createServerState(ctx) {
  const {
    log, path, fs, exec, __dirname,
    CERT_FILE, KEY_FILE,
    parseCookies, isSessionValid, getSessionCsrf, getSessionUser, sendJson,
    matchRoute, parseBody, rateLimit, getClientIp,
  } = ctx;

  function authMiddleware(req, res) {
    if (req.url === '/' || req.url === '/index.html') return true;
    if (req.url === '/login' || req.url === '/api/login') return true;
    if (req.method === 'POST' && req.url === '/login') return true;
    if (req.url.startsWith('/sw.js') || req.url.startsWith('/manifest.json') || req.url.startsWith('/healthz') || req.url === '/favicon.ico') return true;
    if (req.url.startsWith('/icon-')) return true;
    if (req.url.startsWith('/vendor/') || req.url.startsWith('/lib/')) return true;
    if (req.url.startsWith('/api/metrics')) return true;
    if (req.url === '/api/watchdog-alert') return true;

    const cookies = parseCookies(req);
    const token = cookies['ecm_session'];
    if (token && isSessionValid(token)) {
      if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.url.startsWith('/api/')) {
        if (req.url.startsWith('/api/push/subscribe') || req.url.startsWith('/api/push/unsubscribe')) return true;
        const csrf = getSessionCsrf(token);
        const header = req.headers['x-csrf-token'];
        if (!header || header !== csrf) {
          sendJson(res, 403, { success: false, message: 'CSRF token invalid' });
          return false;
        }
      }
      return true;
    }

    if (req.url.startsWith('/api/')) {
      sendJson(res, 401, { success: false, message: 'Unauthorized' });
      return false;
    }
    res.writeHead(302, { Location: '/login' });
    res.end();
    return false;
  }

  let _cachedLoginHtml = null, _cachedLoginMtime = 0;
  function getLoginPage() {
    const p = path.join(__dirname, 'public', 'login.html');
    try { const st = fs.statSync(p); if (st.mtimeMs > _cachedLoginMtime) { _cachedLoginHtml = null; _cachedLoginMtime = st.mtimeMs; } } catch {}
    if (_cachedLoginHtml) return _cachedLoginHtml;
    try { _cachedLoginHtml = fs.readFileSync(p, 'utf8'); } catch { _cachedLoginHtml = '<html><body><h1>Login not found</h1></body></html>'; }
    return _cachedLoginHtml;
  }

  let _cachedWebUI = null, _cachedWebUIMtime = 0;
  function getWebUI() {
    const p = path.join(__dirname, 'public', 'index.html');
    try { const st = fs.statSync(p); if (st.mtimeMs > _cachedWebUIMtime) { _cachedWebUI = null; _cachedWebUIMtime = st.mtimeMs; } } catch {}
    if (_cachedWebUI) return _cachedWebUI;
    try { _cachedWebUI = fs.readFileSync(p, 'utf8'); } catch { _cachedWebUI = '<html><body><h1>App not found</h1></body></html>'; }
    return _cachedWebUI;
  }

  function createRequestHandler() {
    return async (req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      const staticFiles = { '/tokens.css': 'text/css', '/style.css': 'text/css', '/app.js': 'application/javascript', '/login.css': 'text/css', '/login.js': 'application/javascript', '/icon.svg': 'image/svg+xml' };
      if (staticFiles[req.url]) {
        const fpath = path.join(__dirname, 'public', req.url);
        try {
          const data = fs.readFileSync(fpath);
          res.writeHead(200, { 'Content-Type': staticFiles[req.url], 'Cache-Control': 'public, max-age=0, must-revalidate' });
          return res.end(data);
        } catch { /* fall through */ }
      }

      try {
        const url = new URL(req.url, 'http://localhost');
        const urlPath = url.pathname;

        if (!authMiddleware(req, res)) return;

        if (urlPath.startsWith('/api/')) {
          const ip = getClientIp(req);
          // Для авторизованих запитів ліміт прив'язаний до користувача,
          // для анонімних — до IP.
          const cookies = parseCookies(req);
          const token = cookies['ecm_session'];
          const user = token && isSessionValid(token) ? getSessionUser(token) : null;
          if (!rateLimit(ip, user)) {
            sendJson(res, 429, { success: false, message: 'Rate limit exceeded. Please slow down.' });
            return;
          }
        }

        if (urlPath === '/favicon.ico') {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2A2E"/><stop offset="1" stop-color="#151518"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#g)"/><path d="M58,10 L30,56 L47,56 L42,90 L72,42 L54,42 Z" fill="#F59A0A"/></svg>';
          res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
          return res.end(svg);
        }

        if (urlPath.startsWith('/icon-')) {
          const match = urlPath.match(/\/icon-(\d+)\.png/);
          const size = match ? parseInt(match[1]) : 192;
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2A2E"/><stop offset="1" stop-color="#151518"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#g)"/><path d="M58,10 L30,56 L47,56 L42,90 L72,42 L54,42 Z" fill="#F59A0A"/></svg>';
          res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=0, must-revalidate' });
          return res.end(svg);
        }

        const matched = matchRoute(req.method, urlPath); if (matched) {
          req.params = matched.params;
          req.body = {};
          if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
            req.body = await parseBody(req);
          }
          await matched.handler(req, res);
          return;
        }

        if (urlPath.startsWith('/lib/')) {
          const publicLib = path.join(__dirname, 'public', 'lib');
          const full = path.join(__dirname, 'public', urlPath);
          if (full === publicLib || full.startsWith(publicLib + path.sep)) {
            try {
              const data = fs.readFileSync(full);
              const ext = path.extname(full).toLowerCase();
              const mimes = { '.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon' };
              res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
              res.end(data);
            } catch {
              sendJson(res, 404, { error: 'Not found' });
            }
          } else {
            sendJson(res, 403, { error: 'Forbidden' });
          }
          return;
        }

        sendJson(res, 404, { error: 'Not found' });
      } catch (err) {
        log.error('Request error: ' + err.message);
        sendJson(res, 500, { error: err.message });
      }
    };
  }

  async function ensureCertificates() {
    try {
      if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
        return {
          cert: await fs.promises.readFile(CERT_FILE),
          key: await fs.promises.readFile(KEY_FILE),
        };
      }
      const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_FILE}" -out "${CERT_FILE}" -days 3650 -nodes -subj "/CN=Strum" 2>/dev/null`;
      await new Promise((resolve, reject) => {
        exec(cmd, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await fs.promises.chmod(KEY_FILE, 0o600);
      await fs.promises.chmod(CERT_FILE, 0o600);
      log.info('Self-signed TLS certificate generated');
      return {
        cert: await fs.promises.readFile(CERT_FILE),
        key: await fs.promises.readFile(KEY_FILE),
      };
    } catch (err) {
      log.error('Failed to generate TLS certificate: ' + err.message);
      return null;
    }
  }

  return { authMiddleware, getLoginPage, getWebUI, createRequestHandler, ensureCertificates };
}

