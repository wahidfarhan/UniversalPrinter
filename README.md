# Universal Cloud Print System (UCPS)

A secure, lightweight, and stateless cloud printing application designed for university campuses (e.g., East West University) and local print shops. UCPS bridges the gap between students and physical print shops by allowing students to pair with printers via QR codes, manage a personal cloud document drive, simulate instant mobile checkouts (bKash & Cash), and queue jobs directly to native desktop spooler clients.

---

## 🚀 Key Features

*   **Dual Portal Workflows**:
    *   **Registered Student Mode**: Manage documents, track print history, preview files, and maintain a secure personal Cloud Drive.
    *   **Guest Student Mode**: Quick pairing and print-and-go workflow without requiring account registration.
*   **Instant QR Pairing & Connection**:
    *   Dynamic QR-code scanning auto-connects the active browser session to the nearest printer node.
    *   Supports automatic routing to guest mode if the student is not logged in.
*   **Integrated Billing Simulation**:
    *   **bKash Mobile Wallet**: Tokenized checkout simulation (OTP & PIN challenge flow).
    *   **Manual Cash Approval**: Real-time queue lock released upon operator cash verification.
*   **Security & Access Control (Remediated)**:
    *   Protected file views (IDOR checks) ensuring students can only view/fetch their own drive files.
    *   Stateless role checking restricting payment settling and job cancellation to authorized operators.
    *   Dynamic CORS checks in `cors.php` restricting cross-origin operations to local hosts and server domains.
*   **Spooler Client Daemon**:
    *   Runs locally on the print shop computer (Python GUI/CLI client).
    *   Automatically pings the server queue and prints PDF/Image buffers utilizing native print commands (`SumatraPDF` on Windows, `lp` on Linux/UNIX).

---

## 🛠 Tech Stack

*   **Frontend**: HTML5, Vanilla CSS3 (Custom Glassmorphism Design System), JavaScript (ES6, PDF.js integration).
*   **Backend**: Stateless PHP API Layer.
*   **Database**: SQLite (`ucps_db.sqlite`) with runtime self-healing and auto-seeding.
*   **Spooler Client**: Python 3.x (built with PyInstaller & PyQt5).

---

## 📦 Project Structure

```text
├── index.html                  # Main Web Portal Interface
├── style.css                   # Core Stylesheet & Animations
├── app.js                      # Frontend Controller & State Handler
├── db.php                      # SQLite PDO Connection & Migration Runner
├── login.php                   # Unified User Authentication
├── upload.php                  # Secure Spooler File Upload Endpoint
├── upload_to_drive.php         # Cloud Document Drive Upload Endpoint
├── view_file.php               # Secure Inline Document Viewer
├── view_file_base64.php        # Secure Document Base64 Encoder
├── delete_job.php              # Authorized Queue Job Deletion
├── process_payment.php         # Operator Cash Payment Clearance
├── update_status.php           # Spooler Node Printing Completed/Failed callback
├── print_node_gui.py           # PyQt5 Desktop Spooler Daemon Client
└── cpanel_fresh_release.zip    # Compact deployment archive for cPanel
```

---

## 🚀 Installation & Setup

### 1. Web Portal Server Setup (Development)
Ensure you have PHP 8.x installed. Run the built-in development web server inside the directory:
```bash
php -S 127.0.0.1:8000
```
Open `http://127.0.0.1:8000` in your web browser. The SQLite database (`ucps_db.sqlite`) will automatically initialize and seed default test user accounts:
*   **Student 1**: `student1@ewu.edu.bd` (Password: `password123`)
*   **Student 2**: `student2@ewu.edu.bd` (Password: `password123`)
*   **Operator**: `operator@ewu.edu.bd` (Password: `password123`)

### 2. Spooler Daemon Setup
Ensure you have Python 3.x installed. Install dependencies:
```bash
pip install urllib3 requests PyQt5
```
Run the GUI spooler client:
```bash
python print_node_gui.py
```
Log in using operator credentials and input the target API endpoint URL (e.g., `http://localhost/UniversalPrinter/` or `https://yourdomain.com/`).

---

## 🔒 Production Deployment (cPanel / Apache)
1.  Upload the contents of `cpanel_fresh_release.zip` to the server directory (e.g., `/public_html/`).
2.  Set the directory permission of the `/uploads/` folder to `755` so the server can save spooled documents.
3.  Ensure the SQLite database file `ucps_db.sqlite` has read/write permissions for the webserver process.
