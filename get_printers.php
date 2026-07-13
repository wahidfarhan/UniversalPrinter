<?php
require_once 'cors.php';
// ==========================================================================
// UCPS PRINTER DATA RETRIEVAL API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

try {
    // Self-healing: Mark printers as Offline if they haven't pinged in the last 45 seconds
    // (45 seconds is optimal: fast detection if app crashes, but avoids false alarms during minor lags)
    $pdo->query("UPDATE printers SET status = 'Offline' WHERE last_ping < datetime('now', '-45 seconds') AND status != 'Offline'");

    // Return only active printers (status != 'Offline') so offline printers do not show on the website
    $stmt = $pdo->query("SELECT * FROM printers WHERE status != 'Offline' ORDER BY status ASC, printer_name ASC");
    $printers = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Resolve shop name for each printer
    $resolved_printers = [];
    foreach ($printers as $p) {
        $shop_name = "Unknown Shop";
        
        // Extract node_id from location, e.g. "Host: Hostname (PRN001)"
        if (preg_match('/\((PRN\d+)\)/', $p['location'], $matches)) {
            $node_id = $matches[1];
            if ($node_id === 'PRN001') {
                $shop_name = 'EWU Lab 3 Spooler';
            } else if ($node_id === 'PRN002') {
                $shop_name = 'UCPS Lab 3 Spooler (Farhan)';
            } else {
                $user_id = intval(substr($node_id, 3));
                $stmt_u = $pdo->prepare("SELECT shop_name, full_name FROM users WHERE user_id = ?");
                $stmt_u->execute([$user_id]);
                $u = $stmt_u->fetch();
                if ($u) {
                    $shop_name = (!empty($u['shop_name'])) ? $u['shop_name'] : ($u['full_name'] . " Print Shop");
                } else {
                    $shop_name = "Shop " . $node_id;
                }
            }
        }
        $p['shop_name'] = $shop_name;
        $resolved_printers[] = $p;
    }

    echo json_encode([
        "status"   => "success",
        "printers" => $resolved_printers
    ]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database fetch failure: " . $e->getMessage()]);
}
?>
