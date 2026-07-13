<?php
require_once 'cors.php';
// ==========================================================================
// UCPS STUDENT PROFILE UPDATE API (AVATAR, NAME, PASSWORD)
// ==========================================================================
header('Content-Type: application/json');
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Method Not Allowed. Use POST."]);
    exit;
}

$user_id = $_POST['user_id'] ?? null;
$full_name = trim($_POST['full_name'] ?? '');
$password = trim($_POST['password'] ?? '');

if (!$user_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Missing user ID."]);
    exit;
}

try {
    // Check if user exists
    $stmt = $pdo->prepare("SELECT * FROM users WHERE user_id = ?");
    $stmt->execute([$user_id]);
    $user = $stmt->fetch();

    if (!$user) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "User not found."]);
        exit;
    }

    $avatar_filename = $user['avatar'];

    // Handle avatar upload if present
    if (isset($_FILES['avatar']) && $_FILES['avatar']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['avatar'];
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        
        $allowed_exts = ['png', 'jpg', 'jpeg'];
        if (!in_array($ext, $allowed_exts)) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Invalid file format. Only PNG, JPG, and JPEG are allowed."]);
            exit;
        }

        // Generate unique filename
        $avatar_filename = 'avatar_' . $user_id . '_' . uniqid() . '.' . $ext;
        $dest = __DIR__ . '/uploads/' . $avatar_filename;

        // Ensure uploads directory exists
        if (!file_exists(__DIR__ . '/uploads/')) {
            mkdir(__DIR__ . '/uploads/', 0777, true);
        }

        // Delete old avatar if it exists
        if ($user['avatar'] && file_exists(__DIR__ . '/uploads/' . $user['avatar'])) {
            @unlink(__DIR__ . '/uploads/' . $user['avatar']);
        }

        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Failed to save uploaded image."]);
            exit;
        }
    }

    // Prepare update query
    $fields = [];
    $params = [];

    if (!empty($full_name)) {
        $fields[] = "full_name = ?";
        $params[] = $full_name;
    }

    if (!empty($password)) {
        $fields[] = "password_hash = ?";
        $params[] = password_hash($password, PASSWORD_BCRYPT);
    }

    // Always update avatar (if new one is set/uploaded)
    $fields[] = "avatar = ?";
    $params[] = $avatar_filename;

    $params[] = $user_id;

    $stmt_update = $pdo->prepare("UPDATE users SET " . implode(", ", $fields) . " WHERE user_id = ?");
    $stmt_update->execute($params);

    echo json_encode([
        "status" => "success",
        "message" => "Profile updated successfully.",
        "user" => [
            "id" => $user_id,
            "name" => !empty($full_name) ? $full_name : $user['full_name'],
            "avatar" => $avatar_filename
        ]
    ]);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database failure: " . $e->getMessage()]);
}
?>
