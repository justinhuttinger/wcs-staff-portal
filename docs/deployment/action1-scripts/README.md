# Action1 Paste-Ready Scripts

Ten ready-to-paste PowerShell files, one per Action1 saved script.

## How to use

1. Open the file you need (click on it in GitHub, or open locally)
2. Click **Raw** if you're on GitHub (gets you plain text)
3. Select all (Ctrl+A) → copy (Ctrl+C)
4. In Action1: **Scripts** → **+ New Script** → **PowerShell**
5. Set the **Name** field (see table below)
6. Paste the file contents into the script body (Ctrl+V)
7. Set **Run as: Local System**
8. Save

Repeat for each of the 10 files.

## What's here

### 7 per-location Full-mode scripts

Each runs `kiosk-state.ps1` in the default `Full` mode with
`$LocationName` hardcoded to that gym.

| File | Action1 saved-script name |
|---|---|
| `WCS-Kiosk-State-Salem.ps1` | `WCS Kiosk State - Salem` |
| `WCS-Kiosk-State-Keizer.ps1` | `WCS Kiosk State - Keizer` |
| `WCS-Kiosk-State-Eugene.ps1` | `WCS Kiosk State - Eugene` |
| `WCS-Kiosk-State-Springfield.ps1` | `WCS Kiosk State - Springfield` |
| `WCS-Kiosk-State-Clackamas.ps1` | `WCS Kiosk State - Clackamas` |
| `WCS-Kiosk-State-Milwaukie.ps1` | `WCS Kiosk State - Milwaukie` |
| `WCS-Kiosk-State-Medford.ps1` | `WCS Kiosk State - Medford` |

### 3 mode-only utility scripts (location-agnostic)

Each replaces the `param()` block with a hardcoded `$Mode` so the
script always runs that mode regardless of how it's invoked.
`$LocationName` stays as `'Salem'` but doesn't get used by these modes.

| File | Action1 saved-script name | What it does |
|---|---|---|
| `WCS-Kiosk-State-Inventory.ps1` | `WCS Kiosk State - Inventory` | Read-only state report |
| `WCS-Kiosk-State-Lockdown.ps1` | `WCS Kiosk State - Lockdown` | Chrome HKLM + Staff HKCU lockdown only |
| `WCS-Kiosk-State-Cleanup.ps1` | `WCS Kiosk State - Cleanup` | Profile sweep only |

## Regenerating

These files are **derived** from `scripts/kiosk-state.ps1`. Don't edit
them by hand. If you change `kiosk-state.ps1`, regenerate them:

```powershell
& docs/deployment/action1-scripts/_generate.ps1
```

The generator reads the canonical script and rewrites all 10 files
with the appropriate `$LocationName` / `$Mode` substitution.

## Why ten scripts and not just one with parameters?

Action1's plan tier doesn't expose a per-run **Parameters** field for
PowerShell scripts. So we hardcode `$Mode` and `$LocationName` into
each saved Action1 script body. See
[`../01-one-time-setup.md`](../01-one-time-setup.md) Part 4 for the
full reasoning.
