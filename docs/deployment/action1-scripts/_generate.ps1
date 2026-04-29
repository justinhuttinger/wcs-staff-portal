<#
.SYNOPSIS
    Regenerate the 4 Action1 paste-ready scripts from the canonical
    scripts/kiosk-state.ps1.
.DESCRIPTION
    Produces:
      - 1 Full-mode script (location-agnostic; same body as canonical)
      - 3 mode-only utility scripts (Inventory, Lockdown, Cleanup)
        which replace the param() block with a hardcoded $Mode.
    Run this whenever scripts/kiosk-state.ps1 changes so the paste
    files stay in sync.
.NOTES
    Run from the repo root or anywhere - paths are computed from
    this script's own location.
#>

$ErrorActionPreference = 'Stop'
$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $here '..\..\..')
$source   = Join-Path $repoRoot 'scripts\kiosk-state.ps1'
$outDir   = $here

if (-not (Test-Path $source)) {
    throw "Source script not found: $source"
}

$modes = @('Inventory','Lockdown','Cleanup')
$src   = Get-Content $source -Raw

# Replace the entire param() block with a single $Mode line
function Set-HardcodedMode {
    param([string]$Content, [string]$Mode)
    $paramBlock = 'param\(\s*\[ValidateSet\(''Full'',''Lockdown'',''Cleanup'',''Inventory''\)\]\s*\[string\]\$Mode\s*=\s*''Full''\s*\)'
    return $Content -replace $paramBlock, "`$Mode = '$Mode'"
}

# 1 Full-mode script (canonical, no edits needed)
$fullOut = Join-Path $outDir 'WCS-Kiosk-State-Full.ps1'
Set-Content -Path $fullOut -Value $src -Encoding UTF8 -Force
Write-Host "  wrote $fullOut"

# 3 mode-only utility scripts
foreach ($mode in $modes) {
    $body = Set-HardcodedMode -Content $src -Mode $mode
    $out  = Join-Path $outDir ("WCS-Kiosk-State-{0}.ps1" -f $mode)
    Set-Content -Path $out -Value $body -Encoding UTF8 -Force
    Write-Host "  wrote $out"
}

# Clean up any stale per-location files from the old 10-script layout
$staleLocations = @('Salem','Keizer','Eugene','Springfield','Clackamas','Milwaukie','Medford')
foreach ($loc in $staleLocations) {
    $stale = Join-Path $outDir ("WCS-Kiosk-State-{0}.ps1" -f $loc)
    if (Test-Path $stale) {
        Remove-Item $stale -Force
        Write-Host "  removed stale $stale"
    }
}

Write-Host ""
Write-Host "Generated 4 files in $outDir"
