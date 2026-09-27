/**
 * storage.js
 * -----------------------------------------------------------------------
 * Thin, safe wrapper around window.localStorage.
 * Every key used by the portal is namespaced under "hp12:" (Hospital
 * Portal v12) so it never collides with anything else that might one
 * day share the same origin.
 *
 * This module stores ONLY:
 *   - favorites
 *   - recent links
 *   - most-used statistics
 *   - theme preference
 *   - which announcements the user has dismissed, and which
 *     showOnce announcements have already been shown (v2.0 — see
 *     assets/js/announcements.js; replaces the old cycle-based
 *     announcement-scheduler.js dismiss tracking)
 * No personal / patient / user information is ever written here, and
 * nothing here is ever sent over the network.
 * -----------------------------------------------------------------------
 */

const STORAGE_PREFIX = 'hp12:';

const StorageKeys = Object.freeze({
  FAVORITES: `${STORAGE_PREFIX}favorites`,
  RECENT: `${STORAGE_PREFIX}recent`,
  STATS: `${STORAGE_PREFIX}stats`,
  THEME: `${STORAGE_PREFIX}theme`,
  ANNOUNCEMENT_DISMISS: `${STORAGE_PREFIX}announcementDismiss`,
  ANNOUNCEMENT_SEEN: `${STORAGE_PREFIX}announcementSeen`
});

/**
 * Reads a JSON value from localStorage.
 * @param {string} key
 * @param {*} fallback value returned when the key is missing or invalid
 * @returns {*}
 */
function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] Unable to read "${key}", using fallback.`, err);
    return fallback;
  }
}

/**
 * Writes a JSON-serializable value to localStorage.
 * @param {string} key
 * @param {*} value
 * @returns {boolean} true on success
 */
function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // Likely quota exceeded or localStorage disabled (private mode, etc.)
    console.warn(`[storage] Unable to write "${key}".`, err);
    return false;
  }
}

/**
 * Removes a key entirely.
 * @param {string} key
 */
function remove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[storage] Unable to remove "${key}".`, err);
  }
}

/**
 * Quick capability check, used once at startup to warn the user if
 * localStorage is unavailable (e.g. some locked-down kiosk browsers).
 * @returns {boolean}
 */
function isAvailable() {
  try {
    const testKey = `${STORAGE_PREFIX}__test__`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch (err) {
    return false;
  }
}

window.PortalStorage = {
  Keys: StorageKeys,
  readJSON,
  writeJSON,
  remove,
  isAvailable
};
