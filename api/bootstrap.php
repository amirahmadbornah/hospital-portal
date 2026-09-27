<?php
/**
 * api/bootstrap.php
 * -----------------------------------------------------------------------
 * Shared setup for every admin API endpoint: starts a hardened PHP
 * session, installs a global error/exception handler so nothing but
 * clean JSON ever reaches the client, and exposes small sanitize /
 * response / CSRF / backup / audit-log helpers. Every api/*.php file
 * requires this first, before doing anything else.
 *
 * v2.0: extended with announcements.json + data/uploads/ helpers,
 * reused by the new api/announcement.php. Everything links.php/auth.php
 * already relied on is untouched — only additions below.
 * -----------------------------------------------------------------------
 */

declare(strict_types=1);

// The whole project's time base is Asia/Tehran (per spec) — set this
// explicitly rather than relying on the container's php.ini default,
// which for the stock php:8.3-fpm image is UTC. Every date() call in
// this file and every file that requires it (auth.php, links.php,
// announcement.php) inherits this, so createdAt/updatedAt timestamps
// are generated in real Tehran wall-clock time, consistent with the
// startDate/endDate values the admin enters in the browser.
date_default_timezone_set('Asia/Tehran');

define('PORTAL_ROOT', dirname(__DIR__));
define('CONFIG_PATH', PORTAL_ROOT . '/config/config.php');
define('LINKS_JSON_PATH', PORTAL_ROOT . '/data/links.json');
define('BACKUP_DIR', PORTAL_ROOT . '/data/backups');
define('AUDIT_LOG_PATH', PORTAL_ROOT . '/data/audit.log');
define('MAX_BACKUPS', 20);

// v2.0 additions -----------------------------------------------------------
define('ANNOUNCEMENTS_JSON_PATH', PORTAL_ROOT . '/data/announcements.json');
define('UPLOADS_DIR', PORTAL_ROOT . '/data/uploads');
define('MAX_UPLOAD_BYTES', 5 * 1024 * 1024); // 5MB, per spec
define('ALLOWED_UPLOAD_MIME_TYPES', [
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp'
]);

// ---- global error handling: never leak PHP warnings/notices/fatals ------
// Per spec: "هیچ Warning، هیچ Notice، هیچ Fatal Error نباید به کاربر
// نمایش داده شود؛ همه خطاها JSON استاندارد برگردانند." Installed once
// here so every endpoint (old and new) is covered automatically, with
// zero changes needed in auth.php/links.php themselves.
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false; // suppressed with @ or excluded by error_reporting() above
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(function (Throwable $e): void {
    error_log('[api] Uncaught: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'success' => false,
        'message' => 'خطای داخلی سرور رخ داد. با مدیر سیستم تماس بگیرید.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
});

$config = require CONFIG_PATH;

/**
 * Detects whether the current request arrived over HTTPS, including
 * behind a reverse proxy that terminates TLS.
 * @return bool
 */
function isRequestSecure(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])
        && strtolower((string)$_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') {
        return true;
    }
    return ($_SERVER['SERVER_PORT'] ?? null) === '443';
}

// ---- hardened session start --------------------------------------------
// NOTE on the Secure flag: it is only set when the request actually
// arrived over HTTPS. Hard-coding it to true would make the browser
// silently refuse to send the cookie back at all on a plain-HTTP
// deployment, breaking login entirely — auto-detecting keeps this
// secure the moment HTTPS is enabled, without breaking HTTP today.
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => isRequestSecure()
]);
session_name($config['sessionCookieName']);
session_start();

/**
 * Enforces the configured idle timeout: destroys the session if the
 * user has been inactive too long, otherwise refreshes the activity
 * timestamp for this request.
 * @param array $config
 */
function enforceSessionTimeout(array $config): void
{
    if (empty($_SESSION['authenticated'])) {
        return;
    }
    $idleSeconds = time() - ($_SESSION['lastActivity'] ?? 0);
    if ($idleSeconds > $config['sessionTimeoutSeconds']) {
        $_SESSION = [];
        session_destroy();
        return;
    }
    $_SESSION['lastActivity'] = time();
}
enforceSessionTimeout($config);

// ---- response helpers ---------------------------------------------------

/**
 * Sends a JSON response and terminates the request.
 * @param array $payload
 * @param int $statusCode
 */
function jsonResponse(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Stops the request with 401 unless the session is authenticated. */
function requireAuthenticated(): void
{
    if (empty($_SESSION['authenticated'])) {
        jsonResponse(['success' => false, 'message' => 'ابتدا وارد شوید.'], 401);
    }
}

/**
 * Stops the request with 403 unless a valid CSRF token was sent
 * (either as the X-CSRF-Token header, or a csrfToken field in the
 * JSON body already parsed into $_POST-equivalent by the caller).
 * @param string|null $sentToken
 */
function requireValidCsrf(?string $sentToken): void
{
    $expected = $_SESSION['csrfToken'] ?? '';
    $sent = $sentToken ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if ($expected === '' || !hash_equals($expected, (string)$sent)) {
        jsonResponse(['success' => false, 'message' => 'نشست شما نامعتبر است، صفحه را رفرش کنید.'], 403);
    }
}

// ---- input sanitizing -----------------------------------------------------

/**
 * Trims, strips any HTML tags, and hard-caps the length of free-text
 * input — the main defense against stored XSS from admin-entered
 * titles/descriptions.
 * @param string $value
 * @param int $maxLength
 * @return string
 */
function sanitizeText(string $value, int $maxLength = 500): string
{
    $value = trim(strip_tags($value));
    return function_exists('mb_substr')
        ? mb_substr($value, 0, $maxLength)
        : substr($value, 0, $maxLength);
}

/**
 * @param string $url
 * @return bool true only for well-formed http:// or https:// URLs.
 */
function isValidHttpUrl(string $url): bool
{
    if (filter_var($url, FILTER_VALIDATE_URL) === false) {
        return false;
    }
    $scheme = parse_url($url, PHP_URL_SCHEME);
    return in_array($scheme, ['http', 'https'], true);
}

/**
 * Deliberately strict id format (letters, digits, hyphen only) so a
 * link id can never be used to escape the JSON structure or attempt a
 * path-traversal style trick anywhere it's touched.
 * @param string $id
 * @return bool
 */
function isValidLinkId(string $id): bool
{
    return (bool)preg_match('/^[a-zA-Z0-9\-]{1,64}$/', $id);
}

// ---- links.json read/write, with file locking ----------------------------

/**
 * Reads and decodes data/links.json under a shared lock.
 * @return array
 */
function readLinksData(): array
{
    if (!file_exists(LINKS_JSON_PATH)) {
        jsonResponse(['success' => false, 'message' => 'خطا در خواندن اطلاعات. با مدیر سیستم تماس بگیرید.'], 500);
    }

    $handle = fopen(LINKS_JSON_PATH, 'r');
    if (!$handle) {
        jsonResponse(['success' => false, 'message' => 'خطا در خواندن اطلاعات. با مدیر سیستم تماس بگیرید.'], 500);
    }

    flock($handle, LOCK_SH);
    $raw = stream_get_contents($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    $data = json_decode((string)$raw, true);
    if (!is_array($data) || !isset($data['links']) || !isset($data['categories'])) {
        jsonResponse(['success' => false, 'message' => 'خطا در خواندن اطلاعات. با مدیر سیستم تماس بگیرید.'], 500);
    }

    return $data;
}

/**
 * Backs up the current file, then overwrites data/links.json under an
 * exclusive lock.
 * @param array $data
 */
function writeLinksData(array $data): void
{
    createBackup();

    $handle = fopen(LINKS_JSON_PATH, 'c+');
    if (!$handle) {
        jsonResponse(['success' => false, 'message' => 'خطا در ذخیره اطلاعات.'], 500);
    }

    flock($handle, LOCK_EX);
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
}

// ---- backups --------------------------------------------------------------

/** Copies the current links.json into data/backups/ before it gets overwritten. */
function createBackup(): void
{
    if (!file_exists(LINKS_JSON_PATH)) {
        return;
    }
    if (!is_dir(BACKUP_DIR)) {
        mkdir(BACKUP_DIR, 0755, true);
    }

    $stamp = date('Y-m-d_His');
    copy(LINKS_JSON_PATH, BACKUP_DIR . '/links_backup_' . $stamp . '.json');

    pruneOldBackups();
}

/** Keeps only the newest MAX_BACKUPS files, deleting the rest. */
function pruneOldBackups(): void
{
    $files = glob(BACKUP_DIR . '/links_backup_*.json');
    if ($files === false || count($files) <= MAX_BACKUPS) {
        return;
    }
    sort($files); // filenames are chronologically sortable as strings
    $excessCount = count($files) - MAX_BACKUPS;
    for ($i = 0; $i < $excessCount; $i++) {
        @unlink($files[$i]);
    }
}

// ---- audit log --------------------------------------------------------------

/**
 * Appends one JSON-line entry to data/audit.log for every mutating
 * operation.
 * @param string $operation e.g. 'CREATE', 'UPDATE', 'DELETE', 'ENABLE', 'DISABLE', 'REORDER'
 * @param string $target the affected link id (or a comma-separated list for REORDER)
 */
function writeAuditLog(string $operation, string $target): void
{
    $entry = [
        'date' => date('Y-m-d'),
        'time' => date('H:i:s'),
        'username' => $_SESSION['username'] ?? 'unknown',
        'operation' => $operation,
        'target' => $target,
        'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown'
    ];
    $line = json_encode($entry, JSON_UNESCAPED_UNICODE) . PHP_EOL;

    $handle = fopen(AUDIT_LOG_PATH, 'a');
    if ($handle) {
        flock($handle, LOCK_EX);
        fwrite($handle, $line);
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

// ---- v2.0: announcements.json read/write, mirroring the links.json helpers above ----

/**
 * Reads and decodes data/announcements.json under a shared lock.
 * @return array{announcements: array}
 */
function readAnnouncementsData(): array
{
    if (!file_exists(ANNOUNCEMENTS_JSON_PATH)) {
        jsonResponse(['success' => false, 'message' => 'خطا در خواندن اطلاعات. با مدیر سیستم تماس بگیرید.'], 500);
    }

    $handle = fopen(ANNOUNCEMENTS_JSON_PATH, 'r');
    if (!$handle) {
        jsonResponse(['success' => false, 'message' => 'خطا در خواندن اطلاعات. با مدیر سیستم تماس بگیرید.'], 500);
    }

    flock($handle, LOCK_SH);
    $raw = stream_get_contents($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    $data = json_decode((string)$raw, true);
    if (!is_array($data) || !isset($data['announcements']) || !is_array($data['announcements'])) {
        jsonResponse(['success' => false, 'message' => 'خطا در خواندن اطلاعات. با مدیر سیستم تماس بگیرید.'], 500);
    }

    return $data;
}

/**
 * Backs up the current announcements file (reusing the same backup
 * directory/rotation as links.json, just a different filename prefix),
 * then overwrites data/announcements.json under an exclusive lock.
 * @param array $data
 */
function writeAnnouncementsData(array $data): void
{
    if (file_exists(ANNOUNCEMENTS_JSON_PATH)) {
        if (!is_dir(BACKUP_DIR)) {
            mkdir(BACKUP_DIR, 0755, true);
        }
        $stamp = date('Y-m-d_His');
        copy(ANNOUNCEMENTS_JSON_PATH, BACKUP_DIR . '/announcements_backup_' . $stamp . '.json');
        pruneBackupsMatching(BACKUP_DIR . '/announcements_backup_*.json');
    }

    $handle = fopen(ANNOUNCEMENTS_JSON_PATH, 'c+');
    if (!$handle) {
        jsonResponse(['success' => false, 'message' => 'خطا در ذخیره اطلاعات.'], 500);
    }

    flock($handle, LOCK_EX);
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
}

/**
 * Generic version of pruneOldBackups() that works for any backup file
 * glob pattern, so links.json and announcements.json can share one
 * backups/ directory + MAX_BACKUPS limit without duplicating the
 * prune logic per file type.
 * @param string $globPattern
 */
function pruneBackupsMatching(string $globPattern): void
{
    $files = glob($globPattern);
    if ($files === false || count($files) <= MAX_BACKUPS) {
        return;
    }
    sort($files);
    $excessCount = count($files) - MAX_BACKUPS;
    for ($i = 0; $i < $excessCount; $i++) {
        @unlink($files[$i]);
    }
}

/**
 * Generates a fresh id shaped like "ann-NNN".
 * @param array $existingAnnouncements
 * @return string
 */
function generateAnnouncementId(array $existingAnnouncements): string
{
    $highest = 0;
    foreach ($existingAnnouncements as $item) {
        if (preg_match('/^ann-(\d+)$/', (string)($item['id'] ?? ''), $matches)) {
            $highest = max($highest, (int)$matches[1]);
        }
    }
    do {
        $highest++;
        $candidateId = 'ann-' . str_pad((string)$highest, 3, '0', STR_PAD_LEFT);
    } while (announcementIdExists($candidateId, $existingAnnouncements));

    return $candidateId;
}

function announcementIdExists(string $id, array $announcements): bool
{
    foreach ($announcements as $item) {
        if (($item['id'] ?? '') === $id) {
            return true;
        }
    }
    return false;
}

/** Same id-format rules as links; distinctly named here for clarity in announcement.php. */
function isValidAnnouncementId(string $id): bool
{
    return isValidLinkId($id);
}

/** @return bool true only for one of the three spec'd announcement types. */
function isValidAnnouncementType(string $type): bool
{
    return in_array($type, ['text', 'image', 'text-image'], true);
}

/** @return bool true only for one of the three spec'd priority levels. */
function isValidPriority(string $priority): bool
{
    return in_array($priority, ['normal', 'important', 'critical'], true);
}

/**
 * Validates a date string is a real, parseable date/time (accepts the
 * `YYYY-MM-DDTHH:mm:ss` shape the frontend's <input type="datetime-local">
 * naturally produces).
 * @param string $value
 * @return bool
 */
function isValidDateTimeString(string $value): bool
{
    if ($value === '') {
        return false;
    }
    return strtotime($value) !== false;
}

/**
 * Confirms a stored `image` value is a path this app itself generated
 * during upload (data/uploads/<hex>.<ext>) — never trust a client-
 * supplied image path outright, or it becomes an arbitrary-file-read/
 * delete primitive.
 * @param string $path
 * @return bool
 */
function isOwnedUploadPath(string $path): bool
{
    return (bool)preg_match('#^data/uploads/[a-f0-9]{32}\.(png|jpg|webp)$#', $path);
}

/**
 * Deletes a previously-uploaded image file, but only if the path is
 * one this app could have generated itself (see isOwnedUploadPath).
 * Silently does nothing for empty/foreign paths — this is cleanup,
 * never a hard requirement for the calling operation to succeed.
 * @param string|null $path
 */
function deleteOwnedUploadIfPresent(?string $path): void
{
    if ($path === null || $path === '' || !isOwnedUploadPath($path)) {
        return;
    }
    $absolutePath = PORTAL_ROOT . '/' . $path;
    if (is_file($absolutePath)) {
        @unlink($absolutePath);
    }
}
