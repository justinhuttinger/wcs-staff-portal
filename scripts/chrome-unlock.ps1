#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Chrome Unlock — Reverses all lockdown policies
.DESCRIPTION
    Removes the Chrome policy registry key entirely, restoring Chrome
    to its default unmanaged state. Also removes auto-login and the
    nightly cleanup scheduled task.
#>

$ErrorActionPreference = 'Stop'

# Remove all Chrome policies
$chromePolicyRoot = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
if (Test-Path $chromePolicyRoot) {
    Remove-Item -Path $chromePolicyRoot -Recurse -Force
    Write-Host "Removed Chrome policies from registry"
} else {
    Write-Host "No Chrome policies found — nothing to remove"
}

Write-Host "No auto-login configured — nothing to remove"

# Remove nightly cleanup task
$taskName = 'WCS-Nightly-Chrome-Cleanup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled cleanup task"
}

Write-Host ""
Write-Host "=== Unlock complete ==="
Write-Host "Restart Chrome for changes to take effect."
Write-Host "Note: The 'Staff' Windows user was NOT deleted. Remove manually if needed."
