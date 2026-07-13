<?php
require_once 'cors.php';
// ==========================================================================
// UCPS DELETE/CANCEL PRINT JOB API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$job_uuid = $_POST['job_uuid'] ?? null;
$job_id = $_POST['job_id'] ?? null;
$operator_id = $_POST['operator_id'] ?? null;
$user_id = $_POST['user_id'] ?? null;
$requester_id = $operator_id ?? $user_id;

if (!$job_uuid && !$job_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing job_uuid or job_id parameter."]);
    exit;
}

if (!$requester_id) {
    http_response_code(401);
    echo json_encode(["status" => "error", "message" => "Unauthorized. Missing identification parameter."]);
    exit;
}

try {
    // 1. Fetch requester's role
    $stmt_req = $pdo->prepare("SELECT role FROM users WHERE user_id = ?");
    $stmt_req->execute([$requester_id]);
    $role = $stmt_req->fetchColumn();

    if (!$role) {
        http_response_code(403);
        echo json_encode(["status" => "error", "message" => "Forbidden. Invalid user record."]);
        exit;
    }

    // 2. Fetch print job to verify owner and secure filename
    $job = null;
    if ($job_uuid) {
        $stmt_job = $pdo->prepare("SELECT user_id, secure_filename FROM print_jobs WHERE job_uuid = ?");
        $stmt_job->execute([$job_uuid]);
        $job = $stmt_job->fetch();
    } else {
        $stmt_job = $pdo->prepare("SELECT user_id, secure_filename FROM print_jobs WHERE job_id = ?");
        $stmt_job->execute([$job_id]);
        $job = $stmt_job->fetch();
    }

    if (!$job) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Print job not found."]);
        exit;
    }

    // Enforce authorization checks: Must be an operator or the owner student
    if ($role !== 'operator' && intval($job['user_id']) !== intval($requester_id)) {
        http_response_code(403);
        echo json_encode(["status" => "error", "message" => "Forbidden. Access denied to cancel this print job."]);
        exit;
    }

    $filename = $job['secure_filename'];

    // Delete file if not saved in user drive
    if ($filename) {
        $file_path = 'uploads/' . $filename;
        $stmt_doc = $pdo->prepare("SELECT COUNT(*) FROM user_documents WHERE secure_filename = ?");
        $stmt_doc->execute([$filename]);
        $is_saved_in_drive = $stmt_doc->fetchColumn() > 0;

        if (!$is_saved_in_drive && file_exists($file_path)) {
            unlink($file_path);
        }
    }

    if ($job_uuid) {
        $stmt = $pdo->prepare("DELETE FROM print_jobs WHERE job_uuid = ?");
        $stmt->execute([$job_uuid]);
    } else {
        $stmt = $pdo->prepare("DELETE FROM print_jobs WHERE job_id = ?");
        $stmt->execute([$job_id]);
    }

    echo json_encode(["status" => "success", "message" => "Job and spooler files successfully deleted."]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database deletion failed: " . $e->getMessage()]);
}
?>
