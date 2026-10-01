# CMK HRMS: Local Biometric SQL Database Sync Agent

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Database](https://img.shields.io/badge/MS%20SQL%20Server-Express%202012--2022-red.svg)](https://www.microsoft.com/sql-server/)
[![Windows Service](https://img.shields.io/badge/Windows%20Service-Auto--Start-0078D6.svg)](https://learn.microsoft.com/windows/)

Autonomous, outbound-only Windows synchronization service for Microsoft SQL Server Express biometric attendance databases. Seamlessly streams punch clock records from local office PCs to the **CMK HRMS Cloud API** without opening any inbound firewall ports.

---

## ⚡ 5-Minute Quick Setup Checklist (Office Windows PC)

If you have physical or remote desktop access to the office Windows PC hosting the biometric software and SQL Server Express, follow this quick checklist:

1. **Prerequisites:** Ensure **Node.js (>= 18 LTS)** is installed from [nodejs.org](https://nodejs.org).
2. **Extract Files:** Copy this entire `hrms-local-sync-agent` folder to `C:\CMK-HRMS-SyncAgent` (or any persistent folder).
3. **Install Dependencies:** Open Command Prompt or PowerShell in this folder and run:
   ```cmd
   npm install
   ```
4. **Discover Biometric Database:** Run the auto-detection tool to find your biometric database:
   ```cmd
   npm run diagnose
   ```
   *(Note down the database name printed on screen, e.g., `BiometricDB` or `eTimeTrack`)*.
5. **Configure Environment:**
   - Copy `.env.example` to `.env`:
     ```cmd
     copy .env.example .env
     ```
   - Open `.env` in Notepad and set `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `SYNC_TOKEN` (generated in CMK HRMS Admin -> Integrations -> Attendance Sync).
6. **Verify Connectivity:**
   ```cmd
   npm run test-connection
   npm run dry-run
   ```
7. **Install as Permanent Background Service:**
   - Right-click `scripts\install-windows-service.bat` and select **"Run as administrator"**.
   - Done! The agent will start immediately and run silently in the background on every Windows boot.

---

## 📑 Table of Contents

1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Security Architecture (Zero Inbound Rules)](#2-security-architecture-zero-inbound-rules)
3. [System Requirements](#3-system-requirements)
4. [SQL Server Express Pre-Configuration](#4-sql-server-express-pre-configuration)
5. [Creating a Dedicated Read-Only SQL User](#5-creating-a-dedicated-read-only-sql-user)
6. [Detailed Environment Configuration (.env)](#6-detailed-environment-configuration-env)
7. [Getting the SYNC_TOKEN from CMK HRMS](#7-getting-the-sync_token-from-cmk-hrms)
8. [Automated Diagnostic & Verification CLI Tools](#8-automated-diagnostic--verification-cli-tools)
   - [A. Database & Schema Discovery (`npm run diagnose`)](#a-database--schema-discovery-npm-run-diagnose)
   - [B. Connection Health Test (`npm run test-connection`)](#b-connection-health-test-npm-run-test-connection)
   - [C. Dry Run Simulation (`npm run dry-run`)](#c-dry-run-simulation-npm-run-dry-run)
9. [Running Interactively (Development / Testing)](#9-running-interactively-development--testing)
10. [Installing as an Autonomous Windows Background Service](#10-installing-as-an-autonomous-windows-background-service)
11. [Service Management (Start, Stop, Restart, Status)](#11-service-management-start-stop-restart-status)
12. [Local Diagnostic Health Check & On-Demand Sync](#12-local-diagnostic-health-check--on-demand-sync)
13. [Persistent State & Crash Recovery (SQLite + JSON WAL)](#13-persistent-state--crash-recovery-sqlite--json-wal)
14. [Updating the Agent](#14-updating-the-agent)
15. [Troubleshooting Guide & FAQ](#15-troubleshooting-guide--faq)

---

## 1. System Overview & Architecture

The **CMK HRMS Local Sync Agent** is an autonomous Node.js service installed on the office Windows laptop/PC where the biometric vendor software (ZKTeco, eSSL, Realtime, Matrix) and SQL Server Express (`DESKTOP-0424DUH\SQLEXPRESS`) reside.

- **Strictly Local & Read-Only:** Connects locally to SQL Server Express to read punch records. Never alters or modifies biometric tables.
- **Dynamic Schema Inspection:** Automatically discovers primary keys, identity columns (e.g. `LogId`), and timestamps to construct the optimal cursor strategy.
- **Incremental Batch Sync:** Synchronizes in small, configurable batches (default 500 records), advancing the cursor only after the server acknowledges successful ingestion.
- **Fail-Safe Persistence:** Local state is saved simultaneously in SQLite (`data/sync-agent.sqlite3`) and an atomic JSON file (`data/sync-state.json`) with automated backup snapshots.
- **Zero Duplicate Guarantee:** Enforces deterministic SHA-256 idempotency hashing for every punch log.

```
+-------------------------------------------------------------------------+
|                        OFFICE WINDOWS LAPTOP / PC                       |
|                                                                         |
|  +---------------------------+       +-------------------------------+  |
|  | Biometric Vendor Software |       |  Local SQL Server Express     |  |
|  | (ZKTeco / eSSL / Matrix)  | ----> |  DESKTOP-0424DUH\SQLEXPRESS   |  |
|  +---------------------------+       |  Table: AttendanceLogs        |  |
|                                      +-------------------------------+  |
|                                                      │                  |
|                                            (Strictly Read-Only)         |
|                                                      ▼                  |
|                                      +-------------------------------+  |
|                                      |   HRMS LOCAL SYNC AGENT       |  |
|                                      |   - Schema Discovery          |  |
|                                      |   - Incremental Batches (500) |  |
|                                      |   - State (SQLite + JSON WAL) |  |
|                                      |   - Heartbeat & Diagnostics   |  |
|                                      +-------------------------------+  |
+------------------------------------------------------│------------------+
                                                       │ Outbound HTTPS (443)
                                                       │ X-Integration-Key
                                                       ▼
                                      +-------------------------------+
                                      |      CMK HRMS CLOUD API       |
                                      |     https://cmkhr.com/api/v1  |
                                      +-------------------------------+
                                                       │
                                                       │ Deduplicates & Validates
                                                       │ Runs Shift & Late Rules
                                                       ▼
                                      +-------------------------------+
                                      |      CMK HRMS DATABASE        |
                                      |   Attendance & Punch Logs     |
                                      +-------------------------------+
```

---

## 2. Security Architecture (Zero Inbound Rules)

1. **No Inbound Open Ports:** The office laptop does **NOT** listen for connections from the internet. Do **NOT** configure port forwarding or open router ports.
2. **Encrypted Outbound HTTPS Only:** All communication is strictly outbound over standard port 443 (`https://cmkhr.com/api/v1`).
3. **Machine-to-Machine Secret Authentication:** Every request transmits an `X-Integration-Key` header (`cmk_sync_...`), validated against SHA-256 hashed keys stored in the HRMS database.
4. **Credential Masking:** The internal logger automatically redacts passwords (`DB_PASSWORD`), authentication tokens (`SYNC_TOKEN`), and authorization headers from console output and disk logs.
5. **Local Loopback Isolation:** The diagnostic HTTP server (`http://127.0.0.1:8088/health`) binds strictly to `127.0.0.1`, refusing connections from any external or local area network IPs.

---

## 3. System Requirements

- **Operating System:** Windows 10, Windows 11, or Windows Server 2016 / 2019 / 2022 (64-bit recommended)
- **Node.js:** Version 18.0.0 or higher ([Download Node.js LTS](https://nodejs.org))
- **Biometric Database:** Microsoft SQL Server Express 2012, 2014, 2016, 2017, 2019, or 2022
- **Network Access:** Outbound HTTPS access to `https://cmkhr.com`

---

## 4. SQL Server Express Pre-Configuration

To allow the Node.js agent to communicate with SQL Server Express locally, verify these three standard settings:

### 1. Enable SQL Server Mixed Mode Authentication
1. Open **SQL Server Management Studio (SSMS)**.
2. Connect to `DESKTOP-0424DUH\SQLEXPRESS` using Windows Authentication.
3. Right-click the server instance name in Object Explorer -> select **Properties**.
4. Go to the **Security** page.
5. Under "Server authentication", select **SQL Server and Windows Authentication mode**.
6. Click **OK**.

### 2. Enable TCP/IP Protocol
1. Press `Win + R`, type `compmgmt.msc` or open **Sql Server Configuration Manager**.
2. Expand **SQL Server Network Configuration** -> click **Protocols for SQLEXPRESS**.
3. Right-click **TCP/IP** -> select **Enable**.
4. Double-click **TCP/IP** -> switch to the **IP Addresses** tab:
   - Scroll down to the **IPAll** section at the bottom.
   - If **TCP Dynamic Ports** has a value, note it, or set **TCP Port** to `1433`.
5. Click **OK**.

### 3. Start SQL Server Browser Service
1. In SQL Server Configuration Manager, click **SQL Server Services**.
2. Ensure **SQL Server Browser** is set to **Automatic** and state is **Running**.
3. Right-click **SQL Server (SQLEXPRESS)** -> click **Restart**.

---

## 5. Creating a Dedicated Read-Only SQL User

For production deployments, create a dedicated read-only login rather than using `sa`.

Open **SQL Server Management Studio (SSMS)** as an Administrator, open `scripts/create_sql_server_readonly_user.sql`, and run:

```sql
USE [master];
GO

-- 1. Create Login
CREATE LOGIN [hrms_sync_user] 
WITH PASSWORD = 'YourStrongPasswordHere_2026!',
CHECK_EXPIRATION = OFF,
CHECK_POLICY = ON;
GO

-- 2. Switch to your Biometric Vendor Database (replace with actual name discovered via 'npm run diagnose')
USE [BiometricDB];
GO

-- 3. Create User in Database
CREATE USER [hrms_sync_user] FOR LOGIN [hrms_sync_user];
GO

-- 4. Grant strict SELECT permission ONLY on AttendanceLogs
GRANT SELECT ON [dbo].[AttendanceLogs] TO [hrms_sync_user];
GO

-- 5. Explicitly DENY all write, update, delete, or alter operations (Defense-in-Depth)
DENY INSERT, UPDATE, DELETE, ALTER, DROP ON [dbo].[AttendanceLogs] TO [hrms_sync_user];
GO
```

---

## 6. Detailed Environment Configuration (.env)

Copy `.env.example` to `.env`:
```cmd
copy .env.example .env
```

Open `.env` in any text editor and adjust the settings:

```ini
# ==============================================================================
# 1. LOCAL SQL SERVER CONNECTION
# ==============================================================================
# Hostname or IP of local PC (default: DESKTOP-0424DUH or localhost)
DB_SERVER=DESKTOP-0424DUH\SQLEXPRESS

# SQL Server Named Instance (e.g. SQLEXPRESS)
DB_INSTANCE=SQLEXPRESS

# SQL Server Port (leave blank when using named instance SQLEXPRESS with dynamic ports)
DB_PORT=

# Biometric database name (discovered via 'npm run diagnose')
DB_NAME=BiometricDB

# SQL Server credentials
DB_USER=hrms_sync_user
DB_PASSWORD=YourStrongPasswordHere_2026!

# Connection encryption flags
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true

# Source Attendance Table Name (default: AttendanceLogs)
SOURCE_TABLE=AttendanceLogs

# ==============================================================================
# 2. CMK HRMS CLOUD API
# ==============================================================================
HRMS_API_URL=https://cmkhr.com/api/v1
SYNC_TOKEN=cmk_sync_xxxxxxxxxxxxxxxxxxxxxxxx

# ==============================================================================
# 3. DEVICE IDENTIFICATION
# ==============================================================================
DEVICE_ID=OFFICE-PC-01
DEVICE_NAME=Main Office Biometric Laptop

# ==============================================================================
# 4. RUNTIME SETTINGS
# ==============================================================================
SYNC_INTERVAL_SECONDS=60
SYNC_BATCH_SIZE=500
HEARTBEAT_INTERVAL_SECONDS=60
SYNC_DRY_RUN=false
AGENT_PORT=8088
LOG_LEVEL=info
```

---

## 7. Getting the SYNC_TOKEN from CMK HRMS

1. Open your browser and navigate to `https://cmkhr.com`.
2. Log in as an administrator (e.g. `admin@cmkindia.com`).
3. In the sidebar, navigate to **Admin Suite** -> **Integrations** -> **Attendance Sync**.
4. Click **Register Device**.
5. Enter:
   - **Device ID:** `OFFICE-PC-01`
   - **Device Name:** `Main Office Biometric Laptop`
6. Click **Generate Device Key**.
7. Copy the key (format: `cmk_sync_xxxxxxxxxxxxxxxxxxxxxxxx`) and paste it as `SYNC_TOKEN` in your `.env` file.

---

## 8. Automated Diagnostic & Verification CLI Tools

The agent includes dedicated CLI tools to inspect, test, and preview synchronization before going live.

### A. Database & Schema Discovery (`npm run diagnose`)
```cmd
npm run diagnose
```
- Discovers all databases present on `DESKTOP-0424DUH\SQLEXPRESS`.
- Searches for attendance tables (`AttendanceLogs`, `DeviceLogs`, etc.).
- Inspects columns, data types, primary keys, identity properties, and total record counts.
- Displays the exact database name and suggested `.env` settings.

### B. Connection Health Test (`npm run test-connection`)
```cmd
npm run test-connection
```
- Performs a live ping and latency test against SQL Server Express.
- Validates database credentials and verifies `SELECT` permissions on `AttendanceLogs`.
- Performs an outbound HTTPS handshake with `https://cmkhr.com/api/v1/integration/heartbeat`.
- Validates the `SYNC_TOKEN`.

### C. Dry Run Simulation (`npm run dry-run`)
```cmd
npm run dry-run
```
- Connects to SQL Server and reads the latest batch of un-synced attendance punches.
- Parses and normalizes dates, employee IDs, and punch directions.
- Prints a preview of the records to the console.
- **Does NOT** push records to the cloud server.
- **Does NOT** advance the local cursor.
- Completely safe to run at any time.

---

## 9. Running Interactively (Development / Testing)

To run the agent in the foreground and watch live sync logs in your terminal:

```cmd
# Development mode with hot-reloading
npm run dev

# Or run the Windows launcher batch file
scripts\start-agent.bat
```

Sample output:
```
======================================================================
  CMK HRMS: LOCAL BIOMETRIC SQL SERVER DATABASE SYNC AGENT
======================================================================
[INFO] Starting CMK HRMS Local Sync Agent v1.0.0...
[INFO] Loaded persistent sync state from SQLite. Last cursor: 18293
[INFO] Connecting to SQL Server [DESKTOP-0424DUH\SQLEXPRESS] Database: [BiometricDB]...
[INFO] ✅ Successfully connected to SQL Server Express database.
[INFO] Target Biometric Table: [dbo].[AttendanceLogs] (Total records: 18,318)
[INFO] Selected Cursor Strategy: IDENTITY on column [LogId]
[INFO] 🚀 Starting Sync Engine schedulers (Interval: 60s, Batch: 500)
[INFO] 🏥 Local diagnostic health server listening at http://127.0.0.1:8088/health
[INFO] [SyncEngine] Found 25 new records in SQL Server
[INFO] [SyncEngine] Sending batch of 25 records to HRMS API (RequestId: req_1727702403)...
[INFO] [SyncEngine] ✅ HRMS processed 25 records: 25 new inserted, 0 duplicates skipped.
[INFO] [SyncEngine] 💾 Cursor updated safely: 18318
```

---

## 10. Installing as an Autonomous Windows Background Service

In production, the agent must run continuously in the background, even when no user is logged into the Windows laptop.

### One-Click Installation:
1. Open Windows Explorer and navigate to `scripts\`.
2. Right-click **`install-windows-service.bat`** and click **"Run as administrator"**.
3. The script will:
   - Compile the TypeScript codebase to `dist/`.
   - Download NSSM (Non-Sucking Service Manager) if needed.
   - Register a Windows Service named **`CMKHrmsSyncAgent`**.
   - Configure startup type as **Automatic** (starts when Windows boots).
   - Configure **automatic restart** after 10 seconds if any unexpected termination occurs.
   - Redirect standard output and errors to `logs/service-stdout.log` and `logs/service-stderr.log`.
   - Start the service immediately.

---

## 11. Service Management (Start, Stop, Restart, Status)

### Via Windows Services Manager (`services.msc`):
1. Press `Win + R`, type `services.msc`, and press Enter.
2. Locate **CMK HRMS Biometric Attendance Local SQL Server Express Sync Agent** (Service name: `CMKHrmsSyncAgent`).
3. Right-click to **Start**, **Stop**, or **Restart**.
4. Confirm Status is **Running** and Startup Type is **Automatic**.

### Via Command Line (Run as Administrator):
```cmd
# Check status
sc query CMKHrmsSyncAgent

# Stop the service
net stop CMKHrmsSyncAgent

# Start the service
net start CMKHrmsSyncAgent

# Uninstall the service
scripts\uninstall-windows-service.bat
```

---

## 12. Local Diagnostic Health Check & On-Demand Sync

While running, the agent provides a local loopback HTTP endpoint for monitoring.

### Check Agent Health:
Open your browser or run:
```cmd
curl http://127.0.0.1:8088/health
```

Sample JSON response:
```json
{
  "status": "HEALTHY",
  "agent": {
    "version": "1.0.0",
    "deviceId": "OFFICE-PC-01",
    "deviceName": "Main Office Biometric Laptop",
    "uptimeSeconds": 86420,
    "dryRunMode": false
  },
  "sqlServer": {
    "target": "DESKTOP-0424DUH\\SQLEXPRESS",
    "database": "BiometricDB",
    "connected": true,
    "latencyMs": 3
  },
  "hrmsApi": {
    "url": "https://cmkhr.com/api/v1",
    "connected": true,
    "status": 200
  },
  "syncState": {
    "cursor": "18318",
    "cursorColumn": "LogId",
    "cursorType": "identity",
    "totalRecordsSynced": 18318,
    "pendingRecords": 0,
    "lastSyncAt": "2026-09-30T16:00:04.120Z",
    "lastHeartbeatAt": "2026-09-30T16:00:02.000Z",
    "consecutiveFailures": 0
  }
}
```

### Force an On-Demand Immediate Sync:
```cmd
curl -X POST http://127.0.0.1:8088/sync-now
```

---

## 13. Persistent State & Crash Recovery (SQLite + JSON WAL)

The agent maintains synchronization state across Windows restarts, power cuts, and network outages through a dual-persistence strategy:

1. **SQLite Database (`data/sync-agent.sqlite3`):** High-performance ACID-compliant local database storing sync history, last cursors, and batch logs.
2. **Atomic JSON WAL (`data/sync-state.json`):** Human-readable, atomic write-ahead state file backed up to `data/sync-state.json.bak`.
3. **Network Resiliency:** If internet access fails:
   - Punch records accumulate normally in SQL Server Express.
   - The sync agent enters exponential backoff retry mode.
   - Cursor is **never** advanced until the cloud server responds with an HTTP 200 success receipt.
   - When the internet recovers, all pending records stream in successive 500-record batches.

### Resetting Cursor / Forcing Complete Re-Sync:
If you ever need to re-sync historical records from scratch:
```cmd
node -e "require('./dist/state/state-manager').stateManager.resetCursor(null)"
```
Because the cloud backend enforces deterministic SHA-256 idempotency, re-sending previous records is 100% safe—duplicate records are recognized and skipped automatically without creating redundant punches.

---

## 14. Updating the Agent

To deploy an updated version of the sync agent:
1. Open Command Prompt as Administrator and stop the service:
   ```cmd
   net stop CMKHrmsSyncAgent
   ```
2. Replace project files with the new version (do **not** delete the `data/` folder).
3. Install dependencies and recompile:
   ```cmd
   npm install
   npm run build
   ```
4. Restart the service:
   ```cmd
   net start CMKHrmsSyncAgent
   ```
The agent will automatically pick up from the existing cursor stored in `data/sync-agent.sqlite3`!

---

## 15. Troubleshooting Guide & FAQ

| Problem | Probable Cause | Corrective Action |
| :--- | :--- | :--- |
| `getaddrinfo ENOTFOUND desktop-0424duh` | Windows machine name is not resolving | In `.env`, set `DB_SERVER=localhost` or `DB_SERVER=127.0.0.1` |
| `Login failed for user 'sa'` or `hrms_sync_user` | Wrong password or SQL Server in Windows-only mode | In SSMS -> Server Properties -> Security -> select "SQL Server and Windows Authentication mode", restart SQL service |
| `Failed to connect to ... Port 1433` | TCP/IP disabled in SQL Configuration Manager | Open SQL Server Configuration Manager -> Protocols for SQLEXPRESS -> Enable TCP/IP -> Restart service |
| `SQL Server Browser service not responding` | Browser service stopped | Open Services -> Start **SQL Server Browser** and set to Automatic |
| `401 Unauthorized: Invalid SYNC_TOKEN` | Token mismatch or expired in HRMS | In CMK HRMS Admin -> Integrations -> Regenerate Key, then update `SYNC_TOKEN` in `.env` |
| `Network error: ENOTFOUND cmkhr.com` | Office internet connection down | The agent will automatically queue records locally and retry once internet restores |
| `EADDRINUSE: port 8088 already in use` | Another program using port 8088 | In `.env`, change `AGENT_PORT=8089` |
| `Cannot find module ... dist/index.js` | TypeScript not compiled | Run `npm run build` |

---

## 📁 Log File Locations

Logs rotate daily with automatic 30-day retention in the `logs/` directory:
- **`logs/agent-YYYY-MM-DD.log`** — Application runtime events, batch metrics, and heartbeats.
- **`logs/error-YYYY-MM-DD.log`** — Exceptions, connection errors, and stack traces.
- **`logs/service-stdout.log`** — Windows background service standard output.
- **`logs/service-stderr.log`** — Windows background service standard error.

---

## 📄 License & Maintainer

- **Developer:** CMK HRMS Engineering Team
- **Internal System:** Proprietary enterprise sync client for CMK Enterprise. All rights reserved.
