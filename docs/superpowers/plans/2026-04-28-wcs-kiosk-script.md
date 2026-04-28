# WCS Kiosk Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/wcs-kiosk.ps1` — a single idempotent PowerShell script
that Action1 pushes to all WCS front-desk kiosks to enforce users, app
installs, branding, and Staff lockdown in one pass.

**Architecture:** One self-contained PowerShell file. Param block at top
(mode + apply flag), config block, helper functions, section functions
(one per spec section), mode dispatcher, main flow at bottom. Each
section is gated on a state check so re-runs are no-ops when desired
state already holds. Action1 captures stdout; the script also tees to
`C:\WCS\setup.log` for persistent on-disk record.

**Tech Stack:** PowerShell 5.1 (Windows-built-in; no PS7 dependency),
Windows registry (HKLM + HKEY_USERS via `reg load`), `Get-LocalUser` /
`New-LocalUser` cmdlets, `New-ScheduledTask*`, `Invoke-WebRequest` for
installers and branding images.

**Testing strategy:** This is a Windows admin script that mutates
system state — there is no realistic unit-test surface for cmdlet
calls without mocking the entire Windows API. Verification strategy:
1. **PSScriptAnalyzer** lints the script for syntax + style errors
   after each task (one-time install: `Install-Module PSScriptAnalyzer
   -Scope CurrentUser`).
2. **`-Mode Inventory`** acts as the smoke test — it reads state and
   reports without making any changes. Run after each task to verify
   the new section parses + dispatches correctly.
3. **Manual run on Justin's local machine** before pushing to Action1
   — the local user is `justi`, well outside the allowlist, but the
   profile sweep deletes only OTHER local users, never the currently
   logged-in user (Windows blocks deleting the active session). Justin
   reviews `C:\WCS\setup.log` after each test run.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/wcs-kiosk.ps1` | NEW | Single consolidated kiosk script |
| `scripts/setup-kiosk.ps1` | RENAME → `setup-kiosk.ps1.archive` | Reference only, not pushed via Action1 |
| `scripts/chrome-lockdown.ps1` | DELETE | Folded into wcs-kiosk.ps1 section 5 |
| `scripts/lock-profile.ps1` | DELETE | Folded into wcs-kiosk.ps1 section 5 |
| `scripts/nightly-cleanup.ps1` | DELETE | Folded into wcs-kiosk.ps1 section 7 |
| `scripts/chrome-unlock.ps1` | KEEP | Emergency single-kiosk unlock |
| `scripts/set-abc-url.ps1` | KEEP | Standalone admin tool |
| `scripts/README.md` | REWRITE | Document the consolidated script |

---

## Task 1: Scaffold + helpers + logging

**Files:**
- Create: `scripts/wcs-kiosk.ps1`

- [ ] **Step 1: Create the file with param block + config block + log helper**

```powershell
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
    Full      — runs every section (default, used for new-machine bootstrap)
    Lockdown  — only sections 5 (Chrome) + 6 (Staff HKCU)
    Cleanup   — only section 2 (profile sweep)
    Inventory — read-only state report, no changes
.NOTES
    Run as SYSTEM via Action1, or manually as local Administrator.
    Idempotent — safe to re-run anytime.
#>

param(
    [ValidateSet('Full','Lockdown','Cleanup','Inventory')]
    [string]$Mode = 'Full'
)

$ErrorActionPreference = 'Stop'

# ============================================================
# CONFIGURATION — edit $LocationName per kiosk, rest is stable
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
        [Parameter(Mandatory=$true)][string]$Section,   # e.g. 'Users'
        [Parameter(Mandatory=$true)][string]$Status,    # OK, SKIP, INST, REMOVE, WARN, ERR
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
# MAIN — mode dispatcher (sections wired in later tasks)
# ============================================================
if (-not (Test-IsAdmin)) {
    Write-Error "Must run as Administrator (or SYSTEM via Action1)."
    exit 1
}

Initialize-WcsDir
Write-WcsLog 'Init' 'OK' "Run started — mode=$Mode, machine=$env:COMPUTERNAME, location=$LocationName"

switch ($Mode) {
    'Full'      { Write-WcsLog 'Init' 'WARN' 'Full mode — sections not yet wired (placeholder)' }
    'Lockdown'  { Write-WcsLog 'Init' 'WARN' 'Lockdown mode — sections not yet wired' }
    'Cleanup'   { Write-WcsLog 'Init' 'WARN' 'Cleanup mode — sections not yet wired' }
    'Inventory' { Write-WcsLog 'Init' 'WARN' 'Inventory mode — sections not yet wired' }
}

Write-WcsLog 'Done' 'OK' 'Run finished'
```

- [ ] **Step 2: Lint the script**

```powershell
Install-Module PSScriptAnalyzer -Scope CurrentUser -Force -SkipPublisherCheck   # one-time
Invoke-ScriptAnalyzer -Path scripts/wcs-kiosk.ps1
```

Expected: no errors. (`PSAvoidUsingPlainTextForPassword` warning on
`$StaffPassword`/`$AdminPassword` is acceptable — these are kiosk
passwords, not secrets.)

- [ ] **Step 3: Smoke-test in Inventory mode**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1 -Mode Inventory
```

Expected stdout (timestamps will differ):
```
2026-04-28 16:40:00 [Init]  OK     Run started — mode=Inventory, machine=...
2026-04-28 16:40:00 [Init]  WARN   Inventory mode — sections not yet wired
2026-04-28 16:40:00 [Done]  OK     Run finished
```

Verify `C:\WCS\setup.log` exists and contains the same three lines.

- [ ] **Step 4: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): scaffold wcs-kiosk.ps1 with config + log helpers"
```

---

## Task 2: Section 1 — User management

**Files:**
- Modify: `scripts/wcs-kiosk.ps1` (add `Set-WcsUsers` function + Full-mode dispatch)

- [ ] **Step 1: Add the Set-WcsUsers function**

Insert after the `Test-IsAdmin` function:

```powershell
function Set-WcsUsers {
    $users = @(
        @{ Name='Staff'; Password=$StaffPassword; Group='Users';          FullName='WCS Staff'; Description='Kiosk account' }
        @{ Name='Admin'; Password=$AdminPassword; Group='Administrators'; FullName='WCS Admin'; Description='IT admin account' }
    )

    foreach ($u in $users) {
        $secure = ConvertTo-SecureString $u.Password -AsPlainText -Force
        $existing = Get-LocalUser -Name $u.Name -ErrorAction SilentlyContinue

        if (-not $existing) {
            New-LocalUser -Name $u.Name -Password $secure -FullName $u.FullName `
                          -Description $u.Description -PasswordNeverExpires | Out-Null
            Add-LocalGroupMember -Group $u.Group -Member $u.Name -ErrorAction SilentlyContinue
            Write-WcsLog 'Users' 'INST' "Created $($u.Name) in group $($u.Group)"
        } else {
            Set-LocalUser -Name $u.Name -Password $secure -PasswordNeverExpires $true
            $isMember = Get-LocalGroupMember -Group $u.Group -Member $u.Name -ErrorAction SilentlyContinue
            if (-not $isMember) {
                Add-LocalGroupMember -Group $u.Group -Member $u.Name
                Write-WcsLog 'Users' 'OK' "$($u.Name) re-added to $($u.Group)"
            } else {
                Write-WcsLog 'Users' 'OK' "$($u.Name) present, password reset"
            }
        }
    }
}
```

- [ ] **Step 2: Wire into the mode dispatcher**

Replace the `Full` arm of the switch with:
```powershell
'Full'      {
    Set-WcsUsers
    # later sections appended here
}
```

- [ ] **Step 3: Lint**

```powershell
Invoke-ScriptAnalyzer -Path scripts/wcs-kiosk.ps1
```

Expected: no new errors.

- [ ] **Step 4: Smoke-test in Full mode on Justin's machine**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1
```

Expected log lines:
```
[Users] INST   Created Staff in group Users          (first run only)
[Users] INST   Created Admin in group Administrators (first run only)
[Users] OK     Staff present, password reset         (subsequent runs)
[Users] OK     Admin present, password reset
```

Verify with `Get-LocalUser`:
```powershell
Get-LocalUser | Where-Object { $_.Name -in 'Staff','Admin' }
```

- [ ] **Step 5: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): ensure Staff + Admin local users exist with correct groups"
```

---

## Task 3: Section 2 — Profile sweep

**Files:**
- Modify: `scripts/wcs-kiosk.ps1` (add `Invoke-WcsProfileSweep` + dispatch)

- [ ] **Step 1: Add the Invoke-WcsProfileSweep function**

Insert after `Set-WcsUsers`:

```powershell
function Invoke-WcsProfileSweep {
    $preserve = @($AllowedUsers + $BuiltInUsers)

    Get-LocalUser | ForEach-Object {
        $name = $_.Name
        if ($preserve -contains $name) {
            Write-WcsLog 'Sweep' 'OK' "Preserving $name"
            return
        }

        # Never delete the currently-logged-in user (Windows blocks anyway,
        # but log defensively so the failure is recorded clearly)
        if ($name -ieq $env:USERNAME) {
            Write-WcsLog 'Sweep' 'WARN' "Skipping $name — currently logged in"
            return
        }

        try {
            Remove-LocalUser -Name $name -ErrorAction Stop
            Write-WcsLog 'Sweep' 'REMOVE' "Account: $name"
        } catch {
            Write-WcsLog 'Sweep' 'ERR' "Could not remove account $name`: $($_.Exception.Message)"
            return
        }

        $profilePath = "C:\Users\$name"
        if (Test-Path $profilePath) {
            try {
                Remove-Item -Path $profilePath -Recurse -Force -ErrorAction Stop
                Write-WcsLog 'Sweep' 'REMOVE' "Profile folder: $profilePath"
            } catch {
                Write-WcsLog 'Sweep' 'WARN' "Could not delete $profilePath`: $($_.Exception.Message)"
            }
        }
    }
}
```

- [ ] **Step 2: Wire into Full + Cleanup dispatch arms**

```powershell
'Full' {
    Set-WcsUsers
    Invoke-WcsProfileSweep
}
'Cleanup' {
    Invoke-WcsProfileSweep
}
```

- [ ] **Step 3: Lint**

```powershell
Invoke-ScriptAnalyzer -Path scripts/wcs-kiosk.ps1
```

Expected: no new errors.

- [ ] **Step 4: Verify allowlist logic on Justin's machine**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1 -Mode Cleanup
```

Expected: every user other than `Staff`, `Admin`, `abctech` (if present),
the four built-ins, and `justi` (currently logged in) gets logged as
removed. **Before running, list current users:**

```powershell
Get-LocalUser | Select Name, Enabled
```

Decide which accounts you actually want gone. If anything unexpected
appears in the "would be removed" set, abort and update `$AllowedUsers`
in the config block before running.

- [ ] **Step 5: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): auto-delete non-allowlisted local users + profile folders"
```

---

## Task 4: Section 3 — App installation (Portal, Chrome, Sonos)

**Files:**
- Modify: `scripts/wcs-kiosk.ps1` (add `Install-WcsApps` + dispatch)

- [ ] **Step 1: Add app-install helpers**

Insert after `Invoke-WcsProfileSweep`:

```powershell
function Test-PortalInstalled {
    $keys = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($k in $keys) {
        $hit = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue |
               Where-Object { $_.DisplayName -match '^(Portal|WCS App)$' }
        if ($hit) { return $true }
    }
    return $false
}

function Test-ChromeInstalled {
    Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe'
}

function Test-SonosInstalled {
    $key = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    $hit = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue |
           Where-Object { $_.DisplayName -match 'Sonos' }
    return [bool]$hit
}

function Install-FromUrl {
    param(
        [Parameter(Mandatory)][string]$Section,
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$LocalName,
        [Parameter(Mandatory)][string[]]$SilentArgs
    )
    $installer = Join-Path $env:TEMP $LocalName
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        Invoke-WebRequest -Uri $Url -OutFile $installer -UseBasicParsing
        Start-Process -FilePath $installer -ArgumentList $SilentArgs -Wait -ErrorAction Stop
        Write-WcsLog $Section 'INST' "Installed from $Url"
    } catch {
        Write-WcsLog $Section 'ERR' "Install failed: $($_.Exception.Message)"
    } finally {
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
    }
}

function Install-WcsApps {
    # Kill running Portal so installer can overwrite
    Get-Process -Name 'Portal','WCS App' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    if (Test-PortalInstalled) {
        Write-WcsLog 'Apps' 'SKIP' 'Portal already installed (auto-updater handles upgrades)'
    } else {
        Install-FromUrl -Section 'Apps' -Url $LauncherUrl `
                        -LocalName 'Portal-Setup.exe' -SilentArgs @('/S')
    }

    if (Test-ChromeInstalled) {
        Write-WcsLog 'Apps' 'SKIP' 'Chrome already installed'
    } else {
        Install-FromUrl -Section 'Apps' -Url $ChromeUrl `
                        -LocalName 'chrome-setup.exe' -SilentArgs @('/silent','/install')
    }

    if (Test-SonosInstalled) {
        Write-WcsLog 'Apps' 'SKIP' 'Sonos already installed'
    } else {
        Install-FromUrl -Section 'Apps' -Url $SonosUrl `
                        -LocalName 'Sonos-Setup.exe' -SilentArgs @('/S')
    }
}
```

- [ ] **Step 2: Wire into Full dispatch**

```powershell
'Full' {
    Set-WcsUsers
    Invoke-WcsProfileSweep
    Install-WcsApps
}
```

- [ ] **Step 3: Lint**

```powershell
Invoke-ScriptAnalyzer -Path scripts/wcs-kiosk.ps1
```

- [ ] **Step 4: Smoke-test on Justin's machine**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1
```

Justin's machine already has Chrome → expect `[Apps] SKIP Chrome already installed`.
Portal/Sonos may install fresh — verify with:

```powershell
Get-Process -Name 'Portal','chrome','Sonos' -ErrorAction SilentlyContinue | Select Name
Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' |
    Where-Object DisplayName -match 'Portal|Sonos|Chrome' | Select DisplayName, DisplayVersion
```

- [ ] **Step 5: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): install Portal, Chrome, Sonos when missing (idempotent)"
```

---

## Task 5: Section 4 — Branding (wallpaper + lockscreen)

**Files:**
- Modify: `scripts/wcs-kiosk.ps1` (add `Set-WcsBranding` + dispatch)

- [ ] **Step 1: Add Set-WcsBranding**

Insert after `Install-WcsApps`:

```powershell
function Get-RemoteSha256 {
    param([string]$Url)
    try {
        $tmp = New-TemporaryFile
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing -ErrorAction Stop
        $h = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash
        Remove-Item $tmp -Force
        return $h
    } catch {
        return $null
    }
}

function Sync-RemoteFile {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$LocalPath
    )
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $remoteHash = Get-RemoteSha256 -Url $Url
    if (-not $remoteHash) { return $false }   # 404 or unreachable

    if (Test-Path $LocalPath) {
        $localHash = (Get-FileHash -Path $LocalPath -Algorithm SHA256).Hash
        if ($localHash -eq $remoteHash) { return $true }
    }
    Invoke-WebRequest -Uri $Url -OutFile $LocalPath -UseBasicParsing
    return $true
}

function Set-WallpaperForUser {
    param([string]$User, [string]$ImagePath)

    $userProfile = "C:\Users\$User"
    $hive        = "$userProfile\NTUSER.DAT"
    if (-not (Test-Path $hive)) {
        Write-WcsLog 'Branding' 'WARN' "Hive not found for $User (user has not logged in yet)"
        return
    }

    $hiveKey = "WCS_$User"
    & reg.exe load "HKU\$hiveKey" $hive 2>&1 | Out-Null
    try {
        $polPath = "Registry::HKEY_USERS\$hiveKey\Software\Microsoft\Windows\CurrentVersion\Policies\System"
        if (-not (Test-Path $polPath)) { New-Item -Path $polPath -Force | Out-Null }
        Set-ItemProperty -Path $polPath -Name 'Wallpaper'            -Value $ImagePath -Type String
        Set-ItemProperty -Path $polPath -Name 'WallpaperStyle'       -Value '10'       -Type String
        Set-ItemProperty -Path $polPath -Name 'NoChangingWallpaper'  -Value 1          -Type DWord
        Write-WcsLog 'Branding' 'OK' "Wallpaper set for $User"
    } finally {
        # Force GC so the hive can unload (Windows holds references otherwise)
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        & reg.exe unload "HKU\$hiveKey" 2>&1 | Out-Null
    }
}

function Set-WcsBranding {
    $wallpaper  = "$BrandingDir\wallpaper.jpg"
    $lockscreen = "$BrandingDir\lockscreen.jpg"

    $wOk = Sync-RemoteFile -Url $WallpaperUrl  -LocalPath $wallpaper
    $lOk = Sync-RemoteFile -Url $LockscreenUrl -LocalPath $lockscreen

    if (-not $wOk -or -not $lOk) {
        Write-WcsLog 'Branding' 'WARN' "Branding images unavailable — skipping (commit branding/*.jpg to repo)"
        return
    }

    # Lockscreen — machine-wide
    $lockPolPath = 'HKLM:\Software\Policies\Microsoft\Windows\Personalization'
    if (-not (Test-Path $lockPolPath)) { New-Item -Path $lockPolPath -Force | Out-Null }
    Set-ItemProperty -Path $lockPolPath -Name 'LockScreenImage'      -Value $lockscreen -Type String
    Set-ItemProperty -Path $lockPolPath -Name 'NoChangingLockScreen' -Value 1           -Type DWord
    Write-WcsLog 'Branding' 'OK' 'Lockscreen set machine-wide'

    # Wallpaper — per real user
    foreach ($u in @('Staff','Admin')) {
        if (Get-LocalUser -Name $u -ErrorAction SilentlyContinue) {
            Set-WallpaperForUser -User $u -ImagePath $wallpaper
        }
    }
}
```

- [ ] **Step 2: Wire into Full dispatch**

```powershell
'Full' {
    Set-WcsUsers
    Invoke-WcsProfileSweep
    Install-WcsApps
    Set-WcsBranding
}
```

- [ ] **Step 3: Lint**

```powershell
Invoke-ScriptAnalyzer -Path scripts/wcs-kiosk.ps1
```

- [ ] **Step 4: Smoke-test**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1
```

Expected log lines:
```
[Branding] OK     Lockscreen set machine-wide
[Branding] WARN   Hive not found for Staff (user has not logged in yet)
[Branding] OK     Wallpaper set for Admin
```

(Staff hive only exists after first login. Re-running after Staff has
logged in will set both.)

Verify lockscreen registry:
```powershell
Get-ItemProperty 'HKLM:\Software\Policies\Microsoft\Windows\Personalization' |
    Select LockScreenImage, NoChangingLockScreen
```

- [ ] **Step 5: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): set wallpaper per-user and lockscreen machine-wide"
```

---

## Task 6: Section 5 — Chrome HKLM hygiene policies

**Files:**
- Modify: `scripts/wcs-kiosk.ps1` (add `Set-WcsChromePolicies` + dispatch)

- [ ] **Step 1: Add Set-WcsChromePolicies**

Insert after `Set-WcsBranding`:

```powershell
function Set-WcsChromePolicies {
    $root = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
    if (-not (Test-Path $root)) { New-Item -Path $root -Force | Out-Null }

    $dword = @{
        BrowserSignin              = 0    # no Chrome profile sign-in
        SyncDisabled               = 1
        BrowserAddPersonEnabled    = 0
        BrowserGuestModeEnabled    = 0
        PasswordManagerEnabled     = 0
        AutofillAddressEnabled     = 0
        AutofillCreditCardEnabled  = 0
        IncognitoModeAvailability  = 1    # disabled — required so SafeSearch can't be sidestepped
        DownloadRestrictions       = 3    # block all downloads
        ForceGoogleSafeSearch      = 1
        ForceYouTubeRestrictedMode = 2    # strict
        ForceBingSafeSearch        = 2    # strict
    }
    foreach ($name in $dword.Keys) {
        Set-ItemProperty -Path $root -Name $name -Value $dword[$name] -Type DWord
    }

    # Remove legacy URL allowlist/blocklist + portal startup keys if they exist
    foreach ($subKey in 'URLAllowlist','URLBlocklist','RestoreOnStartupURLs','PinnedTabs') {
        $path = Join-Path $root $subKey
        if (Test-Path $path) { Remove-Item -Path $path -Recurse -Force }
    }
    foreach ($legacyVal in 'RestoreOnStartup','RestrictSigninToPattern','ClearBrowsingDataOnExit','DeveloperToolsAvailability') {
        if (Get-ItemProperty -Path $root -Name $legacyVal -ErrorAction SilentlyContinue) {
            Remove-ItemProperty -Path $root -Name $legacyVal -Force
        }
    }

    Write-WcsLog 'Chrome' 'OK' 'HKLM Chrome hygiene policies applied (no URL allowlist)'
}
```

- [ ] **Step 2: Wire into Full + Lockdown dispatch**

```powershell
'Full' {
    Set-WcsUsers
    Invoke-WcsProfileSweep
    Install-WcsApps
    Set-WcsBranding
    Set-WcsChromePolicies
}
'Lockdown' {
    Set-WcsChromePolicies
    # Set-WcsStaffLockdown wired in next task
}
```

- [ ] **Step 3: Lint**

- [ ] **Step 4: Smoke-test, verify policies**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1 -Mode Lockdown
Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Google\Chrome' |
    Select DownloadRestrictions, ForceGoogleSafeSearch, IncognitoModeAvailability, BrowserSignin
```

Expected: `DownloadRestrictions=3, ForceGoogleSafeSearch=1, IncognitoModeAvailability=1, BrowserSignin=0`.

Open Chrome, type `chrome://policy` — verify the new policies appear and
no URL allowlist is listed.

- [ ] **Step 5: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): apply Chrome hygiene policies (no allowlist; SafeSearch + no downloads)"
```

---

## Task 7: Section 6 — Staff Windows HKCU lockdown

**Files:**
- Modify: `scripts/wcs-kiosk.ps1` (add `Set-WcsStaffLockdown` + dispatch)

- [ ] **Step 1: Add Set-WcsStaffLockdown**

Insert after `Set-WcsChromePolicies`:

```powershell
function Set-WcsStaffLockdown {
    $userProfile = 'C:\Users\Staff'
    $hive        = "$userProfile\NTUSER.DAT"
    if (-not (Test-Path $hive)) {
        Write-WcsLog 'StaffLock' 'WARN' 'Staff hive not found (user has not logged in yet) — skipping HKCU lockdown'
        return
    }

    $hiveKey = 'WCS_Staff_Lock'
    & reg.exe load "HKU\$hiveKey" $hive 2>&1 | Out-Null
    try {
        $explorer = "Registry::HKEY_USERS\$hiveKey\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
        if (-not (Test-Path $explorer)) { New-Item -Path $explorer -Force | Out-Null }

        # Single-value policies
        $policies = @{
            NoControlPanel       = 1
            DisallowRun          = 1
            NoRun                = 1
            NoViewContextMenu    = 1
            NoDrives             = 67108863   # hide all drive letters in This PC
        }
        foreach ($k in $policies.Keys) {
            Set-ItemProperty -Path $explorer -Name $k -Value $policies[$k] -Type DWord
        }

        # DisallowRun child entries (named 1, 2, 3, ...)
        $disallow = "$explorer\DisallowRun"
        if (-not (Test-Path $disallow)) { New-Item -Path $disallow -Force | Out-Null }
        $blocked = @(
            'cmd.exe', 'powershell.exe', 'pwsh.exe', 'regedit.exe',
            'msedge.exe', 'mmc.exe', 'msconfig.exe', 'gpedit.msc',
            'WindowsStore.exe'
        )
        # Clear existing entries first so removed ones don't linger
        Get-Item -Path $disallow | Select-Object -ExpandProperty Property |
            ForEach-Object { Remove-ItemProperty -Path $disallow -Name $_ -ErrorAction SilentlyContinue }
        for ($i = 0; $i -lt $blocked.Count; $i++) {
            Set-ItemProperty -Path $disallow -Name (($i + 1).ToString()) -Value $blocked[$i] -Type String
        }

        # Microsoft Store
        $storePol = "Registry::HKEY_USERS\$hiveKey\Software\Policies\Microsoft\WindowsStore"
        if (-not (Test-Path $storePol)) { New-Item -Path $storePol -Force | Out-Null }
        Set-ItemProperty -Path $storePol -Name 'RemoveWindowsStore' -Value 1 -Type DWord

        Write-WcsLog 'StaffLock' 'OK' "HKCU lockdown applied to Staff (blocked $($blocked.Count) exes)"
    } finally {
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        & reg.exe unload "HKU\$hiveKey" 2>&1 | Out-Null
    }
}
```

- [ ] **Step 2: Wire into Full + Lockdown dispatch**

```powershell
'Full' {
    Set-WcsUsers
    Invoke-WcsProfileSweep
    Install-WcsApps
    Set-WcsBranding
    Set-WcsChromePolicies
    Set-WcsStaffLockdown
}
'Lockdown' {
    Set-WcsChromePolicies
    Set-WcsStaffLockdown
}
```

- [ ] **Step 3: Lint**

- [ ] **Step 4: Smoke-test on Staff hive**

If Staff hasn't logged in yet, log in once as Staff to create
`C:\Users\Staff\NTUSER.DAT`, then log out. Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1 -Mode Lockdown
```

Verify by loading the hive read-only:
```powershell
& reg.exe load HKU\StaffCheck C:\Users\Staff\NTUSER.DAT
Get-ItemProperty 'Registry::HKEY_USERS\StaffCheck\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' |
    Select NoControlPanel, DisallowRun, NoRun, NoDrives
& reg.exe unload HKU\StaffCheck
```

Expected: `NoControlPanel=1, DisallowRun=1, NoRun=1, NoDrives=67108863`.

Optional manual end-to-end: log in as Staff, try to open Settings (Win+I)
— it should not launch. Try `cmd` from Run dialog (which itself should
be hidden) — blocked. Notepad and Task Manager should still work.

- [ ] **Step 5: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): apply Staff HKCU lockdown via NTUSER.DAT load"
```

---

## Task 8: Section 7 — Logon scripts + scheduled tasks

**Files:**
- Modify: `scripts/wcs-kiosk.ps1` (add `Set-WcsScheduledTasks` + dispatch)

- [ ] **Step 1: Add the function**

Insert after `Set-WcsStaffLockdown`:

```powershell
function Write-LogonScripts {
    # Staff logon: launch Portal app (only)
    $staffLogon = @"
`$ErrorActionPreference = 'SilentlyContinue'
`$abcArg = ''
if (Test-Path 'C:\WCS\abc-url.txt') {
    `$abcURL = (Get-Content 'C:\WCS\abc-url.txt' -First 1).Trim()
    if (`$abcURL) { `$abcArg = "--abc-url=`$abcURL" }
}
`$portalApp = 'C:\Program Files\WCS App\WCS App.exe'
if (Test-Path `$portalApp) {
    Start-Process -FilePath `$portalApp -ArgumentList "--location=$LocationName `$abcArg"
}
"@
    Set-Content -Path "$WcsDir\staff-logon.ps1" -Value $staffLogon -Force

    # Admin logon: only the Set-ABC-URL desktop shortcut
    $adminLogon = @'
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$abcPath = Join-Path $desktopPath 'Set ABC URL.lnk'
if (-not (Test-Path $abcPath)) {
    $s = $shell.CreateShortcut($abcPath)
    $s.TargetPath = 'powershell.exe'
    $s.Arguments  = '-NoProfile -ExecutionPolicy Bypass -File "C:\WCS\set-abc-url.ps1"'
    $s.Description = 'Set ABC Financial URL for this machine'
    $s.Save()
}
'@
    Set-Content -Path "$WcsDir\admin-logon.ps1" -Value $adminLogon -Force

    # ABC URL setter dialog (used by the desktop shortcut above)
    $abcSetter = @'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
$abcFile = 'C:\WCS\abc-url.txt'
$current = ''
if (Test-Path $abcFile) { $current = (Get-Content $abcFile -First 1).Trim() }
$new = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Enter the ABC Financial URL for this machine:`n`nCurrent: $current",
    'WCS Portal - Set ABC URL',
    $current)
if ($new -and $new.Trim()) {
    if (-not (Test-Path 'C:\WCS')) { New-Item -Path 'C:\WCS' -ItemType Directory -Force | Out-Null }
    Set-Content -Path $abcFile -Value $new.Trim() -Force
    [System.Windows.Forms.MessageBox]::Show(
        "ABC URL saved!`n`n$($new.Trim())`n`nThis will take effect next time Staff logs in.",
        'WCS Portal', 'OK', 'Information')
}
'@
    Set-Content -Path "$WcsDir\set-abc-url.ps1" -Value $abcSetter -Force
}

function Register-WcsTask {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$ScriptPath,
        [Parameter(Mandatory)][string]$User,
        [Parameter(Mandatory)][ValidateSet('AtLogon','Daily2am')][string]$Trigger
    )
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""

    if ($Trigger -eq 'AtLogon') {
        $trig = New-ScheduledTaskTrigger -AtLogOn
        $trig.UserId = $User
        $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive
    } else {
        $trig = New-ScheduledTaskTrigger -Daily -At '2:00AM'
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    }
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trig -Principal $principal | Out-Null
}

function Set-WcsScheduledTasks {
    Write-LogonScripts

    Register-WcsTask -Name 'WCS-Staff-Logon' -ScriptPath "$WcsDir\staff-logon.ps1" `
                     -User 'Staff' -Trigger AtLogon
    Register-WcsTask -Name 'WCS-Admin-Logon' -ScriptPath "$WcsDir\admin-logon.ps1" `
                     -User 'Admin' -Trigger AtLogon

    # Nightly Chrome cleanup (inline script via -Command)
    $cleanupCmd = @'
$root = 'C:\Users\Staff\AppData\Local\Google\Chrome\User Data'
if (Test-Path $root) {
    Get-ChildItem -Path $root -Directory |
        Where-Object { $_.Name -match '^Profile' } |
        ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}
'@
    if (Get-ScheduledTask -TaskName 'WCS-Nightly-Chrome-Cleanup' -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName 'WCS-Nightly-Chrome-Cleanup' -Confirm:$false
    }
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' `
                 -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$cleanupCmd`""
    $trigger   = New-ScheduledTaskTrigger -Daily -At '2:00AM'
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    Register-ScheduledTask -TaskName 'WCS-Nightly-Chrome-Cleanup' `
        -Action $action -Trigger $trigger -Principal $principal | Out-Null

    Write-WcsLog 'Tasks' 'OK' 'Logon scripts written + scheduled tasks registered'
}
```

- [ ] **Step 2: Wire into Full dispatch**

```powershell
'Full' {
    Set-WcsUsers
    Invoke-WcsProfileSweep
    Install-WcsApps
    Set-WcsBranding
    Set-WcsChromePolicies
    Set-WcsStaffLockdown
    Set-WcsScheduledTasks
}
```

- [ ] **Step 3: Lint**

- [ ] **Step 4: Smoke-test, verify task registration**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1
Get-ScheduledTask -TaskName 'WCS-*' | Select TaskName, State
Test-Path 'C:\WCS\staff-logon.ps1'
Test-Path 'C:\WCS\admin-logon.ps1'
Test-Path 'C:\WCS\set-abc-url.ps1'
```

Expected: 3 tasks (`WCS-Staff-Logon`, `WCS-Admin-Logon`,
`WCS-Nightly-Chrome-Cleanup`) all `Ready`. All 3 logon scripts present.

- [ ] **Step 5: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): write logon scripts + register scheduled tasks"
```

---

## Task 9: Inventory mode — read-only state report

**Files:**
- Modify: `scripts/wcs-kiosk.ps1` (add `Get-WcsInventory` + wire dispatch)

- [ ] **Step 1: Add Get-WcsInventory**

Insert after `Set-WcsScheduledTasks`:

```powershell
function Get-WcsInventory {
    Write-WcsLog 'Inv' 'OK' "--- Kiosk inventory: $env:COMPUTERNAME ---"

    # Users
    $users = Get-LocalUser | Where-Object { -not ($BuiltInUsers -contains $_.Name) }
    foreach ($u in $users) {
        $tag = if ($AllowedUsers -contains $u.Name) { 'allowed' } else { 'WOULD-REMOVE' }
        Write-WcsLog 'Inv' 'OK' "User: $($u.Name) [$tag] enabled=$($u.Enabled)"
    }

    # Apps
    $portal = Test-PortalInstalled
    $chrome = Test-ChromeInstalled
    $sonos  = Test-SonosInstalled
    Write-WcsLog 'Inv' 'OK' "Apps: Portal=$portal, Chrome=$chrome, Sonos=$sonos"

    # Chrome policies present?
    $cp = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Google\Chrome' -ErrorAction SilentlyContinue
    if ($cp) {
        Write-WcsLog 'Inv' 'OK' ("Chrome: DownloadRestrictions={0}, SafeSearch={1}, Incognito={2}" -f
            $cp.DownloadRestrictions, $cp.ForceGoogleSafeSearch, $cp.IncognitoModeAvailability)
    } else {
        Write-WcsLog 'Inv' 'WARN' 'Chrome HKLM policies not present'
    }

    # Lockscreen
    $lp = Get-ItemProperty 'HKLM:\Software\Policies\Microsoft\Windows\Personalization' -ErrorAction SilentlyContinue
    if ($lp.LockScreenImage) {
        Write-WcsLog 'Inv' 'OK' "Lockscreen: $($lp.LockScreenImage)"
    } else {
        Write-WcsLog 'Inv' 'WARN' 'Lockscreen image not configured'
    }

    # Tasks
    $tasks = Get-ScheduledTask -TaskName 'WCS-*' -ErrorAction SilentlyContinue
    foreach ($t in $tasks) {
        Write-WcsLog 'Inv' 'OK' "Task: $($t.TaskName) state=$($t.State)"
    }
}
```

- [ ] **Step 2: Wire dispatch**

```powershell
'Inventory' {
    Get-WcsInventory
}
```

- [ ] **Step 3: Lint**

- [ ] **Step 4: Run inventory and review**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1 -Mode Inventory
```

Expected: a clean read-only summary showing every relevant state. No
warnings if previous tasks all completed successfully.

- [ ] **Step 5: Commit**

```bash
git add scripts/wcs-kiosk.ps1
git commit -m "feat(scripts): add Inventory mode for read-only state reporting"
```

---

## Task 10: Cleanup of legacy scripts + README rewrite

**Files:**
- Rename: `scripts/setup-kiosk.ps1` → `scripts/setup-kiosk.ps1.archive`
- Delete: `scripts/chrome-lockdown.ps1`, `scripts/lock-profile.ps1`, `scripts/nightly-cleanup.ps1`
- Rewrite: `scripts/README.md`

- [ ] **Step 1: Archive setup-kiosk.ps1, delete superseded scripts**

```bash
git -C C:/Users/justi/wcs-staff-portal mv scripts/setup-kiosk.ps1 scripts/setup-kiosk.ps1.archive
git -C C:/Users/justi/wcs-staff-portal rm scripts/chrome-lockdown.ps1 scripts/lock-profile.ps1 scripts/nightly-cleanup.ps1
```

- [ ] **Step 2: Rewrite scripts/README.md**

Replace the entire contents:

```markdown
# WCS Action1 Deployment Scripts

## wcs-kiosk.ps1

Single consolidated script that enforces full kiosk state. Pushes via
Action1 to all WCS-Kiosk-tagged endpoints. Idempotent — safe to re-run.

### Modes

| Mode | What runs |
|---|---|
| `Full` (default) | Users → Profile sweep → App install → Branding → Chrome policies → Staff lockdown → Scheduled tasks |
| `Lockdown` | Chrome policies + Staff HKCU lockdown only |
| `Cleanup` | Profile sweep only (auto-deletes non-allowlisted users) |
| `Inventory` | Read-only state report (no changes) |

### Configuration

Edit `$LocationName` near the top of the file before pushing each
location's run from Action1. Everything else is stable across kiosks.

### Action1 deployment

1. Action1 → Scripts → New Script
2. Paste full contents of `wcs-kiosk.ps1`
3. Optionally append `-Mode Lockdown` (or other mode) to the
   PowerShell command line if you want a partial run.
4. Run as: SYSTEM
5. Target: machines tagged `WCS-Kiosk`
6. Logs land in `C:\WCS\setup.log` on each kiosk; Action1 console
   captures stdout for the run.

### Allowlisted profiles

`Staff`, `Admin`, and `abctech` (only if pre-existing) are preserved.
Built-in disabled accounts (Administrator, DefaultAccount, Guest,
WDAGUtilityAccount) are never touched. Any other local user account
is auto-deleted on every Full or Cleanup run, along with its
`C:\Users\<name>` profile folder.

### Branding

Wallpaper and lockscreen images are pulled from
`branding/wallpaper.jpg` and `branding/lockscreen.jpg` on the master
branch of this repo. Push a commit to update them.

## chrome-unlock.ps1

Emergency single-kiosk unlock — removes Chrome HKLM policies +
unregisters the WCS scheduled tasks + clears `C:\WCS\`. Does not
delete users.

## set-abc-url.ps1

Standalone helper — opens a dialog asking for the ABC Financial URL
and writes it to `C:\WCS\abc-url.txt`. Triggered from the Admin
desktop shortcut that `wcs-kiosk.ps1` sets up.

## setup-kiosk.ps1.archive

Predecessor to `wcs-kiosk.ps1`. Kept for historical reference only —
**do not push via Action1.**
```

- [ ] **Step 3: Lint the new script**

```powershell
Invoke-ScriptAnalyzer -Path scripts/wcs-kiosk.ps1
```

Expected: no errors.

- [ ] **Step 4: Final end-to-end on Justin's machine**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/wcs-kiosk.ps1 -Mode Inventory
```

Run twice. The second run should produce mostly `SKIP` and `OK` lines,
no `INST` lines (apps already installed, users already exist) — that
confirms the script is idempotent.

- [ ] **Step 5: Commit**

```bash
git add scripts/README.md scripts/setup-kiosk.ps1.archive
git rm --cached scripts/setup-kiosk.ps1   # in case the rename didn't move it cleanly
git commit -m "chore(scripts): retire legacy scripts, rewrite README for wcs-kiosk.ps1"
git push
```

---

## Self-Review Checklist (post-write)

- [ ] **Spec coverage:** every section of the design spec maps to a task
  - Section 0 (preflight) → Task 1
  - Section 1 (users) → Task 2
  - Section 2 (sweep) → Task 3
  - Section 3 (apps) → Task 4
  - Section 4 (branding) → Task 5
  - Section 5 (Chrome) → Task 6
  - Section 6 (Staff lockdown) → Task 7
  - Section 7 (logon + tasks) → Task 8
  - Section 8 (logging) → covered in Task 1's `Write-WcsLog` helper
  - Modes → Task 9 (Inventory) + dispatcher built incrementally per task
  - File cleanup → Task 10
- [ ] **Placeholders:** none — every code block is complete
- [ ] **Type/name consistency:** function names match across tasks
  (`Set-WcsUsers`, `Invoke-WcsProfileSweep`, `Install-WcsApps`,
  `Set-WcsBranding`, `Set-WcsChromePolicies`, `Set-WcsStaffLockdown`,
  `Set-WcsScheduledTasks`, `Get-WcsInventory`)
- [ ] **Action1 deployability:** final script is one self-contained
  `.ps1` file pasteable into Action1's script box
