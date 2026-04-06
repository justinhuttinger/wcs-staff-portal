#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Lock Chrome profile — run AFTER first-time setup
.DESCRIPTION
    Run this after you've:
    1. Signed into Chrome with the kiosk Google account
    2. Installed the required Chrome extension
    3. Verified everything works

    This blocks creating new Chrome profiles, locking users into
    the pre-configured profile with the extension installed.

    Push via Action1 or run manually from Admin PowerShell.
#>

$chromePolicyRoot = 'HKLM:\SOFTWARE\Policies\Google\Chrome'

if (-not (Test-Path $chromePolicyRoot)) {
    Write-Host "ERROR: Chrome policies not found. Run setup-kiosk.ps1 first."
    exit 1
}

Set-ItemProperty -Path $chromePolicyRoot -Name 'BrowserAddPersonEnabled' -Value 0 -Type DWord
Write-Host "Chrome profile picker is now LOCKED."
Write-Host "No new profiles can be created. Existing profile with extension is preserved."
