<?php
require_once 'cors.php';
// ==========================================================================
// UCPS REAL-TIME QUEUE RETRIEVAL API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

$node_id = trim($_GET['node_id'] ?? '');
$user_id = intval($_GET['user_id'] ?? 0);
$paired_printer_id = trim($_GET['paired_printer_id'] ?? '');

try {
    if (!empty($node_id)) {
        // Operator view: return all jobs targeting their printers
        $stmt = $pdo->prepare("
            SELECT j.job_id, j.job_uuid, j.original_filename, j.file_format, j.price_bdt, j.payment_status, j.status, j.upload_time,
                   p.printer_name, p.printer_id,
                   COALESCE(u.username, 'guest_student') as username
            FROM print_jobs j
            JOIN printers p ON j.printer_id = p.printer_id
            LEFT JOIN users u ON j.user_id = u.user_id
            WHERE (p.location LIKE ? OR p.printer_id = ?)
            ORDER BY j.upload_time DESC
            LIMIT 100
        ");
        $stmt->execute(["%(" . $node_id . ")%", $node_id]);
        $jobs = $stmt->fetchAll(PDO::FETCH_ASSOC);

    } else if ($user_id > 0) {
        // Student view:
        // 1. Return all jobs uploaded by this student
        // 2. Return active jobs (Pending/Printing) on their paired printer (with privacy masking if uploaded by others)
        if (!empty($paired_printer_id)) {
            $stmt = $pdo->prepare("
                SELECT j.job_id, j.job_uuid, j.original_filename, j.file_format, j.price_bdt, j.payment_status, j.status, j.upload_time,
                       p.printer_name, p.printer_id, j.user_id as job_owner_id,
                       COALESCE(u.username, 'guest_student') as username
                FROM print_jobs j
                JOIN printers p ON j.printer_id = p.printer_id
                LEFT JOIN users u ON j.user_id = u.user_id
                WHERE j.user_id = ? 
                   OR (j.printer_id = ? AND j.status IN ('Pending', 'Printing'))
                ORDER BY j.upload_time DESC
                LIMIT 50
            ");
            $stmt->execute([$user_id, $paired_printer_id]);
        } else {
            $stmt = $pdo->prepare("
                SELECT j.job_id, j.job_uuid, j.original_filename, j.file_format, j.price_bdt, j.payment_status, j.status, j.upload_time,
                       p.printer_name, p.printer_id, j.user_id as job_owner_id,
                       COALESCE(u.username, 'guest_student') as username
                FROM print_jobs j
                JOIN printers p ON j.printer_id = p.printer_id
                LEFT JOIN users u ON j.user_id = u.user_id
                WHERE j.user_id = ?
                ORDER BY j.upload_time DESC
                LIMIT 50
            ");
            $stmt->execute([$user_id]);
        }
        
        $raw_jobs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $jobs = [];
        
        foreach ($raw_jobs as $job) {
            // Apply privacy mask if the job does not belong to the requesting student
            if (intval($job['job_owner_id']) !== $user_id) {
                $job['original_filename'] = "Queued Document (" . $job['username'] . ")";
                $job['username'] = "student_queue";
                $job['price_bdt'] = 0.00;
            }
            unset($job['job_owner_id']);
            $jobs[] = $job;
        }

    } else {
        $jobs = [];
    }

    echo json_encode([
        "status" => "success",
        "jobs" => $jobs
    ]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database queue retrieval failure: " . $e->getMessage()]);
}
?>
