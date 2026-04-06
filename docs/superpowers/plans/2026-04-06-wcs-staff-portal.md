# WCS Staff Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locked kiosk-style staff portal for West Coast Strength's 7 Oregon gym locations — a React web launcher, an Electron Chrome watchdog, and PowerShell lockdown scripts for Action1 RMM deployment.

**Architecture:** Three independent components in one monorepo. The React portal is a static Vite site deployed to Render that shows tool buttons opening controlled popups. The Electron launcher is a Windows tray app that keeps Chrome alive and resets on idle. PowerShell scripts configure Chrome policies via Windows Registry and schedule nightly profile cleanup.

**Tech Stack:** React 18 + Vite + Tailwind CSS (portal), Electron + electron-builder (launcher), PowerShell 5.1+ (scripts)

---

## File Structure

```
wcs-staff-portal/
├── portal/                        # React + Vite web app
│   ├── src/
│   │   ├── App.jsx                # Main layout — logo, location name, tool grid, idle overlay
│   │   ├── main.jsx               # React entry point
│   │   ├── index.css              # Tailwind directives + global styles
│   │   ├── components/
│   │   │   ├── ToolButton.jsx     # Single tool button — icon, label, click handler
│   │   │   ├── ToolGrid.jsx       # CSS grid of ToolButtons, reads from tools.json
│   │   │   └── IdleOverlay.jsx    # Fullscreen "Touch to continue" overlay
│   │   ├── config/
│   │   │   └── tools.json         # Tool definitions: name, url, icon, category
│   │   └── hooks/
│   │       └── useIdleTimer.js    # Custom hook — tracks mouse/keyboard, returns isIdle
│   ├── public/
│   │   └── wcs-logo.svg           # WCS logo placeholder
│   ├── index.html                 # Vite entry HTML
│   ├── vite.config.js             # Vite config
│   ├── tailwind.config.js         # Tailwind with WCS brand colors
│   ├── postcss.config.js          # PostCSS for Tailwind
│   └── package.json
│
├── launcher/                      # Electron app
│   ├── src/
│   │   ├── main.js                # Electron main process — app lifecycle, tray, startup
│   │   ├── monitor.js             # Chrome process monitor — check every 5s, relaunch if dead
│   │   ├── idle.js                # Idle detection — kill Chrome + relaunch after 10min
│   │   └── config.js              # Constants — Chrome path, portal URL, intervals
│   ├── assets/
│   │   └── tray-icon.png          # 16x16 tray icon placeholder
│   ├── package.json
│   └── electron-builder.yml       # electron-builder config for Windows .exe
│
├── scripts/                       # Action1 PowerShell scripts
│   ├── chrome-lockdown.ps1        # Idempotent Chrome policy registry writer
│   ├── nightly-cleanup.ps1        # Removes non-default Chrome profiles
│   └── README.md                  # Deployment instructions for Action1
│
├── .gitignore
├── package.json                   # Root package.json with workspace scripts
└── README.md                      # Project overview
```

---

## Task 1: Initialize Monorepo and Portal Scaffold

**Files:**
- Create: `package.json` (root)
- Create: `.gitignore`
- Create: `portal/package.json`
- Create: `portal/index.html`
- Create: `portal/vite.config.js`
- Create: `portal/tailwind.config.js`
- Create: `portal/postcss.config.js`
- Create: `portal/src/main.jsx`
- Create: `portal/src/index.css`
- Create: `portal/src/App.jsx`

- [ ] **Step 1: Initialize git repo**

```bash
cd /c/Users/justi/wcs-staff-portal
git init
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "wcs-staff-portal",
  "private": true,
  "scripts": {
    "portal:dev": "cd portal && npm run dev",
    "portal:build": "cd portal && npm run build",
    "launcher:dev": "cd launcher && npm start",
    "launcher:build": "cd launcher && npm run build"
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.env
*.exe
```

- [ ] **Step 4: Initialize portal with Vite + React + Tailwind**

```bash
cd portal
npm init -y
npm install react react-dom
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite
```

- [ ] **Step 5: Create portal/vite.config.js**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000 }
})
```

- [ ] **Step 6: Create portal/src/index.css**

```css
@import "tailwindcss";

@theme {
  --color-navy: #1a1a2e;
  --color-wcs-red: #C8102E;
}
```

- [ ] **Step 7: Create portal/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WCS Staff Portal</title>
  </head>
  <body class="bg-navy min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create portal/src/main.jsx**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 9: Create portal/src/App.jsx (minimal scaffold)**

```jsx
export default function App() {
  return (
    <div className="min-h-screen bg-navy text-white flex items-center justify-center">
      <h1 className="text-3xl font-bold">WCS Staff Portal</h1>
    </div>
  )
}
```

- [ ] **Step 10: Verify dev server starts**

```bash
cd portal && npx vite --open
```

Expected: Browser opens to localhost:3000 showing "WCS Staff Portal" in white on dark navy background.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/justi/wcs-staff-portal
git add -A
git commit -m "feat: initialize monorepo with React + Vite + Tailwind portal scaffold"
```

---

## Task 2: Tool Configuration and ToolButton Component

**Files:**
- Create: `portal/src/config/tools.json`
- Create: `portal/src/components/ToolButton.jsx`

- [ ] **Step 1: Create portal/src/config/tools.json**

```json
[
  {
    "id": "ghl",
    "label": "GHL CRM",
    "url": "https://app.gohighlevel.com",
    "icon": "\ud83d\udccb",
    "category": "Sales"
  },
  {
    "id": "checkin",
    "label": "Member Check-In",
    "url": "https://wcs-mmp-portal.onrender.com/checkin",
    "icon": "\ud83c\udfcb\ufe0f",
    "category": "Operations"
  },
  {
    "id": "pt-dashboard",
    "label": "PT Dashboard",
    "url": "https://wcs-mmp-portal.onrender.com/pt",
    "icon": "\ud83d\udcaa",
    "category": "Training"
  },
  {
    "id": "book",
    "label": "Book Appointment",
    "url": "https://wcs-mmp-portal.onrender.com/book",
    "icon": "\ud83d\uddd3",
    "category": "Sales"
  },
  {
    "id": "abc",
    "label": "ABC Financial",
    "url": "https://abc-financial.example.com",
    "icon": "\ud83d\udcb3",
    "category": "Operations"
  },
  {
    "id": "gmail",
    "label": "Gmail",
    "url": "https://mail.google.com",
    "icon": "\u2709\ufe0f",
    "category": "Communication"
  },
  {
    "id": "drive",
    "label": "Google Drive",
    "url": "https://drive.google.com",
    "icon": "\ud83d\udcc1",
    "category": "Communication"
  },
  {
    "id": "day-one",
    "label": "Day One Training",
    "url": "https://day-one-training.example.com",
    "icon": "\ud83d\udcdd",
    "category": "Training"
  }
]
```

- [ ] **Step 2: Create portal/src/components/ToolButton.jsx**

```jsx
export default function ToolButton({ label, icon, url }) {
  const openTool = () => {
    const popup = window.open(
      url,
      label,
      'width=1400,height=900,toolbar=0,menubar=0,location=0'
    )
    if (!popup) {
      // Fallback if popup is blocked in kiosk mode
      window.location.href = url
      return
    }
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer)
      }
    }, 500)
  }

  return (
    <button
      onClick={openTool}
      className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/10 p-6 transition hover:bg-wcs-red/80 hover:scale-105 cursor-pointer"
    >
      <span className="text-4xl">{icon}</span>
      <span className="text-lg font-semibold text-white">{label}</span>
    </button>
  )
}
```

- [ ] **Step 3: Verify ToolButton renders**

Import ToolButton in App.jsx temporarily and render one button to confirm it displays correctly:

```jsx
import ToolButton from './components/ToolButton'

export default function App() {
  return (
    <div className="min-h-screen bg-navy text-white flex items-center justify-center">
      <ToolButton label="Test" icon="\ud83d\udccb" url="https://example.com" />
    </div>
  )
}
```

Run `cd portal && npx vite` and verify the button renders with icon and label, hover turns red.

- [ ] **Step 4: Commit**

```bash
git add portal/src/config/tools.json portal/src/components/ToolButton.jsx
git commit -m "feat: add tool configuration and ToolButton component"
```

---

## Task 3: ToolGrid Component

**Files:**
- Create: `portal/src/components/ToolGrid.jsx`

- [ ] **Step 1: Create portal/src/components/ToolGrid.jsx**

```jsx
import tools from '../config/tools.json'
import ToolButton from './ToolButton'

export default function ToolGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 p-8 max-w-5xl mx-auto">
      {tools.map((tool) => (
        <ToolButton
          key={tool.id}
          label={tool.label}
          icon={tool.icon}
          url={tool.url}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify grid renders all 8 tools**

Update App.jsx to use ToolGrid:

```jsx
import ToolGrid from './components/ToolGrid'

export default function App() {
  return (
    <div className="min-h-screen bg-navy text-white">
      <ToolGrid />
    </div>
  )
}
```

Run dev server. Expected: 8 tool buttons in a responsive grid, 4 columns on large screens, 2 on mobile.

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/ToolGrid.jsx portal/src/App.jsx
git commit -m "feat: add ToolGrid component with responsive layout"
```

---

## Task 4: Idle Timer Hook and Overlay

**Files:**
- Create: `portal/src/hooks/useIdleTimer.js`
- Create: `portal/src/components/IdleOverlay.jsx`

- [ ] **Step 1: Create portal/src/hooks/useIdleTimer.js**

```js
import { useState, useEffect, useCallback } from 'react'

export default function useIdleTimer(timeoutMs = 10 * 60 * 1000) {
  const [isIdle, setIsIdle] = useState(false)

  const resetTimer = useCallback(() => {
    setIsIdle(false)
  }, [])

  useEffect(() => {
    let timer = setTimeout(() => setIsIdle(true), timeoutMs)

    const handleActivity = () => {
      clearTimeout(timer)
      setIsIdle(false)
      timer = setTimeout(() => setIsIdle(true), timeoutMs)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, handleActivity))

    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, handleActivity))
    }
  }, [timeoutMs])

  return { isIdle, resetTimer }
}
```

- [ ] **Step 2: Create portal/src/components/IdleOverlay.jsx**

```jsx
export default function IdleOverlay({ onDismiss }) {
  return (
    <div
      onClick={onDismiss}
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/95 cursor-pointer"
    >
      <div className="text-center">
        <h2 className="text-5xl font-bold text-white mb-4">
          WCS Staff Portal
        </h2>
        <p className="text-2xl text-white/70 animate-pulse">
          Touch to continue
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify idle overlay appears**

For testing, temporarily set the timeout to 5 seconds in App.jsx:

```jsx
const { isIdle, resetTimer } = useIdleTimer(5000)
```

Run dev server. Wait 5 seconds without moving mouse. Expected: fullscreen overlay appears. Click it — overlay dismisses.

Change timeout back to `10 * 60 * 1000` after verifying.

- [ ] **Step 4: Commit**

```bash
git add portal/src/hooks/useIdleTimer.js portal/src/components/IdleOverlay.jsx
git commit -m "feat: add idle timer hook and fullscreen idle overlay"
```

---

## Task 5: Complete Portal App Layout

**Files:**
- Modify: `portal/src/App.jsx`
- Create: `portal/public/wcs-logo.svg`

- [ ] **Step 1: Create portal/public/wcs-logo.svg (placeholder)**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" fill="none">
  <rect width="200" height="60" rx="8" fill="#1a1a2e"/>
  <text x="100" y="38" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="24" font-weight="bold">WCS</text>
</svg>
```

- [ ] **Step 2: Write final portal/src/App.jsx**

```jsx
import { useState, useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import IdleOverlay from './components/IdleOverlay'
import useIdleTimer from './hooks/useIdleTimer'

const LOCATIONS = [
  'Salem', 'Keizer', 'Eugene', 'Springfield',
  'Clackamas', 'Milwaukie', 'Medford'
]

function getLocation() {
  const params = new URLSearchParams(window.location.search)
  const loc = params.get('location')
  if (loc && LOCATIONS.includes(loc)) return loc
  return import.meta.env.VITE_LOCATION || 'Salem'
}

export default function App() {
  const location = getLocation()
  const { isIdle, resetTimer } = useIdleTimer(10 * 60 * 1000)

  useEffect(() => {
    document.title = 'WCS Staff Portal'
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4">
        <img src="/wcs-logo.svg" alt="West Coast Strength" className="h-12" />
        <span className="text-xl font-semibold text-white/80">{location}</span>
      </header>

      {/* Tool Grid */}
      <main className="flex-1 flex items-center">
        <ToolGrid />
      </main>

      {/* Idle Overlay */}
      {isIdle && <IdleOverlay onDismiss={resetTimer} />}
    </div>
  )
}
```

- [ ] **Step 3: Verify complete layout**

Run `cd portal && npx vite`. Expected:
- WCS logo top-left, "Salem" top-right
- 8 tool buttons centered in grid
- Tab title reads "WCS Staff Portal"
- Visit `localhost:3000?location=Medford` — location switches to "Medford"
- Attempting to close tab shows browser confirmation dialog

- [ ] **Step 4: Commit**

```bash
git add portal/src/App.jsx portal/public/wcs-logo.svg
git commit -m "feat: complete portal layout with header, location param, tab lock"
```

---

## Task 6: Portal Build and Render Deploy Config

**Files:**
- Create: `portal/public/_redirects`

- [ ] **Step 1: Create portal/public/_redirects for SPA routing**

```
/* /index.html 200
```

- [ ] **Step 2: Test production build**

```bash
cd portal && npx vite build
```

Expected: `dist/` folder created with index.html and assets. No errors.

- [ ] **Step 3: Test preview**

```bash
cd portal && npx vite preview
```

Expected: Production build serves correctly at localhost:4173.

- [ ] **Step 4: Commit**

```bash
git add portal/public/_redirects
git commit -m "feat: add SPA redirect and verify production build"
```

---

## Task 7: Electron Launcher — Config and Chrome Monitor

**Files:**
- Create: `launcher/package.json`
- Create: `launcher/src/config.js`
- Create: `launcher/src/monitor.js`

- [ ] **Step 1: Create launcher/package.json**

```json
{
  "name": "wcs-portal-launcher",
  "version": "1.0.0",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  }
}
```

- [ ] **Step 2: Install Electron dependencies**

```bash
cd launcher && npm install
```

- [ ] **Step 3: Create launcher/src/config.js**

```js
const path = require('path')

module.exports = {
  CHROME_PATH: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  PORTAL_URL: process.env.WCS_PORTAL_URL || 'https://wcs-portal.westcoaststrength.com',
  MONITOR_INTERVAL_MS: 5000,
  IDLE_TIMEOUT_MS: 10 * 60 * 1000,
  RELAUNCH_DELAY_MS: 2000
}
```

- [ ] **Step 4: Create launcher/src/monitor.js**

```js
const { exec } = require('child_process')
const { CHROME_PATH, PORTAL_URL, MONITOR_INTERVAL_MS } = require('./config')

let monitoring = false

function isRunning(callback) {
  exec('tasklist /FI "IMAGENAME eq chrome.exe" /NH', (err, stdout) => {
    callback(!err && stdout.includes('chrome.exe'))
  })
}

function launchChrome() {
  exec(`"${CHROME_PATH}" --start-maximized "${PORTAL_URL}"`, (err) => {
    if (err) console.error('Failed to launch Chrome:', err.message)
  })
}

function killChrome() {
  return new Promise((resolve) => {
    exec('taskkill /IM chrome.exe /F', () => resolve())
  })
}

function startMonitor() {
  if (monitoring) return
  monitoring = true

  // Check immediately on start
  isRunning((running) => {
    if (!running) launchChrome()
  })

  setInterval(() => {
    isRunning((running) => {
      if (!running) launchChrome()
    })
  }, MONITOR_INTERVAL_MS)
}

function stopMonitor() {
  monitoring = false
}

module.exports = { startMonitor, stopMonitor, launchChrome, killChrome, isRunning }
```

- [ ] **Step 5: Commit**

```bash
git add launcher/package.json launcher/src/config.js launcher/src/monitor.js
git commit -m "feat: add Electron launcher config and Chrome process monitor"
```

---

## Task 8: Electron Launcher — Idle Detection

**Files:**
- Create: `launcher/src/idle.js`

- [ ] **Step 1: Create launcher/src/idle.js**

```js
const { powerMonitor } = require('electron')
const { IDLE_TIMEOUT_MS, RELAUNCH_DELAY_MS } = require('./config')
const { killChrome, launchChrome } = require('./monitor')

let idleCheckInterval = null

function startIdleDetection() {
  if (idleCheckInterval) return

  const idleThresholdSec = Math.floor(IDLE_TIMEOUT_MS / 1000)

  idleCheckInterval = setInterval(() => {
    const idleTime = powerMonitor.getSystemIdleTime()
    if (idleTime >= idleThresholdSec) {
      console.log(`Idle for ${idleTime}s — resetting Chrome`)
      resetChrome()
    }
  }, 30000) // Check every 30 seconds
}

async function resetChrome() {
  await killChrome()
  setTimeout(() => launchChrome(), RELAUNCH_DELAY_MS)
}

function stopIdleDetection() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval)
    idleCheckInterval = null
  }
}

module.exports = { startIdleDetection, stopIdleDetection }
```

- [ ] **Step 2: Commit**

```bash
git add launcher/src/idle.js
git commit -m "feat: add system idle detection with Chrome reset"
```

---

## Task 9: Electron Launcher — Main Process and System Tray

**Files:**
- Create: `launcher/src/main.js`
- Create: `launcher/assets/tray-icon.png`
- Create: `launcher/electron-builder.yml`

- [ ] **Step 1: Create launcher/assets/tray-icon.png**

Create a 16x16 placeholder PNG. For now, use a simple script:

```bash
cd launcher/assets
# Create a minimal 16x16 red PNG as placeholder
node -e "
const fs = require('fs');
// Minimal 16x16 red PNG
const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVQ4T2P8z8BQz0BAwMDAwMjIyMDAwIBLnIGBgQEOGEYNGBYGAACbygQR/qlkzQAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync('tray-icon.png', buf);
"
```

- [ ] **Step 2: Create launcher/src/main.js**

```js
const { app, Tray, Menu, dialog } = require('electron')
const path = require('path')
const { startMonitor } = require('./monitor')
const { startIdleDetection } = require('./idle')
const { launchChrome, killChrome } = require('./monitor')
const { RELAUNCH_DELAY_MS } = require('./config')

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let tray = null

app.on('ready', () => {
  // Hide dock icon (we're a tray-only app)
  if (app.dock) app.dock.hide()

  // Register Windows startup
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  })

  // Create system tray
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png')
  tray = new Tray(iconPath)
  tray.setToolTip('WCS Portal Launcher')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Restart Portal',
      click: async () => {
        await killChrome()
        setTimeout(() => launchChrome(), RELAUNCH_DELAY_MS)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Launcher (Admin)',
      click: () => {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Quit WCS Launcher',
          message: 'Are you sure you want to quit the WCS Portal Launcher?\n\nChrome will no longer auto-relaunch.',
          buttons: ['Cancel', 'Quit'],
          defaultId: 0
        })
        if (choice === 1) {
          app.quit()
        }
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // Start monitoring and idle detection
  startMonitor()
  startIdleDetection()

  console.log('WCS Portal Launcher started')
})

app.on('window-all-closed', (e) => {
  // Prevent app from quitting when no windows (we're tray-only)
  e.preventDefault()
})
```

- [ ] **Step 3: Create launcher/electron-builder.yml**

```yaml
appId: com.westcoaststrength.portal-launcher
productName: WCS Portal Launcher
directories:
  output: dist

win:
  target: nsis
  icon: assets/tray-icon.png

nsis:
  oneClick: true
  perMachine: true
  allowToChangeInstallationDirectory: false
  installerIcon: assets/tray-icon.png
```

- [ ] **Step 4: Verify Electron starts**

```bash
cd launcher && npx electron .
```

Expected: No visible window. Tray icon appears in system tray. Chrome launches to portal URL (will show connection error if portal isn't deployed yet — that's fine). Right-click tray shows "Restart Portal" and "Quit Launcher (Admin)".

- [ ] **Step 5: Commit**

```bash
git add launcher/src/main.js launcher/assets/tray-icon.png launcher/electron-builder.yml
git commit -m "feat: add Electron main process with tray menu and auto-startup"
```

---

## Task 10: PowerShell — Chrome Lockdown Script

**Files:**
- Create: `scripts/chrome-lockdown.ps1`

- [ ] **Step 1: Create scripts/chrome-lockdown.ps1**

```powershell
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Chrome Lockdown Policy Script
.DESCRIPTION
    Writes Chrome enterprise policies to the Windows Registry.
    Idempotent — safe to run multiple times on the same machine.
    Push via Action1 RMM to all machines tagged 'WCS-Kiosk'.
.NOTES
    Uses HKLM so policies apply to ALL Windows users on the machine.
#>

$ErrorActionPreference = 'Stop'

$chromePolicyRoot = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$portalURL = 'https://wcs-portal.westcoaststrength.com'

# ---- Ensure base registry path exists ----
function Ensure-RegistryPath {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
        Write-Host "Created: $Path"
    }
}

Ensure-RegistryPath $chromePolicyRoot

# ---- Core Policies ----

# Force sign-in required
Set-ItemProperty -Path $chromePolicyRoot -Name 'BrowserSignin' -Value 2 -Type DWord
Write-Host "Set BrowserSignin = 2 (force sign-in)"

# Only WCS Google accounts allowed
Set-ItemProperty -Path $chromePolicyRoot -Name 'RestrictSigninToPattern' -Value '*@westcoaststrength.com' -Type String
Write-Host "Set RestrictSigninToPattern = *@westcoaststrength.com"

# Cannot add new Chrome profiles
Set-ItemProperty -Path $chromePolicyRoot -Name 'BrowserAddPersonEnabled' -Value 0 -Type DWord
Write-Host "Set BrowserAddPersonEnabled = 0"

# Guest mode disabled
Set-ItemProperty -Path $chromePolicyRoot -Name 'BrowserGuestModeEnabled' -Value 0 -Type DWord
Write-Host "Set BrowserGuestModeEnabled = 0"

# Sync disabled
Set-ItemProperty -Path $chromePolicyRoot -Name 'SyncDisabled' -Value 1 -Type DWord
Write-Host "Set SyncDisabled = 1"

# Wipe all browsing data when Chrome closes
Set-ItemProperty -Path $chromePolicyRoot -Name 'ClearBrowsingDataOnExit' -Value 1 -Type DWord
Write-Host "Set ClearBrowsingDataOnExit = 1"

# Disable password manager
Set-ItemProperty -Path $chromePolicyRoot -Name 'PasswordManagerEnabled' -Value 0 -Type DWord
Write-Host "Set PasswordManagerEnabled = 0"

# Disable autofill
Set-ItemProperty -Path $chromePolicyRoot -Name 'AutofillAddressEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $chromePolicyRoot -Name 'AutofillCreditCardEnabled' -Value 0 -Type DWord
Write-Host "Disabled autofill (address + credit card)"

# Disable incognito
Set-ItemProperty -Path $chromePolicyRoot -Name 'IncognitoModeAvailability' -Value 1 -Type DWord
Write-Host "Set IncognitoModeAvailability = 1 (disabled)"

# Always restore portal on startup (4 = open list of URLs)
Set-ItemProperty -Path $chromePolicyRoot -Name 'RestoreOnStartup' -Value 4 -Type DWord
Write-Host "Set RestoreOnStartup = 4"

# ---- Startup URLs ----
$startupPath = "$chromePolicyRoot\RestoreOnStartupURLs"
Ensure-RegistryPath $startupPath
Set-ItemProperty -Path $startupPath -Name '1' -Value $portalURL -Type String
Write-Host "Set RestoreOnStartupURLs = $portalURL"

# ---- Pinned Tabs ----
$pinnedPath = "$chromePolicyRoot\PinnedTabs"
Ensure-RegistryPath $pinnedPath
Set-ItemProperty -Path $pinnedPath -Name '1' -Value $portalURL -Type String
Write-Host "Set PinnedTabs = $portalURL"

# ---- URL Blocklist (block everything by default) ----
$blockPath = "$chromePolicyRoot\URLBlocklist"
Ensure-RegistryPath $blockPath
Set-ItemProperty -Path $blockPath -Name '1' -Value '*' -Type String
Write-Host "Set URLBlocklist = * (block all)"

# ---- URL Allowlist (only approved sites) ----
$allowPath = "$chromePolicyRoot\URLAllowlist"
Ensure-RegistryPath $allowPath

$allowedURLs = @(
    'wcs-portal.westcoaststrength.com',
    'app.gohighlevel.com',
    'mail.google.com',
    'drive.google.com',
    'docs.google.com',
    'wcs-mmp-portal.onrender.com'
)

for ($i = 0; $i -lt $allowedURLs.Count; $i++) {
    $name = ($i + 1).ToString()
    Set-ItemProperty -Path $allowPath -Name $name -Value $allowedURLs[$i] -Type String
    Write-Host "Set URLAllowlist\$name = $($allowedURLs[$i])"
}

Write-Host "`n=== Chrome lockdown policies applied successfully ==="
Write-Host "Restart Chrome for policies to take effect."
```

- [ ] **Step 2: Commit**

```bash
git add scripts/chrome-lockdown.ps1
git commit -m "feat: add Chrome lockdown PowerShell script for Action1 deployment"
```

---

## Task 11: PowerShell — Nightly Cleanup Script

**Files:**
- Create: `scripts/nightly-cleanup.ps1`

- [ ] **Step 1: Create scripts/nightly-cleanup.ps1**

```powershell
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WCS Nightly Chrome Profile Cleanup
.DESCRIPTION
    Removes Chrome user profiles created outside the Default/kiosk profile.
    Schedule in Action1 as a recurring task at 2:00 AM across all 'WCS-Kiosk' machines.
    Safe to run even if no extra profiles exist.
#>

$ErrorActionPreference = 'Stop'

$profileRoot = 'C:\Users\Staff\AppData\Local\Google\Chrome\User Data'

if (-not (Test-Path $profileRoot)) {
    Write-Host "Chrome user data directory not found at $profileRoot — skipping cleanup."
    exit 0
}

# Profiles to preserve (Chrome system profiles + kiosk default)
$preservePattern = '^(Default|System Profile|Guest Profile|Crashpad|Safe Browsing|ShaderCache|GrShaderCache|BrowserMetrics|Crowd Deny|MEIPreload|SSLErrorAssistant|CertificateRevocation|FileTypePolicies|OriginTrials|ZxcvbnData|hyphen-data|WidevineCdm)$'

$removed = 0
Get-ChildItem -Path $profileRoot -Directory |
    Where-Object { $_.Name -notmatch $preservePattern } |
    Where-Object { $_.Name -match '^Profile' } |
    ForEach-Object {
        Write-Host "Removing profile: $($_.Name)"
        Remove-Item -Path $_.FullName -Recurse -Force
        $removed++
    }

if ($removed -eq 0) {
    Write-Host "No extra Chrome profiles found. Nothing to clean."
} else {
    Write-Host "Removed $removed Chrome profile(s)."
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/nightly-cleanup.ps1
git commit -m "feat: add nightly Chrome profile cleanup script"
```

---

## Task 12: Scripts README and Project README

**Files:**
- Create: `scripts/README.md`
- Create: `README.md`

- [ ] **Step 1: Create scripts/README.md**

```markdown
# WCS Action1 Deployment Scripts

## chrome-lockdown.ps1

Writes Chrome enterprise policies to Windows Registry. Locks down browsing to approved URLs only, disables password saving, forces WCS account sign-in, and wipes sessions on Chrome close.

**How to deploy via Action1:**
1. In Action1 dashboard, go to Scripts > New Script
2. Paste contents of `chrome-lockdown.ps1`
3. Set target: All machines tagged `WCS-Kiosk`
4. Run as: SYSTEM (requires admin)
5. Execute immediately or schedule

**Re-run anytime** to update policies (script is idempotent).

## nightly-cleanup.ps1

Removes extra Chrome profiles (e.g., "Profile 1", "Profile 2") created by staff sign-ins during the day. The Default kiosk profile is preserved.

**How to schedule via Action1:**
1. In Action1 dashboard, go to Scripts > New Script
2. Paste contents of `nightly-cleanup.ps1`
3. Set target: All machines tagged `WCS-Kiosk`
4. Schedule: Recurring, daily at 2:00 AM
5. Run as: SYSTEM
```

- [ ] **Step 2: Create README.md (root)**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add scripts/README.md README.md
git commit -m "docs: add project README and Action1 deployment instructions"
```

---

## Deployment Checklist (Post-Build, Manual)

These are not code tasks — they are operator steps after the build is complete:

1. Replace placeholder URLs in `portal/src/config/tools.json` (ABC Financial, Day One Training)
2. Replace `wcs-logo.svg` with actual WCS logo file
3. Replace `tray-icon.png` with actual WCS icon (16x16 and 256x256 for installer)
4. Set `WCS_PORTAL_URL` env var if not using default domain
5. Deploy portal to Render as static site (build command: `cd portal && npm run build`, publish dir: `portal/dist`)
6. Build Electron installer: `cd launcher && npm run build`
7. Push `chrome-lockdown.ps1` via Action1 to all WCS-Kiosk machines
8. Schedule `nightly-cleanup.ps1` via Action1 at 2:00 AM daily
9. Google Admin Console: create kiosk accounts, disable Gmail for Kiosk Accounts OU
10. Optional: Enroll machines in Chrome Browser Cloud Management (CBCM)
