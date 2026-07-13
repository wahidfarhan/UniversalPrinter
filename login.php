<?php
require_once 'cors.php';
// ==========================================================================
// UCPS USER/OPERATOR LOGIN API (WEB PORTAL)
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$email = trim($_POST['email'] ?? '');
$password = $_POST['password'] ?? '';
$role = $_POST['role'] ?? 'student';

if (empty($email) || empty($password)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Email and password are required."]);
    exit;
}

try {
    $emailLower = strtolower($email);
    
    // ── 1. Database check (prioritized for dynamic user profile updates like avatar) ──
    $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password_hash'])) {
        if ($user['role'] !== $role) {
            http_response_code(403);
            echo json_encode(["status" => "error", "message" => "Role mismatch. Access denied."]);
            exit;
        }

        $node_id = null;
        if ($user['role'] === 'operator') {
            $dbEmail = strtolower($user['email']);
            if ($dbEmail === 'maloy@ewu.edu.bd') {
                $node_id = 'PRN001';
            } else if ($dbEmail === 'operator@ewu.edu.bd') {
                $node_id = 'PRN002';
            } else {
                $node_id = "PRN" . str_pad($user['user_id'], 3, '0', STR_PAD_LEFT);
            }
        }

        echo json_encode([
            "status" => "success",
            "message" => "Login successful",
            "user" => [
                "id"        => $user['user_id'],
                "username"  => $user['username'],
                "email"     => $user['email'],
                "role"      => $user['role'],
                "name"      => $user['full_name'] ?? $user['username'],
                "studentId" => $user['student_id'],
                "shop"      => $user['shop_name'],
                "dept"      => $user['dept'],
                "avatar"    => $user['avatar'] ?? null,
                "node_id"   => $node_id
            ]
        ]);
        exit;
    }

    // ── 2. Default credential fallback (works even on fresh/empty database) ──
    $defaults = [
        'maloy@ewu.edu.bd'    => ['password' => 'password',    'role' => 'operator', 'name' => 'Maloy Roy Orko',    'shop' => 'EWU Lab 3 Spooler',    'id' => 3],
        'operator@ewu.edu.bd' => ['password' => 'password123', 'role' => 'operator', 'name' => 'Farhan',            'shop' => 'UCPS Lab 3 Spooler',   'id' => 4],
        'student1@ewu.edu.bd' => ['password' => 'password123', 'role' => 'student',  'name' => 'Wahidur Rahman',    'studentId' => '2022-1-60-001', 'dept' => 'CSE', 'id' => 1],
        'student2@ewu.edu.bd' => ['password' => 'password123', 'role' => 'student',  'name' => 'Muhib',             'studentId' => '2022-1-60-002', 'dept' => 'CSE', 'id' => 2],
    ];

    if (isset($defaults[$emailLower]) && $defaults[$emailLower]['password'] === $password) {
        $d = $defaults[$emailLower];
        if ($d['role'] !== $role) {
            http_response_code(403);
            echo json_encode(["status" => "error", "message" => "Role mismatch. Access denied."]);
            exit;
        }
        $node_id = null;
        if ($d['role'] === 'operator') {
            $node_id = ($emailLower === 'maloy@ewu.edu.bd') ? 'PRN001' : 'PRN002';
        }

        echo json_encode([
            "status" => "success",
            "message" => "Login successful",
            "user" => [
                "id"        => $d['id'],
                "username"  => explode('@', $email)[0],
                "email"     => $email,
                "role"      => $d['role'],
                "name"      => $d['name'],
                "studentId" => $d['studentId'] ?? null,
                "shop"      => $d['shop'] ?? null,
                "dept"      => $d['dept'] ?? null,
                "avatar"    => null,
                "node_id"   => $node_id
            ]
        ]);
        exit;
    }

    http_response_code(401);
    echo json_encode(["status" => "error", "message" => "Invalid email or password."]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database login failure: " . $e->getMessage()]);
}
?>
