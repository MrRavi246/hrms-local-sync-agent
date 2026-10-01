# CMK HRMS Local Biometric Sync Agent — Field Technician Setup Sheet

This quick setup sheet is intended for field IT engineers and system administrators installing the Sync Agent on the office Windows PC connected to biometric hardware and SQL Server Express.

---

## 📋 Pre-Installation Checklist

- [ ] Office Windows PC/Laptop is powered on and connected to local office LAN / Wi-Fi.
- [ ] Biometric software (e.g. eTimeTrack, ZKTeco, Matrix) is running and logging punches to SQL Server Express.
- [ ] You have Administrator access to the Windows machine.
- [ ] Internet access is active (can open `https://cmkhr.com` in a browser).

---

## 🛠️ Step-by-Step Installation

### Step 1: Install Node.js LTS
1. Download **Node.js LTS (v18 or v20)** from [https://nodejs.org](https://nodejs.org).
2. Run installer with default settings.
3. Open Command Prompt (`cmd`) and verify:
   ```cmd
   node -v
   npm -v
   ```

### Step 2: Configure SQL Server Express
1. Open **Sql Server Configuration Manager**:
   - Go to **SQL Server Network Configuration** -> **Protocols for SQLEXPRESS**.
   - Ensure **TCP/IP** is **Enabled**.
   - Restart the **SQL Server (SQLEXPRESS)** service.
2. In Windows Services (`services.msc`), ensure **SQL Server Browser** is **Running** and set to **Automatic**.
3. In SSMS, verify **Server Properties** -> **Security** is set to **SQL Server and Windows Authentication mode**.

### Step 3: Create Read-Only User in SQL Server
1. In SSMS, open `scripts\create_sql_server_readonly_user.sql`.
2. Replace `[BiometricDB]` with the vendor database name and set a secure password.
3. Execute the script to create `hrms_sync_user`.

### Step 4: Extract and Configure Agent
1. Place this agent folder at `C:\CMK-HRMS-SyncAgent`.
2. Open Command Prompt in this folder and install dependencies:
   ```cmd
   npm install
   ```
3. Auto-discover the database name:
   ```cmd
   npm run diagnose
   ```
4. Copy `.env.example` to `.env`:
   ```cmd
   copy .env.example .env
   ```
5. Edit `.env` and fill in:
   - `DB_NAME=<Discovered DB Name>`
   - `DB_USER=hrms_sync_user`
   - `DB_PASSWORD=<Your chosen password>`
   - `SYNC_TOKEN=<Token generated in CMK HRMS Admin -> Integrations -> Attendance Sync>`

### Step 5: Test Connectivity
Run connection and dry-run tests:
```cmd
npm run test-connection
npm run dry-run
```
Both commands must report **SUCCESS**.

### Step 6: Install as Windows Background Service
1. In Windows Explorer, open `scripts\`.
2. Right-click **`install-windows-service.bat`** and click **"Run as administrator"**.
3. The script will automatically compile, install, and start the **`CMKHrmsSyncAgent`** Windows Service.

---

## ✅ Post-Installation Verification

1. **Verify Windows Service:**
   - Press `Win + R` -> type `services.msc` -> press Enter.
   - Find `CMKHrmsSyncAgent` -> Status must be **Running**, Startup Type: **Automatic**.
2. **Verify Local Diagnostic Endpoint:**
   - Open browser: `http://127.0.0.1:8088/health`
   - Should return `"status": "HEALTHY"` with live SQL and HRMS API connection status.
3. **Verify in CMK HRMS Cloud:**
   - Log into `https://cmkhr.com` -> Admin Suite -> Integrations -> Attendance Sync.
   - The device status should show **ONLINE** with a green badge and recent heartbeat timestamp.

---

## 📞 Support & Emergency Operations

- **Restart Service:** `net stop CMKHrmsSyncAgent` then `net start CMKHrmsSyncAgent`
- **View Recent Logs:** Open `logs\agent-YYYY-MM-DD.log`
- **Force Immediate Sync:** Run `curl -X POST http://127.0.0.1:8088/sync-now`
