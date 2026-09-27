<?php
/**
 * admin/generate-password-hash.php
 * -----------------------------------------------------------------------
 * Tiny CLI helper: run this once on the server to generate a bcrypt
 * hash for your admin password, then paste the result into
 * config/config.php's `passwordHash` value.
 *
 * Usage (from the project root, in a terminal on the server):
 *
 *   php admin/generate-password-hash.php
 *
 * It will prompt for a password (input is not echoed back to the
 * terminal where the OS supports it) and print the bcrypt hash.
 *
 * This file only ever runs from the command line — it refuses to run
 * if it is somehow requested over HTTP, so it can safely stay on the
 * server without becoming a way to brute-force or leak anything.
 * -----------------------------------------------------------------------
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('این ابزار فقط از خط فرمان (CLI) قابل اجراست.');
}

fwrite(STDOUT, "رمز عبور مدیر را وارد کنید: ");

// Try to hide input on Unix-like systems; falls back to visible input
// on platforms where `stty` isn't available (e.g. some Windows setups).
$isUnixLike = DIRECTORY_SEPARATOR === '/';
if ($isUnixLike) {
    shell_exec('stty -echo');
}

$password = trim((string)fgets(STDIN));

if ($isUnixLike) {
    shell_exec('stty echo');
    fwrite(STDOUT, PHP_EOL);
}

if ($password === '') {
    fwrite(STDERR, "رمز عبور نمی‌تواند خالی باشد." . PHP_EOL);
    exit(1);
}

$hash = password_hash($password, PASSWORD_BCRYPT);

fwrite(STDOUT, PHP_EOL . "این مقدار را در config/config.php به‌عنوان passwordHash قرار دهید:" . PHP_EOL);
fwrite(STDOUT, $hash . PHP_EOL);
