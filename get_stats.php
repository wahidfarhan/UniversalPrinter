<?php
require_once 'cors.php';
header('Content-Type: application/json');
require_once 'db.php';

$node_id = trim($_GET['node_id'] ?? '');
// Get date parameter from client (e.g. YYYY-MM-DD), default to server local date
$client_date = trim($_GET['date'] ?? '');

if (!$node_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing node_id"]);
    exit;
}

try {
    $driver   = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    $is_sqlite = ($driver === 'sqlite');

    // Build the date filter based on client parameter or server local time fallback
    if ($client_date && preg_match('/^\d{4}-\d{2}-\d{2}$/', $client_date)) {
        $date_val = $client_date;
        if ($is_sqlite) {
            $primary_date_clause = "date(j.upload_time, '+6 hours') = :client_date";
            $fallback_date_clause = "date(upload_time, '+6 hours') = :client_date";
        } else {
            $primary_date_clause = "date(j.upload_time) = :client_date";
            $fallback_date_clause = "date(upload_time) = :client_date";
        }
    } else {
        $date_val = null;
        if ($is_sqlite) {
            // SQLite datetime fallback: use local server time date (+6 hours offset for Dhaka)
            $primary_date_clause = "date(j.upload_time, '+6 hours') = date('now', '+6 hours')";
            $fallback_date_clause = "date(upload_time, '+6 hours') = date('now', '+6 hours')";
        } else {
            $primary_date_clause = "DATE(j.upload_time) = CURDATE()";
            $fallback_date_clause = "DATE(upload_time) = CURDATE()";
        }
    }

    // 1. Primary Query: count completed jobs today matching node_id against printer location or printer_id
    $stmt = $pdo->prepare("
        SELECT 
            COUNT(j.job_id)              AS total_jobs,
            COALESCE(SUM(j.price_bdt), 0) AS total_revenue
        FROM print_jobs j
        JOIN printers p ON j.printer_id = p.printer_id
        WHERE j.status = 'Completed'
          AND $primary_date_clause
          AND (p.location LIKE :node_like OR p.printer_id LIKE :node_like)
    ");
    
    $params = [':node_like' => '%' . $node_id . '%'];
    if ($date_val !== null) {
        $params[':client_date'] = $date_val;
    }
    
    $stmt->execute($params);
    $row = $stmt->fetch();

    $total_jobs    = intval($row['total_jobs']    ?? 0);
    $total_revenue = floatval($row['total_revenue'] ?? 0.0);



    echo json_encode([
        "status"        => "success",
        "total_jobs"    => $total_jobs,
        "total_revenue" => round($total_revenue, 2),
        "debug_date"    => $date_val ? $date_val : 'server_fallback'
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
?>
