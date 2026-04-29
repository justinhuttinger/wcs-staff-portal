# Action1 Paste-Ready Scripts

Four ready-to-paste PowerShell files, one per Action1 saved script.

## How to use

1. Open the file you need (click on it in GitHub, or open locally)
2. Click **Raw** if you're on GitHub (gets you plain text)
3. Select all (Ctrl+A) → copy (Ctrl+C)
4. In Action1: **Scripts** → **+ New Script** → **PowerShell**
5. Set the **Name** field (see table below)
6. Paste the file contents into the script body (Ctrl+V)
7. Set **Run as: Local System**
8. Save

Repeat for each of the 4 files.

## What's here

| File | Action1 saved-script name | What it does |
|---|---|---|
| `WCS-Kiosk-State-Full.ps1` | `WCS Kiosk State - Full` | Default `-Mode Full`. Bootstraps a kiosk: users, profile sweep, app installs, branding, Chrome policies, Staff lockdown, scheduled tasks. |
| `WCS-Kiosk-State-Inventory.ps1` | `WCS Kiosk State - Inventory` | Read-only state report. Run on any kiosk to verify state. |
| `WCS-Kiosk-State-Lockdown.ps1` | `WCS Kiosk State - Lockdown` | Chrome HKLM + Staff HKCU lockdown only. Quick re-lock after drift. |
| `WCS-Kiosk-State-Cleanup.ps1` | `WCS Kiosk State - Cleanup` | Profile sweep only. Deletes any non-allowlisted local users + their profile folders. |

All four scripts run on every kiosk regardless of location — location is
set per-kiosk in the Portal app config UI (writes `C:\WCS\config.json`),
which the launcher reads on each launch.

## Regenerating

These files are **derived** from `scripts/kiosk-state.ps1`. Don't edit
them by hand. If you change `kiosk-state.ps1`, regenerate them:

```powershell
& docs/deployment/action1-scripts/_generate.ps1
```

The generator reads the canonical script and rewrites all 4 files
with the appropriate `$Mode` substitution.
