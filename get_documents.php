<?php
require_once 'cors.php';
// ==========================================================================
// UCPS RETRIEVE USER DOCUMENTS FROM DRIVE API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

$user_id = $_GET['user_id'] ?? null;

if (!$user_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameter: user_id"]);
    exit;
}

try {
    $stmt = $pdo->prepare("SELECT * FROM user_documents WHERE user_id = ? ORDER BY uploaded_at DESC");
    $stmt->execute([$user_id]);
    $docs = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        "status" => "success",
        "documents" => $docs
    ]);
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database query error: " . $e->getMessage()]);
}
?>
