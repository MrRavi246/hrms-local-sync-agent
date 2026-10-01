@echo off
REM ==============================================================================
REM CMK HRMS Local Sync Agent: Windows Background Service Uninstaller
REM Run this script as ADMINISTRATOR
REM ==============================================================================

echo.
echo ======================================================================
echo   CMK HRMS: Local Biometric Sync Agent Windows Service Uninstaller
echo ======================================================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Must be executed as Administrator.
    pause
    exit /b 1
)

set SERVICE_NAME=CMKHrmsSyncAgent
set NSSM_EXE=nssm
if exist "%~dp0nssm.exe" set NSSM_EXE=%~dp0nssm.exe

echo Stopping service %SERVICE_NAME%...
"%NSSM_EXE%" stop %SERVICE_NAME%

echo Removing service %SERVICE_NAME%...
"%NSSM_EXE%" remove %SERVICE_NAME% confirm

echo.
echo Service %SERVICE_NAME% has been uninstalled successfully.
pause
