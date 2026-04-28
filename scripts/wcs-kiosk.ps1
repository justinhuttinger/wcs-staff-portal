#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Kiosk State Enforcement Script
.DESCRIPTION
    Single idempotent script that ensures every WCS front-desk PC has:
    - Correct local users (Staff, Admin)
    - Allowlisted profiles only (Staff, Admin, abctech if present)
    - Required apps installed (Portal, Chrome, Sonos)
    - Branded wallpaper + lockscreen
    - Chrome hygiene policies (no allowlist; SafeSearch + no downloads)
    - Staff Windows lockdown (no Settings, no cmd, etc.)
    - Logon scripts + nightly Chrome cleanup
.PARAMETER Mode
    Full      - runs every section (default, used for new-machine bootstrap)
    Lockdown  - only sections 5 (Chrome) + 6 (Staff HKCU)
    Cleanup   - only section 2 (profile sweep)
    Inventory - read-only state report, no changes
.NOTES
    Run as SYSTEM via Action1, or manually as local Administrator.
    Idempotent - safe to re-run anytime.
#>

param(
    [ValidateSet('Full','Lockdown','Cleanup','Inventory')]
    [string]$Mode = 'Full'
)

$ErrorActionPreference = 'Stop'

# ============================================================
# CONFIGURATION - edit $LocationName per kiosk, rest is stable
# ============================================================
$LocationName    = 'Salem'
$PortalBaseURL   = 'https://portal.wcstrength.com'
$RepoRawBase     = 'https://raw.githubusercontent.com/justinhuttinger/wcs-staff-portal/master'
$WallpaperUrl    = "$RepoRawBase/branding/wallpaper.jpg"
$LockscreenUrl   = "$RepoRawBase/branding/lockscreen.jpg"
$LauncherUrl     = 'https://github.com/justinhuttinger/wcs-staff-portal/releases/latest/download/Portal-Setup.exe'
$ChromeUrl       = 'https://dl.google.com/chrome/install/standalonesetup64.exe'
$SonosUrl        = 'https://www.sonos.com/redir/controller_software_pc2'
$AllowedUsers    = @('Staff','Admin','abctech')
$BuiltInUsers    = @('Administrator','DefaultAccount','Guest','WDAGUtilityAccount')
$StaffPassword   = 'staff'
$AdminPassword   = '!31JellybeaN31!'

$WcsDir          = 'C:\WCS'
$BrandingDir     = "$WcsDir\branding"
$LogPath         = "$WcsDir\setup.log"

# ============================================================
# HELPERS
# ============================================================
function Initialize-WcsDir {
    if (-not (Test-Path $WcsDir))     { New-Item -Path $WcsDir     -ItemType Directory -Force | Out-Null }
    if (-not (Test-Path $BrandingDir)){ New-Item -Path $BrandingDir -ItemType Directory -Force | Out-Null }
}

function Write-WcsLog {
    param(
        [Parameter(Mandatory=$true)][string]$Section,
        [Parameter(Mandatory=$true)][string]$Status,
        [Parameter(Mandatory=$true)][string]$Message
    )
    $ts   = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "$ts [$Section] $($Status.PadRight(6)) $Message"
    Add-Content -Path $LogPath -Value $line
    Write-Host $line
}

function Test-IsAdmin {
    $current = [Security.Principal.WindowsPrincipal]::new(
        [Security.Principal.WindowsIdentity]::GetCurrent())
    return $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ============================================================
# MAIN - mode dispatcher (sections wired in later tasks)
# ============================================================
if (-not (Test-IsAdmin)) {
    Write-Error "Must run as Administrator (or SYSTEM via Action1)."
    exit 1
}

Initialize-WcsDir
Write-WcsLog 'Init' 'OK' "Run started - mode=$Mode, machine=$env:COMPUTERNAME, location=$LocationName"

switch ($Mode) {
    'Full'      { Write-WcsLog 'Init' 'WARN' 'Full mode - sections not yet wired (placeholder)' }
    'Lockdown'  { Write-WcsLog 'Init' 'WARN' 'Lockdown mode - sections not yet wired' }
    'Cleanup'   { Write-WcsLog 'Init' 'WARN' 'Cleanup mode - sections not yet wired' }
    'Inventory' { Write-WcsLog 'Init' 'WARN' 'Inventory mode - sections not yet wired' }
}

Write-WcsLog 'Done' 'OK' 'Run finished'
