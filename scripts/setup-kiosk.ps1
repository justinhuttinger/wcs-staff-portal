#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Kiosk Full Setup Script
.DESCRIPTION
    Creates Staff + Admin Windows users.
    Applies Chrome lockdown via HKLM (machine-wide — reliable).
    Gives Admin an "Unlocked Chrome" shortcut that uses a separate
    user-data directory, bypassing the machine policies.

    BEFORE RUNNING: Set the variables below for this machine.
.NOTES
    Idempotent — safe to run multiple times.
    Run as SYSTEM or local admin via Action1.
#>

# ============================================================
# CONFIGURE THESE FOR EACH MACHINE
# ============================================================
$LocationName    = 'Salem'
$PortalBaseURL   = 'https://wcs-staff-portal.onrender.com'
# ============================================================

$ErrorActionPreference = 'Stop'
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$wcsDir = 'C:\WCS'

# Build portal URL (ABC URL read dynamically at Staff logon)
$portalURL = "$PortalBaseURL`?location=$LocationName"

Write-Host "=== WCS Kiosk Setup ==="
Write-Host "Location:   $LocationName"
Write-Host "Portal URL: $portalURL"
Write-Host ""

# ============================================================
# 1. CREATE WINDOWS USERS
# ============================================================
$staffUser = 'Staff'
$staffPass = ConvertTo-SecureString 'wcs1' -AsPlainText -Force

if (-not (Get-LocalUser -Name $staffUser -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name $staffUser -Password $staffPass -FullName 'WCS Staff' -Description 'Kiosk account' -PasswordNeverExpires
    Add-LocalGroupMember -Group 'Users' -Member $staffUser
    Write-Host "Created local user: $staffUser"
} else {
    Write-Host "User '$staffUser' already exists"
}

$adminUser = 'Admin'
$adminPass = ConvertTo-SecureString '!31JellybeaN31!' -AsPlainText -Force

if (-not (Get-LocalUser -Name $adminUser -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name $adminUser -Password $adminPass -FullName 'WCS Admin' -Description 'IT admin account' -PasswordNeverExpires
    Add-LocalGroupMember -Group 'Administrators' -Member $adminUser
    Write-Host "Created local user: $adminUser (Administrators group)"
} else {
    Write-Host "User '$adminUser' already exists"
}

# ============================================================
# 2. CREATE C:\WCS DIRECTORY, COPY EXTENSION, CREATE SCRIPTS
# ============================================================
if (-not (Test-Path $wcsDir)) {
    New-Item -Path $wcsDir -ItemType Directory -Force | Out-Null
}

# Download WCS ABC overlay extension from GitHub
$extDest = "$wcsDir\extension"
if (-not (Test-Path $extDest)) {
    Write-Host "Downloading extension from GitHub..."
    $zipUrl = 'https://github.com/justinhuttinger/wcs-staff-portal/archive/refs/heads/master.zip'
    $zipPath = "$env:TEMP\wcs-repo.zip"
    $extractPath = "$env:TEMP\wcs-repo"

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

    # Copy just the extension folder
    $repoExtPath = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
    Copy-Item -Path "$($repoExtPath.FullName)\extension" -Destination $extDest -Recurse -Force
    Write-Host "Extension installed to: $extDest"

    # Cleanup
    Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "Extension already at: $extDest"
}

# --- ABC URL setter (dialog box) ---
$abcSetterContent = @'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms

$currentURL = ''
$abcFile = 'C:\WCS\abc-url.txt'
if (Test-Path $abcFile) {
    $currentURL = (Get-Content $abcFile -First 1).Trim()
}

$newURL = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Enter the ABC Financial URL for this machine:`n`nCurrent: $currentURL",
    'WCS Portal - Set ABC URL',
    $currentURL
)

if ($newURL -and $newURL.Trim()) {
    if (-not (Test-Path 'C:\WCS')) { New-Item -Path 'C:\WCS' -ItemType Directory -Force | Out-Null }
    Set-Content -Path $abcFile -Value $newURL.Trim() -Force
    [System.Windows.Forms.MessageBox]::Show(
        "ABC URL saved!`n`n$($newURL.Trim())`n`nThis will take effect next time Staff logs in.",
        'WCS Portal', 'OK', 'Information'
    )
}
'@
Set-Content -Path "$wcsDir\set-abc-url.ps1" -Value $abcSetterContent -Force
Write-Host "Created: $wcsDir\set-abc-url.ps1"

# --- Staff logon script ---
# Reads ABC URL from file, builds full portal URL, opens Chrome
$staffLogonContent = @"
`$ErrorActionPreference = 'SilentlyContinue'

# Build portal URL with ABC if configured
`$portalURL = '$portalURL'
`$abcFile = 'C:\WCS\abc-url.txt'
if (Test-Path `$abcFile) {
    `$abcURL = (Get-Content `$abcFile -First 1).Trim()
    if (`$abcURL) {
        `$portalURL += "&abc_url=`$([uri]::EscapeDataString(`$abcURL))"
    }
}

# Create desktop shortcut
`$desktopPath = [Environment]::GetFolderPath('Desktop')
`$shortcutPath = Join-Path `$desktopPath 'WCS Staff Portal.lnk'
if (-not (Test-Path `$shortcutPath)) {
    `$shell = New-Object -ComObject WScript.Shell
    `$shortcut = `$shell.CreateShortcut(`$shortcutPath)
    `$shortcut.TargetPath = '$chromePath'
    `$extArg = ''
    if (Test-Path 'C:\WCS\extension') { `$extArg = '--load-extension=C:\WCS\extension' }
    `$shortcut.Arguments = "--start-maximized `$extArg `$portalURL"
    `$shortcut.Description = 'WCS Staff Portal'
    `$shortcut.Save()
}

# Launch WCS App (Electron browser for work tools)
`$wcsApp = 'C:\Program Files\WCS App\WCS App.exe'
if (Test-Path `$wcsApp) {
    Start-Process -FilePath `$wcsApp -ArgumentList "--location=$LocationName"
}

# Also launch Chrome for personal browsing
Start-Process -FilePath '$chromePath' -ArgumentList "--start-maximized `$portalURL"
"@
Set-Content -Path "$wcsDir\staff-logon.ps1" -Value $staffLogonContent -Force
Write-Host "Created: $wcsDir\staff-logon.ps1"

# --- Admin logon script ---
# Creates desktop shortcuts for ABC setter and unlocked Chrome
$adminLogonContent = @"
`$desktopPath = [Environment]::GetFolderPath('Desktop')
`$shell = New-Object -ComObject WScript.Shell

# ABC URL setter shortcut
`$abcPath = Join-Path `$desktopPath 'Set ABC URL.lnk'
if (-not (Test-Path `$abcPath)) {
    `$s = `$shell.CreateShortcut(`$abcPath)
    `$s.TargetPath = 'powershell.exe'
    `$s.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "C:\WCS\set-abc-url.ps1"'
    `$s.Description = 'Set ABC Financial URL for this machine'
    `$s.Save()
}

# Unlocked Chrome shortcut (separate user-data dir bypasses HKLM policies)
`$chromePath = Join-Path `$desktopPath 'Chrome (Unlocked).lnk'
if (-not (Test-Path `$chromePath)) {
    `$s = `$shell.CreateShortcut(`$chromePath)
    `$s.TargetPath = '$chromePath'
    `$s.Arguments = '--user-data-dir="C:\WCS\AdminChromeData" --no-first-run'
    `$s.Description = 'Unrestricted Chrome for IT admin'
    `$s.Save()
}
"@
Set-Content -Path "$wcsDir\admin-logon.ps1" -Value $adminLogonContent -Force
Write-Host "Created: $wcsDir\admin-logon.ps1"

# ============================================================
# INSTALL WCS APP (Electron browser for work tools)
# ============================================================
$wcsAppInstaller = "$env:TEMP\WCS-App-Setup.exe"
$wcsAppUrl = 'https://github.com/justinhuttinger/wcs-staff-portal/releases/latest/download/WCS-App-Setup.exe'

Write-Host "Downloading WCS App installer..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
    Invoke-WebRequest -Uri $wcsAppUrl -OutFile $wcsAppInstaller -UseBasicParsing
    Start-Process -FilePath $wcsAppInstaller -ArgumentList '/S' -Wait
    Write-Host "WCS App installed"
    Remove-Item -Path $wcsAppInstaller -Force -ErrorAction SilentlyContinue
} catch {
    Write-Host "WARNING: Could not download WCS App. Install manually."
}

# ============================================================
# 3. APPLY CHROME LOCKDOWN (HKLM — all users, reliable)
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
    'BrowserSignin'              = @{ Value = 0;  Type = 'DWord' }  # Disable Chrome profile sign-in (staff use website sign-in for Gmail etc)
    # RestrictSigninToPattern not needed — BrowserSignin=0 blocks all Chrome sign-in
    # BrowserAddPersonEnabled — applied later via lock-profile.ps1 after first sign-in
    'DeveloperToolsAvailability' = @{ Value = 1;  Type = 'DWord' }  # Allow extensions to load
    # BrowserGuestModeEnabled — applied later via lock-profile.ps1 after first sign-in
    'SyncDisabled'               = @{ Value = 1;  Type = 'DWord' }
    # ClearBrowsingDataOnExit removed — kiosk account must stay signed in
    # Nightly cleanup script handles stale data instead
    'PasswordManagerEnabled'     = @{ Value = 0;  Type = 'DWord' }
    'AutofillAddressEnabled'     = @{ Value = 0;  Type = 'DWord' }
    'AutofillCreditCardEnabled'  = @{ Value = 0;  Type = 'DWord' }
    'IncognitoModeAvailability'  = @{ Value = 1;  Type = 'DWord' }
    'RestoreOnStartup'           = @{ Value = 4;  Type = 'DWord' }
}

foreach ($key in $policies.Keys) {
    Set-ItemProperty -Path $chromePolicyRoot -Name $key -Value $policies[$key].Value -Type $policies[$key].Type
}
Write-Host "Applied Chrome lockdown policies (HKLM)"

# Startup URL
$startupPath = "$chromePolicyRoot\RestoreOnStartupURLs"
Ensure-RegistryPath $startupPath
Set-ItemProperty -Path $startupPath -Name '1' -Value $portalURL -Type String

# Pinned tab
$pinnedPath = "$chromePolicyRoot\PinnedTabs"
Ensure-RegistryPath $pinnedPath
Set-ItemProperty -Path $pinnedPath -Name '1' -Value $portalURL -Type String

# URL blocklist
$blockPath = "$chromePolicyRoot\URLBlocklist"
Ensure-RegistryPath $blockPath
Set-ItemProperty -Path $blockPath -Name '1' -Value '*' -Type String

# URL allowlist
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
    'accounts.google.com',
    '*.abcfinancial.com',
    'api.westcoaststrength.com',
    'chrome://*'
)

for ($i = 0; $i -lt $allowedURLs.Count; $i++) {
    Set-ItemProperty -Path $allowPath -Name ($i + 1).ToString() -Value $allowedURLs[$i] -Type String
}
Write-Host "Set URL allowlist: $($allowedURLs.Count) domains"

# ============================================================
# 4. REGISTER LOGON TASKS
# ============================================================

# Staff logon task
$taskName = 'WCS-Staff-Logon'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wcsDir\staff-logon.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.UserId = $staffUser
$principal = New-ScheduledTaskPrincipal -UserId $staffUser -LogonType Interactive
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description 'Open portal on Staff login'
Write-Host "Registered Staff logon task"

# Admin logon task
$taskName = 'WCS-Admin-Logon'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wcsDir\admin-logon.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.UserId = $adminUser
$principal = New-ScheduledTaskPrincipal -UserId $adminUser -LogonType Interactive
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description 'Create Admin desktop shortcuts on login'
Write-Host "Registered Admin logon task"

# ============================================================
# 5. SCHEDULE NIGHTLY CLEANUP (2 AM)
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
Write-Host "=== Setup complete — rebooting in 30 seconds ==="
Write-Host ""
Write-Host "STAFF login (password: wcs1):"
Write-Host "  - Chrome opens to portal (locked down, tabs for allowed sites only)"
Write-Host "  - Portal is a pinned tab, tool buttons open in new tabs"
Write-Host ""
Write-Host "ADMIN login (IT password):"
Write-Host "  - 'Set ABC URL' shortcut on desktop (dialog box)"
Write-Host "  - 'Chrome (Unlocked)' shortcut — unrestricted browsing"
Write-Host "  - Regular Chrome is still locked (use the shortcut)"
Write-Host ""
Write-Host "To undo everything: run chrome-unlock.ps1 via Action1"

shutdown /r /t 30 /c "WCS Kiosk setup complete — rebooting to apply changes"
