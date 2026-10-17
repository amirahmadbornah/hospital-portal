/**
 * service-worker.js
 * -----------------------------------------------------------------------
 * FEATURE 3: Progressive Web App support.
 *
 * Two cache buckets:
 *   - STATIC_CACHE  : the app shell (HTML/CSS/JS/manifest/icons),
 *     precached at install time from PRECACHE_URLS.
 *   - RUNTIME_CACHE : anything fetched during normal use that isn't
 *     part of the precached shell (data/*.json, images/fonts added
 *     later, etc.).
 *
 * Three named strategies, applied per request type:
 *   - staleWhileRevalidate : app shell (HTML/CSS/JS/manifest). Serves
 *     the cached copy instantly, then quietly re-fetches in the
 *     background so the *next* load already has the newest file —
 *     this is what powers the "new version available" banner.
 *   - cacheFirst           : truly static assets (icons, fonts,
 *     images, favicon). These rarely change, so once cached they are
 *     served straight from cache with no network round-trip at all.
 *   - networkFirst         : data/*.json. Always tries the network
 *     first (so admin edits to links/config/announcement/status show
 *     up immediately), falling back to the last cached copy only when
 *     offline.
 *
 * CACHE_VERSION must be bumped together with the ?v= query strings in
 * index.html and config.json's portalVersion on every deploy. That
 * bump changes both cache names below, so activate() can safely wipe
 * every cache from the previous version (Automatic Cleanup).
 * -----------------------------------------------------------------------
 */

const CACHE_VERSION = 'v2.0.5-bale-qr';
const STATIC_CACHE = `hospital-portal-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `hospital-portal-runtime-${CACHE_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, RUNTIME_CACHE];

// The app shell: precached in full at install time so the very first
// offline load already works.
const PRECACHE_URLS = [
  './assets/images/logo-madani.png',
  './assets/images/bale-bot-qr.svg',
  './assets/js/portal-appearance.js?v=20261017-login',
  './assets/css/hospital-design-system.css?v=20261017-login',
  './assets/css/hospital-portal.css?v=20261017-bale-qr',
  './assets/js/hospital-shell.js?v=20261017-bale-qr',
  './',
  './index.html',
  './manifest.json',
  './browserconfig.xml',
  './favicon/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-256.png',
  './assets/icons/icon-384.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/icon-monochrome.png',
  './assets/css/style.css?v=2.0.0',
  './assets/js/storage.js?v=2.0.0',
  './assets/js/theme.js?v=2.0.0',
  './assets/js/statistics.js?v=2.0.0',
  './assets/js/search.js?v=2.0.0',
  './assets/js/data-loader.js?v=2.0.0',
  './assets/js/status.js?v=2.0.0',
  './assets/js/announcements.js?v=2.0.0',
  './assets/js/link-checker.js?v=2.0.0',
  './assets/js/pwa.js?v=2.0.0',
  './assets/js/admin-widget.js?v=20261017-login',
  './assets/js/app.js?v=20261017-login'
];

self.addEventListener('install', (event) => {
  // NOTE: skipWaiting() is intentionally NOT called here. Calling it
  // unconditionally on every install made a new worker take over
  // immediately, which fired 'controllerchange' and forced pwa.js to
  // reload the page automatically — silently bypassing the "نسخه جدید
  // پرتال آماده نصب است" banner and its بروزرسانی/بعداً choice, and
  // causing an extra unwanted full reload (re-fetching the whole app
  // shell) every time a worker first installed. skipWaiting() now
  // only runs when the user explicitly clicks "بروزرسانی" (see the
  // 'message' listener below), which is the correct, user-controlled
  // update flow.
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
});

// Automatic Cleanup: remove every cache that isn't one of the two
// current-version buckets (i.e. every cache left over from an older
// deployment).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Lets pwa.js force an already-installed worker to activate immediately
// when the user clicks "بروزرسانی" on the update banner.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/**
 * @param {URL} url
 * @returns {boolean} true for data/*.json requests (NOT data/uploads/
 * images — see isUploadedImageRequest, which is checked first)
 */
function isDataRequest(url) {
  return url.pathname.includes('/data/') && !url.pathname.includes('/data/uploads/');
}

/**
 * v2.0: announcement images. Unlike data/*.json, these never change
 * once uploaded — api/announcement.php always generates a brand-new
 * random filename per upload, so a given URL's content is permanently
 * stable. cacheFirst is therefore the right strategy (no need to ever
 * re-check the network for an existing image).
 * @param {URL} url
 * @returns {boolean}
 */
function isUploadedImageRequest(url) {
  return url.pathname.includes('/data/uploads/');
}

/**
 * Admin panel + its API must NEVER be touched by the service worker:
 *   - api/*.php responses can be session-specific (auth check, the
 *     full links list) — caching them risks serving stale or
 *     cross-session data on a shared kiosk browser, and defeats the
 *     "session expired -> redirect to login" check in admin.js.
 *   - admin/*.html|js|css must only ever be cached once the admin has
 *     actually logged in (per spec) — without this exclusion they'd
 *     match isAppShellRequest() below (.html/.js/.css) and get
 *     precached for anyone who ever loads the page, logged in or not.
 * Excluding both here means every request under /api/ or /admin/ goes
 * straight to the network, untouched, exactly like a POST request
 * already does a few lines down.
 * @param {URL} url
 * @returns {boolean}
 */
function isAdminOrApiRequest(url) {
  return url.pathname.includes('/api/') || url.pathname.includes('/admin/');
}

/**
 * @param {URL} url
 * @returns {boolean} true for the precached app shell (HTML/CSS/JS/manifest)
 */
function isAppShellRequest(url) {
  const path = url.pathname;
  return (
    path.endsWith('/') ||
    path.endsWith('.html') ||
    path.endsWith('.css') ||
    path.endsWith('.js') ||
    path.endsWith('manifest.json')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isAdminOrApiRequest(url)) return;

  if (isDataRequest(url)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
  } else if (isUploadedImageRequest(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  } else if (isAppShellRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  } else {
    // Icons, fonts, images, favicon, screenshots, etc.
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
});

/**
 * Network-first: always try the network (so admin edits to JSON show
 * up immediately), fall back to the last cached copy when offline.
 *
 * IMPORTANT: data-loader.js appends a `?t=<timestamp>` cache-buster to
 * every data/*.json request so the *browser's* HTTP cache never serves
 * a stale copy. But that also means every single poll (every 5
 * minutes by default) produces a URL that has never been seen before.
 * If we cached the request as-is, the Cache Storage entry for that
 * exact URL would never be reused or overwritten — every poll would
 * silently ADD a brand-new entry instead of replacing the previous
 * one, so Cache Storage would grow without bound for as long as the
 * tab/app stays open (this is what was causing the growing memory/
 * storage pressure on long-running sessions). Stripping the query
 * string before using it as the cache key fixes both problems: only
 * one entry per data file ever exists, and the offline fallback below
 * can actually find it again (matching the raw request would always
 * miss too, since its timestamp never matches an older cached one).
 * @param {Request} request
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function networkFirst(request, cacheName) {
  const cacheKey = stripQueryString(request);

  try {
    const freshResponse = await fetch(request, { cache: 'no-store' });
    const cache = await caches.open(cacheName);
    cache.put(cacheKey, freshResponse.clone());
    return freshResponse;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    throw err;
  }
}

/**
 * Builds a cache key equivalent to `request` but with the query string
 * removed, so repeated cache-busted requests to the same path (e.g.
 * data/links.json?t=...) all collapse onto one Cache Storage entry.
 * @param {Request} request
 * @returns {Request}
 */
function stripQueryString(request) {
  const url = new URL(request.url);
  url.search = '';
  return new Request(url.toString(), { method: request.method });
}

/**
 * Cache-first: serve straight from cache when present (no network
 * round-trip). Only hits the network the first time an asset is seen.
 * @param {Request} request
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  const freshResponse = await fetch(request);
  const cache = await caches.open(cacheName);
  cache.put(request, freshResponse.clone());
  return freshResponse;
}

/**
 * Stale-while-revalidate: serve the cached copy instantly (if any)
 * while re-fetching in the background to refresh the cache for next
 * time. Used for the app shell so repeat loads are instant but the
 * cache still quietly heals itself after a deploy (Background Update).
 * @param {Request} request
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkFetch = fetch(request)
    .then((freshResponse) => {
      cache.put(request, freshResponse.clone());
      return freshResponse;
    })
    .catch(() => null); // offline: nothing to update, cached copy still wins below

  return cachedResponse || (await networkFetch) || Response.error();
}

/**
 * PART: Background Sync stub (feature #10).
 * No backend exists yet to sync data *to* — the portal is fully
 * static/JSON-driven — so this only wires the event so a future
 * backend integration (e.g. queued favorite/analytics writes) can
 * plug straight into the 'portal-data-sync' tag without touching this
 * file's fetch logic.
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'portal-data-sync') {
    console.log('[service-worker] Background sync fired (stub — no backend to sync with yet).');
  }
});

/**
 * PART: Push Notification stub (feature #11).
 * No VAPID keys or push backend exist yet. This listener is inert
 * until a real backend starts sending push messages, but the display
 * logic is ready so wiring one up later needs no service worker
 * changes.
 */
self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.text() : 'اعلان جدید پورتال';
  event.waitUntil(
    self.registration.showNotification('پورتال بیمارستان', {
      body: payload,
      icon: 'assets/icons/icon-192.png',
      badge: 'assets/icons/icon-monochrome.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('./'));
});
