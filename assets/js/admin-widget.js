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
  const portalRoot = new URL('../../', document.currentScript.src);
  let pendingTarget = null;
  let returnFocus = null;
  let previousOverflow = '';
  let modalVersion = 0;
  const inertElements = new Map();

  function adminTarget(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      const pages = ['admin/dashboard.html', 'admin/announcements.html', 'admin/appearance.html'];
      return url.origin === portalRoot.origin && pages.some(page => url.pathname === new URL(page, portalRoot).pathname) ? url.href : null;
    } catch { return null; }
  }

  function clearLoginQuery() {
    const url = new URL(location.href);
    if (!url.searchParams.has('login')) return;
    url.searchParams.delete('login');
    url.searchParams.delete('next');
    history.replaceState(null, '', url);
  }

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

  function openLoginModal(els, target = null) {
    if (!els.loginOverlay.hidden) return;
    modalVersion++;
    pendingTarget = adminTarget(target);
    returnFocus = document.activeElement === document.body ? els.btn : document.activeElement;
    els.dropdown.hidden = true;
    els.btn.setAttribute('aria-expanded', 'false');
    els.loginError.hidden = true;
    els.loginForm.reset();
    els.loginSubmit.disabled = false;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    for (const element of document.body.children) {
      if (element === els.loginOverlay || element.matches('script,style')) continue;
      inertElements.set(element, element.inert);
      element.inert = true;
    }
    els.loginOverlay.hidden = false;
    els.loginUsername.focus();
  }

  function closeLoginModal(els) {
    modalVersion++;
    pendingTarget = null;
    els.loginOverlay.hidden = true;
    els.loginPassword.value = '';
    document.body.style.overflow = previousOverflow;
    inertElements.forEach((inert, element) => { element.inert = inert; });
    inertElements.clear();
    clearLoginQuery();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }

  async function handleLoginSubmit(evt, els) {
    evt.preventDefault();
    els.loginError.hidden = true;
    els.loginSubmit.disabled = true;
    const version = modalVersion;

    try {
      const result = await callApi('auth.php?action=login', {
        method: 'POST',
        body: {
          username: els.loginUsername.value.trim(),
          password: els.loginPassword.value
        }
      });
      showLoggedInState(els, result.username);
      if (version !== modalVersion) return;
      const destination = pendingTarget;
      closeLoginModal(els);
      if (destination) location.assign(destination);
    } catch (err) {
      if (version !== modalVersion) return;
      els.loginError.textContent = err.message;
      els.loginError.hidden = false;
    } finally {
      if (version === modalVersion) els.loginSubmit.disabled = false;
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
    document.addEventListener('click', async evt => {
      const link = evt.target.closest('a[href]');
      if (!link || evt.defaultPrevented || evt.button !== 0 || evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey || link.target === '_blank') return;
      const target = adminTarget(link.href);
      if (!target) return;
      evt.preventDefault();
      try {
        const result = await callApi('auth.php?action=check');
        if (result.authenticated) { location.assign(target); return; }
      } catch { /* Login errors are shown inside the dialog after submitting. */ }
      openLoginModal(els, target);
    });
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
    document.addEventListener('keydown', evt => {
      if (els.loginOverlay.hidden) return;
      if (evt.key === 'Escape') { evt.preventDefault(); closeLoginModal(els); }
      if (evt.key !== 'Tab') return;
      const controls = Array.from(els.loginForm.querySelectorAll('input,button')).filter(el => !el.disabled);
      const first = controls[0], last = controls[controls.length - 1];
      if (evt.shiftKey && document.activeElement === first) { evt.preventDefault(); last.focus(); }
      else if (!evt.shiftKey && document.activeElement === last) { evt.preventDefault(); first.focus(); }
    });
  }

  function init() {
    const els = cacheElements();
    if (!els.widget || !els.btn) return; // markup not present on this page

    bindEvents(els);
    checkSessionOnLoad(els).then(() => {
      const params = new URL(location.href).searchParams;
      if (params.get('login') !== '1') return;
      const target = adminTarget(params.get('next'));
      if (els.btn.dataset.state === 'in') {
        clearLoginQuery();
        if (target) location.assign(target);
      } else openLoginModal(els, target);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', AdminWidget.init);
