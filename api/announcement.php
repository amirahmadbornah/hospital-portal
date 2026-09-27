<?php
/**
 * api/announcement.php
 * -----------------------------------------------------------------------
 * v2.0: full CRUD + image upload for the redesigned announcement system.
 * Every endpoint requires an authenticated admin session; mutating
 * endpoints additionally require a valid CSRF token — identical
 * security posture to api/links.php, reusing the same helpers from
 * bootstrap.php.
 *
 * Endpoints (both the action-based and REST-verb forms are accepted,
 * to satisfy the spec's action-based examples and its "GET POST PUT
 * DELETE" line at once):
 *   GET  ?action=list                          -> list all announcements
 *   POST ?action=create        {…fields}       -> create
 *   POST ?action=update        {id, …fields}   -> update      (PUT also accepted)
 *   POST ?action=delete        {id}            -> delete      (DELETE also accepted)
 *   POST ?action=toggle        {id, enabled}   -> enable/disable
 *   POST ?action=upload        multipart image -> upload an image, returns its path
 * -----------------------------------------------------------------------
 */

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

header('X-Content-Type-Options: nosniff');

requireAuthenticated();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'GET' && $action === 'list') {
    handleList();
    exit;
}

if ($method === 'POST' && $action === 'upload') {
    handleUpload();
    exit;
}

if ($method === 'POST') {
    $body = readJsonBody();
    requireValidCsrf($body['csrfToken'] ?? null);

    switch ($action) {
        case 'create':
            handleCreate($body);
            break;
        case 'update':
            handleUpdate($body);
            break;
        case 'delete':
            handleDelete($body);
            break;
        case 'toggle':
            handleToggle($body);
            break;
        default:
            jsonResponse(['success' => false, 'message' => 'عملیات نامعتبر است.'], 400);
    }
    exit;
}

// REST-verb aliases, per the spec's "GET POST PUT DELETE" line.
if ($method === 'PUT') {
    $body = readJsonBody();
    requireValidCsrf($body['csrfToken'] ?? null);
    handleUpdate($body);
    exit;
}
if ($method === 'DELETE') {
    $body = readJsonBody();
    requireValidCsrf($body['csrfToken'] ?? null);
    handleDelete($body);
    exit;
}

jsonResponse(['success' => false, 'message' => 'درخواست نامعتبر است.'], 400);

/** @return array decoded JSON request body, or [] if absent/invalid. */
function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    $body = json_decode((string)$raw, true);
    return is_array($body) ? $body : [];
}

/** Returns every announcement (any status) — the admin dashboard filters/sorts client-side. */
function handleList(): void
{
    $data = readAnnouncementsData();
    jsonResponse(['success' => true, 'data' => $data]);
}

/**
 * Validates and normalizes the editable fields of an announcement from
 * raw request input.
 * @param array $body
 * @return array{0: string[], 1: array} [errors, cleanFields]
 */
function extractAnnouncementFields(array $body): array
{
    $errors = [];

    $title = sanitizeText((string)($body['title'] ?? ''), 200);
    $message = sanitizeText((string)($body['message'] ?? ''), 2000);
    $image = $body['image'] ?? null;
    $type = (string)($body['type'] ?? 'text');
    $priority = (string)($body['priority'] ?? 'normal');
    $startDate = (string)($body['startDate'] ?? '');
    $endDate = (string)($body['endDate'] ?? '');
    $enabled = (bool)($body['enabled'] ?? true);
    $dismissible = (bool)($body['dismissible'] ?? true);
    $showOnce = (bool)($body['showOnce'] ?? false);
    $popupMode = (bool)($body['popupMode'] ?? false);

    if ($title === '') {
        $errors[] = 'عنوان الزامی است.';
    }
    if (!isValidAnnouncementType($type)) {
        $errors[] = 'نوع اعلان نامعتبر است.';
    }
    if (!isValidPriority($priority)) {
        $errors[] = 'اولویت نامعتبر است.';
    }
    if (in_array($type, ['text', 'text-image'], true) && $message === '') {
        $errors[] = 'متن اعلان الزامی است.';
    }

    // Only a path this server generated during upload is ever trusted
    // — never a client-supplied arbitrary string (see isOwnedUploadPath).
    $imagePath = null;
    if (in_array($type, ['image', 'text-image'], true)) {
        $candidate = is_string($image) ? trim($image) : '';
        if ($candidate === '' || !isOwnedUploadPath($candidate)) {
            $errors[] = 'برای این نوع اعلان، ابتدا یک تصویر آپلود کنید.';
        } else {
            $imagePath = $candidate;
        }
    }

    if (!isValidDateTimeString($startDate)) {
        $errors[] = 'تاریخ شروع نامعتبر است.';
    }
    if (!isValidDateTimeString($endDate)) {
        $errors[] = 'تاریخ پایان نامعتبر است.';
    }
    if (isValidDateTimeString($startDate) && isValidDateTimeString($endDate)
        && strtotime($endDate) < strtotime($startDate)) {
        $errors[] = 'تاریخ پایان باید بعد از تاریخ شروع باشد.';
    }

    $clean = [
        'title' => $title,
        'message' => $message,
        'image' => $imagePath,
        'type' => $type,
        'priority' => $priority,
        'startDate' => $startDate,
        'endDate' => $endDate,
        'enabled' => $enabled,
        'dismissible' => $dismissible,
        'showOnce' => $showOnce,
        'popupMode' => $popupMode
    ];

    return [$errors, $clean];
}

function handleCreate(array $body): void
{
    $data = readAnnouncementsData();

    [$errors, $fields] = extractAnnouncementFields($body);
    if (!empty($errors)) {
        jsonResponse(['success' => false, 'message' => implode(' ', $errors)], 422);
    }

    $now = date('Y-m-d\TH:i:s');
    $newAnnouncement = array_merge(
        ['id' => generateAnnouncementId($data['announcements'])],
        $fields,
        ['createdAt' => $now, 'updatedAt' => $now]
    );
    $data['announcements'][] = $newAnnouncement;

    writeAnnouncementsData($data);
    writeAuditLog('CREATE_ANNOUNCEMENT', $newAnnouncement['id']);

    jsonResponse(['success' => true, 'announcement' => $newAnnouncement]);
}

function handleUpdate(array $body): void
{
    $data = readAnnouncementsData();
    $id = (string)($body['id'] ?? '');

    if (!isValidAnnouncementId($id)) {
        jsonResponse(['success' => false, 'message' => 'شناسه اعلان نامعتبر است.'], 400);
    }

    [$errors, $fields] = extractAnnouncementFields($body);
    if (!empty($errors)) {
        jsonResponse(['success' => false, 'message' => implode(' ', $errors)], 422);
    }

    $found = false;
    $previousImage = null;
    foreach ($data['announcements'] as &$item) {
        if (($item['id'] ?? '') === $id) {
            $previousImage = $item['image'] ?? null;
            $item = array_merge($item, $fields, [
                'id' => $id,
                'updatedAt' => date('Y-m-d\TH:i:s')
            ]);
            $found = true;
            break;
        }
    }
    unset($item);

    if (!$found) {
        jsonResponse(['success' => false, 'message' => 'اعلان پیدا نشد.'], 404);
    }

    writeAnnouncementsData($data);

    // Clean up the old image file only after the write succeeded, and
    // only if it actually changed (edit that keeps the same image
    // shouldn't delete it out from under itself).
    if ($previousImage !== null && $previousImage !== $fields['image']) {
        deleteOwnedUploadIfPresent($previousImage);
    }

    writeAuditLog('UPDATE_ANNOUNCEMENT', $id);

    jsonResponse(['success' => true]);
}

function handleDelete(array $body): void
{
    $data = readAnnouncementsData();
    $id = (string)($body['id'] ?? '');

    if (!isValidAnnouncementId($id)) {
        jsonResponse(['success' => false, 'message' => 'شناسه اعلان نامعتبر است.'], 400);
    }

    $target = null;
    foreach ($data['announcements'] as $item) {
        if (($item['id'] ?? '') === $id) {
            $target = $item;
            break;
        }
    }
    if ($target === null) {
        jsonResponse(['success' => false, 'message' => 'اعلان پیدا نشد.'], 404);
    }

    $data['announcements'] = array_values(array_filter(
        $data['announcements'],
        static fn($item) => ($item['id'] ?? '') !== $id
    ));

    writeAnnouncementsData($data);
    deleteOwnedUploadIfPresent($target['image'] ?? null);
    writeAuditLog('DELETE_ANNOUNCEMENT', $id);

    jsonResponse(['success' => true]);
}

function handleToggle(array $body): void
{
    $data = readAnnouncementsData();
    $id = (string)($body['id'] ?? '');
    $enabled = (bool)($body['enabled'] ?? false);

    if (!isValidAnnouncementId($id)) {
        jsonResponse(['success' => false, 'message' => 'شناسه اعلان نامعتبر است.'], 400);
    }

    $found = false;
    foreach ($data['announcements'] as &$item) {
        if (($item['id'] ?? '') === $id) {
            $item['enabled'] = $enabled;
            $item['updatedAt'] = date('Y-m-d\TH:i:s');
            $found = true;
            break;
        }
    }
    unset($item);

    if (!$found) {
        jsonResponse(['success' => false, 'message' => 'اعلان پیدا نشد.'], 404);
    }

    writeAnnouncementsData($data);
    writeAuditLog($enabled ? 'ENABLE_ANNOUNCEMENT' : 'DISABLE_ANNOUNCEMENT', $id);

    jsonResponse(['success' => true]);
}

/**
 * Handles a multipart/form-data image upload (field name "image"),
 * validating size, real content-sniffed MIME type (not the spoofable
 * client-supplied Content-Type), and image decodability, then stores
 * it under a random server-generated filename — never the client's
 * original filename, which avoids path traversal/overwrite tricks.
 */
function handleUpload(): void
{
    requireValidCsrf($_POST['csrfToken'] ?? null);

    if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
        jsonResponse(['success' => false, 'message' => 'آپلود تصویر ناموفق بود.'], 400);
    }

    $file = $_FILES['image'];

    if ($file['size'] <= 0 || $file['size'] > MAX_UPLOAD_BYTES) {
        jsonResponse(['success' => false, 'message' => 'حجم تصویر نباید بیشتر از ۵ مگابایت باشد.'], 413);
    }

    // Sniff the actual file bytes — never trust $file['type'], which is
    // just an unverified header the client sent alongside the upload.
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $detectedMime = $finfo ? finfo_file($finfo, $file['tmp_name']) : false;
    if ($finfo) {
        finfo_close($finfo);
    }

    if ($detectedMime === false || !isset(ALLOWED_UPLOAD_MIME_TYPES[$detectedMime])) {
        jsonResponse(['success' => false, 'message' => 'فقط فایل‌های PNG، JPG یا WEBP مجاز هستند.'], 415);
    }

    // Extra defense: confirm it's a genuinely decodable image, not a
    // polyglot file crafted to pass the MIME sniff above.
    if (@getimagesize($file['tmp_name']) === false) {
        jsonResponse(['success' => false, 'message' => 'فایل ارسالی یک تصویر معتبر نیست.'], 415);
    }

    if (!is_dir(UPLOADS_DIR)) {
        mkdir(UPLOADS_DIR, 0755, true);
    }

    $extension = ALLOWED_UPLOAD_MIME_TYPES[$detectedMime];
    $filename = bin2hex(random_bytes(16)) . '.' . $extension;
    $destination = UPLOADS_DIR . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        jsonResponse(['success' => false, 'message' => 'ذخیره تصویر ناموفق بود.'], 500);
    }

    writeAuditLog('UPLOAD_IMAGE', $filename);

    jsonResponse(['success' => true, 'path' => 'data/uploads/' . $filename]);
}
