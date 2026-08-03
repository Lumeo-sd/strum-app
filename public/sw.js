const CACHE = 'ecm-v6';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.destination === 'document') return;
  if (e.request.destination === 'script' || e.request.url.endsWith('.js')) return;
  e.respondWith(fetch(e.request).then(resp => {
    if (resp.ok && e.request.method === 'GET') { const c = resp.clone(); caches.open(CACHE).then(cache => cache.put(e.request, c)); }
    return resp;
  }).catch(() => caches.match(e.request)));
});

async function onPush(e) {
  try {
    let data = null;
    try { data = e.data ? await e.data.json() : null; } catch (err) {}
    let unread = 0;
    let latest = null;
    if (data && data.web_push === 8030 && data.notification) {
      unread = parseInt(data.app_badge !== undefined ? data.app_badge : data.notification.app_badge, 10) || 0;
      latest = { title: data.notification.title, message: data.notification.body, type: 'push' };
    }
    if (latest === null) {
      try {
        const resp = await fetch('/api/notifications', { credentials: 'same-origin', cache: 'no-store' });
        if (resp.ok) {
          const d = await resp.json();
          unread = (d && d.unread) || 0;
          const list = d && d.notifications || [];
          latest = list[0] || null;
        }
      } catch (e) {}
    }
    if (typeof navigator.setAppBadge === 'function') {
      try {
        if (unread > 0) await navigator.setAppBadge(Math.min(unread, 99));
        else await navigator.clearAppBadge();
      } catch (e) {}
    }
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length) {
      clients.forEach(c => c.postMessage({ type: 'push-update' }));
    }
    if (!clients.length && unread > 0 && latest && latest.type !== 'info') {
      await self.registration.showNotification(latest.title || 'Strum', {
        body: latest.message || '',
        tag: 'strum-push',
        icon: '/icon-192.png',
        data: { url: '/' },
        renotify: true,
      });
    }
  } catch (e) {}
}
self.addEventListener('push', e => { e.waitUntil(onPush()); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    try {
      const target = (e.notification.data && e.notification.data.url) || '/';
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) { if (w.visibilityState === 'visible') { await w.focus(); return; } }
      if (wins[0]) { await wins[0].focus(); return; }
      await self.clients.openWindow(target);
    } catch (e) {}
  })());
});

self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }) });
      }
    } catch (e) {}
  })());
});
