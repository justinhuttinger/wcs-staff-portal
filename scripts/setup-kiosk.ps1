#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Kiosk Full Setup Script
.DESCRIPTION
    One-shot script to configure a front desk computer as a WCS kiosk.
    Creates Staff + Admin Windows users, applies Chrome lockdown to Staff only.
    Admin gets an unrestricted Chrome experience.
    Push via Action1 RMM or run manually on the machine.

    BEFORE RUNNING: Set the three variables below for this machine.
.NOTES
    Idempotent — safe to run multiple times on the same machine.
    Run as SYSTEM or local admin.
    Chrome policies are applied to Staff's HKCU (not HKLM) so Admin is unaffected.
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

Write-Host "=== WCS Kiosk Setup ==="
Write-Host "Location:   $LocationName"
Write-Host "Portal URL: $portalURL"
Write-Host ""

# ============================================================
# HELPER: Ensure registry path exists
# ============================================================
function Ensure-RegistryPath {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }
}

# ============================================================
# 1. CREATE WINDOWS USERS
# ============================================================

# Staff user (kiosk — locked down)
$staffUser = 'Staff'
$staffPass = ConvertTo-SecureString 'wcs1' -AsPlainText -Force

if (-not (Get-LocalUser -Name $staffUser -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name $staffUser -Password $staffPass -FullName 'WCS Staff' -Description 'Kiosk account' -PasswordNeverExpires
    Add-LocalGroupMember -Group 'Users' -Member $staffUser
    Write-Host "Created local user: $staffUser (password: wcs1)"
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

Write-Host "Both profiles available at Windows lock screen"

# ============================================================
# 2. REMOVE ANY MACHINE-WIDE CHROME POLICIES (clean slate)
# ============================================================
$hklmChrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
if (Test-Path $hklmChrome) {
    Remove-Item -Path $hklmChrome -Recurse -Force
    Write-Host "Removed old HKLM Chrome policies (so Admin is unrestricted)"
}

# ============================================================
# 3. APPLY CHROME LOCKDOWN TO STAFF USER ONLY (HKCU)
# ============================================================
# Load Staff's registry hive so we can write to their HKCU
$staffNtuser = "C:\Users\$staffUser\NTUSER.DAT"

# First login may not have created the profile yet — force it
if (-not (Test-Path "C:\Users\$staffUser")) {
    Write-Host "Creating Staff profile (first-time login simulation)..."
    $cred = New-Object System.Management.Automation.PSCredential($staffUser, $staffPass)
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c echo.' -Credential $cred -Wait -NoNewWindow -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
}

# Load the hive
$hivePath = "HKU\StaffProfile"
$loaded = $false
if (Test-Path $staffNtuser) {
    reg load $hivePath $staffNtuser 2>$null
    $loaded = $true
    Write-Host "Loaded Staff registry hive"
} else {
    Write-Host "WARNING: Staff NTUSER.DAT not found at $staffNtuser"
    Write-Host "Chrome policies will be applied on first Staff login instead."
    Write-Host "Re-run this script after Staff has logged in once."
}

if ($loaded) {
    $chromePolicyRoot = "Registry::$hivePath\SOFTWARE\Policies\Google\Chrome"

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
    Write-Host "Applied Chrome core policies (Staff only)"

    # Startup URL
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

    # Unload the hive
    [gc]::Collect()
    Start-Sleep -Seconds 1
    reg unload $hivePath 2>$null
    Write-Host "Unloaded Staff registry hive"
}

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
Write-Host "=== Setup complete — rebooting in 30 seconds ==="
Write-Host "After reboot:"
Write-Host "  - Log in as 'Staff' (password: wcs1) — locked Chrome with portal"
Write-Host "  - Log in as 'Admin' (IT password) — unrestricted Chrome"
Write-Host ""
Write-Host "To undo: run chrome-unlock.ps1"

# Reboot after 30 seconds to apply all changes
shutdown /r /t 30 /c "WCS Kiosk setup complete — rebooting to apply changes"
