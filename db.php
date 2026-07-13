<?php
// ==========================================================================
// UCPS DATABASE CONNECTION MODULE (PDO SQLITE SELF-CREATING)
// ==========================================================================

try {
    // Try to store DB one directory above web root for security (cPanel-safe).
    // Falls back to __DIR__ if parent is not writable (local dev / shared hosting without parent access).
    $parent_dir = dirname(__DIR__);
    if (is_writable($parent_dir)) {
        $db_file = $parent_dir . '/ucps_db.sqlite';
    } else {
        $db_file = __DIR__ . '/ucps_db.sqlite';
        // Protect DB file with .htaccess if it's inside web root
        $htaccess = __DIR__ . '/.htaccess';
        if (!file_exists($htaccess) || strpos(file_get_contents($htaccess), 'ucps_db') === false) {
            file_put_contents($htaccess, "\n<Files \"ucps_db.sqlite\">\n    Order Allow,Deny\n    Deny from all\n</Files>\n", FILE_APPEND);
        }
    }
    
    $pdo = new PDO("sqlite:" . $db_file);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    
    // Enable SQLite foreign keys, configure busy timeout, and set journal mode to WAL for high concurrency
    $pdo->exec("PRAGMA foreign_keys = ON;");
    $pdo->exec("PRAGMA busy_timeout = 15000;"); // 15 seconds timeout for database lock resolution
    $pdo->exec("PRAGMA journal_mode = WAL;");

    // Always ensure all tables exist (runs on every boot, safe due to IF NOT EXISTS)
    // 1. Users Table
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'student',
        full_name TEXT DEFAULT NULL,
        student_id TEXT DEFAULT NULL,
        shop_name TEXT DEFAULT NULL,
        dept TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )");

    // 2. Printers Table (Registered Network Nodes)
    $pdo->exec("CREATE TABLE IF NOT EXISTS printers (
        printer_id TEXT PRIMARY KEY,
        printer_name TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT DEFAULT 'Online',
        ink_level TEXT DEFAULT '100%',
        paper_status TEXT DEFAULT 'Ready',
        last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )");

    // 3. Print Jobs Table
    $pdo->exec("CREATE TABLE IF NOT EXISTS print_jobs (
        job_id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_uuid TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        printer_id TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        secure_filename TEXT NOT NULL,
        file_format TEXT NOT NULL,
        price_bdt REAL DEFAULT 0.00,
        payment_status TEXT DEFAULT 'Unpaid',
        status TEXT DEFAULT 'Pending',
        upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_time TIMESTAMP DEFAULT NULL,
        page_size TEXT DEFAULT 'A4',
        page_range TEXT DEFAULT 'all',
        copies INTEGER DEFAULT 1,
        print_color TEXT DEFAULT 'monochrome',
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (printer_id) REFERENCES printers(printer_id)
    )");

    // Self-healing database migrations for new print job settings
    $columns_to_add = [
        'page_size' => "TEXT DEFAULT 'A4'",
        'page_range' => "TEXT DEFAULT 'all'",
        'copies' => "INTEGER DEFAULT 1",
        'print_color' => "TEXT DEFAULT 'monochrome'"
    ];
    foreach ($columns_to_add as $col => $definition) {
        $check = $pdo->query("PRAGMA table_info(print_jobs)");
        $exists = false;
        while ($row = $check->fetch()) {
            if ($row['name'] === $col) {
                $exists = true;
                break;
            }
        }
        if (!$exists) {
            $pdo->exec("ALTER TABLE print_jobs ADD COLUMN {$col} {$definition}");
        }
    }

    // Add avatar column to users table if missing
    $check_users = $pdo->query("PRAGMA table_info(users)");
    $avatar_exists = false;
    while ($row = $check_users->fetch()) {
        if ($row['name'] === 'avatar') {
            $avatar_exists = true;
            break;
        }
    }
    if (!$avatar_exists) {
        $pdo->exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL");
    }

    // Add last_ping column to printers table if missing
    $check_printers = $pdo->query("PRAGMA table_info(printers)");
    $last_ping_exists = false;
    while ($row = $check_printers->fetch()) {
        if ($row['name'] === 'last_ping') {
            $last_ping_exists = true;
            break;
        }
    }
    if (!$last_ping_exists) {
        $pdo->exec("ALTER TABLE printers ADD COLUMN last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    }

    // 4. User Saved Documents Table
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_documents (
        doc_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        original_filename TEXT NOT NULL,
        secure_filename TEXT NOT NULL,
        file_format TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
    )");

    // 5. System Logs Table (Real-Time print spooler mirror log)
    $pdo->exec("CREATE TABLE IF NOT EXISTS system_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT,
        message TEXT,
        log_type TEXT DEFAULT 'info',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )");

    // Seed initial mock user data only if users table is empty
    $user_count = $pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();
    if ($user_count == 0) {
        $pass_hash = password_hash('password123', PASSWORD_BCRYPT);
        $pdo->exec("INSERT INTO users (username, email, password_hash, role, full_name, student_id, dept) VALUES 
            ('student1', 'student1@ewu.edu.bd', '{$pass_hash}', 'student', 'Wahidur Rahman', '2022-1-60-001', 'CSE'),
            ('student2', 'student2@ewu.edu.bd', '{$pass_hash}', 'student', 'Muhib', '2022-1-60-002', 'CSE')
        ");
        $pdo->exec("INSERT INTO users (username, email, password_hash, role, full_name, shop_name) VALUES 
            ('operator', 'operator@ewu.edu.bd', '{$pass_hash}', 'operator', 'Farhan', 'UCPS Lab 3 Spooler')
        ");
    }

    // Always ensure the guest user is registered in the database for Instant Guest Print
    $stmt_guest = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = ?");
    $stmt_guest->execute(['guest']);
    if ($stmt_guest->fetchColumn() == 0) {
        $guest_hash = password_hash('guest_no_password_hash', PASSWORD_BCRYPT);
        $pdo->exec("INSERT INTO users (username, email, password_hash, role, full_name) VALUES 
            ('guest', 'guest@ucps.cloud', '{$guest_hash}', 'student', 'Guest Student')
        ");
    }

    // Always ensure the default operator 'maloy@ewu.edu.bd' is registered with password 'password' for seamless GUI auto-login redirection
    $stmt_m = $pdo->prepare("SELECT COUNT(*) FROM users WHERE email = ?");
    $stmt_m->execute(['maloy@ewu.edu.bd']);
    if ($stmt_m->fetchColumn() == 0) {
        $maloy_hash = password_hash('password', PASSWORD_BCRYPT);
        $pdo->exec("INSERT INTO users (username, email, password_hash, role, full_name, shop_name) VALUES 
            ('maloy', 'maloy@ewu.edu.bd', '{$maloy_hash}', 'operator', 'Maloy Roy Orko', 'EWU Lab 3 Spooler')
        ");
    }

    // Seed initial printer nodes only if printers table is empty
    $printer_count = $pdo->query("SELECT COUNT(*) FROM printers")->fetchColumn();
    if ($printer_count == 0) {
        $pdo->exec("INSERT INTO printers (printer_id, printer_name, location, status, ink_level, paper_status) VALUES 
            ('PRN001', 'HP LaserJet Pro 400', 'Room 304 (Lab 3)', 'Online', '84%', 'Ready'),
            ('PRN002', 'Epson L3210 InkTank', 'Room 305 (Office)', 'Online', '92%', 'Ready')
        ");
    }

} catch (\PDOException $e) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database connection failure: " . $e->getMessage()]);
    exit;
}
?>
