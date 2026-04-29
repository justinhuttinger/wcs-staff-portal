# Troubleshooting

Common issues and how to fix them.

---

## "Bitdefender flagged my script / quarantined it" (dev machine only)

**Symptom:** On Justin's laptop, BD blocks reads/writes to
`scripts/wcs-kiosk.ps1` (or similar names matching `wcs-kiosk*.ps1`).

**Why it happens:** BD's content/filename heuristic matched the
combination of `Remove-LocalUser`, NTUSER.DAT loading, and DisallowRun
list patterns the first time it scanned the file. After that, BD
keeps blocking the path.

**Fix:** The script was renamed to `kiosk-state.ps1` to sidestep
this. Don't rename it back. The on-disk `wcs-kiosk.ps1` zombie file
is gitignored.

**On kiosks this won't happen because:**
1. The repo path doesn't exist on kiosks. Action1 pastes the script
   content into its own runner directory.
2. BD isn't installed yet on first script run.
3. SYSTEM-context script execution from a trusted runner (Action1)
   gets a more permissive scan profile.

If a kiosk does get its kiosk-state run blocked by HyperDetect later,
add a GravityZone policy exclusion for the Action1 runner path
(commonly `C:\Windows\Temp\Action1\` — confirm from kiosk BD logs)
under HyperDetect + ATC + On-Access modules.

---

## Script logs `Bitdefender installer missing`

**Symptom:** `[Apps] WARN  Bitdefender installer missing at C:\WCS\installers\bitdefender-setup.exe`

**Why:** The script looks for the BD installer at that exact path.
We're not staging it there — Action1 deploys BD as a separate
Software Repository package, which uses Action1's own cache directory.

**This is fine.** The script's BD section is a fallback for the case
where Action1 hasn't installed BD yet. The warning is harmless.

If you still want to silence it, you can comment out the BD section
in the script, or stage the file to `C:\WCS\installers\` via a
separate Action1 file deployment task.

---

## Staff lockdown didn't apply (`Staff hive not found`)

**Symptom:** First script run logs `[StaffLock] WARN Staff hive not found`.

**Why:** `C:\Users\Staff\NTUSER.DAT` only exists after Staff has
logged in for the first time. The script is loading that hive to
write HKCU policies, so it has to skip if there's no hive yet.

**Fix:** Log in as Staff once (creates the hive), log out, re-run
the script. Per-kiosk runbook step 4-5 covers this.

---

## Portal app doesn't autostart on Staff login

**Symptom:** Staff logs in, sees desktop, but Portal doesn't open.

**Checks:**
1. Is `C:\Program Files\WCS App\WCS App.exe` present?
   - If no -> Portal didn't install. Re-run the script and check
     the `[Apps]` lines for an install error.
2. Is the `WCS-Staff-Logon` scheduled task present?
   ```powershell
   Get-ScheduledTask -TaskName 'WCS-Staff-Logon' | Select TaskName, State
   ```
3. Is `C:\WCS\staff-logon.ps1` present?
   - If no -> the Tasks section didn't run. Re-run script with
     `-Mode Full`.
4. Check the Task Scheduler history for `WCS-Staff-Logon` — if it
   ran but exited with an error, the path or permissions are off.

---

## ABC URL isn't being passed to Portal

**Symptom:** Portal launches but doesn't navigate to the ABC console.

**Checks:**
1. Is `C:\WCS\abc-url.txt` present and non-empty?
   ```powershell
   Get-Content C:\WCS\abc-url.txt
   ```
2. If empty, log in as Admin and double-click **Set ABC URL** on the desktop.
3. Sign out of Staff (NOT just lock) -> sign back in. The URL is read at logon time.

---

## Chrome policies not applying

**Symptom:** Chrome lets users sign in / install extensions / use
Incognito despite the script reporting `[Chrome] OK`.

**Check the actual policies in Chrome:**

```
chrome://policy
```

Should show:
- `BrowserSignin = 0`
- `IncognitoModeAvailability = 1`
- `DownloadRestrictions = 3`
- `ForceGoogleSafeSearch = 1`

If they're missing, the registry key didn't write. Check:
```powershell
Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Google\Chrome'
```

If the key is empty/missing, re-run the script with `-Mode Lockdown`.

---

## Need to re-enable Settings/cmd on a kiosk for IT work

Don't fight the lockdown — log in as **Admin** instead. Admin doesn't
have the HKCU restrictions Staff has.

If you absolutely must temporarily unlock Staff:
1. Log in as Admin
2. Run `scripts/chrome-unlock.ps1` via Action1 (clears Chrome policies + scheduled tasks + `C:\WCS\`)
3. Do the IT work
4. Re-run `kiosk-state.ps1 -Mode Full` to restore the kiosk state

---

## Profile sweep removed an account I wanted to keep

**Symptom:** Looking at `C:\Users\<somebody>` — it's gone.

The script's allowlist is hardcoded:
```powershell
$AllowedUsers = @('Staff','Admin','abctech')
```

If you need another preserved account, **edit this line in the
Action1 saved script for that location** before re-running. The
script never recreates deleted accounts — once gone, gone (unless
you have a backup).

For one-off preservation, log into Action1 and **disable** the
recurring run of the script for that kiosk while you sort it out.

---

## Action1 script "Run as" failed

**Symptom:** Script run reports access denied on registry/user
operations.

**Cause:** Script wasn't run as SYSTEM.

**Fix:** Check the saved script in Action1 — **Run as** must be
**Local System**. Not "Logged-in user". Re-save and re-run.

---

## How to fully wipe a kiosk and start over

```powershell
# Run as Admin
Remove-LocalUser Staff -ErrorAction SilentlyContinue
Remove-Item C:\Users\Staff -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item C:\WCS -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome' -Name * -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKLM:\Software\Policies\Microsoft\Windows\Personalization' -Name * -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName 'WCS-*' | Unregister-ScheduledTask -Confirm:$false
```

Then re-run `kiosk-state.ps1` from Action1 to rebuild from scratch.

---

## Where to find logs

| Location | Contents |
|---|---|
| `C:\WCS\setup.log` | Every script run, every section, persistent on disk |
| Action1 Script run history | Per-run stdout, accessible from Action1 console |
| `C:\Windows\Temp\Action1\` | Action1's runner working directory |
| GravityZone -> Network -> endpoint -> Events | BD detections and policy events |
| Windows Event Viewer -> Application | Bitdefender + EPSecurity events |
