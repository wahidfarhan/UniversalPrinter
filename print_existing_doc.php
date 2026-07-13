<?php
require_once 'cors.php';
// ==========================================================================
// UCPS SUBMIT PRINT JOB FROM EXISTING DOCUMENT API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$doc_id = $_POST['doc_id'] ?? null;
$printer_id = $_POST['printer_id'] ?? null;
$user_id = $_POST['user_id'] ?? null;
$pay_method = $_POST['payment_method'] ?? 'Cash';

if (!$doc_id || !$printer_id || !$user_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameters (doc_id, printer_id, user_id)"]);
    exit;
}

try {
    // 1. Fetch document details
    $stmt_doc = $pdo->prepare("SELECT * FROM user_documents WHERE doc_id = ? AND user_id = ?");
    $stmt_doc->execute([$doc_id, $user_id]);
    $doc = $stmt_doc->fetch();

    if (!$doc) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Document not found in your drive."]);
        exit;
    }

    // 2. Fetch printer details
    $stmt_prn = $pdo->prepare("SELECT printer_name FROM printers WHERE printer_id = ? AND status = 'Online'");
    $stmt_prn->execute([$printer_id]);
    $printer = $stmt_prn->fetch();

    if (!$printer) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Printer is offline or not found."]);
        exit;
    }

    // 3. Generate secure unique Job Serial ID (e.g. UCPS-xxxx)
    $stmt_seq = $pdo->query("SELECT seq FROM sqlite_sequence WHERE name = 'print_jobs'");
    $seq = $stmt_seq ? $stmt_seq->fetchColumn() : false;
    $next_id = ($seq !== false) ? (intval($seq) + 1) : 1;
    
    $stmt_max = $pdo->query("SELECT MAX(job_id) FROM print_jobs");
    $max_id = $stmt_max ? intval($stmt_max->fetchColumn()) : 0;
    $next_id = max($next_id, $max_id + 1);
    
    $serial = 1000 + $next_id;
    $job_uuid = "UCPS-" . $serial;

    // Calculate dynamic price based on file properties and options
    $page_size = $_POST['page_size'] ?? 'A4';
    $page_range = $_POST['page_range'] ?? 'all';
    $copies = isset($_POST['copies']) ? max(1, intval($_POST['copies'])) : 1;
    $print_color = $_POST['print_color'] ?? 'monochrome';

    // Mock estimation: 1 page per 350KB, minimum 1 page
    $file_size = intval($doc['file_size'] ?? 1);
    $pages = max(1, ceil($file_size / (350 * 1024)));
    $rate_per_page = ($print_color === 'color') ? 15.00 : 5.00; // 15 BDT for Color, 5 BDT for B&W
    $price = $pages * $rate_per_page * $copies;

    $payment_status = ($pay_method === 'bKash') ? 'bKash_Paid' : 'Unpaid';

    // 4. Insert to print_jobs queue
    $stmt_insert = $pdo->prepare("
        INSERT INTO print_jobs (job_uuid, user_id, printer_id, original_filename, secure_filename, file_format, price_bdt, payment_status, status, page_size, page_range, copies, print_color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?)
    ");
    $stmt_insert->execute([
        $job_uuid,
        $user_id,
        $printer_id,
        $doc['original_filename'],
        $doc['secure_filename'],
        $doc['file_format'],
        $price,
        $payment_status,
        $page_size,
        $page_range,
        $copies,
        $print_color
    ]);

    echo json_encode([
        "status" => "success",
        "message" => "Print job submitted successfully from pre-existing file.",
        "data" => [
            "job_id" => $job_uuid,
            "filename" => $doc['original_filename'],
            "printer" => $printer['printer_name']
        ]
    ]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
}
?>
