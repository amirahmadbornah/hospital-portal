/**
 * favorites.js
 * -----------------------------------------------------------------------
 * Manages the set of link IDs the user has starred as favorites.
 * Persisted only in localStorage, keyed by link id (never by URL, so
 * favorites survive small edits to links.json).
 * -----------------------------------------------------------------------
 */

const FavoritesManager = (() => {
  const { Keys, readJSON, writeJSON } = window.PortalStorage;

  /** @returns {string[]} array of favorite link ids */
  function getAll() {
    return readJSON(Keys.FAVORITES, []);
  }

  /** @param {string} linkId @returns {boolean} */
  function isFavorite(linkId) {
    return getAll().includes(linkId);
  }

  /**
   * Toggles a link's favorite state.
   * @param {string} linkId
   * @returns {boolean} the new favorite state (true = now favorited)
   */
  function toggle(linkId) {
    const current = getAll();
    const idx = current.indexOf(linkId);
    let nowFavorite;

    if (idx === -1) {
      current.push(linkId);
      nowFavorite = true;
    } else {
      current.splice(idx, 1);
      nowFavorite = false;
    }

    writeJSON(Keys.FAVORITES, current);
    return nowFavorite;
  }

  return { getAll, isFavorite, toggle };
})();

window.FavoritesManager = FavoritesManager;
