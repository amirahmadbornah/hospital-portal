/**
 * status.js
 * -----------------------------------------------------------------------
 * FEATURE 1: System health monitor.
 *
 * Holds the latest data/status.json in memory and exposes small,
 * read-only lookups that app.js uses to paint the status dot on each
 * link card and to build its hover tooltip. This module never touches
 * the DOM itself — rendering stays app.js's job — which keeps card
 * markup and styling unchanged elsewhere in the project.
 * -----------------------------------------------------------------------
 */

const StatusManager = (() => {
  /** @type {Map<string, {status:string, responseTime:number}>} */
  let systemsById = new Map();

  /** Timestamp of the most recent successful status.json ingest. */
  let lastCheckAt = null;

  const STATUS_META = Object.freeze({
    online: { label: 'آنلاین', className: 'status--online' },
    slow: { label: 'کند', className: 'status--slow' },
    offline: { label: 'آفلاین', className: 'status--offline' },
    unknown: { label: 'نامشخص', className: 'status--unknown' }
  });

  /**
   * Loads a fresh status.json payload into memory.
   * @param {{refreshInterval?:number, systems?:Array<Object>}} statusData
   */
  function ingest(statusData) {
    const systems = (statusData && statusData.systems) || [];
    systemsById = new Map(systems.map((system) => [system.id, system]));
    lastCheckAt = new Date();
  }

  /**
   * Returns display-ready status info for a given link id. Links with
   * no matching entry in status.json (or before the first successful
   * ingest) safely fall back to "unknown".
   * @param {string} linkId
   * @returns {{status:string, label:string, className:string, responseTime:(number|null), lastCheckAt:(Date|null)}}
   */
  function getMeta(linkId) {
    const record = systemsById.get(linkId);
    const status = record && STATUS_META[record.status] ? record.status : 'unknown';
    const meta = STATUS_META[status];

    return {
      status,
      label: meta.label,
      className: meta.className,
      responseTime: record && typeof record.responseTime === 'number' ? record.responseTime : null,
      lastCheckAt
    };
  }

  /**
   * Builds the tooltip text shown on hover: status, response time and
   * last check time, exactly as specified in the brief.
   * @param {string} linkId
   * @returns {string}
   */
  function formatTooltip(linkId) {
    const meta = getMeta(linkId);
    const time = meta.lastCheckAt
      ? `${String(meta.lastCheckAt.getHours()).padStart(2, '0')}:${String(meta.lastCheckAt.getMinutes()).padStart(2, '0')}`
      : '—';
    const responseTimeText =
      meta.status === 'offline' || meta.responseTime === null ? '—' : `${meta.responseTime} ms`;

    return `وضعیت: ${meta.label}\nزمان پاسخ: ${responseTimeText}\nآخرین بررسی: ${time}`;
  }

  return { ingest, getMeta, formatTooltip };
})();

window.StatusManager = StatusManager;
