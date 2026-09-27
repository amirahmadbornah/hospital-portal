/**
 * search.js
 * -----------------------------------------------------------------------
 * Pure, framework-free realtime search over the loaded link list.
 * Matches against title, description and category title, all
 * diacritic/case-insensitive. No network calls, no dependencies.
 * -----------------------------------------------------------------------
 */

const SearchEngine = (() => {
  /**
   * Normalizes a string for comparison: lowercases and strips Arabic
   * "ي/ك" vs Persian "ی/ک" differences so search feels forgiving.
   * @param {string} value
   * @returns {string}
   */
  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .trim();
  }

  /**
   * Filters a link list against a raw query string.
   * @param {Array<Object>} links
   * @param {Map<string,Object>} categoriesById
   * @param {string} query
   * @returns {Array<Object>} matching links
   */
  function filter(links, categoriesById, query) {
    const q = normalize(query);
    if (!q) return links;

    return links.filter((link) => {
      const category = categoriesById.get(link.category);
      const haystack = [
        link.title,
        link.description,
        category ? category.title : ''
      ]
        .map(normalize)
        .join(' | ');

      return haystack.includes(q);
    });
  }

  return { filter, normalize };
})();

window.SearchEngine = SearchEngine;
