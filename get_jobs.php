<?php
require_once 'cors.php';
// ==========================================================================
// UCPS FIFO QUEUE ACQUISITION API (POLLING ENDPOINT)
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

$node_id = $_GET['node_id'] ?? null;
$printer_id = $_GET['printer_id'] ?? null;

if (!$node_id && !$printer_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing printer_id or node_id query parameter"]);
    exit;
}

try {
    // Heartbeat: update last_ping for all online printers of this node
    if ($node_id) {
        $stmt_ping = $pdo->prepare("UPDATE printers SET last_ping = CURRENT_TIMESTAMP WHERE location LIKE ? AND status = 'Online'");
        $stmt_ping->execute(["%(" . $node_id . ")%"]);
    }

    // Start transactional lock pipeline
    $pdo->beginTransaction();

    // 1. SELECT oldest job (atomic database lock)
    if ($node_id) {
        $stmt = $pdo->prepare(
            "SELECT j.job_id, j.job_uuid, j.secure_filename, j.file_format, p.printer_name, j.printer_id, j.page_size, j.page_range, j.copies, j.print_color
             FROM print_jobs j
             JOIN printers p ON j.printer_id = p.printer_id
             WHERE p.location LIKE ? AND p.status != 'Offline' AND j.status = 'Pending' AND j.payment_status != 'Unpaid'
             ORDER BY j.upload_time ASC 
             LIMIT 1"
        );
        $stmt->execute(["%(" . $node_id . ")%"]);
    } else {
        $stmt = $pdo->prepare(
            "SELECT j.job_id, j.job_uuid, j.secure_filename, j.file_format, p.printer_name, j.printer_id, j.page_size, j.page_range, j.copies, j.print_color
             FROM print_jobs j
             JOIN printers p ON j.printer_id = p.printer_id
             WHERE j.printer_id = ? AND p.status != 'Offline' AND j.status = 'Pending' AND j.payment_status != 'Unpaid'
             ORDER BY j.upload_time ASC 
             LIMIT 1"
        );
        $stmt->execute([$printer_id]);
    }
    $job = $stmt->fetch();

    if ($job) {
        // 2. Lock printer status to Busy in Database
        $stmt_prn = $pdo->prepare("UPDATE printers SET status = 'Busy' WHERE printer_id = ?");
        $stmt_prn->execute([$job['printer_id']]);

        // 3. Mark job status to 'Printing'
        $stmt_job = $pdo->prepare("UPDATE print_jobs SET status = 'Printing', processed_time = CURRENT_TIMESTAMP WHERE job_id = ?");
        $stmt_job->execute([$job['job_id']]);

        // Commit transaction to release row lock
        $pdo->commit();

        echo json_encode([
            "status" => "found",
            "job" => [
                "job_id" => $job['job_id'],
                "job_uuid" => $job['job_uuid'],
                "filename" => $job['secure_filename'],
                "format" => $job['file_format'],
                "printer_name" => $job['printer_name'],
                "printer_id" => $job['printer_id'],
                "page_size" => $job['page_size'],
                "page_range" => $job['page_range'],
                "copies" => $job['copies'],
                "print_color" => $job['print_color']
            ]
        ]);
    } else {
        // No pending jobs, commit transaction safely
        $pdo->commit();
        echo json_encode(["status" => "empty", "message" => "No pending print jobs in spooler queue"]);
    }

} catch (\PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Transaction error: " . $e->getMessage()]);
}
?>
