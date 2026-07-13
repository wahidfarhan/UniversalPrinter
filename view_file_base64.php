<?php
require_once 'cors.php';
// ==========================================================================
// UCPS SECURE DOCUMENT BASE64 RETRIEVAL API (BYPASSES DOWNLOAD MANAGERS/IDM)
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

$doc_id = $_GET['doc_id'] ?? null;
$user_id = $_GET['user_id'] ?? null;

if (!$doc_id || !$user_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameters (doc_id, user_id)."]);
    exit;
}

try {
    // Enforce ownership check to prevent IDOR document base64 leakage
    $stmt = $pdo->prepare("SELECT * FROM user_documents WHERE doc_id = ? AND user_id = ?");
    $stmt->execute([$doc_id, $user_id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        http_response_code(403);
        echo json_encode(["status" => "error", "message" => "Document not found or access denied."]);
        exit;
    }

    $filepath = __DIR__ . '/uploads/' . $doc['secure_filename'];

    if (!file_exists($filepath)) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Physical file not found on server disk storage."]);
        exit;
    }

    // Convert file content to Base64 to bypass browser download interceptors (like IDM)
    $filedata = file_get_contents($filepath);
    $base64 = base64_encode($filedata);

    echo json_encode([
        "status" => "success",
        "filename" => $doc['original_filename'],
        "format" => $doc['file_format'],
        "pdf_base64" => $base64
    ]);
    exit;

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database exception: " . $e->getMessage()]);
}
?>
