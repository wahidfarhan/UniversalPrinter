<?php
require_once 'cors.php';
// ==========================================================================
// UCPS JOB STATUS UPDATE & SECURE FILE CLEANUP API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$job_id = $_POST['job_id'] ?? null;
$printer_id = $_POST['printer_id'] ?? null;
$status = $_POST['status'] ?? null; // 'Completed' or 'Failed'

if (!$job_id || !$printer_id || !$status) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameters (job_id, printer_id, status)"]);
    exit;
}

if (!in_array($status, ['Completed', 'Failed'])) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Invalid status state. Use 'Completed' or 'Failed'."]);
    exit;
}

try {
    // 0. Verify printer validity
    $stmt_chk_prn = $pdo->prepare("SELECT COUNT(*) FROM printers WHERE printer_id = ?");
    $stmt_chk_prn->execute([$printer_id]);
    if ($stmt_chk_prn->fetchColumn() == 0) {
        http_response_code(403);
        echo json_encode(["status" => "error", "message" => "Forbidden. Invalid printer registration."]);
        exit;
    }

    // 1. Fetch file name before status change to execute erasure
    $stmt_file = $pdo->prepare("SELECT secure_filename FROM print_jobs WHERE job_id = ? OR job_uuid = ?");
    $stmt_file->execute([$job_id, $job_id]);
    $filename = $stmt_file->fetchColumn();

    if (!$filename) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Job record not found in database"]);
        exit;
    }

    // Database transaction with retry loop for resolving SQLite locks
    $max_attempts = 5;
    $attempt = 0;
    $transaction_success = false;
    $db_err = "";

    while ($attempt < $max_attempts) {
        try {
            $pdo->beginTransaction();

            // 2. Update print job status and stamp completed_time
            $stmt_job = $pdo->prepare("UPDATE print_jobs SET status = ?, processed_time = CURRENT_TIMESTAMP WHERE job_id = ? OR job_uuid = ?");
            $stmt_job->execute([$status, $job_id, $job_id]);

            // 3. Reset printer status to Online
            $stmt_prn = $pdo->prepare("UPDATE printers SET status = 'Online' WHERE printer_id = ?");
            $stmt_prn->execute([$printer_id]);

            $pdo->commit();
            $transaction_success = true;
            break;
        } catch (\PDOException $ex) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $db_err = $ex->getMessage();
            if (strpos(strtolower($db_err), 'locked') !== false) {
                $attempt++;
                usleep(200000); // Wait 200ms before retrying
            } else {
                throw $ex; // Rethrow other database exceptions
            }
        }
    }

    if (!$transaction_success) {
        throw new \PDOException("Transaction failed after {$max_attempts} attempts due to database lock: " . $db_err);
    }

    // 4. Secure Deletion Pipeline (Automatic Cleanup)
    // Check if this file is a saved Cloud Drive file
    $stmt_drive = $pdo->prepare("SELECT COUNT(*) FROM user_documents WHERE secure_filename = ?");
    $stmt_drive->execute([$filename]);
    $is_saved_in_drive = ($stmt_drive->fetchColumn() > 0);

    $filepath = __DIR__ . '/uploads/' . $filename;
    $file_deleted = false;
    
    if (!$is_saved_in_drive && file_exists($filepath)) {
        if (unlink($filepath)) {
            $file_deleted = true;
        }
    }

    echo json_encode([
        "status" => "success",
        "message" => "Job state updated and printer released.",
        "cleanup" => $file_deleted ? "Secure file erased from spooler buffer" : ($is_saved_in_drive ? "File preserved (Cloud Drive saved document)" : "File not found or already deleted")
    ]);

} catch (\PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database operation failed: " . $e->getMessage()]);
}
?>
