# WCS Kiosk Setup Script — Design

**Status:** Approved 2026-04-28, implementation pending
**Owner:** Justin
**Audience:** Action1 RMM operators (Justin / IT)
**Replaces:** `scripts/setup-kiosk.ps1` (archived as `setup-kiosk.ps1.archive`)

## Goal

Consolidate every WCS kiosk-machine policy into a single idempotent
PowerShell script (`scripts/wcs-kiosk.ps1`) that Action1 pushes to all
front-desk PCs across the 7 gym locations. The script bootstraps a fresh
machine top-to-bottom, and a re-run on an existing machine corrects any
drift without side effects.

## Scope of one script

Each section is gated by a state check ("is the desired state already
in place?") so re-running is safe and cheap. The single script handles:

1. Local Windows users (Staff + Admin) created and password-pinned
2. Profile sweep — auto-delete any local user not in the allowlist
3. Application install — Portal app, Chrome, Sonos
4. Branding — wallpaper + lockscreen
5. Chrome HKLM hygiene policies
6. Staff Windows HKCU lockdown
7. Scheduled tasks (logon scripts + nightly Chrome cleanup)
8. Verbose logging to `C:\WCS\setup.log`

## Configuration block (top of file)

```powershell
# Per-machine — only $LocationName changes between kiosks
$LocationName    = 'Salem'

# Stable across all machines
$PortalBaseURL   = 'https://portal.wcstrength.com'
$RepoRawBase     = 'https://raw.githubusercontent.com/justinhuttinger/wcs-staff-portal/master'
$WallpaperUrl    = "$RepoRawBase/branding/wallpaper.jpg"
$LockscreenUrl   = "$RepoRawBase/branding/lockscreen.jpg"
$LauncherUrl     = 'https://github.com/justinhuttinger/wcs-staff-portal/releases/latest/download/Portal-Setup.exe'
$ChromeUrl       = 'https://dl.google.com/chrome/install/standalonesetup64.exe'
$SonosUrl        = 'https://www.sonos.com/redir/controller_software_pc2'
$AllowedUsers    = @('Staff','Admin','abctech')   # plus built-ins, never touched
$StaffPassword   = 'staff'
$AdminPassword   = '!31JellybeaN31!'

$WcsDir          = 'C:\WCS'
$LogPath         = "$WcsDir\setup.log"
```

## Modes

```powershell
.\wcs-kiosk.ps1                    # Full bootstrap (default)
.\wcs-kiosk.ps1 -Mode Lockdown     # Just Chrome + Staff HKCU lockdown
.\wcs-kiosk.ps1 -Mode Cleanup      # Just profile sweep
.\wcs-kiosk.ps1 -Mode Inventory    # Read-only state report (no changes)
```

`Full` is the Action1 default — runs every section. The other modes
exist so a single script source can serve targeted Action1 runs without
forking.

## Section-by-section design

### 0. Preflight

- `#Requires -RunAsAdministrator`
- Create `C:\WCS\` if missing
- Open `$LogPath` for append; every action writes a timestamped line and
  also echoes to stdout so Action1 captures it
- Print machine name, location, and mode at start

### 1. Users

For each of `Staff` and `Admin`:

- Create with `New-LocalUser` if missing
- Set password every run (pins drift if password was changed locally)
- `PasswordNeverExpires`, `UserMayNotChangePassword` for Staff
- Group membership: Staff → `Users`, Admin → `Administrators`

### 2. Profile sweep — auto-delete non-allowlisted accounts

The intent: guarantee that, on any kiosk, the only enabled local
accounts are `Staff`, `Admin`, and (if it already exists) `abctech`.
Built-in disabled accounts are never touched.

```
preserve_always = {Administrator, DefaultAccount, Guest, WDAGUtilityAccount}
preserve_app    = {Staff, Admin, abctech}    # abctech only if pre-existing

for user in Get-LocalUser:
  if user.Name in (preserve_always ∪ preserve_app): continue
  Remove-LocalUser  user.Name
  Remove-Item       C:\Users\<user.Name>  -Recurse -Force  (if exists)
  log "Removed user: <user.Name>"
```

Behavior: **delete on every run, no confirmation flag.** This was an
explicit choice — the allowlist is conservative enough that any
non-listed account should not be on a kiosk.

The `abctech` account is preserved if it exists but **not created** by
this script. Machines without `abctech` stay at 2 accounts; machines with
it stay at 3.

### 3. Application install

For each app, check installed state first; only download + install when
missing. Re-runs are no-ops once apps are present at any version.

| App | State check | Install |
|---|---|---|
| Portal app | `HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` for `DisplayName` matching `Portal` | Download `$LauncherUrl`, run with `/S` (NSIS silent) |
| Chrome | `Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe'` | Download `$ChromeUrl`, run silent |
| Sonos | `Get-Package` filtered for "Sonos" | Download `$SonosUrl`, run silent (`/S` or `/silent`) |

The Portal app's auto-updater (`electron-updater`) handles version
upgrades on its own at runtime. This script only ensures *some* version
is installed. Version pinning / forced upgrade is out of scope for v1.

Before any install, kill `Portal.exe` if running so the installer can
overwrite files.

### 4. Branding

**Lockscreen** — single registry edit, applies to all users:

```
HKLM:\Software\Policies\Microsoft\Windows\Personalization
  LockScreenImage      = C:\WCS\branding\lockscreen.jpg
  NoChangingLockScreen = 1
```

**Wallpaper** — per-user, written into Staff and Admin hives:

```powershell
foreach ($u in 'Staff','Admin') {
  reg load HKU\WCS_$u  C:\Users\$u\NTUSER.DAT
  Set HKU\WCS_$u\Software\Microsoft\Windows\CurrentVersion\Policies\System\Wallpaper          = 'C:\WCS\branding\wallpaper.jpg'
  Set HKU\WCS_$u\Software\Microsoft\Windows\CurrentVersion\Policies\System\WallpaperStyle     = '10'   # fill
  Set HKU\WCS_$u\Software\Microsoft\Windows\CurrentVersion\Policies\System\NoChangingWallpaper = 1
  reg unload HKU\WCS_$u
}
```

Images are downloaded fresh from `$WallpaperUrl` / `$LockscreenUrl` to
`C:\WCS\branding\` each run. SHA-256 comparison: only re-write if remote
differs from local, so pushing a new image to the repo's `branding/`
folder propagates on the next run.

**Required repo state:** Justin commits `branding/wallpaper.jpg` and
`branding/lockscreen.jpg` to `wcs-staff-portal` master before script
runs in production. Until then, the script logs a warning and skips the
branding section instead of failing the whole run.

### 5. Chrome HKLM policies (hygiene only — no URL allowlist)

The Portal app is the canonical entry point for work tools. Chrome is a
general-purpose browser for staff with appropriate guardrails. We do
**not** hardcode the portal URL in Chrome, do **not** maintain a URL
allowlist, and do **not** install the WCS Chrome extension.

```
HKLM:\SOFTWARE\Policies\Google\Chrome
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
```

Removed vs. legacy `chrome-lockdown.ps1`:
- `URLBlocklist`, `URLAllowlist` — Chrome is now open to the web
- `RestoreOnStartup`, `RestoreOnStartupURLs`, `PinnedTabs` — portal opens via the Portal app, not Chrome
- `RestrictSigninToPattern` — superseded by `BrowserSignin = 0`
- `ClearBrowsingDataOnExit` — kiosk session must persist Chrome cookies
- `DeveloperToolsAvailability` — extension is gone

Inappropriate-content posture: SafeSearch on Google/Bing/YouTube +
incognito disabled + downloads blocked. Direct navigation to bad
domains is **not blocked** — accepted risk per design discussion.

### 6. Staff Windows HKCU lockdown

Loaded into Staff's `NTUSER.DAT` via `reg load` (Admin's hive is
untouched — Admin keeps full Windows).

| Restriction | Key under `HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\` | Value |
|---|---|---|
| Block Control Panel + Settings app | `Explorer\NoControlPanel` | `1` |
| Disallow specific exes | `Explorer\DisallowRun` + child entries below | `1` |
| Hide drives in This PC | `Explorer\NoDrives` | `67108863` (all letters) |
| Disable Run dialog | `Explorer\NoRun` | `1` |
| Disable right-click on desktop | `Explorer\NoViewContextMenu` | `1` |
| Block Microsoft Store | `..\..\..\Policies\Microsoft\WindowsStore\RemoveWindowsStore` | `1` |

`DisallowRun` child entries (named `1`, `2`, ...):

```
cmd.exe
powershell.exe
pwsh.exe
regedit.exe
msedge.exe
mmc.exe
msconfig.exe
gpedit.msc
WindowsStore.exe
```

**Explicitly NOT blocked:** `notepad.exe`, `taskmgr.exe`. Per design
discussion: Notepad is harmless; Task Manager is acceptable risk.

### 7. Logon scripts + scheduled tasks

#### `staff-logon.ps1` (written to `C:\WCS\` by main script)

Runs at Staff login. Now responsible only for opening the Portal app:

```powershell
$ErrorActionPreference = 'SilentlyContinue'

# Optional ABC URL config (existing pattern, kept)
$abcArg = ''
if (Test-Path 'C:\WCS\abc-url.txt') {
    $abcURL = (Get-Content 'C:\WCS\abc-url.txt' -First 1).Trim()
    if ($abcURL) { $abcArg = "--abc-url=$abcURL" }
}

# Launch Portal app — no Chrome auto-open
$portalApp = 'C:\Program Files\WCS App\WCS App.exe'
if (Test-Path $portalApp) {
    Start-Process -FilePath $portalApp -ArgumentList "--location=$LocationName $abcArg"
}
```

Removed from previous version: Chrome auto-launch, portal URL building,
desktop shortcut to Chrome (Chrome stays as a normal taskbar icon staff
can click on demand).

#### `admin-logon.ps1` (written to `C:\WCS\` by main script)

Unchanged from current behavior — creates desktop shortcuts:
- "Set ABC URL" — runs `C:\WCS\set-abc-url.ps1` dialog
- (No more "Chrome (Unlocked)" shortcut — Chrome no longer locked
  per-user, so admin Chrome is just regular Chrome)

#### Scheduled tasks (registered/refreshed every run)

| Task name | Trigger | Runs as | Action |
|---|---|---|---|
| `WCS-Staff-Logon` | At logon (Staff only) | Staff | `staff-logon.ps1` |
| `WCS-Admin-Logon` | At logon (Admin only) | Admin | `admin-logon.ps1` |
| `WCS-Nightly-Chrome-Cleanup` | Daily 2:00 AM | SYSTEM | clears extra Chrome profiles under `C:\Users\Staff\AppData\Local\Google\Chrome\User Data\Profile *` |

### 8. Logging + summary

Every action writes a timestamped line to `C:\WCS\setup.log`:

```
2026-04-28 14:03:11 [Users]    OK     Staff exists, password reset
2026-04-28 14:03:11 [Sweep]    REMOVE trainer_dave (account + profile)
2026-04-28 14:03:13 [Apps]     SKIP   Portal already installed
2026-04-28 14:03:14 [Apps]     INST   Sonos installed (download + /S)
2026-04-28 14:03:18 [Branding] OK     Wallpaper + lockscreen written
...
2026-04-28 14:03:25 [Summary]  Done. 1 account removed, 1 app installed, 0 errors.
```

Action1 captures stdout, so the run summary appears in the Action1
console alongside the persistent log on disk.

## Files affected by this work

| File | Action |
|---|---|
| `scripts/wcs-kiosk.ps1` | NEW — single consolidated script |
| `scripts/setup-kiosk.ps1` | RENAME → `setup-kiosk.ps1.archive` (kept for reference, not pushed via Action1) |
| `scripts/chrome-lockdown.ps1` | DELETE — superseded by section 5 of new script |
| `scripts/chrome-unlock.ps1` | KEEP — useful for emergency unlock of a single kiosk |
| `scripts/lock-profile.ps1` | DELETE — folded into new script's section 5 |
| `scripts/nightly-cleanup.ps1` | DELETE — task is registered by new script directly |
| `scripts/set-abc-url.ps1` | KEEP — stays as the standalone admin tool |
| `scripts/README.md` | REWRITE — document the single script + 4 modes |
| `branding/wallpaper.jpg` | NEW — Justin to commit |
| `branding/lockscreen.jpg` | NEW — Justin to commit |

## Out of scope (v1)

- AppLocker / Software Restriction Policies (require Enterprise edition)
- Assigned Access kiosk mode (would block Sonos as a side effect)
- Custom URL blocklist of bad sites
- DNS-based content filtering (NextDNS / Cloudflare) — explicitly declined
- Per-attempt browsing logs / webhook alerts — explicitly declined
- Forced version pinning of the Portal app (auto-updater handles it)
- Per-location config files (`$LocationName` is hand-edited per kiosk)

## Implementation handoff

Once this spec is approved by Justin, move to the writing-plans skill
to break the script into ordered build steps. Plan should produce a
single PowerShell file that satisfies every section above, with
inline tests where reasonable (e.g., `Get-LocalUser`-based assertions
after the Users section).
