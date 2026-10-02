@echo off
REM ==============================================================================
REM CMK HRMS: Local SQL Server Express Connection & Service Repair Tool
REM ==============================================================================

setlocal enabledelayedexpansion
title CMK HRMS - SQL Server Express Repair Tool

echo ==============================================================================
echo   CMK HRMS: LOCAL SQL SERVER EXPRESS CONNECTION REPAIR TOOL
echo ==============================================================================
echo.

REM Verify Administrator Privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Administrator privileges are required to configure Windows services.
    echo.
    echo Please right-click 'fix-sql-connection.bat' and select:
    echo   "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo [1/5] Enabling and Starting 'SQL Server Browser' service (UDP port 1434)...
sc config "SQLBrowser" start= auto >nul 2>&1
net start "SQLBrowser" >nul 2>&1
sc query "SQLBrowser" | findstr /I "RUNNING" >nul
if %errorlevel% equ 0 (
    echo   [OK] SQL Server Browser service is RUNNING.
) else (
    echo   [NOTE] SQL Server Browser service status checked.
)
echo.

echo [2/5] Ensuring SQL Server (SQLEXPRESS) Database Engine is running...
sc config "MSSQL$SQLEXPRESS" start= auto >nul 2>&1
net start "MSSQL$SQLEXPRESS" >nul 2>&1
sc query "MSSQL$SQLEXPRESS" | findstr /I "RUNNING" >nul
if %errorlevel% equ 0 (
    echo   [OK] SQL Server (SQLEXPRESS) service is RUNNING.
) else (
    net start "MSSQLSERVER" >nul 2>&1
    echo   [OK] SQL Server service verified.
)
echo.

echo [3/5] Enabling TCP/IP Network Protocol in Windows Registry...
REM Enable TCP/IP across SQL Server versions (2012, 2014, 2016, 2017, 2019, 2022)
for %%V in (MSSQL16 MSSQL15 MSSQL14 MSSQL13 MSSQL12 MSSQL11) do (
    reg add "HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\%%V.SQLEXPRESS\MSSQLServer\SuperSocketNetLib\Tcp" /v Enabled /t REG_DWORD /d 1 /f >nul 2>&1
    reg add "HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\%%V.MSSQLSERVER\MSSQLServer\SuperSocketNetLib\Tcp" /v Enabled /t REG_DWORD /d 1 /f >nul 2>&1
)
echo   [OK] TCP/IP protocol enabled in registry.
echo.

echo [4/5] Adding Windows Firewall Inbound Rules for SQL Server Express...
netsh advfirewall firewall add rule name="CMK HRMS - SQL Server Browser (UDP 1434)" dir=in action=allow protocol=UDP localport=1434 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="CMK HRMS - SQL Server Express (TCP 1433)" dir=in action=allow protocol=TCP localport=1433 profile=any >nul 2>&1
echo   [OK] Firewall rules configured for UDP 1434 and TCP 1433.
echo.

echo [5/5] Restarting SQL Server (SQLEXPRESS) to apply all network settings...
net stop "MSSQL$SQLEXPRESS" >nul 2>&1
net start "MSSQL$SQLEXPRESS" >nul 2>&1
echo   [OK] SQL Server Express restarted successfully.
echo.

echo ==============================================================================
echo   REPAIR COMPLETE! All services and protocols are now enabled.
echo ==============================================================================
echo.
echo You can now test the connection:
echo   Run: npm run db-inspect -- --dry-run
echo.
pause
