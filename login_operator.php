<?php
require_once 'cors.php';
// ==========================================================================
// UCPS OPERATOR LOGIN API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$email = trim($_POST['email'] ?? '');
$password = trim($_POST['password'] ?? '');

if (empty($email) || empty($password)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Email and password are required."]);
    exit;
}

try {
    $emailLower = strtolower($email);

    // 1. Database User Check (prioritized for dynamic operator profile updates like avatar)
    $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password_hash'])) {
        if ($user['role'] !== 'operator') {
            http_response_code(403);
            echo json_encode(["status" => "error", "message" => "Access denied. Only operators can login to this client."]);
            exit;
        }

        $dbEmail = strtolower($user['email']);
        if ($dbEmail === 'maloy@ewu.edu.bd') {
            $node_id = 'PRN001';
        } else if ($dbEmail === 'operator@ewu.edu.bd') {
            $node_id = 'PRN002';
        } else {
            $node_id = "PRN" . str_pad($user['user_id'], 3, '0', STR_PAD_LEFT);
        }

        echo json_encode([
            "status" => "success",
            "message" => "Login successful as Registered Operator",
            "operator" => [
                "id" => $user['user_id'],
                "name" => $user['full_name'] ?? $user['username'],
                "email" => $user['email'],
                "shop" => $user['shop_name'] ?? ($user['username'] . " Print Shop"),
                "avatar" => $user['avatar'] ?? null,
                "node_id" => $node_id
            ]
        ]);
        exit;
    }

    // 2. Default Operator Check (from simulation config) (fallback)
    $defaults = [
        'maloy@ewu.edu.bd'    => ['password' => 'password',    'role' => 'operator', 'name' => 'Maloy Roy Orko',    'shop' => 'EWU Lab 3 Spooler',    'id' => 3],
        'operator@ewu.edu.bd' => ['password' => 'password123', 'role' => 'operator', 'name' => 'Farhan',            'shop' => 'UCPS Lab 3 Spooler',   'id' => 4],
    ];

    if (isset($defaults[$emailLower]) && $defaults[$emailLower]['password'] === $password) {
        $d = $defaults[$emailLower];
        $node_id = ($emailLower === 'maloy@ewu.edu.bd') ? 'PRN001' : 'PRN002';
        
        echo json_encode([
            "status" => "success",
            "message" => "Login successful",
            "operator" => [
                "id" => $d['id'],
                "name" => $d['name'],
                "email" => $email,
                "shop" => $d['shop'],
                "avatar" => null,
                "node_id" => $node_id
            ]
        ]);
        exit;
    }

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
    exit;
}

http_response_code(401);
echo json_encode(["status" => "error", "message" => "Invalid email or password."]);
?>
