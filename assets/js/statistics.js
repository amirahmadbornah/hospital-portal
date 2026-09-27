/**
 * statistics.js
 * -----------------------------------------------------------------------
 * Counts how many times each link has been opened, so the portal can
 * surface a "most used" ranking. Purely local — a simple map of
 * linkId -> click count stored in localStorage.
 * -----------------------------------------------------------------------
 */

const StatisticsManager = (() => {
  const { Keys, readJSON, writeJSON } = window.PortalStorage;

  /** @returns {Object<string, number>} map of linkId -> click count */
  function getAll() {
    return readJSON(Keys.STATS, {});
  }

  /**
   * Increments the click counter for a link.
   * @param {string} linkId
   * @returns {number} the new count for that link
   */
  function increment(linkId) {
    const stats = getAll();
    stats[linkId] = (stats[linkId] || 0) + 1;
    writeJSON(Keys.STATS, stats);
    return stats[linkId];
  }

  /**
   * Returns the top N most-clicked link ids, descending by count.
   * @param {number} limit
   * @returns {{id:string, count:number}[]}
   */
  function getTop(limit = 6) {
    const stats = getAll();
    return Object.entries(stats)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  return { getAll, increment, getTop };
})();

window.StatisticsManager = StatisticsManager;
