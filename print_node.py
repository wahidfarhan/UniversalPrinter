# ==========================================================================
# UCPS CLIENT PRINT NODE DAEMON (EXECUTION LAYER SERVICE)
# ==========================================================================
import os
import sys
import time
import shutil
import platform
import subprocess
import urllib.request
import urllib.parse
import json

# Node Configuration
API_BASE_URL = "http://localhost/UniversalPrinter"  # Modify to point to your web server host
PRINTER_ID = "PRN001"                               # This node's printer registration ID
POLL_INTERVAL = 3                                    # Check server database queue every 3 seconds

# Temporary buffer directory on local machine
TEMP_BUFFER_DIR = os.path.join(os.path.expanduser("~"), "ucps_temp_buffer")
if not os.path.exists(TEMP_BUFFER_DIR):
    os.makedirs(TEMP_BUFFER_DIR)

def detect_local_printers():
    os_name = platform.system()
    printers = []
    print("[AUTO DETECT] Scanning system for connected physical/virtual devices...")
    
    if os_name == "Windows":
        try:
            # Run PowerShell print lookup
            cmd = ["powershell", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"]
            out = subprocess.check_output(cmd).decode("utf-8")
            printers = [p.strip() for p in out.splitlines() if p.strip()]
        except Exception as e:
            print(f"[AUTO DETECT WARNING] Failed to retrieve printer list: {e}")
            
    elif os_name == "Linux" or os_name == "Darwin":
        try:
            cmd = ["lpstat", "-p"]
            out = subprocess.check_output(cmd).decode("utf-8")
            # lpstat -p output format: "printer printer_name is idle..."
            printers = [p.split()[1] for p in out.splitlines() if p.strip() and len(p.split()) > 1]
        except Exception as e:
            print(f"[AUTO DETECT WARNING] Failed to retrieve printer list: {e}")
            
    if printers:
        print("Detected Connected Spoolers:")
        for idx, prn in enumerate(printers, 1):
            print(f"  {idx}. {prn}")
    else:
        print("No connected spooler devices detected on this host computer.")
    print("-" * 60)
    return printers

def sync_printers_to_server(printers):
    url = f"{API_BASE_URL}/sync_printers.php"
    data = urllib.parse.urlencode({
        'node_id': PRINTER_ID,
        'printers': json.dumps(printers)
    }).encode('utf-8')
    try:
        req = urllib.request.Request(url, data=data, method='POST')
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            print(f"[SERVER] Sync Status: {res_data.get('message', 'Printers synced')}")
            return True
    except Exception as e:
        print(f"[ERROR] Failed to sync printers to server: {e}")
        return False

print("="*60)
print(" UNIVERSAL CLOUD PRINT SYSTEM (UCPS) - HOST PRINT NODE")
print("="*60)
print(f"Target Server : {API_BASE_URL}")
print(f"Printer Node ID: {PRINTER_ID}")
print(f"Operating System: {platform.system()}")
print(f"Temp Buffer    : {TEMP_BUFFER_DIR}")
print("Status         : ACTIVE & POLLING")
print("-" * 60)
local_printers = detect_local_printers()
sync_printers_to_server(local_printers)

def download_file(url, local_path):
    try:
        with urllib.request.urlopen(url, timeout=15) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return True
    except Exception as e:
        print(f"[ERROR] Failed to download file from print buffer: {e}")
        return False

def execute_spooler_print(file_path, file_format, printer_name=None):
    os_name = platform.system()
    target_desc = f"'{printer_name}'" if printer_name else "default printer"
    print(f"[SPOOLER] Preparing print execution for {file_format} file to {target_desc}...")
    
    if os_name == "Windows":
        # Check if SumatraPDF is on system path, otherwise use fallback demonstration log
        sumatra_path = shutil.which("SumatraPDF.exe")
        if sumatra_path:
            if printer_name:
                cmd = [sumatra_path, "-print-to", printer_name, "-silent", file_path]
            else:
                cmd = [sumatra_path, "-print-to-default", "-silent", file_path]
            print(f"[SPOOLER] Windows command: {' '.join(cmd)}")
            try:
                subprocess.run(cmd, check=True)
                print(f"[SPOOLER] Printed successfully via SumatraPDF to {target_desc}.")
                return True
            except Exception as e:
                print(f"[ERROR] Spooler command failed: {e}")
                return False
        else:
            print("[SIMULATION WARNING] SumatraPDF.exe not found on PATH.")
            print(f"[SPOOLER SIMULATION] Executing Windows Spooler mock call: SumatraPDF.exe " + 
                  (f"-print-to \"{printer_name}\"" if printer_name else "-print-to-default") + f" -silent \"{file_path}\"")
            time.sleep(3) # Simulate mechanical printing delay
            return True
            
    elif os_name == "Linux" or os_name == "Darwin": # Darwin is macOS
        lp_path = shutil.which("lp")
        if lp_path:
            if printer_name:
                cmd = [lp_path, "-d", printer_name, "-o", "fit-to-page", file_path]
            else:
                cmd = [lp_path, "-o", "fit-to-page", file_path]
            print(f"[SPOOLER] Linux/UNIX command: {' '.join(cmd)}")
            try:
                subprocess.run(cmd, check=True)
                print(f"[SPOOLER] Printed successfully via CUPS to {target_desc}.")
                return True
            except Exception as e:
                print(f"[ERROR] Spooler command failed: {e}")
                return False
        else:
            print(f"[SPOOLER SIMULATION] Executing CUPS mock call: lp " + 
                  (f"-d \"{printer_name}\"" if printer_name else "") + f" -o fit-to-page \"{file_path}\"")
            time.sleep(3)
            return True
    else:
        print(f"[ERROR] Unsupported Operating System spooler engine: {os_name}")
        return False

def update_server_status(job_id, status, printer_id=None):
    if printer_id is None:
        printer_id = PRINTER_ID
    url = f"{API_BASE_URL}/update_status.php"
    data = urllib.parse.urlencode({
        'job_id': job_id,
        'printer_id': printer_id,
        'status': status
    }).encode('utf-8')
    
    try:
        req = urllib.request.Request(url, data=data, method='POST')
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            print(f"[SERVER] Response: {res_data.get('message', 'Updated successfully')} | Cleanup: {res_data.get('cleanup')}")
            return True
    except Exception as e:
        print(f"[ERROR] Failed to post status update to server: {e}")
        return False

def poll_queue():
    url = f"{API_BASE_URL}/get_jobs.php?node_id={PRINTER_ID}"
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode('utf-8'))
            
            if data.get("status") == "found":
                job = data["job"]
                print(f"\n[JOB DETECTED] Job ID: {job['job_uuid']} | Secure Filename: {job['filename']} | Printer: {job.get('printer_name', 'Unknown')}")
                
                # Download file
                file_url = f"{API_BASE_URL}/uploads/{job['filename']}"
                local_path = os.path.join(TEMP_BUFFER_DIR, job['filename'])
                
                print(f"[DOWNLOAD] Downloading document from secure server print buffer...")
                if download_file(file_url, local_path):
                    # Spool and print file
                    print(f"[PRINT] Dispatching to native host Spooler...")
                    success = execute_spooler_print(local_path, job['format'], job.get('printer_name'))
                    
                    # Update status
                    status_state = "Completed" if success else "Failed"
                    print(f"[UPDATE] Dispatching completion status '{status_state}' to database server...")
                    update_server_status(job['job_id'], status_state, job.get('printer_id'))
                    
                    # Cleanup local downloaded file
                    if os.path.exists(local_path):
                        os.remove(local_path)
                        print(f"[CLEANUP] Deleted local temp buffer file: {job['filename']}")
                else:
                    # Mark failed on download issue
                    update_server_status(job['job_id'], "Failed", job.get('printer_id'))
            
            elif data.get("status") == "empty":
                # Print dot to indicate running poll state
                sys.stdout.write(".")
                sys.stdout.flush()
            else:
                print(f"\n[WARNING] Unexpected server response: {data}")
                
    except Exception as e:
        print(f"\n[ERROR] Polling connection failed: {e}. Re-trying in {POLL_INTERVAL} seconds...")

# Main execution loop
try:
    while True:
        poll_queue()
        time.sleep(POLL_INTERVAL)
except KeyboardInterrupt:
    print("\n[INFO] Print Node Daemon stopped by user request. Exiting...")
    sys.exit(0)
