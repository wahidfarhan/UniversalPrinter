# ==========================================================================
# UCPS CLIENT PRINT NODE - GUI DAEMON v3.2 (PyQt5 Modern Version)
# Universal Cloud Print System
# Powered by PyQt5 with Dark Mode, Auto-Login, & Auto-Daemon triggers.
# ==========================================================================
import os
import sys
import time
import json
import ssl
import shutil
import platform
import threading
import subprocess
import urllib.request
import urllib.parse
import webbrowser
import requests
from datetime import datetime

try:
    import pypdf
except ImportError:
    pypdf = None

from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QGridLayout, QLabel, QLineEdit, QPushButton, QTextEdit,
    QCheckBox, QFrame, QListWidget, QListWidgetItem, QMessageBox, QSpacerItem, QSizePolicy
)
from PyQt5.QtCore import Qt, QTimer, QThread, pyqtSignal, QSize
from PyQt5.QtGui import QFont, QColor, QIcon, QTextCursor, QPalette

# Global SSL Bypass for Local and Self-Signed Hosts
try:
    ssl._create_default_https_context = ssl._create_unverified_context
except AttributeError:
    pass

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "config.json")

# Theme Palette Styling
BG_DARK      = "#0d1117"
BG_CARD      = "#161b22"
BG_INPUT     = "#21262d"
BORDER_COLOR = "#30363d"
ACCENT_BLUE  = "#3b82f6"
ACCENT_HOVER = "#2563eb"
SUCCESS_GREEN = "#22c55e"
DANGER_RED   = "#dc2626"
WARNING_ORANGE = "#f59e0b"
TEXT_MAIN    = "#c9d1d9"
TEXT_MUTED   = "#8b949e"

class LoginThread(QThread):
    """Background login thread to ensure thread-safe login operations without GUI lockups."""
    login_done = pyqtSignal(dict)
    login_error = pyqtSignal(str)

    def __init__(self, http_session, url, email, password):
        super().__init__()
        self.http_session = http_session
        self.url = url
        self.email = email
        self.password = password

    def run(self):
        try:
            login_url = f"{self.url.rstrip('/')}/login_operator.php"
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            # verify=False prevents SSL handshake failure on self-signed certificate environments
            response = self.http_session.post(login_url, data={
                "email": self.email,
                "password": self.password
            }, headers={"User-Agent": "UCPS-PrintNode/3.0"}, timeout=10, verify=False)
            
            res = response.json()
            self.login_done.emit(res)
        except Exception as e:
            self.login_error.emit(str(e))


class PollThread(QThread):
    """Background high-frequency polling thread that queries get_jobs.php for atomic job acquisition."""
    job_found = pyqtSignal(dict)
    poll_warning = pyqtSignal(str)
    poll_error = pyqtSignal(str)
    status_changed = pyqtSignal(str, str) # Emits (status_text, color)

    def __init__(self, api_url, node_id, poll_secs):
        super().__init__()
        self.api_url = api_url
        self.node_id = node_id
        # Default to 2 seconds if not specified or too long for high responsiveness
        self.poll_secs = max(1.0, float(poll_secs)) if poll_secs else 2.0
        self.running = True

    def run(self):
        self.status_changed.emit("Active (Poll)", "#22c55e") # Green for active polling mode
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        
        while self.running:
            url = f"{self.api_url.rstrip('/')}/get_jobs.php?node_id={self.node_id}"
            try:
                # Use requests to perform a fast, non-persistent atomic poll
                response = requests.get(
                    url, 
                    headers={
                        "User-Agent": "UCPS-PrintNode/3.0",
                        "Cache-Control": "no-cache",
                        "Accept": "application/json"
                    }, 
                    timeout=5, 
                    verify=False
                )
                
                if response.status_code == 200:
                    res = response.json()
                    if res.get("status") == "found" and "job" in res:
                        self.job_found.emit(res["job"])
                elif response.status_code == 508:
                    self.poll_warning.emit("Server resource limit reached (508). Throttling.")
                else:
                    self.poll_error.emit(f"Server error: HTTP {response.status_code}")
            except Exception as e:
                # Silently handle transient connection drops but emit warning for persistent ones
                self.poll_error.emit(f"Poll fail: {str(e)[:50]}")
            
            # Sleep in 100ms intervals to allow fast thread termination when stopping
            for _ in range(int(self.poll_secs * 10)):
                if not self.running:
                    break
                time.sleep(0.1)

    def stop(self):
        self.running = False
        self.wait()


class UCPSMainWindow(QMainWindow):
    # PyQt Signals for thread-safe cross-thread UI communication
    stats_updated = pyqtSignal(int, float)      # (total_jobs, total_revenue)
    log_requested = pyqtSignal(str, str, str)    # (tag, message, color_hex)
    stats_refresh_requested = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.setWindowTitle("UCPS")
        self.resize(850, 620)
        self.setStyleSheet(f"background-color: {BG_DARK}; color: {TEXT_MAIN};")

        # Load window icon if present in workspace directory
        if os.path.exists("icon.png"):
            self.setWindowIcon(QIcon("icon.png"))

        # Connect signals to slots safely (automatically marshals to main thread)
        self.stats_updated.connect(self.update_stats_labels)
        self.log_requested.connect(self._write_log)
        self.stats_refresh_requested.connect(self.fetch_todays_stats)

        # Runtime States
        self.running = False
        self.operator = None
        self.poll_thread = None
        self.login_worker = None
        self.printer_states = {} # Tracks printer_name -> checked state (bool)
        self.http_session = requests.Session()
        
        # Default config settings
        self.config = {
            "api_url": "http://localhost/UniversalPrinter",
            "node_id": "PRN001",
            "poll_secs": 3,
            "email": "",
            "password": "",
            "remember_me": False
        }
        self.load_config()

        # Build Stacked Main Layouts
        self.central_widget = QWidget()
        self.setCentralWidget(self.central_widget)
        self.main_layout = QVBoxLayout(self.central_widget)
        self.main_layout.setContentsMargins(20, 20, 20, 20)

        # Build Connection Status Bar
        self.status_bar = self.statusBar()
        self.status_bar.setStyleSheet(f"background-color: {BG_CARD}; border-top: 1px solid {BORDER_COLOR}; color: {TEXT_MUTED}; font-size: 11px; padding: 4px;")
        
        self.status_indicator = QLabel(" ● Connection Status: Stopped")
        self.status_indicator.setStyleSheet(f"color: {DANGER_RED}; font-weight: bold; margin-left: 8px;")
        self.status_bar.addWidget(self.status_indicator)

        # Initialize UI Screens
        self.build_login_screen()

        # Check for auto-login on startup
        if self.config.get("remember_me") and self.config.get("email") and self.config.get("password"):
            QTimer.singleShot(100, self.auto_login)

    # ── Config Handlers ──────────────────────────────────────────────────────
    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    loaded = json.load(f)
                    self.config.update(loaded)
            except Exception:
                pass

    def save_config(self):
        try:
            with open(CONFIG_FILE, "w") as f:
                json.dump(self.config, f, indent=4)
        except Exception:
            pass

    # ── Logging System ────────────────────────────────────────────────────────
    def _log(self, tag, message, color_hex=TEXT_MUTED):
        # Thread safety guard: if called from background thread, delegate to main GUI thread via signal
        if QThread.currentThread() == QApplication.instance().thread():
            self._write_log(tag, message, color_hex)
        else:
            self.log_requested.emit(tag, message, color_hex)

    def _write_log(self, tag, message, color_hex):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_line = f'<span style="color: {TEXT_MUTED}">[{timestamp}]</span> <b style="color: {color_hex}">{tag:<8}</b> {message}'
        if hasattr(self, 'log_box'):
            self.log_box.append(log_line)
            self.log_box.moveCursor(QTextCursor.End)

    def _server_log(self, message, log_type="info"):
        """Send a fire-and-forget log message to add_log.php on the server."""
        if not self.config.get("api_url"):
            return
        def _send():
            try:
                url  = f"{self.config['api_url'].rstrip('/')}/add_log.php"
                shop_name = self.operator.get("shop", "Shop") if self.operator else "Dokan"
                response = self.http_session.post(url, data={
                    "node_id":  self.config["node_id"],
                    "message":  f"SPOOLER: [{shop_name}] {message}",
                    "log_type": log_type
                }, headers={"User-Agent": "UCPS-PrintNode/3.0"}, timeout=5, verify=False)
            except Exception:
                pass
        threading.Thread(target=_send, daemon=True).start()

    # ── Build Screen Widgets ─────────────────────────────────────────────────
    def clear_layout(self):
        while self.main_layout.count():
            item = self.main_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

    def build_login_screen(self):
        self.clear_layout()
        self.running = False

        # Login Card Container
        card = QFrame()
        card.setStyleSheet(f"background-color: {BG_CARD}; border: 1px solid {BORDER_COLOR}; border-radius: 8px;")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(30, 40, 30, 40)
        card_layout.setSpacing(15)

        # Title / Branding
        logo_layout = QHBoxLayout()
        logo_icon = QLabel("☁")
        logo_icon.setStyleSheet(f"font-size: 32px; color: {ACCENT_BLUE}; border: none;")
        logo_text = QLabel("UCPS PrintNode Controller")
        logo_text.setStyleSheet(f"font-size: 20px; font-weight: bold; color: {TEXT_MAIN}; border: none;")
        logo_layout.addWidget(logo_icon)
        logo_layout.addWidget(logo_text)
        logo_layout.addStretch()
        card_layout.addLayout(logo_layout)

        divider = QFrame()
        divider.setFrameShape(QFrame.HLine)
        divider.setStyleSheet(f"color: {BORDER_COLOR}; border: none; background-color: {BORDER_COLOR}; height: 1px;")
        card_layout.addWidget(divider)

        # Input Fields Grid
        grid = QGridLayout()
        grid.setSpacing(10)

        grid.addWidget(QLabel("Server API URL:"), 0, 0)
        self.api_input = QLineEdit(self.config["api_url"])
        self.api_input.setStyleSheet(f"background-color: {BG_INPUT}; border: 1px solid {BORDER_COLOR}; border-radius: 4px; padding: 6px; color: {TEXT_MAIN};")
        grid.addWidget(self.api_input, 0, 1)

        grid.addWidget(QLabel("Operator Email:"), 1, 0)
        self.email_input = QLineEdit(self.config["email"])
        self.email_input.setStyleSheet(f"background-color: {BG_INPUT}; border: 1px solid {BORDER_COLOR}; border-radius: 4px; padding: 6px; color: {TEXT_MAIN};")
        grid.addWidget(self.email_input, 1, 1)

        grid.addWidget(QLabel("Password:"), 2, 0)
        self.pass_input = QLineEdit(self.config["password"])
        self.pass_input.setEchoMode(QLineEdit.Password)
        self.pass_input.setStyleSheet(f"background-color: {BG_INPUT}; border: 1px solid {BORDER_COLOR}; border-radius: 4px; padding: 6px; color: {TEXT_MAIN};")
        grid.addWidget(self.pass_input, 2, 1)

        card_layout.addLayout(grid)

        # Remember Me Option
        self.remember_cb = QCheckBox("Remember Me & Auto-Login on Boot")
        self.remember_cb.setChecked(self.config.get("remember_me", False))
        self.remember_cb.setStyleSheet("border: none; padding-left: 2px;")
        card_layout.addWidget(self.remember_cb)

        # Actions
        btn_layout = QHBoxLayout()
        self.login_btn = QPushButton("🔓 LOG IN OPERATOR")
        self.login_btn.setCursor(Qt.PointingHandCursor)
        self.login_btn.setStyleSheet(f"background-color: {ACCENT_BLUE}; color: white; font-weight: bold; border-radius: 4px; padding: 10px; border: none;")
        self.login_btn.clicked.connect(self.handle_login)
        btn_layout.addWidget(self.login_btn)
        card_layout.addLayout(btn_layout)

        # Center card in screen
        self.main_layout.addStretch(1)
        self.main_layout.addWidget(card, 0, Qt.AlignCenter)
        self.main_layout.addStretch(1)

    def build_dashboard_screen(self):
        self.clear_layout()

        # Top Bar Panel
        top_bar = QFrame()
        top_bar.setStyleSheet(f"background-color: {BG_CARD}; border: 1px solid {BORDER_COLOR}; border-radius: 6px;")
        top_layout = QHBoxLayout(top_bar)
        top_layout.setContentsMargins(15, 10, 15, 10)

        info_lbl = QLabel(f"<b>Operator:</b> {self.operator.get('name','Farhan')}  │  <b>Shop:</b> {self.operator.get('shop','Dokan')}  │  <b>Node:</b> {self.config['node_id']}")
        info_lbl.setStyleSheet("border: none;")
        top_layout.addWidget(info_lbl)
        
        top_layout.addStretch()

        self.status_lbl = QLabel("● Stopped")
        self.status_lbl.setStyleSheet(f"color: {DANGER_RED}; font-weight: bold; border: none;")
        top_layout.addWidget(self.status_lbl)

        self.logout_btn = QPushButton("Logout ➔")
        self.logout_btn.setCursor(Qt.PointingHandCursor)
        self.logout_btn.setStyleSheet(f"background: transparent; color: {DANGER_RED}; border: none; font-weight: bold;")
        self.logout_btn.clicked.connect(self.handle_logout)
        top_layout.addWidget(self.logout_btn)

        self.main_layout.addWidget(top_bar)

        # Stats Bar Panel
        self.stats_bar = QFrame()
        self.stats_bar.setStyleSheet(f"background-color: {BG_CARD}; border: 1px solid {BORDER_COLOR}; border-radius: 6px;")
        stats_layout = QHBoxLayout(self.stats_bar)
        stats_layout.setContentsMargins(15, 10, 15, 10)
        
        self.today_prints_lbl = QLabel("<b>Today's Prints:</b> 0 jobs")
        self.today_prints_lbl.setStyleSheet("border: none; font-size: 13px; color: #3b82f6;")
        stats_layout.addWidget(self.today_prints_lbl)
        
        stats_layout.addSpacing(40)
        
        self.today_revenue_lbl = QLabel("<b>Today's Earnings:</b> 0.00 BDT")
        self.today_revenue_lbl.setStyleSheet("border: none; font-size: 13px; color: #22c55e;")
        stats_layout.addWidget(self.today_revenue_lbl)
        
        stats_layout.addStretch()
        
        # Add refresh button for stats
        self.refresh_stats_btn = QPushButton("↻ Refresh Stats")
        self.refresh_stats_btn.setCursor(Qt.PointingHandCursor)
        self.refresh_stats_btn.setStyleSheet(f"background-color: {BG_INPUT}; color: {TEXT_MAIN}; border: 1px solid {BORDER_COLOR}; border-radius: 4px; padding: 4px 10px; font-size: 11px;")
        self.refresh_stats_btn.clicked.connect(self.fetch_todays_stats)
        stats_layout.addWidget(self.refresh_stats_btn)
        
        self.main_layout.addWidget(self.stats_bar)

        # Spooler Controller Options Grid
        middle_layout = QHBoxLayout()
        middle_layout.setSpacing(15)

        # Left Column: Buttons & Settings
        left_panel = QFrame()
        left_panel.setStyleSheet(f"background-color: {BG_CARD}; border: 1px solid {BORDER_COLOR}; border-radius: 6px;")
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(15, 15, 15, 15)
        left_layout.setSpacing(12)

        left_layout.addWidget(QLabel("<b>DAEMON CONTROLLER</b>"))

        self.start_btn = QPushButton("▶   START DAEMON")
        self.start_btn.setCursor(Qt.PointingHandCursor)
        self.start_btn.setStyleSheet(f"background-color: {SUCCESS_GREEN}; color: white; font-weight: bold; padding: 12px; border-radius: 4px; border: none;")
        self.start_btn.clicked.connect(self.toggle_daemon)
        left_layout.addWidget(self.start_btn)

        # Open Web Portal Button (Includes auto start logic)
        self.web_btn = QPushButton("🌐 Open Web Portal")
        self.web_btn.setCursor(Qt.PointingHandCursor)
        self.web_btn.setStyleSheet(f"background-color: {ACCENT_BLUE}; color: white; font-weight: bold; padding: 10px; border-radius: 4px; border: none;")
        self.web_btn.clicked.connect(self.handle_open_portal)
        left_layout.addWidget(self.web_btn)

        left_layout.addWidget(QLabel("<b>LOCAL PRINTERS LIST</b>"))
        
        self.printer_list = QListWidget()
        self.printer_list.setStyleSheet(f"background-color: {BG_INPUT}; border: 1px solid {BORDER_COLOR}; border-radius: 4px; color: {TEXT_MAIN}; padding: 5px;")
        self.printer_list.itemChanged.connect(self.handle_printer_check_changed)
        left_layout.addWidget(self.printer_list)

        self.refresh_prn_btn = QPushButton("↻ Refresh Printers")
        self.refresh_prn_btn.setCursor(Qt.PointingHandCursor)
        self.refresh_prn_btn.setStyleSheet(f"background-color: {BG_INPUT}; color: {TEXT_MAIN}; border: 1px solid {BORDER_COLOR}; border-radius: 4px; padding: 8px;")
        self.refresh_prn_btn.clicked.connect(self.detect_and_sync_printers)
        left_layout.addWidget(self.refresh_prn_btn)

        middle_layout.addWidget(left_panel, 1)

        # Right Column: Console Log Panel
        right_panel = QFrame()
        right_panel.setStyleSheet(f"background-color: {BG_CARD}; border: 1px solid {BORDER_COLOR}; border-radius: 6px;")
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(15, 15, 15, 15)
        right_layout.setSpacing(10)

        right_layout.addWidget(QLabel("<b>SPOOLER TRANSACTION LOGS</b>"))

        self.log_box = QTextEdit()
        self.log_box.setReadOnly(True)
        self.log_box.setStyleSheet(f"background-color: {BG_DARK}; border: 1px solid {BORDER_COLOR}; border-radius: 4px; font-family: 'Consolas', monospace; font-size: 14px;")
        right_layout.addWidget(self.log_box)

        self.clear_log_btn = QPushButton("🗑 Clear Console")
        self.clear_log_btn.setCursor(Qt.PointingHandCursor)
        self.clear_log_btn.setStyleSheet(f"background-color: {BG_INPUT}; color: {TEXT_MUTED}; border: 1px solid {BORDER_COLOR}; border-radius: 4px; padding: 6px; max-width: 120px;")
        self.clear_log_btn.clicked.connect(self.log_box.clear)
        right_layout.addWidget(self.clear_log_btn)

        middle_layout.addWidget(right_panel, 2)

        self.main_layout.addLayout(middle_layout)

        # Initial Printer Detection
        self.detect_and_sync_printers()
        self._log("SYSTEM", "PrintNode Dashboard initialized. Ready.")

        # Start stats periodic updater
        self.stats_timer = QTimer(self)
        self.stats_timer.timeout.connect(self.fetch_todays_stats)
        self.stats_timer.start(30000) # Every 30 seconds
        self.fetch_todays_stats() # Initial fetch

    def fetch_todays_stats(self):
        """Fetches today's print job statistics from the server and updates UI labels. Thread-safe."""
        if not self.operator or not self.config.get("api_url"):
            return
        
        def _fetch():
            local_today = datetime.now().strftime('%Y-%m-%d')
            url = f"{self.config['api_url'].rstrip('/')}/get_stats.php?node_id={self.config['node_id']}&date={local_today}"
            try:
                response = self.http_session.get(
                    url,
                    headers={"User-Agent": "UCPS-PrintNode/3.0"},
                    timeout=8,
                    verify=False
                )
                res = response.json()
                if res.get("status") == "success":
                    total_jobs    = int(res.get("total_jobs", 0))
                    total_revenue = float(res.get("total_revenue", 0.0))
                    # Safely dispatch stats update to main GUI thread via signal
                    self.stats_updated.emit(total_jobs, total_revenue)
                else:
                    err_msg = res.get("message", "Unknown error from get_stats.php")
                    self.log_requested.emit("WARNING", f"Stats server error: {err_msg}", WARNING_ORANGE)
            except Exception as e:
                self.log_requested.emit("ERROR", f"Stats connection failed: {e}", DANGER_RED)
        
        threading.Thread(target=_fetch, daemon=True).start()

    def update_stats_labels(self, total_jobs, total_revenue):
        """Thread-safe slot running on main GUI thread to refresh stats labels."""
        self.today_prints_lbl.setText(f"<b>Today's Prints:</b> {total_jobs} jobs")
        self.today_revenue_lbl.setText(f"<b>Today's Earnings:</b> {total_revenue:.2f} BDT")

    # ── Authentication Mechanics ──────────────────────────────────────────────
    def handle_login(self):
        url = self.api_input.text().strip()
        email = self.email_input.text().strip()
        password = self.pass_input.text().strip()

        if not url or not email or not password:
            QMessageBox.critical(self, "Error", "All configuration fields are required!")
            return

        self.login_btn.setText("🔒 Authenticating...")
        self.login_btn.setEnabled(False)

        # Store password in memory for portal redirection
        self.current_password = password

        # Execute network login in background thread safely using QThread
        self.login_worker = LoginThread(self.http_session, url, email, password)
        
        def handle_done(res):
            if res.get("status") == "success":
                self.operator = res["operator"]
                # Dynamically capture the operator's server-assigned unique Node ID
                server_node_id = res["operator"].get("node_id", "PRN001")
                self.config.update({
                    "api_url": url,
                    "node_id": server_node_id,
                    "email": email,
                    "password": password if self.remember_cb.isChecked() else "",
                    "remember_me": self.remember_cb.isChecked()
                })
                self.save_config()
                self.login_success()
            else:
                self.login_failed(res.get("message", "Incorrect credentials."))
                
        self.login_worker.login_done.connect(handle_done)
        self.login_worker.login_error.connect(self.login_failed)
        self.login_worker.start()

    def auto_login(self):
        """Attempts to silently log in using saved credentials on boot."""
        if hasattr(self, 'login_btn'):
            self.login_btn.setText("🔒 Auto-logging in...")
            self.login_btn.setEnabled(False)
            self.handle_login()

    def login_success(self):
        self.build_dashboard_screen()

    def login_failed(self, error_msg):
        self.login_btn.setText("🔓 LOG IN OPERATOR")
        self.login_btn.setEnabled(True)
        QMessageBox.critical(self, "Login Failed", error_msg)

    def handle_logout(self):
        if self.running:
            if QMessageBox.question(self, "Logout", "Daemon is running. Stop and logout?", QMessageBox.Yes | QMessageBox.No) != QMessageBox.Yes:
                return
            self.stop_daemon()

        self.operator = None
        
        # Stop stats timer
        if hasattr(self, "stats_timer"):
            self.stats_timer.stop()

        # Remove credentials from auto-login config if remember_me is off
        if not self.config.get("remember_me"):
            self.config["password"] = ""
            self.save_config()
            
        self.build_login_screen()

    # ── Daemon Polling Loop ────────────────────────────────────────────────────
    def toggle_daemon(self):
        if self.running:
            self.stop_daemon()
        else:
            self.start_daemon()

    def start_daemon(self):
        self.running = True
        self.status_lbl.setText("● Running")
        self.status_lbl.setStyleSheet(f"color: {SUCCESS_GREEN}; font-weight: bold; border: none;")
        self.start_btn.setText("■   STOP DAEMON")
        self.start_btn.setStyleSheet(f"background-color: {DANGER_RED}; color: white; font-weight: bold; padding: 12px; border-radius: 4px; border: none;")
        
        self._log("SYSTEM", "Daemon started — polling for jobs…")
        self._server_log(f"Daemon started. Node: {self.config['node_id']}", "success")
        
        # Trigger immediate printer sync to turn them Online
        self.detect_and_sync_printers()

        # Start Poll Thread
        self.poll_thread = PollThread(self.config["api_url"], self.config["node_id"], self.config["poll_secs"])
        self.poll_thread.job_found.connect(self.handle_job_received)
        self.poll_thread.poll_warning.connect(lambda msg: self._log("WARNING", msg, WARNING_ORANGE))
        self.poll_thread.poll_error.connect(lambda msg: self._log("ERROR", msg, DANGER_RED))
        self.poll_thread.status_changed.connect(self.update_connection_status)
        self.poll_thread.start()

    def stop_daemon(self):
        self.running = False
        self.status_lbl.setText("● Stopped")
        self.status_lbl.setStyleSheet(f"color: {DANGER_RED}; font-weight: bold; border: none;")
        self.start_btn.setText("▶   START DAEMON")
        self.start_btn.setStyleSheet(f"background-color: {SUCCESS_GREEN}; color: white; font-weight: bold; padding: 12px; border-radius: 4px; border: none;")
        
        self._log("SYSTEM", "Daemon stopped.")
        self._server_log(f"Daemon stopped. Node: {self.config['node_id']}", "warning")

        if self.poll_thread:
            self.poll_thread.stop()
            self.poll_thread = None

        # Reset status bar to offline
        self.update_connection_status("Stopped", DANGER_RED)

        # Instantly set printers Offline
        self.send_offline_notice()

    def update_connection_status(self, text, color_hex):
        self.status_indicator.setText(f" ● Connection Status: {text}")
        self.status_indicator.setStyleSheet(f"color: {color_hex}; font-weight: bold; margin-left: 8px;")
        self.status_bar.showMessage(f"Spooler network state transitioned to {text.upper()}.", 3000)

    def handle_printer_check_changed(self, item):
        prn_name = item.text().replace("🖨  ", "").strip()
        is_checked = (item.checkState() == Qt.Checked)
        self.printer_states[prn_name] = is_checked
        
        status_str = "Enabled (Online)" if is_checked else "Disabled (Offline)"
        self._log("SYSTEM", f"Printer '{prn_name}' manual state: {status_str}")
        
        # Trigger immediate sync with the server sending only checked printers
        self.sync_active_printers()

    def sync_active_printers(self):
        # Gather all checked printer names
        active_printers = []
        for i in range(self.printer_list.count()):
            item = self.printer_list.item(i)
            # Skip non-checkable helper items
            if item.flags() & Qt.ItemIsUserCheckable:
                if item.checkState() == Qt.Checked:
                    prn_name = item.text().replace("🖨  ", "").strip()
                    active_printers.append(prn_name)
        
        # Post to server in background thread
        threading.Thread(target=self.sync_printers_to_server, args=(active_printers,), daemon=True).start()

    # ── Printer Scanning & Sync ──────────────────────────────────────────────
    def detect_and_sync_printers(self):
        self.printer_list.clear()
        self._log("INFO", "Scanning local system printers...")

        printers = []
        try:
            if platform.system() == "Windows":
                # Method A: Win32 EnumPrinters API
                try:
                    import win32print
                    enum_flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
                    for prn_info in win32print.EnumPrinters(enum_flags, None, 1):
                        if prn_info[2] not in printers:
                            printers.append(prn_info[2])
                except Exception as ex:
                    self._log("INFO", f"win32print enumeration failed: {ex}. Using PowerShell fallback.")

                # Method B: PowerShell fallback (extremely reliable)
                if not printers:
                    proc = subprocess.Popen(
                        ["powershell", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                        creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0
                    )
                    out, _ = proc.communicate()
                    for line in out.splitlines():
                        name = line.strip()
                        if name and name not in printers:
                            printers.append(name)
            else:
                # Linux CUPS command line tool fallback
                proc = subprocess.Popen(["lpstat", "-a"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                out, _ = proc.communicate()
                for line in out.decode("utf-8").splitlines():
                    if line.strip():
                        printers.append(line.split()[0])
        except Exception as e:
            self._log("WARNING", f"Printer scan issue: {e}. Simulating defaults.")
            printers = ["Microsoft Print to PDF", "Nitro PDF Creator", "OneNote (Desktop)"]

        # Populate checkable items
        self.printer_list.blockSignals(True)
        if printers:
            for prn in printers:
                item = QListWidgetItem(f"🖨  {prn}")
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                # Keep state if previously set
                if prn not in self.printer_states:
                    self.printer_states[prn] = True
                item.setCheckState(Qt.Checked if self.printer_states[prn] else Qt.Unchecked)
                self.printer_list.addItem(item)
        else:
            self.printer_list.addItem("  (no printers found)")
            self._log("WARNING", "No printers detected on system.")
        self.printer_list.blockSignals(False)

        # Sync active/checked printers to server
        self.sync_active_printers()

    def sync_printers_to_server(self, printers):
        url = f"{self.config['api_url'].rstrip('/')}/sync_printers.php"
        try:
            res = self.http_session.post(url, data={
                "node_id": self.config["node_id"],
                "printers": json.dumps(printers)
            }, headers={"User-Agent": "UCPS-PrintNode/3.0"}, timeout=10, verify=False).json()
            self._log("SUCCESS", f"Server sync: {res.get('message', 'Printers synced.')}", SUCCESS_GREEN)
        except Exception as e:
            self._log("ERROR", f"Printer synchronization failed: {e}", DANGER_RED)

    def send_offline_notice(self):
        """Immediately update all node printers to Offline on server."""
        url = f"{self.config['api_url'].rstrip('/')}/sync_printers.php"
        try:
            self.http_session.post(url, data={
                "node_id": self.config["node_id"],
                "action": "offline"
            }, headers={"User-Agent": "UCPS-PrintNode/3.0"}, timeout=5, verify=False)
        except Exception:
            pass

    # ── Job Processor & Spooler Execution ──────────────────────────────────────
    def handle_job_received(self, job):
        self._log("JOB", f"Job received: {job['job_uuid']} ➔ Printer: {job.get('printer_name','Unknown')}", ACCENT_BLUE)
        self._server_log(f"Job received: {job['job_uuid']} ➔ {job.get('printer_name','Unknown')}", "info")
        
        # Download and print file in background thread
        threading.Thread(target=self.execute_print_job, args=(job,), daemon=True).start()

    def execute_print_job(self, job):
        """Download file from server and send to local printer spooler. Crash-safe."""
        try:
            self._execute_print_job_inner(job)
        except Exception as fatal:
            self._log("ERROR", f"CRITICAL: Unhandled crash in print job handler: {fatal}", DANGER_RED)
            self._server_log(f"CRITICAL crash in print job {job.get('job_uuid','?')}: {fatal}", "danger")
            try:
                self.post_job_status(job["job_id"], "Failed", job.get("printer_id"))
            except Exception:
                pass

    def _execute_print_job_inner(self, job):
        file_url = f"{self.config['api_url'].rstrip('/')}/uploads/{job['filename']}"
        temp_dir = os.path.join(os.path.expanduser("~"), "ucps_temp_buffer")
        os.makedirs(temp_dir, exist_ok=True)
        local_path = os.path.join(temp_dir, job["filename"])

        self._log("INFO", f"Downloading... {job['filename']}")
        try:
            # Chunked streaming download — avoids loading entire file into RAM
            # This prevents app crash on large PDF files
            response = self.http_session.get(
                file_url,
                headers={"User-Agent": "UCPS-PrintNode/3.0"},
                timeout=60,
                verify=False,
                stream=True   # ← stream=True means data arrives in chunks, not all at once
            )
            response.raise_for_status()
            
            downloaded_bytes = 0
            with open(local_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=1048576):  # 1MB chunks — fast throughput
                    if chunk:
                        f.write(chunk)
                        downloaded_bytes += len(chunk)
            
            self._log("SUCCESS", f"Download Success: {job['filename']}", SUCCESS_GREEN)

        except Exception as e:
            self._log("ERROR", f"Download failed: {e}", DANGER_RED)
            self._server_log(f"Download FAILED: {job['filename']} — {e}", "danger")
            self.post_job_status(job["job_id"], "Failed", job.get("printer_id"))
            return

        # Check if the file is an HTML page (error response) or a corrupted file
        try:
            with open(local_path, "rb") as test_f:
                header_bytes = test_f.read(100)
                if b"<html" in header_bytes.lower() or b"<!doctype" in header_bytes.lower():
                    self._log("ERROR", "Downloaded file is an HTML error page, not a valid document!", DANGER_RED)
                    self.post_job_status(job["job_id"], "Failed", job.get("printer_id"))
                    if os.path.exists(local_path): os.remove(local_path)
                    return
        except Exception:
            pass

        # Convert image format to PDF silently using PIL (Pillow) to avoid SumatraPDF blank prints
        file_ext = os.path.splitext(local_path)[1].lower()
        if file_ext in [".png", ".jpg", ".jpeg"]:
            self._log("INFO", f"Converting image {job['filename']} to temporary PDF...")
            try:
                from PIL import Image
                img = Image.open(local_path)
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                pdf_path = os.path.splitext(local_path)[0] + ".pdf"
                img.save(pdf_path, "PDF")
                img.close()
                if os.path.exists(local_path): os.remove(local_path)
                local_path = pdf_path
                job["format"] = "PDF"
            except Exception as ex:
                self._log("ERROR", f"Image to PDF conversion failed: {ex}", DANGER_RED)
                self._server_log(f"Print FAILED: Image conversion error for {job['filename']}", "danger")
                self.post_job_status(job["job_id"], "Failed", job.get("printer_id"))
                if os.path.exists(local_path): os.remove(local_path)
                return
        # Recalculate file extension in case it was converted from image
        file_ext = os.path.splitext(local_path)[1].lower()
        page_range = job.get("page_range", "all")
        
        # Split PDF pages locally using pypdf if a subset is selected
        if file_ext == ".pdf" and page_range and page_range.lower() != "all":
            self._log("INFO", f"Extracting page range '{page_range}' using pypdf...")
            if not pypdf:
                self._log("WARNING", "pypdf library not bundled or available, falling back to SumatraPDF settings...")
            else:
                try:
                    reader = pypdf.PdfReader(local_path)
                    total_pages = len(reader.pages)
                    
                    # Parse page numbers (1-indexed)
                    target_pages = []
                    for part in page_range.split(','):
                        part = part.strip()
                        if '-' in part:
                            try:
                                start, end = map(int, part.split('-'))
                                if start <= end:
                                    target_pages.extend(range(start, end + 1))
                                else:
                                    target_pages.extend(range(end, start + 1))
                            except Exception:
                                pass
                        else:
                            try:
                                target_pages.append(int(part))
                            except Exception:
                                pass
                    
                    # Filter to valid pages only
                    valid_pages = [p for p in target_pages if 1 <= p <= total_pages]
                    
                    if valid_pages and len(valid_pages) < total_pages:
                        writer = pypdf.PdfWriter()
                        for p in valid_pages:
                            writer.add_page(reader.pages[p - 1]) # pypdf is 0-indexed
                        
                        split_pdf_path = os.path.splitext(local_path)[0] + "_split.pdf"
                        with open(split_pdf_path, "wb") as out_f:
                            writer.write(out_f)
                        
                        # Clean up original temp file and use the split version
                        if os.path.exists(local_path):
                            os.remove(local_path)
                        local_path = split_pdf_path
                        self._log("INFO", f"Extracted {len(valid_pages)} page(s) successfully.")
                except Exception as ex:
                    self._log("WARNING", f"pypdf extraction failed, falling back to spooler options: {ex}")
        self._log("INFO", f"Printing... {job['filename']}")
        self._server_log(f"Spooling: {job['filename']} ➔ {job.get('printer_name','default')}", "info")
        
        success = self.spool_document(
            local_path, 
            job["format"], 
            job.get("printer_name"),
            page_size=job.get("page_size", "A4"),
            page_range=job.get("page_range", "all"),
            copies=int(job.get("copies", 1)),
            print_color=job.get("print_color", "monochrome")
        )
        status  = "Completed" if success else "Failed"
        log_type = "success" if success else "danger"
        color = SUCCESS_GREEN if success else DANGER_RED
        log_msg = f"Print Success: {job['filename']}" if success else f"Print Failed: {job['filename']}"

        self._log("SUCCESS" if success else "ERROR", log_msg, color)
        self._server_log(f"Print {status}: {job['job_uuid']} on {job.get('printer_name','Unknown')}", log_type)
        self.post_job_status(job["job_id"], status, job.get("printer_id"))
        
        # Immediately request a stats refresh via the thread-safe signal
        self.stats_refresh_requested.emit()
        
        if os.path.exists(local_path):
            try:
                os.remove(local_path)
            except Exception:
                pass

    def spool_document(self, path, fmt, printer_name=None, page_size='A4', page_range='all', copies=1, print_color='monochrome'):
        if platform.system() == "Windows":
            app_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
            sumatra = shutil.which("SumatraPDF.exe") or next((p for p in [
                os.path.join(app_dir, "SumatraPDF.exe"),
                os.path.expandvars(r"%LOCALAPPDATA%\SumatraPDF\SumatraPDF.exe"),
                r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
            ] if os.path.exists(p)), None)
            
            if sumatra:
                # Build SumatraPDF print settings
                settings = ["compat", "fit"]
                
                # Copies setting
                if copies > 1:
                    settings.append(f"{copies}x")
                
                # Page range setting
                if page_range and page_range.lower() != "all":
                    clean_range = page_range.replace(" ", "")
                    settings.append(clean_range)
                
                # Color setting
                if print_color == "color":
                    settings.append("color")
                else:
                    settings.append("monochrome")
                
                settings_str = ",".join(settings)
                
                cmd = ([sumatra, "-print-to", printer_name, "-print-settings", settings_str, "-silent", path]
                       if printer_name else [sumatra, "-print-to-default", "-print-settings", settings_str, "-silent", path])
                self._log("SPOOLER", f"CMD: {' '.join(cmd)}")
                try:
                    # Async launch - returns instantly
                    subprocess.Popen(cmd)
                    return True
                except Exception as e:
                    self._log("ERROR", f"SumatraPDF spawn error: {e}", DANGER_RED)
                    return False
            self._log("ERROR", "❌ SumatraPDF.exe is missing! Physical printing is disabled.", DANGER_RED)
            self._log("WARNING", "👉 To fix, download SumatraPDF Portable and place 'SumatraPDF.exe' in this app folder.", WARNING_ORANGE)
            return True
        else:
            # Linux lp CLI
            options = ["-o fit-to-page"]
            if copies > 1:
                options.append(f"-n {copies}")
            if page_range and page_range.lower() != "all":
                options.append(f"-P {page_range}")
            # Color Mode on cups
            if print_color == "color":
                options.append("-o ColorModel=Color")
            else:
                options.append("-o ColorModel=Gray")
            
            cmd = (["lp", "-d", printer_name] + options + [path]
                   if printer_name else ["lp"] + options + [path])
            self._log("SPOOLER", f"CMD: {' '.join(cmd)}")
            try:
                subprocess.Popen(cmd)
                return True
            except Exception as e:
                self._log("ERROR", f"Linux lp spawn error: {e}", DANGER_RED)
                return False

    def post_job_status(self, job_id, status, printer_id):
        url = f"{self.config['api_url'].rstrip('/')}/update_status.php"
        try:
            res = self.http_session.post(url, data={
                "job_id": job_id,
                "status": status,
                "printer_id": printer_id
            }, headers={"User-Agent": "UCPS-PrintNode/3.0"}, timeout=10, verify=False).json()
            self._log("INFO", f"Status: {res.get('message','OK')}  │  {res.get('cleanup','')}")
            
            # Instantly refresh dashboard statistics upon successful print job completion
            if status == "Completed":
                self.fetch_todays_stats()
        except Exception as e:
            self._log("ERROR", f"Server status update failed: {e}", DANGER_RED)

    # ── Web Portal Access Trigger ─────────────────────────────────────────────
    def handle_open_portal(self):
        """Launches the operator's admin portal. Auto-starts daemon if stopped."""
        if not self.operator:
            return

        # Auto-start daemon if stopped
        if not self.running:
            self._log("SYSTEM", "Auto-starting Daemon to sync printer online status...")
            self.start_daemon()

        email = self.config.get("email", "")
        password = getattr(self, "current_password", "") or self.config.get("password", "")
        
        # Build one-click session validation URL (includes autologin, email, and password)
        portal_url = f"{self.config['api_url'].rstrip('/')}/index.html?autologin=true&email={urllib.parse.quote(email)}&password={urllib.parse.quote(password)}&role=operator"
        self._log("SYSTEM", f"Opening web portal as: {email}")
        webbrowser.open(portal_url)

    # ── Close Event Safeguard ─────────────────────────────────────────────────
    def closeEvent(self, event):
        if self.running:
            reply = QMessageBox.question(
                self, "Exit UCPS",
                "PrintNode Daemon is running. Stop daemon and exit application?",
                QMessageBox.Yes | QMessageBox.No, QMessageBox.No
            )
            if reply == QMessageBox.Yes:
                self.stop_daemon()
                event.accept()
            else:
                event.ignore()
        else:
            event.accept()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    # Configure clean, premium global font and size (increases readability of buttons and labels)
    app.setFont(QFont("Segoe UI", 12))
    
    # Configure beautiful premium dark palette styling globally
    app.setStyle("Fusion")
    
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(BG_DARK))
    palette.setColor(QPalette.WindowText, QColor(TEXT_MAIN))
    palette.setColor(QPalette.Base, QColor(BG_INPUT))
    palette.setColor(QPalette.AlternateBase, QColor(BG_CARD))
    palette.setColor(QPalette.ToolTipBase, QColor(TEXT_MAIN))
    palette.setColor(QPalette.ToolTipText, QColor(TEXT_MAIN))
    palette.setColor(QPalette.Text, QColor(TEXT_MAIN))
    palette.setColor(QPalette.Button, QColor(BG_CARD))
    palette.setColor(QPalette.ButtonText, QColor(TEXT_MAIN))
    palette.setColor(QPalette.BrightText, Qt.red)
    palette.setColor(QPalette.Link, QColor(ACCENT_BLUE))
    palette.setColor(QPalette.Highlight, QColor(ACCENT_BLUE))
    palette.setColor(QPalette.HighlightedText, Qt.white)
    app.setPalette(palette)

    window = UCPSMainWindow()
    window.show()
    sys.exit(app.exec_())
