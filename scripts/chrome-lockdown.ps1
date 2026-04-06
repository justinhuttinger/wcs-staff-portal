#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Chrome Lockdown Policy Script
.DESCRIPTION
    Writes Chrome enterprise policies to the Windows Registry.
    Idempotent — safe to run multiple times on the same machine.
    Push via Action1 RMM to all machines tagged 'WCS-Kiosk'.
.NOTES
    Uses HKLM so policies apply to ALL Windows users on the machine.
#>

$ErrorActionPreference = 'Stop'

$chromePolicyRoot = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$portalURL = 'https://wcs-portal.westcoaststrength.com'

# ---- Ensure base registry path exists ----
function Ensure-RegistryPath {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
        Write-Host "Created: $Path"
    }
}

Ensure-RegistryPath $chromePolicyRoot

# ---- Core Policies ----

# Force sign-in required
Set-ItemProperty -Path $chromePolicyRoot -Name 'BrowserSignin' -Value 2 -Type DWord
Write-Host "Set BrowserSignin = 2 (force sign-in)"

# Only WCS Google accounts allowed
Set-ItemProperty -Path $chromePolicyRoot -Name 'RestrictSigninToPattern' -Value '*@westcoaststrength.com' -Type String
Write-Host "Set RestrictSigninToPattern = *@westcoaststrength.com"

# Cannot add new Chrome profiles
Set-ItemProperty -Path $chromePolicyRoot -Name 'BrowserAddPersonEnabled' -Value 0 -Type DWord
Write-Host "Set BrowserAddPersonEnabled = 0"

# Guest mode disabled
Set-ItemProperty -Path $chromePolicyRoot -Name 'BrowserGuestModeEnabled' -Value 0 -Type DWord
Write-Host "Set BrowserGuestModeEnabled = 0"

# Sync disabled
Set-ItemProperty -Path $chromePolicyRoot -Name 'SyncDisabled' -Value 1 -Type DWord
Write-Host "Set SyncDisabled = 1"

# Wipe all browsing data when Chrome closes
Set-ItemProperty -Path $chromePolicyRoot -Name 'ClearBrowsingDataOnExit' -Value 1 -Type DWord
Write-Host "Set ClearBrowsingDataOnExit = 1"

# Disable password manager
Set-ItemProperty -Path $chromePolicyRoot -Name 'PasswordManagerEnabled' -Value 0 -Type DWord
Write-Host "Set PasswordManagerEnabled = 0"

# Disable autofill
Set-ItemProperty -Path $chromePolicyRoot -Name 'AutofillAddressEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $chromePolicyRoot -Name 'AutofillCreditCardEnabled' -Value 0 -Type DWord
Write-Host "Disabled autofill (address + credit card)"

# Disable incognito
Set-ItemProperty -Path $chromePolicyRoot -Name 'IncognitoModeAvailability' -Value 1 -Type DWord
Write-Host "Set IncognitoModeAvailability = 1 (disabled)"

# Always restore portal on startup (4 = open list of URLs)
Set-ItemProperty -Path $chromePolicyRoot -Name 'RestoreOnStartup' -Value 4 -Type DWord
Write-Host "Set RestoreOnStartup = 4"

# ---- Startup URLs ----
$startupPath = "$chromePolicyRoot\RestoreOnStartupURLs"
Ensure-RegistryPath $startupPath
Set-ItemProperty -Path $startupPath -Name '1' -Value $portalURL -Type String
Write-Host "Set RestoreOnStartupURLs = $portalURL"

# ---- Pinned Tabs ----
$pinnedPath = "$chromePolicyRoot\PinnedTabs"
Ensure-RegistryPath $pinnedPath
Set-ItemProperty -Path $pinnedPath -Name '1' -Value $portalURL -Type String
Write-Host "Set PinnedTabs = $portalURL"

# ---- URL Blocklist (block everything by default) ----
$blockPath = "$chromePolicyRoot\URLBlocklist"
Ensure-RegistryPath $blockPath
Set-ItemProperty -Path $blockPath -Name '1' -Value '*' -Type String
Write-Host "Set URLBlocklist = * (block all)"

# ---- URL Allowlist (only approved sites) ----
$allowPath = "$chromePolicyRoot\URLAllowlist"
Ensure-RegistryPath $allowPath

$allowedURLs = @(
    'wcs-portal.westcoaststrength.com',
    'app.gohighlevel.com',
    'mail.google.com',
    'drive.google.com',
    'docs.google.com',
    'wcs-mmp-portal.onrender.com'
)

for ($i = 0; $i -lt $allowedURLs.Count; $i++) {
    $name = ($i + 1).ToString()
    Set-ItemProperty -Path $allowPath -Name $name -Value $allowedURLs[$i] -Type String
    Write-Host "Set URLAllowlist\$name = $($allowedURLs[$i])"
}

Write-Host "`n=== Chrome lockdown policies applied successfully ==="
Write-Host "Restart Chrome for policies to take effect."
