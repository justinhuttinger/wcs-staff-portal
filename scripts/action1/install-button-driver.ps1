<#
  install-button-driver.ps1 - install the USB driver for the WCS ABC call
  button receiver (SONOFF Zigbee Dongle-P), silently, as SYSTEM.

  The dongle's USB bridge is a Silicon Labs CP2102N (VID 10C4 / PID EA60,
  see launcher/src/zigbee-worker.js). Windows often picks the driver up from
  Windows Update, but not always; without it the dongle never shows up as a
  COM port and WCS ABC reports "dongle_missing".

  Flow: skip if the Silicon Labs driver is already in the driver store
  (unless -Force), get the official CP210x Universal Windows Driver zip,
  extract it, add + install it with pnputil, then rescan so a plugged-in
  dongle binds right away.

  Where the zip comes from, first that works:
    1. -DriverZip <path>, or CP210x_Universal_Windows_Driver.zip next to
       this script or in C:\WCS
    2. our mirror: downloads.westcoaststrength.com/kiosk/ (upload once, see
       below). silabs.com sits behind Akamai, which 403s scripted downloads.
    3. silabs.com directly, with a browser User-Agent (often still 403)

  One-time mirror upload: download the zip in a browser from
  https://www.silabs.com/documents/public/software/CP210x_Universal_Windows_Driver.zip
  then:
    npx wrangler r2 object put wcs-launcher-downloads/kiosk/CP210x_Universal_Windows_Driver.zip --file CP210x_Universal_Windows_Driver.zip --remote

  Run via Action1 "Run Script" as Local System, or by hand from an admin
  PowerShell:
    powershell -ExecutionPolicy Bypass -File install-button-driver.ps1

  Params:
    -Force            reinstall even if the driver is already present
    -DriverZip <path> use this local driver zip instead of downloading

  Exit codes (Action1 treats non-zero as failed):
    0  driver present / installed
    1  error (details in C:\WCS\button-driver.log)
#>

param(
  [switch] $Force,
  [string] $DriverZip = ''
)

$ErrorActionPreference = 'Stop'

$ZipName = 'CP210x_Universal_Windows_Driver.zip'
$DriverUrls = @(
  "https://downloads.westcoaststrength.com/kiosk/$ZipName",
  "https://www.silabs.com/documents/public/software/$ZipName"
)
$BrowserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
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

  # $PSScriptRoot is empty when Action1 runs the body without a file.
  $here = if ($PSScriptRoot) { Join-Path $PSScriptRoot $ZipName } else { '' }
  $local = @($DriverZip, $here, (Join-Path 'C:\WCS' $ZipName)) |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($local) {
    Log "Using local driver zip $local"
    Copy-Item $local $zip
  } else {
    $ProgressPreference = 'SilentlyContinue'
    foreach ($url in $DriverUrls) {
      try {
        Log "Downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -UserAgent $BrowserUA
        break
      } catch {
        Log "  failed: $($_.Exception.Message)"
        Remove-Item $zip -ErrorAction SilentlyContinue
      }
    }
    if (-not (Test-Path $zip)) {
      throw "Could not download the driver. Upload $ZipName to the kiosk/ mirror (see script header) or copy it to C:\WCS."
    }
  }

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
