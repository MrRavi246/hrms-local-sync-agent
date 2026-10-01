@echo off
REM ==============================================================================
REM CMK HRMS Local Sync Agent: Quick Diagnostic Runner
REM ==============================================================================

cd /d "%~dp0.."
echo Running Biometric SQL Server and HRMS Connection Diagnostics...
echo.

call npm run diagnose
pause
