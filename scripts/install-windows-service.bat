@echo off
REM ==============================================================================
REM CMK HRMS Local Sync Agent: Windows Background Service Installer (using NSSM)
REM Run this script as ADMINISTRATOR
REM ==============================================================================

echo.
echo ======================================================================
echo   CMK HRMS: Local Biometric Sync Agent Windows Service Installer
echo ======================================================================
echo.

REM Verify Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This installer must be executed as Administrator.
    echo Right-click this script and select "Run as administrator".
    pause
    exit /b 1
)

set SERVICE_NAME=CMKHrmsSyncAgent
set AGENT_DIR=%~dp0..
cd /d "%AGENT_DIR%"

echo Current Directory: %CD%

REM Check if Node is installed
where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH. Please install Node.js (>= 18) from https://nodejs.org
    pause
    exit /b 1
)

for /f "delims=" %%i in ('where node') do set NODE_EXE=%%i
echo Found Node.js executable at: %NODE_EXE%

REM Build TypeScript code if dist does not exist
if not exist "dist\index.js" (
    echo.
    echo Compiling TypeScript project...
    call npm run build
)

REM Check if NSSM is available in scripts\nssm or in PATH
set NSSM_EXE=nssm
where nssm >nul 2>&1
if %errorLevel% neq 0 (
    if exist "%AGENT_DIR%\scripts\nssm.exe" (
        set NSSM_EXE=%AGENT_DIR%\scripts\nssm.exe
    ) else (
        echo.
        echo [INFO] NSSM (Non-Sucking Service Manager) is recommended for Windows service management.
        echo Downloading NSSM helper...
        powershell -Command "Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile '%TEMP%\nssm.zip'; Expand-Archive '%TEMP%\nssm.zip' -DestinationPath '%TEMP%\nssm_extracted' -Force; Copy-Item '%TEMP%\nssm_extracted\nssm-2.24\win64\nssm.exe' '%AGENT_DIR%\scripts\nssm.exe' -Force"
        if exist "%AGENT_DIR%\scripts\nssm.exe" (
            set NSSM_EXE=%AGENT_DIR%\scripts\nssm.exe
            echo NSSM successfully downloaded to scripts\nssm.exe
        ) else (
            echo Could not auto-download NSSM. You can manually download nssm.exe to scripts\ folder.
        )
    )
)

echo.
echo Installing Windows Service: %SERVICE_NAME%...

"%NSSM_EXE%" stop %SERVICE_NAME% >nul 2>&1
"%NSSM_EXE%" remove %SERVICE_NAME% confirm >nul 2>&1

"%NSSM_EXE%" install %SERVICE_NAME% "%NODE_EXE%" "dist\index.js"
"%NSSM_EXE%" set %SERVICE_NAME% AppDirectory "%AGENT_DIR%"
"%NSSM_EXE%" set %SERVICE_NAME% Description "CMK HRMS Biometric Attendance Local SQL Server Express Sync Agent"
"%NSSM_EXE%" set %SERVICE_NAME% Start SERVICE_AUTO_START
"%NSSM_EXE%" set %SERVICE_NAME% AppRestartDelay 10000
"%NSSM_EXE%" set %SERVICE_NAME% AppStdout "%AGENT_DIR%\logs\service-stdout.log"
"%NSSM_EXE%" set %SERVICE_NAME% AppStderr "%AGENT_DIR%\logs\service-stderr.log"

echo.
echo Starting Windows Service: %SERVICE_NAME%...
"%NSSM_EXE%" start %SERVICE_NAME%

echo.
echo ======================================================================
echo   SUCCESS! CMK HRMS Sync Agent is now running as a Windows Service!
echo   - It will start automatically when Windows boots.
echo   - It will restart automatically if it ever crashes.
echo   - Logs: %AGENT_DIR%\logs\
echo ======================================================================
echo.
pause
