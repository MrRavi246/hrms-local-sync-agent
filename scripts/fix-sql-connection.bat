@echo off
REM ==============================================================================
REM CMK HRMS: One-Click SQL Server Express Connection Fix (Run as Administrator)
REM ==============================================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo ==============================================================================
    echo [ELEVATION REQUIRED] Please run this script as Administrator:
    echo 1. Right-click 'fix-sql-connection.bat'
    echo 2. Select 'Run as administrator'
    echo ==============================================================================
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-sql-connection.ps1"
echo.
pause
