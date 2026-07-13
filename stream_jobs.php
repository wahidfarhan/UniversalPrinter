<?php
require_once 'cors.php';
// ==========================================================================
// UCPS REAL-TIME FIFO QUEUE SSE STREAM API (SSE PUSH ENDPOINT)
// ==========================================================================
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no'); // Disable buffering on Nginx/Apache proxy
header('X-LiteSpeed-No-Buffering: true'); // Disable buffering on LiteSpeed
header('Content-Encoding: none'); // Disable gzip compression for real-time SSE

require_once 'db.php';

$node_id = $_GET['node_id'] ?? null;
$printer_id = $_GET['printer_id'] ?? null;

if (!$node_id && !$printer_id) {
    echo "event: error\n";
    echo "data: " . json_encode(["message" => "Missing printer_id or node_id query parameter"]) . "\n\n";
    exit;
}

// Set script timeout to 40 seconds (safely below Apache/PHP default timeouts)
set_time_limit(40);
ignore_user_abort(true);

$start_time = time();
$heartbeat_interval = 5; // SSE heartbeat comment every 5 seconds (no DB overhead)
$db_ping_interval = 30;  // Update printer ping in DB only once every 30 seconds
$last_heartbeat = time();
$last_db_ping = 0; // Trigger on first loop iteration

while (true) {
    // 1. Check if the connection has been aborted by client
    if (connection_aborted()) {
        break;
    }

    // 2. Keep script running for max 35 seconds to allow safe client reconnect cycles
    if ((time() - $start_time) > 35) {
        echo "event: reconnect\n";
        echo "data: reconnecting\n\n";
        ob_flush();
        flush();
        break;
    }

    try {
        // Update last_ping status for online printers in DB only once every 30 seconds
        if ($node_id && (time() - $last_db_ping) >= $db_ping_interval) {
            $stmt_ping = $pdo->prepare("UPDATE printers SET last_ping = CURRENT_TIMESTAMP WHERE location LIKE ? AND status = 'Online'");
            $stmt_ping->execute(["%(" . $node_id . ")%"]);
            $last_db_ping = time();
        }

        // Query oldest pending print job (read-first, no transaction lock)
        if ($node_id) {
            $stmt = $pdo->prepare(
                "SELECT j.job_id, j.job_uuid, j.secure_filename, j.file_format, p.printer_name, j.printer_id, j.page_size, j.page_range, j.copies, j.print_color
                 FROM print_jobs j
                 JOIN printers p ON j.printer_id = p.printer_id
                 WHERE p.location LIKE ? AND j.status = 'Pending' AND j.payment_status != 'Unpaid'
                 ORDER BY j.upload_time ASC 
                 LIMIT 1"
            );
            $stmt->execute(["%(" . $node_id . ")%"]);
        } else {
            $stmt = $pdo->prepare(
                "SELECT j.job_id, j.job_uuid, j.secure_filename, j.file_format, p.printer_name, j.printer_id, j.page_size, j.page_range, j.copies, j.print_color
                 FROM print_jobs j
                 JOIN printers p ON j.printer_id = p.printer_id
                 WHERE j.printer_id = ? AND j.status = 'Pending' AND j.payment_status != 'Unpaid'
                 ORDER BY j.upload_time ASC 
                 LIMIT 1"
            );
            $stmt->execute([$printer_id]);
        }
        $job = $stmt->fetch();

        if ($job) {
            // A pending job is found. Start transaction to acquire write lock and process it
            $pdo->beginTransaction();

            // Re-verify the status under transaction block to prevent race conditions
            $stmt_lock = $pdo->prepare("SELECT status FROM print_jobs WHERE job_id = ?");
            $stmt_lock->execute([$job['job_id']]);
            $current_status = $stmt_lock->fetchColumn();

            if ($current_status === 'Pending') {
                // Lock printer status to Busy in DB
                $stmt_prn = $pdo->prepare("UPDATE printers SET status = 'Busy' WHERE printer_id = ?");
                $stmt_prn->execute([$job['printer_id']]);

                // Mark job status to 'Printing'
                $stmt_job = $pdo->prepare("UPDATE print_jobs SET status = 'Printing', processed_time = CURRENT_TIMESTAMP WHERE job_id = ?");
                $stmt_job->execute([$job['job_id']]);

                $pdo->commit();

                // Stream job payload to client instantly!
                echo "event: print_job\n";
                echo "data: " . json_encode([
                    "job_id" => $job['job_id'],
                    "job_uuid" => $job['job_uuid'],
                    "filename" => $job['secure_filename'],
                    "format" => $job['file_format'],
                    "printer_name" => $job['printer_name'],
                    "printer_id" => $job['printer_id'],
                    "page_size" => $job['page_size'],
                    "page_range" => $job['page_range'],
                    "copies" => $job['copies'],
                    "print_color" => $job['print_color']
                ]) . "\n\n";

                ob_flush();
                flush();
                $last_heartbeat = time();
            } else {
                // Already locked/printed by another spooler process
                $pdo->rollBack();
            }
        } else {
            // Send silent heartbeat comment if interval reached
            if ((time() - $last_heartbeat) >= $heartbeat_interval) {
                echo ": heartbeat\n\n";
                ob_flush();
                flush();
                $last_heartbeat = time();
            }
        }

    } catch (Exception $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        echo "event: error\n";
        echo "data: " . json_encode(["error" => $e->getMessage()]) . "\n\n";
        ob_flush();
        flush();
        sleep(2); // Throttling on error
    }

    // Sleep for 1 second before next cycle to maintain low server resource consumption
    sleep(1);
}
?>
