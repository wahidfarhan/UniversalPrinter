<?php
require_once 'cors.php';
// ==========================================================================
// UCPS DYNAMIC SYSTEM LOGS RETRIEVAL API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

$node_id = trim($_GET['node_id'] ?? '');
$last_log_id = intval($_GET['last_log_id'] ?? 0);

if (!$node_id) {
    echo json_encode(["status" => "success", "logs" => []]);
    exit;
}

try {
    // Check if table exists (SQLite-compatible)
    $stmt_exists = $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='system_logs'");
    if ($stmt_exists->fetchColumn() == 0) {
        echo json_encode(["status" => "success", "logs" => []]);
        exit;
    }

    $stmt = $pdo->prepare("SELECT * FROM system_logs WHERE log_id > ? AND node_id = ? ORDER BY log_id ASC LIMIT 100");
    $stmt->execute([$last_log_id, $node_id]);
    $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        "status" => "success",
        "logs" => $logs
    ]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
}
?>
