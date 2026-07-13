<?php
require_once 'cors.php';
// ==========================================================================
// UCPS SECURE UPLOAD HANDLER API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

// 1. Validate parameters
$printer_id = $_POST['printer_id'] ?? null;
$user_id = $_POST['user_id'] ?? 1; // Default to test student user if session not set

if ($user_id === 'guest') {
    try {
        $stmt_g = $pdo->prepare("SELECT user_id FROM users WHERE username = 'guest'");
        $stmt_g->execute();
        $res_uid = $stmt_g->fetchColumn();
        if ($res_uid) {
            $user_id = $res_uid;
        } else {
            $guest_hash = password_hash('guest_no_password_hash', PASSWORD_BCRYPT);
            $stmt_ins = $pdo->prepare("INSERT INTO users (username, email, password_hash, role, full_name) VALUES ('guest', 'guest@ucps.cloud', ?, 'student', 'Guest Student')");
            $stmt_ins->execute([$guest_hash]);
            $user_id = $pdo->lastInsertId();
        }
    } catch (\PDOException $ex) {
        $user_id = 1; // Fallback
    }
}

if (!$printer_id || !isset($_FILES['print_file'])) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameters (printer_id, print_file)"]);
    exit;
}

$file = $_FILES['print_file'];

// 2. Size Constraint check
$max_size = 10 * 1024 * 1024; // 10 Megabytes
if ($file['size'] > $max_size) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Security Violation: File exceeds maximum allowed limit (10MB)"]);
    exit;
}

// 3. Extension Validation
$filename = $file['name'];
$ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
$allowed_exts = ['pdf', 'png', 'jpg', 'jpeg'];
if (!in_array($ext, $allowed_exts)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Security Violation: Unauthorized file format extension."]);
    exit;
}

// 4. Binary MIME Sniffing Verification
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$real_mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

$allowed_mimes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg'
];

if (!in_array($real_mime, $allowed_mimes)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Security Violation: MIME-type check mismatch. Malicious file suspected."]);
    exit;
}

// 5. Filename Sanitization & SHA-256 Hashing
$hash = hash('sha256', uniqid($filename, true));
$secure_filename = date('Ymd') . '_' . substr($hash, 0, 16) . '.' . $ext;

// Create upload target folder
$upload_dir = __DIR__ . '/uploads/';
if (!file_exists($upload_dir)) {
    mkdir($upload_dir, 0755, true);
}

$target_path = $upload_dir . $secure_filename;

// 6. Save file to secure buffer directory
if (move_uploaded_file($file['tmp_name'], $target_path)) {
    try {
        // Fetch printer to confirm validity
        $stmt_prn = $pdo->prepare("SELECT printer_name FROM printers WHERE printer_id = ?");
        $stmt_prn->execute([$printer_id]);
        $printer = $stmt_prn->fetch();
        
        if (!$printer) {
            unlink($target_path); // Delete file if printer doesn't exist
            http_response_code(404);
            echo json_encode(["status" => "error", "message" => "Database Lookup: Printer ID not found"]);
            exit;
        }

        // Generate secure unique Job Serial ID (e.g. UCPS-xxxx)
        $stmt_seq = $pdo->query("SELECT seq FROM sqlite_sequence WHERE name = 'print_jobs'");
        $seq = $stmt_seq ? $stmt_seq->fetchColumn() : false;
        $next_id = ($seq !== false) ? (intval($seq) + 1) : 1;
        
        $stmt_max = $pdo->query("SELECT MAX(job_id) FROM print_jobs");
        $max_id = $stmt_max ? intval($stmt_max->fetchColumn()) : 0;
        $next_id = max($next_id, $max_id + 1);
        
        $serial = 1000 + $next_id;
        $job_uuid = "UCPS-" . $serial;

        // Parse advanced print options
        $page_size = $_POST['page_size'] ?? 'A4';
        $page_range = $_POST['page_range'] ?? 'all';
        $copies = isset($_POST['copies']) ? max(1, intval($_POST['copies'])) : 1;
        $print_color = $_POST['print_color'] ?? 'monochrome';

        // Calculate dynamic page count and price
        $file_size_bytes = $file['size'];
        $pages = max(1, ceil($file_size_bytes / (500 * 1024))); // 1 page per 500KB, min 1
        $rate_per_page = ($print_color === 'color') ? 15.00 : 5.00; // 15 BDT for Color, 5 BDT for B&W
        $price = $pages * $rate_per_page * $copies;

        // Capture payment method (bKash immediately sets status to bKash_Paid, Cash sets it to Unpaid)
        $pay_method = $_POST['payment_method'] ?? 'Cash';
        $payment_status = ($pay_method === 'bKash') ? 'bKash_Paid' : 'Unpaid';

        // 7. Insert to database queue with billing columns
        $stmt_insert = $pdo->prepare(
            "INSERT INTO print_jobs (job_uuid, user_id, printer_id, original_filename, secure_filename, file_format, price_bdt, payment_status, status, page_size, page_range, copies, print_color) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?)"
        );
        $stmt_insert->execute([$job_uuid, $user_id, $printer_id, $filename, $secure_filename, strtoupper($ext), $price, $payment_status, $page_size, $page_range, $copies, $print_color]);

        // 8. Return response
        echo json_encode([
            "status" => "success",
            "message" => "Job submitted to database queue successfully",
            "data" => [
                "job_id" => $job_uuid,
                "secure_name" => $secure_filename,
                "printer" => $printer['printer_name']
            ]
        ]);
        
    } catch (\PDOException $e) {
        unlink($target_path); // Cleanup file on database query failure
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Database write error: " . $e->getMessage()]);
    }
} else {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Failed to write file to disk spooler directory"]);
}
?>
