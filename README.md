# WCS Staff Portal

Locked kiosk-style staff portal for West Coast Strength's 7 Oregon locations.

## Components

| Directory | Description |
|-----------|-------------|
| `portal/` | React + Vite + Tailwind web app — tool launcher homepage |
| `launcher/` | Electron Windows app — keeps Chrome alive, idle timeout, tray icon |
| `scripts/` | PowerShell scripts for Action1 RMM — Chrome lockdown + nightly cleanup |

## Quick Start

### Portal (development)
```bash
cd portal && npm install && npm run dev
```

### Launcher (development)
```bash
cd launcher && npm install && npm start
```

### Portal (production build)
```bash
cd portal && npm run build
```

Deploy `portal/dist/` to Render as a static site.

### Launcher (build Windows installer)
```bash
cd launcher && npm run build
```

Produces `launcher/dist/Portal Setup <version>.exe` (NSIS).
The installer prompts the admin to pick a location and writes
`C:\WCS\config.json` before the launcher first runs.

### Launcher (build macOS installer)
Build on a Mac (electron-builder cannot cross-build a signed `.dmg`):
```bash
cd launcher && npm install && npm run build -- --mac
```

Produces `launcher/dist/Portal-<version>-arm64.dmg` and
`launcher/dist/Portal-<version>.dmg` (Intel). On first launch the app shows
the same location picker as the Windows installer and writes
`~/Library/Application Support/WCS/config.json`.

Code signing / notarization is opt-in — set `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` in the
environment before running `npm run build -- --mac`. Without them the build
still succeeds but Gatekeeper will require a right-click → Open on first
launch.

## Locations

Salem, Keizer, Eugene, Springfield, Clackamas, Milwaukie, Medford

Set location via URL param: `?location=Salem` or env var `VITE_LOCATION`.

## Brand Colors

- Navy: `#1a1a2e`
- Red: `#C8102E`
- White: `#ffffff`
