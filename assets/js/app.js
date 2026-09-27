/**
 * app.js
 * -----------------------------------------------------------------------
 * Main orchestrator for the Hospital Internal Portal.
 *
 * Responsibilities:
 *   - Fetch data/config.json, data/announcements.json, data/links.json
 *     (always bypassing the HTTP cache so every user gets the latest
 *     content immediately after a deploy).
 *   - Render header (clock, Persian date, search, theme switch).
 *   - Render announcement banner.
 *   - Render Favorites / Recently Used rows.
 *   - Render the category grid from links.json.
 *   - Wire up search, favorites, recent tracking, statistics and toasts.
 *   - Gate link opening behind a live reachability check (link-checker.js)
 *     before navigating, showing a toast instead of opening a dead link.
 *   - Poll for data changes on an interval and hot-swap the UI when the
 *     portal version changes, with no full page reload required.
 *
 * Nothing in this file writes HTML via string concatenation of
 * untrusted data without escaping — all dynamic text goes through
 * `escapeHTML()` or `textContent`.
 * -----------------------------------------------------------------------
 */

(() => {
  'use strict';

  /** Central, mutable application state. */
  const state = {
    config: null,
    announcements: [],
    links: [],
    categories: [],
    categoriesById: new Map(),
    searchQuery: '',
    refreshTimerId: null,
    clockTimerId: null,
    // PART 3/5: link ids currently mid-health-check, so a fast double
    // click never fires two concurrent checks for the same card.
    pendingChecks: new Set()
  };

  const els = {}; // cached DOM references, filled in cacheElements()

  /* ----------------------------------------------------------------- *
   * Utilities
   * ----------------------------------------------------------------- */

  /**
   * Escapes text for safe insertion into innerHTML.
   * @param {string} value
   * @returns {string}
   */
  function escapeHTML(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  /**
   * PART 2: generic banner dismiss helper. Hides any banner element by
   * its DOM id — used by the offline and update banners. (v2.0: the
   * announcement system no longer uses this — announcements.js handles
   * its own dismiss/showOnce persistence per announcement, since there
   * can now be several on screen at once.) Never removes the element,
   * only hides it, so it can be shown again later (e.g. once the
   * network reconnects).
   * @param {string} bannerId
   */
  function dismissBanner(bannerId) {
    const banner = document.getElementById(bannerId);
    if (banner) banner.hidden = true;
  }
  // Exposed on window: index.html markup for offline-banner and
  // update-banner is owned by pwa.js, so this file's generic close
  // wiring (see bindEvents()) attaches directly to those buttons —
  // no changes to pwa.js required.
  window.dismissBanner = dismissBanner;

  // Fetching + change-detection for config/announcement/links/status now
  // lives in data-loader.js (window.DataLoader), shared by this module.

  /* ----------------------------------------------------------------- *
   * Icon library — a small set of inline SVGs, all using currentColor
   * so they inherit color from CSS. Keeps the project dependency-free
   * (no icon font, no external CDN).
   * ----------------------------------------------------------------- */

  const ICONS = {
    'heart-pulse': '<path d="M20.8 8.6c0-2.4-2-4.4-4.4-4.4-1.7 0-3.2 1-4 2.4-.8-1.4-2.3-2.4-4-2.4-2.4 0-4.4 2-4.4 4.4 0 1 .3 1.9.9 2.7L12 20l7.9-8.7c.6-.8.9-1.7.9-2.7Z"/><path d="M6 12h2.5l1.5-3 2 5 1.5-3H16"/>',
    flask: '<path d="M9 3h6M10 3v6l-5.2 8.4A2 2 0 0 0 6.5 20h11a2 2 0 0 0 1.7-2.6L14 9V3"/><path d="M8 14h8"/>',
    bed: '<path d="M3 18v-7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1"/><path d="M13 12h6a2 2 0 0 1 2 2v4"/><path d="M3 18h18"/><path d="M7 11V7a2 2 0 0 1 2-2h2"/>',
    clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 10h6M9 14h6M9 18h3"/>',
    pill: '<rect x="3.5" y="9.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 13)"/><path d="M9 9l6 6"/>',
    camera: '<path d="M4 8h3l1.4-2h7.2L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>',
    microscope: '<path d="M6 20h9"/><path d="M9 20v-3a4 4 0 1 1 4-4"/><path d="M11 8V4h2"/><path d="M8 8h7"/><circle cx="9" cy="20" r="0"/><path d="M16 13l3 3"/>',
    syringe: '<path d="M19 5l-2-2M9 9l6 6M5 19l3-3m-1-8l2-2 3 3-2 2m0 0L4 17l-1 3 3-1 6-6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    'file-text': '<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6M9 9h2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
    'life-buoy': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M6.3 6.3l3.2 3.2M17.7 6.3l-3.2 3.2M6.3 17.7l3.2-3.2M17.7 17.7l-3.2-3.2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 6.5l8.4 6a1 1 0 0 0 1.2 0L21 6.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 5.5v15"/>',
    'book-open': '<path d="M12 6c-1.5-1.5-4-2-7-1.5v13c3 0 5 .5 7 2 2-1.5 4-2 7-2V4.5C16 4 13.5 4.5 12 6Z"/><path d="M12 6v14"/>',
    'shield-check': '<path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6Z"/><path d="M9 12l2 2 4-4"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
    printer: '<path d="M6 9V4h12v5"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M8 17h8v4H8Z"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5V18a8 3 0 0 0 16 0V5.5"/><path d="M4 12a8 3 0 0 0 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c2.4.4 4.5 2.4 4.5 5.8"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    close: '<path d="M5 5l14 14M19 5L5 19"/>',
    'external-link': '<path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    flame: '<path d="M12 2s3 3.5 3 7c1.5-1 2-3 2-3 1.5 2 2 4.5 2 6.5A7 7 0 1 1 5 12.5c0-1.7.7-3 1.5-4.2.3 1 1 1.7 1 1.7C7 7 9 4.5 12 2Z"/>',
    // Added for the updated links.json content set:
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"/>',
    stethoscope: '<path d="M6 4v6a4 4 0 0 0 8 0V4"/><path d="M6 4H4.5M14 4h1.5"/><path d="M18 10v2a6 6 0 0 1-12 0v-2"/><circle cx="18" cy="8" r="2"/>',
    shield: '<path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6Z"/>',
    activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
    'heart-handshake': '<path d="M12 20s-6-4-8.5-8A5 5 0 0 1 12 6a5 5 0 0 1 8.5 6c-2.5 4-8.5 8-8.5 8Z"/><path d="M9 12l1.5 1.5L13 11"/>',
    'clipboard-plus': '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M12 10v6M9 13h6"/>',
    cross: '<rect x="9" y="3" width="6" height="18" rx="2"/><rect x="3" y="9" width="18" height="6" rx="2"/>',
    'alert-triangle': '<path d="M12 3l10 18H2Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    ambulance: '<path d="M3 16V9a1 1 0 0 1 1-1h9l4 4h2a1 1 0 0 1 1 1v3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M10 9v4M8 11h4"/>',
    upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.7"/><path d="M21 16l-5.5-5.5L9 17"/>',
    truck: '<path d="M3 8h11v8H3Z"/><path d="M14 11h4l3 3v2h-7Z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    'bar-chart-3': '<path d="M4 20V10M10 20V4M16 20v-7M4 20h16"/>',
    heart: '<path d="M12 20s-6-4.2-8.5-8.3A5 5 0 0 1 12 6a5 5 0 0 1 8.5 5.7C18 15.8 12 20 12 20Z"/>',
    'badge-check': '<path d="M12 2l2.2 2.2 3-.5.8 3 3 .8-.5 3L22 12l-2.2 2.2.5 3-3 .8-.8 3-3-.5L12 22l-2.2-2.2-3 .5-.8-3-3-.8.5-3L2 12l2.2-2.2-.5-3 3-.8.8-3 3 .5Z"/><path d="M9 12l2 2 4-4"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    briefcase: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    'graduation-cap': '<path d="M2 9l10-5 10 5-10 5Z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9v6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M16 12h3v3h-3a1.5 1.5 0 0 1 0-3Z"/>',
    award: '<circle cx="12" cy="8" r="5"/><path d="M9 12.5L7 21l5-3 5 3-2-8.5"/>',
    'shopping-cart': '<circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/><path d="M3 4h2l2.4 11.5a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L21 8H6"/>',
    repeat: '<path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/>',
    flower: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="12" r="2.5"/>',
    'message-circle': '<path d="M4 12a8 8 0 1 1 3 6.2L4 20l1.3-3.4A8 8 0 0 1 4 12Z"/>'
  };

  /**
   * Returns an inline <svg> string for a named icon, falling back to a
   * generic dot if the icon name is unknown (keeps the UI from
   * breaking if links.json references an icon that hasn't been added
   * to the library yet).
   * @param {string} name
   * @param {string} [cssClass]
   * @returns {string}
   */
  function getIcon(name, cssClass = 'icon') {
    const inner = ICONS[name] || '<circle cx="12" cy="12" r="2"/>';
    return `<svg class="${cssClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  /* ----------------------------------------------------------------- *
   * Persian (Jalali) calendar — small self-contained converter so the
   * header can show today's date without any external library.
   * ----------------------------------------------------------------- */

  const PERSIAN_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];
  const PERSIAN_WEEKDAYS = [
    'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'
  ];

  /**
   * Converts a Gregorian date to the Jalali (Persian) calendar using
   * the standard astronomical algorithm.
   * @param {Date} date
   * @returns {{year:number, month:number, day:number}}
   */
  function toJalali(date) {
    let gy = date.getFullYear();
    let gm = date.getMonth() + 1;
    let gd = date.getDate();

    const gDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const isLeapGregorian = (y) =>
      (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

    let gy2 = gm > 2 ? gy + 1 : gy;
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
   * Formats "now" as a full Persian date + weekday string.
   * @param {Date} date
   * @returns {string}
   */
  function formatPersianDate(date) {
    const { year, month, day } = toJalali(date);
    const weekday = PERSIAN_WEEKDAYS[date.getDay()];
    return `${weekday} ${day} ${PERSIAN_MONTHS[month - 1]} ${year}`;
  }

  /**
   * Formats "now" as HH:MM:SS using Persian digits, matching the RTL
   * design language of the rest of the header.
   * @param {Date} date
   * @returns {string}
   */
  function formatClock(date) {
    const two = (n) => String(n).padStart(2, '0');
    return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
  }

  /* ----------------------------------------------------------------- *
   * Toasts
   * ----------------------------------------------------------------- */

  /**
   * Shows a short-lived toast notification with a manual close (×)
   * button. Closing it early cancels the pending auto-dismiss timer,
   * so there is only ever one removal path per toast (no duplicate
   * timers, no leaked callbacks).
   * @param {string} message
   * @param {'info'|'success'|'warning'|'danger'} [type]
   */
  function showToast(message, type = 'success') {
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
    closeBtn.innerHTML = getIcon('close');

    toast.append(text, closeBtn);
    els.toastContainer.appendChild(toast);

    let autoDismissId = null;

    const dismiss = () => {
      if (autoDismissId) window.clearTimeout(autoDismissId);
      toast.classList.remove('toast--visible');
      window.setTimeout(() => toast.remove(), 250);
    };

    closeBtn.addEventListener('click', dismiss);

    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    autoDismissId = window.setTimeout(dismiss, 2600);
  }

  /* ----------------------------------------------------------------- *
   * Rendering
   * ----------------------------------------------------------------- */

  /**
   * Builds a single link card element.
   * @param {Object} link
   * @param {Object} [options]
   * @param {boolean} [options.compact] render a smaller pill-style card
   * @returns {HTMLElement}
   */
  function buildCard(link, options = {}) {
    const category = state.categoriesById.get(link.category);
    const accent = link.color || (category && category.color) || '#14B8A6';
    const isFav = window.FavoritesManager.isFavorite(link.id);

    const card = document.createElement('article');
    card.className = `card${options.compact ? ' card--compact' : ''}`;
    card.style.setProperty('--accent', accent);
    card.dataset.linkId = link.id;

    if (link.new) {
      const badge = document.createElement('span');
      badge.className = 'card__badge';
      badge.textContent = 'جدید';
      card.appendChild(badge);
    }

    // FEATURE 1 (+ PART 3 live override): a small colored dot overlaid
    // on the existing card, with a hover tooltip. Purely additive: it
    // does not change the card's layout or any other module.
    const statusDisplay = resolveStatusDisplay(link);
    const statusDot = document.createElement('span');
    statusDot.className = `card__status ${statusDisplay.className}`;
    statusDot.setAttribute('data-tooltip', statusDisplay.tooltip);
    statusDot.setAttribute('tabindex', '0');
    statusDot.setAttribute('role', 'status');
    statusDot.setAttribute('aria-label', `وضعیت سیستم: ${statusDisplay.label}`);
    statusDot.addEventListener('click', (evt) => evt.stopPropagation());
    card.appendChild(statusDot);

    const iconWrap = document.createElement('div');
    iconWrap.className = 'card__icon';
    iconWrap.innerHTML = getIcon(link.icon);
    card.appendChild(iconWrap);

    const body = document.createElement('div');
    body.className = 'card__body';

    const title = document.createElement('h3');
    title.className = 'card__title';
    title.textContent = link.title;
    body.appendChild(title);

    if (!options.compact) {
      const desc = document.createElement('p');
      desc.className = 'card__desc';
      desc.textContent = link.description || '';
      body.appendChild(desc);
    }

    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'card__actions';

    if (link.favoriteAllowed) {
      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = `card__fav${isFav ? ' card__fav--active' : ''}`;
      favBtn.setAttribute('aria-pressed', String(isFav));
      favBtn.setAttribute(
        'aria-label',
        isFav ? 'حذف از موردعلاقه‌ها' : 'افزودن به موردعلاقه‌ها'
      );
      favBtn.title = isFav ? 'حذف از موردعلاقه‌ها' : 'افزودن به موردعلاقه‌ها';
      favBtn.innerHTML = getIcon('star', 'icon icon--star');
      favBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        handleFavoriteToggle(link);
      });
      actions.appendChild(favBtn);
    }

    const openBtn = document.createElement('a');
    openBtn.className = 'card__open';
    openBtn.href = link.url;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.setAttribute('aria-label', `باز کردن ${link.title}`);
    openBtn.title = 'باز کردن';
    openBtn.innerHTML = getIcon('external-link');
    // PART 3: run the reachability check before navigating, same as
    // the whole-card click below, instead of opening immediately.
    openBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      handleCardActivate(link);
    });
    actions.appendChild(openBtn);

    card.appendChild(actions);

    // Ripple + whole-card click opens the link too (except when the
    // click originated from one of the action buttons above). PART 3:
    // opening now goes through a live health check first.
    card.addEventListener('click', (evt) => {
      if (evt.target.closest('.card__actions')) return;
      spawnRipple(card, evt);
      handleCardActivate(link);
    });

    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        handleCardActivate(link);
      }
    });

    return card;
  }

  /**
   * Adds a short-lived material ripple element at the click position.
   * @param {HTMLElement} container
   * @param {MouseEvent} evt
   */
  function spawnRipple(container, evt) {
    const rect = container.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const size = Math.max(rect.width, rect.height) * 1.4;
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${evt.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${evt.clientY - rect.top - size / 2}px`;
    container.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  /**
   * v2.0: rendering itself now lives entirely in announcements.js
   * (AnnouncementsManager), which supports multiple simultaneous
   * announcements, images, priorities, and popup/banner display modes
   * — far more than a single function here should own. This is now
   * just a thin call-through so the rest of app.js (data loading,
   * auto-refresh) doesn't need to know those details.
   */
  function renderAnnouncement() {
    window.AnnouncementsManager.render(state.announcements);
  }

  /**
   * Renders a horizontal row section (Favorites / Recently Used).
   * @param {HTMLElement} container
   * @param {Array<Object>} links
   */
  function renderRow(container, links) {
    container.innerHTML = '';
    if (!links.length) {
      container.parentElement.hidden = true;
      return;
    }
    container.parentElement.hidden = false;
    links.forEach((link) => container.appendChild(buildCard(link, { compact: true })));
  }

  /** Renders Favorites / Recently Used rows based on current storage + links. */
  function renderQuickAccessRows() {
    const enabledLinks = state.links.filter((l) => l.enabled);
    const byId = new Map(enabledLinks.map((l) => [l.id, l]));

    const favIds = window.FavoritesManager.getAll();
    const favLinks = favIds.map((id) => byId.get(id)).filter(Boolean);
    renderRow(els.favoritesRow, favLinks);

    const recentIds = window.RecentManager.getAll();
    const recentLinks = recentIds.map((id) => byId.get(id)).filter(Boolean);
    renderRow(els.recentRow, recentLinks);
  }

  /**
   * Renders the full category grid, respecting the current search
   * query (if any).
   */
  function renderCategories() {
    els.categoriesContainer.innerHTML = '';

    const enabledLinks = state.links.filter((l) => l.enabled);
    const filtered = window.SearchEngine.filter(
      enabledLinks,
      state.categoriesById,
      state.searchQuery
    );

    if (state.searchQuery && filtered.length === 0) {
      els.emptyState.hidden = false;
      return;
    }
    els.emptyState.hidden = true;

    const sortedCategories = [...state.categories].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );

    sortedCategories.forEach((category) => {
      const categoryLinks = filtered
        .filter((link) => link.category === category.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      if (categoryLinks.length === 0) return;

      const section = document.createElement('section');
      section.className = 'category';
      section.style.setProperty('--accent', category.color || '#14B8A6');

      const header = document.createElement('div');
      header.className = 'category__header';
      header.innerHTML = `
        <span class="category__icon">${getIcon(category.icon)}</span>
        <h2 class="category__title">${escapeHTML(category.title)}</h2>
        <span class="category__count">${categoryLinks.length}</span>
      `;

      const grid = document.createElement('div');
      grid.className = 'category__grid';
      categoryLinks.forEach((link) => grid.appendChild(buildCard(link)));

      section.append(header, grid);
      els.categoriesContainer.appendChild(section);
    });
  }

  // PART 3: label/class lookup for statuses computed locally from a live
  // LinkChecker result. Intentionally kept local to app.js (not added to
  // status.js) since this update is scoped to only touch app.js,
  // style.css, index.html and the new link-checker.js.
  const LIVE_STATUS_META = Object.freeze({
    online: { label: 'آنلاین', className: 'status--online' },
    slow: { label: 'کند', className: 'status--slow' },
    offline: { label: 'آفلاین', className: 'status--offline' },
    unknown: { label: 'نامشخص', className: 'status--unknown' }
  });

  /**
   * PART 3: merges a live, user-triggered LinkChecker result (if one is
   * still cached for this link's URL) with the periodic status.json
   * data from StatusManager. A live check always takes priority when
   * available, since it is more recent and more specific than the
   * shared status.json snapshot.
   * @param {Object} link
   * @returns {{className:string, label:string, tooltip:string}}
   */
  function resolveStatusDisplay(link) {
    const live = window.LinkChecker.getCached(link.url);

    if (live) {
      const checkedAt = live.checkedAt ? new Date(live.checkedAt) : null;
      const timeText = checkedAt
        ? `${String(checkedAt.getHours()).padStart(2, '0')}:${String(checkedAt.getMinutes()).padStart(2, '0')}`
        : '—';

      // PART 1 (fix): a CORS/opaque-blocked check is NOT the same as a
      // confirmed outage — show it as gray/unverifiable rather than
      // red/offline. See link-checker.js for why this distinction is
      // possible at all.
      if (live.unverifiable) {
        const meta = LIVE_STATUS_META.unknown;
        const tooltip = `آخرین بررسی: ${timeText}\nامکان بررسی وضعیت این سامانه توسط مرورگر وجود ندارد.`;
        return { className: meta.className, label: meta.label, tooltip };
      }

      const key = !live.online
        ? 'offline'
        : (live.responseTime > window.LinkChecker.SLOW_THRESHOLD_MS ? 'slow' : 'online');
      const meta = LIVE_STATUS_META[key];
      const responseTimeText = live.responseTime != null ? `${live.responseTime} ms` : '—';
      const tooltip = `آخرین بررسی: ${timeText}\nوضعیت: ${meta.label}\nزمان پاسخ: ${responseTimeText}\nکد HTTP: ${live.status || '—'}`;

      return { className: meta.className, label: meta.label, tooltip };
    }

    const fallback = window.StatusManager.getMeta(link.id);
    return {
      className: fallback.className,
      label: fallback.label,
      tooltip: window.StatusManager.formatTooltip(link.id)
    };
  }

  /**
   * FEATURE 1 + 2 + PART 4: refreshes only the status dot on every
   * currently rendered card, without touching titles, descriptions or
   * the grid itself — reuses the same resolveStatusDisplay() used for
   * the initial render so there is a single source of truth for status
   * display logic.
   */
  function updateStatusIndicators() {
    document.querySelectorAll('[data-link-id]').forEach((cardEl) => {
      const linkId = cardEl.dataset.linkId;
      const link = state.links.find((l) => l.id === linkId);
      const dot = cardEl.querySelector('.card__status');
      if (!dot || !link) return;

      const display = resolveStatusDisplay(link);
      dot.className = `card__status ${display.className}`;
      dot.setAttribute('data-tooltip', display.tooltip);
      dot.setAttribute('aria-label', `وضعیت سیستم: ${display.label}`);
    });
  }

  /** Re-renders every dynamic part of the page from current state. */
  function renderAll() {
    renderAnnouncement();
    renderQuickAccessRows();
    renderCategories();
    renderFooter();
  }

  /** Renders footer info from config.json. */
  function renderFooter() {
    const cfg = state.config;
    if (!cfg) return;
    els.footerVersion.textContent = `نسخه ${cfg.portalVersion}`;
    els.footerUpdate.textContent = `آخرین به‌روزرسانی: ${cfg.lastUpdate}`;
    els.footerDept.textContent = cfg.footer?.department || '';
    document.title = `${cfg.hospitalName} | پورتال داخلی`;
    els.headerTitle.textContent = cfg.hospitalName;

    // Temporary forms-system button (see index.html comment) — reads
    // its target straight from config.json so IT staff can update the
    // address later without touching any code.
    if (els.formsWidgetLink && cfg.formsSystemUrl) {
      els.formsWidgetLink.href = cfg.formsSystemUrl;
    }
  }

  /* ----------------------------------------------------------------- *
   * Event handlers
   * ----------------------------------------------------------------- */

  function handleFavoriteToggle(link) {
    const nowFav = window.FavoritesManager.toggle(link.id);
    showToast(
      nowFav ? `«${link.title}» به موردعلاقه‌ها افزوده شد` : `«${link.title}» از موردعلاقه‌ها حذف شد`,
      nowFav ? 'success' : 'info'
    );
    renderAll();
  }

  function handleLinkOpened(link) {
    window.RecentManager.record(link.id);
    window.StatisticsManager.increment(link.id);
    renderQuickAccessRows();
  }

  /**
   * PART 3: runs a live reachability check via LinkChecker before
   * actually opening a link. On success (or when the check is merely
   * unverifiable due to CORS — see link-checker.js), behaves exactly
   * like the original click handler: records recent/stats, opens a
   * new tab. Only a *confirmed* offline result or a real timeout
   * blocks the tab and shows a toast instead. PART 5: guarded by
   * state.pendingChecks so a fast double click/tap never fires two
   * concurrent checks for the same card.
   * @param {Object} link
   */
  async function handleCardActivate(link) {
    if (state.pendingChecks.has(link.id)) return;
    state.pendingChecks.add(link.id);

    try {
      const result = await window.LinkChecker.check(link.url);

      // PART 4: a single, lightweight pass over existing dots — never
      // a full renderCategories()/renderAll() just because one link
      // was checked.
      updateStatusIndicators();

      // A CORS-blocked check does not mean the system is down — it
      // just means the browser couldn't verify it. Treat it the same
      // as "online" for the purposes of actually opening the link;
      // the gray dot still tells the person it's unverified.
      if (result.online || result.unverifiable) {
        handleLinkOpened(link);
        window.open(link.url, '_blank', 'noopener,noreferrer');
        return;
      }

      showToast(
        result.timedOut ? 'عدم پاسخگویی سامانه' : 'سامانه در حال حاضر در دسترس نیست.',
        'danger'
      );
    } finally {
      state.pendingChecks.delete(link.id);
    }
  }

  function handleSearchInput(evt) {
    state.searchQuery = evt.target.value;
    els.searchClear.hidden = !state.searchQuery;
    renderCategories();
  }

  function handleThemeToggle() {
    const next = window.ThemeManager.toggle();
    showToast(
      next === 'dark' ? 'حالت تیره فعال شد' : 'حالت روشن فعال شد',
      'info'
    );
  }

  /* ----------------------------------------------------------------- *
   * Data loading + auto refresh
   * ----------------------------------------------------------------- */

  /**
   * Loads all four JSON sources via DataLoader and applies them to
   * local state. Returns the `changed` flags reported by DataLoader so
   * callers can decide whether to do a full render or a partial one.
   * @returns {Promise<Object>} the changed-flags object
   */
  async function loadData() {
    const { config, announcements, links, status, changed } = await window.DataLoader.fetchAll();

    state.config = config;
    state.announcements = announcements.announcements || [];
    state.categories = links.categories || [];
    state.links = links.links || [];
    state.categoriesById = new Map(state.categories.map((c) => [c.id, c]));
    window.StatusManager.ingest(status);

    return changed;
  }

  /** Initial load + first render, with a friendly error state on failure. */
  async function initialLoad() {
    try {
      await loadData();
      renderAll();
      els.loadingOverlay.classList.add('is-hidden');
    } catch (err) {
      console.error('[app] Initial data load failed:', err);
      els.loadingOverlay.classList.add('is-hidden');
      showToast('خطا در بارگذاری اطلاعات پورتال. اتصال شبکه را بررسی کنید.', 'danger');
    }
  }

  /**
   * Polls the JSON sources on the interval configured in config.json.
   * If the portal version changes between polls, the whole UI is
   * re-rendered automatically — no page reload needed.
   */
  function startAutoRefresh() {
    if (state.refreshTimerId) window.clearInterval(state.refreshTimerId);

    const seconds = state.config?.refreshIntervalSeconds || 300;
    state.refreshTimerId = window.setInterval(async () => {
      const previousVersion = state.config?.portalVersion;
      try {
        const changed = await loadData();

        // FEATURE 2: only touch the DOM sections whose backing JSON
        // actually changed — no full-page rebuild on every tick.
        if (changed.announcements) renderAnnouncement();

        if (changed.links) {
          // Links (and therefore cards) changed, so rebuild the grid
          // and quick-access rows; the fresh status data is already
          // baked into buildCard(), so no separate status pass needed.
          renderCategories();
          renderQuickAccessRows();
        } else if (changed.status) {
          // Only the health data changed: update just the status dots.
          updateStatusIndicators();
          renderQuickAccessRows();
        }

        if (changed.config) {
          renderFooter();
          if (previousVersion && state.config.portalVersion !== previousVersion) {
            showToast(`پورتال به نسخه ${state.config.portalVersion} به‌روزرسانی شد`, 'success');
          }
        }
      } catch (err) {
        console.warn('[app] Background refresh failed, will retry next interval.', err);
      }
    }, seconds * 1000);
  }

  /** Starts the header clock + Persian date, ticking every second. */
  function startClock() {
    const tick = () => {
      const now = new Date();
      els.clockTime.textContent = formatClock(now);
      els.clockDate.textContent = formatPersianDate(now);
    };
    tick();
    state.clockTimerId = window.setInterval(tick, 1000);
  }

  /* ----------------------------------------------------------------- *
   * Bootstrap
   * ----------------------------------------------------------------- */

  /** Caches all DOM references used throughout the module. */
  function cacheElements() {
    els.loadingOverlay = document.getElementById('loading-overlay');
    els.headerTitle = document.getElementById('header-title');
    els.clockTime = document.getElementById('clock-time');
    els.clockDate = document.getElementById('clock-date');
    els.themeToggle = document.getElementById('theme-toggle');
    els.searchInput = document.getElementById('search-input');
    els.searchClear = document.getElementById('search-clear');
    els.favoritesSection = document.getElementById('favorites-section');
    els.favoritesRow = document.getElementById('favorites-row');
    els.recentSection = document.getElementById('recent-section');
    els.recentRow = document.getElementById('recent-row');
    els.categoriesContainer = document.getElementById('categories-container');
    els.emptyState = document.getElementById('empty-state');
    els.toastContainer = document.getElementById('toast-container');
    els.footerVersion = document.getElementById('footer-version');
    els.footerUpdate = document.getElementById('footer-update');
    els.footerDept = document.getElementById('footer-dept');
    els.formsWidgetLink = document.getElementById('forms-widget-link');
  }

  /** Wires up all static event listeners (run once). */
  function bindEvents() {
    els.themeToggle.addEventListener('click', handleThemeToggle);
    els.searchInput.addEventListener('input', handleSearchInput);
    els.searchClear.addEventListener('click', () => {
      els.searchInput.value = '';
      state.searchQuery = '';
      els.searchClear.hidden = true;
      renderCategories();
      els.searchInput.focus();
    });
    els.searchInput.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') {
        els.searchInput.value = '';
        state.searchQuery = '';
        els.searchClear.hidden = true;
        renderCategories();
      }
    });

    // PART 2: every banner's close (×) button shares one dismiss
    // handler, keyed off its own DOM id via data-banner-id. Covers the
    // offline and update banners. (v2.0: announcements no longer use
    // this — see announcements.js, which manages its own per-item
    // dismiss/showOnce state since several can be shown at once.)
    document.querySelectorAll('.banner-close[data-banner-id]').forEach((btn) => {
      btn.addEventListener('click', () => dismissBanner(btn.dataset.bannerId));
    });
  }

  /**
   * v2.0: re-evaluates which announcements are currently active once a
   * minute, purely from already-loaded state (no network call) — so an
   * announcement's startDate/endDate boundary being crossed shows or
   * hides it on its own, without waiting for the next data/*.json poll
   * (which only re-renders when the file's *content* actually changed,
   * not merely when the clock has moved past a date it contains).
   */
  function startAnnouncementRefreshTicker() {
    window.setInterval(() => {
      renderAnnouncement();
    }, 60000);
  }

  function init() {
    if (!window.PortalStorage.isAvailable()) {
      showToastFallback();
    }
    window.ThemeManager.init();
    cacheElements();
    bindEvents();
    startClock();
    startAnnouncementRefreshTicker();
    initialLoad().then(startAutoRefresh);
  }

  /** Used only if localStorage itself is unavailable at boot time. */
  function showToastFallback() {
    console.warn('[app] localStorage is not available; favorites, recent and stats will not persist.');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
