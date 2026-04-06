# WCS Electron Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom Electron browser ("WCS App") that replaces Chrome for work tasks — with built-in ABC Financial member scraping, onboarding overlay, and tabbed navigation for all WCS tools.

**Architecture:** Electron app with a BrowserView-based tabbed interface. The main window has a tab bar at the top and a BrowserView for each tab. Because Electron's BrowserViews share the same Chromium session, we get same-origin access to all pages and can inject scripts directly into ABC Financial's DOM — no extension or proxy needed. A preload script on the ABC tab scrapes member data and detects signup completion, triggering the onboarding overlay.

**Tech Stack:** Electron 33+, electron-builder (Windows NSIS installer), vanilla JS for preload scripts, existing welcome.html for onboarding overlay

---

## File Structure

```
launcher/
├── src/
│   ├── main.js              # Electron main process — window, tray, tabs, overlay
│   ├── tabs.js              # Tab management — create, switch, close, tab bar state
│   ├── abc-scraper.js       # Preload script injected into ABC tab — scrapes member data
│   ├── widget-fill.js       # Preload script for GHL widgets — phone autofill, UI cleanup
│   ├── config.js            # Constants — portal URL, tool URLs, locations
│   ├── overlay.js           # Overlay window management — show/close welcome page
│   └── tray.js              # System tray icon and context menu
├── ui/
│   ├── tabbar.html          # Tab bar UI (top of window)
│   ├── tabbar.css           # Tab bar styles (reporting theme)
│   └── tabbar.js            # Tab bar click handlers, IPC with main process
├── assets/
│   └── tray-icon.png        # Tray icon
├── package.json
└── electron-builder.yml
```

The portal (React app on Render) remains the home tab. `welcome.html` is loaded from Render. The Electron app is purely the browser shell + ABC scraping logic.

---

### Task 1: Electron Shell with BrowserWindow

**Files:**
- Modify: `launcher/package.json`
- Create: `launcher/src/main.js`
- Create: `launcher/src/config.js`

- [ ] **Step 1: Update launcher/package.json**

```json
{
  "name": "wcs-app",
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

- [ ] **Step 2: Create launcher/src/config.js**

```js
const path = require('path')
const fs = require('fs')

const WCS_DIR = 'C:\\WCS'
const ABC_URL_FILE = path.join(WCS_DIR, 'abc-url.txt')

function getAbcUrl() {
  try {
    if (fs.existsSync(ABC_URL_FILE)) {
      return fs.readFileSync(ABC_URL_FILE, 'utf8').trim()
    }
  } catch (e) {}
  return ''
}

function getLocationFromArgs() {
  const arg = process.argv.find(a => a.startsWith('--location='))
  return arg ? arg.split('=')[1] : 'Salem'
}

module.exports = {
  PORTAL_URL: process.env.WCS_PORTAL_URL || 'https://wcs-staff-portal.onrender.com',
  getAbcUrl,
  getLocation: getLocationFromArgs,
  TOOLS: {
    grow: 'https://app.gohighlevel.com',
    wheniwork: 'https://app.wheniwork.com',
    paychex: 'https://myapps.paychex.com',
  },
  LOCATIONS: {
    Salem: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
    Springfield: { booking: 'https://api.westcoaststrength.com/widget/booking/PEyaqnkjmBN5tLpo6I9F', vip: 'https://api.westcoaststrength.com/widget/survey/uM48yWzOBhXhUBsG1fhW' },
    Eugene: { booking: 'https://api.westcoaststrength.com/widget/booking/0c9CNdZ65NainMcStWXo', vip: 'https://api.westcoaststrength.com/widget/survey/xKYTE6V7QXKVpkUfWTFi' },
    Keizer: { booking: 'https://api.westcoaststrength.com/widget/booking/8qFo1GnePy0mCgV9avWW', vip: 'https://api.westcoaststrength.com/widget/survey/HXB00WKKe6srvgSmfwI7' },
    Clackamas: { booking: 'https://api.westcoaststrength.com/widget/booking/yOvDLsZMAboTVjv9c2HC', vip: 'https://api.westcoaststrength.com/widget/survey/Z9zEHwjGfQaMIYy9OueF' },
    Milwaukie: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
    Medford: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
  },
  WCS_DIR,
  ABC_URL_FILE,
}
```

- [ ] **Step 3: Create launcher/src/main.js (minimal — just opens a window to portal)**

```js
const { app, BrowserWindow } = require('electron')
const { PORTAL_URL, getLocation } = require('./config')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainWindow = null

app.on('ready', () => {
  const location = getLocation()
  const portalUrl = `${PORTAL_URL}?location=${location}`

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'WCS Staff Portal',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(portalUrl)
  mainWindow.maximize()
})

app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 4: Run `cd launcher && npm install`**

- [ ] **Step 5: Verify it launches: `cd launcher && npx electron . --location=Salem`**

Expected: Window opens maximized showing the portal from Render.

- [ ] **Step 6: Commit**

```bash
git add launcher/
git commit -m "feat: Electron shell — opens portal in a BrowserWindow"
```

---

### Task 2: Tab Bar UI

**Files:**
- Create: `launcher/ui/tabbar.html`
- Create: `launcher/ui/tabbar.css`
- Create: `launcher/ui/tabbar.js`

- [ ] **Step 1: Create launcher/ui/tabbar.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="tabbar.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body>
  <div id="tabbar">
    <div id="tabs"></div>
  </div>
  <script src="tabbar.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create launcher/ui/tabbar.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; font-family: 'Inter', sans-serif; background: #1a1a2e; }

#tabbar {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 8px;
  background: #1a1a2e;
  -webkit-app-region: drag;
}

#tabs {
  display: flex;
  gap: 2px;
  height: 100%;
  align-items: flex-end;
  -webkit-app-region: no-drag;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.6);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.15s;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); }
.tab.active { background: #f4f5f7; color: #1a1a2e; }

.tab-close {
  font-size: 14px;
  opacity: 0;
  cursor: pointer;
  margin-left: 4px;
  line-height: 1;
}
.tab:hover .tab-close { opacity: 0.5; }
.tab-close:hover { opacity: 1; }
```

- [ ] **Step 3: Create launcher/ui/tabbar.js**

```js
const { ipcRenderer } = require('electron')

const tabsContainer = document.getElementById('tabs')

ipcRenderer.on('tabs-updated', (event, tabs) => {
  tabsContainer.innerHTML = ''
  tabs.forEach(tab => {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.active ? ' active' : '')
    el.innerHTML = `<span>${tab.title}</span>` +
      (tab.closable ? `<span class="tab-close" data-id="${tab.id}">×</span>` : '')
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        ipcRenderer.send('close-tab', tab.id)
      } else {
        ipcRenderer.send('switch-tab', tab.id)
      }
    })
    tabsContainer.appendChild(el)
  })
})

ipcRenderer.send('tabs-ready')
```

- [ ] **Step 4: Commit**

```bash
git add launcher/ui/
git commit -m "feat: tab bar UI with Inter font and dark navy theme"
```

---

### Task 3: Tab Management in Main Process

**Files:**
- Create: `launcher/src/tabs.js`
- Modify: `launcher/src/main.js`

- [ ] **Step 1: Create launcher/src/tabs.js**

```js
const { BrowserView, BrowserWindow } = require('electron')
const path = require('path')

class TabManager {
  constructor(parentWindow, tabBarHeight) {
    this.window = parentWindow
    this.tabBarHeight = tabBarHeight
    this.tabs = new Map() // id -> { view, title, closable }
    this.activeTabId = null
    this.nextId = 1
    this.tabBarView = null
  }

  initTabBar() {
    this.tabBarView = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'ui', 'tabbar-preload.js'),
        contextIsolation: false,
        nodeIntegration: true,
      },
    })
    this.window.addBrowserView(this.tabBarView)
    this.tabBarView.webContents.loadFile(path.join(__dirname, '..', 'ui', 'tabbar.html'))
    this.layoutViews()
  }

  createTab(url, title, options = {}) {
    const id = this.nextId++
    const closable = options.closable !== false
    const preload = options.preload || undefined

    const view = new BrowserView({
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    })

    view.webContents.loadURL(url)

    // Update tab title from page
    view.webContents.on('page-title-updated', (e, pageTitle) => {
      const tab = this.tabs.get(id)
      if (tab) {
        tab.title = pageTitle.substring(0, 30)
        this.notifyTabBar()
      }
    })

    this.tabs.set(id, { view, title, closable, id })
    this.switchTo(id)
    return id
  }

  switchTo(id) {
    const tab = this.tabs.get(id)
    if (!tab) return

    // Hide current
    if (this.activeTabId !== null) {
      const current = this.tabs.get(this.activeTabId)
      if (current) this.window.removeBrowserView(current.view)
    }

    this.activeTabId = id
    this.window.addBrowserView(tab.view)
    this.layoutViews()
    this.notifyTabBar()
  }

  closeTab(id) {
    const tab = this.tabs.get(id)
    if (!tab || !tab.closable) return

    this.window.removeBrowserView(tab.view)
    tab.view.webContents.destroy()
    this.tabs.delete(id)

    // Switch to last remaining tab
    if (this.activeTabId === id) {
      const ids = [...this.tabs.keys()]
      if (ids.length > 0) this.switchTo(ids[ids.length - 1])
    }
    this.notifyTabBar()
  }

  layoutViews() {
    const bounds = this.window.getContentBounds()
    const width = bounds.width
    const height = bounds.height

    if (this.tabBarView) {
      this.tabBarView.setBounds({ x: 0, y: 0, width, height: this.tabBarHeight })
    }

    const tab = this.tabs.get(this.activeTabId)
    if (tab) {
      tab.view.setBounds({ x: 0, y: this.tabBarHeight, width, height: height - this.tabBarHeight })
    }
  }

  notifyTabBar() {
    if (!this.tabBarView) return
    const tabData = [...this.tabs.values()].map(t => ({
      id: t.id,
      title: t.title,
      closable: t.closable,
      active: t.id === this.activeTabId,
    }))
    this.tabBarView.webContents.send('tabs-updated', tabData)
  }

  getActiveView() {
    const tab = this.tabs.get(this.activeTabId)
    return tab ? tab.view : null
  }
}

module.exports = TabManager
```

- [ ] **Step 2: Create launcher/ui/tabbar-preload.js (allows IPC in tabbar)**

This file just exists so the tabbar.html can use ipcRenderer. Create `launcher/ui/tabbar-preload.js`:

```js
// No-op — nodeIntegration is true for tabbar, this file exists for clarity
```

- [ ] **Step 3: Rewrite launcher/src/main.js to use TabManager**

```js
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { PORTAL_URL, getAbcUrl, getLocation, TOOLS } = require('./config')
const TabManager = require('./tabs')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

const TAB_BAR_HEIGHT = 40
let mainWindow = null
let tabManager = null

app.on('ready', () => {
  const location = getLocation()
  const abcUrl = getAbcUrl()
  const portalUrl = `${PORTAL_URL}?location=${location}` + (abcUrl ? `&abc_url=${encodeURIComponent(abcUrl)}` : '')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'WCS App',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
  })

  mainWindow.maximize()

  tabManager = new TabManager(mainWindow, TAB_BAR_HEIGHT)
  tabManager.initTabBar()

  // Home tab (portal) — not closable
  tabManager.createTab(portalUrl, 'Portal', { closable: false })

  // Handle tab IPC
  ipcMain.on('switch-tab', (e, id) => tabManager.switchTo(id))
  ipcMain.on('close-tab', (e, id) => tabManager.closeTab(id))
  ipcMain.on('tabs-ready', () => tabManager.notifyTabBar())

  // Handle tool opens from portal via new-window events or IPC
  // Portal links with target="_blank" trigger this
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' }
  })

  // Listen for navigation from any tab opening a new window
  app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      // Open known tools as tabs
      if (url.includes('gohighlevel.com')) {
        tabManager.createTab(url, 'Grow')
      } else if (url.includes('wheniwork.com')) {
        tabManager.createTab(url, 'WhenIWork')
      } else if (url.includes('paychex.com')) {
        tabManager.createTab(url, 'Paychex')
      } else if (url.includes('kiosk.html') || url.includes('abcfinancial.com')) {
        const abcPageUrl = abcUrl || 'about:blank'
        tabManager.createTab(abcPageUrl, 'ABC Financial', {
          preload: path.join(__dirname, 'abc-scraper.js'),
        })
      } else {
        // Open unknown URLs as tabs too
        tabManager.createTab(url, 'Loading...')
      }
      return { action: 'deny' }
    })
  })

  mainWindow.on('resize', () => tabManager.layoutViews())
})

app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 4: Verify: `cd launcher && npx electron . --location=Salem`**

Expected: Window opens with a navy tab bar at top showing "Portal" tab. Portal loads below it.

- [ ] **Step 5: Commit**

```bash
git add launcher/
git commit -m "feat: tab manager with BrowserView-based tabs"
```

---

### Task 4: ABC Scraper Preload Script

**Files:**
- Create: `launcher/src/abc-scraper.js`

- [ ] **Step 1: Create launcher/src/abc-scraper.js**

This preload script runs in the ABC Financial tab. It has access to the page DOM because Electron preload scripts run in the renderer context.

```js
// ABC Financial member data scraper — runs as Electron preload script
// Has full DOM access (same-origin not an issue in Electron)

const { ipcRenderer } = require('electron')

let memberData = {}

const fieldSelectors = {
  firstName:   ['#firstName', '[name="personalSection.firstName.value"]'],
  lastName:    ['#lastName',  '[name="personalSection.lastName.value"]'],
  email:       ['#email', '#emailAddress', '[name="personalSection.email.value"]', '[name="personalSection.emailAddress.value"]'],
  phone:       ['#cellNumber', '#homeNumber', '#homePhone', '#phone',
                '[name="personalSection.cellNumber.value"]',
                '[name="personalSection.homeNumber.value"]',
                '[name="personalSection.homePhone.value"]'],
  salesperson: ['#salesPersonIdInput', '[name="agreementSection.salesPersonName"]'],
}

function getDoc() {
  try {
    const mainFrame = document.querySelector('#main')
    if (mainFrame && mainFrame.contentDocument && mainFrame.contentDocument.body) {
      return mainFrame.contentDocument
    }
  } catch(e) {}
  return document
}

function scrapeAll() {
  const doc = getDoc()
  let changed = false
  Object.entries(fieldSelectors).forEach(([key, selectors]) => {
    for (const sel of selectors) {
      try {
        const el = doc.querySelector(sel)
        if (el && el.value && el.value.trim().length > 1) {
          const newVal = el.value.trim()
          const oldVal = memberData[key] || ''
          if (newVal.length >= oldVal.length && newVal !== oldVal) {
            memberData[key] = newVal
            changed = true
          }
          break
        }
      } catch(e) {}
    }
  })

  if (changed && Object.keys(memberData).length > 0) {
    ipcRenderer.send('abc-member-data', { ...memberData })
  }
}

// Watch #main iframe for confirmation page
function watchMainFrame() {
  const mainFrame = document.querySelector('#main')
  if (!mainFrame || mainFrame._wcsWatching) return
  mainFrame._wcsWatching = true
  mainFrame.addEventListener('load', () => {
    try {
      const url = mainFrame.contentDocument && mainFrame.contentDocument.location.href
      if (url && url.includes('StandAloneAgreementPdfCommand.pml')) {
        scrapeAll() // Final scrape
        ipcRenderer.send('abc-signup-detected', { ...memberData })
        memberData = {} // Reset for next signup
      }
    } catch(e) {}
  })
}

window.addEventListener('DOMContentLoaded', () => {
  setInterval(scrapeAll, 500)
  watchMainFrame()
  setInterval(watchMainFrame, 1000)
})
```

- [ ] **Step 2: Commit**

```bash
git add launcher/src/abc-scraper.js
git commit -m "feat: ABC Financial preload scraper — extracts member data and detects signup"
```

---

### Task 5: Onboarding Overlay

**Files:**
- Create: `launcher/src/overlay.js`
- Modify: `launcher/src/main.js`

- [ ] **Step 1: Create launcher/src/overlay.js**

```js
const { BrowserWindow } = require('electron')
const { PORTAL_URL, getLocation, LOCATIONS } = require('./config')

let overlayWindow = null

function showOverlay(memberData) {
  if (overlayWindow) {
    overlayWindow.focus()
    return
  }

  const location = getLocation()
  const welcomeUrl = new URL(`${PORTAL_URL}/welcome.html`)
  if (memberData.firstName)   welcomeUrl.searchParams.set('firstName', memberData.firstName)
  if (memberData.lastName)    welcomeUrl.searchParams.set('lastName', memberData.lastName)
  if (memberData.email)       welcomeUrl.searchParams.set('email', memberData.email)
  if (memberData.phone)       welcomeUrl.searchParams.set('phone', memberData.phone)
  if (memberData.salesperson) welcomeUrl.searchParams.set('salesperson', memberData.salesperson)
  welcomeUrl.searchParams.set('location', location)

  overlayWindow = new BrowserWindow({
    width: 860,
    height: 620,
    title: 'WCS — Next Steps',
    autoHideMenuBar: true,
    resizable: false,
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  overlayWindow.loadURL(welcomeUrl.toString())

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function closeOverlay() {
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }
}

module.exports = { showOverlay, closeOverlay }
```

- [ ] **Step 2: Add IPC handlers to launcher/src/main.js**

Add these lines after the `ipcMain.on('tabs-ready', ...)` block in main.js:

```js
const { showOverlay, closeOverlay } = require('./overlay')

// ABC scraper IPC
let latestMemberData = {}

ipcMain.on('abc-member-data', (e, data) => {
  latestMemberData = data
})

ipcMain.on('abc-signup-detected', (e, data) => {
  latestMemberData = { ...latestMemberData, ...data }
  showOverlay(latestMemberData)
  latestMemberData = {}
})
```

- [ ] **Step 3: Commit**

```bash
git add launcher/src/overlay.js launcher/src/main.js
git commit -m "feat: onboarding overlay — opens welcome.html with member data on signup detection"
```

---

### Task 6: System Tray

**Files:**
- Create: `launcher/src/tray.js`
- Modify: `launcher/src/main.js`

- [ ] **Step 1: Create launcher/src/tray.js**

```js
const { Tray, Menu, dialog, app } = require('electron')
const path = require('path')

let tray = null

function createTray(mainWindow) {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png')
  tray = new Tray(iconPath)
  tray.setToolTip('WCS App')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show WCS App',
      click: () => { mainWindow.show(); mainWindow.focus() },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Quit WCS App',
          message: 'Are you sure you want to quit?',
          buttons: ['Cancel', 'Quit'],
          defaultId: 0,
        })
        if (choice === 1) app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => { mainWindow.show(); mainWindow.focus() })

  return tray
}

module.exports = { createTray }
```

- [ ] **Step 2: Add to main.js — after `mainWindow.maximize()`:**

```js
const { createTray } = require('./tray')
createTray(mainWindow)
```

- [ ] **Step 3: Commit**

```bash
git add launcher/src/tray.js launcher/src/main.js
git commit -m "feat: system tray with show/quit menu"
```

---

### Task 7: Electron Builder Config + Auto-Startup

**Files:**
- Modify: `launcher/electron-builder.yml`
- Modify: `launcher/src/main.js`

- [ ] **Step 1: Update launcher/electron-builder.yml**

```yaml
appId: com.westcoaststrength.wcs-app
productName: WCS App
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

- [ ] **Step 2: Add auto-startup to main.js in the `app.on('ready', ...)` handler:**

```js
app.setLoginItemSettings({
  openAtLogin: true,
  path: app.getPath('exe'),
})
```

- [ ] **Step 3: Commit**

```bash
git add launcher/electron-builder.yml launcher/src/main.js
git commit -m "feat: electron-builder NSIS installer + Windows auto-startup"
```

---

### Task 8: Update Action1 Setup Script

**Files:**
- Modify: `scripts/setup-kiosk.ps1`

- [ ] **Step 1: Add WCS App installer download + run to setup-kiosk.ps1**

Add after the extension download section, before Chrome policies:

```powershell
# ============================================================
# INSTALL WCS APP (Electron browser)
# ============================================================
$wcsAppInstaller = "$env:TEMP\WCS-App-Setup.exe"
$wcsAppUrl = 'https://github.com/justinhuttinger/wcs-staff-portal/releases/latest/download/WCS-App-Setup.exe'

Write-Host "Downloading WCS App installer..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
    Invoke-WebRequest -Uri $wcsAppUrl -OutFile $wcsAppInstaller -UseBasicParsing
    Start-Process -FilePath $wcsAppInstaller -ArgumentList '/S' -Wait
    Write-Host "WCS App installed"
    Remove-Item -Path $wcsAppInstaller -Force -ErrorAction SilentlyContinue
} catch {
    Write-Host "WARNING: Could not download WCS App. Install manually."
}
```

- [ ] **Step 2: Update the Staff logon script to launch WCS App instead of Chrome for portal**

Replace the Chrome launch line in the Staff logon script section with:

```powershell
# Launch WCS App
`$wcsApp = 'C:\Program Files\WCS App\WCS App.exe'
if (Test-Path `$wcsApp) {
    Start-Process -FilePath `$wcsApp -ArgumentList "--location=$LocationName"
} else {
    # Fallback to Chrome
    Start-Process -FilePath '$chromePath' -ArgumentList "--start-maximized `$portalURL"
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-kiosk.ps1
git commit -m "feat: setup script installs WCS App, Staff logon launches it"
```

---

## Deployment Checklist (Post-Build)

After all tasks are complete:

1. Build the installer: `cd launcher && npm run build`
2. Create a GitHub Release and upload `dist/WCS App Setup.exe`
3. Push updated `setup-kiosk.ps1` via Action1
4. Test: Staff login → WCS App opens → Portal loads → Click ABC → ABC opens in tab → Complete a signup → Overlay appears with member data
5. Verify: Chrome still works separately for personal Gmail/Drive (locked down)
