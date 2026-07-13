<?php
require_once 'cors.php';
// ==========================================================================
// UCPS DYNAMIC PRINTER REGISTRY & SYNCHRONIZATION API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$node_id = $_POST['node_id'] ?? null;
$action = $_POST['action'] ?? 'sync';

if (!$node_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameter node_id"]);
    exit;
}

// Immediate offline notification handler
if ($action === 'offline') {
    try {
        $stmt_offline = $pdo->prepare("UPDATE printers SET status = 'Offline' WHERE location LIKE ?");
        $stmt_offline->execute(["%(" . $node_id . ")%"]);
        echo json_encode([
            "status" => "success",
            "message" => "Successfully set all printers to Offline for node " . $node_id
        ]);
        exit;
    } catch (\PDOException $e) {
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Database failure: " . $e->getMessage()]);
        exit;
    }
}

$printers_json = $_POST['printers'] ?? null;
if (!$printers_json) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameter printers"]);
    exit;
}

$printers = json_decode($printers_json, true);
if (!is_array($printers)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Invalid printers format. Expected JSON array."]);
    exit;
}

try {
    $pdo->beginTransaction();

    // 1. Set all printers belonging to this specific node to 'Offline'
    // We search by location which ends with "(<node_id>)"
    $stmt_offline = $pdo->prepare("UPDATE printers SET status = 'Offline' WHERE location LIKE ?");
    $stmt_offline->execute(["%(" . $node_id . ")%"]);

    $registered_ids = [];
    foreach ($printers as $name) {
        $name = trim($name);
        if (empty($name)) continue;

        $location = "Host: " . gethostname() . " (" . $node_id . ")";

        // Check if this printer is already registered for this node
        $stmt_check = $pdo->prepare("SELECT printer_id FROM printers WHERE printer_name = ? AND location = ?");
        $stmt_check->execute([$name, $location]);
        $row = $stmt_check->fetch();

        if ($row) {
            $printer_id = $row['printer_id'];
            // Update status to Online
            $stmt_update = $pdo->prepare("UPDATE printers SET status = 'Online', last_ping = CURRENT_TIMESTAMP WHERE printer_id = ?");
            $stmt_update->execute([$printer_id]);
        } else {
            // Generate a new unique 4-digit code (e.g. 1001, 1002...)
            $stmt_max = $pdo->query("SELECT MAX(CAST(printer_id AS INTEGER)) AS max_id FROM printers");
            $max_row = $stmt_max->fetch();
            $new_id = $max_row['max_id'] ? intval($max_row['max_id']) + 1 : 1001;
            
            // Double check uniqueness
            while (true) {
                $stmt_exists = $pdo->prepare("SELECT COUNT(*) FROM printers WHERE printer_id = ?");
                $stmt_exists->execute([$new_id]);
                if ($stmt_exists->fetchColumn() == 0) {
                    break;
                }
                $new_id++;
            }
            
            $printer_id = strval($new_id);

            // Insert new printer
            $stmt_insert = $pdo->prepare("INSERT INTO printers (printer_id, printer_name, location, status, ink_level, paper_status) VALUES (?, ?, ?, 'Online', '100%', 'Ready')");
            $stmt_insert->execute([$printer_id, $name, $location]);
        }

        $registered_ids[] = $printer_id;
    }

    $pdo->commit();

    echo json_encode([
        "status" => "success",
        "message" => "Successfully synchronized " . count($registered_ids) . " printers for node " . $node_id,
        "synced_printers" => $registered_ids
    ]);

} catch (\PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database transaction failure: " . $e->getMessage()]);
}
?>
