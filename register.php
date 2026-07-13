<?php
require_once 'cors.php';
// ==========================================================================
// UCPS USER/OPERATOR REGISTRATION API
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$role = $_POST['role'] ?? 'student'; // 'student' or 'operator'
$name = trim($_POST['name'] ?? '');
$email = trim($_POST['email'] ?? '');
$password = $_POST['password'] ?? '';
$student_id = trim($_POST['student_id'] ?? '');
$dept = trim($_POST['dept'] ?? '');
$shop_name = trim($_POST['shop_name'] ?? '');

if (empty($name) || empty($email) || empty($password)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Name, email and password are required."]);
    exit;
}

// Generate username from email prefix
$username = explode('@', $email)[0];

// Hash password
$password_hash = password_hash($password, PASSWORD_BCRYPT);

try {
    // Check if email already exists
    $stmt_check = $pdo->prepare("SELECT COUNT(*) FROM users WHERE email = ?");
    $stmt_check->execute([$email]);
    if ($stmt_check->fetchColumn() > 0) {
        http_response_code(409);
        echo json_encode(["status" => "error", "message" => "An account with this email already exists."]);
        exit;
    }

    $stmt = $pdo->prepare("
        INSERT INTO users (username, email, password_hash, role, full_name, student_id, shop_name, dept)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $username,
        $email,
        $password_hash,
        $role,
        $name,
        $student_id ?: null,
        $shop_name ?: null,
        $dept ?: null
    ]);

    echo json_encode([
        "status" => "success",
        "message" => "Registration successful! You can now log in."
    ]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database registration failure: " . $e->getMessage()]);
}
?>
