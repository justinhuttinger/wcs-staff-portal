<#
  install-button-driver.ps1 - install the USB driver for the WCS ABC call
  button receiver (SONOFF Zigbee Dongle-P), silently, as SYSTEM.

  The dongle's USB bridge is a Silicon Labs CP2102N (VID 10C4 / PID EA60,
  see launcher/src/zigbee-worker.js). Windows often picks the driver up from
  Windows Update, but not always; without it the dongle never shows up as a
  COM port and WCS ABC reports "dongle_missing".

  Flow: skip if the Silicon Labs driver is already in the driver store
  (unless -Force), download the official CP210x Universal Windows Driver
  from silabs.com, extract it, add + install it with pnputil, then rescan
  so a plugged-in dongle binds right away.

  Run via Action1 "Run Script" as Local System, or by hand from an admin
  PowerShell:
    powershell -ExecutionPolicy Bypass -File install-button-driver.ps1

  Params:
    -Force   reinstall even if the driver is already present

  Exit codes (Action1 treats non-zero as failed):
    0  driver present / installed
    1  error (details in C:\WCS\button-driver.log)
#>

param(
  [switch] $Force
)

$ErrorActionPreference = 'Stop'

$DriverUrl = 'https://www.silabs.com/documents/public/software/CP210x_Universal_Windows_Driver.zip'
$WorkDir = Join-Path $env:ProgramData 'WCS\button-driver'
$LogFile = 'C:\WCS\button-driver.log'
$DongleId = 'USB\VID_10C4&PID_EA60*'

function Log($msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Output $line
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
    Add-Content -Path $LogFile -Value $line
  } catch {}
}

function Test-DriverInstalled {
  $out = & pnputil.exe /enum-drivers 2>$null | Out-String
  return $out -match '(?i)silabser\.inf'
}

function Show-DongleStatus {
  $dev = Get-PnpDevice -InstanceId $DongleId -ErrorAction SilentlyContinue
  if (-not $dev) { Log 'Dongle not plugged in (driver will bind when it is).'; return }
  foreach ($d in $dev) { Log ("Dongle: {0} - status {1}" -f $d.FriendlyName, $d.Status) }
}

try {
  if (-not $Force -and (Test-DriverInstalled)) {
    Log 'Silicon Labs CP210x driver already installed.'
    Show-DongleStatus
    exit 0
  }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  $zip = Join-Path $WorkDir 'cp210x.zip'
  $extract = Join-Path $WorkDir 'driver'

  Log "Downloading $DriverUrl"
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $DriverUrl -OutFile $zip -UseBasicParsing

  Expand-Archive -Path $zip -DestinationPath $extract -Force
  $inf = Get-ChildItem -Path $extract -Recurse -Filter 'silabser.inf' | Select-Object -First 1
  if (-not $inf) { throw 'silabser.inf not found in the downloaded driver package.' }

  Log "Installing $($inf.FullName)"
  $out = & pnputil.exe /add-driver $inf.FullName /install 2>&1 | Out-String
  Log $out.Trim()
  # 0 = ok, 3010 = ok but reboot required, 259 = already up to date
  if ($LASTEXITCODE -notin 0, 259, 3010) { throw "pnputil failed with exit code $LASTEXITCODE" }
  if ($LASTEXITCODE -eq 3010) { Log 'Reboot required to finish installing the driver.' }

  & pnputil.exe /scan-devices | Out-Null
  Show-DongleStatus

  Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
  Log 'Done.'
  exit 0
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
