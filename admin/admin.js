/**
 * admin.js
 * -----------------------------------------------------------------------
 * Admin panel logic for both login.html and dashboard.html. Detects
 * which page it's on via the elements present and wires only what's
 * needed, so one file can serve both without duplicating the shared
 * bits (theme, toast, fetch helpers).
 *
 * Scope, per spec: this panel manages ONLY links.json's `links` array.
 * Categories are read-only here (picked from a dropdown), never
 * created/edited/removed from this panel.
 * -----------------------------------------------------------------------
 */

(() => {
  'use strict';

  const API_BASE = '../api/';

  /**
   * Icon keys this admin panel offers in the "آیکون" dropdown. Kept as
   * a plain list (not fetched) so the dropdown always shows valid
   * choices with zero extra requests. MUST be kept in sync with the
   * ICONS dictionary in assets/js/app.js — if a new icon is added
   * there for use in links.json, add it here too so admins can pick it.
   */
  const AVAILABLE_ICONS = [
    'activity', 'alert-triangle', 'ambulance', 'award', 'badge-check',
    'bar-chart-3', 'bed', 'book', 'book-open', 'briefcase', 'calendar',
    'camera', 'check-circle', 'clipboard', 'clipboard-plus', 'clock',
    'cross', 'database', 'file-text', 'flame', 'flask', 'flower',
    'folder', 'globe', 'graduation-cap', 'heart', 'heart-handshake',
    'heart-pulse', 'image', 'life-buoy', 'mail', 'message-circle',
    'microscope', 'monitor', 'phone', 'pill', 'printer', 'repeat',
    'search', 'server', 'settings', 'shield', 'shield-check',
    'shopping-cart', 'stethoscope', 'syringe', 'truck', 'upload',
    'users', 'wallet'
  ];

  /* ----------------------------------------------------------------- *
   * Shared: toast notifications (self-contained — admin.js runs in a
   * separate page/scope from app.js, so this is intentionally a small
   * standalone copy of the same pattern, not a duplicate module.)
   * ----------------------------------------------------------------- */

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'status');

    const text = document.createElement('span');
    text.className = 'toast__text';
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'banner-close toast__close';
    closeBtn.setAttribute('aria-label', 'بستن اعلان');
    closeBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>';

    toast.append(text, closeBtn);
    container.appendChild(toast);

    let autoDismissId = null;
    const dismiss = () => {
      if (autoDismissId) window.clearTimeout(autoDismissId);
      toast.classList.remove('toast--visible');
      window.setTimeout(() => toast.remove(), 250);
    };
    closeBtn.addEventListener('click', dismiss);

    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    autoDismissId = window.setTimeout(dismiss, 3200);
  }

  /* ----------------------------------------------------------------- *
   * Shared: fetch helper
   * ----------------------------------------------------------------- */

  /**
   * @param {string} action e.g. 'links.php?action=list'
   * @param {Object} [options]
   * @param {string} [options.method]
   * @param {Object} [options.body]
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

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error('پاسخ سرور نامعتبر بود.');
    }

    if (response.status === 401) {
      // Session expired/missing mid-use — bounce to login rather than
      // leaving the admin staring at a silently-broken dashboard.
      window.location.href = 'login.html';
      throw new Error('نشست شما منقضی شده است.');
    }

    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || 'خطایی رخ داد.');
    }

    return payload;
  }

  /* ----------------------------------------------------------------- *
   * Login page
   * ----------------------------------------------------------------- */

  function initLoginPage() {
    if (window.ThemeManager) window.ThemeManager.init();

    const form = document.getElementById('login-form');
    const errorBox = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-btn');

    form.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      errorBox.hidden = true;
      submitBtn.disabled = true;

      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      try {
        await callApi('auth.php?action=login', {
          method: 'POST',
          body: { username, password }
        });
        window.location.href = 'dashboard.html';
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
        submitBtn.disabled = false;
      }
    });
  }

  /* ----------------------------------------------------------------- *
   * Dashboard page
   * ----------------------------------------------------------------- */

  const dashboardState = {
    csrfToken: null,
    categories: [],
    links: [],
    searchQuery: '',
    categoryFilter: '',
    pendingDeleteId: null,
    dragSourceId: null
  };

  const dashEls = {};

  function cacheDashboardElements() {
    dashEls.usernameLabel = document.getElementById('admin-username-label');
    dashEls.themeToggle = document.getElementById('theme-toggle');
    dashEls.logoutBtn = document.getElementById('logout-btn');
    dashEls.searchInput = document.getElementById('search-input');
    dashEls.categoryFilter = document.getElementById('category-filter');
    dashEls.addLinkBtn = document.getElementById('add-link-btn');
    dashEls.tbody = document.getElementById('links-tbody');
    dashEls.emptyMessage = document.getElementById('empty-message');

    dashEls.linkModal = document.getElementById('link-modal');
    dashEls.linkForm = document.getElementById('link-form');
    dashEls.linkModalTitle = document.getElementById('link-modal-title');
    dashEls.linkId = document.getElementById('link-id');
    dashEls.fieldTitle = document.getElementById('field-title');
    dashEls.fieldDescription = document.getElementById('field-description');
    dashEls.fieldUrl = document.getElementById('field-url');
    dashEls.fieldCategory = document.getElementById('field-category');
    dashEls.fieldIcon = document.getElementById('field-icon');
    dashEls.fieldOrder = document.getElementById('field-order');
    dashEls.fieldEnabled = document.getElementById('field-enabled');
    dashEls.fieldFavoriteAllowed = document.getElementById('field-favorite-allowed');
    dashEls.formError = document.getElementById('form-error');
    dashEls.cancelFormBtn = document.getElementById('cancel-form-btn');

    dashEls.confirmModal = document.getElementById('confirm-modal');
    dashEls.confirmYesBtn = document.getElementById('confirm-yes-btn');
    dashEls.confirmNoBtn = document.getElementById('confirm-no-btn');
  }

  /** Escapes text for safe insertion into innerHTML. */
  function escapeHTML(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  async function requireAuthOrRedirect() {
    try {
      const result = await callApi('auth.php?action=check');
      if (!result.authenticated) {
        window.location.href = 'login.html';
        return false;
      }
      dashboardState.csrfToken = result.csrfToken;
      dashEls.usernameLabel.textContent = result.username || '';
      return true;
    } catch (err) {
      window.location.href = 'login.html';
      return false;
    }
  }

  function populateIconOptions() {
    dashEls.fieldIcon.innerHTML = AVAILABLE_ICONS
      .map((icon) => `<option value="${icon}">${icon}</option>`)
      .join('');
  }

  function populateCategoryOptions() {
    const optionsHtml = dashboardState.categories
      .map((cat) => `<option value="${escapeHTML(cat.id)}">${escapeHTML(cat.title)}</option>`)
      .join('');
    dashEls.fieldCategory.innerHTML = optionsHtml;
    dashEls.categoryFilter.innerHTML = '<option value="">همه دسته‌ها</option>' + optionsHtml;
  }

  function categoryTitle(categoryId) {
    const found = dashboardState.categories.find((c) => c.id === categoryId);
    return found ? found.title : categoryId;
  }

  async function loadLinks() {
    const result = await callApi('links.php?action=list');
    dashboardState.categories = result.data.categories || [];
    dashboardState.links = result.data.links || [];
    populateCategoryOptions();
    renderTable();
  }

  function getFilteredLinks() {
    const query = dashboardState.searchQuery.trim().toLowerCase();
    return dashboardState.links.filter((link) => {
      if (dashboardState.categoryFilter && link.category !== dashboardState.categoryFilter) {
        return false;
      }
      if (!query) return true;
      const haystack = [link.title, link.description, categoryTitle(link.category)]
        .join(' | ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderTable() {
    const links = getFilteredLinks().slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    dashEls.tbody.innerHTML = '';
    dashEls.emptyMessage.hidden = links.length > 0;

    links.forEach((link, index) => {
      const row = document.createElement('tr');
      row.dataset.linkId = link.id;
      row.draggable = true;

      row.innerHTML = `
        <td><span class="admin-drag-handle" title="جابجایی">⠿</span></td>
        <td>${index + 1}</td>
        <td>${escapeHTML(link.title)}</td>
        <td class="admin-table__desc">${escapeHTML(link.description || '')}</td>
        <td>${escapeHTML(categoryTitle(link.category))}</td>
        <td class="admin-table__url">${escapeHTML(link.url)}</td>
        <td>${escapeHTML(link.icon || '')}</td>
        <td>${escapeHTML(String(link.order ?? 0))}</td>
        <td><span class="admin-badge ${link.enabled ? 'admin-badge--enabled' : 'admin-badge--disabled'}">${link.enabled ? 'فعال' : 'غیرفعال'}</span></td>
      `;

      const actionsCell = document.createElement('td');
      actionsCell.className = 'admin-row-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.title = 'ویرایش';
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      editBtn.addEventListener('click', () => openLinkModal(link));

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.title = link.enabled ? 'غیرفعال کردن' : 'فعال کردن';
      toggleBtn.innerHTML = link.enabled
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12l3 3 5-6"/></svg>';
      toggleBtn.addEventListener('click', () => toggleLinkEnabled(link));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.title = 'حذف';
      deleteBtn.className = 'admin-row-actions__delete';
      deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';
      deleteBtn.addEventListener('click', () => openDeleteConfirm(link.id));

      actionsCell.append(editBtn, toggleBtn, deleteBtn);
      row.appendChild(actionsCell);

      bindRowDragEvents(row);
      dashEls.tbody.appendChild(row);
    });
  }

  /* ----------------------------------------------------------------- *
   * Drag & drop reordering (native HTML5 DnD, no external library)
   * ----------------------------------------------------------------- */

  function bindRowDragEvents(row) {
    row.addEventListener('dragstart', (evt) => {
      dashboardState.dragSourceId = row.dataset.linkId;
      row.classList.add('is-dragging');
      evt.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      dashEls.tbody.querySelectorAll('tr').forEach((r) => {
        r.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });

    row.addEventListener('dragover', (evt) => {
      evt.preventDefault();
      const rect = row.getBoundingClientRect();
      const isTopHalf = evt.clientY - rect.top < rect.height / 2;
      row.classList.toggle('drag-over-top', isTopHalf);
      row.classList.toggle('drag-over-bottom', !isTopHalf);
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    row.addEventListener('drop', async (evt) => {
      evt.preventDefault();
      row.classList.remove('drag-over-top', 'drag-over-bottom');

      const sourceId = dashboardState.dragSourceId;
      const targetId = row.dataset.linkId;
      if (!sourceId || sourceId === targetId) return;

      const rect = row.getBoundingClientRect();
      const insertAfter = evt.clientY - rect.top >= rect.height / 2;
      await reorderLinks(sourceId, targetId, insertAfter);
    });
  }

  /**
   * Moves sourceId next to targetId in the currently-filtered/sorted
   * list, recomputes sequential `order` values for that list, and
   * persists them.
   * @param {string} sourceId
   * @param {string} targetId
   * @param {boolean} insertAfter
   */
  async function reorderLinks(sourceId, targetId, insertAfter) {
    const visibleLinks = getFilteredLinks().slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const fromIndex = visibleLinks.findIndex((l) => l.id === sourceId);
    let toIndex = visibleLinks.findIndex((l) => l.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = visibleLinks.splice(fromIndex, 1);
    toIndex = visibleLinks.findIndex((l) => l.id === targetId);
    visibleLinks.splice(insertAfter ? toIndex + 1 : toIndex, 0, moved);

    const orderPayload = visibleLinks.map((link, index) => ({ id: link.id, order: index + 1 }));

    try {
      await callApi('links.php?action=reorder', {
        method: 'POST',
        body: { csrfToken: dashboardState.csrfToken, order: orderPayload }
      });
      orderPayload.forEach(({ id, order }) => {
        const link = dashboardState.links.find((l) => l.id === id);
        if (link) link.order = order;
      });
      renderTable();
      showToast('ترتیب لینک‌ها ذخیره شد.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  /* ----------------------------------------------------------------- *
   * Create / edit modal
   * ----------------------------------------------------------------- */

  function openLinkModal(link) {
    dashEls.formError.hidden = true;
    dashEls.linkForm.reset();

    if (link) {
      dashEls.linkModalTitle.textContent = 'ویرایش لینک';
      dashEls.linkId.value = link.id;
      dashEls.fieldTitle.value = link.title || '';
      dashEls.fieldDescription.value = link.description || '';
      dashEls.fieldUrl.value = link.url || '';
      dashEls.fieldCategory.value = link.category || '';
      dashEls.fieldIcon.value = link.icon || AVAILABLE_ICONS[0];
      dashEls.fieldOrder.value = String(link.order ?? 0);
      dashEls.fieldEnabled.checked = Boolean(link.enabled);
      dashEls.fieldFavoriteAllowed.checked = link.favoriteAllowed !== false;
    } else {
      dashEls.linkModalTitle.textContent = 'لینک جدید';
      dashEls.linkId.value = '';
      dashEls.fieldCategory.value = dashboardState.categories[0]?.id || '';
      dashEls.fieldIcon.value = AVAILABLE_ICONS[0];
      dashEls.fieldOrder.value = String(dashboardState.links.length + 1);
      dashEls.fieldEnabled.checked = true;
      dashEls.fieldFavoriteAllowed.checked = true;
    }

    dashEls.linkModal.hidden = false;
    dashEls.fieldTitle.focus();
  }

  function closeLinkModal() {
    dashEls.linkModal.hidden = true;
  }

  async function handleLinkFormSubmit(evt) {
    evt.preventDefault();
    dashEls.formError.hidden = true;

    const isEdit = Boolean(dashEls.linkId.value);
    const payload = {
      csrfToken: dashboardState.csrfToken,
      title: dashEls.fieldTitle.value,
      description: dashEls.fieldDescription.value,
      url: dashEls.fieldUrl.value,
      category: dashEls.fieldCategory.value,
      icon: dashEls.fieldIcon.value,
      order: Number(dashEls.fieldOrder.value) || 0,
      enabled: dashEls.fieldEnabled.checked,
      favoriteAllowed: dashEls.fieldFavoriteAllowed.checked
    };
    if (isEdit) payload.id = dashEls.linkId.value;

    const saveBtn = document.getElementById('save-link-btn');
    saveBtn.disabled = true;

    try {
      await callApi(`links.php?action=${isEdit ? 'update' : 'create'}`, {
        method: 'POST',
        body: payload
      });
      closeLinkModal();
      showToast(isEdit ? 'لینک ذخیره شد.' : 'لینک جدید ایجاد شد.', 'success');
      await loadLinks();
    } catch (err) {
      dashEls.formError.textContent = err.message;
      dashEls.formError.hidden = false;
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function toggleLinkEnabled(link) {
    try {
      await callApi('links.php?action=toggle', {
        method: 'POST',
        body: { csrfToken: dashboardState.csrfToken, id: link.id, enabled: !link.enabled }
      });
      link.enabled = !link.enabled;
      renderTable();
      showToast('تغییرات اعمال شد.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  /* ----------------------------------------------------------------- *
   * Delete confirmation modal
   * ----------------------------------------------------------------- */

  function openDeleteConfirm(linkId) {
    dashboardState.pendingDeleteId = linkId;
    dashEls.confirmModal.hidden = false;
  }

  function closeDeleteConfirm() {
    dashboardState.pendingDeleteId = null;
    dashEls.confirmModal.hidden = true;
  }

  async function confirmDelete() {
    const id = dashboardState.pendingDeleteId;
    if (!id) return;

    try {
      await callApi('links.php?action=delete', {
        method: 'POST',
        body: { csrfToken: dashboardState.csrfToken, id }
      });
      closeDeleteConfirm();
      showToast('لینک حذف شد.', 'success');
      await loadLinks();
    } catch (err) {
      closeDeleteConfirm();
      showToast(err.message, 'danger');
    }
  }

  /* ----------------------------------------------------------------- *
   * Bootstrap
   * ----------------------------------------------------------------- */

  function bindDashboardEvents() {
    dashEls.themeToggle.addEventListener('click', () => window.ThemeManager.toggle());

    dashEls.logoutBtn.addEventListener('click', async () => {
      try {
        await callApi('auth.php?action=logout', { method: 'POST', body: {} });
      } finally {
        window.location.href = 'login.html';
      }
    });

    dashEls.searchInput.addEventListener('input', (evt) => {
      dashboardState.searchQuery = evt.target.value;
      renderTable();
    });

    dashEls.categoryFilter.addEventListener('change', (evt) => {
      dashboardState.categoryFilter = evt.target.value;
      renderTable();
    });

    dashEls.addLinkBtn.addEventListener('click', () => openLinkModal(null));
    dashEls.cancelFormBtn.addEventListener('click', closeLinkModal);
    dashEls.linkForm.addEventListener('submit', handleLinkFormSubmit);

    dashEls.confirmYesBtn.addEventListener('click', confirmDelete);
    dashEls.confirmNoBtn.addEventListener('click', closeDeleteConfirm);
  }

  async function initDashboardPage() {
    if (window.ThemeManager) window.ThemeManager.init();
    cacheDashboardElements();

    const isAuthenticated = await requireAuthOrRedirect();
    if (!isAuthenticated) return;

    populateIconOptions();
    bindDashboardEvents();

    try {
      await loadLinks();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  /* ----------------------------------------------------------------- *
   * Entry point: detect which page we're on.
   * ----------------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('login-form')) {
      initLoginPage();
    } else if (document.getElementById('links-tbody')) {
      initDashboardPage();
    }
  });
})();
