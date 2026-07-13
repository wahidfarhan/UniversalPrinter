<?php
header('Content-Type: text/plain');

$zip_file = 'cpanel_fresh_release.zip';

if (!file_exists($zip_file)) {
    echo "ERROR: cpanel_fresh_release.zip not found in this directory.\n";
    echo "Please upload 'cpanel_fresh_release.zip' to your cPanel directory first, then refresh this page.";
    exit;
}

echo "=== UCPS Server Self-Healing Auto-Extractor ===\n\n";

echo "1. Cleaning up mixed/corrupt server files...\n";
$corrupt_files = ['app.js', 'add_log.php', 'get_jobs.php', 'index.html', 'login.php', 'login_operator.php', 'update_status.php', 'reset_db.php', 'diag.php', 'stream_jobs.php'];
foreach ($corrupt_files as $file) {
    if (file_exists($file)) {
        if (unlink($file)) {
            echo "  [OK] Deleted: $file\n";
        } else {
            echo "  [FAIL] Could not delete: $file (check permissions)\n";
        }
    }
}

echo "\n2. Extracting cpanel_fresh_release.zip...\n";
$zip = new ZipArchive;
if ($zip->open($zip_file) === TRUE) {
    $zip->extractTo(__DIR__);
    $zip->close();
    echo "  [OK] Extraction completed successfully!\n\n";
    echo "SUCCESS: All website files have been successfully restored and synchronized. You can now open your browser and access https://print.codingverse.me/";
} else {
    echo "  [FATAL] Failed to open cpanel_fresh_release.zip. The file might be incomplete or corrupted during upload.\n";
}
?>
