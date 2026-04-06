#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Lock Chrome profile picker — run AFTER first-time sign-in
.DESCRIPTION
    Push this via Action1 AFTER you have:
    1. Logged into Staff profile
    2. Signed into Chrome with the kiosk Google account
    3. Verified the extension is working

    This prevents anyone from creating new Chrome profiles.
#>

$chromePolicyRoot = 'HKLM:\SOFTWARE\Policies\Google\Chrome'

if (-not (Test-Path $chromePolicyRoot)) {
    Write-Host "ERROR: Chrome policies not found. Run setup-kiosk.ps1 first."
    exit 1
}

Set-ItemProperty -Path $chromePolicyRoot -Name 'BrowserAddPersonEnabled' -Value 0 -Type DWord
Write-Host "Chrome profile picker is now LOCKED."
Write-Host "No new profiles can be created."
