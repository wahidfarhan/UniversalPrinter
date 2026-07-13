<?php
// ==========================================================================
// UCPS SHARED CORS + COMMON HEADERS (include this in all API files)
// ==========================================================================
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$http_host = $_SERVER['HTTP_HOST'] ?? '';

$is_allowed = false;
if (empty($origin)) {
    $is_allowed = true;
} else {
    $parsed = parse_url($origin);
    $origin_host = $parsed['host'] ?? '';
    
    // Allow localhost, 127.0.0.1, or same-origin requests matching host
    if ($origin_host === 'localhost' || $origin_host === '127.0.0.1' || (!empty($http_host) && strpos($http_host, $origin_host) !== false)) {
        $is_allowed = true;
    }
}

if ($is_allowed && !empty($origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: null');
}

header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}
?>
