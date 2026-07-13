-- ==========================================================================
-- UNIVERSAL CLOUD PRINT SYSTEM (UCPS) - DATABASE SCHEMA
-- Target Database Engine: MySQL 8.x / MariaDB
-- ==========================================================================

CREATE DATABASE IF NOT EXISTS ucps_db;
USE ucps_db;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Printers Table (Registered Network Nodes)
CREATE TABLE IF NOT EXISTS printers (
    printer_id VARCHAR(50) PRIMARY KEY,
    printer_name VARCHAR(100) NOT NULL,
    location VARCHAR(100) NOT NULL,
    status ENUM('Online', 'Busy', 'Offline') DEFAULT 'Online',
    ink_level VARCHAR(10) DEFAULT '100%',
    paper_status VARCHAR(20) DEFAULT 'Ready',
    last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Print Jobs Table (FIFO Queue Buffer with Integrated Billing)
CREATE TABLE IF NOT EXISTS print_jobs (
    job_id INT AUTO_INCREMENT PRIMARY KEY,
    job_uuid VARCHAR(50) NOT NULL UNIQUE, -- Serial code like UCPS-1001
    user_id INT NOT NULL,
    printer_id VARCHAR(50) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    secure_filename VARCHAR(255) NOT NULL,
    file_format VARCHAR(10) NOT NULL,
    price_bdt DECIMAL(6,2) DEFAULT 0.00,
    payment_status ENUM('Unpaid', 'bKash_Paid', 'Cash_Approved') DEFAULT 'Unpaid',
    status ENUM('Pending', 'Printing', 'Completed', 'Failed') DEFAULT 'Pending',
    upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_time TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (printer_id) REFERENCES printers(printer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert Mock Seed Data for Demonstration
INSERT INTO users (username, email, password_hash) VALUES 
('ewu_student_1', 'student1@ewu.edu.bd', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
('ewu_student_2', 'student2@ewu.edu.bd', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');

INSERT INTO printers (printer_id, printer_name, location, status, ink_level, paper_status) VALUES 
('PRN001', 'HP LaserJet Pro 400', 'Room 304 (Lab 3)', 'Online', '84%', 'Ready'),
('PRN002', 'Epson L3210 InkTank', 'Room 305 (Office)', 'Online', '92%', 'Ready');
