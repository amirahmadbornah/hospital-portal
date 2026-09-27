/**
 * data-loader.js
 * -----------------------------------------------------------------------
 * FEATURE: JSON-based administration.
 *
 * Centralizes fetching of the JSON data sources (config, announcements,
 * links, status) and detects, on every fetch, exactly which of them
 * changed since the previous fetch. This lets app.js update only the
 * DOM sections that actually need it instead of rebuilding the whole
 * page on every auto-refresh tick.
 *
 * v2.0: the old single-object `data/announcement.json` was replaced by
 * the array-based `data/announcements.json` (full redesign — multiple
 * announcements, images, priorities, popup/banner modes; see
 * assets/js/announcements.js). This loader now fetches the new file
 * under the `announcements` key; the old key/file is no longer read.
 *
 * Still no backend for the public portal itself: this only ever reads
 * static JSON files with the browser cache bypassed, exactly like the
 * original loader. (The separate admin panel's writes go through
 * api/announcement.php, which is what keeps this file up to date.)
 * -----------------------------------------------------------------------
 */

const DataLoader = (() => {
  const ENDPOINTS = Object.freeze({
    config: 'data/config.json',
    announcements: 'data/announcements.json',
    links: 'data/links.json',
    status: 'data/status.json'
  });

  /** Snapshot of the last fetch, used to diff against the next one. */
  let previousHashes = { config: null, announcements: null, links: null, status: null };

  /**
   * Fetches JSON while guaranteeing the browser never serves a stale
   * cached copy — required so link/config/announcements/status edits
   * on the server show up for every open browser tab.
   * @param {string} path
   * @returns {Promise<*>}
   */
  async function fetchFreshJSON(path) {
    const bustedUrl = `${path}?t=${Date.now()}`;
    const response = await fetch(bustedUrl, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * Cheap structural hash for small JSON documents — a JSON string is
   * sufficient here since these files are a few KB at most.
   * @param {*} value
   * @returns {string}
   */
  function hashOf(value) {
    return JSON.stringify(value);
  }

  /**
   * Fetches all data sources in parallel and reports which of them
   * changed compared to the previous call.
   *
   * status.json and announcements.json are both treated as optional:
   * if either is missing or invalid the portal still works, with
   * systems falling back to "unknown" / no announcements shown.
   *
   * @returns {Promise<{config:*, announcements:*, links:*, status:*, changed:Object}>}
   */
  async function fetchAll() {
    const [config, announcements, links, status] = await Promise.all([
      fetchFreshJSON(ENDPOINTS.config),
      fetchFreshJSON(ENDPOINTS.announcements).catch((err) => {
        console.warn('[data-loader] announcements.json unavailable, no announcements will show.', err);
        return { announcements: [] };
      }),
      fetchFreshJSON(ENDPOINTS.links),
      fetchFreshJSON(ENDPOINTS.status).catch((err) => {
        console.warn('[data-loader] status.json unavailable, systems will show as unknown.', err);
        return { refreshInterval: 300, systems: [] };
      })
    ]);

    const nextHashes = {
      config: hashOf(config),
      announcements: hashOf(announcements),
      links: hashOf(links),
      status: hashOf(status)
    };

    const isFirstLoad = previousHashes.config === null;
    const changed = {
      config: isFirstLoad || previousHashes.config !== nextHashes.config,
      announcements: isFirstLoad || previousHashes.announcements !== nextHashes.announcements,
      links: isFirstLoad || previousHashes.links !== nextHashes.links,
      status: isFirstLoad || previousHashes.status !== nextHashes.status,
      isFirstLoad
    };

    previousHashes = nextHashes;

    return { config, announcements, links, status, changed };
  }

  return { fetchAll, ENDPOINTS };
})();

window.DataLoader = DataLoader;
