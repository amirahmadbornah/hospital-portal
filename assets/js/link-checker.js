/**
 * link-checker.js
 * -----------------------------------------------------------------------
 * PART 3: Link Health Checker (v2 — CORS-aware classification).
 *
 * A small singleton, window.LinkChecker, that probes a URL before the
 * portal opens it, so staff don't land on a blank tab for a system
 * that is actually down.
 *
 * THE CORE PROBLEM THIS VERSION FIXES
 * A plain `fetch(url)` against a cross-origin internal system that
 * doesn't send CORS headers rejects with a generic TypeError — and
 * that error is, by browser design, indistinguishable from a genuine
 * network failure (DNS failure, connection refused, real outage).
 * Browsers do this on purpose: exposing *why* a cross-origin request
 * failed would leak information about the user's network to any site
 * that cares to probe it. So v1 of this module treated every rejected
 * fetch as "offline", which produced false negatives for systems that
 * were actually up but simply had no CORS headers.
 *
 * THE FIX: a second, `mode: 'no-cors'` probe as a tiebreaker
 * A `no-cors` request still completes the real network round-trip;
 * the browser just hides the response details from JavaScript (an
 * "opaque" response) instead of rejecting the promise. So:
 *   - if the first (normal, 'cors') request throws, and a follow-up
 *     'no-cors' request to the same URL *resolves* — the network path
 *     is clearly working; the original failure was CORS/opaque-related,
 *     not a real outage. Reported as "unverifiable" (gray dot).
 *   - if the 'no-cors' request *also* rejects, the network path
 *     itself is broken (DNS, connection refused, unreachable host, or
 *     the timeout fired with no response at all). Reported as offline
 *     (red dot).
 *
 * KNOWN, UNAVOIDABLE LIMITATION (documented rather than glossed over)
 * A genuine TLS/certificate error and a browser-level mixed-content
 * block (an https:// page fetching an http:// resource) both happen
 * *before* any network round-trip, in every fetch mode. Neither the
 * 'cors' nor the 'no-cors' probe can complete in those two specific
 * cases, so they will still be classified as offline rather than
 * unverifiable, even though the underlying cause isn't a real outage.
 * Fully disambiguating those two cases from a real outage is not
 * possible from client-side JavaScript alone — it would require a
 * same-origin server-side health-check proxy, which is explicitly out
 * of scope here (no backend/proxy, client-only per the brief).
 * -----------------------------------------------------------------------
 */

const LinkChecker = (() => {
  const TIMEOUT_MS = 3000;
  const PROBE_TIMEOUT_MS = 2500; // secondary opaque-probe budget
  const CACHE_TTL_MS = 60000;
  const SLOW_THRESHOLD_MS = 1000;

  // Per the brief: these specific HTTP statuses mean the server is up
  // but reporting a server-side failure — still "offline" for our
  // purposes, distinct from the client-facing statuses just below.
  const SERVER_ERROR_STATUS_CODES = new Set([500, 502, 503, 504]);

  /** @type {Map<string, {result:Object, timestamp:number}>} */
  const cache = new Map();

  /**
   * @param {{timestamp:number}|undefined} entry
   * @returns {boolean}
   */
  function isFresh(entry) {
    return Boolean(entry) && Date.now() - entry.timestamp < CACHE_TTL_MS;
  }

  /**
   * Issues a single fetch with a hard timeout via AbortController.
   * @param {string} url
   * @param {'HEAD'|'GET'} method
   * @param {'cors'|'no-cors'} mode
   * @param {number} timeoutMs
   * @returns {Promise<Response>}
   */
  async function requestWithTimeout(url, method, mode, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        method,
        mode,
        signal: controller.signal,
        cache: 'no-store'
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  /**
   * The disambiguation tiebreaker described in the module header: does
   * a maximally-permissive, opaque request to this URL complete at
   * all? If yes, the server is reachable and the original failure was
   * almost certainly CORS-related, not a real outage.
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async function isReachableViaOpaqueProbe(url) {
    try {
      await requestWithTimeout(url, 'HEAD', 'no-cors', PROBE_TIMEOUT_MS);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Performs the actual network probe: HEAD first (falling back to
   * GET if the server rejects HEAD with 405), classifying the result
   * per the brief's exact status-code table, then — only if the
   * normal request throws — running the opaque-probe tiebreaker to
   * tell a CORS block apart from a real outage.
   * @param {string} url
   * @returns {Promise<{online:(boolean|null), status:number, responseTime:(number|null), timedOut?:boolean, unverifiable?:boolean}>}
   */
  async function probe(url) {
    const startedAt = performance.now();

    try {
      let response = await requestWithTimeout(url, 'HEAD', 'cors', TIMEOUT_MS);

      if (response.status === 405) {
        response = await requestWithTimeout(url, 'GET', 'cors', TIMEOUT_MS);
      }

      const responseTime = Math.round(performance.now() - startedAt);

      // A readable HTTP status means the server actually answered —
      // 5xx is a real server-side failure, everything else (including
      // 401/403, which mean "up but access-restricted") counts as online.
      const isServerError = SERVER_ERROR_STATUS_CODES.has(response.status);
      return { online: !isServerError, status: response.status, responseTime };
    } catch (err) {
      if (err.name === 'AbortError') {
        // No response at all within the timeout budget — per the
        // brief, this is treated as a real outage, not "unverifiable".
        return { online: false, status: 0, responseTime: null, timedOut: true };
      }

      // Ambiguous TypeError: CORS block, opaque response, mixed
      // content, a cert error, or a genuine network failure — all
      // look identical here. Ask the opaque probe to disambiguate.
      const reachable = await isReachableViaOpaqueProbe(url);
      if (reachable) {
        return { online: null, status: 0, responseTime: null, unverifiable: true };
      }
      return { online: false, status: 0, responseTime: null };
    }
  }

  /**
   * Checks a URL's reachability, transparently using the 60-second
   * cache when a fresh-enough result already exists.
   * @param {string} url
   * @returns {Promise<{online:(boolean|null), status:number, responseTime:(number|null), timedOut?:boolean, unverifiable?:boolean}>}
   */
  async function check(url) {
    const cached = cache.get(url);
    if (isFresh(cached)) return cached.result;

    const result = await probe(url);
    cache.set(url, { result, timestamp: Date.now() });
    return result;
  }

  /**
   * Peeks at a still-fresh cached result without triggering a new
   * network request. Used by the status dot to opportunistically show
   * a live result when one is available, falling back to status.json
   * otherwise. Returns null when there is no fresh cached result.
   * @param {string} url
   * @returns {({online:(boolean|null), status:number, responseTime:(number|null), timedOut?:boolean, unverifiable?:boolean, checkedAt:number}|null)}
   */
  function getCached(url) {
    const entry = cache.get(url);
    if (!isFresh(entry)) return null;
    return { ...entry.result, checkedAt: entry.timestamp };
  }

  return { check, getCached, SLOW_THRESHOLD_MS };
})();

window.LinkChecker = LinkChecker;
