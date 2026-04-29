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

## Part 4: Action1 — create the kiosk-state scripts

Action1's free / lower-tier plans don't expose a per-run **Parameters**
field, so we hardcode `$Mode` and `$LocationName` directly in the
saved script body. This means **10 saved scripts total** — but each is
just a copy-paste with one or two lines edited.

### 4a. Create the 7 per-location Full-mode scripts

Repeat once per location (Salem, Beaverton, etc.). Only `$LocationName`
differs between them.

1. Action1 -> left nav -> **Scripts** (or **Automations** -> **Scripts**)
2. **+ New Script** -> **PowerShell**
3. Fields:

   | Field | Value |
   |---|---|
   | Name | `WCS Kiosk State - <LocationName>` (e.g. `WCS Kiosk State - Salem`) |
   | Description | `Full kiosk state enforcement for <LocationName>. Idempotent.` |
   | Run as | **Local System** |

4. **Script body:** paste the entire contents of `scripts/kiosk-state.ps1`
5. **Edit one line** near the top of the pasted script:
   ```powershell
   $LocationName    = 'Salem'
   ```
   Change `'Salem'` to the location this script targets.
6. **Save**

End result: 7 scripts, one per gym, each pinned to its location. All
run `-Mode Full` because that's the default in the `param()` block.

### 4b. Create the 3 mode-only utility scripts (location-agnostic)

These don't need per-location copies because the modes they run
(Inventory / Lockdown / Cleanup) don't use `$LocationName` for
anything functional — only Full mode writes the location into the
Staff logon script.

For each of the three utility scripts:

1. Action1 -> **Scripts** -> **+ New Script** -> **PowerShell**
2. Fields per the table below
3. **Script body:** paste the entire contents of `scripts/kiosk-state.ps1`
4. **Replace the entire `param()` block** at the top (5 lines) with
   a single hardcoded line:
   ```powershell
   $Mode = 'Inventory'
   ```
   …or `'Lockdown'`, or `'Cleanup'`, depending on the utility script.
5. Leave `$LocationName = 'Salem'` as-is (won't matter for these modes)
6. **Save**

| Script name | Replace `param()` with | When to run |
|---|---|---|
| `WCS Kiosk State - Inventory` | `$Mode = 'Inventory'` | Verify any kiosk's state, read-only |
| `WCS Kiosk State - Lockdown` | `$Mode = 'Lockdown'` | Quick re-lock after Chrome / HKCU drift |
| `WCS Kiosk State - Cleanup` | `$Mode = 'Cleanup'` | Periodic janitor: delete non-allowlisted users |

### Total saved Action1 scripts

- 7 location Full-mode scripts (`WCS Kiosk State - <Location>`)
- 3 mode-only utility scripts (`WCS Kiosk State - Inventory / Lockdown / Cleanup`)
- **= 10 scripts total**

> **Why hardcoded and not parameterized?** Action1's Run dialog on
> our plan tier doesn't accept script arguments — the only way to
> control mode is to bake it into the saved script body. Same goes
> for `$LocationName`. The "duplicate the script per variant"
> approach is ugly but is the only one that actually works on this
> plan.

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
