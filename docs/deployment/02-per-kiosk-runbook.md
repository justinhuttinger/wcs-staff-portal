# Per-Kiosk Deployment Runbook

This is what you do to take a fresh PC and turn it into a WCS kiosk.
Assumes the one-time setup from [`01-one-time-setup.md`](01-one-time-setup.md)
is already done.

**Time needed:** ~15-30 min per kiosk (mostly waiting for installs).

---

## Step 1: Get Windows + Action1 onto the kiosk

1. Install Windows 11 Home or Pro on the new PC (whatever the org uses)
2. Complete OOBE with **any local user** — you'll delete it later. Suggested name: `setup`
3. Connect to the gym's WiFi or LAN
4. Install the Action1 agent:
   - Action1 -> **Endpoints** -> **+ Add Endpoint** -> **Install on Windows**
   - Copy the agent installer URL OR download the `.exe`
   - Run it on the kiosk -> agent registers -> kiosk appears in Action1
5. **Tag the new kiosk** in Action1: `WCS-Kiosk` and `WCS-Kiosk-<Location>`

---

## Step 2: Push Bitdefender (Action1 handles this automatically)

If your BD deployment from Part 3 of one-time-setup is set to
"Run when endpoint comes online", BD will auto-install within a few
minutes of the kiosk appearing in Action1. Otherwise:

1. Action1 -> **Software Repository** -> Bitdefender package -> **Deploy**
2. Target = the new kiosk
3. Wait ~5 min for the install to complete
4. Verify in Action1 endpoint detail or by checking:
   ```powershell
   Get-ItemProperty 'HKLM:\SOFTWARE\Bitdefender\Endpoint Security' -ErrorAction SilentlyContinue
   ```

---

## Step 3: Run the kiosk-state script

1. Action1 -> **Scripts** -> open `WCS Kiosk State - <Location>` for this kiosk's location
2. **Run** -> target = this kiosk only (for the first run)
3. **Run as:** SYSTEM
4. **Parameters:** leave empty (defaults to `-Mode Full`)
5. Click **Run now**

The script will:
- Create `Staff` and `Admin` local users
- Delete the `setup` user (and any other non-allowlisted account)
- Install Portal launcher, Chrome, Sonos
- Apply branded wallpaper + lockscreen
- Apply Chrome HKLM hygiene policies
- Register logon scripts + nightly Chrome cleanup task

It will log `WARN` for the Staff lockdown step because Staff hasn't
logged in yet (no NTUSER.DAT yet) — that's expected.

---

## Step 4: First Staff login (initializes the lockdown)

1. Sign out of the `setup` session (or reboot)
2. Log in as **Staff** with password `staff`
3. Windows creates `C:\Users\Staff\NTUSER.DAT`
4. Portal launcher autostarts via the logon script
5. Sign out

---

## Step 5: Re-run the script to apply lockdown

Now that the Staff hive exists, run the same script again:

1. Action1 -> Scripts -> `WCS Kiosk State - <Location>` -> **Run** on this kiosk
2. This time the Staff lockdown step will succeed (HKCU policies applied)

---

## Step 6: Verify

Run the script in **Inventory** mode:

1. Action1 -> Scripts -> `WCS Kiosk State - <Location>`
2. Edit the **Parameters** field for this run only: `-Mode Inventory`
3. **Run now** on this kiosk
4. Inspect the script output (Action1 console captures stdout) — every
   line should be `OK`. Any `WARN` or `WOULD-REMOVE` indicates
   something to fix.

You can also check `C:\WCS\setup.log` on the kiosk directly via
Action1 -> Endpoints -> kiosk -> **Run command** -> `type C:\WCS\setup.log`.

---

## Step 7: Set the ABC URL for this location

1. Log in as **Admin** (password `!31JellybeaN31!`)
2. Double-click **Set ABC URL** desktop shortcut
3. Paste the location's ABC Financial URL into the dialog
4. Click OK
5. Sign out

Next time Staff logs in, Portal will launch with `--abc-url=<URL>` set.

---

## Step 8: Final lockdown handoff

1. Reboot the kiosk
2. It should auto-login as Staff (or land at the Staff login prompt
   with branded lockscreen)
3. Portal launches fullscreen
4. Verify keyboard shortcuts are blocked (`Win+R`, `Ctrl+Shift+Esc`,
   etc.) — they should be no-ops because of the HKCU lockdown

---

## Quick reference cheat sheet

```
Action1 -> Scripts -> WCS Kiosk State - <Location> -> Run
   Parameters (empty) = -Mode Full       (default, all sections)
   Parameters: -Mode Lockdown            (just Chrome + Staff HKCU)
   Parameters: -Mode Cleanup             (just profile sweep)
   Parameters: -Mode Inventory           (read-only check)
```

```
Kiosk passwords:
   Staff: staff
   Admin: !31JellybeaN31!
```

```
Files on each kiosk:
   C:\WCS\setup.log              -- script run log
   C:\WCS\branding\               -- wallpaper + lockscreen
   C:\WCS\installers\             -- (only if BD installer staged here)
   C:\WCS\staff-logon.ps1         -- runs on Staff login
   C:\WCS\admin-logon.ps1         -- runs on Admin login
   C:\WCS\set-abc-url.ps1         -- ABC URL dialog
   C:\WCS\abc-url.txt             -- saved ABC URL for this kiosk
```
