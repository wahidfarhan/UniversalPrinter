<?php
require_once 'cors.php';
// ==========================================================================
// UCPS DELETE DRIVE DOCUMENT API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$doc_id = $_POST['doc_id'] ?? null;
$user_id = $_POST['user_id'] ?? null;

if (!$doc_id || !$user_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameters (doc_id, user_id)"]);
    exit;
}

try {
    // 1. Fetch secure filename to delete it from disk
    $stmt = $pdo->prepare("SELECT secure_filename FROM user_documents WHERE doc_id = ? AND user_id = ?");
    $stmt->execute([$doc_id, $user_id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Document not found or access denied."]);
        exit;
    }

    $filepath = __DIR__ . '/uploads/' . $doc['secure_filename'];
    if (file_exists($filepath)) {
        unlink($filepath); // Remove file from disk
    }

    // 2. Delete from database
    $stmt_del = $pdo->prepare("DELETE FROM user_documents WHERE doc_id = ? AND user_id = ?");
    $stmt_del->execute([$doc_id, $user_id]);

    echo json_encode([
        "status" => "success",
        "message" => "Document deleted successfully from drive."
    ]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
}
?>
