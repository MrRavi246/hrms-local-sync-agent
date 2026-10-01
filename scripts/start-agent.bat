@echo off
REM ==============================================================================
REM CMK HRMS Local Sync Agent: Interactive Console Launcher
REM ==============================================================================

cd /d "%~dp0.."
echo Starting CMK HRMS Local Sync Agent in interactive console mode...
echo Press Ctrl+C to stop.
echo.

call npm run dev
pause
