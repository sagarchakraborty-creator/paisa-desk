// Paisa Desk service worker: offline app shell + Android "Share to Paisa Desk" for statement files.
// Bump VERSION on every release, or phones keep the old copy. No financial data is ever cached here.
const VERSION = '2026-11-14.4';
const SHELL = `paisadesk-shell-${VERSION}`;
const FILES = ['./', 'index.html', 'styles.css', 'manifest.json', 'js/app.js', 'js/parse.js', 'js/cibil.js', 'js/cat.js', 'js/store.js', 'js/gmail.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/xlsx.full.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('paisadesk-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Files shared from Gmail / Files / WhatsApp arrive as a POST to ./share. Park them in a cache the app empties on import.
  if (req.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const form = await req.formData();
      const c = await caches.open('paisadesk-share');
      let i = 0;
      for (const f of form.getAll('files')) {
        if (!(f instanceof File)) continue;
        await c.put(new Request(`./__shared/${Date.now()}-${i++}`), new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name) } }));
      }
      return Response.redirect(new URL('./#import', self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  // Network first so updates arrive; cache when offline.
  e.respondWith(fetch(req).then(res => {
    if (res.ok && url.pathname.startsWith(new URL(self.registration.scope).pathname)) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
