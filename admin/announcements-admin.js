/**
 * announcements-admin.js
 * -----------------------------------------------------------------------
 * Admin panel logic for admin/announcements.html — the v2.0 companion
 * to admin.js (which still owns login.html + dashboard.html/links).
 * Kept as its own file rather than folded into admin.js: the two pages
 * share almost no state, and admin.js already documents why each admin
 * page carries its own small, self-contained copy of the toast/fetch
 * helpers instead of importing a shared module across page boundaries.
 * -----------------------------------------------------------------------
 */

(() => {
  'use strict';

  const API_BASE = '../api/';
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB, mirrors api/bootstrap.php

  const state = {
    csrfToken: null,
    announcements: [],
    searchQuery: '',
    statusFilter: '',
    sortMode: 'updatedDesc',
    pendingDeleteId: null,
    pendingImagePath: null, // set once an upload for the open form succeeds
    isUploading: false
  };

  const els = {};

  /* ----------------------------------------------------------------- *
   * Shared: toast + fetch helpers (see file header for why this is a
   * small standalone copy rather than a shared import).
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

  /**
   * @param {string} action e.g. 'announcement.php?action=list'
   * @param {Object} [options]
   * @returns {Promise<Object>} parsed JSON response
   */
  async function callApi(action, options = {}) {
    const isFormData = options.body instanceof FormData;
    const response = await fetch(API_BASE + action, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body && !isFormData ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined
    });

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error('پاسخ سرور نامعتبر بود.');
    }

    if (response.status === 401) {
      window.location.href = '../index.html?login=1&next=' + encodeURIComponent(window.location.pathname + window.location.search);
      throw new Error('نشست شما منقضی شده است.');
    }

    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || 'خطایی رخ داد.');
    }

    return payload;
  }

  /** Escapes text for safe insertion into innerHTML. */
  function escapeHTML(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  /* ----------------------------------------------------------------- *
   * Bootstrap
   * ----------------------------------------------------------------- */

  function cacheElements() {
    els.usernameLabel = document.getElementById('admin-username-label');
    els.themeToggle = document.getElementById('theme-toggle');
    els.logoutBtn = document.getElementById('logout-btn');

    els.searchInput = document.getElementById('search-input');
    els.statusFilter = document.getElementById('status-filter');
    els.sortSelect = document.getElementById('sort-select');
    els.addBtn = document.getElementById('add-announcement-btn');
    els.tbody = document.getElementById('announcements-tbody');
    els.emptyMessage = document.getElementById('empty-message');

    els.modal = document.getElementById('announcement-modal');
    els.form = document.getElementById('announcement-form');
    els.modalTitle = document.getElementById('announcement-modal-title');
    els.fieldId = document.getElementById('field-id');
    els.fieldImagePath = document.getElementById('field-image-path');
    els.fieldTitle = document.getElementById('field-title');
    els.fieldType = document.getElementById('field-type');
    els.messageFieldWrap = document.getElementById('message-field-wrap');
    els.fieldMessage = document.getElementById('field-message');
    els.imageFieldWrap = document.getElementById('image-field-wrap');
    els.fieldImageFile = document.getElementById('field-image-file');
    els.uploadStatus = document.getElementById('upload-status');
    els.imagePreview = document.getElementById('image-preview');
    els.fieldPriority = document.getElementById('field-priority');
    els.fieldStartDate = document.getElementById('field-start-date');
    els.fieldEndDate = document.getElementById('field-end-date');
    els.fieldEnabled = document.getElementById('field-enabled');
    els.fieldDismissible = document.getElementById('field-dismissible');
    els.fieldShowOnce = document.getElementById('field-show-once');
    els.fieldPopupMode = document.getElementById('field-popup-mode');
    els.formError = document.getElementById('form-error');
    els.cancelFormBtn = document.getElementById('cancel-form-btn');
    els.saveBtn = document.getElementById('save-announcement-btn');

    els.confirmModal = document.getElementById('confirm-modal');
    els.confirmYesBtn = document.getElementById('confirm-yes-btn');
    els.confirmNoBtn = document.getElementById('confirm-no-btn');
  }

  async function requireAuthOrRedirect() {
    try {
      const result = await callApi('auth.php?action=check');
      if (!result.authenticated) {
        window.location.href = '../index.html?login=1&next=' + encodeURIComponent(window.location.pathname + window.location.search);
        return false;
      }
      state.csrfToken = result.csrfToken;
      els.usernameLabel.textContent = result.username || '';
      return true;
    } catch (err) {
      window.location.href = '../index.html?login=1&next=' + encodeURIComponent(window.location.pathname + window.location.search);
      return false;
    }
  }

  /* ----------------------------------------------------------------- *
   * Status + rendering
   * ----------------------------------------------------------------- */

  const PRIORITY_LABELS = { normal: 'عادی', important: 'مهم', critical: 'بحرانی' };
  const TYPE_LABELS = { text: 'فقط متن', image: 'فقط تصویر', 'text-image': 'متن + تصویر' };
  const PRIORITY_ORDER = { critical: 0, important: 1, normal: 2 };

  /* ----------------------------------------------------------------- *
   * Timezone-explicit date utilities.
   *
   * BUG FIX: this file used to do `new Date(ann.endDate)` on stored
   * strings like "2026-08-28T11:00:00" (no timezone designator). Per
   * the ECMAScript spec, a date-time string with no offset is parsed
   * as the BROWSER'S LOCAL TIMEZONE, not Asia/Tehran — so on any
   * machine not set to Iran's timezone (very plausible: the PHP
   * container itself defaults to UTC), the displayed time — and near
   * midnight, even the displayed Jalali day — was wrong, and the
   * active/expired boundary was shifted by the same offset.
   *
   * Fix: never construct a Date from the stored string. Read its
   * year/month/day/hour/minute digits directly via regex (the string
   * already represents Tehran wall-clock time, so no timezone math is
   * needed to use those digits), and get "now" via Intl.DateTimeFormat
   * with an EXPLICIT timeZone: 'Asia/Tehran' — which, unlike `new
   * Date()` + local formatting, is never influenced by the viewing
   * browser's own OS/timezone setting.
   * ----------------------------------------------------------------- */

  /**
   * @param {string} value e.g. "2026-08-28T11:00:00"
   * @returns {{year:number, month:number, day:number, hour:number, minute:number}|null}
   */
  function parseStoredDateTimeParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value || '');
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5])
    };
  }

  /**
   * Current wall-clock time in Asia/Tehran, read explicitly via Intl
   * — deliberately NOT `new Date()` + local formatting, which would
   * silently use the browser's own timezone instead.
   * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number}}
   */
  function getTehranNowParts() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return {
      year: get('year'), month: get('month'), day: get('day'),
      hour: get('hour'), minute: get('minute'), second: get('second')
    };
  }

  /** Zero-padded "YYYY-MM-DDTHH:mm:ss" — lexicographic order == chronological order. */
  function partsToComparableString(parts) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second || 0)}`;
  }

  /**
   * Compares a stored date-time string against the current moment in
   * Asia/Tehran, without ever touching a Date object.
   * @param {string} storedValue
   * @returns {-1|0|1} -1 if storedValue is in the past, 1 if in the future, 0 if unparseable
   */
  function compareStoredToTehranNow(storedValue) {
    const parts = parseStoredDateTimeParts(storedValue);
    if (!parts) return 0;
    const stored = partsToComparableString(parts);
    const now = partsToComparableString(getTehranNowParts());
    if (stored < now) return -1;
    if (stored > now) return 1;
    return 0;
  }

  /** Plain lexicographic string compare — used for sorting two stored date-time strings. */
  function compareStrings(a, b) {
    const x = a || '';
    const y = b || '';
    if (x < y) return -1;
    if (x > y) return 1;
    return 0;
  }

  /**
   * Gregorian -> Jalali conversion for a plain (year, month, day) —
   * same algorithm as toJalali() in assets/js/app.js, adapted to take
   * numbers directly instead of a Date object, since we deliberately
   * never construct a Date from the stored string (see file header).
   * @param {number} gy @param {number} gm @param {number} gd
   * @returns {{year:number, month:number, day:number}}
   */
  function gregorianToJalali(gy, gm, gd) {
    const gDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const isLeapGregorian = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

    const gy2 = gm > 2 ? gy + 1 : gy;
    let days =
      355666 +
      365 * gy +
      Math.floor((gy2 + 3) / 4) -
      Math.floor((gy2 + 99) / 100) +
      Math.floor((gy2 + 399) / 400) +
      gd +
      gDaysInMonth.slice(0, gm - 1).reduce((a, b) => a + b, 0);
    if (gm > 2 && isLeapGregorian(gy)) days += 1;

    let jy = -1595 + 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      jy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }

    let jm, jd;
    if (days < 186) {
      jm = 1 + Math.floor(days / 31);
      jd = 1 + (days % 31);
    } else {
      jm = 7 + Math.floor((days - 186) / 30);
      jd = 1 + ((days - 186) % 30);
    }

    return { year: jy, month: jm, day: jd };
  }

  /**
   * Computes one of the three statuses the spec asks for. An
   * announcement scheduled for the future (startDate hasn't arrived
   * yet) is still reported as "active" here — it's correctly
   * configured and will start showing on its own — but the row's
   * title attribute (see renderTable) spells that out so it's never
   * ambiguous to the admin.
   * @param {Object} ann
   * @returns {'active'|'expired'|'disabled'}
   */
  function computeStatus(ann) {
    if (!ann.enabled) return 'disabled';
    if (compareStoredToTehranNow(ann.endDate) < 0) return 'expired';
    return 'active';
  }

  const STATUS_LABELS = { active: 'فعال', expired: 'منقضی‌شده', disabled: 'غیرفعال' };

  /** Formats a stored date-time string as Jalali, e.g. "1405/06/06 11:00". */
  function formatDateRange(ann) {
    const fmt = (value) => {
      const parts = parseStoredDateTimeParts(value);
      if (!parts) return '—';
      const jalali = gregorianToJalali(parts.year, parts.month, parts.day);
      const pad = (n) => String(n).padStart(2, '0');
      return `${jalali.year}/${pad(jalali.month)}/${pad(jalali.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
    };
    return `${fmt(ann.startDate)} تا ${fmt(ann.endDate)}`;
  }

  function getFilteredSortedAnnouncements() {
    const q = state.searchQuery.trim().toLowerCase();

    let list = state.announcements.filter((ann) => {
      const matchesQuery =
        !q || ann.title.toLowerCase().includes(q) || (ann.message || '').toLowerCase().includes(q);
      const matchesStatus = !state.statusFilter || computeStatus(ann) === state.statusFilter;
      return matchesQuery && matchesStatus;
    });

    // Sorting compares two STORED strings to each other (not to "now"),
    // and since they're all zero-padded "YYYY-MM-DDTHH:mm:ss", plain
    // string comparison is already exact chronological order — no
    // Date object needed here either.
    list = list.slice().sort((a, b) => {
      switch (state.sortMode) {
        case 'createdDesc':
          return compareStrings(b.createdAt, a.createdAt);
        case 'priority':
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        case 'startDate':
          return compareStrings(a.startDate, b.startDate);
        case 'updatedDesc':
        default:
          return compareStrings(b.updatedAt, a.updatedAt);
      }
    });

    return list;
  }

  function renderTable() {
    const list = getFilteredSortedAnnouncements();
    els.tbody.innerHTML = '';
    els.emptyMessage.hidden = list.length > 0;

    list.forEach((ann) => {
      const status = computeStatus(ann);
      const notYetStarted = status === 'active' && compareStoredToTehranNow(ann.startDate) > 0;

      const tr = document.createElement('tr');
      if (notYetStarted) {
        tr.title = 'این اعلان هنوز شروع نشده — از تاریخ شروع به‌صورت خودکار نمایش داده می‌شود.';
      }

      const optionTags = [
        ann.popupMode ? 'Popup' : 'Banner',
        ann.dismissible ? 'قابل بستن' : 'غیرقابل بستن',
        ann.showOnce ? 'یک‌بار' : null
      ].filter(Boolean).map((t) => `<span class="admin-option-tag">${escapeHTML(t)}</span>`).join('');

      const badgeClass = status === 'active' ? 'admin-badge--enabled' : status === 'expired' ? 'admin-badge--expired' : 'admin-badge--disabled';

      tr.innerHTML = `
        <td>${escapeHTML(ann.title)}</td>
        <td>${escapeHTML(TYPE_LABELS[ann.type] || ann.type)}</td>
        <td><span class="admin-badge admin-badge--priority-${escapeHTML(ann.priority)}">${escapeHTML(PRIORITY_LABELS[ann.priority] || ann.priority)}</span></td>
        <td>${escapeHTML(formatDateRange(ann))}</td>
        <td><div class="admin-option-tags">${optionTags}</div></td>
        <td><span class="admin-badge ${badgeClass}">${STATUS_LABELS[status]}</span></td>
        <td>
          <div class="admin-row-actions">
            <button type="button" class="admin-row-actions__edit" title="ویرایش" aria-label="ویرایش">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button type="button" class="admin-row-actions__toggle" title="${ann.enabled ? 'غیرفعال کردن' : 'فعال کردن'}" aria-label="تغییر وضعیت">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ann.enabled ? '<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>' : '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'}</svg>
            </button>
            <button type="button" class="admin-row-actions__delete" title="حذف" aria-label="حذف">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>
            </button>
          </div>
        </td>
      `;

      tr.querySelector('.admin-row-actions__edit').addEventListener('click', () => openEditModal(ann));
      tr.querySelector('.admin-row-actions__toggle').addEventListener('click', () => toggleEnabled(ann));
      tr.querySelector('.admin-row-actions__delete').addEventListener('click', () => openDeleteConfirm(ann.id));

      els.tbody.appendChild(tr);
    });
  }

  async function loadAnnouncements() {
    const result = await callApi('announcement.php?action=list');
    state.announcements = result.data.announcements || [];
    renderTable();
  }

  /* ----------------------------------------------------------------- *
   * Create / edit modal
   * ----------------------------------------------------------------- */

  /** Shows/hides the message and image fields based on the selected type. */
  function syncFieldVisibility() {
    const type = els.fieldType.value;
    els.messageFieldWrap.hidden = type === 'image';
    els.imageFieldWrap.hidden = type === 'text';
  }

  function resetForm() {
    els.form.reset();
    els.fieldId.value = '';
    els.fieldImagePath.value = '';
    state.pendingImagePath = null;
    els.uploadStatus.hidden = true;
    els.imagePreview.hidden = true;
    els.imagePreview.removeAttribute('src');
    els.formError.hidden = true;
    syncFieldVisibility();
  }

  /** @param {string} isoValue e.g. "2026-08-01T09:00:00" @returns {string} value datetime-local inputs accept */
  function toDatetimeLocalValue(isoValue) {
    return (isoValue || '').slice(0, 16);
  }

  /** @param {string} localValue e.g. "2026-08-01T09:00" from a datetime-local input @returns {string} */
  function fromDatetimeLocalValue(localValue) {
    return localValue.length === 16 ? `${localValue}:00` : localValue;
  }

  function openCreateModal() {
    resetForm();
    els.modalTitle.textContent = 'اعلان جدید';
    els.modal.hidden = false;
    els.fieldTitle.focus();
  }

  function openEditModal(ann) {
    resetForm();
    els.modalTitle.textContent = 'ویرایش اعلان';
    els.fieldId.value = ann.id;
    els.fieldTitle.value = ann.title;
    els.fieldType.value = ann.type;
    els.fieldMessage.value = ann.message || '';
    els.fieldPriority.value = ann.priority;
    els.fieldStartDate.value = toDatetimeLocalValue(ann.startDate);
    els.fieldEndDate.value = toDatetimeLocalValue(ann.endDate);
    els.fieldEnabled.checked = ann.enabled;
    els.fieldDismissible.checked = ann.dismissible;
    els.fieldShowOnce.checked = ann.showOnce;
    els.fieldPopupMode.checked = ann.popupMode;

    if (ann.image) {
      els.fieldImagePath.value = ann.image;
      state.pendingImagePath = ann.image;
      els.imagePreview.src = `../${ann.image}`;
      els.imagePreview.hidden = false;
    }

    syncFieldVisibility();
    els.modal.hidden = false;
    els.fieldTitle.focus();
  }

  function closeModal() {
    els.modal.hidden = true;
  }

  /** Uploads the just-selected image immediately, so its path is ready by submit time. */
  async function handleImageFileChange() {
    const file = els.fieldImageFile.files[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('حجم تصویر نباید بیشتر از ۵ مگابایت باشد.', 'danger');
      els.fieldImageFile.value = '';
      return;
    }

    // Instant local preview while the real upload is in flight.
    const localUrl = URL.createObjectURL(file);
    els.imagePreview.src = localUrl;
    els.imagePreview.hidden = false;

    els.uploadStatus.hidden = false;
    els.uploadStatus.textContent = 'در حال آپلود...';
    state.isUploading = true;
    els.saveBtn.disabled = true;

    const formData = new FormData();
    formData.append('image', file);
    formData.append('csrfToken', state.csrfToken);

    try {
      const result = await callApi('announcement.php?action=upload', { method: 'POST', body: formData });
      state.pendingImagePath = result.path;
      els.fieldImagePath.value = result.path;
      els.uploadStatus.textContent = 'آپلود انجام شد.';
    } catch (err) {
      showToast(err.message, 'danger');
      els.uploadStatus.textContent = 'آپلود ناموفق بود.';
      state.pendingImagePath = null;
    } finally {
      state.isUploading = false;
      els.saveBtn.disabled = false;
      URL.revokeObjectURL(localUrl);
    }
  }

  async function handleFormSubmit(evt) {
    evt.preventDefault();
    els.formError.hidden = true;

    if (state.isUploading) {
      els.formError.textContent = 'لطفاً تا پایان آپلود تصویر صبر کنید.';
      els.formError.hidden = false;
      return;
    }

    const type = els.fieldType.value;
    if ((type === 'image' || type === 'text-image') && !state.pendingImagePath) {
      els.formError.textContent = 'برای این نوع اعلان، ابتدا یک تصویر آپلود کنید.';
      els.formError.hidden = false;
      return;
    }

    const payload = {
      csrfToken: state.csrfToken,
      title: els.fieldTitle.value.trim(),
      message: els.fieldMessage.value.trim(),
      image: state.pendingImagePath,
      type,
      priority: els.fieldPriority.value,
      startDate: fromDatetimeLocalValue(els.fieldStartDate.value),
      endDate: fromDatetimeLocalValue(els.fieldEndDate.value),
      enabled: els.fieldEnabled.checked,
      dismissible: els.fieldDismissible.checked,
      showOnce: els.fieldShowOnce.checked,
      popupMode: els.fieldPopupMode.checked
    };

    const isEdit = Boolean(els.fieldId.value);
    if (isEdit) payload.id = els.fieldId.value;

    els.saveBtn.disabled = true;
    try {
      if (isEdit) {
        await callApi('announcement.php?action=update', { method: 'PUT', body: payload });
        showToast('ویرایش شد.');
      } else {
        await callApi('announcement.php?action=create', { method: 'POST', body: payload });
        showToast('ذخیره شد.');
      }
      closeModal();
      await loadAnnouncements();
    } catch (err) {
      els.formError.textContent = err.message;
      els.formError.hidden = false;
    } finally {
      els.saveBtn.disabled = false;
    }
  }

  async function toggleEnabled(ann) {
    try {
      await callApi('announcement.php?action=toggle', {
        method: 'POST',
        body: { csrfToken: state.csrfToken, id: ann.id, enabled: !ann.enabled }
      });
      showToast(ann.enabled ? 'غیرفعال شد.' : 'فعال شد.');
      await loadAnnouncements();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  function openDeleteConfirm(id) {
    state.pendingDeleteId = id;
    els.confirmModal.hidden = false;
  }

  async function confirmDelete() {
    const id = state.pendingDeleteId;
    els.confirmModal.hidden = true;
    if (!id) return;

    try {
      await callApi('announcement.php?action=delete', {
        method: 'DELETE',
        body: { csrfToken: state.csrfToken, id }
      });
      showToast('حذف شد.');
      await loadAnnouncements();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      state.pendingDeleteId = null;
    }
  }

  /* ----------------------------------------------------------------- *
   * Wiring
   * ----------------------------------------------------------------- */

  function bindEvents() {
    els.logoutBtn.addEventListener('click', async () => {
      try {
        await callApi('auth.php?action=logout', { method: 'POST', body: {} });
      } finally {
        window.location.href = '../index.html';
      }
    });

    els.searchInput.addEventListener('input', (evt) => {
      state.searchQuery = evt.target.value;
      renderTable();
    });
    els.statusFilter.addEventListener('change', (evt) => {
      state.statusFilter = evt.target.value;
      renderTable();
    });
    els.sortSelect.addEventListener('change', (evt) => {
      state.sortMode = evt.target.value;
      renderTable();
    });

    els.addBtn.addEventListener('click', openCreateModal);
    els.cancelFormBtn.addEventListener('click', closeModal);
    els.modal.addEventListener('click', (evt) => {
      if (evt.target === els.modal) closeModal();
    });
    els.form.addEventListener('submit', handleFormSubmit);
    els.fieldType.addEventListener('change', syncFieldVisibility);
    els.fieldImageFile.addEventListener('change', handleImageFileChange);

    els.confirmNoBtn.addEventListener('click', () => {
      state.pendingDeleteId = null;
      els.confirmModal.hidden = true;
    });
    els.confirmYesBtn.addEventListener('click', confirmDelete);

    els.themeToggle.addEventListener('click', () => window.ThemeManager.toggle());
  }

  async function init() {
    if (window.ThemeManager) window.ThemeManager.init();
    cacheElements();

    const authed = await requireAuthOrRedirect();
    if (!authed) return;

    bindEvents();
    try {
      await loadAnnouncements();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
