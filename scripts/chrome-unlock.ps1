#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Chrome Unlock — Reverses all kiosk setup
.DESCRIPTION
    Removes Chrome policies, logon scripts, scheduled tasks.
    Does NOT delete Windows user accounts.
#>

$ErrorActionPreference = 'SilentlyContinue'

# Remove machine-wide Chrome policies
$hklmChrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
if (Test-Path $hklmChrome) {
    Remove-Item -Path $hklmChrome -Recurse -Force
    Write-Host "Removed HKLM Chrome policies"
}

# Remove logon scheduled task
Unregister-ScheduledTask -TaskName 'WCS-Staff-Logon' -Confirm:$false
Write-Host "Removed Staff logon task"

# Remove nightly cleanup task
Unregister-ScheduledTask -TaskName 'WCS-Nightly-Chrome-Cleanup' -Confirm:$false
Write-Host "Removed nightly cleanup task"

# Remove logon script
if (Test-Path 'C:\WCS') {
    Remove-Item -Path 'C:\WCS' -Recurse -Force
    Write-Host "Removed C:\WCS scripts"
}

# Note: Staff's HKCU policies will be cleared next time they log in
# if the logon script is gone. Or clear manually:
Write-Host ""
Write-Host "=== Unlock complete ==="
Write-Host "To fully clear Staff's Chrome policies, log in as Staff and run:"
Write-Host '  Remove-Item -Path "HKCU:\SOFTWARE\Policies\Google\Chrome" -Recurse -Force'
Write-Host ""
Write-Host "Windows users (Staff, Admin) were NOT deleted."
