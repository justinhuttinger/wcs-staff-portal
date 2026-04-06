#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Chrome Unlock — Reverses all lockdown policies
.DESCRIPTION
    Removes Chrome policies from both HKLM and Staff's HKCU,
    restoring Chrome to default unmanaged state.
#>

$ErrorActionPreference = 'Stop'

# Remove machine-wide Chrome policies (if any)
$hklmChrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
if (Test-Path $hklmChrome) {
    Remove-Item -Path $hklmChrome -Recurse -Force
    Write-Host "Removed HKLM Chrome policies"
}

# Remove Staff user Chrome policies
$staffNtuser = 'C:\Users\Staff\NTUSER.DAT'
if (Test-Path $staffNtuser) {
    $hivePath = 'HKU\StaffProfile'
    reg load $hivePath $staffNtuser 2>$null
    $staffChrome = "Registry::$hivePath\SOFTWARE\Policies\Google\Chrome"
    if (Test-Path $staffChrome) {
        Remove-Item -Path $staffChrome -Recurse -Force
        Write-Host "Removed Staff HKCU Chrome policies"
    }
    [gc]::Collect()
    Start-Sleep -Seconds 1
    reg unload $hivePath 2>$null
} else {
    Write-Host "No Staff profile found"
}

# Remove nightly cleanup task
$taskName = 'WCS-Nightly-Chrome-Cleanup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled cleanup task"
}

Write-Host ""
Write-Host "=== Unlock complete ==="
Write-Host "Restart Chrome for changes to take effect."
Write-Host "Note: Staff and Admin Windows users were NOT deleted. Remove manually if needed."
