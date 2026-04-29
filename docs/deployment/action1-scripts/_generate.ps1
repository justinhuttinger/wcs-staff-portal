<#
.SYNOPSIS
    Regenerate the 10 Action1 paste-ready scripts from the canonical
    scripts/kiosk-state.ps1.
.DESCRIPTION
    Produces:
      - 7 per-location Full-mode scripts (Salem, Keizer, Eugene, ...)
      - 3 mode-only utility scripts (Inventory, Lockdown, Cleanup)
    Run this whenever scripts/kiosk-state.ps1 changes so the paste
    files in docs/deployment/action1-scripts/ stay in sync.
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

$locations = @('Salem','Keizer','Eugene','Springfield','Clackamas','Milwaukie','Medford')
$modes     = @('Inventory','Lockdown','Cleanup')

$src = Get-Content $source -Raw

# Pattern A: replace $LocationName = 'Salem' with the target location
function Set-LocationName {
    param([string]$Content, [string]$Loc)
    # Single-quoted pattern so $LocationName stays literal
    return $Content -replace '(?m)^\$LocationName\s*=\s*''[^'']*''', "`$LocationName    = '$Loc'"
}

# Pattern B: replace the entire param() block with a single $Mode line
function Set-HardcodedMode {
    param([string]$Content, [string]$Mode)
    # Single-quoted so $Mode in the pattern stays literal
    $paramBlock = 'param\(\s*\[ValidateSet\(''Full'',''Lockdown'',''Cleanup'',''Inventory''\)\]\s*\[string\]\$Mode\s*=\s*''Full''\s*\)'
    return $Content -replace $paramBlock, "`$Mode = '$Mode'"
}

# 7 per-location Full-mode scripts
foreach ($loc in $locations) {
    $body = Set-LocationName -Content $src -Loc $loc
    $out  = Join-Path $outDir ("WCS-Kiosk-State-{0}.ps1" -f $loc)
    Set-Content -Path $out -Value $body -Encoding UTF8 -Force
    Write-Host "  wrote $out"
}

# 3 mode-only utility scripts (location-agnostic; LocationName left as Salem default)
foreach ($mode in $modes) {
    $body = Set-HardcodedMode -Content $src -Mode $mode
    $out  = Join-Path $outDir ("WCS-Kiosk-State-{0}.ps1" -f $mode)
    Set-Content -Path $out -Value $body -Encoding UTF8 -Force
    Write-Host "  wrote $out"
}

Write-Host ""
Write-Host "Generated $($locations.Count + $modes.Count) files in $outDir"
