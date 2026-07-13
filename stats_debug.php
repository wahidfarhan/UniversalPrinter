<?php
// ==========================================================================
// UCPS STATS DEBUG PAGE — stats_debug.php
// Open this in browser: https://yoursite.com/stats_debug.php
// DELETE THIS FILE AFTER DEBUGGING!
// ==========================================================================
require_once 'db.php';
header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html><html><head><style>
body{font-family:monospace;background:#111;color:#0f0;padding:20px;}
table{border-collapse:collapse;width:100%;}
td,th{border:1px solid #333;padding:8px;text-align:left;}
th{background:#222;color:#0af;}
.ok{color:#0f0;} .warn{color:#ff0;} .err{color:#f00;}
h2{color:#0af;}
</style></head><body>
<h2>🔍 UCPS Stats Debug</h2>

<?php
// ── 1. Database driver
$driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
echo "<p><b>DB Driver:</b> <span class='ok'>$driver</span></p>";

// ── 2. Current server time
if ($driver === 'sqlite') {
    $now_row = $pdo->query("SELECT datetime('now') as utc, datetime('now','localtime') as local, date('now','localtime') as today")->fetch();
} else {
    $now_row = $pdo->query("SELECT NOW() as utc, NOW() as local, CURDATE() as today")->fetch();
}
echo "<p><b>Server UTC:</b> {$now_row['utc']}</p>";
echo "<p><b>Server Local:</b> {$now_row['local']}</p>";
echo "<p><b>Today (localtime):</b> <span class='ok'>{$now_row['today']}</span></p>";

// ── 3. All print jobs in the DB
echo "<h2>📋 All Print Jobs</h2>";
$jobs = $pdo->query("SELECT job_id, job_uuid, status, price_bdt, upload_time, processed_time, printer_id FROM print_jobs ORDER BY job_id DESC LIMIT 20")->fetchAll();
if (empty($jobs)) {
    echo "<p class='warn'>⚠ No jobs found in DB!</p>";
} else {
    echo "<table><tr><th>ID</th><th>UUID</th><th>Status</th><th>Price BDT</th><th>Upload Time</th><th>Processed Time</th><th>Printer ID</th></tr>";
    foreach ($jobs as $j) {
        $cls = ($j['status'] === 'Completed') ? 'ok' : (($j['status'] === 'Failed') ? 'err' : 'warn');
        echo "<tr>";
        echo "<td>{$j['job_id']}</td>";
        echo "<td>{$j['job_uuid']}</td>";
        echo "<td class='$cls'>{$j['status']}</td>";
        echo "<td>{$j['price_bdt']}</td>";
        echo "<td>{$j['upload_time']}</td>";
        echo "<td>" . ($j['processed_time'] ?? '<span class=err>NULL</span>') . "</td>";
        echo "<td>{$j['printer_id']}</td>";
        echo "</tr>";
    }
    echo "</table>";
}

// ── 4. Today's completed jobs (same query as get_stats.php)
echo "<h2>📊 Today's Completed Jobs (Stats Query Result)</h2>";
if ($driver === 'sqlite') {
    $today_filter = "date(upload_time) = date('now','localtime')";
} else {
    $today_filter = "DATE(upload_time) = CURDATE()";
}
$r = $pdo->query("SELECT COUNT(*) as cnt, COALESCE(SUM(price_bdt),0) as rev FROM print_jobs WHERE status='Completed' AND $today_filter")->fetch();
echo "<p><b>Count:</b> <span class='" . ($r['cnt']>0?'ok':'err') . "'>{$r['cnt']}</span></p>";
echo "<p><b>Revenue:</b> <span class='ok'>{$r['rev']} BDT</span></p>";

// ── 5. Printers
echo "<h2>🖨 Registered Printers</h2>";
$printers = $pdo->query("SELECT printer_id, printer_name, location, status FROM printers")->fetchAll();
echo "<table><tr><th>ID</th><th>Name</th><th>Location</th><th>Status</th></tr>";
foreach ($printers as $p) {
    echo "<tr><td>{$p['printer_id']}</td><td>{$p['printer_name']}</td><td>{$p['location']}</td><td>{$p['status']}</td></tr>";
}
echo "</table>";

echo "<br><p class='err'>⚠ DELETE stats_debug.php from server after debugging!</p>";
?>
</body></html>
