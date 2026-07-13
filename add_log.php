<?php
require_once 'cors.php';
// ==========================================================================
// UCPS DYNAMIC SYSTEM LOGS RECIEVER API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$node_id = $_POST['node_id'] ?? 'SYSTEM';
$message = $_POST['message'] ?? '';
$log_type = $_POST['log_type'] ?? 'info';

if (empty($message)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameter 'message'"]);
    exit;
}

try {
    // Table already ensured by db.php on every boot - no need to recreate

    $stmt = $pdo->prepare("INSERT INTO system_logs (node_id, message, log_type) VALUES (?, ?, ?)");
    $stmt->execute([$node_id, $message, $log_type]);

    echo json_encode(["status" => "success", "message" => "Log saved successfully."]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
}
?>
