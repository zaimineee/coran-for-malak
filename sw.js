// Service worker du site : l'app s'ouvre et se lit même sans internet.
// Page : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne. Fichiers de l'app : cache d'abord.
// Les récitations (everyayah.com) et les polices Google passent toujours par le réseau.
const V = 'coran-0e52423b-05e538';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'data/hafs.z.json', 'fonts/hafs.woff2'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('coran-') && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || req.headers.has('range')) return;
  const page = req.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('/index.html');
  if (page) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ca) => ca.put('index.html', c)); } return r; })
      .catch(() => caches.match('index.html').then((r) => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.status === 200 && r.type === 'basic') { const c = r.clone(); caches.open(V).then((ca) => ca.put(req, c)); }
    return r;
  })));
});
