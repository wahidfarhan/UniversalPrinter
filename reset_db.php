<?php
header('Content-Type: text/plain');

$parent_dir = dirname(__DIR__);
$db_file = $parent_dir . '/ucps_db.sqlite';
if (!file_exists($db_file)) {
    $db_file = __DIR__ . '/ucps_db.sqlite';
}

if (file_exists($db_file)) {
    // Try to delete the database file to resolve deadlocks
    if (unlink($db_file)) {
        echo "SUCCESS: Database file deleted successfully. System lock reset completed.";
    } else {
        echo "ERROR: Failed to delete database file. File might be hard-locked by active process.";
    }
} else {
    echo "INFO: Database file does not exist. Already clean.";
}
?>
