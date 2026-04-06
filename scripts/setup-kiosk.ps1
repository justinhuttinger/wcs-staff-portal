#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Kiosk Full Setup Script
.DESCRIPTION
    One-shot script to configure a front desk computer as a WCS kiosk.
    Creates Staff + Admin Windows users. Places a logon script on the
    Staff account that applies Chrome lockdown and opens the portal
    every time Staff logs in. Admin is completely unrestricted.

    BEFORE RUNNING: Set the three variables below for this machine.
.NOTES
    Idempotent — safe to run multiple times on the same machine.
    Run as SYSTEM or local admin via Action1.
#>

# ============================================================
# CONFIGURE THESE FOR EACH MACHINE
# ============================================================
$LocationName    = 'Salem'                              # Salem, Keizer, Eugene, Springfield, Clackamas, Milwaukie, Medford
$PortalBaseURL   = 'https://wcs-staff-portal.onrender.com'
$ABCFinancialURL = ''                                   # Leave empty if not known yet, or set per-machine ABC URL
# ============================================================

$ErrorActionPreference = 'Stop'

# Build the full portal URL with params
$portalURL = "$PortalBaseURL`?location=$LocationName"
if ($ABCFinancialURL) {
    $portalURL += "&abc_url=$([uri]::EscapeDataString($ABCFinancialURL))"
}

$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'

Write-Host "=== WCS Kiosk Setup ==="
Write-Host "Location:   $LocationName"
Write-Host "Portal URL: $portalURL"
Write-Host ""

# ============================================================
# 1. CREATE WINDOWS USERS
# ============================================================

# Staff user (kiosk — locked down)
$staffUser = 'Staff'
$staffPass = ConvertTo-SecureString 'wcs1' -AsPlainText -Force

if (-not (Get-LocalUser -Name $staffUser -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name $staffUser -Password $staffPass -FullName 'WCS Staff' -Description 'Kiosk account' -PasswordNeverExpires
    Add-LocalGroupMember -Group 'Users' -Member $staffUser
    Write-Host "Created local user: $staffUser"
} else {
    Write-Host "User '$staffUser' already exists — skipping"
}

# Admin user (IT access — unrestricted)
$adminUser = 'Admin'
$adminPass = ConvertTo-SecureString '!31JellybeaN31!' -AsPlainText -Force

if (-not (Get-LocalUser -Name $adminUser -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name $adminUser -Password $adminPass -FullName 'WCS Admin' -Description 'IT admin account' -PasswordNeverExpires
    Add-LocalGroupMember -Group 'Administrators' -Member $adminUser
    Write-Host "Created local user: $adminUser (Administrators group)"
} else {
    Write-Host "User '$adminUser' already exists — skipping"
}

# ============================================================
# 2. REMOVE ANY OLD MACHINE-WIDE CHROME POLICIES
# ============================================================
$hklmChrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
if (Test-Path $hklmChrome) {
    Remove-Item -Path $hklmChrome -Recurse -Force
    Write-Host "Removed old HKLM Chrome policies"
}

# ============================================================
# 3. CREATE STAFF LOGON SCRIPT
# ============================================================
# This script runs every time Staff logs in. It:
#   a) Applies Chrome policies to HKCU (current user = Staff)
#   b) Creates a desktop shortcut to the portal
#   c) Opens Chrome to the portal (regular mode with tabs)

$wcsScriptDir = 'C:\WCS'
if (-not (Test-Path $wcsScriptDir)) {
    New-Item -Path $wcsScriptDir -ItemType Directory -Force | Out-Null
}

$logonScriptContent = @"
# WCS Staff Logon Script — applies Chrome lockdown and opens portal
# This runs as the Staff user (HKCU = Staff's registry)

`$ErrorActionPreference = 'SilentlyContinue'

# ---- Build portal URL (read ABC URL from local config if it exists) ----
`$portalURL = '$PortalBaseURL`?location=$LocationName'
`$abcFile = 'C:\WCS\abc-url.txt'
if (Test-Path `$abcFile) {
    `$abcURL = (Get-Content `$abcFile -First 1).Trim()
    if (`$abcURL) {
        `$portalURL += "&abc_url=`$([uri]::EscapeDataString(`$abcURL))"
    }
}

# ---- Apply Chrome policies to current user ----
`$chromePolicyRoot = 'HKCU:\SOFTWARE\Policies\Google\Chrome'

function Ensure-Path {
    param([string]`$P)
    if (-not (Test-Path `$P)) { New-Item -Path `$P -Force | Out-Null }
}

Ensure-Path `$chromePolicyRoot

# Core lockdown policies
Set-ItemProperty -Path `$chromePolicyRoot -Name 'BrowserSignin' -Value 2 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'RestrictSigninToPattern' -Value '*@westcoaststrength.com' -Type String
Set-ItemProperty -Path `$chromePolicyRoot -Name 'BrowserAddPersonEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'BrowserGuestModeEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'SyncDisabled' -Value 1 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'ClearBrowsingDataOnExit' -Value 1 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'PasswordManagerEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'AutofillAddressEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'AutofillCreditCardEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'IncognitoModeAvailability' -Value 1 -Type DWord
Set-ItemProperty -Path `$chromePolicyRoot -Name 'RestoreOnStartup' -Value 4 -Type DWord

# Startup URL
`$startupPath = "`$chromePolicyRoot\RestoreOnStartupURLs"
Ensure-Path `$startupPath
Set-ItemProperty -Path `$startupPath -Name '1' -Value `$portalURL -Type String

# Pinned tab
`$pinnedPath = "`$chromePolicyRoot\PinnedTabs"
Ensure-Path `$pinnedPath
Set-ItemProperty -Path `$pinnedPath -Name '1' -Value `$portalURL -Type String

# Block all URLs except allowlist
`$blockPath = "`$chromePolicyRoot\URLBlocklist"
Ensure-Path `$blockPath
Set-ItemProperty -Path `$blockPath -Name '1' -Value '*' -Type String

`$allowPath = "`$chromePolicyRoot\URLAllowlist"
Ensure-Path `$allowPath
`$allowed = @(
    '$($PortalBaseURL.Replace("https://","").Replace("http://",""))',
    'app.gohighlevel.com',
    'mail.google.com',
    'drive.google.com',
    'docs.google.com',
    'app.wheniwork.com',
    'myapps.paychex.com',
    'accounts.google.com'
)
for (`$i = 0; `$i -lt `$allowed.Count; `$i++) {
    Set-ItemProperty -Path `$allowPath -Name (`$i + 1).ToString() -Value `$allowed[`$i] -Type String
}

# ---- Create desktop shortcut ----
`$desktopPath = [Environment]::GetFolderPath('Desktop')
`$shortcutPath = Join-Path `$desktopPath 'WCS Staff Portal.lnk'
if (-not (Test-Path `$shortcutPath)) {
    `$shell = New-Object -ComObject WScript.Shell
    `$shortcut = `$shell.CreateShortcut(`$shortcutPath)
    `$shortcut.TargetPath = '$chromePath'
    `$shortcut.Arguments = "--start-maximized `$portalURL"
    `$shortcut.Description = 'WCS Staff Portal'
    `$shortcut.Save()
}

# ---- Launch Chrome to portal (regular mode with tabs) ----
Start-Process -FilePath '$chromePath' -ArgumentList "--start-maximized `$portalURL"
"@

$logonScriptPath = Join-Path $wcsScriptDir 'staff-logon.ps1'
Set-Content -Path $logonScriptPath -Value $logonScriptContent -Force
Write-Host "Created logon script: $logonScriptPath"

# ============================================================
# 4. REGISTER LOGON SCRIPT AS SCHEDULED TASK (runs at Staff login)
# ============================================================
$logonTaskName = 'WCS-Staff-Logon'
if (Get-ScheduledTask -TaskName $logonTaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $logonTaskName -Confirm:$false
}

$logonAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$logonScriptPath`""
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$logonTrigger.UserId = $staffUser
$logonPrincipal = New-ScheduledTaskPrincipal -UserId $staffUser -LogonType Interactive
Register-ScheduledTask -TaskName $logonTaskName -Action $logonAction -Trigger $logonTrigger -Principal $logonPrincipal -Description 'WCS Staff Portal — apply Chrome lockdown and open portal on login'
Write-Host "Registered logon task for '$staffUser'"

# ============================================================
# 5. SCHEDULE NIGHTLY PROFILE CLEANUP (2 AM)
# ============================================================
$cleanupScript = @'
$profileRoot = "C:\Users\Staff\AppData\Local\Google\Chrome\User Data"
if (Test-Path $profileRoot) {
    Get-ChildItem -Path $profileRoot -Directory |
        Where-Object { $_.Name -match '^Profile' } |
        ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force }
}
'@

$cleanupTaskName = 'WCS-Nightly-Chrome-Cleanup'
if (Get-ScheduledTask -TaskName $cleanupTaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $cleanupTaskName -Confirm:$false
}

$cleanupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$cleanupScript`""
$cleanupTrigger = New-ScheduledTaskTrigger -Daily -At '2:00AM'
$cleanupPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
Register-ScheduledTask -TaskName $cleanupTaskName -Action $cleanupAction -Trigger $cleanupTrigger -Principal $cleanupPrincipal -Description 'WCS nightly Chrome profile cleanup'
Write-Host "Scheduled nightly cleanup at 2:00 AM"

# ============================================================
# DONE
# ============================================================
Write-Host ""
Write-Host "=== Setup complete — rebooting in 30 seconds ==="
Write-Host ""
Write-Host "After reboot:"
Write-Host "  STAFF login (password: wcs1):"
Write-Host "    - Chrome opens automatically to portal in app mode"
Write-Host "    - Desktop shortcut 'WCS Staff Portal' created"
Write-Host "    - Chrome locked down (allowlist only, no passwords, no incognito)"
Write-Host "    - Sessions wiped when Chrome closes"
Write-Host ""
Write-Host "  ADMIN login (IT password):"
Write-Host "    - Chrome is completely unrestricted"
Write-Host "    - Full admin access to the machine"
Write-Host ""
Write-Host "To undo: run chrome-unlock.ps1"

# Reboot
shutdown /r /t 30 /c "WCS Kiosk setup complete — rebooting to apply changes"
