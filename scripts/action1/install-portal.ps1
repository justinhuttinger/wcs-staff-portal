<#
  install-portal.ps1 - install/update the WCS desktop apps silently, as SYSTEM.

  One script, three callers:

    1. Action1 "Run Script" (one-time, all Portal endpoints). Runs as SYSTEM,
       so the per-machine NSIS installer runs with /S and NO UAC prompt.
       Updates the app from R2, then installs this script at a stable,
       locked-down path and registers the scheduled tasks below.
    2. The "WCS Portal Updater" / "WCS ABC Updater" scheduled task (SYSTEM,
       daily 03:00 + at startup + on demand) runs the stable copy, which
       gives silent updates from then on without Action1.
    3. The NSIS installer (installer.nsh customInstall) runs the copy bundled
       in resources\updater with -RegisterOnly, so a machine installed by
       hand, or updated by the old in-app updater, also gets the tasks.

  Flow: read <feed>/latest.yml (abc.yml for WCS ABC), compare with the
  installed version (HKLM uninstall key, else the exe's file version), skip
  if current, download to a SYSTEM-only folder, verify the SHA-512 from the
  feed, close the app (graceful, then forced after a timeout), run the
  installer /S, relaunch the app in the logged-in session if it was running.

  Params:
    -Flavor portal|abc   which app (default portal)
    -InstallIfMissing    fresh-install when the app isn't installed. Note a
                         silent install skips the kiosk location page, so
                         C:\WCS\config.json is not written.
    -NoTask              update only; don't install/refresh the scheduled tasks
    -RegisterOnly        install the tasks and exit (used by the installer)
    -InstallDir <dir>    with -RegisterOnly: detect the flavor from
                         <dir>\resources\app-update.yml

  Exit codes (Action1 treats non-zero as failed):
    0  up to date / updated / nothing to do
    1  error (details in C:\WCS\updater.log)

  Log: C:\WCS\updater.log
#>

param(
  [ValidateSet('portal', 'abc')] [string] $Flavor = 'portal',
  [switch] $InstallIfMissing,
  [switch] $NoTask,
  [switch] $RegisterOnly,
  [string] $InstallDir = ''
)

$ErrorActionPreference = 'Stop'

# Captured at script scope ($MyInvocation changes inside functions): used to
# copy this script to the stable path when Action1 runs it from a temp file.
$SelfPath = $PSCommandPath
$SelfText = $MyInvocation.MyCommand.Definition

$BaseUrl = 'https://downloads.westcoaststrength.com'
$StableDir = Join-Path $env:ProgramData 'WCS\updater'
$StableScript = Join-Path $StableDir 'install-portal.ps1'
$DownloadDir = Join-Path $StableDir 'downloads'
$LogFile = 'C:\WCS\updater.log'
$TaskFolder = '\WCS\'
$CloseTimeoutSec = 30

$Flavors = @{
  portal = @{ Product = 'Portal';  Exe = 'Portal.exe';  Feed = 'latest.yml'; Task = 'WCS Portal' }
  abc    = @{ Product = 'WCS ABC'; Exe = 'WCS ABC.exe'; Feed = 'abc.yml';    Task = 'WCS ABC' }
}

function Log([string] $msg) {
  $line = '{0} [updater:{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Flavor, $msg
  Write-Output $line
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
    Add-Content -Path $LogFile -Value $line
  } catch {}
}

function Get-YamlValue([string] $yaml, [string] $key) {
  $m = [regex]::Match($yaml, "(?m)^$([regex]::Escape($key)):\s*['""]?([^'""\r\n]+?)['""]?\s*$")
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

function Compare-Version([string] $a, [string] $b) {
  $pa = @(($a -split '[.-]') + '0', '0', '0')[0..2] | ForEach-Object { [int]('0' + ($_ -replace '\D', '')) }
  $pb = @(($b -split '[.-]') + '0', '0', '0')[0..2] | ForEach-Object { [int]('0' + ($_ -replace '\D', '')) }
  for ($i = 0; $i -lt 3; $i++) {
    if ($pa[$i] -gt $pb[$i]) { return 1 }
    if ($pa[$i] -lt $pb[$i]) { return -1 }
  }
  return 0
}

# electron-builder writes DisplayName "<Product> <version>", DisplayVersion
# and UninstallString under the machine uninstall key. Fall back to the default Program Files path.
function Get-Installed($f) {
  $roots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  $pattern = '^' + [regex]::Escape($f.Product) + '( \d+\.\d+\.\d+.*)?$'
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($k in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
      # No InstallLocation here; UninstallString is '"<dir>\Uninstall <Product>.exe" /allusers'.
      if ($p.DisplayName -and $p.DisplayName -match $pattern -and $p.UninstallString -match '^"([^"]+)"') {
        $dir = Split-Path $Matches[1]
        $exe = Join-Path $dir $f.Exe
        if (Test-Path $exe) {
          $ver = if ($p.DisplayVersion) { $p.DisplayVersion } else { (Get-Item $exe).VersionInfo.ProductVersion }
          return @{ Dir = $dir; Exe = $exe; Version = $ver }
        }
      }
    }
  }
  $dir = Join-Path $env:ProgramFiles $f.Product
  $exe = Join-Path $dir $f.Exe
  if (Test-Path $exe) { return @{ Dir = $dir; Exe = $exe; Version = (Get-Item $exe).VersionInfo.ProductVersion } }
  return $null
}

# SYSTEM + Administrators full control, Users read/execute, no inheritance,
# owned by Administrators. The updater task runs this folder's script and
# installers as SYSTEM, so a standard user must not be able to write here
# (or pre-create files here to own them).
function Protect-StableDir {
  New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
  & icacls.exe $StableDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' /Q | Out-Null
  & icacls.exe $StableDir /setowner '*S-1-5-32-544' /T /C /Q | Out-Null
  # Children: drop any explicit ACEs and inherit the locked-down parent.
  Invoke-Quiet icacls.exe @("$StableDir\*", '/reset', '/T', '/C', '/Q')
}

function Install-Tasks($f) {
  Protect-StableDir

  # Copy this script to the stable path (skip if we ARE the stable copy).
  $selfFull = if ($SelfPath) { [IO.Path]::GetFullPath($SelfPath) } else { '' }
  if ($selfFull -ne [IO.Path]::GetFullPath($StableScript)) {
    if ($SelfPath -and (Test-Path $SelfPath)) { Copy-Item -Path $SelfPath -Destination $StableScript -Force }
    elseif ($SelfText) { Set-Content -Path $StableScript -Value $SelfText -Encoding UTF8 }
    else { throw 'cannot locate this script to install it' }
  }

  $updaterName = "$($f.Task) Updater"
  $launchName = "$($f.Task) Launch"
  $taskArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Flavor {1} -NoTask' -f $StableScript, $Flavor

  # Leave an identical task alone: the installer calls -RegisterOnly while
  # the updater task may be the one running it.
  $existing = Get-ScheduledTask -TaskPath $TaskFolder -TaskName $updaterName -ErrorAction SilentlyContinue
  if (-not $existing -or $existing.Actions[0].Arguments -ne $taskArgs) {
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $taskArgs
    $triggers = @(
      (New-ScheduledTaskTrigger -Daily -At '03:00'),
      (New-ScheduledTaskTrigger -AtStartup)
    )
    $triggers[1].Delay = 'PT5M' # let the network come up after boot
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    $principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskPath $TaskFolder -TaskName $updaterName -Action $action -Trigger $triggers `
      -Settings $settings -Principal $principal -Force `
      -Description "Silently installs new $($f.Product) builds from $BaseUrl. See $StableScript." | Out-Null
    Log "registered task $TaskFolder$updaterName"
  }

  # Let signed-in (non-admin) users START the updater on demand, so the app
  # can trigger an update check with `schtasks /Run`. Read+execute only: they
  # can't change what it runs, and it takes no user input.
  try {
    $svc = New-Object -ComObject 'Schedule.Service'
    $svc.Connect()
    $task = $svc.GetFolder($TaskFolder.TrimEnd('\')).GetTask($updaterName)
    $task.SetSecurityDescriptor('D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;AU)', 0)
  } catch { Log ('could not open the updater task to users (on-demand runs disabled): ' + $_.Exception.Message) }

  # SYSTEM can't open a window on the user's desktop. A task whose principal
  # is the Users group runs in the logged-in session instead.
  if (-not (Get-ScheduledTask -TaskPath $TaskFolder -TaskName $launchName -ErrorAction SilentlyContinue)) {
    $inst = Get-Installed $f
    $exe = if ($inst) { $inst.Exe } else { Join-Path (Join-Path $env:ProgramFiles $f.Product) $f.Exe }
    Register-ScheduledTask -TaskPath $TaskFolder -TaskName $launchName `
      -Action (New-ScheduledTaskAction -Execute $exe) `
      -Principal (New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited) `
      -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0) `
      -Description "Relaunches $($f.Product) in the user session after a silent update." | Out-Null
    Log "registered task $TaskFolder$launchName"
  }
}

function Remove-Tasks($f) {
  foreach ($n in @("$($f.Task) Updater", "$($f.Task) Launch")) {
    if (Get-ScheduledTask -TaskPath $TaskFolder -TaskName $n -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskPath $TaskFolder -TaskName $n -Confirm:$false
      Log "removed task $TaskFolder$n"
    }
  }
}

# Run a native tool, ignoring its stderr/exit code. Windows PowerShell 5.1
# (what Action1 runs) turns native stderr into a terminating error under
# $ErrorActionPreference = 'Stop', so e.g. the expected "could not be
# terminated" from a graceful taskkill in session 0 would abort the script
# before the forced fallback.
function Invoke-Quiet {
  param([string] $Exe, [string[]] $Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Exe @Arguments 2>&1 | Out-Null } catch {} finally { $ErrorActionPreference = $prev }
}

function Stop-App($f) {
  $name = [IO.Path]::GetFileNameWithoutExtension($f.Exe)
  if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) { return $false }
  Log "closing $($f.Exe)"
  # Graceful first (WM_CLOSE). From session 0 this often can't reach the
  # user's desktop, hence the forced fallback.
  Invoke-Quiet taskkill.exe @('/IM', $f.Exe)
  $deadline = (Get-Date).AddSeconds($CloseTimeoutSec)
  while ((Get-Process -Name $name -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (Get-Process -Name $name -ErrorAction SilentlyContinue) {
    Log 'still running after timeout - forcing'
    Invoke-Quiet taskkill.exe @('/F', '/T', '/IM', $f.Exe)
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    if (Get-Process -Name $name -ErrorAction SilentlyContinue) { throw "could not close $($f.Exe)" }
  }
  return $true
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar

  if ($RegisterOnly -and $InstallDir) {
    $cfgPath = Join-Path $InstallDir 'resources\app-update.yml'
    if (Test-Path $cfgPath) {
      $url = Get-YamlValue (Get-Content $cfgPath -Raw) 'url'
      if ($url) {
        $seg = ($url.TrimEnd('/') -split '/')[-1]
        if ($Flavors.ContainsKey($seg)) { $Flavor = $seg }
      }
    }
  }
  $f = $Flavors[$Flavor]

  if ($RegisterOnly) { Install-Tasks $f; exit 0 }

  $installed = Get-Installed $f
  if (-not $installed -and -not $InstallIfMissing) {
    Log "$($f.Product) is not installed - nothing to do"
    # Uninstalled: the updater tasks clean themselves up.
    Remove-Tasks $f
    exit 0
  }

  $feedUrl = "$BaseUrl/$Flavor"
  $raw = (Invoke-WebRequest -UseBasicParsing -Uri "$feedUrl/$($f.Feed)" -Headers @{ 'Cache-Control' = 'no-cache' }).Content
  $yml = if ($raw -is [byte[]]) { [Text.Encoding]::UTF8.GetString($raw) } else { [string]$raw }
  $latest = Get-YamlValue $yml 'version'
  $file = Get-YamlValue $yml 'path'
  $sha512 = Get-YamlValue $yml 'sha512'
  if (-not $latest -or -not $file -or -not $sha512) { throw "$($f.Feed) is missing version/path/sha512" }
  if ($file -match '[\\/]|\.\.') { throw "unexpected installer path in feed: $file" }

  $current = if ($installed) { $installed.Version } else { 'none' }
  if ($installed -and (Compare-Version $latest $current) -le 0) {
    Log "up to date ($current, feed $latest)"
    if (-not $NoTask) { Install-Tasks $f }
    exit 0
  }
  Log "installing $latest (installed: $current)"

  Protect-StableDir
  $installer = Join-Path $DownloadDir $file
  Invoke-WebRequest -UseBasicParsing -Uri ("$feedUrl/" + [uri]::EscapeDataString($file)) -OutFile $installer

  # The feed's sha512 is base64 of the installer's SHA-512.
  $hasher = [Security.Cryptography.SHA512]::Create()
  $stream = [IO.File]::OpenRead($installer)
  try { $actual = [Convert]::ToBase64String($hasher.ComputeHash($stream)) } finally { $stream.Dispose() }
  if ($actual -ne $sha512) {
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
    throw 'SHA-512 mismatch - refusing to install'
  }

  $wasRunning = Stop-App $f

  # /S = silent. --updated makes electron-builder's NSIS script treat it as
  # an update (keeps shortcuts, skips the kiosk location page).
  $argList = @('/S')
  if ($installed) { $argList += '--updated' }
  $p = Start-Process -FilePath $installer -ArgumentList $argList -Wait -PassThru
  Remove-Item $installer -Force -ErrorAction SilentlyContinue
  if ($p.ExitCode -ne 0) { throw "installer exited with $($p.ExitCode)" }

  $after = Get-Installed $f
  $afterVersion = if ($after) { $after.Version } else { 'unknown' }
  Log "installed; version now $afterVersion"

  if (-not $NoTask) { Install-Tasks $f }

  if ($wasRunning) {
    try {
      Start-ScheduledTask -TaskPath $TaskFolder -TaskName "$($f.Task) Launch"
      Log 'relaunched in the user session'
    } catch { Log ('relaunch failed: ' + $_.Exception.Message) }
  }
  exit 0
} catch {
  Log ('error: ' + $_.Exception.Message)
  exit 1
}
