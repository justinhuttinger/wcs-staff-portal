# WCS Kiosk Deployment

This folder documents how to take a fresh Windows PC and turn it into a
locked-down WCS front-desk kiosk using **Action1** (RMM) +
**Bitdefender GravityZone** (AV) + the consolidated PowerShell script
`scripts/kiosk-state.ps1`.

## Architecture in one paragraph

Each gym kiosk runs Windows with two local users: `Staff` (auto-logon,
locked-down, runs the WCS Portal app fullscreen) and `Admin` (for IT
work). Action1 is the management layer that pushes scripts and
software. GravityZone is the antivirus, deployed via Action1's
Software Repository. The script `scripts/kiosk-state.ps1` enforces
every part of kiosk state (users, apps, branding, lockdown, scheduled
tasks) idempotently — re-runnable any time without breaking anything.

## Documents in this folder

| File | What it covers |
|---|---|
| [`01-one-time-setup.md`](01-one-time-setup.md) | One-time setup in GravityZone + Action1 (do this once for the org) |
| [`02-per-kiosk-runbook.md`](02-per-kiosk-runbook.md) | Steps to deploy a new kiosk (or re-image an existing one) |
| [`03-troubleshooting.md`](03-troubleshooting.md) | Common issues and how to fix them |

## Quick reference

- **The script:** `scripts/kiosk-state.ps1` — paste contents into Action1
- **The legacy script:** `scripts/setup-kiosk.ps1.archive` — DO NOT push, kept for reference only
- **Emergency unlock:** `scripts/chrome-unlock.ps1` — removes Chrome HKLM policies and clears `C:\WCS\` (does not delete users)
- **Per-kiosk ABC URL:** `scripts/set-abc-url.ps1` — Admin desktop shortcut writes to `C:\WCS\abc-url.txt`
- **Logs on each kiosk:** `C:\WCS\setup.log`
- **Action1 console output:** captured per script run

## Modes the script supports

| Mode | What runs | When to use |
|---|---|---|
| `Full` (default) | Users -> Sweep -> Apps -> Branding -> Chrome -> Staff lockdown -> Tasks | New kiosk bootstrap, or full re-enforcement |
| `Lockdown` | Chrome policies + Staff HKCU lockdown only | Quick re-lock after manual config drift |
| `Cleanup` | Profile sweep only (delete non-allowlisted users) | Periodic janitor run |
| `Inventory` | Read-only state report | Verification, no changes made |

Because Action1's plan tier doesn't expose a per-run **Parameters**
field, `$Mode` is hardcoded into each saved Action1 script. **Four
saved scripts total** (`WCS Kiosk State - Full / Inventory / Lockdown /
Cleanup`), all location-agnostic — location is set per-kiosk in the
Portal app config UI rather than at the script level. See
[`01-one-time-setup.md`](01-one-time-setup.md) Part 4 for setup details.

## Allowlist policy

Preserved on every kiosk: `Staff`, `Admin`, `abctech` (only if
pre-existing), and the four built-in Windows accounts. Every other
local user account is auto-deleted on `Full` or `Cleanup` runs.
