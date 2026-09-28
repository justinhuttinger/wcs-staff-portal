<#
  set-wcs-club.ps1 - Action1 "Run Script" (SYSTEM): set which club this PC is
  for. Portal and WCS ABC both read C:\WCS\config.json, so this sets the club
  and its ABC login link for both apps. Takes effect the next time the app opens.

  The club list comes from the portal (Admin -> Clubs) via
  https://api.wcstrength.com/public/clubs, so a newly added club works here
  with no script change.

  EDIT THE LINE BELOW before running: the club's name as it appears in
  Admin -> Clubs (for example Salem or Medford).
#>
$Club = 'Salem'

$ErrorActionPreference = 'Stop'
$Api = 'https://api.wcstrength.com/public/clubs'

try {
  $clubs = (Invoke-RestMethod -Uri $Api -TimeoutSec 20).clubs
} catch {
  Write-Output "Could not load the club list from $Api : $($_.Exception.Message)"
  exit 1
}

$match = @($clubs) | Where-Object { $_.name -ieq $Club.Trim() } | Select-Object -First 1
if (-not $match) {
  Write-Output "Unknown club '$Club'. Use one of: $((@($clubs) | ForEach-Object { $_.name }) -join ', ')"
  exit 1
}
if (-not $match.abcUrl) {
  Write-Output "$($match.name) has no ABC login URL yet. Add it in Admin -> Clubs, then run this again."
  exit 1
}

$path = 'C:\WCS\config.json'
New-Item -ItemType Directory -Force -Path 'C:\WCS' | Out-Null
$cfg = [ordered]@{}
if (Test-Path $path) {
  try {
    $old = Get-Content $path -Raw | ConvertFrom-Json
    foreach ($p in $old.PSObject.Properties) { $cfg[$p.Name] = $p.Value }  # keep install_id etc.
  } catch { Write-Output 'existing config.json unreadable - replacing it' }
}
$before = if ($cfg.Contains('location')) { $cfg['location'] } else { '(none)' }
$cfg['location'] = $match.name
$cfg['abc_url'] = $match.abcUrl
[IO.File]::WriteAllText($path, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Write-Output "Club: $before -> $($match.name)"
Write-Output "ABC link: $($match.abcUrl)"
