// Service worker du site : l'app s'ouvre et se lit même sans internet.
// Page : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne. Fichiers de l'app : cache d'abord.
// Les récitations (everyayah.com) et les polices Google passent toujours par le réseau.
const V = 'coran-4d792b97-05e538';
// moteur de « Réciter de mémoire » (≈ 22 Mo) : gardé à part, pour ne pas le retélécharger à chaque mise à jour de l'app
const AI = 'ia-630831bb';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'data/hafs.z.json', 'fonts/hafs.woff2'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => (k.startsWith('coran-') && k !== V) || (k.startsWith('ia-') && k !== AI)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || req.headers.has('range')) return;
  if (u.pathname.includes('/ai/')) {
    e.respondWith(caches.open(AI).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => { if (r.ok && r.status === 200) c.put(req, r.clone()); return r; }))));
    return;
  }
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

// Notifications : rappels d'un ami (« rappel ») et alertes de prière (« priere ») ; le texte est vérifié,
// la page ouverte est toujours celle de l'app
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  const tag = d.tag === 'priere' ? 'priere' : 'rappel';
  const title = typeof d.title === 'string' && d.title ? d.title.slice(0, 60) : 'Coran for Malak';
  const body = typeof d.body === 'string' && d.body ? d.body.slice(0, 160) : tag === 'priere' ? 'C’est l’heure de la prière 🕌' : 'Un ami te rappelle de lire le Coran aujourd’hui 💛';
  e.waitUntil(self.registration.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag, renotify: true }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.tag === 'priere' ? './#prieres' : './#rappels', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.registration.scope)) { try { await c.navigate(url); } catch (x) {} return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
