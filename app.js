/* ==========================================================================
   UCPS INTERACTIVE CORE ENGINE - SIMULATION STATE & HANDLERS
   ========================================================================== */

// --- Global Simulation Database & States ---
let currentUser = null;      // Currently logged in student object
let currentOperator = null;  // Currently logged in shop owner object
let activePrinter = null;    // Currently paired printer object

const safeParseLS = (key) => {
    try {
        const val = localStorage.getItem(key);
        if (!val || val === 'undefined' || val === 'null') {
            localStorage.removeItem(key); // clean up corrupt entry
            return null;
        }
        return JSON.parse(val);
    } catch (e) {
        localStorage.removeItem(key); // clear corrupt entry so it doesn't repeat
        return null;
    }
};
currentUser     = safeParseLS("ucps_current_user");
currentOperator = safeParseLS("ucps_current_operator");
// Stale session fallback to restore node_id if missing in local storage cache
if (currentOperator && !currentOperator.node_id) {
    const emailLower = (currentOperator.email || '').toLowerCase();
    if (emailLower === 'maloy@ewu.edu.bd') {
        currentOperator.node_id = 'PRN001';
    } else if (emailLower === 'operator@ewu.edu.bd') {
        currentOperator.node_id = 'PRN002';
    } else {
        currentOperator.node_id = "PRN" + String(currentOperator.id || '1').padStart(3, '0');
    }
    localStorage.setItem("ucps_current_operator", JSON.stringify(currentOperator));
}
activePrinter   = safeParseLS("ucps_active_printer");
let fileUploaded = null;     // Temporary file mock
let uploadInProgress = false;
let isRealMode = true;      // Real database connectivity status (default to true for server integration)
let jobStatusTracker = {};   // Helper object to track status transitions between sync cycles
let calculatedPages = 1;
let calculatedCost = 5.00;
let selectedPaymentMethod = null;
let currentPrintingDocId = null;
let html5QrScanner = null;

// --- Pre-registered Defaults ---
const defaultUsers = [
    { id: 1, name: "Wahidur Rahman", email: "wahidur@student.ewu.edu.bd", password: "password", studentId: "2022-1-60-001", dept: "CSE" },
    { id: 2, name: "Muhib", email: "muhib@student.ewu.edu.bd", password: "password", studentId: "2022-1-60-002", dept: "CSE" }
];

const defaultOperators = [
    { id: 3, shop: "EWU Lab 3 Spooler", name: "Maloy Roy Orko", email: "maloy@ewu.edu.bd", password: "password" }
];

const defaultPrinters = {
    "PRN001": {
        id: "PRN001",
        name: "HP LaserJet Pro 400",
        location: "Room 304 (Lab 3)",
        status: "Online",
        spooler: "Windows Spooler (SumatraPDF CLI)",
        ink: "84%",
        paper: "Ready",
        error: null
    },
    "PRN002": {
        id: "PRN002",
        name: "Epson L3210 InkTank",
        location: "Room 305 (Office)",
        status: "Online",
        spooler: "Ubuntu Linux CUPS (lp engine)",
        ink: "92%",
        paper: "Ready",
        error: null
    }
};

// --- Load Databases from localStorage ---
let registeredUsers = JSON.parse(localStorage.getItem("ucps_users")) || defaultUsers;
let registeredOperators = JSON.parse(localStorage.getItem("ucps_operators")) || defaultOperators;
let printerNodes = JSON.parse(localStorage.getItem("ucps_printers")) || defaultPrinters;

// Synchronize initial defaults if empty
if (!localStorage.getItem("ucps_users")) localStorage.setItem("ucps_users", JSON.stringify(registeredUsers));
if (!localStorage.getItem("ucps_operators")) localStorage.setItem("ucps_operators", JSON.stringify(registeredOperators));
if (!localStorage.getItem("ucps_printers")) localStorage.setItem("ucps_printers", JSON.stringify(printerNodes));

// Queue Storage
let printQueue = [];
let jobCounter = 1004; // Start mock serial count

// Historical Completed Logs
let printHistory = [
    { job_id: "UCPS-1001", user_id: "Wahidur Rahman", filename: "assignment_ch3_v2.pdf", printer_name: "HP LaserJet Pro 400", time: "11:34 AM", status: "Completed" },
    { job_id: "UCPS-1002", user_id: "Maloy Roy Orko", filename: "official_transcript_seal.pdf", printer_name: "Epson L3210 InkTank", time: "11:42 AM", status: "Completed" },
    { job_id: "UCPS-1003", user_id: "Muhib", filename: "paper_draft_ieee.pdf", printer_name: "HP LaserJet Pro 400", time: "11:50 AM", status: "Completed" }
];

// Queue Worker configuration
let workerRunning = true;
let queueWorkerInterval = null;
let printSpeedMs = 4000; // Time taken to process printing

// System Log Logs array
const maxConsoleLogs = 50;
let lastLogId = 0;

// --- Helper Functions ---

// Generate random hashes (simulating secure renaming)
function generateSecureHash(filename) {
    const chars = 'abcdef0123456789';
    let hash = '';
    for(let i=0; i<10; i++) {
        hash += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const cleanName = filename.toLowerCase().replace(/[^a-z0-9.]/g, '_');
    return `${today}_${hash}_${cleanName}`;
}

// Push logs to operator screen console
function logToSystemConsole(message, type = "info") {
    const consoleBox = document.getElementById("console-log-box");
    if (!consoleBox) return;

    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = "console-line";
    
    let typeSpan = `<span class="console-info">SYSTEM:</span>`;
    if (type === "success") typeSpan = `<span class="console-success">SUCCESS:</span>`;
    if (type === "warning") typeSpan = `<span class="console-warning">WARNING:</span>`;
    if (type === "danger") typeSpan = `<span class="console-danger">ALERT:</span>`;

    line.innerHTML = `<span class="console-timestamp">[${timestamp}]</span> ${typeSpan} ${message}`;
    consoleBox.appendChild(line);

    // Keep scroll at bottom
    consoleBox.scrollTop = consoleBox.scrollHeight;

    // Prune old logs
    while (consoleBox.childNodes.length > maxConsoleLogs) {
        consoleBox.removeChild(consoleBox.firstChild);
    }
}

// Global Notification alerts
function showNotification(title, message, type = "info") {
    const container = document.getElementById("notification-area");
    if (!container) return;

    const notif = document.createElement("div");
    notif.className = `notification ${type}`;

    let icon = "fa-circle-info";
    if (type === "success") icon = "fa-circle-check";
    if (type === "warning") icon = "fa-triangle-exclamation";
    if (type === "danger") icon = "fa-shield-halved";

    notif.innerHTML = `
        <i class="fa-solid ${icon} notif-icon"></i>
        <div class="notif-body">
            <h4 class="notif-title">${title}</h4>
            <p class="notif-text">${message}</p>
        </div>
    `;

    // Click to dismiss
    notif.onclick = () => notif.remove();

    container.appendChild(notif);

    // Auto-remove after 4.5s
    setTimeout(() => {
        if (notif.parentNode) {
            notif.style.opacity = '0';
            notif.style.transform = 'translateX(120%)';
            notif.style.transition = 'all 0.3s ease';
            setTimeout(() => notif.remove(), 300);
        }
    }, 4500);
}

// Update directory dropdown list from global state
function updatePrinterDirectoryDropdown() {
    const select = document.getElementById("select-manual-printer");
    if (!select) return;
    
    // Save current selected value
    const savedVal = select.value;
    
    select.innerHTML = '<option value="" disabled selected>-- Select Shop / Room --</option>';
    Object.keys(printerNodes).forEach(key => {
        const prn = printerNodes[key];
        const isOnline = prn.status === "Online" || prn.status === "Busy";
        // If in real mode, only show active online/busy printers
        if (isRealMode && !isOnline) return;

        const opt = document.createElement("option");
        opt.value = prn.id;
        opt.innerText = `${prn.name} — ${prn.shop_name || prn.location}`;
        select.appendChild(opt);
    });
    
    if (savedVal && printerNodes[savedVal]) {
        select.value = savedVal;
    }
}

// Update DOM counts and table lists
function renderUI() {
    // 1. User Dashboard List
    const userQueueList = document.getElementById("user-queue-list");
    const emptyMsgUser = document.getElementById("user-empty-queue-msg");
    const activeCountUser = document.getElementById("user-active-queue-count");
    
    // Clear list
    const itemsToRemove = userQueueList.querySelectorAll(".queue-item");
    itemsToRemove.forEach(i => i.remove());

    const activeUserJobs = printQueue.filter(j => j.status !== "Completed" && j.status !== "Failed");
    activeCountUser.innerText = `${activeUserJobs.length} print job${activeUserJobs.length === 1 ? '' : 's'}`;

    if (activeUserJobs.length === 0) {
        emptyMsgUser.classList.remove("hidden");
    } else {
        emptyMsgUser.classList.add("hidden");
        activeUserJobs.forEach(job => {
            const item = document.createElement("div");
            item.className = "queue-item";
            
            // Payment state labels
            let payLabel = "";
            if (job.payment_status === "Pending Cash") {
                payLabel = ` <span class="status-pill pending" style="font-size: 10px; margin-left: 6px;">Awaiting Cash Payment</span>`;
            } else if (job.payment_status === "bKash_Paid") {
                payLabel = ` <span class="status-pill completed" style="font-size: 10px; margin-left: 6px; background-color: rgba(226,19,110,0.15); color: #e2136e; border-color: rgba(226,19,110,0.3);">bKash Paid</span>`;
            } else if (job.payment_status === "Cash_Approved") {
                payLabel = ` <span class="status-pill completed" style="font-size: 10px; margin-left: 6px;">Cash Approved</span>`;
            }

            item.innerHTML = `
                <div style="display:flex; align-items:center; width: 70%;">
                    <i class="fa-solid fa-file-pdf q-file-icon"></i>
                    <div class="q-main-info" style="width: 100%;">
                        <div class="q-name" style="display: flex; align-items: center; width: 100%;">
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width: 60%;">${job.filename}</span>
                            ${payLabel}
                        </div>
                        <div class="q-meta">${job.printer_name} • Fee: ${job.price} BDT</div>
                    </div>
                </div>
                <div class="q-status-block">
                    <span class="status-pill ${job.status.toLowerCase()}">${job.status}</span>
                </div>
            `;
            userQueueList.appendChild(item);
        });
    }

    // 2. Personal History List
    const userHistoryRows = document.getElementById("user-history-rows");
    if (userHistoryRows) {
        userHistoryRows.innerHTML = "";
        printHistory.slice().reverse().forEach(log => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><strong>${log.job_id}</strong></td>
                <td>${log.filename}</td>
                <td>${log.printer_name}</td>
                <td>${log.time}</td>
                <td><span class="status-pill completed">${log.status}</span></td>
            `;
            userHistoryRows.appendChild(row);
        });
    }

    // 3. Operator Spooler Panel Updates
    const opPending = document.getElementById("op-pending-count");
    const opProcessing = document.getElementById("op-processing-count");
    const opCompleted = document.getElementById("op-completed-count");
    
    // Determine printer IDs belonging to logged-in operator
    let opPrinterIds = [];
    if (currentOperator) {
        opPrinterIds = Object.keys(printerNodes)
            .filter(key => 
                printerNodes[key].id === currentOperator.node_id ||
                (printerNodes[key].location && printerNodes[key].location.includes("(" + currentOperator.node_id + ")"))
            )
            .map(key => printerNodes[key].id);
    }

    if (opPending) {
        const countPending = printQueue.filter(j => opPrinterIds.includes(j.printer_id) && j.status === "Pending").length;
        const countProcessing = printQueue.filter(j => opPrinterIds.includes(j.printer_id) && j.status === "Printing").length;
        const countCompleted = printHistory.filter(j => opPrinterIds.includes(j.printer_id)).length;

        opPending.innerText = countPending;
        opProcessing.innerText = countProcessing;
        opCompleted.innerText = countCompleted;
    }

    // Node count indicators
    const node1Q = document.getElementById("node-prn1-queue");
    if (node1Q) {
        node1Q.innerText = printQueue.filter(j => j.printer_id === "PRN001" && j.status !== "Completed").length;
    }
    const node2Q = document.getElementById("node-prn2-queue");
    if (node2Q) {
        node2Q.innerText = printQueue.filter(j => j.printer_id === "PRN002" && j.status !== "Completed").length;
    }

    // Update active printer nodes on the screen
    const networkBox = document.querySelector(".printer-network-box");
    if (networkBox) {
        // Clear children
        networkBox.innerHTML = "";
        
        const keys = Object.keys(printerNodes).filter(key => 
            !currentOperator || 
            printerNodes[key].id === currentOperator.node_id ||
            (printerNodes[key].location && printerNodes[key].location.includes("(" + currentOperator.node_id + ")"))
        );
        
        if (keys.length === 0) {
            networkBox.innerHTML = `
                <div style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px; width: 100%;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: var(--color-danger); margin-bottom: 10px; display: block;"></i>
                    No active printers detected.<br>
                    <span style="font-size: 11px; margin-top: 5px; display: block;">Ensure the print node daemon is running on your machine.</span>
                </div>
            `;
        } else {
            keys.forEach(key => {
                const prn = printerNodes[key];
                const qCount = printQueue.filter(j => j.printer_id === prn.id && j.status !== "Completed").length;
                
                const nodeDiv = document.createElement("div");
                nodeDiv.className = `printer-node-item ${prn.status.toLowerCase()}`;
                nodeDiv.id = `node-${prn.id.toLowerCase()}`;
                nodeDiv.innerHTML = `
                    <div class="node-icon"><i class="fa-solid fa-print"></i></div>
                    <div class="node-info">
                        <h3 class="node-name">${prn.name}</h3>
                        <p class="node-loc">${prn.shop_name} | Spooler: ${prn.spooler.split(" (")[0]}</p>
                        <div class="node-stats">
                            <span class="node-stat-pill"><i class="fa-solid fa-layer-group"></i> Queue: <strong>${qCount}</strong></span>
                            <span class="node-stat-pill"><i class="fa-solid fa-tint"></i> Ink: ${prn.ink}</span>
                            <span class="node-stat-pill"><i class="fa-solid fa-toilet-paper"></i> Paper: ${prn.paper}</span>
                        </div>
                    </div>
                    <div class="node-actions" style="display:flex; align-items:center; gap:8px;">
                        ${prn.status !== 'Offline' ? `
                        <button class="secondary-action-btn-small" style="padding: 4px 8px; border-color: rgba(20,184,166,0.3); color: var(--color-primary); background: transparent;" onclick="showPrinterQRCode('${prn.id}')" title="Show QR Code">
                            <i class="fa-solid fa-qrcode"></i> QR Label
                        </button>` : ''}
                        <select class="node-status-select" onchange="changePrinterState('${prn.id}', this.value)">
                            <option value="Online" ${prn.status === 'Online' ? 'selected' : ''}>Online</option>
                            <option value="Busy" ${prn.status === 'Busy' ? 'selected' : ''}>Busy</option>
                            <option value="Offline" ${prn.status === 'Offline' ? 'selected' : ''}>Offline</option>
                        </select>
                    </div>
                `;
                networkBox.appendChild(nodeDiv);
            });
        }
    }

    // Operator Queue Table Rows
    const opQueueRows = document.getElementById("op-queue-rows");
    const opEmptyMsg = document.getElementById("op-empty-queue-msg");
    
    if (opQueueRows) {
        opQueueRows.innerHTML = "";
        // Resolve operator printers list
        let opPrinterIds = [];
        if (currentOperator) {
            opPrinterIds = Object.keys(printerNodes)
                .filter(key => 
                    printerNodes[key].id === currentOperator.node_id ||
                    (printerNodes[key].location && printerNodes[key].location.includes("(" + currentOperator.node_id + ")"))
                )
                .map(key => printerNodes[key].id);
        }
        const activeSpoolJobs = printQueue.filter(j => opPrinterIds.includes(j.printer_id) && j.status !== "Completed" && j.status !== "Failed");

        if (activeSpoolJobs.length === 0) {
            opEmptyMsg.classList.remove("hidden");
        } else {
            opEmptyMsg.classList.add("hidden");
            activeSpoolJobs.forEach(job => {
                const row = document.createElement("tr");
                
                // Payment Status visual pill
                let payBadge = "";
                const rawPayStatus = (job.payment_status || "").toLowerCase();
                const isUnpaid = rawPayStatus === "pending cash" || rawPayStatus === "unpaid";
                
                if (isUnpaid) {
                    payBadge = `<span class="status-pill pending">Awaiting Cash</span>`;
                } else if (rawPayStatus === "bkash_paid") {
                    payBadge = `<span class="status-pill completed" style="background-color:rgba(226,19,110,0.1); color:#e2136e; border-color:rgba(226,19,110,0.25);">bKash Paid</span>`;
                } else {
                    payBadge = `<span class="status-pill completed">Cash Paid</span>`;
                }

                // Actions logic: if Cash is unpaid, show Approve Cash, else standard Cancel
                let actionBtn = "";
                if (isUnpaid) {
                    actionBtn = `
                        <button class="op-action-btn-small" style="color:var(--color-success); border-color:rgba(16,185,129,0.2); margin-right:6px;" onclick="approveCashPayment('${job.job_id}')">
                            <i class="fa-solid fa-check"></i> Collect Cash
                        </button>
                        <button class="op-action-btn-small" onclick="cancelJob('${job.job_id}')">
                            <i class="fa-solid fa-ban"></i> Cancel
                        </button>
                    `;
                } else {
                    actionBtn = `
                        <button class="op-action-btn-small" onclick="cancelJob('${job.job_id}')">
                            <i class="fa-solid fa-ban"></i> Cancel
                        </button>
                    `;
                }

                row.innerHTML = `
                    <td><strong>${job.job_id}</strong></td>
                    <td>${job.user_id}</td>
                    <td>${job.printer_name}</td>
                    <td style="font-family:var(--font-mono); font-size:11px;">${job.secure_filename}</td>
                    <td>${job.format} • ${job.price} BDT</td>
                    <td>${payBadge} <span class="status-pill ${job.status.toLowerCase()}" style="margin-top:4px;">${job.status}</span></td>
                    <td>
                        <div style="display:flex;">${actionBtn}</div>
                    </td>
                `;
                opQueueRows.appendChild(row);
            });
        }
    }

    // Populate Manual directory
    updatePrinterDirectoryDropdown();
}

// Global scope bindings for row action clicks
window.changePrinterState = function(printerId, val) {
    printerNodes[printerId].status = val;
    if (val === "Offline") {
        printerNodes[printerId].error = "Offline";
    } else {
        printerNodes[printerId].error = null;
    }

    // Persist status change to database
    const formData = new FormData();
    formData.append("printer_id", printerId);
    formData.append("status", val);

    fetch("update_printer_status.php", {
        method: "POST",
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            logToSystemConsole(`OPERATOR: Set printer [${printerNodes[printerId].name}] state to [${val}] in database.`, "success");
        } else {
            logToSystemConsole(`OPERATOR: Database update failed for printer [${printerNodes[printerId].name}]: ${data.message}`, "danger");
        }
    })
    .catch(err => {
        logToSystemConsole(`OPERATOR: Network error updating printer [${printerNodes[printerId].name}] state: ${err}`, "danger");
    });

    renderUI();
}

// Cancel pending prints
window.cancelJob = function(jobId) {
    const jobIndex = printQueue.findIndex(j => j.job_id === jobId);
    if (jobIndex > -1) {
        const job = printQueue[jobIndex];
        if (job.status === "Printing") {
            if (!confirm("This job is marked as 'Printing' (in progress). Do you want to force cancel it?")) {
                return;
            }
        }
        
        if (isRealMode) {
            const formData = new FormData();
            formData.append("job_uuid", jobId);
            if (currentOperator) {
                formData.append("operator_id", currentOperator.id);
            }
            
            fetch("delete_job.php", {
                method: "POST",
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === "success") {
                    logToSystemConsole(`OPERATOR: Aborted Print Job ${jobId} from server database queue.`, "warning");
                    showNotification("Print Aborted", `Job ${jobId} has been successfully canceled.`, "success");
                    syncDatabase();
                } else {
                    showNotification("Cancel Failed", data.message || "Unknown error", "danger");
                }
            })
            .catch(err => {
                showNotification("Network Error", "Could not connect to cancel job API: " + err, "danger");
            });
            return;
        }
        
        // Remove from queue
        printQueue.splice(jobIndex, 1);
        logToSystemConsole(`OPERATOR: Aborted Print Job ${jobId} from server database queue.`, "warning");
        showNotification("Print Aborted", `Job ${jobId} has been successfully canceled.`, "success");
        renderUI();
    }
}

// Approve Cash Payment
window.approveCashPayment = function(jobId) {
    if (isRealMode) {
        // Find the job in local printQueue array to get its DB ID if needed
        const localJob = printQueue.find(j => j.job_id === jobId);
        const dbId = localJob ? localJob.db_id : jobId;
        
        const formData = new FormData();
        formData.append("job_id", dbId);
        formData.append("action", "ApproveCash");
        if (currentOperator) {
            formData.append("operator_id", currentOperator.id);
        }
        
        fetch("process_payment.php", {
            method: "POST",
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                logToSystemConsole(`OPERATOR: Manually collected cash for Job ${jobId}. Queue unlocked in database.`, "success");
                showNotification("Cash Collected", `Job ${jobId} has been paid in cash and sent to spooler.`, "success");
                syncDatabase();
            } else {
                showNotification("Approval Failed", data.message || "Unknown error", "danger");
            }
        })
        .catch(err => {
            showNotification("Network Error", "Could not connect to payment confirmation API: " + err, "danger");
        });
        return;
    }
    
    // Fallback Simulation code
    const job = printQueue.find(j => j.job_id === jobId);
    if (job) {
        job.payment_status = "Cash_Approved";
        logToSystemConsole(`OPERATOR: Manually collected ${job.price} BDT cash for Job ${job.job_id}. Queue unlocked.`, "success");
        showNotification("Cash Collected", `Job ${job.job_id} has been paid in cash and sent to printer spooler.`, "success");
        renderUI();
    }
}

// --- Routing View Handler with Login Guards ---
function setView(viewId) {
    // 1. Guard check if attempting dashboard view without active session
    if (viewId === "view-user" && !currentUser) {
        setAuthViewMode("student", "login");
        setView("view-auth");
        return;
    }
    if (viewId === "view-operator" && !currentOperator) {
        setAuthViewMode("operator", "login");
        setView("view-auth");
        return;
    }

    // Remove active from all nav items
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
    // Hide all view sections
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));

    // Activate selected section
    const targetSection = document.getElementById(viewId);
    if (targetSection) targetSection.classList.add("active");

    // Activate corresponding nav item
    if (viewId === "view-landing") document.getElementById("btn-view-landing").classList.add("active");
    if (viewId === "view-user") document.getElementById("btn-view-user").classList.add("active");
    if (viewId === "view-operator") document.getElementById("btn-view-operator").classList.add("active");

    // Sync mobile bottom tab active highlight (inline style control)
    const allMobBtns = ["mob-btn-landing", "mob-btn-user", "mob-btn-operator", "mob-btn-account"];
    allMobBtns.forEach(id => {
        const b = document.getElementById(id);
        if (b) { b.style.color = "#94a3b8"; const ic = b.querySelector("i"); if(ic) ic.style.filter = ""; }
    });
    function activateMobBtn(id) {
        const b = document.getElementById(id);
        if (b) { b.style.color = "#0ea5e9"; const ic = b.querySelector("i"); if(ic) ic.style.filter = "drop-shadow(0 0 6px #0ea5e9)"; }
    }
    if (viewId === "view-landing") activateMobBtn("mob-btn-landing");
    if (viewId === "view-user")    activateMobBtn("mob-btn-user");
    if (viewId === "view-operator") activateMobBtn("mob-btn-operator");
    if (viewId === "view-auth")    activateMobBtn("mob-btn-account");

    // Refresh animation triggers
    const spinIcon = document.getElementById("refresh-spin");
    if (spinIcon && (viewId === "view-user" || viewId === "view-operator")) {
        spinIcon.classList.remove("hidden");
        setTimeout(() => spinIcon.classList.add("hidden"), 1000);
    }
}

// Set login/signup modes in Auth card
function setAuthViewMode(role, mode) {
    // Active tabs
    const tabLogin = document.getElementById("tab-login");
    const tabSignup = document.getElementById("tab-signup");
    
    if (mode === "login") {
        tabLogin.classList.add("active");
        tabLogin.style.borderBottom = "2px solid var(--color-primary)";
        tabLogin.style.color = "var(--text-main)";
        
        tabSignup.classList.remove("active");
        tabSignup.style.borderBottom = "none";
        tabSignup.style.color = "var(--text-muted)";
        
        document.getElementById("form-login-block").classList.remove("hidden");
        document.getElementById("form-signup-block").classList.add("hidden");
    } else {
        tabSignup.classList.add("active");
        tabSignup.style.borderBottom = "2px solid var(--color-primary)";
        tabSignup.style.color = "var(--text-main)";
        
        tabLogin.classList.remove("active");
        tabLogin.style.borderBottom = "none";
        tabLogin.style.color = "var(--text-muted)";
        
        document.getElementById("form-login-block").classList.add("hidden");
        document.getElementById("form-signup-block").classList.remove("hidden");
    }

    // Role selectors
    const labelStudent = document.getElementById("label-role-student");
    const labelOperator = document.getElementById("label-role-operator");
    
    if (role === "student") {
        labelStudent.classList.add("active");
        labelStudent.style.background = "var(--color-primary)";
        labelStudent.style.color = "#fff";
        
        labelOperator.classList.remove("active");
        labelOperator.style.background = "transparent";
        labelOperator.style.color = "var(--text-muted)";
        
        document.querySelector('input[name="auth-role"][value="student"]').checked = true;
        
        // Show student fields, hide operator
        document.getElementById("signup-fields-student").classList.remove("hidden");
        document.getElementById("signup-fields-operator").classList.add("hidden");
        
        // Login panel strings
        document.getElementById("login-title-text").innerText = "Student Sign In";
        document.getElementById("login-desc-text").innerText = "Sign in using your student portal email to upload files.";
    } else {
        labelOperator.classList.add("active");
        labelOperator.style.background = "var(--color-primary)";
        labelOperator.style.color = "#fff";
        
        labelStudent.classList.remove("active");
        labelStudent.style.background = "transparent";
        labelStudent.style.color = "var(--text-muted)";
        
        document.querySelector('input[name="auth-role"][value="operator"]').checked = true;
        
        // Show operator fields, hide student
        document.getElementById("signup-fields-operator").classList.remove("hidden");
        document.getElementById("signup-fields-student").classList.add("hidden");
        
        // Login panel strings
        document.getElementById("login-title-text").innerText = "Shop Operator Sign In";
        document.getElementById("login-desc-text").innerText = "Sign in using your business credentials to manage spooler queues.";
    }
}

// Update Profile Header Badges
function updateSessionBadge() {
    const badge = document.getElementById("user-profile-badge");
    const nameEl = document.getElementById("session-username");
    const roleEl = document.getElementById("session-role");
    const userBtn = document.getElementById("btn-view-user");
    const opBtn = document.getElementById("btn-view-operator");
    const avatarWrapper = document.getElementById("user-avatar-wrapper");

    // Mobile bottom nav tabs (use inline display, not classes)
    const mobUser     = document.getElementById("mob-btn-user");
    const mobOperator = document.getElementById("mob-btn-operator");

    const userObj = currentUser || currentOperator;

    if (userObj) {
        badge.classList.remove("hidden");
        nameEl.innerText = userObj.name;
        roleEl.innerText = currentUser ? `${currentUser.dept} Student` : currentOperator.shop;
        
        if (currentUser) {
            if (userBtn) userBtn.style.display = "inline-block";
            if (opBtn) opBtn.style.display = "none";
            if (mobUser) mobUser.style.display = "flex";
            if (mobOperator) mobOperator.style.display = "none";
        } else {
            if (userBtn) userBtn.style.display = "none";
            if (opBtn) opBtn.style.display = "inline-block";
            if (mobUser) mobUser.style.display = "none";
            if (mobOperator) mobOperator.style.display = "flex";
        }

        // Render dynamic avatar if set
        if (avatarWrapper) {
            if (userObj.avatar) {
                avatarWrapper.innerHTML = `<img class="avatar-icon" src="uploads/${userObj.avatar}" style="width:24px; height:24px; border-radius:50%; object-fit:cover; border:1.5px solid var(--color-primary);">`;
            } else {
                avatarWrapper.innerHTML = `<i class="fa-solid fa-circle-user avatar-icon" style="font-size:1.5rem; color:var(--color-primary);"></i>`;
            }
        }
    } else {
        badge.classList.add("hidden");
        if (userBtn) userBtn.style.display = "none";
        if (opBtn) opBtn.style.display = "none";
        if (mobUser)     { mobUser.style.display = "none"; }
        if (mobOperator) { mobOperator.style.display = "none"; }
    }

    const guestBtn = document.getElementById("btn-start-guest");
    if (guestBtn) {
        guestBtn.style.display = (currentUser || currentOperator) ? "none" : "inline-block";
    }
}

// --- Real Database Synchronization ---
async function syncDatabase() {
    try {
        // 1. Fetch Printers
        const prnResponse = await fetch("get_printers.php");
        const prnData = await prnResponse.json();
        if (prnData.status === "success" && prnData.printers) {
            isRealMode = true;
            const newPrinters = {};
            prnData.printers.forEach(p => {
                newPrinters[p.printer_id] = {
                    id: p.printer_id,
                    name: p.printer_name,
                    location: p.location,
                    status: p.status,
                    spooler: p.printer_id.includes("PRN002") ? "Ubuntu CUPS" : "Windows SumatraPDF",
                    ink: p.ink_level || "100%",
                    paper: p.paper_status || "Ready",
                    error: null,
                    shop_name: p.shop_name || "Unknown Shop"
                };
            });
            printerNodes = newPrinters;
            localStorage.setItem("ucps_printers", JSON.stringify(printerNodes));
        }

        // 2. Fetch Jobs Queue with secure filters
        let qUrl = "get_queue.php";
        if (currentOperator) {
            qUrl += `?node_id=${currentOperator.node_id}`;
        } else if (currentUser) {
            qUrl += `?user_id=${currentUser.id}`;
            if (activePrinter) {
                qUrl += `&paired_printer_id=${activePrinter.id}`;
            }
        }
        const qResponse = await fetch(qUrl);
        const qData = await qResponse.json();
        if (qData.status === "success" && qData.jobs) {
            const mappedQueue = [];
            const mappedHistory = [];
            let hasCompletedChanges = false;
            let hasNewJobsForOperator = false;

            qData.jobs.forEach(j => {
                const jobObj = {
                    job_id: j.job_uuid,
                    db_id: j.job_id,
                    user_id: j.username,
                    printer_id: j.printer_id,
                    printer_name: j.printer_name,
                    filename: j.original_filename,
                    secure_filename: j.secure_filename,
                    format: j.file_format,
                    price: parseFloat(j.price_bdt),
                    payment_status: (j.payment_status || "").toLowerCase() === "cash_approved" ? "Cash_Approved" : ((j.payment_status || "").toLowerCase() === "bkash_paid" ? "bKash_Paid" : "Pending Cash"),
                    status: j.status,
                    timestamp: new Date(j.upload_time).toLocaleTimeString()
                };

                // Track status transitions between sync cycles
                const oldStatus = jobStatusTracker[j.job_uuid];
                if (oldStatus && oldStatus !== j.status) {
                    if (j.status === "Completed") {
                        if (currentUser && currentUser.username === j.username) {
                            showNotification("Printing Completed", `Your file "${j.original_filename}" has been successfully printed!`, "success");
                            hasCompletedChanges = true;
                        }
                    } else if (j.status === "Failed") {
                        if (currentUser && currentUser.username === j.username) {
                            showNotification("Printing Failed", `Your file "${j.original_filename}" could not be printed. Please check with operator.`, "danger");
                            hasCompletedChanges = true;
                        }
                    }
                }

                // Operator alert: New job submitted
                if (!oldStatus && j.status === "Pending" && currentOperator) {
                    hasNewJobsForOperator = true;
                }

                // Store state in tracker
                jobStatusTracker[j.job_uuid] = j.status;

                if (j.status === "Completed" || j.status === "Failed") {
                    mappedHistory.push(jobObj);
                } else {
                    mappedQueue.push(jobObj);
                }
            });

            printQueue = mappedQueue;
            printHistory = mappedHistory;
            
            // Auto refresh student drive files list if print completes (avoids stale list)
            if (hasCompletedChanges && currentUser) {
                loadUserDriveDocuments();
            }

            // Notification alert + audio chime for operator on new job arrival
            if (hasNewJobsForOperator && currentOperator) {
                showNotification("New Job Received", "A new print request is waiting in your queue.", "info");
                const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-200.wav");
                audio.volume = 0.3;
                audio.play().catch(e => {
                    console.log("Audio play blocked by browser interaction policy:", e);
                });
            }
            
            qData.jobs.forEach(j => {
                const num = parseInt(j.job_uuid.replace("UCPS-", ""));
                if (!isNaN(num) && num >= jobCounter) {
                    jobCounter = num + 1;
                }
            });
        }
        
        renderUI();

        // 2.5 Fetch Operator Stats from server
        if (currentOperator) {
            try {
                const d = new Date();
                const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const statsResponse = await fetch(`get_stats.php?node_id=${currentOperator.node_id}&date=${todayStr}`);
                const statsData = await statsResponse.json();
                if (statsData.status === "success") {
                    const elEarnings = document.getElementById("op-today-earnings");
                    const elJobs = document.getElementById("op-today-jobs");
                    if (elEarnings) elEarnings.innerText = `${statsData.total_revenue.toFixed(2)} BDT`;
                    if (elJobs) elJobs.innerText = statsData.total_jobs;
                }
            } catch (statsErr) {
                console.warn("Failed to fetch operator stats:", statsErr);
            }
        }

        // 3. Fetch System Logs from server
        try {
            const nodeParam = currentOperator ? `&node_id=${currentOperator.node_id}` : '';
            const logsResponse = await fetch(`get_logs.php?last_log_id=${lastLogId}${nodeParam}`);
            const logsData = await logsResponse.json();
            if (logsData.status === "success" && logsData.logs && logsData.logs.length > 0) {
                logsData.logs.forEach(log => {
                    if (log.message.includes("SPOOLER:")) {
                        logToSystemConsole(log.message, log.log_type);
                    }
                    lastLogId = Math.max(lastLogId, parseInt(log.log_id));
                });
            }
        } catch (logErr) {
            console.warn("Failed to fetch server logs:", logErr);
        }
    } catch (e) {
        console.warn("Real database synchronization failed. Operating in local simulation mode.", e);
        isRealMode = false;
    }
}

// Display Printer QR Code Label Modal
window.showPrinterQRCode = function(printerId) {
    const prn = printerNodes[printerId];
    if (!prn) return;
    
    // Generate page redirect url
    const scanUrl = window.location.origin + window.location.pathname + "?printer_id=" + encodeURIComponent(printerId);
    
    // Dynamic QR generation server API
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(scanUrl)}`;
    
    document.getElementById("modal-qr-image").src = qrApiUrl;
    document.getElementById("modal-qr-printer-name").innerText = prn.name;
    
    const qrLink = document.getElementById("modal-qr-link");
    qrLink.href = scanUrl;
    qrLink.innerText = scanUrl;
    
    document.getElementById("printer-qr-modal").classList.remove("hidden");
};

// Helper to calculate exact page count from range string (e.g. '1-3, 5' -> 4 pages)
function calculatePagesFromRange(rangeStr, totalPages) {
    if (!rangeStr || rangeStr === "all") {
        return totalPages;
    }
    
    let pages = new Set();
    const parts = rangeStr.split(",");
    
    parts.forEach(part => {
        part = part.trim();
        if (part.includes("-")) {
            const subparts = part.split("-");
            const start = parseInt(subparts[0]);
            const end = parseInt(subparts[1]);
            if (!isNaN(start) && !isNaN(end)) {
                const low = Math.min(start, end);
                const high = Math.min(Math.max(start, end), totalPages);
                for (let i = low; i <= high; i++) {
                    if (i >= 1 && i <= totalPages) pages.add(i);
                }
            }
        } else {
            const pageNum = parseInt(part);
            if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                pages.add(pageNum);
            }
        }
    });
    
    return pages.size > 0 ? pages.size : totalPages;
}

// Interactive PDF page-by-page rendering engine inside the checkout preview box
function initInteractivePDFPreview(pdfData, previewBox, onPageCountResolved) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    previewBox.innerHTML = `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;color:var(--text-muted);font-size:11px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem;color:var(--color-primary);margin-bottom:8px;"></i>Loading preview...</div>`;

    pdfjsLib.getDocument({ data: pdfData }).promise.then(pdf => {
        const totalPages = pdf.numPages;
        let currentPage = 1;
        
        if (onPageCountResolved) {
            onPageCountResolved(totalPages);
        }

        function renderPage(pageNum) {
            previewBox.innerHTML = '';
            
            const viewportContainer = document.createElement('div');
            viewportContainer.style.width = "100%";
            viewportContainer.style.height = "calc(100% - 30px)";
            viewportContainer.style.display = "flex";
            viewportContainer.style.justifyContent = "center";
            viewportContainer.style.alignItems = "center";
            viewportContainer.style.overflow = "hidden";
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            viewportContainer.appendChild(canvas);
            previewBox.appendChild(viewportContainer);

            pdf.getPage(pageNum).then(page => {
                const unscaledViewport = page.getViewport({ scale: 1.0 });
                const scale = 140 / unscaledViewport.height; // scale to fit inside modal container
                const viewport = page.getViewport({ scale: scale });

                canvas.height = viewport.height;
                canvas.width = viewport.width;
                canvas.style.maxHeight = "100%";
                canvas.style.maxWidth = "100%";
                canvas.style.borderRadius = "4px";
                canvas.style.background = "#ffffff";
                canvas.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";

                page.render({
                    canvasContext: context,
                    viewport: viewport
                });
            });

            // Control panel
            const controls = document.createElement('div');
            controls.style.display = "flex";
            controls.style.justifyContent = "space-between";
            controls.style.alignItems = "center";
            controls.style.padding = "2px 8px";
            controls.style.background = "rgba(0,0,0,0.5)";
            controls.style.height = "30px";
            controls.style.width = "100%";
            controls.style.fontSize = "10px";
            controls.style.borderTop = "1px solid var(--border-color)";
            
            controls.innerHTML = `
                <button id="chk-prev" class="secondary-action-btn-small" style="width:auto; margin:0; padding:2px 6px; font-size:10px;" ${pageNum <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
                <span style="color:#ffffff;">Page ${pageNum} of ${totalPages}</span>
                <button id="chk-next" class="secondary-action-btn-small" style="width:auto; margin:0; padding:2px 6px; font-size:10px;" ${pageNum >= totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
            `;
            
            previewBox.appendChild(controls);

            controls.querySelector("#chk-prev").onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (currentPage > 1) {
                    currentPage--;
                    renderPage(currentPage);
                }
            };
            
            controls.querySelector("#chk-next").onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (currentPage < totalPages) {
                    currentPage++;
                    renderPage(currentPage);
                }
            };
        }

        renderPage(currentPage);

    }).catch(err => {
        console.error("PDF preview generation error:", err);
        previewBox.innerHTML = `<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:20px;"><i class="fa-solid fa-file-pdf" style="font-size:2rem;color:var(--color-danger);display:block;margin-bottom:8px;"></i>No preview ready</div>`;
    });
}

// --- Interaction Handler Bindings ---

document.addEventListener("DOMContentLoaded", () => {
    const updateCheckoutPrice = () => {
        const copies = Math.max(1, parseInt(document.getElementById("print-copies").value) || 1);
        const colorMode = document.getElementById("print-color").value;
        const rate = (colorMode === "color") ? 15.00 : 5.00;
        
        // Calculate page count based on range selection
        const rangeSelect = document.getElementById("print-range-select").value;
        const customRange = document.getElementById("print-range").value;
        const rangeStr = (rangeSelect === "custom") ? customRange : rangeSelect;
        
        const activePages = calculatePagesFromRange(rangeStr, calculatedPages);
        calculatedCost = activePages * rate * copies;
        
        document.getElementById("checkout-amount").innerText = `${calculatedCost.toFixed(2)} BDT`;
    };
    
    document.getElementById("print-copies").addEventListener("input", updateCheckoutPrice);
    document.getElementById("print-color").addEventListener("change", updateCheckoutPrice);
    document.getElementById("print-range").addEventListener("input", updateCheckoutPrice);
    
    // Page range dropdown onchange handler
    document.getElementById("print-range-select").onchange = (e) => {
        const customInput = document.getElementById("print-range");
        if (e.target.value === "custom") {
            customInput.classList.remove("hidden");
            customInput.value = "";
            customInput.focus();
        } else {
            customInput.classList.add("hidden");
            customInput.value = e.target.value;
        }
        updateCheckoutPrice();
    };
    
    window.updateCheckoutPrice = updateCheckoutPrice;

    // View Routing
    document.getElementById("btn-view-landing").onclick = () => setView("view-landing");
    document.getElementById("btn-view-user").onclick = () => setView("view-user");
    document.getElementById("btn-view-operator").onclick = () => setView("view-operator");
    document.getElementById("nav-logo").onclick = () => setView("view-landing");
    document.getElementById("btn-start-user").onclick = () => setView("view-user");
    document.getElementById("btn-start-operator").onclick = () => setView("view-operator");

    // Mobile bottom nav wiring — show nav bar on small screens, wire clicks
    const mobileNav = document.getElementById("mobile-bottom-nav");
    function syncMobileNavVisibility() {
        if (mobileNav) mobileNav.style.display = window.innerWidth <= 768 ? "flex" : "none";
    }
    syncMobileNavVisibility();
    window.addEventListener("resize", syncMobileNavVisibility);

    const mobLanding  = document.getElementById("mob-btn-landing");
    const mobUser     = document.getElementById("mob-btn-user");
    const mobOperator = document.getElementById("mob-btn-operator");
    const mobAccount  = document.getElementById("mob-btn-account");
    if (mobLanding)  mobLanding.onclick  = () => setView("view-landing");
    if (mobUser)     mobUser.onclick     = () => setView("view-user");
    if (mobOperator) mobOperator.onclick = () => setView("view-operator");
    if (mobAccount)  mobAccount.onclick  = () => {
        // If logged in, open the profile edit modal directly. If logged out, take to login view.
        if (currentUser || currentOperator) {
            openProfileModal();
        } else {
            setView("view-auth");
        }
    };

    // Auth View tabs switching
    document.getElementById("tab-login").onclick = () => {
        const role = document.querySelector('input[name="auth-role"]:checked').value;
        setAuthViewMode(role, "login");
    };
    document.getElementById("tab-signup").onclick = () => {
        const role = document.querySelector('input[name="auth-role"]:checked').value;
        setAuthViewMode(role, "signup");
    };

    // Role clicks
    document.getElementById("label-role-student").onclick = () => {
        const activeTab = document.getElementById("tab-login").classList.contains("active") ? "login" : "signup";
        setAuthViewMode("student", activeTab);
    };
    document.getElementById("label-role-operator").onclick = () => {
        const activeTab = document.getElementById("tab-login").classList.contains("active") ? "login" : "signup";
        setAuthViewMode("operator", activeTab);
    };

    // SIGN IN SUBMISSION
    // SIGN IN SUBMISSION
    document.getElementById("btn-submit-login").onclick = (e) => {
        e.preventDefault();
        const email = document.getElementById("login-email").value.trim();
        const pass = document.getElementById("login-password").value;
        const roleRadio = document.querySelector('input[name="auth-role"]:checked');
        const role = roleRadio ? roleRadio.value : "student";

        if (!email || !pass) {
            showNotification("Missing Fields", "Please enter both email and password.", "danger");
            return;
        }

        const formData = new FormData();
        formData.append('email', email);
        formData.append('password', pass);
        formData.append('role', role);

        fetch('login.php', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                if (role === 'student') {
                    currentUser = {
                        id: data.user.id,
                        name: data.user.name,
                        email: data.user.email,
                        studentId: data.user.studentId,
                        dept: data.user.dept
                    };
                    currentOperator = null;
                    localStorage.setItem("ucps_current_user", JSON.stringify(currentUser));
                    localStorage.removeItem("ucps_current_operator");
                    updateSessionBadge();
                    showNotification("Access Granted", `Welcome back, ${currentUser.name}! Portal unlocked.`, "success");
                    logToSystemConsole(`AUTH: Student Session validated in DB for user: ${currentUser.name} (ID: ${currentUser.studentId}).`, "success");
                    
                    document.getElementById("login-email").value = "";
                    document.getElementById("login-password").value = "";
                    
                    setView("view-user");
                    renderUI();
                    loadUserDriveDocuments();
                    
                    const pendingPrinterId = sessionStorage.getItem("pending_pair_printer_id");
                    if (pendingPrinterId) {
                        sessionStorage.removeItem("pending_pair_printer_id");
                        const pr = printerNodes[pendingPrinterId];
                        if (pr) {
                            if (pr.status === "Online") {
                                pairPrinter(pendingPrinterId, false);
                                showNotification("Printer Paired", `Welcome! Auto-paired with ${pr.name} after sign in.`, "success");
                            } else {
                                showNotification("Pairing Warning", `The printer ${pr.name} is offline. Pairing rejected.`, "warning");
                            }
                        }
                    }
                } else {
                    currentOperator = {
                        id: data.user.id,
                        name: data.user.name,
                        email: data.user.email,
                        shop: data.user.shop,
                        node_id: data.user.node_id
                    };
                    currentUser = null;
                    localStorage.setItem("ucps_current_operator", JSON.stringify(currentOperator));
                    localStorage.removeItem("ucps_current_user");
                    updateSessionBadge();
                    showNotification("Spooler Unlocked", `Welcome Operator, ${currentOperator.name}! Dashboard active.`, "success");
                    logToSystemConsole(`AUTH: Operator Session validated in DB for shop: ${currentOperator.shop}.`, "success");
                    
                    document.getElementById("login-email").value = "";
                    document.getElementById("login-password").value = "";
                    
                    setView("view-operator");
                    renderUI();
                }
            } else {
                showNotification("Access Denied", data.message || "Invalid email address or secure password.", "danger");
            }
        })
        .catch(err => {
            console.error(err);
            showNotification("Connection Failure", "Could not connect to database auth server.", "danger");
        });
    };

    // STUDENT SIGN UP SUBMISSION
    document.getElementById("btn-submit-signup-student").onclick = (e) => {
        e.preventDefault();
        const name = document.getElementById("student-name").value.trim();
        const sid = document.getElementById("student-id").value.trim();
        const email = document.getElementById("student-email").value.trim();
        const dept = document.getElementById("student-dept").value.trim();
        const pass = document.getElementById("student-password").value;

        if (!name || !sid || !email || !dept || !pass) {
            showNotification("Fields Required", "All signup form fields must be completed.", "danger");
            return;
        }

        const formData = new FormData();
        formData.append('role', 'student');
        formData.append('name', name);
        formData.append('email', email);
        formData.append('password', pass);
        formData.append('student_id', sid);
        formData.append('dept', dept);

        fetch('register.php', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showNotification("Account Created", data.message, "success");
                logToSystemConsole(`AUTH: Registered new Student account in DB: ${name} (ID: ${sid}).`, "success");
                
                // Reset inputs
                document.getElementById("student-name").value = "";
                document.getElementById("student-id").value = "";
                document.getElementById("student-email").value = "";
                document.getElementById("student-dept").value = "";
                document.getElementById("student-password").value = "";

                // Send to login tab
                setAuthViewMode("student", "login");
                document.getElementById("login-email").value = email;
            } else {
                showNotification("Registration Failed", data.message || "Failed to register account.", "danger");
            }
        })
        .catch(err => {
            console.error(err);
            showNotification("Connection Failure", "Could not connect to database registration server.", "danger");
        });
    };

    // OPERATOR SIGN UP SUBMISSION
    document.getElementById("btn-submit-signup-operator").onclick = (e) => {
        e.preventDefault();
        const shop = document.getElementById("operator-shop").value.trim();
        const name = document.getElementById("operator-name").value.trim();
        const email = document.getElementById("operator-email").value.trim();
        const pass = document.getElementById("operator-password").value;

        if (!shop || !name || !email || !pass) {
            showNotification("Fields Required", "All signup form fields must be completed.", "danger");
            return;
        }

        const formData = new FormData();
        formData.append('role', 'operator');
        formData.append('name', name);
        formData.append('email', email);
        formData.append('password', pass);
        formData.append('shop_name', shop);

        fetch('register.php', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showNotification("Shop Onboarded", data.message, "success");
                logToSystemConsole(`AUTH: Registered new Operator shop account in DB: ${shop} (Owner: ${name}).`, "success");

                // Reset inputs
                document.getElementById("operator-shop").value = "";
                document.getElementById("operator-name").value = "";
                document.getElementById("operator-email").value = "";
                document.getElementById("operator-password").value = "";

                // Send to login tab
                setAuthViewMode("operator", "login");
                document.getElementById("login-email").value = email;
            } else {
                showNotification("Registration Failed", data.message || "Failed to onboard shop.", "danger");
            }
        })
        .catch(err => {
            console.error(err);
            showNotification("Connection Failure", "Could not connect to database registration server.", "danger");
        });
    };

    // LOG OUT SESSION LISTENER
    function logoutSession() {
        logToSystemConsole(`AUTH: Session destroyed for ${currentUser ? currentUser.name : currentOperator.name}.`, "warning");
        currentUser = null;
        currentOperator = null;
        activePrinter = null;
        localStorage.removeItem("ucps_current_user");
        localStorage.removeItem("ucps_current_operator");
        localStorage.removeItem("ucps_active_printer");
        updateSessionBadge();
        
        // Reset pairing panels
        document.getElementById("panel-paired").classList.add("hidden");
        document.getElementById("panel-unpaired").classList.remove("hidden");
        // Keep card-upload enabled so users can upload files to drive even if unpaired
        resetUploadForm();

        // Clear and reset drive GUI
        document.getElementById("drive-empty").classList.remove("hidden");
        document.getElementById("drive-list-container").classList.add("hidden");

        // Close profile modal if open
        const pModal = document.getElementById("profile-settings-modal");
        if (pModal) {
            pModal.classList.add("hidden");
        }

        showNotification("Logged Out", "Session ended. Profiles cleared.", "info");
        setView("view-landing");
    }

    document.getElementById("btn-logout").onclick = logoutSession;

    const btnModalLogout = document.getElementById("btn-modal-logout");
    if (btnModalLogout) {
        btnModalLogout.onclick = logoutSession;
    }


    // QR Scanning implementation using html5-qrcode
    function startQrScanner(onSuccessCallback) {
        const modal = document.getElementById("qr-scanner-modal");
        if (modal) modal.classList.remove("hidden");

        // Clear any previous scanner instance
        if (html5QrScanner) {
            try {
                html5QrScanner.clear();
            } catch(e) {}
        }

        // Initialize scanner using Html5Qrcode
        html5QrScanner = new Html5Qrcode("qr-reader-container");

        // Request camera
        html5QrScanner.start(
            { facingMode: "environment" },
            {
                fps: 10,
                qrbox: { width: 250, height: 250 }
            },
            (decodedText) => {
                const targetText = decodedText.trim();
                logToSystemConsole(`QR SCANNER: Decoded QR content: "${targetText}"`, "success");
                
                // Stop scanner and close modal
                stopQrScanner();
                
                // Invoke callback
                onSuccessCallback(targetText);
            },
            (errorMessage) => {
                // Silently ignore frames without decoded QR code
            }
        ).catch(err => {
            console.error("Camera access failed", err);
            showNotification("Camera Error", "Failed to access device camera. Please check permissions.", "danger");
            stopQrScanner();
        });
    }

    function stopQrScanner() {
        const modal = document.getElementById("qr-scanner-modal");
        if (modal) modal.classList.add("hidden");

        if (html5QrScanner) {
            html5QrScanner.stop().then(() => {
                html5QrScanner.clear();
                html5QrScanner = null;
                resetScannerUI();
            }).catch(err => {
                console.error("Failed to stop scanner", err);
                resetScannerUI();
            });
        } else {
            resetScannerUI();
        }
    }

    function resetScannerUI() {
        document.getElementById("qr-reader-container").innerHTML = `
            <div style="color: var(--text-muted); font-size: 12px;">
                <i class="fa-solid fa-camera-rotate" style="font-size: 2rem; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                Requesting camera feed...
            </div>
        `;
    }

    // Connect close button
    const btnCloseScanner = document.getElementById("btn-close-qr-scanner");
    if (btnCloseScanner) btnCloseScanner.onclick = stopQrScanner;

    const btnSimulateScan = document.getElementById("btn-simulate-scan");
    if (btnSimulateScan) {
        btnSimulateScan.onclick = () => {
            logToSystemConsole("USER: Opening QR scanner camera feed...", "info");
            startQrScanner((scannedId) => {
                let targetId = scannedId;
                // Support scanning full URLs or raw printer IDs
                if (targetId.includes("?")) {
                    const urlParams = new URLSearchParams(targetId.split("?")[1]);
                    if (urlParams.has("printer_id")) {
                        targetId = urlParams.get("printer_id");
                    } else if (urlParams.has("printer")) {
                        targetId = urlParams.get("printer");
                    } else if (urlParams.has("PRINTER_ID")) {
                        targetId = urlParams.get("PRINTER_ID");
                    } else if (urlParams.has("PRINTER")) {
                        targetId = urlParams.get("PRINTER");
                    }
                }
                
                targetId = targetId.trim().toUpperCase();

                const pr = printerNodes[targetId];
                if (pr) {
                    if (pr.status === "Online") {
                        pairPrinter(targetId, false);
                        showNotification("Printer Paired", `Successfully paired with ${pr.name}`, "success");
                    } else {
                        showNotification("Pairing Rejected", "The scanned printer is currently offline.", "warning");
                    }
                } else {
                    showNotification("Invalid QR Code", `Printer with ID "${targetId}" not found.`, "danger");
                }
            });
        };
    }

    // Manual pairing directory connection
    document.getElementById("btn-pair-manual").onclick = () => {
        const inputVal = document.getElementById("input-manual-printer").value.trim();
        const selectVal = document.getElementById("select-manual-printer").value;
        
        let targetId = "";
        if (inputVal) {
            targetId = inputVal;
        } else if (selectVal) {
            targetId = selectVal;
        } else {
            showNotification("Pairing Rejected", "Please enter a Printer ID or select one from the directory.", "warning");
            return;
        }
        
        if (printerNodes[targetId]) {
            if (printerNodes[targetId].status === "Online") {
                logToSystemConsole(`USER: Connecting printer manually (Printer ID: ${targetId})...`, "info");
                pairPrinter(targetId);
                // Clear input
                document.getElementById("input-manual-printer").value = "";
            } else {
                showNotification("Printer Offline", "The requested printer is currently offline.", "warning");
            }
        } else {
            showNotification("Not Found", `Printer ID "${targetId}" was not found.`, "danger");
        }
    };

    document.getElementById("select-manual-printer").onchange = (e) => {
        document.getElementById("input-manual-printer").value = e.target.value;
    };

    function pairPrinter(printerId, showToast = true) {
        activePrinter = printerNodes[printerId];
        localStorage.setItem("ucps_active_printer", JSON.stringify(activePrinter));
        
        // UI Toggle
        document.getElementById("panel-unpaired").classList.add("hidden");
        document.getElementById("panel-paired").classList.remove("hidden");
        document.getElementById("card-upload").classList.remove("disabled");
        
        document.getElementById("paired-printer-name").innerText = activePrinter.name;
        document.getElementById("paired-printer-location").innerText = activePrinter.location;

        logToSystemConsole(`SERVER: Session paired to Printer Node [${activePrinter.id}] at ${activePrinter.location}.`, "success");
        if (showToast) {
            showNotification("Printer Paired", `Paired successfully with ${activePrinter.name}.`, "success");
        }
        updateSubmitButtonState();
        renderUI();
    }

    // Unpair logic
    document.getElementById("btn-unpair").onclick = () => {
        activePrinter = null;
        localStorage.removeItem("ucps_active_printer");
        document.getElementById("panel-paired").classList.add("hidden");
        document.getElementById("panel-unpaired").classList.remove("hidden");
        
        logToSystemConsole("USER: Session unpaired from printer node.", "info");
        showNotification("Printer Disconnected", "Session association has been cleared.", "warning");
        updateSubmitButtonState();
        renderUI();
    };

    // Drag-and-drop / Browser upload simulation
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const btnSubmit = document.getElementById("btn-submit-print");

    dropZone.onclick = () => fileInput.click();

    dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    };

    dropZone.ondragleave = () => {
        dropZone.classList.remove("dragover");
    };

    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    };

    fileInput.onchange = () => {
        if (fileInput.files.length > 0) {
            handleFileUpload(fileInput.files[0]);
        }
    };

    function handleFileUpload(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        const allowedExtensions = ["pdf", "png", "jpg", "jpeg"];

        logToSystemConsole(`SECURITY GATEWAY: Inspecting uploaded file '${file.name}'...`, "info");

        // Verify Extension (Simulated)
        if (!allowedExtensions.includes(ext)) {
            logToSystemConsole(`SECURITY BLOCK: Upload rejected. Extension '.${ext}' is unauthorized.`, "danger");
            showNotification("Extension Blocked", `Policy Violation: Executable/Script formats (.${ext}) are prohibited!`, "danger");
            resetUploadForm();
            return;
        }

        // Simulate upload file progress
        fileUploaded = file;
        
        // Dynamic cost calculation based on file size
        calculatedPages = Math.max(1, Math.ceil(file.size / (350 * 1024))); // Est 350KB per page
        
        document.getElementById("upload-file-details").classList.remove("hidden");
        document.getElementById("upload-file-name").innerText = file.name;
        document.getElementById("upload-file-size").innerText = (file.size / (1024 * 1024)).toFixed(2) + " MB";
        
        // Calculate simple base B&W rate for the upload card display
        calculatedCost = calculatedPages * 5.00;
        document.getElementById("calc-pages").innerText = `${calculatedPages} page(s)`;
        document.getElementById("calc-total-cost").innerText = `${calculatedCost.toFixed(2)} BDT`;

        let progress = 0;
        const progressEl = document.getElementById("upload-progress");
        const statusText = document.getElementById("upload-status-text");
        
        uploadInProgress = true;
        btnSubmit.disabled = true;

        const interval = setInterval(() => {
            progress += 20;
            progressEl.style.width = progress + "%";
            statusText.innerHTML = `Uploading: <span class="highlight-text">${progress}%</span>`;
            
            if (progress >= 100) {
                clearInterval(interval);
                uploadInProgress = false;
                statusText.innerHTML = `File ready for dispatch! <span class="text-teal"><i class="fa-solid fa-check"></i></span>`;
                updateSubmitButtonState();
                logToSystemConsole(`MIME SNIFFER: Binary check confirmed correct content-type (application/${ext === 'pdf' ? 'pdf' : 'image'}).`, "success");
            }
        }, 150);
    }

    function updateSubmitButtonState() {
        if (!btnSubmit) return;
        if (fileUploaded && activePrinter && !uploadInProgress) {
            btnSubmit.disabled = false;
            btnSubmit.style.opacity = "1";
            btnSubmit.style.cursor = "pointer";
        } else {
            btnSubmit.disabled = true;
            btnSubmit.style.opacity = "0.6";
            btnSubmit.style.cursor = "not-allowed";
        }

        const btnSaveDrive = document.getElementById("btn-save-to-drive");
        if (btnSaveDrive) {
            if (fileUploaded && !uploadInProgress) {
                btnSaveDrive.disabled = false;
                btnSaveDrive.style.opacity = "1";
                btnSaveDrive.style.cursor = "pointer";
            } else {
                btnSaveDrive.disabled = true;
                btnSaveDrive.style.opacity = "0.6";
                btnSaveDrive.style.cursor = "not-allowed";
            }
        }
    }

    function resetUploadForm() {
        fileUploaded = null;
        if (fileInput) fileInput.value = "";
        document.getElementById("upload-file-details").classList.add("hidden");
        document.getElementById("upload-progress").style.width = "0%";
        document.getElementById("upload-status-text").innerHTML = `Drag & drop your file here, or <span class="highlight-text">browse files</span>`;
        document.getElementById("upload-icon-display").className = "fa-solid fa-file-pdf upload-icon";
        updateSubmitButtonState();
        const rcptSaveBtn = document.getElementById("btn-save-to-drive");
        if (rcptSaveBtn) rcptSaveBtn.disabled = !currentUser;
    }

    btnSubmit.onclick = () => {
        if (!fileUploaded) return;
        if (!activePrinter) {
            showNotification("Pairing Required", "Please connect to a printer first in Step 1.", "warning");
            document.getElementById("card-pairing").scrollIntoView({ behavior: "smooth" });
            return;
        }

        // Reset option defaults inside the checkout modal
        document.getElementById("print-copies").value = 1;
        document.getElementById("print-color").value = "monochrome";
        document.getElementById("print-size").value = "A4";
        document.getElementById("print-range-select").value = "all";
        document.getElementById("print-range").value = "all";
        document.getElementById("print-range").classList.add("hidden");
        
        updateCheckoutPrice();

        // Open checkout dialog overlay
        const chkModal = document.getElementById("checkout-choice-modal");
        chkModal.classList.remove("hidden");
        document.getElementById("checkout-filename").innerText = fileUploaded.name;

        // Live Document Preview
        const previewBox = document.getElementById("checkout-preview-box");
        if (previewBox) {
            const ext = fileUploaded.name.split('.').pop().toLowerCase();
            if (ext === "pdf" && typeof pdfjsLib !== 'undefined') {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const arr = new Uint8Array(e.target.result);
                    initInteractivePDFPreview(arr, previewBox, (totalPages) => {
                        calculatedPages = totalPages;
                        updateCheckoutPrice();
                    });
                };
                reader.readAsArrayBuffer(fileUploaded);
            } else {
                const fileURL = URL.createObjectURL(fileUploaded);
                calculatedPages = 1;
                previewBox.innerHTML = `<img src="${fileURL}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:4px;">`;
                updateCheckoutPrice();
            }
        }
    };

    // Save File to Cloud Drive
    document.getElementById("btn-save-to-drive").onclick = () => {
        if (!fileUploaded || !currentUser) {
            showNotification("Access Denied", "Please sign in to save files to your drive.", "warning");
            return;
        }

        const formData = new FormData();
        formData.append('print_file', fileUploaded);
        formData.append('user_id', currentUser.id);

        document.getElementById("btn-save-to-drive").disabled = true;

        fetch('upload_to_drive.php', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showNotification("Saved successfully", "File saved to your Cloud Drive.", "success");
                logToSystemConsole(`DRIVE: Saved file '${fileUploaded.name}' to user drive.`, "success");
                resetUploadForm();
                loadUserDriveDocuments();
            } else {
                showNotification("Failed to Save", data.message || "Failed to save file.", "danger");
            }
        })
        .catch(err => {
            console.error(err);
            showNotification("Connection Failure", "Could not connect to document drive server.", "danger");
        })
        .finally(() => {
            updateSubmitButtonState();
        });
    };

    function loadUserDriveDocuments() {
        if (!currentUser) return;

        fetch(`get_documents.php?user_id=${currentUser.id}`)
        .then(response => response.json())
        .then(data => {
            const emptyState = document.getElementById("drive-empty");
            const listContainer = document.getElementById("drive-list-container");
            
            console.log("DRIVE: loadUserDriveDocuments API Response:", data);
            
            if (data.status === 'success' && data.documents && data.documents.length > 0) {
                window.driveDocuments = data.documents;
                emptyState.classList.add("hidden");
                listContainer.classList.remove("hidden");
                listContainer.innerHTML = "";

                data.documents.forEach(doc => {
                    const uploadedDate = new Date(doc.uploaded_at).toLocaleDateString();
                    const isPdf = doc.file_format === 'PDF';
                    const filename = doc.original_filename || "Saved Document";

                    listContainer.innerHTML += `
                        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; margin-bottom: 8px; text-align: left;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                <i class="fa-solid ${isPdf ? 'fa-file-pdf text-danger' : 'fa-file-image text-teal'}" style="font-size: 1.2rem;"></i>
                                <span style="font-weight: 700; color: #ffffff; font-size: 13px; word-break: break-all;">${filename}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
                                <span style="font-size: 11px; color: #94a3b8;">Uploaded: ${uploadedDate}</span>
                                <div style="display: flex; gap: 6px;">
                                    <button class="btn-preview-doc secondary-action-btn-small" data-doc-id="${doc.doc_id}" data-doc-name="${filename}" style="margin: 0; width: auto; padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--border-color); cursor: pointer;">
                                        <i class="fa-solid fa-eye"></i> View
                                    </button>
                                    <button class="btn-rename-doc secondary-action-btn-small" data-doc-id="${doc.doc_id}" data-doc-name="${filename}" style="margin: 0; width: auto; padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--border-color); cursor: pointer;">
                                        <i class="fa-solid fa-pen"></i> Rename
                                    </button>
                                    <button class="btn-delete-doc secondary-action-btn-small" data-doc-id="${doc.doc_id}" data-doc-name="${filename}" style="margin: 0; width: auto; padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; background: rgba(244, 63, 94, 0.08); color: var(--color-danger); border: 1px solid rgba(244, 63, 94, 0.15); cursor: pointer;">
                                        <i class="fa-solid fa-trash"></i> Delete
                                    </button>
                                    <button class="btn-print-doc secondary-action-btn-small" data-doc-id="${doc.doc_id}" data-doc-name="${filename}" style="margin: 0; width: auto; padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: bold; background: var(--color-primary); color: #0b0f19; border: none; cursor: pointer;">
                                        <i class="fa-solid fa-print"></i> Print
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                });

                // Attach click listeners to view buttons
                document.querySelectorAll(".btn-preview-doc").forEach(btn => {
                    btn.onclick = (e) => {
                        const docId = btn.getAttribute("data-doc-id");
                        const docName = btn.getAttribute("data-doc-name");
                        triggerPreviewDocument(docId, docName);
                    };
                });

                // Attach click listeners to rename buttons
                document.querySelectorAll(".btn-rename-doc").forEach(btn => {
                    btn.onclick = (e) => {
                        const docId = btn.getAttribute("data-doc-id");
                        const docName = btn.getAttribute("data-doc-name");
                        triggerRenameDocument(docId, docName);
                    };
                });

                // Attach click listeners to delete buttons
                document.querySelectorAll(".btn-delete-doc").forEach(btn => {
                    btn.onclick = (e) => {
                        const docId = btn.getAttribute("data-doc-id");
                        const docName = btn.getAttribute("data-doc-name");
                        triggerDeleteDocument(docId, docName);
                    };
                });

                // Attach click listeners to print buttons
                document.querySelectorAll(".btn-print-doc").forEach(btn => {
                    btn.onclick = (e) => {
                        const docId = btn.getAttribute("data-doc-id");
                        const docName = btn.getAttribute("data-doc-name");
                        triggerPrintFromDrive(docId, docName);
                    };
                });
            } else {
                emptyState.classList.remove("hidden");
                listContainer.classList.add("hidden");
            }
        })
        .catch(err => console.error("Error loading drive documents:", err));
    }

    function triggerPreviewDocument(docId, name) {
        console.log("PREVIEW: Starting preview for docId:", docId, "name:", name);
        const previewModal = document.getElementById("preview-modal");
        const title = document.getElementById("preview-modal-title");
        const body = document.getElementById("preview-modal-body");
        
        title.innerText = `Preview: ${name}`;
        body.innerHTML = `<div style="color:var(--text-muted); font-size:12px; padding:20px; text-align:center;"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem; margin-bottom:10px; display:block; color:var(--color-primary);"></i>Loading preview...</div>`;
        
        previewModal.classList.remove("hidden");
        
        console.log("PREVIEW: Modal display state:", window.getComputedStyle(previewModal).display);
        console.log("PREVIEW: Modal z-index:", window.getComputedStyle(previewModal).zIndex);
        console.log("PREVIEW: Modal dimensions:", previewModal.offsetWidth, "x", previewModal.offsetHeight);

        const ext = name.split('.').pop().toLowerCase();
        console.log("PREVIEW: File extension detected:", ext);
        
        if (ext === 'pdf') {
            if (typeof pdfjsLib === 'undefined') {
                console.warn("PREVIEW: pdfjsLib is undefined! Falling back to iframe view.");
                body.innerHTML = `<iframe src="view_file.php?doc_id=${docId}&user_id=${currentUser.id}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:4px;"></iframe>`;
                return;
            }

            console.log("PREVIEW: pdfjsLib is available. Fetching base64 data...");
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

            fetch(`view_file_base64.php?doc_id=${docId}&user_id=${currentUser.id}`)
            .then(res => {
                console.log("PREVIEW: HTTP Fetch status:", res.status);
                return res.json();
            })
            .then(data => {
                console.log("PREVIEW: JSON response received. Status:", data.status);
                if (data.status !== 'success') {
                    body.innerHTML = `<div style="color:var(--text-muted); font-size:12px; padding:20px; text-align:center;">Failed to load preview: ${data.message}</div>`;
                    return;
                }

                console.log("PREVIEW: Decoding base64 data string...");
                try {
                    const raw = window.atob(data.pdf_base64);
                    const rawLength = raw.length;
                    const array = new Uint8Array(new ArrayBuffer(rawLength));
                    for(let i = 0; i < rawLength; i++) {
                        array[i] = raw.charCodeAt(i);
                    }

                    console.log("PREVIEW: Initializing pdfjsLib getDocument promise...");
                    pdfjsLib.getDocument({data: array}).promise.then(pdf => {
                        console.log("PREVIEW: PDF loaded successfully. Total pages:", pdf.numPages);
                        let currentPage = 1;
                        const totalPages = pdf.numPages;

                        function renderPage(pageNum) {
                            console.log("PREVIEW: Rendering page number:", pageNum);
                            body.innerHTML = `<div style="color:var(--text-muted); font-size:11px; text-align:center; padding:10px;"><i class="fa-solid fa-spinner fa-spin"></i> Rendering page ${pageNum}...</div>`;
                            
                            pdf.getPage(pageNum).then(page => {
                                 console.log("PREVIEW: getPage success for page:", pageNum);
                                 const canvas = document.createElement('canvas');
                                 const context = canvas.getContext('2d');
                                 
                                 const viewport = page.getViewport({ scale: 2.0 }); // High definition scale
 
                                 canvas.height = viewport.height;
                                 canvas.width = viewport.width;
                                 canvas.style.maxWidth = "100%";
                                 canvas.style.height = "auto";
                                 canvas.style.display = "block";
                                 canvas.style.boxShadow = "0 10px 35px rgba(0,0,0,0.6)";
                                 canvas.style.borderRadius = "6px";
                                 canvas.style.background = "#ffffff";
 
                                 body.innerHTML = '';
                                 
                                 const scrollDiv = document.createElement('div');
                                 scrollDiv.style.width = "100%";
                                 scrollDiv.style.height = "calc(100% - 40px)";
                                 scrollDiv.style.overflowY = "auto";
                                 scrollDiv.style.display = "flex";
                                 scrollDiv.style.justifyContent = "center";
                                 scrollDiv.style.alignItems = "flex-start";
                                 scrollDiv.style.background = "#0e0e11"; // Real dark viewport area
                                 scrollDiv.style.padding = "20px";
                                 scrollDiv.appendChild(canvas);
                                 body.appendChild(scrollDiv);

                                const controls = document.createElement('div');
                                controls.style.display = "flex";
                                controls.style.justifyContent = "space-between";
                                controls.style.alignItems = "center";
                                controls.style.padding = "8px 12px";
                                controls.style.background = "rgba(0,0,0,0.4)";
                                controls.style.borderTop = "1px solid var(--border-color)";
                                controls.style.height = "40px";
                                controls.style.width = "100%";
                                
                                controls.innerHTML = `
                                    <button id="pdf-prev" class="secondary-action-btn-small" style="width:auto; margin:0; padding:4px 10px;" ${pageNum <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Prev</button>
                                    <span style="font-size:11px; color:#ffffff;">Page ${pageNum} of ${totalPages}</span>
                                    <button id="pdf-next" class="secondary-action-btn-small" style="width:auto; margin:0; padding:4px 10px;" ${pageNum >= totalPages ? 'disabled' : ''}>Next <i class="fa-solid fa-chevron-right"></i></button>
                                `;
                                
                                body.appendChild(controls);

                                document.getElementById("pdf-prev").onclick = () => {
                                    if (currentPage > 1) {
                                        currentPage--;
                                        renderPage(currentPage);
                                    }
                                };
                                document.getElementById("pdf-next").onclick = () => {
                                    if (currentPage < totalPages) {
                                        currentPage++;
                                        renderPage(currentPage);
                                    }
                                };

                                console.log("PREVIEW: Executing page.render()...");
                                page.render({
                                    canvasContext: context,
                                    viewport: viewport
                                }).promise.then(() => {
                                    console.log("PREVIEW: page.render() completed successfully!");
                                    console.log("PREVIEW: Body dimensions:", body.offsetWidth, "x", body.offsetHeight);
                                    console.log("PREVIEW: Canvas dimensions:", canvas.offsetWidth, "x", canvas.offsetHeight);
                                }).catch(renderErr => {
                                    console.error("PREVIEW: page.render() failed:", renderErr);
                                });
                            }).catch(pageErr => {
                                console.error("PREVIEW: pdf.getPage failed:", pageErr);
                            });
                        }

                        renderPage(currentPage);

                    }).catch(pdfErr => {
                        console.error("PREVIEW: PDF.js document parsing failed:", pdfErr);
                        body.innerHTML = `<iframe src="view_file.php?doc_id=${docId}&user_id=${currentUser.id}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:4px;"></iframe>`;
                    });
                } catch (atobErr) {
                    console.error("PREVIEW: Base64 decoding failed:", atobErr);
                    body.innerHTML = `<iframe src="view_file.php?doc_id=${docId}&user_id=${currentUser.id}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:4px;"></iframe>`;
                }

            }).catch(fetchErr => {
                console.error("PREVIEW: JSON preview fetch failed, fallback to iframe:", fetchErr);
                body.innerHTML = `<iframe src="view_file.php?doc_id=${docId}&user_id=${currentUser.id}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:4px;"></iframe>`;
            });
        } else {
            // Image files (PNG, JPG) preview
            console.log("PREVIEW: Rendering as image...");
            body.innerHTML = `<div style="width:100%; height:100%; overflow:auto; display:flex; align-items:center; justify-content:center; padding:10px;"><img src="view_file.php?doc_id=${docId}&user_id=${currentUser.id}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:4px; box-shadow:0 4px 10px rgba(0,0,0,0.5);"></div>`;
        }
    }

    document.getElementById("btn-close-preview").onclick = () => {
        document.getElementById("preview-modal").classList.add("hidden");
        document.getElementById("preview-modal-body").innerHTML = "";
    };

    function triggerDeleteDocument(docId, name) {
        if (!confirm(`Are you sure you want to permanently delete '${name}'?`)) return;

        const formData = new FormData();
        formData.append("doc_id", docId);
        formData.append("user_id", currentUser.id);

        fetch("delete_document.php", {
            method: "POST",
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                showNotification("Document Deleted", "File has been removed from drive.", "success");
                logToSystemConsole(`DRIVE: Deleted document ID ${docId} ('${name}').`, "warning");
                loadUserDriveDocuments();
            } else {
                showNotification("Delete Failed", data.message || "Failed to delete file.", "danger");
            }
        })
        .catch(err => {
            console.error(err);
            showNotification("Connection Failure", "Could not connect to database server.", "danger");
        });
    }

    function triggerRenameDocument(docId, oldName) {
        const newName = prompt("Enter a new name for your file:", oldName);
        if (newName === null) return; // Cancelled
        
        const cleanName = newName.trim();
        if (!cleanName) {
            showNotification("Invalid Name", "Filename cannot be empty.", "warning");
            return;
        }

        const formData = new FormData();
        formData.append("doc_id", docId);
        formData.append("user_id", currentUser.id);
        formData.append("new_name", cleanName);

        fetch("rename_document.php", {
            method: "POST",
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                showNotification("Document Renamed", `File renamed to: ${data.new_name}`, "success");
                logToSystemConsole(`DRIVE: Renamed document ID ${docId} to ${data.new_name}.`, "success");
                loadUserDriveDocuments();
            } else {
                showNotification("Rename Failed", data.message || "Failed to rename document.", "danger");
            }
        })
        .catch(err => {
            console.error(err);
            showNotification("Connection Failure", "Could not connect to database server.", "danger");
        });
    }

    function triggerPrintFromDrive(docId, docName) {
        if (!activePrinter) {
            showNotification("Pairing Required", "Please connect to a printer first in Step 1.", "warning");
            document.getElementById("card-pairing").scrollIntoView({ behavior: "smooth" });
            return;
        }

        currentPrintingDocId = docId;
        
        // Find document in cached list to resolve page count
        const docObj = (window.driveDocuments || []).find(d => d.doc_id == docId);
        if (docObj) {
            calculatedPages = Math.max(1, Math.ceil(docObj.file_size / (350 * 1024)));
        } else {
            calculatedPages = 1;
        }

        // Reset option defaults inside the checkout modal
        document.getElementById("print-copies").value = 1;
        document.getElementById("print-color").value = "monochrome";
        document.getElementById("print-size").value = "A4";
        document.getElementById("print-range-select").value = "all";
        document.getElementById("print-range").value = "all";
        document.getElementById("print-range").classList.add("hidden");
        
        updateCheckoutPrice();

        // Open checkout choice modal
        const chkModal = document.getElementById("checkout-choice-modal");
        chkModal.classList.remove("hidden");
        document.getElementById("checkout-filename").innerText = docName || "Cloud Saved File";

        const previewBox = document.getElementById("checkout-preview-box");
        if (previewBox) {
            const ext = (docName || "").split('.').pop().toLowerCase();
            if (ext === 'pdf' && typeof pdfjsLib !== 'undefined') {
                previewBox.innerHTML = `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;color:var(--text-muted);font-size:11px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem;color:var(--color-primary);margin-bottom:8px;"></i>Loading preview...</div>`;

                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                fetch(`view_file_base64.php?doc_id=${docId}&user_id=${currentUser.id}`)
                .then(r => r.json())
                .then(data => {
                    if (data.status !== 'success') {
                        previewBox.innerHTML = `<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:20px;"><i class="fa-solid fa-file-pdf" style="font-size:2.5rem;color:var(--color-danger);display:block;margin-bottom:8px;"></i>${docName}</div>`;
                        return;
                    }
                    const raw = window.atob(data.pdf_base64);
                    const arr = new Uint8Array(raw.length);
                    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);

                    initInteractivePDFPreview(arr, previewBox, (totalPages) => {
                        calculatedPages = totalPages;
                        updateCheckoutPrice();
                    });
                }).catch(() => {
                    previewBox.innerHTML = `<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:20px;"><i class="fa-solid fa-file-pdf" style="font-size:2.5rem;color:var(--color-danger);display:block;margin-bottom:8px;"></i>${docName}</div>`;
                });
            } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
                previewBox.innerHTML = `<img src="view_file.php?doc_id=${docId}&user_id=${currentUser.id}" style="width:100%;height:100%;object-fit:contain;border-radius:4px;">`;
            } else {
                previewBox.innerHTML = `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;color:var(--text-muted);"><i class="fa-solid fa-cloud-arrow-down" style="font-size:3.5rem;color:var(--color-primary);margin-bottom:10px;"></i><span>Printing Saved File</span></div>`;
            }
        }
    }

    // Checkout Choice Actions
    document.getElementById("btn-cancel-checkout").onclick = () => {
        document.getElementById("checkout-choice-modal").classList.add("hidden");
        currentPrintingDocId = null; // Clear if cancelled
    };

    document.getElementById("btn-pay-cash").onclick = () => {
        document.getElementById("checkout-choice-modal").classList.add("hidden");
        submitJobToQueue("Pending Cash");
    };

    document.getElementById("btn-close-receipt").onclick = () => {
        document.getElementById("order-receipt-modal").classList.add("hidden");
    };

    document.getElementById("btn-close-qr-modal").onclick = () => {
        document.getElementById("printer-qr-modal").classList.add("hidden");
    };

    let bkashSuccessCallback = null;
    function openBkashPortal(amount, callback) {
        bkashSuccessCallback = callback;
        const bkModal = document.getElementById("bkash-gateway-modal");
        if (bkModal) bkModal.classList.remove("hidden");
        const amtEl = document.getElementById("bkash-modal-amount");
        if (amtEl) amtEl.innerText = `${amount.toFixed(2)} BDT`;
        bkashStepReset();
    }

    document.getElementById("btn-pay-bkash").onclick = () => {
        document.getElementById("checkout-choice-modal").classList.add("hidden");
        openBkashPortal(calculatedCost, () => submitJobToQueue("bKash_Paid"));
    };

    // bKash Checkout Simulator Steps
    let bkashStep = 1;
    function bkashStepReset() {
        bkashStep = 1;
        document.getElementById("bkash-wallet-number").value = "";
        document.getElementById("bkash-otp-code").value = "";
        document.getElementById("bkash-pin").value = "";
        
        document.getElementById("bkash-step-wallet").classList.remove("hidden");
        document.getElementById("bkash-step-otp").classList.add("hidden");
        document.getElementById("bkash-step-pin").classList.add("hidden");
        document.getElementById("btn-bkash-confirm").innerText = "CONFIRM";
    }

    document.getElementById("btn-bkash-close").onclick = () => {
        document.getElementById("bkash-gateway-modal").classList.add("hidden");
        showNotification("bKash Cancelled", "Payment session aborted by user.", "warning");
    };

    document.getElementById("btn-bkash-confirm").onclick = () => {
        const btn = document.getElementById("btn-bkash-confirm");

        if (bkashStep === 1) {
            const wallet = document.getElementById("bkash-wallet-number").value;
            if (wallet.length !== 11 || isNaN(wallet)) {
                showNotification("Invalid Wallet", "Please enter a valid 11-digit bKash account number.", "danger");
                return;
            }
            btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Requesting OTP...`;
            btn.disabled = true;
            
            setTimeout(() => {
                bkashStep = 2;
                document.getElementById("bkash-step-wallet").classList.add("hidden");
                document.getElementById("bkash-step-otp").classList.remove("hidden");
                btn.innerText = "VERIFY OTP";
                btn.disabled = false;
                logToSystemConsole("BKASH GATEWAY: Tokenized payment initialized. Sent OTP challenge.", "info");
                // Scroll input into view on mobile
                setTimeout(() => { document.getElementById("bkash-otp-code").focus(); }, 100);
            }, 1000);

        } else if (bkashStep === 2) {
            const otp = document.getElementById("bkash-otp-code").value;
            if (otp.length !== 6 || isNaN(otp)) {
                showNotification("Invalid OTP", "Please enter the 6-digit verification code.", "danger");
                return;
            }
            btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Validating Code...`;
            btn.disabled = true;
            
            setTimeout(() => {
                bkashStep = 3;
                document.getElementById("bkash-step-otp").classList.add("hidden");
                document.getElementById("bkash-step-pin").classList.remove("hidden");
                btn.innerText = "CONFIRM PAYMENT";
                btn.disabled = false;
                logToSystemConsole("BKASH GATEWAY: OTP code validated successfully. Requesting PIN challenge.", "info");
                // Scroll input into view on mobile
                setTimeout(() => { document.getElementById("bkash-pin").focus(); }, 100);
            }, 1000);

        } else if (bkashStep === 3) {
            const pin = document.getElementById("bkash-pin").value;
            if (pin.length !== 5 || isNaN(pin)) {
                showNotification("Invalid PIN", "Please enter your 5-digit security PIN.", "danger");
                return;
            }
            btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Settling Transaction...`;
            btn.disabled = true;
            
            setTimeout(() => {
                // Settle payment
                document.getElementById("bkash-gateway-modal").classList.add("hidden");
                logToSystemConsole("BKASH API: Transaction cleared. Tokenized response code 200.", "success");
                if (bkashSuccessCallback) {
                    bkashSuccessCallback();
                    bkashSuccessCallback = null;
                } else {
                    submitJobToQueue("bKash_Paid");
                }
            }, 1500);
        }
    };

    function submitJobToQueue(paymentStatus) {
        if (currentPrintingDocId) {
            if (!activePrinter || !currentUser) return;
            const method = (paymentStatus === "bKash_Paid") ? "bKash" : "Cash";

            const formData = new FormData();
            formData.append("doc_id", currentPrintingDocId);
            formData.append("printer_id", activePrinter.id);
            formData.append("user_id", currentUser.id);
            formData.append("payment_method", method);
            
            // Append print options
            formData.append("page_size", document.getElementById("print-size").value);
            formData.append("page_range", document.getElementById("print-range").value);
            formData.append("copies", document.getElementById("print-copies").value);
            formData.append("print_color", document.getElementById("print-color").value);

            showNotification("Submitting", "Submitting print job from Cloud Drive...", "info");

            fetch("print_existing_doc.php", {
                method: "POST",
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === "success") {
                    const jobUuid = data.data.job_id;
                    logToSystemConsole(`DRIVE PRINT: Secured print job ${jobUuid} from saved file.`, "success");
                    showNotification("Document Queued", `Job ${jobUuid} inserted in database.`, "success");

                    document.getElementById("receipt-job-id").innerText = jobUuid;
                    document.getElementById("receipt-filename").innerText = data.data.filename;
                    document.getElementById("receipt-printer").innerText = data.data.printer;
                    
                    const copies = document.getElementById("print-copies").value;
                    document.getElementById("receipt-cost").innerText = `${calculatedPages} page(s) × ${copies} copy(ies) / ${calculatedCost.toFixed(2)} BDT`;

                    const rcptPreviewBox = document.getElementById("receipt-preview-box");
                    if (rcptPreviewBox) {
                        rcptPreviewBox.innerHTML = `
                            <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; color:var(--text-muted);">
                                <i class="fa-solid fa-print" style="font-size:3rem; color:var(--color-primary); margin-bottom:10px;"></i>
                                <span>Spooling Drive File</span>
                            </div>
                        `;
                    }

                    const rcptPay = document.getElementById("receipt-payment");
                    const rcptStat = document.getElementById("receipt-status");
                    
                    if (method === "Cash") {
                        rcptPay.innerText = "Cash at Counter";
                        rcptStat.innerText = "Awaiting Cash";
                        rcptStat.className = "status-pill pending";
                    } else {
                        rcptPay.innerText = "bKash Wallet";
                        rcptStat.innerText = "Spooling (Paid)";
                        rcptStat.className = "status-pill completed";
                    }
                    
                    document.getElementById("order-receipt-modal").classList.remove("hidden");
                    syncDatabase();
                } else {
                    showNotification("Submission Failed", data.message || "Failed to print document.", "danger");
                }
            })
            .catch(err => {
                console.error(err);
                showNotification("Connection Failure", "Could not connect to database print server.", "danger");
            })
            .finally(() => {
                currentPrintingDocId = null;
            });

            return;
        }

        if (!fileUploaded || !activePrinter) return;

        if (isRealMode) {
            // Real Database Mode: perform AJAX upload to upload.php
            const formData = new FormData();
            formData.append("print_file", fileUploaded);
            formData.append("printer_id", activePrinter.id);
            // payment_method can be bKash or Cash
            const method = (paymentStatus === "bKash_Paid") ? "bKash" : "Cash";
            formData.append("payment_method", method);
            
            // Append print options
            formData.append("page_size", document.getElementById("print-size").value);
            formData.append("page_range", document.getElementById("print-range").value);
            formData.append("copies", document.getElementById("print-copies").value);
            formData.append("print_color", document.getElementById("print-color").value);
            
            // Show loading notification/indicator
            showNotification("Uploading", "Uploading file to cloud print queue...", "info");
            
            fetch("upload.php", {
                method: "POST",
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === "success") {
                    const jobUuid = data.data.job_id;
                    
                    logToSystemConsole(`UPLOAD HANDLER: Secured print job ${jobUuid}. Saved to secure spooler buffer.`, "success");
                    showNotification("Document Queued", `Job ${jobUuid} inserted in database.`, "success");

                    // Show receipt modal with real server data
                    document.getElementById("receipt-job-id").innerText = jobUuid;
                    document.getElementById("receipt-filename").innerText = fileUploaded.name;
                    document.getElementById("receipt-printer").innerText = activePrinter.name;
                    document.getElementById("receipt-cost").innerText = `${calculatedPages} page(s) / ${calculatedCost.toFixed(2)} BDT`;
                    
                    // Receipt Document Live Preview
                    const rcptPreviewBox = document.getElementById("receipt-preview-box");
                    if (rcptPreviewBox) {
                        const ext = fileUploaded.name.split('.').pop().toLowerCase();
                        const fileURL = URL.createObjectURL(fileUploaded);
                        if (ext === "pdf") {
                            rcptPreviewBox.innerHTML = `<iframe src="${fileURL}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:4px;"></iframe>`;
                        } else {
                            rcptPreviewBox.innerHTML = `<img src="${fileURL}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:4px;">`;
                        }
                    }

                    const rcptPay = document.getElementById("receipt-payment");
                    const rcptStat = document.getElementById("receipt-status");
                    
                    if (method === "Cash") {
                        rcptPay.innerText = "Cash at Counter";
                        rcptStat.innerText = "Awaiting Cash";
                        rcptStat.className = "status-pill pending";
                    } else {
                        rcptPay.innerText = "bKash Wallet";
                        rcptStat.innerText = "Spooling (Paid)";
                        rcptStat.className = "status-pill completed";
                    }
                    
                    document.getElementById("order-receipt-modal").classList.remove("hidden");
                    resetUploadForm();
                    syncDatabase(); // Refresh local queue instantly from DB
                } else {
                    showNotification("Upload Failed", data.message || "Unknown error", "danger");
                }
            })
            .catch(err => {
                showNotification("Network Error", "Could not connect to printer upload API: " + err, "danger");
            });
            
            return;
        }

        const secureName = generateSecureHash(fileUploaded.name);
        const format = fileUploaded.name.split('.').pop().toUpperCase();
        
        const newJob = {
            job_id: `UCPS-${jobCounter++}`,
            user_id: currentUser ? currentUser.name : "Wahidur Rahman",
            printer_id: activePrinter.id,
            printer_name: activePrinter.name,
            filename: fileUploaded.name,
            secure_filename: secureName,
            format: format,
            price: calculatedCost,
            payment_status: paymentStatus, // "Pending Cash", "bKash_Paid", "Cash_Approved"
            status: "Pending",
            timestamp: new Date().toLocaleTimeString()
        };

        // Add to global memory queue
        printQueue.push(newJob);

        if (paymentStatus === "Pending Cash") {
            logToSystemConsole(`UPLOAD HANDLER: Secured print job ${newJob.job_id}. Cash payment required at print shop.`, "warning");
            showNotification("Order Queued", `Job ${newJob.job_id} queued. Awaiting Cash Payment at shop.`, "warning");
        } else {
            logToSystemConsole(`UPLOAD HANDLER: Secured print job ${newJob.job_id}. Saved to secure spooler buffer.`, "success");
            showNotification("Document Queued", `Job ${newJob.job_id} inserted in queue (FIFO position: ${printQueue.length}).`, "success");
        }

        // --- POPULATE AND TRIGGER THE ORDER RECEIPT MODAL ---
        document.getElementById("receipt-job-id").innerText = newJob.job_id;
        document.getElementById("receipt-filename").innerText = newJob.filename;
        document.getElementById("receipt-printer").innerText = newJob.printer_name;
        document.getElementById("receipt-cost").innerText = `${calculatedPages} page(s) / ${calculatedCost.toFixed(2)} BDT`;
        
        // Receipt Document Live Preview
        const rcptPreviewBox = document.getElementById("receipt-preview-box");
        if (rcptPreviewBox) {
            const ext = fileUploaded.name.split('.').pop().toLowerCase();
            const fileURL = URL.createObjectURL(fileUploaded);
            if (ext === "pdf") {
                rcptPreviewBox.innerHTML = `<iframe src="${fileURL}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:4px;"></iframe>`;
            } else {
                rcptPreviewBox.innerHTML = `<img src="${fileURL}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:4px;">`;
            }
        }

        const rcptPay = document.getElementById("receipt-payment");
        const rcptStat = document.getElementById("receipt-status");
        
        if (paymentStatus === "Pending Cash") {
            rcptPay.innerText = "Cash at Counter";
            rcptStat.innerText = "Awaiting Cash";
            rcptStat.className = "status-pill pending";
        } else {
            rcptPay.innerText = "bKash Wallet";
            rcptStat.innerText = "Spooling (Paid)";
            rcptStat.className = "status-pill completed";
        }

        // Show modal
        document.getElementById("order-receipt-modal").classList.remove("hidden");

        resetUploadForm();
        renderUI();
    }

    // Toggle Queue Worker state
    const btnToggleWorker = document.getElementById("btn-toggle-worker");
    const workerLight = document.getElementById("worker-light");
    const workerTitle = document.getElementById("worker-status-title");
    const workerDesc = document.getElementById("worker-status-desc");

    if (btnToggleWorker) {
        btnToggleWorker.onclick = () => {
            workerRunning = !workerRunning;
            if (workerRunning) {
                btnToggleWorker.innerHTML = `<i class="fa-solid fa-pause"></i> Pause Queue Worker`;
                workerLight.classList.remove("paused");
                workerTitle.innerText = "Queue Worker: RUNNING";
                workerDesc.innerText = "FIFO Scheduler polling active every 3 seconds.";
                logToSystemConsole("OPERATOR: Restarted queue worker polling daemon.", "success");
                showNotification("Daemon Active", "Background worker restarted.", "success");
            } else {
                btnToggleWorker.innerHTML = `<i class="fa-solid fa-play"></i> Resume Queue Worker`;
                workerLight.classList.add("paused");
                workerTitle.innerText = "Queue Worker: PAUSED";
                workerDesc.innerText = "Daemon suspended. Manual trigger required to process queue.";
                logToSystemConsole("OPERATOR: Suspended background queue worker polling daemon.", "warning");
                showNotification("Daemon Suspended", "Background worker paused.", "warning");
            }
        };
    }

    // Manual dispatch step trigger
    const btnProcessManual = document.getElementById("btn-process-manual");
    if (btnProcessManual) {
        btnProcessManual.onclick = () => {
            logToSystemConsole("OPERATOR: Triggered manual single-job spooler dispatch step.", "info");
            processNextQueueJob(true); // Forced manual override
        };
    }

    // Toggle simulation bottom settings pane
    const btnSimPanel = document.getElementById("btn-toggle-sim-panel");
    const simBody = document.getElementById("simulation-panel-body");
    const simIcon = document.getElementById("sim-panel-icon");

    btnSimPanel.onclick = () => {
        const isHidden = simBody.classList.contains("hidden");
        if (isHidden) {
            simBody.classList.remove("hidden");
            simIcon.style.transform = "rotate(180deg)";
        } else {
            simBody.classList.add("hidden");
            simIcon.style.transform = "rotate(0deg)";
        }
    };

    // Speed Radios listener
    document.querySelectorAll('input[name="print-speed"]').forEach(radio => {
        radio.onchange = (e) => {
            printSpeedMs = parseInt(e.target.value);
            logToSystemConsole(`SIMULATOR: Adjusting printing compile latency to ${printSpeedMs / 1000}s.`, "info");
        };
    });

    // Inject mock single job
    document.getElementById("btn-trigger-single-mock").onclick = () => {
        injectMockUserJob();
    };

    // Inject mock bulk (3 jobs)
    document.getElementById("btn-trigger-bulk-mock").onclick = () => {
        logToSystemConsole("SIMULATOR: Injecting concurrent load (3 mock jobs)...", "info");
        injectMockUserJob("maloy_roy", "lab_report_final.pdf", "PRN001");
        setTimeout(() => injectMockUserJob("muhib_islam", "thesis_draft_corrected.pdf", "PRN001"), 100);
        setTimeout(() => injectMockUserJob("ewu_office", "minutes_meeting_june.pdf", "PRN002"), 200);
    };

    // Injected mock paperjam error
    document.getElementById("btn-sim-paperjam").onclick = () => {
        const prn = printerNodes["PRN001"];
        prn.status = "Busy";
        prn.error = "Paper Jam";
        
        logToSystemConsole("HARDWARE ERROR: HP LaserJet Pro reports Error: Code 202 (Paper Jam). Spooler locked.", "danger");
        showNotification("Hardware Jam", "HP LaserJet Pro reports a physical paper jam!", "danger");
        renderUI();
    };

    // Reset error simulator
    document.getElementById("btn-sim-reset-errors").onclick = () => {
        // Reset states
        Object.keys(printerNodes).forEach(key => {
            printerNodes[key].status = "Online";
            printerNodes[key].error = null;
        });

        logToSystemConsole("SIMULATOR: Cleared all simulated printer errors. Network restored.", "success");
        showNotification("Errors Cleared", "Hardware status reports operational.", "success");
        renderUI();
    };

    // --- Boot Setup ---
    logToSystemConsole("SERVER: Initialized connection with database...", "success");
    
    // Attempt database synchronization on boot
    syncDatabase().then(() => {
        const params = new URLSearchParams(window.location.search);
        
        const autoLogin = params.get("autologin");
        const autoEmail = params.get("email");
        const autoPass = params.get("password");
        const autoRole = params.get("role") || "operator";
        
        // Purge old cached sessions instantly if autologin trigger is present to avoid overlapping views
        if (autoLogin || params.get("clear_session")) {
            localStorage.removeItem("ucps_current_user");
            localStorage.removeItem("ucps_current_operator");
            currentUser = null;
            currentOperator = null;
            updateSessionBadge();
        }
        
        let hasUrlAction = false;

        if (autoLogin && autoEmail && autoPass) {

            const formData = new FormData();
            formData.append('email', autoEmail);
            formData.append('password', autoPass);
            formData.append('role', autoRole);

            fetch('login.php', {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    if (autoRole === 'student') {
                        currentUser = {
                            id: data.user.id,
                            name: data.user.name,
                            email: data.user.email,
                            studentId: data.user.studentId,
                            dept: data.user.dept
                        };
                        currentOperator = null;
                        localStorage.setItem("ucps_current_user", JSON.stringify(currentUser));
                        updateSessionBadge();
                        logToSystemConsole(`AUTH: Auto-logged in student session: ${currentUser.name}.`, "success");
                        // Clean URL so page refresh won't retrigger auto-login
                        window.history.replaceState({}, document.title, window.location.pathname);
                        setView("view-user");
                        loadUserDriveDocuments();
                    } else {
                        currentOperator = {
                            id: data.user.id,
                            name: data.user.name,
                            email: data.user.email,
                            shop: data.user.shop,
                            node_id: data.user.node_id
                        };
                        currentUser = null;
                        localStorage.setItem("ucps_current_operator", JSON.stringify(currentOperator));
                        updateSessionBadge();
                        logToSystemConsole(`AUTH: Auto-logged in operator session for shop: ${currentOperator.shop}.`, "success");
                        // Clean URL so page refresh won't retrigger auto-login
                        window.history.replaceState({}, document.title, window.location.pathname);
                        setView("view-operator");
                    }
                } else {
                    // Only show error if there's no existing session (avoid confusing retry popup on refresh)
                    if (!currentUser && !currentOperator) {
                        showNotification("Auto Login Failed", data.message || "Could not validate credentials", "danger");
                    }
                    // Clean URL regardless so stale params don't persist
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            })
            .catch(err => {
                console.error("Auto login failed:", err);
                // Clean URL on error too
                window.history.replaceState({}, document.title, window.location.pathname);
            });
        }
        
        const urlPrinterId = params.get("printer_id");
        if (urlPrinterId && printerNodes[urlPrinterId]) {
            hasUrlAction = true;
            logToSystemConsole(`QR SCAN DETECTED: Auto-pairing with printer ${urlPrinterId}...`, "info");
            
            if (!currentUser) {
                // If not logged in, auto-connect to the printer in guest mode and open the workflow
                openGuestWorkflow();
                const pr = printerNodes[urlPrinterId];
                if (pr && (pr.status === "Online" || pr.status === "Busy")) {
                    guestActivePrinter = pr;
                    syncGuestConnectionUI();
                    logToSystemConsole(`GUEST CLIENT: Connected to printer [${guestActivePrinter.name}] successfully via QR scan.`, "success");
                    showNotification("Connected", `Connected to ${guestActivePrinter.name}`, "success");
                } else {
                    showNotification("Pairing Rejected", `Could not pair: Printer "${urlPrinterId}" is currently offline.`, "warning");
                    logToSystemConsole(`QR PAIR REJECTED: Printer "${urlPrinterId}" is offline.`, "warning");
                }
                window.history.replaceState({}, document.title, window.location.pathname);
                return;
            }
            
            const pr = printerNodes[urlPrinterId];
            if (pr && (pr.status === "Online" || pr.status === "Busy")) {
                pairPrinter(urlPrinterId, false);
                setView("view-user");
                loadUserDriveDocuments();
                
                setTimeout(() => {
                    const uploadCard = document.getElementById("card-upload");
                    if (uploadCard) {
                        uploadCard.scrollIntoView({ behavior: "smooth" });
                        showNotification("Printer Paired", `Welcome! Paired with ${activePrinter.name} via QR scan.`, "success");
                    }
                }, 500);
            } else {
                setView("view-user");
                showNotification("Pairing Rejected", `Could not pair: Printer "${urlPrinterId}" is currently offline.`, "warning");
                logToSystemConsole(`QR PAIR REJECTED: Printer "${urlPrinterId}" is offline.`, "warning");
            }
        }

        if (!hasUrlAction) {
            if (currentUser) {
                updateSessionBadge();
                setView("view-user");
                loadUserDriveDocuments();
                
                if (activePrinter) {
                    const pr = printerNodes[activePrinter.id];
                    const currentStatus = pr ? pr.status : "Offline";
                    
                    if (currentStatus === "Online") {
                        pairPrinter(activePrinter.id, false);
                    } else {
                        // Safe cleanup if previously active printer went offline in background
                        activePrinter = null;
                        localStorage.removeItem("ucps_active_printer");
                        document.getElementById("panel-unpaired").classList.remove("hidden");
                        document.getElementById("panel-paired").classList.add("hidden");
                        // Keep upload card active so users can still save documents to their drive
                        showNotification("Printer Disconnected", "Your paired printer went offline.", "warning");
                    }
                }
            } else if (currentOperator) {
                updateSessionBadge();
                setView("view-operator");
            }
        }
    });

    // Password Visibility Toggles Setup
    const setupPasswordToggle = (toggleId, inputId) => {
        const toggle = document.getElementById(toggleId);
        const input = document.getElementById(inputId);
        if (toggle && input) {
            toggle.onclick = () => {
                const isPassword = input.type === "password";
                input.type = isPassword ? "text" : "password";
                toggle.className = isPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
            };
        }
    };
    setupPasswordToggle("toggle-login-password", "login-password");
    setupPasswordToggle("toggle-student-password", "student-password");
    setupPasswordToggle("toggle-operator-password", "operator-password");

    // --- Profile/Account Settings Modal Wiring ---
    const profileBadge = document.getElementById("user-profile-badge");
    const profileModal = document.getElementById("profile-settings-modal");
    const btnCloseProfile = document.getElementById("btn-close-profile");
    const btnCancelProfile = document.getElementById("btn-cancel-profile");
    const profileForm = document.getElementById("profile-update-form");
    const profileAvatarInput = document.getElementById("profile-avatar-input");
    const profileAvatarUploadOverlay = document.getElementById("profile-avatar-upload-overlay");
    const profileAvatarImg = document.getElementById("profile-avatar-img");
    const profileAvatarPlaceholder = document.getElementById("profile-avatar-placeholder");
    const profileNameInput = document.getElementById("profile-name-input");
    const profilePassInput = document.getElementById("profile-pass-input");
    const profileConfirmPassInput = document.getElementById("profile-confirm-pass-input");

    function openProfileModal() {
        const userObj = currentUser || currentOperator;
        if (!userObj) return;

        profileNameInput.value = userObj.name || "";
        profilePassInput.value = "";
        profileConfirmPassInput.value = "";

        if (userObj.avatar) {
            profileAvatarImg.src = `uploads/${userObj.avatar}`;
            profileAvatarImg.classList.remove("hidden");
            profileAvatarPlaceholder.classList.add("hidden");
        } else {
            profileAvatarImg.classList.add("hidden");
            profileAvatarPlaceholder.classList.remove("hidden");
        }

        profileModal.classList.remove("hidden");
    }

    if (profileBadge) {
        profileBadge.onclick = (e) => {
            if (e.target.closest("#btn-logout")) return;
            openProfileModal();
        };
    }

    if (btnCloseProfile) btnCloseProfile.onclick = () => profileModal.classList.add("hidden");
    if (btnCancelProfile) btnCancelProfile.onclick = () => profileModal.classList.add("hidden");

    if (profileAvatarUploadOverlay) {
        profileAvatarUploadOverlay.onclick = () => {
            profileAvatarInput.click();
        };
    }

    if (profileAvatarInput) {
        profileAvatarInput.onchange = () => {
            if (profileAvatarInput.files && profileAvatarInput.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    profileAvatarImg.src = e.target.result;
                    profileAvatarImg.classList.remove("hidden");
                    profileAvatarPlaceholder.classList.add("hidden");
                };
                reader.readAsDataURL(profileAvatarInput.files[0]);
            }
        };
    }

    if (profileForm) {
        profileForm.onsubmit = (e) => {
            e.preventDefault();
            
            const userObj = currentUser || currentOperator;
            if (!userObj) return;

            const name = profileNameInput.value.trim();
            const pass = profilePassInput.value;
            const confirmPass = profileConfirmPassInput.value;

            if (pass && pass !== confirmPass) {
                showNotification("Error", "Passwords do not match!", "warning");
                return;
            }

            const formData = new FormData();
            formData.append("user_id", userObj.id);
            formData.append("full_name", name);
            if (pass) {
                formData.append("password", pass);
            }

            if (profileAvatarInput.files && profileAvatarInput.files[0]) {
                formData.append("avatar", profileAvatarInput.files[0]);
            }

            const saveBtn = document.getElementById("btn-save-profile");
            const origText = saveBtn.innerText;
            saveBtn.innerText = "Saving Changes...";
            saveBtn.disabled = true;

            fetch("update_profile.php", {
                method: "POST",
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                saveBtn.innerText = origText;
                saveBtn.disabled = false;

                if (data.status === "success") {
                    showNotification("Profile Updated", "Account settings successfully updated.", "success");
                    profileModal.classList.add("hidden");
                    
                    if (currentUser) {
                        currentUser.name = data.user.name;
                        currentUser.avatar = data.user.avatar;
                        localStorage.setItem("ucps_current_user", JSON.stringify(currentUser));
                    } else if (currentOperator) {
                        currentOperator.name = data.user.name;
                        currentOperator.avatar = data.user.avatar;
                        localStorage.setItem("ucps_current_operator", JSON.stringify(currentOperator));
                    }
                    
                    updateSessionBadge();
                } else {
                    showNotification("Failed", data.message, "danger");
                }
            })
            .catch(err => {
                saveBtn.innerText = origText;
                saveBtn.disabled = false;
                showNotification("Network Error", "Failed to contact database server.", "danger");
                console.error(err);
            });
        };
    }

    // --- Guest Printing Variables ---
    let guestActivePrinter = null;
    let guestFileUploaded = null;
    let guestCalculatedPages = 1;
    let guestCalculatedCost = 5.00;
    let guestSelectedPaymentMethod = null;
    let guestPDFDoc = null;
    let guestCurrentPage = 1;

    // Navigation triggers
    const btnStartGuest = document.getElementById("btn-start-guest");
    const linkStartGuest = document.getElementById("link-start-guest");
    const btnGuestCancelReturn = document.getElementById("btn-guest-cancel-return");

    const openGuestWorkflow = () => {
        if (currentUser) {
            showNotification("Access Denied", "You are already logged in as a student. Please use your Student Dashboard.", "warning");
            setView("view-user");
            return;
        }
        if (currentOperator) {
            showNotification("Access Denied", "You are already logged in as an operator. Please use your Operator Panel.", "warning");
            setView("view-operator");
            return;
        }

        // Reset state
        guestActivePrinter = null;
        guestFileUploaded = null;
        guestCalculatedPages = 1;
        guestCalculatedCost = 5.00;
        guestSelectedPaymentMethod = null;
        guestPDFDoc = null;
        guestCurrentPage = 1;

        // Reset guest print range selectors
        document.getElementById("guest-print-range-select").value = "all";
        document.getElementById("guest-print-range").value = "all";
        document.getElementById("guest-print-range").classList.add("hidden");

        // Reset UI fields & printer connection states
        syncGuestConnectionUI();

        const previewCard = document.getElementById("guest-preview-card");
        const checkoutCard = document.getElementById("guest-checkout-card");
        
        previewCard.style.opacity = "0.5";
        previewCard.style.pointerEvents = "none";
        checkoutCard.style.opacity = "0.5";
        checkoutCard.style.pointerEvents = "none";

        // Reset upload zone UI
        document.getElementById("guest-upload-icon-status").className = "fa-solid fa-file-pdf drop-icon text-teal";
        document.getElementById("guest-upload-text").innerText = "Drag & drop your PDF or Image here";
        document.getElementById("guest-upload-subtext").innerText = "Supports PDF, PNG, JPG (Max 10MB)";
        
        document.getElementById("guest-preview-box").innerHTML = `
            <div style="text-align: center; color: var(--text-muted); font-size: 13px; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; gap: 10px;">
                <i class="fa-solid fa-file-invoice" style="font-size: 3rem; opacity: 0.4;"></i>
                No document uploaded yet.
            </div>
        `;
        document.getElementById("guest-pdf-nav-controls").classList.add("hidden");

        // Reset checkout display
        document.getElementById("guest-checkout-pages").innerText = "1 page(s)";
        document.getElementById("guest-checkout-price").innerText = "5.00 BDT";
        
        // Reset payment selection UI
        document.querySelectorAll(".pay-option").forEach(opt => opt.classList.remove("active"));
        document.getElementById("btn-guest-pay-print").disabled = true;

        setView("view-guest-print");
    };

    if (btnStartGuest) btnStartGuest.onclick = openGuestWorkflow;
    if (linkStartGuest) linkStartGuest.onclick = (e) => { e.preventDefault(); openGuestWorkflow(); };
    if (btnGuestCancelReturn) btnGuestCancelReturn.onclick = () => setView("view-landing");

    // Printer Connection UI sync helper
    function syncGuestConnectionUI() {
        const inputField = document.getElementById("guest-printer-id");
        const btnConnect = document.getElementById("btn-guest-connect-printer");
        const btnScan = document.getElementById("btn-guest-scan-qr");
        const statusBox = document.getElementById("guest-connection-status");
        const printControls = document.getElementById("guest-print-controls");
        const connectDivider = document.getElementById("guest-connect-divider");
        const qrGroup = document.getElementById("guest-qr-group");

        if (guestActivePrinter) {
            // Connected state
            inputField.value = guestActivePrinter.id;
            inputField.disabled = true;
            
            btnConnect.innerHTML = '<i class="fa-solid fa-unlink"></i> Disconnect';
            btnConnect.style.backgroundColor = "var(--color-danger)";
            btnConnect.style.borderColor = "var(--color-danger)";
            
            if (btnScan) btnScan.style.display = "none";
            if (connectDivider) connectDivider.style.display = "none";
            if (qrGroup) qrGroup.style.display = "none";
            
            statusBox.style.display = "flex";
            statusBox.style.borderColor = "rgba(16,185,129,0.3)";
            statusBox.style.backgroundColor = "rgba(16,185,129,0.1)";
            statusBox.style.color = "#10b981";
            statusBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connected to ${guestActivePrinter.name} (${guestActivePrinter.shop_name})`;
            
            printControls.style.opacity = "1";
            printControls.style.pointerEvents = "auto";
            
            // If they already have a file uploaded, enable preview and checkout cards too
            if (guestFileUploaded) {
                document.getElementById("guest-preview-card").style.opacity = "1";
                document.getElementById("guest-preview-card").style.pointerEvents = "auto";
                document.getElementById("guest-checkout-card").style.opacity = "1";
                document.getElementById("guest-checkout-card").style.pointerEvents = "auto";
            }
        } else {
            // Unconnected state
            inputField.disabled = false;
            
            btnConnect.innerHTML = "Connect";
            btnConnect.style.backgroundColor = "";
            btnConnect.style.borderColor = "";
            
            if (btnScan) btnScan.style.display = "";
            if (connectDivider) connectDivider.style.display = "flex";
            if (qrGroup) qrGroup.style.display = "block";
            
            statusBox.style.display = "none";
            statusBox.innerHTML = "";
            
            printControls.style.opacity = "0.5";
            printControls.style.pointerEvents = "none";
        }
    }

    function disconnectGuestPrinter() {
        guestActivePrinter = null;
        syncGuestConnectionUI();
        
        // Also disable preview and checkout cards
        document.getElementById("guest-preview-card").style.opacity = "0.5";
        document.getElementById("guest-preview-card").style.pointerEvents = "none";
        document.getElementById("guest-checkout-card").style.opacity = "0.5";
        document.getElementById("guest-checkout-card").style.pointerEvents = "none";

        logToSystemConsole("GUEST CLIENT: Disconnected from printer.", "info");
        showNotification("Disconnected", "Disconnected from printer", "info");
    }

    function connectGuestPrinter(printerIdInput) {
        const statusBox = document.getElementById("guest-connection-status");
        statusBox.style.display = "flex";
        
        const foundPrinterKey = Object.keys(printerNodes).find(k => 
            printerNodes[k].id.toUpperCase() === printerIdInput ||
            (printerNodes[k].name && printerNodes[k].name.toUpperCase() === printerIdInput)
        );

        if (foundPrinterKey) {
            const potentialPrinter = printerNodes[foundPrinterKey];
            const isOnline = potentialPrinter.status === "Online" || potentialPrinter.status === "Busy";
            
            if (isOnline) {
                guestActivePrinter = potentialPrinter;
                syncGuestConnectionUI();
                logToSystemConsole(`GUEST CLIENT: Connected to printer [${guestActivePrinter.name}] successfully.`, "success");
                showNotification("Connected", `Connected to ${guestActivePrinter.name}`, "success");
            } else {
                statusBox.style.borderColor = "rgba(239,68,68,0.3)";
                statusBox.style.backgroundColor = "rgba(239,68,68,0.1)";
                statusBox.style.color = "#ef4444";
                statusBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Printer "${potentialPrinter.name}" is OFFLINE.`;
                showNotification("Printer Offline", "The selected printer is currently offline.", "warning");
            }
        } else {
            statusBox.style.borderColor = "rgba(239,68,68,0.3)";
            statusBox.style.backgroundColor = "rgba(239,68,68,0.1)";
            statusBox.style.color = "#ef4444";
            statusBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Printer ID "${printerIdInput}" not found or offline.`;
            showNotification("Not Found", "Printer ID not found.", "danger");
        }
    }

    // Printer Connection Logic Bindings
    const btnGuestConnect = document.getElementById("btn-guest-connect-printer");
    if (btnGuestConnect) {
        btnGuestConnect.onclick = () => {
            if (guestActivePrinter) {
                disconnectGuestPrinter();
            } else {
                const printerIdInput = document.getElementById("guest-printer-id").value.trim().toUpperCase();
                connectGuestPrinter(printerIdInput);
            }
        };
    }

    // Guest QR Code Scanner Wiring
    const btnGuestScanQr = document.getElementById("btn-guest-scan-qr");
    if (btnGuestScanQr) {
        btnGuestScanQr.onclick = () => {
            logToSystemConsole("GUEST: Opening QR scanner camera feed...", "info");
            startQrScanner((scannedId) => {
                let targetId = scannedId;
                if (targetId.includes("?")) {
                    const urlParams = new URLSearchParams(targetId.split("?")[1]);
                    if (urlParams.has("printer_id")) {
                        targetId = urlParams.get("printer_id");
                    } else if (urlParams.has("printer")) {
                        targetId = urlParams.get("printer");
                    } else if (urlParams.has("PRINTER_ID")) {
                        targetId = urlParams.get("PRINTER_ID");
                    } else if (urlParams.has("PRINTER")) {
                        targetId = urlParams.get("PRINTER");
                    }
                }
                
                targetId = targetId.trim().toUpperCase();
                connectGuestPrinter(targetId);
            });
        };
    }

    // Guest Drag & Drop File Handlers
    const guestDropZone = document.getElementById("guest-drop-zone");
    const guestFileInput = document.getElementById("guest-file-input");
    const guestClickZone = document.getElementById("guest-click-zone");

    if (guestClickZone && guestFileInput) {
        guestClickZone.onclick = () => guestFileInput.click();
        guestFileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                handleGuestFile(e.target.files[0]);
            }
        };
    }

    if (guestDropZone) {
        guestDropZone.ondragover = (e) => {
            e.preventDefault();
            guestDropZone.style.borderColor = "var(--color-primary)";
        };
        guestDropZone.ondragleave = () => {
            guestDropZone.style.borderColor = "var(--border-color)";
        };
        guestDropZone.ondrop = (e) => {
            e.preventDefault();
            guestDropZone.style.borderColor = "var(--border-color)";
            if (e.dataTransfer.files.length > 0) {
                handleGuestFile(e.dataTransfer.files[0]);
            }
        };
    }

    const handleGuestFile = (file) => {
        const allowed = ["pdf", "png", "jpg", "jpeg"];
        const ext = file.name.split('.').pop().toLowerCase();
        if (!allowed.includes(ext)) {
            showNotification("Invalid File Format", "Only PDF, PNG, JPG files are allowed.", "danger");
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showNotification("File Too Large", "Maximum file size allowed is 10MB.", "danger");
            return;
        }

        guestFileUploaded = file;
        
        // Update UI state
        document.getElementById("guest-upload-icon-status").className = "fa-solid fa-file-circle-check drop-icon text-success";
        document.getElementById("guest-upload-text").innerText = `Uploaded: ${file.name}`;
        document.getElementById("guest-upload-subtext").innerText = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;

        // Enable preview & checkout card panels
        const previewCard = document.getElementById("guest-preview-card");
        const checkoutCard = document.getElementById("guest-checkout-card");
        previewCard.style.opacity = "1";
        previewCard.style.pointerEvents = "auto";
        checkoutCard.style.opacity = "1";
        checkoutCard.style.pointerEvents = "auto";

        // Initialize file preview
        initGuestPDFPreview(file);
    };

    // PDF Preview and Page Count Logic
    const initGuestPDFPreview = (file) => {
        const previewBox = document.getElementById("guest-preview-box");
        const navCtrls = document.getElementById("guest-pdf-nav-controls");
        previewBox.innerHTML = "";
        navCtrls.classList.add("hidden");

        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === "pdf") {
            const fileReader = new FileReader();
            fileReader.onload = function() {
                const typedarray = new Uint8Array(this.result);
                pdfjsLib.getDocument(typedarray).promise.then(pdf => {
                    guestPDFDoc = pdf;
                    guestCurrentPage = 1;
                    navCtrls.classList.remove("hidden");
                    renderGuestPDFPage(guestCurrentPage);
                    recalculateGuestCost();
                });
            };
            fileReader.readAsArrayBuffer(file);
        } else {
            // Image preview
            const url = URL.createObjectURL(file);
            previewBox.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px;">`;
            guestCalculatedPages = 1;
            recalculateGuestCost();
        }
    };

    const renderGuestPDFPage = (num) => {
        if (!guestPDFDoc) return;
        const previewBox = document.getElementById("guest-preview-box");
        previewBox.innerHTML = '<canvas id="guest-pdf-canvas" style="max-width: 100%; max-height: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 4px;"></canvas>';
        
        guestPDFDoc.getPage(num).then(page => {
            const canvas = document.getElementById("guest-pdf-canvas");
            const ctx = canvas.getContext("2d");
            const viewport = page.getViewport({ scale: 1.0 });
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };
            page.render(renderContext);
            document.getElementById("guest-pdf-page-num").innerText = `Page ${num} of ${guestPDFDoc.numPages}`;
        });
    };

    if (document.getElementById("btn-guest-pdf-prev")) {
        document.getElementById("btn-guest-pdf-prev").onclick = () => {
            if (guestCurrentPage <= 1) return;
            guestCurrentPage--;
            renderGuestPDFPage(guestCurrentPage);
        };
    }
    if (document.getElementById("btn-guest-pdf-next")) {
        document.getElementById("btn-guest-pdf-next").onclick = () => {
            if (!guestPDFDoc || guestCurrentPage >= guestPDFDoc.numPages) return;
            guestCurrentPage++;
            renderGuestPDFPage(guestCurrentPage);
        };
    }

    const recalculateGuestCost = () => {
        const colorMode = document.getElementById("guest-print-color").value;
        const rangeSelect = document.getElementById("guest-print-range-select").value;
        const customRange = document.getElementById("guest-print-range").value;
        const range = (rangeSelect === "custom") ? customRange : rangeSelect;
        const copies = parseInt(document.getElementById("guest-print-copies").value) || 1;

        let totalPages = 1;
        if (guestFileUploaded && guestFileUploaded.name.split('.').pop().toLowerCase() === 'pdf' && guestPDFDoc) {
            totalPages = calculatePagesFromRange(range, guestPDFDoc.numPages);
        }

        guestCalculatedPages = totalPages;
        const rate = (colorMode === 'color') ? 15.00 : 5.00;
        guestCalculatedCost = totalPages * rate * copies;

        document.getElementById("guest-checkout-pages").innerText = `${totalPages} page(s)`;
        document.getElementById("guest-checkout-price").innerText = `${guestCalculatedCost.toFixed(2)} BDT`;
    };

    // Change listeners for settings recalculation
    const elGuestColor = document.getElementById("guest-print-color");
    const elGuestCopies = document.getElementById("guest-print-copies");
    const elGuestRangeSelect = document.getElementById("guest-print-range-select");
    const elGuestRange = document.getElementById("guest-print-range");
    const elGuestSize = document.getElementById("guest-print-size");

    if (elGuestColor) elGuestColor.onchange = recalculateGuestCost;
    if (elGuestCopies) elGuestCopies.oninput = recalculateGuestCost;
    if (elGuestRange) elGuestRange.oninput = recalculateGuestCost;

    if (elGuestRangeSelect) {
        elGuestRangeSelect.onchange = (e) => {
            const customInput = document.getElementById("guest-print-range");
            if (e.target.value === "custom") {
                customInput.classList.remove("hidden");
                customInput.value = "";
                customInput.focus();
            } else {
                customInput.classList.add("hidden");
                customInput.value = e.target.value;
            }
            recalculateGuestCost();
        };
    }

    // Payment Selection
    const guestBkashOpt = document.getElementById("guest-pay-option-bkash");
    const guestCashOpt = document.getElementById("guest-pay-option-cash");
    const btnGuestPayPrint = document.getElementById("btn-guest-pay-print");

    if (guestBkashOpt && guestCashOpt) {
        guestBkashOpt.onclick = () => {
            guestSelectedPaymentMethod = "bKash";
            guestBkashOpt.classList.add("active");
            guestCashOpt.classList.remove("active");
            btnGuestPayPrint.disabled = false;
        };
        guestCashOpt.onclick = () => {
            guestSelectedPaymentMethod = "Cash";
            guestCashOpt.classList.add("active");
            guestBkashOpt.classList.remove("active");
            btnGuestPayPrint.disabled = false;
        };
    }

    // Guest Print Submit
    if (btnGuestPayPrint) {
        btnGuestPayPrint.onclick = () => {
            if (!guestFileUploaded || !guestActivePrinter || !guestSelectedPaymentMethod) return;

            const submitForm = () => {
                const formData = new FormData();
                formData.append("print_file", guestFileUploaded);
                formData.append("printer_id", guestActivePrinter.id);
                formData.append("user_id", "guest"); // Will be resolved dynamically by upload.php
                
                // Print Settings
                formData.append("page_size", elGuestSize.value);
                formData.append("page_range", elGuestRange.value);
                formData.append("copies", elGuestCopies.value);
                formData.append("print_color", elGuestColor.value);
                
                const method = (guestSelectedPaymentMethod === "bKash") ? "bKash" : "Cash";
                formData.append("payment_method", method);

                showNotification("Uploading", "Uploading guest print job to queue...", "info");

                fetch("upload.php", {
                    method: "POST",
                    body: formData
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === "success") {
                        const jobUuid = data.data.job_id;
                        logToSystemConsole(`UPLOAD HANDLER: Secured guest print job ${jobUuid}.`, "success");
                        showNotification("Document Queued", `Guest job ${jobUuid} submitted successfully.`, "success");

                        // Show receipt modal
                        document.getElementById("receipt-job-id").innerText = jobUuid;
                        document.getElementById("receipt-filename").innerText = guestFileUploaded.name;
                        document.getElementById("receipt-printer").innerText = guestActivePrinter.name;
                        document.getElementById("receipt-cost").innerText = `${guestCalculatedPages} page(s) / ${guestCalculatedCost.toFixed(2)} BDT`;
                        
                        // Disable the save to drive button for guests since they have no drive account
                        const rcptSaveBtn = document.getElementById("btn-save-to-drive");
                        if (rcptSaveBtn) rcptSaveBtn.disabled = true;

                        // Preview inside receipt modal
                        const rcptPreviewBox = document.getElementById("receipt-preview-box");
                        if (rcptPreviewBox) {
                            const ext = guestFileUploaded.name.split('.').pop().toLowerCase();
                            if (ext === "pdf") {
                                rcptPreviewBox.innerHTML = `
                                    <div style="text-align: center; color: var(--text-muted); padding: 15px;">
                                        <i class="fa-solid fa-file-pdf" style="font-size: 2.5rem; color: #ef4444; margin-bottom: 8px;"></i>
                                        <span style="font-size:12px; display:block;">PDF Document (Interactive Preview Active)</span>
                                    </div>
                                `;
                            } else {
                                const imgUrl = URL.createObjectURL(guestFileUploaded);
                                rcptPreviewBox.innerHTML = `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:contain;border-radius:4px;">`;
                            }
                        }

                        // Open Receipt Modal
                        const receiptModal = document.getElementById("receipt-modal");
                        if (receiptModal) receiptModal.classList.remove("hidden");
                        
                        // Return to home page
                        openGuestWorkflow();
                        setView("view-landing");
                    } else {
                        showNotification("Upload Failed", data.message, "danger");
                    }
                })
                .catch(err => {
                    showNotification("Network Error", "Failed to upload file to printing queue.", "danger");
                    console.error(err);
                });
            };

            if (guestSelectedPaymentMethod === "bKash") {
                openBkashPortal(guestCalculatedCost, submitForm);
            } else {
                submitForm();
            }
        };
    }

    renderUI();

    // Start Worker Interval Loop (3 seconds)
    queueWorkerInterval = setInterval(() => {
        if (isRealMode) {
            // In real mode, synchronize periodically from the database
            syncDatabase();
        } else if (workerRunning) {
            processNextQueueJob(false);
        }
    }, 3000);

});

// --- Simulation Trigger Functions ---

// Injecting mock jobs
function injectMockUserJob(user = "guest_student", docName = "draft_print.pdf", targetPrnId = "PRN001") {
    const prn = printerNodes[targetPrnId];
    const secureName = generateSecureHash(docName);
    const format = docName.split('.').pop().toUpperCase();
    
    const mockJob = {
        job_id: `UCPS-${jobCounter++}`,
        user_id: user,
        printer_id: targetPrnId,
        printer_name: prn.name,
        filename: docName,
        secure_filename: secureName,
        format: format,
        price: 15.00,
        payment_status: "bKash_Paid", // Auto paid for injected mock simulation
        status: "Pending",
        timestamp: new Date().toLocaleTimeString()
    };

    printQueue.push(mockJob);
    logToSystemConsole(`QUEUE INJECTION: Remote User [${user}] submitted job ${mockJob.job_id} targeting ${prn.name}.`, "info");
    renderUI();
}

// Queue Worker processor logic (The Core FIFO Worker)
function processNextQueueJob(isManualOverride = false) {
    // Find the first job that is Pending
    const job = printQueue.find(j => j.status === "Pending");
    if (!job) return;

    // Billing Gate: Skip jobs that are Pending Cash payment
    if (job.payment_status === "Pending Cash") {
        return; // Bypassed by print node spooler
    }

    // Identify target printer state
    const printer = printerNodes[job.printer_id];
    
    // Check if printer has hardware errors
    if (!printer || printer.error) {
        logToSystemConsole(`QUEUE WORKER: Job ${job.job_id} paused. Printer reports state error.`, "warning");
        return;
    }

    if (printer.status !== "Online") {
        logToSystemConsole(`QUEUE WORKER: Job ${job.job_id} deferred. Printer [${printer.name}] state is: ${printer.status}.`, "warning");
        return;
    }

    // Acquired database lock and initiate printing
    job.status = "Printing";
    printer.status = "Busy";
    
    logToSystemConsole(`QUEUE WORKER: Acquired database row-lock for Job ${job.job_id} (FOR UPDATE transaction).`, "success");
    logToSystemConsole(`SPOOLER: Dispatching secure file ${job.secure_filename} to OS print buffer.`, "info");
    
    const osCommand = job.printer_id === "PRN001" 
        ? `SumatraPDF.exe -print-to-default -silent "${job.secure_filename}"`
        : `lp -d epson_inktank -o fit-to-page "${job.secure_filename}"`;
        
    logToSystemConsole(`SPOOLER ENGINE: Executing system call: ${osCommand}`, "info");
    renderUI();

    // Simulating hardware print duration
    setTimeout(() => {
        // Complete job
        job.status = "Completed";
        
        // Remove from current queue array
        const idx = printQueue.findIndex(j => j.job_id === job.job_id);
        if (idx > -1) {
            printQueue.splice(idx, 1);
        }

        // Add to historical table logs
        const completedRecord = {
            job_id: job.job_id,
            user_id: job.user_id,
            filename: job.filename,
            printer_name: job.printer_name,
            time: new Date().toLocaleTimeString(),
            status: "Completed"
        };
        printHistory.push(completedRecord);

        // Reset printer status to Online
        printer.status = "Online";
        
        logToSystemConsole(`PRINTER NODE: Spooler completed print output for Job ${job.job_id}.`, "success");
        logToSystemConsole(`CLEANUP SYSTEM: Secure print buffer cleared. Deleted file: ${job.secure_filename}`, "success");
        
        showNotification("Printing Complete", `Your document "${job.filename}" has been successfully printed.`, "success");
        
        renderUI();
    }, printSpeedMs);
}
