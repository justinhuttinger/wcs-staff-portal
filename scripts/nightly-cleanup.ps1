#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Nightly Chrome Profile Cleanup
.DESCRIPTION
    Removes Chrome user profiles created outside the Default/kiosk profile.
    Schedule in Action1 as a recurring task at 2:00 AM across all 'WCS-Kiosk' machines.
    Safe to run even if no extra profiles exist.
#>

$ErrorActionPreference = 'Stop'

$profileRoot = 'C:\Users\Staff\AppData\Local\Google\Chrome\User Data'

if (-not (Test-Path $profileRoot)) {
    Write-Host "Chrome user data directory not found at $profileRoot — skipping cleanup."
    exit 0
}

# Profiles to preserve (Chrome system profiles + kiosk default)
$preservePattern = '^(Default|System Profile|Guest Profile|Crashpad|Safe Browsing|ShaderCache|GrShaderCache|BrowserMetrics|Crowd Deny|MEIPreload|SSLErrorAssistant|CertificateRevocation|FileTypePolicies|OriginTrials|ZxcvbnData|hyphen-data|WidevineCdm)$'

$removed = 0
Get-ChildItem -Path $profileRoot -Directory |
    Where-Object { $_.Name -notmatch $preservePattern } |
    Where-Object { $_.Name -match '^Profile' } |
    ForEach-Object {
        Write-Host "Removing profile: $($_.Name)"
        Remove-Item -Path $_.FullName -Recurse -Force
        $removed++
    }

if ($removed -eq 0) {
    Write-Host "No extra Chrome profiles found. Nothing to clean."
} else {
    Write-Host "Removed $removed Chrome profile(s)."
}
