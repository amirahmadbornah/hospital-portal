/**
 * announcements.js
 * -----------------------------------------------------------------------
 * v2.0: full redesign of the announcement system (replaces the old
 * single-object announcement.json + announcement-scheduler.js entirely,
 * per spec). Reads the array-based data/announcements.json (written by
 * the admin panel's api/announcement.php) and renders:
 *
 *   - Banner-mode announcements (popupMode: false) as a slider in the
 *     header banner slot — dots/counter + auto-slide when there is more
 *     than one active at once.
 *   - Popup-mode announcements (popupMode: true) as a modal queue —
 *     shown one at a time, highest priority first; closing one reveals
 *     the next, if any.
 *
 * Zero active announcements => literally nothing is rendered, not even
 * an empty container, per spec ("هیچ Banner، هیچ Placeholder، هیچ Box
 * نمایش داده نشود").
 *
 * "Active" means: enabled === true AND now is within
 * [startDate, endDate]. Priority order for both display and the popup
 * queue: critical > important > normal.
 *
 * Dismiss persistence: a dismissed announcement is remembered by
 * `id + updatedAt`, so editing an announcement in the admin panel
 * naturally makes it reappear for everyone (a fresh version, a fresh
 * chance to be seen) without any extra logic here. showOnce works the
 * same way, but is recorded the moment an announcement is actually
 * displayed, independent of whether the user dismisses it.
 * -----------------------------------------------------------------------
 */

const AnnouncementsManager = (() => {
  const { Keys, readJSON, writeJSON } = window.PortalStorage;

  const PRIORITY_RANK = Object.freeze({ critical: 0, important: 1, normal: 2 });
  const AUTO_SLIDE_MS = 6000;

  let bannerSlot = null;
  let popupOverlay = null;
  let bannerSlideTimerId = null;
  let bannerIndex = 0;
  let currentBannerList = [];
  let currentPopupQueue = [];

  /** @param {Object} ann @returns {string} stable key covering this specific edit of the announcement */
  function versionKey(ann) {
    return `${ann.id}::${ann.updatedAt || ''}`;
  }

  function readDismissMap() {
    return readJSON(Keys.ANNOUNCEMENT_DISMISS, {});
  }
  function readSeenMap() {
    return readJSON(Keys.ANNOUNCEMENT_SEEN, {});
  }

  /** @param {Object} ann @returns {boolean} */
  function isDismissed(ann) {
    return Boolean(readDismissMap()[versionKey(ann)]);
  }
  /** @param {Object} ann @returns {boolean} */
  function isAlreadySeen(ann) {
    return Boolean(readSeenMap()[versionKey(ann)]);
  }

  /** @param {Object} ann */
  function markDismissed(ann) {
    const map = readDismissMap();
    map[versionKey(ann)] = true;
    writeJSON(Keys.ANNOUNCEMENT_DISMISS, map);
  }

  /** @param {Object} ann */
  function markSeen(ann) {
    const map = readSeenMap();
    if (map[versionKey(ann)]) return;
    map[versionKey(ann)] = true;
    writeJSON(Keys.ANNOUNCEMENT_SEEN, map);
  }

  /**
   * BUG FIX (same root cause as admin/announcements-admin.js): stored
   * date-time strings like "2026-08-28T11:00:00" have no timezone
   * designator, so `new Date(value)` parses them using the BROWSER'S
   * local timezone, not Asia/Tehran. Comparing that against `new
   * Date()` ("now") silently shifts the active/expired boundary by
   * whatever the difference is between the visitor's browser timezone
   * and Iran's — on hospital LAN clients this is usually zero, but it
   * is not guaranteed, and near midnight it can flip which day an
   * announcement is considered active on. Fixed by reading digits
   * directly from the string and comparing against the real current
   * time in Asia/Tehran (via Intl's explicit timeZone option), never
   * constructing a Date from the stored value at all.
   * @param {string} value e.g. "2026-08-28T11:00:00"
   * @returns {string} zero-padded "YYYY-MM-DDTHH:mm:ss", directly string-comparable
   */
  function toComparableTehranString(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value || '');
    if (!match) return '';
    const [, y, mo, d, h, mi] = match;
    return `${y}-${mo}-${d}T${h}:${mi}:00`;
  }

  /** Current wall-clock time in Asia/Tehran, explicit — see toComparableTehranString(). */
  function getTehranNowComparableString() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  }

  /**
   * @param {Object} ann
   * @param {string} nowComparableString from getTehranNowComparableString()
   * @returns {boolean} true if this announcement should be considered at all right now
   */
  function isWithinActiveWindow(ann, nowComparableString) {
    if (!ann.enabled) return false;
    const start = ann.startDate ? toComparableTehranString(ann.startDate) : '';
    const end = ann.endDate ? toComparableTehranString(ann.endDate) : '';
    if (start && nowComparableString < start) return false;
    if (end && nowComparableString > end) return false;
    return true;
  }

  /**
   * Filters the raw list down to what THIS browser should currently be
   * offered to see (active window + not dismissed + not already seen
   * under showOnce), sorted by priority.
   * @param {Array<Object>} allAnnouncements
   * @returns {Array<Object>}
   */
  function getEligibleAnnouncements(allAnnouncements) {
    const now = getTehranNowComparableString();
    return allAnnouncements
      .filter((ann) => isWithinActiveWindow(ann, now))
      .filter((ann) => !isDismissed(ann))
      .filter((ann) => !(ann.showOnce && isAlreadySeen(ann)))
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2));
  }

  /* ----------------------------------------------------------------- *
   * Shared slide/popup body builder
   * ----------------------------------------------------------------- */

  /**
   * Escapes text for safe insertion into innerHTML — announcements.js
   * runs independently of app.js, so this is a small self-contained
   * copy of the same well-established pattern, not a duplicate module.
   * @param {string} value
   * @returns {string}
   */
  function escapeHTML(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  /**
   * @param {Object} ann
   * @returns {string} inner HTML for the title/message/image body,
   *   shared between the banner slide and the popup card.
   */
  function buildBodyHTML(ann) {
    const showImage = ann.type === 'image' || ann.type === 'text-image';
    const showText = ann.type === 'text' || ann.type === 'text-image';

    const imageHTML = showImage && ann.image
      ? `<img class="announcement-media" src="${escapeHTML(ann.image)}" alt="" />`
      : '';
    const textHTML = showText
      ? `<div class="announcement-text"><strong>${escapeHTML(ann.title)}</strong><span>${escapeHTML(ann.message)}</span></div>`
      : `<div class="announcement-text"><strong>${escapeHTML(ann.title)}</strong></div>`;

    return imageHTML + textHTML;
  }

  /* ----------------------------------------------------------------- *
   * Banner slider (popupMode: false)
   * ----------------------------------------------------------------- */

  function stopBannerAutoSlide() {
    if (bannerSlideTimerId) {
      window.clearInterval(bannerSlideTimerId);
      bannerSlideTimerId = null;
    }
  }

  function startBannerAutoSlide() {
    stopBannerAutoSlide();
    if (currentBannerList.length <= 1) return;
    bannerSlideTimerId = window.setInterval(() => {
      bannerIndex = (bannerIndex + 1) % currentBannerList.length;
      renderBannerFrame();
    }, AUTO_SLIDE_MS);
  }

  /** Rebuilds just the visible frame (current slide + dots) without re-filtering the list. */
  function renderBannerFrame() {
    if (currentBannerList.length === 0) {
      bannerSlot.innerHTML = '';
      bannerSlot.hidden = true;
      return;
    }

    const ann = currentBannerList[bannerIndex];
    bannerSlot.hidden = false;

    const dotsHTML = currentBannerList.length > 1
      ? `<div class="announcement-banner__dots" role="tablist" aria-label="سایر اعلان‌ها">` +
        currentBannerList.map((_, i) =>
          `<button type="button" class="announcement-dot${i === bannerIndex ? ' is-active' : ''}" data-index="${i}" role="tab" aria-selected="${i === bannerIndex}" aria-label="اعلان ${i + 1} از ${currentBannerList.length}"></button>`
        ).join('') +
        `</div>`
      : '';

    const closeHTML = ann.dismissible
      ? `<button type="button" class="banner-close announcement-banner__close" aria-label="بستن اعلان">
           <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>
         </button>`
      : '';

    bannerSlot.innerHTML = `
      <div class="announcement-banner announcement-banner--${escapeHTML(ann.priority)}" role="status">
        ${buildBodyHTML(ann)}
        ${dotsHTML}
        ${closeHTML}
      </div>
    `;

    markSeen(ann);

    const closeBtn = bannerSlot.querySelector('.announcement-banner__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        markDismissed(ann);
        currentBannerList.splice(bannerIndex, 1);
        if (bannerIndex >= currentBannerList.length) bannerIndex = 0;
        renderBannerFrame();
        startBannerAutoSlide();
      });
    }

    bannerSlot.querySelectorAll('.announcement-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        bannerIndex = Number(dot.dataset.index) || 0;
        renderBannerFrame();
        startBannerAutoSlide();
      });
    });
  }

  function renderBanners(eligibleAnnouncements) {
    currentBannerList = eligibleAnnouncements.filter((ann) => !ann.popupMode);
    bannerIndex = 0;
    renderBannerFrame();
    startBannerAutoSlide();
  }

  /* ----------------------------------------------------------------- *
   * Popup queue (popupMode: true)
   * ----------------------------------------------------------------- */

  function renderNextPopup() {
    if (currentPopupQueue.length === 0) {
      popupOverlay.hidden = true;
      popupOverlay.innerHTML = '';
      return;
    }

    const ann = currentPopupQueue[0];
    popupOverlay.hidden = false;

    // Per spec, `dismissible` gates whether a close affordance exists
    // at all — a non-dismissible critical popup is intentionally
    // "sticky" until an admin disables/expires it. Documented clearly
    // in README so this strictness is a deliberate, informed choice.
    const closeHTML = ann.dismissible
      ? `<button type="button" class="banner-close announcement-popup__close" aria-label="بستن">
           <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>
         </button>`
      : '';

    popupOverlay.innerHTML = `
      <div class="announcement-popup announcement-popup--${escapeHTML(ann.priority)}" role="alertdialog" aria-modal="true">
        ${closeHTML}
        ${buildBodyHTML(ann)}
      </div>
    `;

    markSeen(ann);

    const closeBtn = popupOverlay.querySelector('.announcement-popup__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        markDismissed(ann);
        currentPopupQueue.shift();
        renderNextPopup();
      });
    }
  }

  function renderPopups(eligibleAnnouncements) {
    currentPopupQueue = eligibleAnnouncements.filter((ann) => ann.popupMode);
    renderNextPopup();
  }

  /* ----------------------------------------------------------------- *
   * Public entry point
   * ----------------------------------------------------------------- */

  /**
   * Re-renders both the banner slider and the popup queue from the raw
   * announcements array (as loaded from data/announcements.json). Safe
   * to call repeatedly (e.g. on every auto-refresh tick) — it always
   * rebuilds from scratch, and correctly renders nothing when there is
   * nothing eligible.
   * @param {Array<Object>} allAnnouncements
   */
  function render(allAnnouncements) {
    if (!bannerSlot) bannerSlot = document.getElementById('announcement-banner-slot');
    if (!popupOverlay) popupOverlay = document.getElementById('announcement-popup-overlay');
    if (!bannerSlot || !popupOverlay) return;

    const eligible = getEligibleAnnouncements(allAnnouncements || []);
    renderBanners(eligible);
    renderPopups(eligible);
  }

  return { render };
})();

window.AnnouncementsManager = AnnouncementsManager;
