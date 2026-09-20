/* RunStrong service worker — cache-first, fully offline after first load */
const CACHE = 'runstrong-v60';
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
     version's files. The cache would be named runstrong-v60 and contain v59,
     and because the fetch handler below is cache-first with no revalidation,
     it would stay that way until the next version bump. An update that
     silently no-ops is worse than one that fails loudly. */
  const fresh = ASSETS.map(u => new Request(u, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
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
  if (new URL(e.request.url).origin !== location.origin) return; // Strava API calls bypass the cache entirely
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
