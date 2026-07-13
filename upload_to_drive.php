<?php
require_once 'cors.php';
// ==========================================================================
// UCPS UPLOAD TO DOCUMENT DRIVE API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$user_id = $_POST['user_id'] ?? null;

if (!$user_id || !isset($_FILES['print_file'])) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing required parameters (user_id, print_file)"]);
    exit;
}

$file = $_FILES['print_file'];

// Size check
$max_size = 10 * 1024 * 1024;
if ($file['size'] > $max_size) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "File exceeds maximum allowed limit (10MB)"]);
    exit;
}

// Extension validation
$filename = $file['name'];
$ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
$allowed_exts = ['pdf', 'png', 'jpg', 'jpeg'];
if (!in_array($ext, $allowed_exts)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Unauthorized file format extension."]);
    exit;
}

// MIME Sniffing
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
    echo json_encode(["status" => "error", "message" => "MIME-type check mismatch. Invalid file format."]);
    exit;
}

$hash = hash('sha256', uniqid($filename, true));
$secure_filename = date('Ymd') . '_' . substr($hash, 0, 16) . '.' . $ext;

$upload_dir = __DIR__ . '/uploads/';
if (!file_exists($upload_dir)) {
    mkdir($upload_dir, 0755, true);
}

$target_path = $upload_dir . $secure_filename;

if (move_uploaded_file($file['tmp_name'], $target_path)) {
    try {
        $stmt = $pdo->prepare("
            INSERT INTO user_documents (user_id, original_filename, secure_filename, file_format, file_size)
            VALUES (?, ?, ?, ?, ?)
        ");
        $stmt->execute([$user_id, $filename, $secure_filename, strtoupper($ext), $file['size']]);

        echo json_encode([
            "status" => "success",
            "message" => "File uploaded to drive successfully.",
            "data" => [
                "doc_id" => $pdo->lastInsertId(),
                "filename" => $filename,
                "secure_name" => $secure_filename
            ]
        ]);
    } catch (\PDOException $e) {
        unlink($target_path);
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Database insert error: " . $e->getMessage()]);
    }
} else {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Failed to write file to disk."]);
}
?>
