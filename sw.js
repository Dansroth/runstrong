/* RunStrong service worker — cache-first, fully offline after first load */
const CACHE = 'runstrong-v76';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/program.js',
  './js/app.js',
  './manifest.json',
  './assets/exercise-catalogue.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  /* cache: 'reload' matters more than it looks (v60). cache.addAll() goes
     through the browser's HTTP cache by default, and GitHub Pages serves these
     files with max-age=600 — so a service worker installing within ten minutes
     of the last fetch would populate its brand-new cache with the PREVIOUS
     version's files — a cache named for this version holding the last one's
     assets. Because the fetch handler below is cache-first with no revalidation,
     it would stay that way until the next version bump. An update that
     silently no-ops is worse than one that fails loudly. */
  const fresh = ASSETS.map(u => new Request(u, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(fresh)).then(() => self.skipWaiting()));
});

/* The OCR engine (tesseract.js: wrapper, wasm core, English model) is ~15 MB
   and comes from a CDN, so it is deliberately NOT in ASSETS — it would treble
   a first install for a feature most launches never touch. It is cached at
   runtime on first use instead, into its own bucket that survives version
   bumps: the engine does not change when the app does, and re-downloading
   15 MB on every deploy would be indefensible. */
const VENDOR = 'runstrong-vendor-v1';
const VENDOR_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== VENDOR).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs =>
      cs.length ? cs[0].focus() : self.clients.openWindow('./'))
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  /* Vendor assets: cache-first into the bucket that outlives version bumps, so
     the OCR engine is downloaded once and then works offline like the rest of
     the app. Everything else cross-origin (the Strava API) still bypasses. */
  if (VENDOR_HOSTS.includes(u.host)) {
    e.respondWith(caches.open(VENDOR).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; })
    )));
    return;
  }
  if (u.origin !== location.origin) return; // anything else cross-origin is left alone
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
