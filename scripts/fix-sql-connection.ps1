# ==============================================================================
# CMK HRMS: SQL Server Express Connection & Service Repair Tool
# ==============================================================================
# Diagnoses and repairs issues preventing Node.js from connecting to SQLEXPRESS.
# ==============================================================================

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  CMK HRMS: LOCAL SQL SERVER EXPRESS CONNECTION REPAIR TOOL" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check and Start SQL Server Browser Service (UDP Port 1434)
Write-Host "[1/4] Checking 'SQL Server Browser' service (Required for named instances like \SQLEXPRESS)..." -ForegroundColor Yellow
$browser = Get-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue

if ($browser) {
    Set-Service -Name "SQLBrowser" -StartupType Automatic
    if ($browser.Status -ne "Running") {
        Write-Host "      Starting SQL Server Browser service..." -ForegroundColor Gray
        Start-Service -Name "SQLBrowser"
        Write-Host "      ✅ SQL Server Browser service started and set to Automatic." -ForegroundColor Green
    } else {
        Write-Host "      ✅ SQL Server Browser service is already running." -ForegroundColor Green
    }
} else {
    Write-Host "      ⚠️  SQLBrowser service not registered. Named instance resolution requires fixed port or manual SQL Server installation." -ForegroundColor DarkYellow
}

# 2. Check and Start SQL Server (SQLEXPRESS) Service
Write-Host "`n[2/4] Checking 'SQL Server (SQLEXPRESS)' database engine service..." -ForegroundColor Yellow
$sqlEngine = Get-Service -Name "MSSQL$SQLEXPRESS" -ErrorAction SilentlyContinue
if (-not $sqlEngine) {
    $sqlEngine = Get-Service -Name "MSSQLSERVER" -ErrorAction SilentlyContinue
}

if ($sqlEngine) {
    Set-Service -Name $sqlEngine.Name -StartupType Automatic
    if ($sqlEngine.Status -ne "Running") {
        Write-Host "      Starting $($sqlEngine.DisplayName)..." -ForegroundColor Gray
        Start-Service -Name $sqlEngine.Name
        Write-Host "      ✅ $($sqlEngine.DisplayName) is now running." -ForegroundColor Green
    } else {
        Write-Host "      ✅ $($sqlEngine.DisplayName) is running." -ForegroundColor Green
    }
} else {
    Write-Host "      ❌ Could not locate SQL Server Express service on this machine." -ForegroundColor Red
}

# 3. Enable TCP/IP Protocol in Registry for SQL Server Express
Write-Host "`n[3/4] Checking SQL Server TCP/IP network protocol status..." -ForegroundColor Yellow
$restartRequired = $false

$tcpKeys = Get-ChildItem -Path "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*MSSQLServer\SuperSocketNetLib\Tcp" }

if ($tcpKeys) {
    foreach ($key in $tcpKeys) {
        $path = "Registry::$($key.Name)"
        $currentEnabled = (Get-ItemProperty -Path $path -Name "Enabled" -ErrorAction SilentlyContinue).Enabled
        if ($currentEnabled -ne 1) {
            Set-ItemProperty -Path $path -Name "Enabled" -Value 1 -Type DWord
            Write-Host "      ✅ Enabled TCP/IP protocol for: $($key.PSChildName)" -ForegroundColor Green
            $restartRequired = $true
        } else {
            Write-Host "      ✅ TCP/IP protocol is already ENABLED for: $($key.PSChildName)" -ForegroundColor Green
        }

        # Check port configuration under IPAll
        $ipAllKey = "$path\IPAll"
        if (Test-Path $ipAllKey) {
            $dynPort = (Get-ItemProperty -Path $ipAllKey -Name "TcpDynamicPorts" -ErrorAction SilentlyContinue).TcpDynamicPorts
            $statPort = (Get-ItemProperty -Path $ipAllKey -Name "TcpPort" -ErrorAction SilentlyContinue).TcpPort
            Write-Host "      Active Ports -> Static: [$statPort], Dynamic: [$dynPort]" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "      ℹ️  TCP/IP registry keys not found directly. Please verify in SQL Server Configuration Manager." -ForegroundColor Gray
}

# Restart SQL Server if TCP/IP was just enabled
if ($restartRequired -and $sqlEngine) {
    Write-Host "      Restarting $($sqlEngine.DisplayName) to apply TCP/IP network changes..." -ForegroundColor Yellow
    Restart-Service -Name $sqlEngine.Name -Force
    Write-Host "      ✅ Database engine service restarted successfully." -ForegroundColor Green
}

# 4. Configure Windows Firewall Inbound Rules
Write-Host "`n[4/4] Configuring Windows Firewall rules for SQL Server Express..." -ForegroundColor Yellow
try {
    $browserFw = Get-NetFirewallRule -DisplayName "SQL Server Browser (UDP-In 1434)" -ErrorAction SilentlyContinue
    if (-not $browserFw) {
        New-NetFirewallRule -DisplayName "SQL Server Browser (UDP-In 1434)" -Direction Inbound -Protocol UDP -LocalPort 1434 -Action Allow -Profile Any | Out-Null
        Write-Host "      ✅ Inbound Firewall Rule added: UDP 1434 (SQL Server Browser)" -ForegroundColor Green
    } else {
        Write-Host "      ✅ Firewall rule for UDP 1434 already exists." -ForegroundColor Green
    }

    $tcpFw = Get-NetFirewallRule -DisplayName "SQL Server Express (TCP-In 1433)" -ErrorAction SilentlyContinue
    if (-not $tcpFw) {
        New-NetFirewallRule -DisplayName "SQL Server Express (TCP-In 1433)" -Direction Inbound -Protocol TCP -LocalPort 1433 -Action Allow -Profile Any | Out-Null
        Write-Host "      ✅ Inbound Firewall Rule added: TCP 1433 (SQL Server default)" -ForegroundColor Green
    } else {
        Write-Host "      ✅ Firewall rule for TCP 1433 already exists." -ForegroundColor Green
    }
} catch {
    Write-Host "      ⚠️  Could not modify firewall rules automatically ($($_.Exception.Message))." -ForegroundColor DarkYellow
}

Write-Host "`n======================================================================" -ForegroundColor Cyan
Write-Host "  REPAIR COMPLETE! You can now test the connection:" -ForegroundColor Green
Write-Host "  Run: npm run db-inspect -- --dry-run" -ForegroundColor White
Write-Host "  Or:  npm run diagnose" -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""
