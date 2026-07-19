# UCPS Android App - Complete API Documentation

**Version:** 1.0  
**Last Updated:** July 19, 2025  
**Platform:** Android (Kotlin/Java)  
**API Base URL:** `http://your-server.com/UniversalPrinter/`

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Printer Management](#printer-management)
4. [File Upload & Printing](#file-upload--printing)
5. [Queue Management](#queue-management)
6. [Payment Processing](#payment-processing)
7. [Cloud Drive Operations](#cloud-drive-operations)
8. [Profile Management](#profile-management)
9. [Operator Features](#operator-features)
10. [Error Handling](#error-handling)
11. [Code Examples](#code-examples)
12. [Security Guidelines](#security-guidelines)

---

## Overview

### What is UCPS?

The Universal Cloud Print System (UCPS) is a secure, cloud-based printing platform that allows students and guests to:
- Upload documents (PDF, PNG, JPG) from their Android devices
- Connect to nearby printers using QR codes or manual Printer IDs
- Track print jobs in real-time
- Pay via bKash wallet or manual cash collection at print shops
- Save documents to a personal cloud drive for future printing

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│          Android App (This Documentation)               │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP/REST API
┌──────────────────▼──────────────────────────────────────┐
│    UCPS PHP API Server (SQLite Database)                │
├──────────────────────────────────────────────────────────┤
│ - login.php / register.php                              │
│ - upload.php / get_queue.php                            │
│ - get_printers.php / update_status.php                  │
│ - Cloud Drive APIs                                      │
└──────────────────┬──────────────────────────────────────┘
                   │ Database Queries
┌──────────────────▼──────────────────────────────────────┐
│    SQLite Database (Print Jobs, Printers, Users)        │
└──────────────────────────────────────────────────────────┘
                   ▲
                   │ Polling
┌──────────────────┴──────────────────────────────────────┐
│  UCPS Print Node Daemon (Desktop Client)                │
│  - Polls get_jobs.php every 2-3 seconds                 │
│  - Downloads files from server                          │
│  - Sends to local printer (Windows/Linux)               │
│  - Updates job status → update_status.php               │
└──────────────────────────────────────────────────────────┘
```

---

## Authentication

### 1.1 Student Login

**Endpoint:** `POST /login.php`

**Headers:**
```
Content-Type: application/x-www-form-urlencoded
```

**Request Body:**
```
email=student1@ewu.edu.bd
password=password123
role=student
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Login successful",
  "user": {
    "id": 1,
    "username": "student1",
    "email": "student1@ewu.edu.bd",
    "role": "student",
    "name": "Wahidur Rahman",
    "studentId": "2022-1-60-001",
    "dept": "CSE",
    "avatar": null,
    "node_id": null
  }
}
```

**Error Response (401 Unauthorized):**
```json
{
  "status": "error",
  "message": "Invalid email or password."
}
```

**Test Credentials:**
- Email: `student1@ewu.edu.bd`
- Password: `password123`

---

### 1.2 Operator Login

**Request Body:**
```
email=operator@ewu.edu.bd
password=password123
role=operator
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Login successful",
  "user": {
    "id": 4,
    "username": "operator",
    "email": "operator@ewu.edu.bd",
    "role": "operator",
    "name": "Farhan",
    "shop": "UCPS Lab 3 Spooler",
    "node_id": "PRN002",
    "avatar": null
  }
}
```

**Important:** The `node_id` field is essential for operators to identify their printer group.

**Test Credentials:**
- Email: `operator@ewu.edu.bd`
- Password: `password123`

---

### 1.3 Guest Login (No Account Required)

Guests can print without creating an account. The system automatically creates a guest user record when a guest uploads a document.

```
email: guest@ucps.cloud
password: (not required)
role: student
```

---

### 1.4 Student Registration

**Endpoint:** `POST /register.php`

**Request Body:**
```
role=student
name=Your Full Name
email=yourname@ewu.edu.bd
password=securepass123
student_id=2022-1-60-003
dept=CSE
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Registration successful! You can now log in."
}
```

**Validation Rules:**
- Email must be unique (409 Conflict if already exists)
- Password minimum 6 characters
- All fields required

**Error Response (409 Conflict):**
```json
{
  "status": "error",
  "message": "An account with this email already exists."
}
```

---

### 1.5 Shop Registration

**Endpoint:** `POST /register.php`

**Request Body:**
```
role=operator
name=Shop Owner Name
email=shop@example.com
password=shoppass123
shop_name=My Print Shop
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Registration successful! You can now log in."
}
```

---

## Printer Management

### 2.1 Get All Available Printers

**Endpoint:** `GET /get_printers.php`

**No Query Parameters Required**

**Response (200 OK):**
```json
{
  "status": "success",
  "printers": [
    {
      "printer_id": "PRN001",
      "printer_name": "HP LaserJet Pro 400",
      "location": "Room 304 (Lab 3)",
      "status": "Online",
      "ink_level": "84%",
      "paper_status": "Ready",
      "last_ping": "2025-07-19 14:35:22",
      "shop_name": "EWU Lab 3 Spooler"
    },
    {
      "printer_id": "PRN002",
      "printer_name": "Epson L3210 InkTank",
      "location": "Room 305 (Office)",
      "status": "Online",
      "ink_level": "92%",
      "paper_status": "Ready",
      "last_ping": "2025-07-19 14:35:15",
      "shop_name": "UCPS Lab 3 Spooler (Farhan)"
    }
  ]
}
```

**Key Fields:**
- `printer_id`: Unique identifier (e.g., PRN001)
- `status`: Online, Busy, or Offline
- `ink_level`: Ink percentage
- `paper_status`: Ready or Low/Out
- `shop_name`: Human-readable shop name

**Usage in Android:**
```kotlin
// Display list of available printers
val printerList = response.printers.filter { it.status == "Online" }
adapter.submitList(printerList)
```

---

## File Upload & Printing

### 3.1 Upload Document for Printing

**Endpoint:** `POST /upload.php`

**Headers:**
```
Content-Type: multipart/form-data
```

**Request Body (Form Data):**
```
print_file: [binary file - PDF, PNG, or JPG]
user_id: 1
printer_id: PRN001
payment_method: Cash
page_size: A4
page_range: all
copies: 1
print_color: monochrome
```

**Parameter Details:**

| Parameter | Type | Required | Values | Description |
|-----------|------|----------|--------|-------------|
| print_file | File | Yes | PDF/PNG/JPG | Max 10MB, MIME-validated |
| user_id | Integer | Yes | > 0 | Student ID or "guest" |
| printer_id | String | Yes | PRN001, PRN002, etc. | From get_printers.php |
| payment_method | String | Yes | Cash, bKash | Payment type |
| page_size | String | No | A4, Letter, Legal | Default: A4 |
| page_range | String | No | all, 1-3, 1,3,5 | All pages by default |
| copies | Integer | No | 1-100 | Default: 1 |
| print_color | String | No | monochrome, color | monochrome = 5 BDT/page, color = 15 BDT/page |

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Job submitted to database queue successfully",
  "data": {
    "job_id": "UCPS-1005",
    "secure_name": "20250719_a1b2c3d4e5f6g7h8.pdf",
    "printer": "HP LaserJet Pro 400"
  }
}
```

**Price Calculation:**
```
Total Price = Number of Pages × Rate per Page × Number of Copies

B&W (Monochrome): 5 BDT per page
Color: 15 BDT per page

Example: 10-page document, color, 2 copies
= 10 × 15 × 2 = 300 BDT
```

**Error Response (400 Bad Request):**
```json
{
  "status": "error",
  "message": "Security Violation: File exceeds maximum allowed limit (10MB)"
}
```

**Possible Errors:**
- File exceeds 10MB
- Invalid file format (not PDF/PNG/JPG)
- MIME type mismatch
- Printer not found
- Missing required parameters

---

### 3.2 Advanced Print Settings

#### Page Range Examples:
- `all` - Print all pages
- `1` - Print only page 1
- `1-5` - Print pages 1 through 5
- `1,3,5` - Print pages 1, 3, and 5 (non-consecutive)
- `1-3,7` - Print pages 1-3 and page 7

#### Color Modes:
- **Monochrome (B&W)**: 5 BDT per page - suitable for text documents
- **Color**: 15 BDT per page - suitable for images and colored content

#### Page Sizes:
- **A4**: Standard 210×297 mm (most common)
- **Letter**: 8.5×11 inches (US standard)
- **Legal**: 8.5×14 inches (US legal documents)

---

## Queue Management

### 4.1 Get Print Queue (Student View)

**Endpoint:** `GET /get_queue.php`

**Query Parameters:**
```
user_id=1
paired_printer_id=PRN001 (optional)
```

**Response (200 OK):**
```json
{
  "status": "success",
  "jobs": [
    {
      "job_id": 52,
      "job_uuid": "UCPS-1005",
      "original_filename": "assignment_ch3.pdf",
      "secure_filename": "20250719_a1b2c3d4e5f.pdf",
      "file_format": "PDF",
      "price_bdt": 15.00,
      "payment_status": "Unpaid",
      "status": "Pending",
      "upload_time": "2025-07-19 14:30:22",
      "printer_name": "HP LaserJet Pro 400",
      "printer_id": "PRN001",
      "username": "student1"
    },
    {
      "job_id": 53,
      "job_uuid": "UCPS-1006",
      "original_filename": "thesis_draft.pdf",
      "secure_filename": "20250719_b2c3d4e5f6.pdf",
      "file_format": "PDF",
      "price_bdt": 50.00,
      "payment_status": "bKash_Paid",
      "status": "Printing",
      "upload_time": "2025-07-19 14:32:15",
      "printer_name": "HP LaserJet Pro 400",
      "printer_id": "PRN001",
      "username": "student1"
    }
  ]
}
```

**Job Status Values:**
- `Pending` - Waiting for operator cash approval or payment
- `Printing` - Currently being printed
- `Completed` - Successfully printed
- `Failed` - Printing failed

**Payment Status Values:**
- `Unpaid` - Cash payment pending at shop
- `bKash_Paid` - Already paid via bKash
- `Cash_Approved` - Operator collected cash

---

### 4.2 Get Print Queue (Operator View)

**Endpoint:** `GET /get_queue.php`

**Query Parameters:**
```
node_id=PRN001
```

**Response (200 OK):**
```json
{
  "status": "success",
  "jobs": [
    {
      "job_id": 52,
      "job_uuid": "UCPS-1005",
      "original_filename": "student_assignment.pdf",
      "file_format": "PDF",
      "price_bdt": 20.00,
      "payment_status": "Unpaid",
      "status": "Pending",
      "upload_time": "2025-07-19 14:30:22",
      "printer_name": "HP LaserJet Pro 400",
      "printer_id": "PRN001",
      "username": "student1"
    }
  ]
}
```

**Operator Responsibilities:**
1. Review jobs in "Pending" status with "Unpaid" payment
2. Collect cash from student
3. Call `/process_payment.php` to approve cash payment
4. Job automatically moves to print queue

---

### 4.3 Real-time Queue Polling

**Recommended Implementation:**
- Poll `/get_queue.php` every **5-10 seconds** for student view
- Poll `/get_queue.php` every **3 seconds** for operator view
- Use exponential backoff for error cases

```kotlin
// Kotlin Coroutine Example
launch {
    while (isActive) {
        try {
            val response = apiService.getQueue(userId)
            updateUI(response.jobs)
        } catch (e: Exception) {
            logError(e)
        }
        delay(5000) // 5 seconds
    }
}
```

---

## Payment Processing

### 5.1 Cash Collection (Operator Only)

**Endpoint:** `POST /process_payment.php`

**Request Body:**
```
job_id: 52
action: ApproveCash
operator_id: 4
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Cash payment approved and job dispatched to spooler"
}
```

**Workflow:**
1. Operator views pending job with status "Unpaid"
2. Student pays cash to operator
3. Operator clicks "Collect Cash" button in app
4. API call to `/process_payment.php`
5. Job status changes to "Cash_Approved"
6. Print daemon picks up job automatically

---

### 5.2 bKash Payment Integration

**Note:** bKash payment is simulated in this version. For production:

**Request Body (On Client):**
```
payment_method: bKash
amount: 50.00
phone: 01700000000
```

**Workflow:**
1. User selects bKash as payment method during upload
2. Payment method is set to "bKash"
3. Job automatically enters queue (no cash collection needed)
4. Print daemon immediately processes the job

**In Production:**
- Integrate with bKash Checkout API
- Use sandbox environment for testing: `https://checkout.sandbox.bkash.com/`
- Real production: `https://checkout.bkash.com/`

---

## Cloud Drive Operations

### 6.1 Save Document to Cloud Drive

**Endpoint:** `POST /upload_to_drive.php`

**Request Body (Form Data):**
```
print_file: [binary file]
user_id: 1
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Document saved to cloud drive successfully",
  "document": {
    "doc_id": 15,
    "filename": "assignment_ch3.pdf"
  }
}
```

**Benefits:**
- Save documents for printing later
- No need to re-upload each time
- Documents preserved even after first print

---

### 6.2 Get Saved Documents

**Endpoint:** `GET /get_documents.php`

**Query Parameters:**
```
user_id=1
```

**Response (200 OK):**
```json
{
  "status": "success",
  "documents": [
    {
      "doc_id": 15,
      "original_filename": "assignment_ch3.pdf",
      "secure_filename": "20250715_a1b2c3d4e5f6.pdf",
      "file_format": "PDF",
      "file_size": 2458624,
      "uploaded_at": "2025-07-15 10:15:00"
    },
    {
      "doc_id": 16,
      "original_filename": "thesis_chapter1.pdf",
      "secure_filename": "20250716_b2c3d4e5f6g7.pdf",
      "file_format": "PDF",
      "file_size": 5242880,
      "uploaded_at": "2025-07-16 14:20:30"
    }
  ]
}
```

**File Size Display:**
```kotlin
fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        else -> "${bytes / (1024 * 1024)} MB"
    }
}
```

---

### 6.3 Print from Cloud Drive

**Endpoint:** `POST /print_existing_doc.php`

**Request Body:**
```
doc_id: 15
printer_id: PRN001
user_id: 1
payment_method: bKash
page_size: A4
page_range: all
copies: 1
print_color: monochrome
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "job_id": "UCPS-1010",
    "filename": "assignment_ch3.pdf",
    "printer": "HP LaserJet Pro 400"
  }
}
```

**Advantages Over Direct Upload:**
- Faster (no file transfer needed)
- Modify print settings without re-uploading
- Print same document multiple times with different settings

---

### 6.4 Preview Document

**Endpoint:** `GET /view_file_base64.php`

**Query Parameters:**
```
doc_id=15
user_id=1
```

**Response (200 OK - JSON):**
```json
{
  "status": "success",
  "pdf_base64": "JVBERi0xLjcKCjEgMCBvYmo..."
}
```

**Or Direct File:**

**Endpoint:** `GET /view_file.php`

**Query Parameters:**
```
doc_id=15
user_id=1
```

**Response (200 OK - Binary)**
Returns raw PDF/image file for direct viewing

---

### 6.5 Rename Document

**Endpoint:** `POST /rename_document.php`

**Request Body:**
```
doc_id: 15
user_id: 1
new_name: assignment_final_v2.pdf
```

**Response (200 OK):**
```json
{
  "status": "success",
  "new_name": "assignment_final_v2.pdf"
}
```

---

### 6.6 Delete Document

**Endpoint:** `POST /delete_document.php`

**Request Body:**
```
doc_id: 15
user_id: 1
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Document deleted successfully"
}
```

---

## Profile Management

### 7.1 Update Profile

**Endpoint:** `POST /update_profile.php`

**Request Body (Form Data):**
```
user_id: 1
full_name: Updated Full Name
password: newpassword123 (optional)
Files:
  avatar: [image file - optional]
```

**Response (200 OK):**
```json
{
  "status": "success",
  "user": {
    "name": "Updated Full Name",
    "avatar": "uploads/avatar_user1_hash.png"
  }
}
```

**Avatar Requirements:**
- Formats: PNG, JPG, JPEG
- Max size: 5 MB
- Recommended dimensions: 200×200px

**Error Response:**
```json
{
  "status": "error",
  "message": "Passwords do not match!"
}
```

---

## Operator Features

### 8.1 Get Today's Statistics

**Endpoint:** `GET /get_stats.php`

**Query Parameters:**
```
node_id=PRN001
date=2025-07-19
```

**Response (200 OK):**
```json
{
  "status": "success",
  "total_jobs": 25,
  "total_revenue": 475.50,
  "average_job_value": 19.02
}
```

**Usage:**
- Display daily earnings in operator dashboard
- Show job count and performance metrics
- Auto-refresh every 30 seconds

---

### 8.2 Sync Printers to Server

**Endpoint:** `POST /sync_printers.php`

**Request Body:**
```
node_id: PRN001
printers: ["HP LaserJet Pro 400", "Epson L3210 InkTank"]
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Printers synced successfully"
}
```

---

### 8.3 Cancel Print Job

**Endpoint:** `POST /delete_job.php`

**Request Body:**
```
job_uuid: UCPS-1005
operator_id: 4
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Job and spooler files successfully deleted."
}
```

**Permissions:**
- Operators can cancel any job
- Students can only cancel their own jobs

---

### 8.4 Update Job Status (Print Daemon)

**Endpoint:** `POST /update_status.php`

**Request Body:**
```
job_id: 52
printer_id: PRN001
status: Completed
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Job state updated and printer released.",
  "cleanup": "Secure file erased from spooler buffer"
}
```

**Status Values:**
- `Completed` - Print job succeeded
- `Failed` - Print job failed

**Process:**
1. Desktop daemon downloads file
2. Sends to local printer
3. When complete, calls this endpoint
4. File automatically deleted (if not saved in cloud drive)
5. Printer status reset to "Online"

---

## Error Handling

### Common HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Job submitted successfully |
| 400 | Bad Request | Missing required parameters |
| 401 | Unauthorized | Invalid credentials |
| 403 | Forbidden | Access denied (not authorized) |
| 404 | Not Found | Printer/Job not found |
| 409 | Conflict | Email already exists |
| 500 | Server Error | Database error |

### Error Response Format

All errors return JSON:
```json
{
  "status": "error",
  "message": "Descriptive error message"
}
```

### Android Error Handling

```kotlin
try {
    val response = apiService.login(email, password, role)
    if (response.status == "success") {
        // Handle success
        saveUserData(response.user)
    } else {
        // Handle error
        showError(response.message)
    }
} catch (e: HttpException) {
    when (e.code()) {
        400 -> showError("Invalid input")
        401 -> showError("Login failed")
        500 -> showError("Server error. Try again later")
        else -> showError("Unknown error occurred")
    }
} catch (e: Exception) {
    showError("Network error: ${e.message}")
}
```

---

## Code Examples

### Android Kotlin Implementation

#### Setup Retrofit

```kotlin
// build.gradle
dependencies {
    implementation 'com.squareup.retrofit2:retrofit:2.9.0'
    implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
    implementation 'com.squareup.okhttp3:okhttp:4.10.0'
    implementation 'com.squareup.okhttp3:logging-interceptor:4.10.0'
    implementation 'androidx.datastore:datastore-preferences:1.0.0'
}
```

#### Define API Service Interface

```kotlin
interface UCPSApiService {
    companion object {
        const val BASE_URL = "http://your-server.com/UniversalPrinter/"

        fun create(): UCPSApiService {
            val httpClient = OkHttpClient.Builder()
                .addInterceptor(HttpLoggingInterceptor().setLevel(HttpLoggingInterceptor.Level.BODY))
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build()

            val retrofit = Retrofit.Builder()
                .baseUrl(BASE_URL)
                .client(httpClient)
                .addConverterFactory(GsonConverterFactory.create())
                .build()

            return retrofit.create(UCPSApiService::class.java)
        }
    }

    // Authentication
    @FormUrlEncoded
    @POST("login.php")
    suspend fun login(
        @Field("email") email: String,
        @Field("password") password: String,
        @Field("role") role: String = "student"
    ): LoginResponse

    @FormUrlEncoded
    @POST("register.php")
    suspend fun register(
        @Field("role") role: String,
        @Field("name") name: String,
        @Field("email") email: String,
        @Field("password") password: String,
        @Field("student_id") studentId: String = "",
        @Field("dept") dept: String = ""
    ): RegisterResponse

    // Printers
    @GET("get_printers.php")
    suspend fun getPrinters(): PrinterListResponse

    // Upload & Queue
    @Multipart
    @POST("upload.php")
    suspend fun uploadFile(
        @Part file: MultipartBody.Part,
        @Part("user_id") userId: RequestBody,
        @Part("printer_id") printerId: RequestBody,
        @Part("payment_method") paymentMethod: RequestBody = RequestBody.create(MediaType.parse("text/plain"), "Cash"),
        @Part("page_size") pageSize: RequestBody = RequestBody.create(MediaType.parse("text/plain"), "A4"),
        @Part("page_range") pageRange: RequestBody = RequestBody.create(MediaType.parse("text/plain"), "all"),
        @Part("copies") copies: RequestBody = RequestBody.create(MediaType.parse("text/plain"), "1"),
        @Part("print_color") printColor: RequestBody = RequestBody.create(MediaType.parse("text/plain"), "monochrome")
    ): UploadResponse

    @GET("get_queue.php")
    suspend fun getQueue(
        @Query("user_id") userId: Int? = null,
        @Query("node_id") nodeId: String? = null,
        @Query("paired_printer_id") pairedPrinterId: String? = null
    ): QueueResponse

    // Cloud Drive
    @Multipart
    @POST("upload_to_drive.php")
    suspend fun saveDocumentToDrive(
        @Part file: MultipartBody.Part,
        @Part("user_id") userId: RequestBody
    ): SaveDocumentResponse

    @GET("get_documents.php")
    suspend fun getDocuments(
        @Query("user_id") userId: Int
    ): DocumentListResponse

    @FormUrlEncoded
    @POST("delete_document.php")
    suspend fun deleteDocument(
        @Field("doc_id") docId: Int,
        @Field("user_id") userId: Int
    ): DeleteDocumentResponse

    @FormUrlEncoded
    @POST("print_existing_doc.php")
    suspend fun printFromDrive(
        @Field("doc_id") docId: Int,
        @Field("printer_id") printerId: String,
        @Field("user_id") userId: Int,
        @Field("payment_method") paymentMethod: String = "Cash",
        @Field("page_size") pageSize: String = "A4",
        @Field("page_range") pageRange: String = "all",
        @Field("copies") copies: Int = 1,
        @Field("print_color") printColor: String = "monochrome"
    ): UploadResponse

    // Profile
    @Multipart
    @POST("update_profile.php")
    suspend fun updateProfile(
        @Part("user_id") userId: RequestBody,
        @Part("full_name") fullName: RequestBody,
        @Part("password") password: RequestBody = RequestBody.create(MediaType.parse("text/plain"), ""),
        @Part avatar: MultipartBody.Part? = null
    ): UpdateProfileResponse

    // Operator
    @GET("get_stats.php")
    suspend fun getStats(
        @Query("node_id") nodeId: String,
        @Query("date") date: String
    ): StatsResponse

    @FormUrlEncoded
    @POST("process_payment.php")
    suspend fun approveCashPayment(
        @Field("job_id") jobId: Int,
        @Field("action") action: String = "ApproveCash",
        @Field("operator_id") operatorId: Int
    ): PaymentResponse

    @FormUrlEncoded
    @POST("delete_job.php")
    suspend fun deleteJob(
        @Field("job_uuid") jobUuid: String,
        @Field("user_id") userId: Int? = null,
        @Field("operator_id") operatorId: Int? = null
    ): DeleteJobResponse
}
```

#### Data Classes

```kotlin
data class LoginResponse(
    val status: String,
    val message: String,
    val user: UserData
)

data class UserData(
    val id: Int,
    val username: String,
    val email: String,
    val role: String,
    val name: String,
    val studentId: String?,
    val shop: String?,
    val dept: String?,
    val avatar: String?,
    val node_id: String?
)

data class PrinterListResponse(
    val status: String,
    val printers: List<Printer>
)

data class Printer(
    val printer_id: String,
    val printer_name: String,
    val location: String,
    val status: String,
    val ink_level: String,
    val paper_status: String,
    val shop_name: String
)

data class QueueResponse(
    val status: String,
    val jobs: List<PrintJob>
)

data class PrintJob(
    val job_id: Int,
    val job_uuid: String,
    val original_filename: String,
    val file_format: String,
    val price_bdt: Double,
    val payment_status: String,
    val status: String,
    val upload_time: String,
    val printer_name: String,
    val printer_id: String,
    val username: String
)

data class UploadResponse(
    val status: String,
    val message: String,
    val data: UploadData?
)

data class UploadData(
    val job_id: String,
    val secure_name: String,
    val printer: String
)
```

#### ViewModel Example

```kotlin
class PrintingViewModel(private val api: UCPSApiService) : ViewModel() {
    
    private val _printers = MutableLiveData<List<Printer>>()
    val printers: LiveData<List<Printer>> = _printers

    private val _queue = MutableLiveData<List<PrintJob>>()
    val queue: LiveData<List<PrintJob>> = _queue

    private val _loading = MutableLiveData(false)
    val loading: LiveData<Boolean> = _loading

    private val _error = MutableLiveData<String?>(null)
    val error: LiveData<String?> = _error

    fun loadPrinters() {
        viewModelScope.launch {
            try {
                _loading.value = true
                val response = api.getPrinters()
                if (response.status == "success") {
                    _printers.value = response.printers.filter { it.status == "Online" }
                }
            } catch (e: Exception) {
                _error.value = "Failed to load printers: ${e.message}"
            } finally {
                _loading.value = false
            }
        }
    }

    fun uploadAndPrint(
        file: File,
        userId: Int,
        printerId: String,
        paymentMethod: String = "Cash",
        pageSize: String = "A4",
        pageRange: String = "all",
        copies: Int = 1,
        printColor: String = "monochrome"
    ) {
        viewModelScope.launch {
            try {
                _loading.value = true
                
                val requestFile = file.asRequestBody("application/octet-stream".toMediaType())
                val filePart = MultipartBody.Part.createFormData("print_file", file.name, requestFile)
                
                val userId = RequestBody.create(MediaType.parse("text/plain"), userId.toString())
                val printerId = RequestBody.create(MediaType.parse("text/plain"), printerId)
                val paymentMethod = RequestBody.create(MediaType.parse("text/plain"), paymentMethod)
                val pageSize = RequestBody.create(MediaType.parse("text/plain"), pageSize)
                val pageRange = RequestBody.create(MediaType.parse("text/plain"), pageRange)
                val copies = RequestBody.create(MediaType.parse("text/plain"), copies.toString())
                val printColor = RequestBody.create(MediaType.parse("text/plain"), printColor)

                val response = api.uploadFile(
                    filePart,
                    userId,
                    printerId,
                    paymentMethod,
                    pageSize,
                    pageRange,
                    copies,
                    printColor
                )

                if (response.status == "success") {
                    _error.value = "Upload successful! Job: ${response.data?.job_id}"
                } else {
                    _error.value = response.message
                }
            } catch (e: Exception) {
                _error.value = "Upload failed: ${e.message}"
            } finally {
                _loading.value = false
            }
        }
    }

    fun getQueueForUser(userId: Int) {
        viewModelScope.launch {
            try {
                _loading.value = true
                val response = api.getQueue(userId = userId)
                if (response.status == "success") {
                    _queue.value = response.jobs
                }
            } catch (e: Exception) {
                _error.value = "Failed to load queue: ${e.message}"
            } finally {
                _loading.value = false
            }
        }
    }

    fun pollQueuePeriodically(userId: Int, intervalMillis: Long = 5000) {
        viewModelScope.launch {
            while (isActive) {
                getQueueForUser(userId)
                delay(intervalMillis)
            }
        }
    }
}
```

#### Fragment/Activity Usage

```kotlin
class PrintingFragment : Fragment() {
    
    private val viewModel: PrintingViewModel by viewModels()
    private lateinit var printerAdapter: PrinterAdapter
    private var selectedFile: File? = null

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        // Setup observables
        viewModel.printers.observe(viewLifecycleOwner) { printers ->
            printerAdapter.submitList(printers)
        }

        viewModel.queue.observe(viewLifecycleOwner) { jobs ->
            updateQueueUI(jobs)
        }

        viewModel.error.observe(viewLifecycleOwner) { error ->
            if (error != null) {
                Toast.makeText(context, error, Toast.LENGTH_SHORT).show()
            }
        }

        // Load printers
        viewModel.loadPrinters()

        // Start queue polling
        val userId = getCurrentUserId() // Your method
        viewModel.pollQueuePeriodically(userId)

        // Upload button
        binding.btnUpload.setOnClickListener {
            selectFileAndUpload()
        }
    }

    private fun selectFileAndUpload() {
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "application/pdf|image/*"
        }
        startActivityForResult(intent, REQUEST_CODE_SELECT_FILE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_CODE_SELECT_FILE && resultCode == Activity.RESULT_OK) {
            val uri = data?.data ?: return
            val file = File(getPath(uri))
            selectedFile = file

            // Show print options dialog
            showPrintOptionsDialog(file)
        }
    }

    private fun showPrintOptionsDialog(file: File) {
        val dialog = AlertDialog.Builder(requireContext()).apply {
            setTitle("Print Settings")
            
            // Color mode
            val colorOptions = arrayOf("Monochrome (5 BDT/page)", "Color (15 BDT/page)")
            var selectedColor = 0
            
            // Payment method
            val paymentOptions = arrayOf("Cash", "bKash")
            var selectedPayment = 0

            setMultiChoiceItems(
                arrayOf("Color (15 BDT/page)"),
                booleanArrayOf(false)
            ) { _, which, isChecked ->
                selectedColor = if (isChecked) 1 else 0
            }

            setPositiveButton("Print") { _, _ ->
                val userId = getCurrentUserId()
                val printerId = selectedPrinter.printer_id
                val colorMode = if (selectedColor == 1) "color" else "monochrome"
                
                viewModel.uploadAndPrint(
                    file,
                    userId,
                    printerId,
                    "Cash",
                    "A4",
                    "all",
                    1,
                    colorMode
                )
            }

            setNegativeButton("Cancel", null)
        }.create()

        dialog.show()
    }
}
```

---

## Security Guidelines

### 1. Authentication Security

**DO:**
- Store user ID and role in SharedPreferences or DataStore
- Use HTTPS in production (not HTTP)
- Implement token-based authentication if needed
- Hash sensitive data locally

**DON'T:**
- Store passwords in SharedPreferences
- Send passwords in plain text
- Hardcode credentials
- Log sensitive information

```kotlin
// Secure storage example
private val dataStore = context.dataStore

suspend fun saveUserData(user: UserData) {
    dataStore.edit { preferences ->
        preferences[USER_ID] = user.id
        preferences[USER_ROLE] = user.role
        // DON'T store password!
    }
}
```

### 2. File Upload Security

**DO:**
- Validate file size before upload (max 10MB)
- Check MIME type on client side
- Show user confirmation before upload
- Handle large files with streaming

**DON'T:**
- Upload files without validation
- Trust user-selected filename
- Store sensitive files unencrypted
- Bypass size restrictions

```kotlin
// File validation example
fun isValidFile(file: File): Boolean {
    return when {
        file.length() > 10 * 1024 * 1024 -> {
            showError("File too large (max 10MB)")
            false
        }
        !listOf("pdf", "png", "jpg", "jpeg").contains(file.extension.lowercase()) -> {
            showError("Invalid file type")
            false
        }
        else -> true
    }
}
```

### 3. Network Security

**DO:**
- Use HTTPS in production
- Implement certificate pinning
- Add request timeouts
- Retry failed requests with backoff

**DON'T:**
- Accept all SSL certificates
- Disable security checks
- Send sensitive data over HTTP
- Leave timeouts unlimited

```kotlin
// Network security example
val httpClient = OkHttpClient.Builder()
    .connectTimeout(30, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .writeTimeout(30, TimeUnit.SECONDS)
    // In production, add certificate pinning
    .certificatePinner(
        CertificatePinner.Builder()
            .add("your-server.com", "sha256/...")
            .build()
    )
    .build()
```

### 4. Data Privacy

**DO:**
- Clear sensitive data on logout
- Use encryption for stored documents
- Implement proper access controls
- Follow GDPR/data protection laws

**DON'T:**
- Store unnecessary personal data
- Share user data with third parties
- Cache sensitive information
- Log user credentials or payment data

```kotlin
// Logout with data clearing
fun logout() {
    viewModelScope.launch {
        dataStore.edit { preferences ->
            preferences.clear()
        }
        // Clear app cache
        context.cacheDir.deleteRecursively()
    }
}
```

### 5. API Key Management

For future production use:

```kotlin
// In build.gradle.properties (never commit!)
UCPS_API_BASE_URL=https://api.ucps.com/
API_SECRET_KEY=your_secret_key_here

// Access in code
val baseUrl = BuildConfig.UCPS_API_BASE_URL
val secretKey = BuildConfig.API_SECRET_KEY
```

---

## Testing Checklist

### Authentication Testing
- [ ] Login with valid credentials
- [ ] Login with invalid credentials
- [ ] Register new student account
- [ ] Register new operator account
- [ ] Duplicate email registration

### Printer Testing
- [ ] Load printer list
- [ ] Filter online printers only
- [ ] Handle offline printers
- [ ] Display printer details

### Upload Testing
- [ ] Upload PDF file
- [ ] Upload image (PNG/JPG)
- [ ] Test file size limit (10MB)
- [ ] Test invalid file format
- [ ] Test with different print settings

### Queue Testing
- [ ] View personal print jobs
- [ ] View operator queue
- [ ] Real-time queue updates
- [ ] Job status transitions

### Payment Testing
- [ ] Cash payment workflow
- [ ] bKash payment workflow
- [ ] Payment status updates

### Cloud Drive Testing
- [ ] Save document to drive
- [ ] List saved documents
- [ ] Print from drive
- [ ] Delete from drive
- [ ] Rename document

---

## Troubleshooting

### Common Issues

#### 401 Unauthorized
**Cause:** Invalid credentials or expired session
**Solution:** 
- Verify email and password
- Clear cached user data
- Re-login

#### 500 Server Error
**Cause:** Server-side error
**Solution:**
- Check server logs
- Verify database connectivity
- Contact administrator

#### Network Timeout
**Cause:** Slow connection or server not responding
**Solution:**
- Increase timeout duration
- Check internet connectivity
- Retry operation

#### File Upload Fails
**Cause:** File too large or invalid format
**Solution:**
- Compress file size
- Use supported formats (PDF, PNG, JPG)
- Check file permissions

---

## API Rate Limits

To prevent server overload:
- **Maximum requests:** 100 per minute per IP
- **Recommended polling interval:** 5-10 seconds (students), 3 seconds (operators)
- **File upload max:** 10MB per file

---

## Changelog

**Version 1.0 (July 19, 2025)**
- Initial API documentation
- 20+ endpoints documented
- Complete code examples
- Security guidelines
- Testing checklist

---

## Support & Feedback

For issues or feature requests:
- GitHub Issues: https://github.com/wahidfarhan/UniversalPrinter
- Email: wahidfarhan@example.com

---

**Document Version:** 1.0  
**Last Updated:** July 19, 2025  
**Author:** UCPS Team  
**License:** MIT
