/**
 * theme.js
 * -----------------------------------------------------------------------
 * Handles switching between light and dark themes, remembering the
 * user's choice in localStorage, and applying an animated transition.
 * -----------------------------------------------------------------------
 */

const ThemeManager = (() => {
  const THEMES = Object.freeze({ LIGHT: 'light', DARK: 'dark' });
  const { Keys, readJSON, writeJSON } = window.PortalStorage;

  /**
   * Determines the theme that should be active on first load:
   * saved preference > OS preference > light.
   * @returns {string}
   */
  function resolveInitialTheme() {
    const saved = readJSON(Keys.THEME, null);
    if (saved === THEMES.LIGHT || saved === THEMES.DARK) return saved;

    const prefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? THEMES.DARK : THEMES.LIGHT;
  }

  /**
   * Applies a theme to the document root and persists it.
   * @param {string} theme
   * @param {boolean} persist whether to save the choice to localStorage
   */
  function apply(theme, persist = true) {
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) writeJSON(Keys.THEME, theme);
  }

  /**
   * Toggles between light and dark, with a short transition class
   * applied to the body so CSS can animate the swap.
   * @returns {string} the newly active theme
   */
  function toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;

    document.body.classList.add('theme-transitioning');
    apply(next);
    window.setTimeout(() => {
      document.body.classList.remove('theme-transitioning');
    }, 400);

    return next;
  }

  function init() {
    apply(resolveInitialTheme(), false);
  }

  return { THEMES, init, toggle, apply, resolveInitialTheme };
})();

window.ThemeManager = ThemeManager;
