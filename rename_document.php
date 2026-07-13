<?php
require_once 'cors.php';
// ==========================================================================
// UCPS RENAME DRIVE DOCUMENT API
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
$new_name = trim($_POST['new_name'] ?? '');

if (!$doc_id || !$user_id || empty($new_name)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameters (doc_id, user_id, new_name)"]);
    exit;
}

try {
    // 1. Check if document exists and belongs to the user
    $stmt_check = $pdo->prepare("SELECT original_filename FROM user_documents WHERE doc_id = ? AND user_id = ?");
    $stmt_check->execute([$doc_id, $user_id]);
    $doc = $stmt_check->fetch();

    if (!$doc) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Document not found or access denied."]);
        exit;
    }

    // Preserve original extension if not supplied in the new name
    $old_ext = pathinfo($doc['original_filename'], PATHINFO_EXTENSION);
    $new_ext = pathinfo($new_name, PATHINFO_EXTENSION);

    if (empty($new_ext) && !empty($old_ext)) {
        $new_name .= '.' . $old_ext;
    }

    // 2. Update filename in database
    $stmt_update = $pdo->prepare("UPDATE user_documents SET original_filename = ? WHERE doc_id = ? AND user_id = ?");
    $stmt_update->execute([$new_name, $doc_id, $user_id]);

    echo json_encode([
        "status" => "success",
        "message" => "Document renamed successfully.",
        "new_name" => $new_name
    ]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
}
?>
