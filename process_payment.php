<?php
require_once 'cors.php';
// ==========================================================================
// UCPS MOCK BKASH/CASH PAYMENT VERIFICATION CALLBACK API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$job_id = $_POST['job_id'] ?? null;
$action = $_POST['action'] ?? 'bKash'; // 'bKash' or 'ApproveCash'
$operator_id = $_POST['operator_id'] ?? null;

if (!$job_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing job_id parameter"]);
    exit;
}

// Enforce operator role validation to prevent unauthenticated payment settles
if (!$operator_id) {
    http_response_code(401);
    echo json_encode(["status" => "error", "message" => "Unauthorized. Missing operator verification."]);
    exit;
}

try {
    $stmt_op = $pdo->prepare("SELECT role FROM users WHERE user_id = ?");
    $stmt_op->execute([$operator_id]);
    $role = $stmt_op->fetchColumn();

    if ($role !== 'operator') {
        http_response_code(403);
        echo json_encode(["status" => "error", "message" => "Forbidden. Only operators can modify payment status."]);
        exit;
    }

    // Determine new status
    $new_payment_status = ($action === 'ApproveCash') ? 'Cash_Approved' : 'bKash_Paid';

    // Update job row
    $stmt = $pdo->prepare("UPDATE print_jobs SET payment_status = ? WHERE job_uuid = ? OR job_id = ?");
    $stmt->execute([$new_payment_status, $job_id, $job_id]);

    if ($stmt->rowCount() > 0) {
        echo json_encode([
            "status" => "success",
            "message" => "Payment transaction settled successfully",
            "payment_status" => $new_payment_status
        ]);
    } else {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Job record not found or already paid"]);
    }

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database transaction failure: " . $e->getMessage()]);
}
?>
