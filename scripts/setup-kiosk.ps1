#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Kiosk Full Setup Script
.DESCRIPTION
    One-shot script to configure a front desk computer as a WCS kiosk.
    Creates Staff Windows user, applies Chrome lockdown, sets auto-login.
    Push via Action1 RMM or run manually on the machine.

    BEFORE RUNNING: Set the three variables below for this machine.
.NOTES
    Idempotent — safe to run multiple times on the same machine.
    Run as SYSTEM or local admin.
#>

# ============================================================
# CONFIGURE THESE FOR EACH MACHINE
# ============================================================
$LocationName   = 'Salem'                              # Salem, Keizer, Eugene, Springfield, Clackamas, Milwaukie, Medford
$PortalBaseURL  = 'https://wcs-staff-portal.onrender.com'
$ABCFinancialURL = ''                                  # Leave empty if not known yet, or set per-machine ABC URL
# ============================================================

$ErrorActionPreference = 'Stop'

# Build the full portal URL with params
$portalURL = "$PortalBaseURL`?location=$LocationName"
if ($ABCFinancialURL) {
    $portalURL += "&abc_url=$([uri]::EscapeDataString($ABCFinancialURL))"
}

Write-Host "=== WCS Kiosk Setup ==="
Write-Host "Location:   $LocationName"
Write-Host "Portal URL: $portalURL"
Write-Host ""

# ============================================================
# 1. CREATE STAFF WINDOWS USER (if it doesn't exist)
# ============================================================
$staffUser = 'Staff'
$staffPass = ConvertTo-SecureString 'wcs1' -AsPlainText -Force

if (-not (Get-LocalUser -Name $staffUser -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name $staffUser -Password $staffPass -FullName 'WCS Staff' -Description 'Kiosk account' -PasswordNeverExpires
    Add-LocalGroupMember -Group 'Users' -Member $staffUser
    Write-Host "Created local user: $staffUser"
} else {
    Write-Host "User '$staffUser' already exists — skipping creation"
}

# ============================================================
# 2. SET AUTO-LOGIN TO STAFF ACCOUNT
# ============================================================
$winlogonPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty -Path $winlogonPath -Name 'AutoAdminLogon' -Value '1'
Set-ItemProperty -Path $winlogonPath -Name 'DefaultUserName' -Value $staffUser
Set-ItemProperty -Path $winlogonPath -Name 'DefaultPassword' -Value 'wcs1'
Write-Host "Set auto-login for '$staffUser'"

# ============================================================
# 3. CHROME LOCKDOWN POLICIES (HKLM — applies to all users)
# ============================================================
$chromePolicyRoot = 'HKLM:\SOFTWARE\Policies\Google\Chrome'

function Ensure-RegistryPath {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }
}

Ensure-RegistryPath $chromePolicyRoot

# Core policies
$policies = @{
    'BrowserSignin'              = @{ Value = 2;  Type = 'DWord' }
    'RestrictSigninToPattern'    = @{ Value = '*@westcoaststrength.com'; Type = 'String' }
    'BrowserAddPersonEnabled'    = @{ Value = 0;  Type = 'DWord' }
    'BrowserGuestModeEnabled'    = @{ Value = 0;  Type = 'DWord' }
    'SyncDisabled'               = @{ Value = 1;  Type = 'DWord' }
    'ClearBrowsingDataOnExit'    = @{ Value = 1;  Type = 'DWord' }
    'PasswordManagerEnabled'     = @{ Value = 0;  Type = 'DWord' }
    'AutofillAddressEnabled'     = @{ Value = 0;  Type = 'DWord' }
    'AutofillCreditCardEnabled'  = @{ Value = 0;  Type = 'DWord' }
    'IncognitoModeAvailability'  = @{ Value = 1;  Type = 'DWord' }
    'RestoreOnStartup'           = @{ Value = 4;  Type = 'DWord' }
}

foreach ($key in $policies.Keys) {
    Set-ItemProperty -Path $chromePolicyRoot -Name $key -Value $policies[$key].Value -Type $policies[$key].Type
}
Write-Host "Applied Chrome core policies"

# Startup URL (portal with location + abc_url params)
$startupPath = "$chromePolicyRoot\RestoreOnStartupURLs"
Ensure-RegistryPath $startupPath
Set-ItemProperty -Path $startupPath -Name '1' -Value $portalURL -Type String
Write-Host "Set startup URL: $portalURL"

# Pinned tab
$pinnedPath = "$chromePolicyRoot\PinnedTabs"
Ensure-RegistryPath $pinnedPath
Set-ItemProperty -Path $pinnedPath -Name '1' -Value $portalURL -Type String

# URL blocklist — block everything
$blockPath = "$chromePolicyRoot\URLBlocklist"
Ensure-RegistryPath $blockPath
Set-ItemProperty -Path $blockPath -Name '1' -Value '*' -Type String

# URL allowlist — only approved sites
$allowPath = "$chromePolicyRoot\URLAllowlist"
Ensure-RegistryPath $allowPath

$allowedURLs = @(
    $PortalBaseURL.Replace('https://','').Replace('http://',''),
    'app.gohighlevel.com',
    'mail.google.com',
    'drive.google.com',
    'docs.google.com',
    'app.wheniwork.com',
    'myapps.paychex.com',
    'accounts.google.com'
)

# Add ABC domain to allowlist if set
if ($ABCFinancialURL) {
    $abcDomain = ([uri]$ABCFinancialURL).Host
    $allowedURLs += $abcDomain
}

for ($i = 0; $i -lt $allowedURLs.Count; $i++) {
    Set-ItemProperty -Path $allowPath -Name ($i + 1).ToString() -Value $allowedURLs[$i] -Type String
}
Write-Host "Set URL allowlist: $($allowedURLs.Count) domains"

# ============================================================
# 4. SCHEDULE NIGHTLY PROFILE CLEANUP (2 AM)
# ============================================================
$cleanupScript = @'
$profileRoot = "C:\Users\Staff\AppData\Local\Google\Chrome\User Data"
if (Test-Path $profileRoot) {
    Get-ChildItem -Path $profileRoot -Directory |
        Where-Object { $_.Name -match '^Profile' } |
        ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force }
}
'@

$taskName = 'WCS-Nightly-Chrome-Cleanup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$cleanupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At '2:00AM'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description 'WCS nightly Chrome profile cleanup'
Write-Host "Scheduled nightly cleanup at 2:00 AM"

# ============================================================
# DONE
# ============================================================
Write-Host ""
Write-Host "=== Setup complete ==="
Write-Host "Next steps:"
Write-Host "  1. Restart the machine — it will auto-login as '$staffUser'"
Write-Host "  2. Open Chrome — it should load the portal automatically"
Write-Host "  3. Sign in the kiosk Google account for this location"
Write-Host ""
Write-Host "To undo: run chrome-unlock.ps1 (removes all Chrome policies)"
