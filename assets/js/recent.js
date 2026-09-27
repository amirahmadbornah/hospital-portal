/**
 * recent.js
 * -----------------------------------------------------------------------
 * Tracks the last links opened by the user. Keeps a maximum of 10
 * entries, newest first, with duplicates removed (re-opening a link
 * simply moves it back to the top).
 * -----------------------------------------------------------------------
 */

const RecentManager = (() => {
  const { Keys, readJSON, writeJSON } = window.PortalStorage;
  const MAX_ITEMS = 10;

  /** @returns {string[]} array of link ids, newest first */
  function getAll() {
    return readJSON(Keys.RECENT, []);
  }

  /**
   * Records that a link was just opened.
   * @param {string} linkId
   * @returns {string[]} the updated list
   */
  function record(linkId) {
    const current = getAll().filter((id) => id !== linkId);
    current.unshift(linkId);
    const trimmed = current.slice(0, MAX_ITEMS);
    writeJSON(Keys.RECENT, trimmed);
    return trimmed;
  }

  return { getAll, record, MAX_ITEMS };
})();

window.RecentManager = RecentManager;
