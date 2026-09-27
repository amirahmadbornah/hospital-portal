/**
 * pwa.js
 * -----------------------------------------------------------------------
 * FEATURE 3: Progressive Web App support.
 *
 * Responsibilities:
 *   - Register service-worker.js and surface the "update available"
 *     banner (بروزرسانی / بعداً / ×) when a new version has installed.
 *   - Show/hide the offline banner based on navigator.onLine, and keep
 *     the header's connection indicator (متصل/قطع) in sync.
 *   - Prepare (but not activate) Background Sync and Push Notification
 *     support, since there is no backend yet to sync with or push
 *     from — these are documented stubs, not working features.
 *
 * NOTE on installing the app: this file deliberately does NOT listen
 * for `beforeinstallprompt` or show a custom install button anymore.
 * By leaving that event alone (never calling event.preventDefault()
 * on it), the browser shows its own native install icon in the
 * address bar next to the bookmark star — which is exactly the
 * install UI this project wants to rely on. If that icon never
 * appears, the cause is almost always that the page isn't being
 * served from a secure context (HTTPS, or localhost) — see the
 * "نصب PWA" section of README.md for the fix.
 *
 * This module only touches the small set of PWA-specific elements
 * added to index.html — it never modifies the existing header layout,
 * cards or category markup.
 * -----------------------------------------------------------------------
 */

const PWAManager = (() => {
  let hasReloaded = false;

  function cacheElements() {
    return {
      offlineBanner: document.getElementById('offline-banner'),
      updateBanner: document.getElementById('update-banner'),
      updateReloadBtn: document.getElementById('update-reload-btn'),
      updateLaterBtn: document.getElementById('update-later-btn'),
      networkStatus: document.getElementById('network-status'),
      networkStatusLabel: document.getElementById('network-status-label')
    };
  }

  /**
   * Detects whether the app is currently running as an installed,
   * standalone PWA (covers both the standard media query and Safari's
   * older `navigator.standalone` flag). Kept as a small utility other
   * modules can query even though this file no longer uses it itself.
   * @returns {boolean}
   */
  function isRunningStandalone() {
    const matchesDisplayMode =
      window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = window.navigator.standalone === true;
    return Boolean(matchesDisplayMode || isIOSStandalone);
  }

  /** Shows/hides the offline banner and updates the header status dot. */
  function syncOnlineStatus(els) {
    const isOnline = navigator.onLine;

    if (els.offlineBanner) els.offlineBanner.hidden = isOnline;

    if (els.networkStatus && els.networkStatusLabel) {
      els.networkStatus.classList.toggle('network-status--online', isOnline);
      els.networkStatus.classList.toggle('network-status--offline', !isOnline);
      els.networkStatusLabel.textContent = isOnline ? 'متصل' : 'قطع';
    }
  }

  /** Registers the service worker and listens for background updates. */
  function registerServiceWorker(els) {
    if (!('serviceWorker' in navigator)) return;

    // Service workers — and therefore PWA installability itself — only
    // work on a secure context: HTTPS, or http://localhost during
    // development. A plain-HTTP LAN address (e.g. http://192.168.x.x)
    // will silently fail registration in every current browser. See
    // README.md's "نصب PWA" section for how to fix this for an
    // internal-network deployment.
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('service-worker.js')
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener('statechange', () => {
              const isUpdateReady =
                installingWorker.state === 'installed' && navigator.serviceWorker.controller;
              if (isUpdateReady && els.updateBanner) {
                els.updateBanner.hidden = false;
              }
            });
          });
        })
        .catch((err) => {
          console.warn('[pwa] Service worker registration failed.', err);
        });
    });

    // Once the new worker takes control, reload exactly once so the
    // page picks up the freshly cached assets.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hasReloaded) return;
      hasReloaded = true;
      window.location.reload();
    });
  }

  /** Wires the "بروزرسانی" and "بعداً" buttons inside the update banner. */
  function bindUpdateButtons(els) {
    if (els.updateReloadBtn) {
      els.updateReloadBtn.addEventListener('click', () => {
        navigator.serviceWorker.getRegistration().then((registration) => {
          if (registration && registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          } else {
            window.location.reload();
          }
        });
      });
    }

    // "بعداً": just dismiss the banner, same as its × button — the new
    // service worker is already installed and waiting, so it will take
    // over automatically on the next full page load anyway.
    if (els.updateLaterBtn) {
      els.updateLaterBtn.addEventListener('click', () => {
        if (els.updateBanner) els.updateBanner.hidden = true;
      });
    }
  }

  /**
   * PART: Background Sync stub (feature #10). Only registers the tag
   * when the browser supports SyncManager; the actual sync logic
   * lives in service-worker.js's 'sync' listener and is itself an
   * inert stub until a real backend exists to sync data with.
   */
  function registerBackgroundSyncStub() {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;

    navigator.serviceWorker.ready
      .then((registration) => registration.sync.register('portal-data-sync'))
      .catch((err) => {
        console.warn('[pwa] Background Sync registration skipped/failed.', err);
      });
  }

  /**
   * PART: Push Notification stub (feature #11). Only checks and logs
   * capability — no subscription is created since there is no backend
   * (and therefore no VAPID public key) to subscribe against yet.
   */
  function checkPushNotificationSupportStub() {
    const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    if (isSupported) {
      console.log('[pwa] Push notifications are supported by this browser (stub — not yet wired to a backend).');
    }
  }

  function init() {
    const els = cacheElements();
    syncOnlineStatus(els);
    window.addEventListener('online', () => syncOnlineStatus(els));
    window.addEventListener('offline', () => syncOnlineStatus(els));

    registerServiceWorker(els);
    bindUpdateButtons(els);
    registerBackgroundSyncStub();
    checkPushNotificationSupportStub();

    // Generic banner-close (×) wiring for offline/update banners lives
    // in app.js's bindEvents(); nothing to duplicate here.
    // Note: no beforeinstallprompt handling here on purpose — see the
    // file header comment. The browser's own address-bar install icon
    // is the only install UI now.
  }

  return { init, isRunningStandalone };
})();

window.PWAManager = PWAManager;
document.addEventListener('DOMContentLoaded', PWAManager.init);
