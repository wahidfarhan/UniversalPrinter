<?php
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

header('Content-Type: text/plain');

echo "=== UCPS Full Table & Connection Diagnostics ===\n\n";

try {
    echo "1. Loading db.php...\n";
    require_once 'db.php';
    echo "SUCCESS: db.php loaded.\n";
    $mode = $pdo->query("PRAGMA journal_mode")->fetchColumn();
    echo "DATABASE JOURNAL MODE: " . strtoupper($mode) . "\n\n";

    echo "2. Attempting to query printers table...\n";
    $prn_stmt = $pdo->query("SELECT * FROM printers");
    $printers = $prn_stmt->fetchAll();
    echo "SUCCESS: Printers queried. Count: " . count($printers) . "\n";
    print_r($printers);
    echo "\n";

    echo "3. Attempting to query print_jobs table info...\n";
    $cols = $pdo->query("PRAGMA table_info(print_jobs)")->fetchAll();
    echo "COLUMNS IN print_jobs:\n";
    foreach ($cols as $c) {
        echo " - " . $c['name'] . " (" . $c['type'] . ")\n";
    }
    echo "\n";

    $total_count = $pdo->query("SELECT COUNT(*) FROM print_jobs")->fetchColumn();
    echo "TOTAL JOBS IN TABLE: " . $total_count . "\n\n";

    $job_stmt = $pdo->query("SELECT * FROM print_jobs ORDER BY job_id DESC LIMIT 3");
    $jobs = $job_stmt->fetchAll();
    echo "LATEST 3 JOBS:\n";
    print_r($jobs);
    echo "\n";

    echo "4. Attempting to run get_printers.php update query...\n";
    $affected = $pdo->exec("UPDATE printers SET status = 'Offline' WHERE last_ping < datetime('now', '-45 seconds') AND status != 'Offline'");
    echo "SUCCESS: Update query ran. Affected rows: $affected\n";

} catch (Exception $e) {
    echo "FATAL ERROR OCCURRED: " . $e->getMessage() . "\n";
    echo "Trace:\n" . $e->getTraceAsString() . "\n";
}
?>
