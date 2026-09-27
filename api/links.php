<?php
/**
 * api/links.php
 * -----------------------------------------------------------------------
 * CRUD for the links shown in the portal — the only thing this admin
 * panel manages, exactly as scoped. Every mutating action requires an
 * authenticated session AND a valid CSRF token. Categories are
 * read-only here: admins pick from the categories that already exist
 * in links.json, they are never created/edited/removed from this
 * panel.
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
        case 'reorder':
            handleReorder($body);
            break;
        default:
            jsonResponse(['success' => false, 'message' => 'عملیات نامعتبر است.'], 400);
    }
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

/** Returns the full links.json content (categories + links) as-is. */
function handleList(): void
{
    $data = readLinksData();
    jsonResponse(['success' => true, 'data' => $data]);
}

/**
 * Validates and normalizes the editable fields of a link from raw
 * request input.
 * @param array $body
 * @param string[] $validCategoryIds
 * @return array{0: string[], 1: array} [errors, cleanFields]
 */
function extractLinkFields(array $body, array $validCategoryIds): array
{
    $errors = [];

    $title = sanitizeText((string)($body['title'] ?? ''), 150);
    $description = sanitizeText((string)($body['description'] ?? ''), 400);
    $url = trim((string)($body['url'] ?? ''));
    $category = sanitizeText((string)($body['category'] ?? ''), 64);
    $icon = sanitizeText((string)($body['icon'] ?? ''), 64);
    $order = (int)($body['order'] ?? 0);
    $enabled = (bool)($body['enabled'] ?? true);
    $favoriteAllowed = (bool)($body['favoriteAllowed'] ?? true);

    if ($title === '') {
        $errors[] = 'عنوان الزامی است.';
    }
    if (!isValidHttpUrl($url)) {
        $errors[] = 'آدرس باید یک URL معتبر با http یا https باشد.';
    }
    if (!in_array($category, $validCategoryIds, true)) {
        $errors[] = 'دسته‌بندی انتخاب‌شده معتبر نیست.';
    }
    if ($icon === '') {
        $errors[] = 'آیکون را انتخاب کنید.';
    }

    $clean = [
        'title' => $title,
        'description' => $description,
        'url' => $url,
        'category' => $category,
        'icon' => $icon,
        'order' => $order,
        'enabled' => $enabled,
        'favoriteAllowed' => $favoriteAllowed
    ];

    return [$errors, $clean];
}

/**
 * Generates a fresh id shaped like the existing "<category>-NNN"
 * convention already used throughout links.json.
 * @param string $category
 * @param array $existingLinks
 * @return string
 */
function generateLinkId(string $category, array $existingLinks): string
{
    $highest = 0;
    foreach ($existingLinks as $link) {
        if (($link['category'] ?? '') !== $category) {
            continue;
        }
        if (preg_match('/-(\d+)$/', (string)($link['id'] ?? ''), $matches)) {
            $highest = max($highest, (int)$matches[1]);
        }
    }

    do {
        $highest++;
        $candidateId = $category . '-' . str_pad((string)$highest, 3, '0', STR_PAD_LEFT);
    } while (linkIdExists($candidateId, $existingLinks));

    return $candidateId;
}

function linkIdExists(string $id, array $links): bool
{
    foreach ($links as $link) {
        if (($link['id'] ?? '') === $id) {
            return true;
        }
    }
    return false;
}

/**
 * @param string $url
 * @param array $links
 * @param string|null $excludeId skip this id when checking (used on update, so a link doesn't collide with its own current URL)
 * @return bool
 */
function urlExists(string $url, array $links, ?string $excludeId = null): bool
{
    foreach ($links as $link) {
        if ($excludeId !== null && ($link['id'] ?? '') === $excludeId) {
            continue;
        }
        if (($link['url'] ?? '') === $url) {
            return true;
        }
    }
    return false;
}

function handleCreate(array $body): void
{
    $data = readLinksData();
    $validCategoryIds = array_column($data['categories'], 'id');

    [$errors, $fields] = extractLinkFields($body, $validCategoryIds);
    if (!empty($errors)) {
        jsonResponse(['success' => false, 'message' => implode(' ', $errors)], 422);
    }
    if (urlExists($fields['url'], $data['links'])) {
        jsonResponse(['success' => false, 'message' => 'لینکی با همین آدرس از قبل وجود دارد.'], 409);
    }

    $newLink = array_merge(['id' => generateLinkId($fields['category'], $data['links'])], $fields);
    $data['links'][] = $newLink;

    writeLinksData($data);
    writeAuditLog('CREATE', $newLink['id']);

    jsonResponse(['success' => true, 'link' => $newLink]);
}

function handleUpdate(array $body): void
{
    $data = readLinksData();
    $validCategoryIds = array_column($data['categories'], 'id');

    $id = (string)($body['id'] ?? '');
    if (!isValidLinkId($id)) {
        jsonResponse(['success' => false, 'message' => 'شناسه لینک نامعتبر است.'], 400);
    }

    [$errors, $fields] = extractLinkFields($body, $validCategoryIds);
    if (!empty($errors)) {
        jsonResponse(['success' => false, 'message' => implode(' ', $errors)], 422);
    }
    if (urlExists($fields['url'], $data['links'], $id)) {
        jsonResponse(['success' => false, 'message' => 'لینکی با همین آدرس از قبل وجود دارد.'], 409);
    }

    $found = false;
    foreach ($data['links'] as &$link) {
        if (($link['id'] ?? '') === $id) {
            $link = array_merge(['id' => $id], $fields);
            $found = true;
            break;
        }
    }
    unset($link);

    if (!$found) {
        jsonResponse(['success' => false, 'message' => 'لینک پیدا نشد.'], 404);
    }

    writeLinksData($data);
    writeAuditLog('UPDATE', $id);

    jsonResponse(['success' => true]);
}

function handleDelete(array $body): void
{
    $data = readLinksData();
    $id = (string)($body['id'] ?? '');

    if (!isValidLinkId($id)) {
        jsonResponse(['success' => false, 'message' => 'شناسه لینک نامعتبر است.'], 400);
    }

    $beforeCount = count($data['links']);
    $data['links'] = array_values(array_filter(
        $data['links'],
        static fn($link) => ($link['id'] ?? '') !== $id
    ));

    if (count($data['links']) === $beforeCount) {
        jsonResponse(['success' => false, 'message' => 'لینک پیدا نشد.'], 404);
    }

    writeLinksData($data);
    writeAuditLog('DELETE', $id);

    jsonResponse(['success' => true]);
}

function handleToggle(array $body): void
{
    $data = readLinksData();
    $id = (string)($body['id'] ?? '');
    $enabled = (bool)($body['enabled'] ?? false);

    if (!isValidLinkId($id)) {
        jsonResponse(['success' => false, 'message' => 'شناسه لینک نامعتبر است.'], 400);
    }

    $found = false;
    foreach ($data['links'] as &$link) {
        if (($link['id'] ?? '') === $id) {
            $link['enabled'] = $enabled;
            $found = true;
            break;
        }
    }
    unset($link);

    if (!$found) {
        jsonResponse(['success' => false, 'message' => 'لینک پیدا نشد.'], 404);
    }

    writeLinksData($data);
    writeAuditLog($enabled ? 'ENABLE' : 'DISABLE', $id);

    jsonResponse(['success' => true]);
}

function handleReorder(array $body): void
{
    $data = readLinksData();
    $order = $body['order'] ?? [];

    if (!is_array($order)) {
        jsonResponse(['success' => false, 'message' => 'داده مرتب‌سازی نامعتبر است.'], 400);
    }

    $orderById = [];
    foreach ($order as $item) {
        $id = (string)($item['id'] ?? '');
        if (!isValidLinkId($id)) {
            continue;
        }
        $orderById[$id] = (int)($item['order'] ?? 0);
    }

    foreach ($data['links'] as &$link) {
        $id = $link['id'] ?? '';
        if (isset($orderById[$id])) {
            $link['order'] = $orderById[$id];
        }
    }
    unset($link);

    writeLinksData($data);
    writeAuditLog('REORDER', implode(',', array_keys($orderById)));

    jsonResponse(['success' => true]);
}
