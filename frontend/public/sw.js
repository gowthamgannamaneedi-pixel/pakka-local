// Caches only static, non-sensitive assets. API traffic and tokens are never cached.
const V = 'pl-static-v8';
const SHELL = ['/assets/logo.png', '/assets/icon-192.png', '/assets/icon-512.png', '/shared/pl.css', '/shared/pl.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (/^\/(assets|shared)\//.test(u.pathname)) e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); return r; })));
  else if (e.request.mode === 'navigate') e.respondWith(fetch(e.request).catch(() => caches.match('/assets/logo.png').then(() => new Response('<meta name=viewport content="width=device-width"><body style="font:18px sans-serif;text-align:center;padding:40px">You are offline. Reconnect to use Pakka Local.', { headers: { 'Content-Type': 'text/html' } }))));
});

// ---------- Web Push (server-triggered; the SW is woken by the browser, never kept alive by us) ----------
const portalOf = (u) => new URL(u, self.location.origin).pathname.split('/')[1];
self.addEventListener('push', (e) => {
  let d; try { d = e.data.json(); } catch { return; }
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = cs.filter((c) => c.visibilityState === 'visible' && portalOf(c.url) === portalOf(d.url || '/'));
    if (open.length && d.kind !== 'promo' && d.kind !== 'test') { open.forEach((c) => c.postMessage({ type: 'push', nid: d.nid })); return; }   // the in-app popup + sound already handle it
    await self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', image: d.image, data: d,
      requireInteraction: !!d.urgent, renotify: !!d.urgent, vibrate: d.urgent ? [300, 120, 300, 120, 300] : [120] });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close(); const d = e.notification.data || {};
  e.waitUntil((async () => {
    try { await fetch(d.click || '/api/push/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nid: d.nid, t: d.t }), keepalive: true }); } catch {}
    const url = new URL(d.url || '/', self.location.origin), seg = url.pathname.split('/').filter(Boolean);
    const path = url.hash.startsWith('#/') ? url.hash.slice(1) : seg.length > 1 ? '/' + seg.slice(1).join('/') : null;
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); const c = cs.find((x) => portalOf(x.url) === seg[0]);
    if (c) { await c.focus(); if (path) c.postMessage({ type: 'goto', path }); return; }
    await self.clients.openWindow(url.href);
  })());
});
