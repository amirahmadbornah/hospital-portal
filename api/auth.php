<?php
/**
 * api/auth.php
 * -----------------------------------------------------------------------
 * Login / logout / session-check for the single-administrator admin
 * panel. No roles, no multi-user accounts — exactly one credential
 * pair, read from config/config.php.
 * -----------------------------------------------------------------------
 */

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

header('X-Content-Type-Options: nosniff');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':
        handleLogin($config);
        break;
    case 'logout':
        handleLogout();
        break;
    case 'check':
        handleCheck();
        break;
    default:
        jsonResponse(['success' => false, 'message' => 'درخواست نامعتبر است.'], 400);
}

/**
 * @param array $config from bootstrap.php
 */
function handleLogin(array $config): void
{
    $body = readJsonBody();
    $username = sanitizeText((string)($body['username'] ?? ''), 100);
    $password = (string)($body['password'] ?? '');

    if ($username === '' || $password === '') {
        jsonResponse(['success' => false, 'message' => 'نام کاربری و رمز عبور را وارد کنید.'], 400);
    }

    // hash_equals() for the username avoids leaking (via timing) which
    // of username/password was wrong; password_verify() is already
    // constant-time for the password itself.
    $usernameMatches = hash_equals($config['username'], $username);
    $passwordMatches = password_verify($password, $config['passwordHash']);

    if (!$usernameMatches || !$passwordMatches) {
        jsonResponse(['success' => false, 'message' => 'نام کاربری یا رمز عبور اشتباه است.'], 401);
    }

    // Regenerate the session id on every successful login to prevent
    // session fixation.
    session_regenerate_id(true);
    $_SESSION['authenticated'] = true;
    $_SESSION['username'] = $username;
    $_SESSION['lastActivity'] = time();
    $_SESSION['csrfToken'] = bin2hex(random_bytes(32));

    jsonResponse(['success' => true, 'username' => $username, 'csrfToken' => $_SESSION['csrfToken']]);
}

function handleLogout(): void
{
    $_SESSION = [];
    session_destroy();
    jsonResponse(['success' => true]);
}

function handleCheck(): void
{
    $authenticated = !empty($_SESSION['authenticated']);
    jsonResponse([
        'authenticated' => $authenticated,
        'username' => $authenticated ? ($_SESSION['username'] ?? null) : null,
        'csrfToken' => $authenticated ? ($_SESSION['csrfToken'] ?? '') : null
    ]);
}

/** @return array decoded JSON request body, or [] if absent/invalid. */
function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    $body = json_decode((string)$raw, true);
    return is_array($body) ? $body : [];
}
