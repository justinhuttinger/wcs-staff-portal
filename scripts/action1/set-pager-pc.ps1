<#
  set-pager-pc.ps1 - Action1 "Run Script" (SYSTEM): make this PC a call button
  pager PC that doesn't run ABC. WCS ABC then opens with no ABC window, just a
  tray icon (right-click -> Call button settings); it starts at sign-in and
  comes back on its own within 5 minutes if it stops.

  Order on a new pager PC:
    1. install-wcs-abc.ps1 (installs WCS ABC + its updater task)
    2. set-wcs-club.ps1 (the club)
    3. action1-install-call-button-driver.ps1 (dongle driver)
    4. this script
  Then, on the PC (or over Action1 remote desktop): tray icon -> Call button
  settings -> phone base address + password, handsets, Pair a button.

  The PC must stay signed in to Windows (or sign in automatically) for the
  pager to run.

  To turn it back into a normal WCS ABC PC: set $PagerOnly = $false and run
  again.

  $SettingsPassword: asked before the tray's Call button settings and Quit.
  Only a salted PBKDF2-SHA256 hash is stored (config.json `pager_lock`).
  Leave it '' to keep the current password; set it to 'NONE' to remove it.
  Clear it from the script in Action1 after running, so it isn't saved there.
#>
$PagerOnly = $true
$SettingsPassword = ''

$ErrorActionPreference = 'Stop'
$path = 'C:\WCS\config.json'
$exe = Join-Path $env:ProgramFiles 'WCS ABC\WCS ABC.exe'

if (-not (Test-Path $exe)) {
  Write-Output "WCS ABC is not installed ($exe). Run install-wcs-abc.ps1 first."
  exit 1
}

New-Item -ItemType Directory -Force -Path 'C:\WCS' | Out-Null
$cfg = [ordered]@{}
if (Test-Path $path) {
  try {
    $old = Get-Content $path -Raw | ConvertFrom-Json
    foreach ($p in $old.PSObject.Properties) { $cfg[$p.Name] = $p.Value }  # keep install_id, pager settings etc.
  } catch { Write-Output 'existing config.json unreadable - replacing it' }
}
if (-not $cfg.Contains('location')) { Write-Output 'Warning: no club set yet. Run set-wcs-club.ps1 too.' }
$cfg['pager_only'] = $PagerOnly
if ($SettingsPassword -ceq 'NONE') {
  $cfg.Remove('pager_lock')
  Write-Output 'settings password removed'
} elseif ($SettingsPassword) {
  # Must match src/pager-lock.js verify(). This Rfc2898DeriveBytes overload
  # (SHA-256) needs .NET 4.7.2+, which every Windows 10/11 PC has.
  $salt = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
  $iterations = 100000
  $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($SettingsPassword, $salt, $iterations, [Security.Cryptography.HashAlgorithmName]::SHA256)
  $cfg['pager_lock'] = [ordered]@{
    salt = [Convert]::ToBase64String($salt)
    iterations = $iterations
    hash = [Convert]::ToBase64String($kdf.GetBytes(32))
  }
  Write-Output 'settings password set'
}
# Depth: keeps the nested `pager` settings (handsets list, button names) intact.
[IO.File]::WriteAllText($path, ($cfg | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
Write-Output "pager_only = $PagerOnly"

# The mode is read at startup: restart the app in the signed-in session.
# SYSTEM can't open a window there; the "WCS ABC Launch" task (Users group,
# registered by install-wcs-abc.ps1) can.
Get-Process -Name 'WCS ABC' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
try {
  Start-ScheduledTask -TaskPath '\WCS\' -TaskName 'WCS ABC Launch'
  Write-Output 'WCS ABC started in the signed-in session'
} catch {
  Write-Output ('Could not start WCS ABC (' + $_.Exception.Message + '). It starts at the next sign-in, or open it from the desktop shortcut.')
}
