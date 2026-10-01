-- ==============================================================================
-- CMK HRMS: Production SQL Server Express Dedicated Read-Only User Setup
-- Run this script inside SQL Server Management Studio (SSMS) on the Windows PC
-- ==============================================================================

USE [master];
GO

-- Step 1: Create SQL Server Authentication Login
-- IMPORTANT: Replace 'Change_This_Secure_Password_2026!' with a strong password!
IF NOT EXISTS (SELECT name FROM sys.server_principals WHERE name = 'hrms_sync_user')
BEGIN
    CREATE LOGIN [hrms_sync_user] 
    WITH PASSWORD = 'Change_This_Secure_Password_2026!',
    CHECK_EXPIRATION = OFF,
    CHECK_POLICY = ON;
    PRINT 'Login [hrms_sync_user] created successfully.';
END
ELSE
BEGIN
    PRINT 'Login [hrms_sync_user] already exists.';
END
GO

-- Step 2: Switch to your biometric vendor database
-- (Replace [BiometricDB] with the discovered database name, e.g. [eTimeTrack] or [RealtimeBiometrics])
-- USE [BiometricDB];
-- GO

-- Step 3: Create database user mapped to the login
-- IF NOT EXISTS (SELECT name FROM sys.database_principals WHERE name = 'hrms_sync_user')
-- BEGIN
--     CREATE USER [hrms_sync_user] FOR LOGIN [hrms_sync_user];
--     PRINT 'Database user [hrms_sync_user] created.';
-- END
-- GO

-- Step 4: Grant strict READ ONLY (SELECT) permission on AttendanceLogs
-- GRANT SELECT ON [dbo].[AttendanceLogs] TO [hrms_sync_user];
-- PRINT 'SELECT permission granted on [AttendanceLogs].';
-- GO

-- Step 5: Explicitly DENY all write, update, delete, or alter operations (Defense-in-depth)
-- DENY INSERT, UPDATE, DELETE, ALTER, DROP ON [dbo].[AttendanceLogs] TO [hrms_sync_user];
-- PRINT 'Write and alter permissions explicitly DENIED on [AttendanceLogs].';
-- GO
