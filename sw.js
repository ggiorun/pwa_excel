/**
 * sw.js — Service Worker: rende l'app utilizzabile OFFLINE.
 *
 * Strategia:
 *  • install   → precache di tutte le risorse statiche (App Shell).
 *  • activate  → elimina le cache di versioni precedenti e prende subito il controllo delle pagine.
 *  • fetch     → "cache first, poi aggiorna in background" (stale-while-revalidate) per le richieste GET
 *                dello stesso sito; se la rete manca e la richiesta è una navigazione, serve index.html.
 *
 * Percorsi RELATIVI: la lista qui sotto è risolta rispetto alla posizione di sw.js, quindi funziona
 * sia in locale, sia su GitHub Pages (https://utente.github.io/mini-sheet-pwa/), sia su Vercel (/).
 *
 * Quando cambi un file dell'app, incrementa CACHE_VERSION: i client scaricheranno la nuova versione.
 * (Durante lo sviluppo: DevTools → Application → Service Workers → "Update on reload" / "Unregister".)
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `mini-sheet-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './vendor/bootstrap.min.css',
  './js/app.js',
  './js/engine.js',
  './js/coordinates.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())          // attiva subito la nuova versione
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mini-sheet-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())        // controlla anche le schede già aperte
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // nessuna richiesta a server esterni viene gestita/memorizzata

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // ignoreSearch: "index.html?utm=..." trova comunque la copia in cache
    const cached = await cache.match(req, { ignoreSearch: true });

    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());  // aggiorna la copia in cache per la prossima volta
      return res;
    });

    if (cached) {                                       // risposta immediata dalla cache
      network.catch(() => {});                          // se la rete manca, l'errore di aggiornamento è irrilevante
      return cached;
    }
    try {
      return await network;
    } catch (err) {
      if (req.mode === 'navigate') {                    // offline + pagina non in cache → app shell
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
