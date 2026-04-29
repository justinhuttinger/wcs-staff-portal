# WCS Action1 Deployment Scripts

## kiosk-state.ps1

Single consolidated script that enforces full kiosk state. Pushes via
Action1 to all WCS-Kiosk-tagged endpoints. Idempotent - safe to re-run.

### Modes

| Mode | What runs |
|---|---|
| `Full` (default) | Users -> Profile sweep -> App install -> Branding -> Chrome policies -> Staff lockdown -> Scheduled tasks |
| `Lockdown` | Chrome policies + Staff HKCU lockdown only |
| `Cleanup` | Profile sweep only (auto-deletes non-allowlisted users) |
| `Inventory` | Read-only state report (no changes) |

### Configuration

Edit `$LocationName` near the top of the file before pushing each
location's run from Action1. Everything else is stable across kiosks.

### Action1 deployment

1. Action1 -> Scripts -> New Script
2. Paste full contents of `kiosk-state.ps1`
3. Optionally append `-Mode Lockdown` (or other mode) to the
   PowerShell command line if you want a partial run.
4. Run as: SYSTEM
5. Target: machines tagged `WCS-Kiosk`
6. Logs land in `C:\WCS\setup.log` on each kiosk; Action1 console
   captures stdout for the run.

### Bitdefender installer staging

The Bitdefender GravityZone installer contains an org-specific install
token and is **not** committed to this public repo. Stage it on each
kiosk via Action1 Software Repository before running `kiosk-state.ps1`:

1. Action1 -> Software Repository -> upload `bitdefender-setup.exe`
2. Deploy that package to the `WCS-Kiosk` group with target path
   `C:\WCS\installers\bitdefender-setup.exe`
3. Then run `kiosk-state.ps1` - it will pick up the staged installer

If the installer is missing the script logs a `WARN` and skips the
Bitdefender step (no error, all other sections still run).

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

Emergency single-kiosk unlock - removes Chrome HKLM policies +
unregisters the WCS scheduled tasks + clears `C:\WCS\`. Does not
delete users.

## set-abc-url.ps1

Standalone helper - opens a dialog asking for the ABC Financial URL
and writes it to `C:\WCS\abc-url.txt`. Triggered from the Admin
desktop shortcut that `kiosk-state.ps1` sets up.

## setup-kiosk.ps1.archive

Predecessor to `kiosk-state.ps1`. Kept for historical reference only -
**do not push via Action1.**
