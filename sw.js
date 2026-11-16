// sw.js — service worker: mette in cache le risorse statiche (app shell) per l'uso offline.
// Tutti i percorsi sono RELATIVI al file sw.js, quindi valgono sia in radice (Vercel) sia nel
// sottopercorso di GitHub Pages (https://utente.github.io/mini-sheet-pwa/).
// Quando modifichi un file dell'app, incrementa CACHE per invalidare la cache vecchia.
const CACHE = 'mini-sheet-v1';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/style.css', './vendor/bootstrap.min.css',
  './js/app.js', './js/engine.js', './js/coordinates.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

// Installazione: precarica tutto l'app shell.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

// Attivazione: elimina le cache di versioni precedenti e prende il controllo delle pagine aperte.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: strategia "cache first" per le richieste GET della stessa origine; se manca in cache
// va in rete e salva la copia. In offline, le navigazioni ricadono su index.html.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
