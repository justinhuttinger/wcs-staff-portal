# One-Time Setup

Do these steps **once** for the whole organization. After this is done,
adding a new kiosk is just running the per-kiosk runbook
([`02-per-kiosk-runbook.md`](02-per-kiosk-runbook.md)).

---

## Part 1: GravityZone — get the installer

1. Log into **gravityzone.bitdefender.com** (or your console URL)
2. Left sidebar: **Network** -> **Packages** (or **Installation Packages**)
3. Either reuse an existing package, or click **Add** to create:
   - **Name:** `WCS Kiosk Endpoints`
   - **Modules:** Antimalware, Advanced Threat Control, Firewall (your standard kiosk policy)
   - **Policy:** the kiosk policy (or default)
   - **Language:** English
4. Save the package
5. Find the package row -> click **Download** -> choose **Windows Downloader** (~10 MB `.exe`, NOT the full kit)
6. Save to `C:\Users\justi\Downloads\` — filename will be `setupdownloader_[base64].exe`

> The base64 suffix in the filename is the encoded install token for
> your GravityZone tenant. **Do not commit it to git** — that's why
> it stays in Action1's repo only.

---

## Part 2: Action1 — add Bitdefender to Software Repository

1. Log into **app.action1.com**
2. Left nav -> **Software Repository**
3. Top-right: **+ Add Package** -> **Upload Application** -> **Upload from local computer**
4. Browse to `C:\Users\justi\Downloads\setupdownloader_[...].exe` and upload
5. Fill in the metadata:

   | Field | Value |
   |---|---|
   | Application Name | `Bitdefender Endpoint Security Tools` |
   | Vendor | `Bitdefender` |
   | Version | `2026.04.28` (or today's date) |
   | Architecture | `x64` |
   | Description | `WCS GravityZone agent installer` |
   | Distribution | `Private P2P` (NOT UNC path) |
   | Install command | `setupdownloader.exe /bdparams /silent` (Action1 substitutes the real filename) |
   | Uninstall command | `"C:\Program Files\Bitdefender\Endpoint Security\epuninstall.exe" /silent` |
   | Detection rule | **Registry key exists**: `HKLM\SOFTWARE\Bitdefender\Endpoint Security` |

6. **Save**

---

## Part 3: Action1 — deploy Bitdefender to all kiosks (one-time)

1. Software Repository -> click the **Bitdefender Endpoint Security Tools** package row
2. **Deploy** (or **Install on endpoints**)
3. **Target:** WCS-Kiosk group/tag (or pick the test machine first)
4. **Schedule:** **Run when endpoint comes online**
5. **Reboot:** **No reboot needed**
6. **Deploy**

This will install BD on every targeted kiosk. After it succeeds, BD
will be permanently present and `kiosk-state.ps1`'s BD section will
just log `SKIP Bitdefender already installed` — that's intended.

---

## Part 4: Action1 — create the 4 kiosk-state scripts

Action1's plan tier doesn't expose a per-run **Parameters** field, so
we hardcode `$Mode` directly in the saved script body. This used to
require per-location duplication too — but the script no longer needs
a `$LocationName` (it's read from `C:\WCS\config.json`, set via the
Portal app config UI per kiosk). So one script body covers all 7 gyms.

**Four saved Action1 scripts total.** All four files are pre-generated
in [`action1-scripts/`](action1-scripts/) ready to paste.

For each script:

1. Open the corresponding file in [`action1-scripts/`](action1-scripts/) on GitHub
2. Click **Raw** and copy the contents (Ctrl+A, Ctrl+C)
3. Action1 -> **Scripts** -> **+ New Script** -> **PowerShell**
4. Set fields per the table below
5. Paste body into the script editor
6. Set **Run as: Local System**
7. **Save**

| Action1 saved-script name | Source file | When to run |
|---|---|---|
| `WCS Kiosk State - Full` | `WCS-Kiosk-State-Full.ps1` | New-kiosk bootstrap, full re-enforcement |
| `WCS Kiosk State - Inventory` | `WCS-Kiosk-State-Inventory.ps1` | Read-only verify of any kiosk |
| `WCS Kiosk State - Lockdown` | `WCS-Kiosk-State-Lockdown.ps1` | Quick re-lock after Chrome / HKCU drift |
| `WCS Kiosk State - Cleanup` | `WCS-Kiosk-State-Cleanup.ps1` | Periodic janitor: delete non-allowlisted users |

> **Why pre-generated files instead of "paste kiosk-state.ps1 four
> times and edit the param block"?** Same content, less hand-editing.
> The generator at `action1-scripts/_generate.ps1` re-derives them
> whenever the canonical `scripts/kiosk-state.ps1` changes.

---

## Part 5: (Optional) Tag the kiosks in Action1

For the script targeting to work cleanly, group your kiosks:

1. Action1 -> **Endpoints** (or **Devices**)
2. Select the kiosk machines (Ctrl+click)
3. **Add tag** or **Assign group** -> create/pick `WCS-Kiosk`
4. Optionally also tag per-location: `WCS-Kiosk-Salem`, `WCS-Kiosk-Beaverton`, etc.
   This lets you target each location's script to just its own kiosks.

---

## Done

After these 5 parts, you can deploy a new kiosk by following
[`02-per-kiosk-runbook.md`](02-per-kiosk-runbook.md).
