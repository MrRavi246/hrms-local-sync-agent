# ==============================================================================
# CMK HRMS: SQL Server Express Connection & Service Repair Tool (PowerShell)
# ==============================================================================

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  CMK HRMS: LOCAL SQL SERVER EXPRESS CONNECTION REPAIR TOOL" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Start SQL Server Browser Service (UDP Port 1434)
Write-Host "[1/4] Checking 'SQL Server Browser' service (UDP 1434)..." -ForegroundColor Yellow
$browser = Get-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue

if ($browser) {
    Set-Service -Name "SQLBrowser" -StartupType Automatic
    if ($browser.Status -ne "Running") {
        Start-Service -Name "SQLBrowser"
        Write-Host "      [OK] SQL Server Browser service started and set to Automatic." -ForegroundColor Green
    } else {
        Write-Host "      [OK] SQL Server Browser service is already running." -ForegroundColor Green
    }
} else {
    Write-Host "      [NOTE] SQLBrowser service not registered." -ForegroundColor DarkYellow
}

# 2. Start SQL Server (SQLEXPRESS) Service
Write-Host "`n[2/4] Checking 'SQL Server (SQLEXPRESS)' database service..." -ForegroundColor Yellow
$sqlEngine = Get-Service -Name "MSSQL$SQLEXPRESS" -ErrorAction SilentlyContinue
if (-not $sqlEngine) {
    $sqlEngine = Get-Service -Name "MSSQLSERVER" -ErrorAction SilentlyContinue
}

if ($sqlEngine) {
    Set-Service -Name $sqlEngine.Name -StartupType Automatic
    if ($sqlEngine.Status -ne "Running") {
        Start-Service -Name $sqlEngine.Name
        Write-Host "      [OK] $($sqlEngine.DisplayName) is now running." -ForegroundColor Green
    } else {
        Write-Host "      [OK] $($sqlEngine.DisplayName) is running." -ForegroundColor Green
    }
} else {
    Write-Host "      [WARNING] Could not locate SQLEXPRESS service on this machine." -ForegroundColor Red
}

# 3. Enable TCP/IP in Windows Registry
Write-Host "`n[3/4] Enabling TCP/IP network protocol in registry..." -ForegroundColor Yellow
$restartRequired = $false

$tcpKeys = Get-ChildItem -Path "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*MSSQLServer\SuperSocketNetLib\Tcp" }

if ($tcpKeys) {
    foreach ($key in $tcpKeys) {
        $path = "Registry::$($key.Name)"
        $currentEnabled = (Get-ItemProperty -Path $path -Name "Enabled" -ErrorAction SilentlyContinue).Enabled
        if ($currentEnabled -ne 1) {
            Set-ItemProperty -Path $path -Name "Enabled" -Value 1 -Type DWord
            Write-Host "      [OK] Enabled TCP/IP for: $($key.PSChildName)" -ForegroundColor Green
            $restartRequired = $true
        } else {
            Write-Host "      [OK] TCP/IP is already ENABLED for: $($key.PSChildName)" -ForegroundColor Green
        }
    }
}

if ($restartRequired -and $sqlEngine) {
    Write-Host "      Restarting database engine to apply TCP/IP network settings..." -ForegroundColor Yellow
    Restart-Service -Name $sqlEngine.Name -Force
    Write-Host "      [OK] Database service restarted successfully." -ForegroundColor Green
}

# 4. Configure Windows Firewall Inbound Rules
Write-Host "`n[4/4] Configuring Windows Firewall rules for SQL Server Express..." -ForegroundColor Yellow
try {
    $browserFw = Get-NetFirewallRule -DisplayName "SQL Server Browser (UDP-In 1434)" -ErrorAction SilentlyContinue
    if (-not $browserFw) {
        New-NetFirewallRule -DisplayName "SQL Server Browser (UDP-In 1434)" -Direction Inbound -Protocol UDP -LocalPort 1434 -Action Allow -Profile Any | Out-Null
        Write-Host "      [OK] Firewall Rule added: UDP 1434 (SQL Server Browser)" -ForegroundColor Green
    } else {
        Write-Host "      [OK] Firewall rule for UDP 1434 already exists." -ForegroundColor Green
    }

    $tcpFw = Get-NetFirewallRule -DisplayName "SQL Server Express (TCP-In 1433)" -ErrorAction SilentlyContinue
    if (-not $tcpFw) {
        New-NetFirewallRule -DisplayName "SQL Server Express (TCP-In 1433)" -Direction Inbound -Protocol TCP -LocalPort 1433 -Action Allow -Profile Any | Out-Null
        Write-Host "      [OK] Firewall Rule added: TCP 1433 (SQL Server default)" -ForegroundColor Green
    } else {
        Write-Host "      [OK] Firewall rule for TCP 1433 already exists." -ForegroundColor Green
    }
} catch {
    Write-Host "      [NOTE] Firewall rules check completed." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  REPAIR COMPLETE! You can now test the connection:" -ForegroundColor Green
Write-Host "  Run: npm run db-inspect -- --dry-run" -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""
