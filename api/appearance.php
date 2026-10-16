<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/AppearanceSettings.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$categories = readLinksData()['categories'];
$path = PORTAL_ROOT . '/data/appearance.json';
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    jsonResponse(['success'=>true, 'data'=>AppearanceSettings::read($path, $categories), 'categories'=>array_map(static fn($c)=>['id'=>$c['id'], 'title'=>$c['title'], 'color'=>$c['color'] ?? '#477DFF'], $categories), 'defaults'=>AppearanceSettings::DEFAULTS]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['success'=>false, 'message'=>'درخواست نامعتبر است.'], 405);
requireAuthenticated();
$body = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body)) jsonResponse(['success'=>false, 'message'=>'اطلاعات نامعتبر است.'], 400);
requireValidCsrf($body['csrfToken'] ?? null);
try {
    $settings = AppearanceSettings::validate($body, $categories);
} catch (InvalidArgumentException $e) {
    jsonResponse(['success'=>false, 'message'=>$e->getMessage()], 422);
}
AppearanceSettings::save($path, $settings);
writeAuditLog('APPEARANCE', 'portal');
jsonResponse(['success'=>true, 'data'=>$settings, 'message'=>'رنگ‌بندی ذخیره و اعمال شد.']);
