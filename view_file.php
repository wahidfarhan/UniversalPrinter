<?php
require_once 'cors.php';
// ==========================================================================
// UCPS SECURE DOCUMENT INLINE VIEW API
// ==========================================================================
require_once 'db.php';

$doc_id = $_GET['doc_id'] ?? null;
$user_id = $_GET['user_id'] ?? null;

if (!$doc_id || !$user_id) {
    http_response_code(400);
    echo "Error: Missing required parameters (doc_id, user_id).";
    exit;
}

try {
    // Enforce ownership check to prevent IDOR document disclosure
    $stmt = $pdo->prepare("SELECT * FROM user_documents WHERE doc_id = ? AND user_id = ?");
    $stmt->execute([$doc_id, $user_id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        http_response_code(403);
        echo "Error: Document not found or access denied.";
        exit;
    }

    $filepath = __DIR__ . '/uploads/' . $doc['secure_filename'];

    if (!file_exists($filepath)) {
        http_response_code(404);
        echo "Error: Physical file not found on server storage.";
        exit;
    }

    // Identify MIME-type
    $ext = strtolower(pathinfo($filepath, PATHINFO_EXTENSION));
    $mime = 'application/octet-stream';
    if ($ext === 'pdf') {
        $mime = 'application/pdf';
    } elseif ($ext === 'png') {
        $mime = 'image/png';
    } elseif ($ext === 'jpg' || $ext === 'jpeg') {
        $mime = 'image/jpeg';
    }

    // Force browser to render inline instead of download
    header('Content-Type: ' . $mime);
    header('Content-Disposition: inline; filename="' . basename($doc['original_filename']) . '"');
    header('Content-Length: ' . filesize($filepath));
    header('Cache-Control: public, max-age=600');
    
    // Output file binary stream
    readfile($filepath);
    exit;

} catch (\PDOException $e) {
    http_response_code(500);
    echo "Database error: " . $e->getMessage();
}
?>
