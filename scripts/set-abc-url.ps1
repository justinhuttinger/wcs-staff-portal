<#
.SYNOPSIS
    Set the ABC Financial URL for this machine
.DESCRIPTION
    Run this from the Admin profile to set the ABC URL.
    The Staff logon script reads this file and includes it in the portal.
.EXAMPLE
    .\set-abc-url.ps1 "https://abc-financial.com/location/12345"
#>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$URL
)

$wcsDir = 'C:\WCS'
if (-not (Test-Path $wcsDir)) {
    New-Item -Path $wcsDir -ItemType Directory -Force | Out-Null
}

Set-Content -Path "$wcsDir\abc-url.txt" -Value $URL -Force
Write-Host "ABC URL saved: $URL"
Write-Host "This will take effect next time Staff logs in."
