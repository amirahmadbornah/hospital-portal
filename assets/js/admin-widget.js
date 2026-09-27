/**
 * admin-widget.js
 * -----------------------------------------------------------------------
 * v2.0 Part 1: the header's admin-login widget on the PUBLIC portal
 * (not the admin panel itself). Shows "🔐 ورود مدیر" by default; after
 * a successful login (via the inline modal, never a page navigation),
 * swaps to "👤 مدیر سیستم" with a dropdown (داشبورد مدیریت / خروج).
 *
 * Deliberately independent of app.js and admin.js: it only touches the
 * small set of elements it owns (#admin-widget-*, #admin-login-*), and
 * degrades silently to the logged-out state if the PHP backend isn't
 * deployed at all — the session-check call just fails like any other
 * network error, with no error shown to the user, so a portal running
 * with no backend still works exactly as before (backward compatible).
 * -----------------------------------------------------------------------
 */

const AdminWidget = (() => {
  const API_BASE = 'api/';

  function cacheElements() {
    return {
      widget: document.querySelector('.admin-widget'),
      btn: document.getElementById('admin-widget-btn'),
      icon: document.getElementById('admin-widget-icon'),
      label: document.getElementById('admin-widget-label'),
      dropdown: document.getElementById('admin-widget-dropdown'),
      logoutBtn: document.getElementById('admin-widget-logout'),

      loginOverlay: document.getElementById('admin-login-overlay'),
      loginForm: document.getElementById('admin-login-form'),
      loginUsername: document.getElementById('admin-login-username'),
      loginPassword: document.getElementById('admin-login-password'),
      loginError: document.getElementById('admin-login-error'),
      loginSubmit: document.getElementById('admin-login-submit'),
      loginCancel: document.getElementById('admin-login-cancel')
    };
  }

  /**
   * @param {string} action e.g. 'auth.php?action=check'
   * @param {Object} [options]
   * @returns {Promise<Object>} parsed JSON response
   */
  async function callApi(action, options = {}) {
    const response = await fetch(API_BASE + action, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || 'خطایی رخ داد.');
    }
    return payload;
  }

  /** Switches the header button + dropdown into the logged-in state. */
  function showLoggedInState(els, username) {
    els.icon.textContent = '👤';
    els.label.textContent = username ? `مدیر سیستم (${username})` : 'مدیر سیستم';
    els.btn.dataset.state = 'in';
  }

  /** Switches the header button + dropdown into the logged-out state. */
  function showLoggedOutState(els) {
    els.icon.textContent = '🔐';
    els.label.textContent = 'ورود مدیر';
    els.btn.dataset.state = 'out';
    els.dropdown.hidden = true;
    els.btn.setAttribute('aria-expanded', 'false');
  }

  /** Checks the current admin session once at startup. Never throws visibly. */
  async function checkSessionOnLoad(els) {
    try {
      const result = await callApi('auth.php?action=check');
      if (result.authenticated) {
        showLoggedInState(els, result.username);
      } else {
        showLoggedOutState(els);
      }
    } catch (err) {
      // Backend not deployed, or a transient network error — the
      // public portal must keep working exactly as before either way.
      showLoggedOutState(els);
    }
  }

  function toggleDropdown(els) {
    const isOpen = !els.dropdown.hidden;
    els.dropdown.hidden = isOpen;
    els.btn.setAttribute('aria-expanded', String(!isOpen));
  }

  function openLoginModal(els) {
    els.loginError.hidden = true;
    els.loginForm.reset();
    els.loginOverlay.hidden = false;
    els.loginUsername.focus();
  }

  function closeLoginModal(els) {
    els.loginOverlay.hidden = true;
  }

  async function handleLoginSubmit(evt, els) {
    evt.preventDefault();
    els.loginError.hidden = true;
    els.loginSubmit.disabled = true;

    try {
      const result = await callApi('auth.php?action=login', {
        method: 'POST',
        body: {
          username: els.loginUsername.value.trim(),
          password: els.loginPassword.value
        }
      });
      showLoggedInState(els, result.username);
      closeLoginModal(els);
    } catch (err) {
      els.loginError.textContent = err.message;
      els.loginError.hidden = false;
    } finally {
      els.loginSubmit.disabled = false;
    }
  }

  async function handleLogout(els) {
    try {
      await callApi('auth.php?action=logout', { method: 'POST', body: {} });
    } finally {
      showLoggedOutState(els);
    }
  }

  function bindEvents(els) {
    els.btn.addEventListener('click', () => {
      if (els.btn.dataset.state === 'in') {
        toggleDropdown(els);
      } else {
        openLoginModal(els);
      }
    });

    // Close the dropdown when clicking anywhere else on the page.
    document.addEventListener('click', (evt) => {
      if (els.dropdown.hidden) return;
      if (els.widget.contains(evt.target)) return;
      els.dropdown.hidden = true;
      els.btn.setAttribute('aria-expanded', 'false');
    });

    els.logoutBtn.addEventListener('click', () => handleLogout(els));

    els.loginForm.addEventListener('submit', (evt) => handleLoginSubmit(evt, els));
    els.loginCancel.addEventListener('click', () => closeLoginModal(els));
    els.loginOverlay.addEventListener('click', (evt) => {
      if (evt.target === els.loginOverlay) closeLoginModal(els);
    });
  }

  function init() {
    const els = cacheElements();
    if (!els.widget || !els.btn) return; // markup not present on this page

    bindEvents(els);
    checkSessionOnLoad(els);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', AdminWidget.init);
