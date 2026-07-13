<?php
require_once 'cors.php';
// ==========================================================================
// UCPS PRINTER STATUS UPDATE API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$printer_id = $_POST['printer_id'] ?? null;
$status = $_POST['status'] ?? null;

if (!$printer_id || !$status) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameters (printer_id, status)"]);
    exit;
}

// Validate status value
$allowed_statuses = ['Online', 'Offline', 'Busy'];
if (!in_array($status, $allowed_statuses)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Invalid status value. Allowed: Online, Offline, Busy"]);
    exit;
}

try {
    // Update the printer status in database
    $stmt = $pdo->prepare("UPDATE printers SET status = ?, last_ping = CURRENT_TIMESTAMP WHERE printer_id = ?");
    $stmt->execute([$status, $printer_id]);

    if ($stmt->rowCount() > 0) {
        echo json_encode([
            "status" => "success",
            "message" => "Printer status successfully updated to " . $status
        ]);
    } else {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Printer not found or status unchanged"]);
    }

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database failure: " . $e->getMessage()]);
}
?>
