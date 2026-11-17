// Service worker du site : l'app s'ouvre et se lit même sans internet.
// Page : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne. Fichiers de l'app : cache d'abord.
// Les récitations (everyayah.com) et les polices Google passent toujours par le réseau.
const V = 'coran-ae174706-05e538';
// moteur de « Réciter de mémoire » (≈ 22 Mo) : gardé à part, pour ne pas le retélécharger à chaque mise à jour de l'app
const AI = 'ia-e1f06c4f';
// sons des notifications (adhan, Allahu Akbar) : gardés à part eux aussi, pour sonner même sans réseau
const SONS = 'sons-1';
// ancien moteur de l'IA (Whisper, ≈ 125 Mo, 1.14 à 1.20) : effacé pour rendre la place sur le téléphone
const OLD = ['transformers-cache'];
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'data/hafs.z.json', 'fonts/hafs.woff2'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => (k.startsWith('coran-') && k !== V) || (k.startsWith('ia-') && k !== AI) || (k.startsWith('sons-') && k !== SONS) || OLD.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Pages et moteur de l'IA servis « isolés » (Cross-Origin-Opener/Embedder-Policy) : l'IA peut alors calculer sur plusieurs cœurs.
// Les sons d'everyayah sont alors demandés en CORS (ils le permettent) ; tout le reste vient du site ou passe en CORS.
const coi = (r) => {
  if (!r || !r.ok || r.type === 'opaque' || r.type === 'opaqueredirect' || r.redirected) return r;
  const h = new Headers(r.headers); h.set('Cross-Origin-Embedder-Policy', 'require-corp'); h.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
};
self.addEventListener('fetch', (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || req.headers.has('range')) return;
  if (u.pathname.includes('/ia-modele/')) return; // le modèle de l'IA (19 Mo) : le travailleur le télécharge, le vérifie et le garde lui-même (cache « modele-ia-1 »)
  if (u.pathname.includes('/ai/')) {
    e.respondWith(caches.open(AI).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => { if (r.ok && r.status === 200) c.put(req, r.clone()); return r; }))).then(coi));
    return;
  }
  if (u.pathname.includes('/sons/')) {
    e.respondWith(caches.open(SONS).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => { if (r.ok && r.status === 200) c.put(req, r.clone()); return r; }))));
    return;
  }
  const page = req.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('/index.html');
  if (page) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ca) => ca.put('index.html', c)); } return r; })
      .catch(() => caches.match('index.html').then((r) => r || caches.match('./'))).then(coi));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.status === 200 && r.type === 'basic') { const c = r.clone(); caches.open(V).then((ca) => ca.put(req, c)); }
    return r;
  })));
});

// Notifications : rappels d'un ami (« rappel »), alertes de prière (« priere ») et rappel de lecture (« lecture ») ;
// le texte est vérifié, la page ouverte est toujours celle de l'app.
// Son : l'iPhone joue son propre son (une web app ne peut pas en choisir un autre), ou aucun avec « Sans son ».
// Si l'app est ouverte, elle joue elle-même le son choisi (adhan, Allahu Akbar, cloche) : la notification ne sonne pas en plus.
const PR = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  if (!d || typeof d !== 'object') d = {};
  const tag = d.tag === 'priere' || d.tag === 'lecture' ? d.tag : 'rappel';
  const k = tag === 'priere' && PR.includes(d.k) ? d.k : '';
  const title = typeof d.title === 'string' && d.title ? d.title.slice(0, 60) : 'Coran for Malak';
  const body = typeof d.body === 'string' && d.body ? d.body.slice(0, 160) : tag === 'priere' ? 'C’est l’heure de la prière 🕌' : tag === 'lecture' ? '📖 C’est le moment de ta lecture du jour.' : 'Un ami te rappelle de lire le Coran aujourd’hui 💛';
  e.waitUntil((async () => {
    let pf = {};
    try { const r = await (await caches.open('notif-prefs')).match('prefs.json'); if (r) pf = await r.json(); } catch (x) { pf = {}; }
    const snd = tag === 'priere' ? pf.sp : tag === 'lecture' ? pf.sl : '';
    let wins = []; try { wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch (x) { wins = []; }
    const own = (snd === 'adhan' || snd === 'takbir' || snd === 'cloche') && wins.some((c) => c.visibilityState === 'visible');
    const silent = snd === 'muet' || own;
    await self.registration.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag, renotify: !silent, silent });
    for (const c of wins) { try { c.postMessage({ t: 'notif', tag, k, body }); } catch (x) {} } // l'app ouverte réagit tout de suite (son, encouragement affiché)
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const t = e.notification.tag, url = new URL(t === 'priere' ? './#prieres' : t === 'lecture' ? './#lecture' : './#rappels', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.registration.scope)) { try { await c.navigate(url); } catch (x) {} return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
