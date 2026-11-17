// Service worker : l'appli s'ouvre même sans connexion, avec les dernières données connues.
const CACHE = 'veille-v2.4';
const SHELL = ['./', 'index.html', 'veille.html', 'infos.html', 'reglages.html', 'style.css', 'app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isData = url.pathname.endsWith('/data.json')
    && (url.origin === location.origin || url.hostname === 'raw.githubusercontent.com');
  if (url.origin !== location.origin && !isData) return; // la météo est gérée par l'appli elle-même

  // Données (site ou branche « data ») : réseau d'abord, dernière copie en secours.
  if (isData) {
    e.respondWith(
      fetch(req)
        .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('data.json', copy)); } return r; })
        .catch(() => caches.match('data.json'))
    );
    return;
  }

  // Reste : copie locale tout de suite, mise à jour en arrière-plan.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
