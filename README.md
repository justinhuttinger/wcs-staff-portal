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

### Launcher (build installer)
```bash
cd launcher && npm run build
```

Produces `launcher/dist/WCS Portal Launcher Setup.exe`.

## Locations

Salem, Keizer, Eugene, Springfield, Clackamas, Milwaukie, Medford

Set location via URL param: `?location=Salem` or env var `VITE_LOCATION`.

## Brand Colors

- Navy: `#1a1a2e`
- Red: `#C8102E`
- White: `#ffffff`
