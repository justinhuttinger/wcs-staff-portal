#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Kiosk State Enforcement Script
.DESCRIPTION
    Single idempotent script that ensures every WCS front-desk PC has:
    - Correct local users (Staff, Admin)
    - Allowlisted profiles only (Staff, Admin, abctech if present)
    - Required apps installed (Portal, Chrome, Sonos, Bitdefender)
    - Branded wallpaper + lockscreen
    - Chrome hygiene policies (no allowlist; SafeSearch + no downloads)
    - Staff Windows lockdown (no Settings, no cmd, etc.)
    - Logon scripts + nightly Chrome cleanup
.PARAMETER Mode
    Full      - runs every section (default, used for new-machine bootstrap)
    Lockdown  - only sections 5 (Chrome) + 6 (Staff HKCU)
    Cleanup   - only section 2 (profile sweep)
    Inventory - read-only state report, no changes
.NOTES
    Run as SYSTEM via Action1, or manually as local Administrator.
    Idempotent - safe to re-run anytime.
#>

$Mode = 'Lockdown'

$ErrorActionPreference = 'Stop'

# ============================================================
# CONFIGURATION - edit $LocationName per kiosk, rest is stable
# ============================================================
$LocationName    = 'Salem'
$PortalBaseURL   = 'https://portal.wcstrength.com'
$RepoRawBase     = 'https://raw.githubusercontent.com/justinhuttinger/wcs-staff-portal/master'
$WallpaperUrl    = "$RepoRawBase/branding/wallpaper.jpg"
$LockscreenUrl   = "$RepoRawBase/branding/lockscreen.jpg"
$LauncherUrl     = 'https://github.com/justinhuttinger/wcs-staff-portal/releases/latest/download/Portal-Setup.exe'
$ChromeUrl       = 'https://dl.google.com/chrome/install/standalonesetup64.exe'
$SonosUrl        = 'https://www.sonos.com/redir/controller_software_pc2'
$AllowedUsers    = @('Staff','Admin','abctech')
$BuiltInUsers    = @('Administrator','DefaultAccount','Guest','WDAGUtilityAccount')
$StaffPassword   = 'staff'
$AdminPassword   = '!31JellybeaN31!'

$WcsDir          = 'C:\WCS'
$BrandingDir     = "$WcsDir\branding"
$InstallersDir   = "$WcsDir\installers"
$LogPath         = "$WcsDir\setup.log"

# Bitdefender GravityZone installer path - staged here by Action1's
# Software Repository deployment (see scripts/README.md). Contains
# org-specific install token; never committed to public git.
$BitdefenderInstaller = "$InstallersDir\bitdefender-setup.exe"

# ============================================================
# HELPERS
# ============================================================
function Initialize-WcsDir {
    if (-not (Test-Path $WcsDir))      { New-Item -Path $WcsDir       -ItemType Directory -Force | Out-Null }
    if (-not (Test-Path $BrandingDir)) { New-Item -Path $BrandingDir  -ItemType Directory -Force | Out-Null }
    if (-not (Test-Path $InstallersDir)){ New-Item -Path $InstallersDir -ItemType Directory -Force | Out-Null }
}

function Write-WcsLog {
    param(
        [Parameter(Mandatory=$true)][string]$Section,
        [Parameter(Mandatory=$true)][string]$Status,
        [Parameter(Mandatory=$true)][string]$Message
    )
    $ts   = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "$ts [$Section] $($Status.PadRight(6)) $Message"
    Add-Content -Path $LogPath -Value $line
    Write-Host $line
}

function Test-IsAdmin {
    $current = [Security.Principal.WindowsPrincipal]::new(
        [Security.Principal.WindowsIdentity]::GetCurrent())
    return $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ============================================================
# SECTION 1: USERS
# ============================================================
function Set-WcsUsers {
    $users = @(
        @{ Name='Staff'; Password=$StaffPassword; Group='Users';          FullName='WCS Staff'; Description='Kiosk account' }
        @{ Name='Admin'; Password=$AdminPassword; Group='Administrators'; FullName='WCS Admin'; Description='IT admin account' }
    )

    foreach ($u in $users) {
        $secure = ConvertTo-SecureString $u.Password -AsPlainText -Force
        $existing = Get-LocalUser -Name $u.Name -ErrorAction SilentlyContinue

        if (-not $existing) {
            New-LocalUser -Name $u.Name -Password $secure -FullName $u.FullName `
                          -Description $u.Description -PasswordNeverExpires | Out-Null
            Add-LocalGroupMember -Group $u.Group -Member $u.Name -ErrorAction SilentlyContinue
            Write-WcsLog 'Users' 'INST' "Created $($u.Name) in group $($u.Group)"
        } else {
            Set-LocalUser -Name $u.Name -Password $secure -PasswordNeverExpires $true
            $isMember = Get-LocalGroupMember -Group $u.Group -Member $u.Name -ErrorAction SilentlyContinue
            if (-not $isMember) {
                Add-LocalGroupMember -Group $u.Group -Member $u.Name
                Write-WcsLog 'Users' 'OK' "$($u.Name) re-added to $($u.Group)"
            } else {
                Write-WcsLog 'Users' 'OK' "$($u.Name) present, password reset"
            }
        }
    }
}

# ============================================================
# SECTION 2: PROFILE SWEEP - auto-delete non-allowlisted users
# ============================================================
function Invoke-WcsProfileSweep {
    $preserve = @($AllowedUsers + $BuiltInUsers)

    Get-LocalUser | ForEach-Object {
        $name = $_.Name
        if ($preserve -contains $name) {
            Write-WcsLog 'Sweep' 'OK' "Preserving $name"
            return
        }

        if ($name -ieq $env:USERNAME) {
            Write-WcsLog 'Sweep' 'WARN' "Skipping $name - currently logged in"
            return
        }

        try {
            Remove-LocalUser -Name $name -ErrorAction Stop
            Write-WcsLog 'Sweep' 'REMOVE' "Account: $name"
        } catch {
            Write-WcsLog 'Sweep' 'ERR' "Could not remove account $name`: $($_.Exception.Message)"
            return
        }

        $profilePath = "C:\Users\$name"
        if (Test-Path $profilePath) {
            try {
                Remove-Item -Path $profilePath -Recurse -Force -ErrorAction Stop
                Write-WcsLog 'Sweep' 'REMOVE' "Profile folder: $profilePath"
            } catch {
                Write-WcsLog 'Sweep' 'WARN' "Could not delete $profilePath`: $($_.Exception.Message)"
            }
        }
    }
}

# ============================================================
# SECTION 3: APP INSTALLATION (Portal, Chrome, Sonos)
# ============================================================
function Test-PortalInstalled {
    $keys = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($k in $keys) {
        $hit = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue |
               Where-Object { $_.DisplayName -match '^(Portal|WCS App)$' }
        if ($hit) { return $true }
    }
    return $false
}

function Test-ChromeInstalled {
    Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe'
}

function Test-SonosInstalled {
    $key = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    $hit = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue |
           Where-Object { $_.DisplayName -match 'Sonos' }
    return [bool]$hit
}

function Test-BitdefenderInstalled {
    $keys = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($k in $keys) {
        $hit = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue |
               Where-Object { $_.DisplayName -match 'Bitdefender' }
        if ($hit) { return $true }
    }
    return $false
}

function Install-FromUrl {
    param(
        [Parameter(Mandatory)][string]$Section,
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$LocalName,
        [Parameter(Mandatory)][string[]]$SilentArgs
    )
    $installer = Join-Path $env:TEMP $LocalName
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        Invoke-WebRequest -Uri $Url -OutFile $installer -UseBasicParsing
        Start-Process -FilePath $installer -ArgumentList $SilentArgs -Wait -ErrorAction Stop
        Write-WcsLog $Section 'INST' "Installed from $Url"
    } catch {
        Write-WcsLog $Section 'ERR' "Install failed: $($_.Exception.Message)"
    } finally {
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
    }
}

function Install-WcsApps {
    Get-Process -Name 'Portal','WCS App' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    if (Test-PortalInstalled) {
        Write-WcsLog 'Apps' 'SKIP' 'Portal already installed (auto-updater handles upgrades)'
    } else {
        Install-FromUrl -Section 'Apps' -Url $LauncherUrl `
                        -LocalName 'Portal-Setup.exe' -SilentArgs @('/S')
    }

    if (Test-ChromeInstalled) {
        Write-WcsLog 'Apps' 'SKIP' 'Chrome already installed'
    } else {
        Install-FromUrl -Section 'Apps' -Url $ChromeUrl `
                        -LocalName 'chrome-setup.exe' -SilentArgs @('/silent','/install')
    }

    if (Test-SonosInstalled) {
        Write-WcsLog 'Apps' 'SKIP' 'Sonos already installed'
    } else {
        Install-FromUrl -Section 'Apps' -Url $SonosUrl `
                        -LocalName 'Sonos-Setup.exe' -SilentArgs @('/S')
    }

    if (Test-BitdefenderInstalled) {
        Write-WcsLog 'Apps' 'SKIP' 'Bitdefender already installed'
    } elseif (Test-Path $BitdefenderInstaller) {
        try {
            Start-Process -FilePath $BitdefenderInstaller `
                          -ArgumentList @('/bdparams','/silent') `
                          -Wait -ErrorAction Stop
            Write-WcsLog 'Apps' 'INST' "Bitdefender installed from $BitdefenderInstaller"
        } catch {
            Write-WcsLog 'Apps' 'ERR' "Bitdefender install failed: $($_.Exception.Message)"
        }
    } else {
        Write-WcsLog 'Apps' 'WARN' "Bitdefender installer missing at $BitdefenderInstaller - stage via Action1 Software Repository"
    }
}

# ============================================================
# SECTION 4: BRANDING (wallpaper + lockscreen)
# ============================================================
function Get-RemoteSha256 {
    param([string]$Url)
    try {
        $tmp = New-TemporaryFile
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing -ErrorAction Stop
        $h = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash
        Remove-Item $tmp -Force
        return $h
    } catch {
        return $null
    }
}

function Sync-RemoteFile {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$LocalPath
    )
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $remoteHash = Get-RemoteSha256 -Url $Url
    if (-not $remoteHash) { return $false }

    if (Test-Path $LocalPath) {
        $localHash = (Get-FileHash -Path $LocalPath -Algorithm SHA256).Hash
        if ($localHash -eq $remoteHash) { return $true }
    }
    Invoke-WebRequest -Uri $Url -OutFile $LocalPath -UseBasicParsing
    return $true
}

function Set-WallpaperForUser {
    param([string]$User, [string]$ImagePath)

    $userProfile = "C:\Users\$User"
    $hive        = "$userProfile\NTUSER.DAT"
    if (-not (Test-Path $hive)) {
        Write-WcsLog 'Branding' 'WARN' "Hive not found for $User (user has not logged in yet)"
        return
    }

    $hiveKey = "WCS_$User"
    & reg.exe load "HKU\$hiveKey" $hive 2>&1 | Out-Null
    try {
        $polPath = "Registry::HKEY_USERS\$hiveKey\Software\Microsoft\Windows\CurrentVersion\Policies\System"
        if (-not (Test-Path $polPath)) { New-Item -Path $polPath -Force | Out-Null }
        Set-ItemProperty -Path $polPath -Name 'Wallpaper'            -Value $ImagePath -Type String
        Set-ItemProperty -Path $polPath -Name 'WallpaperStyle'       -Value '10'       -Type String
        Set-ItemProperty -Path $polPath -Name 'NoChangingWallpaper'  -Value 1          -Type DWord
        Write-WcsLog 'Branding' 'OK' "Wallpaper set for $User"
    } finally {
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        & reg.exe unload "HKU\$hiveKey" 2>&1 | Out-Null
    }
}

function Set-WcsBranding {
    $wallpaper  = "$BrandingDir\wallpaper.jpg"
    $lockscreen = "$BrandingDir\lockscreen.jpg"

    $wOk = Sync-RemoteFile -Url $WallpaperUrl  -LocalPath $wallpaper
    $lOk = Sync-RemoteFile -Url $LockscreenUrl -LocalPath $lockscreen

    if (-not $wOk -or -not $lOk) {
        Write-WcsLog 'Branding' 'WARN' "Branding images unavailable - skipping (commit branding/*.jpg to repo)"
        return
    }

    $lockPolPath = 'HKLM:\Software\Policies\Microsoft\Windows\Personalization'
    if (-not (Test-Path $lockPolPath)) { New-Item -Path $lockPolPath -Force | Out-Null }
    Set-ItemProperty -Path $lockPolPath -Name 'LockScreenImage'      -Value $lockscreen -Type String
    Set-ItemProperty -Path $lockPolPath -Name 'NoChangingLockScreen' -Value 1           -Type DWord
    Write-WcsLog 'Branding' 'OK' 'Lockscreen set machine-wide'

    foreach ($u in @('Staff','Admin')) {
        if (Get-LocalUser -Name $u -ErrorAction SilentlyContinue) {
            Set-WallpaperForUser -User $u -ImagePath $wallpaper
        }
    }
}

# ============================================================
# SECTION 5: CHROME HKLM HYGIENE POLICIES (no URL allowlist)
# ============================================================
function Set-WcsChromePolicies {
    $root = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
    if (-not (Test-Path $root)) { New-Item -Path $root -Force | Out-Null }

    $dword = @{
        BrowserSignin              = 0
        SyncDisabled               = 1
        BrowserAddPersonEnabled    = 0
        BrowserGuestModeEnabled    = 0
        PasswordManagerEnabled     = 0
        AutofillAddressEnabled     = 0
        AutofillCreditCardEnabled  = 0
        IncognitoModeAvailability  = 1
        DownloadRestrictions       = 3
        ForceGoogleSafeSearch      = 1
        ForceYouTubeRestrictedMode = 2
        ForceBingSafeSearch        = 2
    }
    foreach ($name in $dword.Keys) {
        Set-ItemProperty -Path $root -Name $name -Value $dword[$name] -Type DWord
    }

    foreach ($subKey in 'URLAllowlist','URLBlocklist','RestoreOnStartupURLs','PinnedTabs') {
        $path = Join-Path $root $subKey
        if (Test-Path $path) { Remove-Item -Path $path -Recurse -Force }
    }
    foreach ($legacyVal in 'RestoreOnStartup','RestrictSigninToPattern','ClearBrowsingDataOnExit','DeveloperToolsAvailability') {
        if (Get-ItemProperty -Path $root -Name $legacyVal -ErrorAction SilentlyContinue) {
            Remove-ItemProperty -Path $root -Name $legacyVal -Force
        }
    }

    Write-WcsLog 'Chrome' 'OK' 'HKLM Chrome hygiene policies applied (no URL allowlist)'
}

# ============================================================
# SECTION 6: STAFF HKCU LOCKDOWN (no Settings, no cmd, etc.)
# ============================================================
function Set-WcsStaffLockdown {
    $userProfile = 'C:\Users\Staff'
    $hive        = "$userProfile\NTUSER.DAT"
    if (-not (Test-Path $hive)) {
        Write-WcsLog 'StaffLock' 'WARN' 'Staff hive not found (user has not logged in yet) - skipping HKCU lockdown'
        return
    }

    $hiveKey = 'WCS_Staff_Lock'
    & reg.exe load "HKU\$hiveKey" $hive 2>&1 | Out-Null
    try {
        $explorer = "Registry::HKEY_USERS\$hiveKey\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
        if (-not (Test-Path $explorer)) { New-Item -Path $explorer -Force | Out-Null }

        $policies = @{
            NoControlPanel       = 1
            DisallowRun          = 1
            NoRun                = 1
            NoViewContextMenu    = 1
            NoDrives             = 67108863
        }
        foreach ($k in $policies.Keys) {
            Set-ItemProperty -Path $explorer -Name $k -Value $policies[$k] -Type DWord
        }

        $disallow = "$explorer\DisallowRun"
        if (-not (Test-Path $disallow)) { New-Item -Path $disallow -Force | Out-Null }
        $blocked = @(
            'cmd.exe', 'powershell.exe', 'pwsh.exe', 'regedit.exe',
            'msedge.exe', 'mmc.exe', 'msconfig.exe', 'gpedit.msc',
            'WindowsStore.exe'
        )
        Get-Item -Path $disallow | Select-Object -ExpandProperty Property |
            ForEach-Object { Remove-ItemProperty -Path $disallow -Name $_ -ErrorAction SilentlyContinue }
        for ($i = 0; $i -lt $blocked.Count; $i++) {
            Set-ItemProperty -Path $disallow -Name (($i + 1).ToString()) -Value $blocked[$i] -Type String
        }

        $storePol = "Registry::HKEY_USERS\$hiveKey\Software\Policies\Microsoft\WindowsStore"
        if (-not (Test-Path $storePol)) { New-Item -Path $storePol -Force | Out-Null }
        Set-ItemProperty -Path $storePol -Name 'RemoveWindowsStore' -Value 1 -Type DWord

        Write-WcsLog 'StaffLock' 'OK' "HKCU lockdown applied to Staff (blocked $($blocked.Count) exes)"
    } finally {
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        & reg.exe unload "HKU\$hiveKey" 2>&1 | Out-Null
    }
}

# ============================================================
# SECTION 7: LOGON SCRIPTS + SCHEDULED TASKS
# ============================================================
function Write-LogonScripts {
    $staffLogon = @"
`$ErrorActionPreference = 'SilentlyContinue'
`$abcArg = ''
if (Test-Path 'C:\WCS\abc-url.txt') {
    `$abcURL = (Get-Content 'C:\WCS\abc-url.txt' -First 1).Trim()
    if (`$abcURL) { `$abcArg = "--abc-url=`$abcURL" }
}
`$portalApp = 'C:\Program Files\WCS App\WCS App.exe'
if (Test-Path `$portalApp) {
    Start-Process -FilePath `$portalApp -ArgumentList "--location=$LocationName `$abcArg"
}
"@
    Set-Content -Path "$WcsDir\staff-logon.ps1" -Value $staffLogon -Force

    $adminLogon = @'
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$abcPath = Join-Path $desktopPath 'Set ABC URL.lnk'
if (-not (Test-Path $abcPath)) {
    $s = $shell.CreateShortcut($abcPath)
    $s.TargetPath = 'powershell.exe'
    $s.Arguments  = '-NoProfile -ExecutionPolicy Bypass -File "C:\WCS\set-abc-url.ps1"'
    $s.Description = 'Set ABC Financial URL for this machine'
    $s.Save()
}
'@
    Set-Content -Path "$WcsDir\admin-logon.ps1" -Value $adminLogon -Force

    $abcSetter = @'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
$abcFile = 'C:\WCS\abc-url.txt'
$current = ''
if (Test-Path $abcFile) { $current = (Get-Content $abcFile -First 1).Trim() }
$new = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Enter the ABC Financial URL for this machine:`n`nCurrent: $current",
    'WCS Portal - Set ABC URL',
    $current)
if ($new -and $new.Trim()) {
    if (-not (Test-Path 'C:\WCS')) { New-Item -Path 'C:\WCS' -ItemType Directory -Force | Out-Null }
    Set-Content -Path $abcFile -Value $new.Trim() -Force
    [System.Windows.Forms.MessageBox]::Show(
        "ABC URL saved!`n`n$($new.Trim())`n`nThis will take effect next time Staff logs in.",
        'WCS Portal', 'OK', 'Information')
}
'@
    Set-Content -Path "$WcsDir\set-abc-url.ps1" -Value $abcSetter -Force
}

function Register-WcsTask {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$ScriptPath,
        [Parameter(Mandatory)][string]$User,
        [Parameter(Mandatory)][ValidateSet('AtLogon','Daily2am')][string]$Trigger
    )
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""

    if ($Trigger -eq 'AtLogon') {
        $trig = New-ScheduledTaskTrigger -AtLogOn
        $trig.UserId = $User
        $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive
    } else {
        $trig = New-ScheduledTaskTrigger -Daily -At '2:00AM'
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    }
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trig -Principal $principal | Out-Null
}

function Set-WcsScheduledTasks {
    Write-LogonScripts

    Register-WcsTask -Name 'WCS-Staff-Logon' -ScriptPath "$WcsDir\staff-logon.ps1" `
                     -User 'Staff' -Trigger AtLogon
    Register-WcsTask -Name 'WCS-Admin-Logon' -ScriptPath "$WcsDir\admin-logon.ps1" `
                     -User 'Admin' -Trigger AtLogon

    $cleanupCmd = @'
$root = 'C:\Users\Staff\AppData\Local\Google\Chrome\User Data'
if (Test-Path $root) {
    Get-ChildItem -Path $root -Directory |
        Where-Object { $_.Name -match '^Profile' } |
        ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}
'@
    if (Get-ScheduledTask -TaskName 'WCS-Nightly-Chrome-Cleanup' -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName 'WCS-Nightly-Chrome-Cleanup' -Confirm:$false
    }
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' `
                 -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$cleanupCmd`""
    $trigger   = New-ScheduledTaskTrigger -Daily -At '2:00AM'
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    Register-ScheduledTask -TaskName 'WCS-Nightly-Chrome-Cleanup' `
        -Action $action -Trigger $trigger -Principal $principal | Out-Null

    Write-WcsLog 'Tasks' 'OK' 'Logon scripts written + scheduled tasks registered'
}

# ============================================================
# SECTION 8: INVENTORY - read-only state report
# ============================================================
function Get-WcsInventory {
    Write-WcsLog 'Inv' 'OK' "--- Kiosk inventory: $env:COMPUTERNAME ---"

    $users = Get-LocalUser | Where-Object { -not ($BuiltInUsers -contains $_.Name) }
    foreach ($u in $users) {
        $tag = if ($AllowedUsers -contains $u.Name) { 'allowed' } else { 'WOULD-REMOVE' }
        Write-WcsLog 'Inv' 'OK' "User: $($u.Name) [$tag] enabled=$($u.Enabled)"
    }

    $portal = Test-PortalInstalled
    $chrome = Test-ChromeInstalled
    $sonos  = Test-SonosInstalled
    $bd     = Test-BitdefenderInstalled
    Write-WcsLog 'Inv' 'OK' "Apps: Portal=$portal, Chrome=$chrome, Sonos=$sonos, Bitdefender=$bd"

    $cp = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Google\Chrome' -ErrorAction SilentlyContinue
    if ($cp) {
        Write-WcsLog 'Inv' 'OK' ("Chrome: DownloadRestrictions={0}, SafeSearch={1}, Incognito={2}" -f
            $cp.DownloadRestrictions, $cp.ForceGoogleSafeSearch, $cp.IncognitoModeAvailability)
    } else {
        Write-WcsLog 'Inv' 'WARN' 'Chrome HKLM policies not present'
    }

    $lp = Get-ItemProperty 'HKLM:\Software\Policies\Microsoft\Windows\Personalization' -ErrorAction SilentlyContinue
    if ($lp.LockScreenImage) {
        Write-WcsLog 'Inv' 'OK' "Lockscreen: $($lp.LockScreenImage)"
    } else {
        Write-WcsLog 'Inv' 'WARN' 'Lockscreen image not configured'
    }

    $tasks = Get-ScheduledTask -TaskName 'WCS-*' -ErrorAction SilentlyContinue
    foreach ($t in $tasks) {
        Write-WcsLog 'Inv' 'OK' "Task: $($t.TaskName) state=$($t.State)"
    }
}

# ============================================================
# MAIN - mode dispatcher
# ============================================================
if (-not (Test-IsAdmin)) {
    Write-Error "Must run as Administrator (or SYSTEM via Action1)."
    exit 1
}

Initialize-WcsDir
Write-WcsLog 'Init' 'OK' "Run started - mode=$Mode, machine=$env:COMPUTERNAME, location=$LocationName"

switch ($Mode) {
    'Full'      {
        Set-WcsUsers
        Invoke-WcsProfileSweep
        Install-WcsApps
        Set-WcsBranding
        Set-WcsChromePolicies
        Set-WcsStaffLockdown
        Set-WcsScheduledTasks
    }
    'Lockdown'  {
        Set-WcsChromePolicies
        Set-WcsStaffLockdown
    }
    'Cleanup'   {
        Invoke-WcsProfileSweep
    }
    'Inventory' {
        Get-WcsInventory
    }
}

Write-WcsLog 'Done' 'OK' 'Run finished'

