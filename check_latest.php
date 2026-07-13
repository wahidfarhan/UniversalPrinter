<?php
header('Content-Type: text/plain');
require_once 'db.php';
try {
    $stmt = $pdo->query("SELECT job_id, job_uuid, page_range, status, upload_time FROM print_jobs ORDER BY job_id DESC LIMIT 5");
    print_r($stmt->fetchAll());
} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
?>
