const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { autoUpdater } = require('electron-updater')
const { appendLog: log } = require('./paths')

app.setName('Portal')
// Windows notification grouping — no-op on macOS / Linux.
if (process.platform === 'win32') app.setAppUserModelId('Portal')
log('=== APP STARTING === platform=' + process.platform + ' version=' + app.getVersion())
const { PORTAL_URL, getAbcUrl, getLocation, readConfig, writeConfig } = require('./config')
const { LOCATIONS } = require('./locations')
const TabManager = require('./tabs')
const { showOverlay, closeOverlay, onResize: onOverlayResize } = require('./overlay')
const { createTray } = require('./tray')
const auth = require('./auth')
const versionCheck = require('./version-check')

// First-launch location picker. Resolves with the saved config once
// the user picks. If they close the window without picking, quits.
//
// Windows kiosks deployed via the NSIS installer write config.json
// during install, so this is a no-op for them. macOS .dmg installs
// hit the picker on the first launch and skip it on subsequent ones.
function pickLocationIfNeeded() {
  const cfg = readConfig()
  if (cfg && cfg.location) return Promise.resolve(cfg)

  return new Promise((resolve) => {
    const pickerWin = new BrowserWindow({
      width: 480,
      height: 540,
      title: 'Choose Your Location',
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'location-picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    pickerWin.loadFile(path.join(__dirname, '..', 'ui', 'location-picker.html'))

    let picked = false

    ipcMain.handleOnce('location-picker:get-locations', () => LOCATIONS)
    ipcMain.once('location-picker:pick', (e, name) => {
      const loc = LOCATIONS.find(l => l.name === name)
      if (!loc) return
      const newConfig = { location: loc.name, abc_url: loc.abc_url }
      writeConfig(newConfig)
      log('[location-picker] saved location=' + loc.name)
      picked = true
      pickerWin.close()
      resolve(newConfig)
    })

    pickerWin.on('closed', () => {
      if (!picked) {
        log('[location-picker] window closed without selection, quitting')
        app.quit()
      }
    })
  })
}

// --- Auto-updater setup ---
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.logger = { info: log, warn: log, error: log }

autoUpdater.on('checking-for-update', () => log('[Updater] Checking for updates...'))
autoUpdater.on('update-available', (info) => log('[Updater] Update available: v' + info.version))
autoUpdater.on('update-not-available', () => log('[Updater] App is up to date'))
autoUpdater.on('download-progress', (p) => log('[Updater] Downloading: ' + Math.round(p.percent) + '%'))
autoUpdater.on('error', (err) => log('[Updater] Error: ' + err.message))

autoUpdater.on('update-downloaded', (info) => {
  log('[Updater] Update downloaded: v' + info.version)
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: 'A new version of Portal (v' + info.version + ') has been downloaded.',
    detail: 'The app will restart to apply the update.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) {
      autoUpdater.quitAndInstall()
    }
  })
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

const TAB_BAR_HEIGHT = 52
let mainWindow = null
let tabManager = null

app.on('ready', async () => {
  // First-launch flow: prompt for location before showing the main
  // window. Windows kiosks already have config.json written by the
  // NSIS installer, so this resolves immediately. macOS .dmg
  // installs hit the picker.
  await pickLocationIfNeeded()

  const { session } = require('electron')

  // Strip X-Frame-Options on both default and persistent sessions
  const stripFrameHeaders = (details, callback) => {
    const headers = { ...details.responseHeaders }
    delete headers['x-frame-options']
    delete headers['X-Frame-Options']
    callback({ responseHeaders: headers })
  }
  session.defaultSession.webRequest.onHeadersReceived(stripFrameHeaders)

  const { session: ses } = require('electron')
  const persistSes = ses.fromPartition('persist:wcs-portal')
  persistSes.webRequest.onHeadersReceived(stripFrameHeaders)

  // BrowserWindow's `icon` option only matters on Windows / Linux —
  // macOS reads its dock icon from the packaged .icns the builder
  // emits, so we leave it unset on darwin.
  const winIcon = process.platform === 'win32'
    ? path.join(__dirname, '..', 'assets', 'icon.ico')
    : path.join(__dirname, '..', 'assets', 'icon.png')

  // Window chrome differs by platform:
  //   - Windows/Linux: fully frameless, custom in-tab-bar min/max/close buttons.
  //   - macOS: keep native traffic lights (hiddenInset overlays them on
  //     the tab bar). Going frameless on macOS hides the traffic lights
  //     entirely, which violates Mac UX expectations.
  const chrome = process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
    : { frame: false, titleBarStyle: 'hidden' }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Portal',
    icon: winIcon,
    autoHideMenuBar: true,
    ...chrome,
  })

  mainWindow.maximize()

  // When a user picks a different location from the tray's "Change
  // Location" submenu, the portal tab is reloaded with the new
  // location + abc_url so the change takes effect without restart.
  createTray(mainWindow, {
    onLocationChange: (cfg) => {
      log('[tray] location changed to ' + cfg.location)
      const portalTab = tabManager && tabManager.tabs.get(1)
      if (portalTab) {
        const newUrl = `${PORTAL_URL}?location=${cfg.location}` + (cfg.abc_url ? `&abc_url=${encodeURIComponent(cfg.abc_url)}` : '')
        portalTab.view.webContents.loadURL(newUrl)
      }
    },
  })

  // openAtLogin works on both Windows and macOS. The `path` option is
  // Windows-only — on macOS it's ignored at best, and providing
  // app.getPath('exe') points inside the app bundle which confuses
  // Login Items, so we omit it on darwin.
  const loginItem = { openAtLogin: true }
  if (process.platform === 'win32') loginItem.path = app.getPath('exe')
  app.setLoginItemSettings(loginItem)

  tabManager = new TabManager(mainWindow, TAB_BAR_HEIGHT)
  tabManager.setLogger(log)
  tabManager.initTabBar()

  // Check for updates after launch (silent background check)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => log('[Updater] Check failed: ' + err.message))
  }, 5000)

  // Force-update polling — relaunches the kiosk if its version drops below
  // the min_launcher_version pinned via the admin panel.
  versionCheck.setLogger(log)
  versionCheck.start()

  // Auth module logs through the same C:\WCS\app.log
  auth.setLogger(log)

  // Load portal tab immediately — portal handles its own login UI
  const location = getLocation()
  const abcUrl = getAbcUrl()
  const portalUrl = `${PORTAL_URL}?location=${location}` + (abcUrl ? `&abc_url=${encodeURIComponent(abcUrl)}` : '')

  tabManager.createTab(portalUrl, 'Portal', {
    closable: false,
    preload: path.join(__dirname, 'portal-preload.js'),
  })

  // Auth state bridge — portal notifies us when user logs in/out
  ipcMain.on('portal-auth-login', (e, token, userName) => {
    log('Portal auth: user logged in')
    auth.setToken(token).then(() => {
      log('Staff profile loaded, starting tour notifier')
      try {
        const tourNotifier = require('./tour-notifier')
        tourNotifier.start(() => {
          // On notification click: focus window + navigate portal to calendar
          if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
          }
          tabManager.switchTo(1)
          const portalTab = tabManager.tabs.get(1)
          if (portalTab) {
            portalTab.view.webContents.send('navigate-to', 'calendar')
          }
        })
      } catch (err) {
        log('[Tour Notifier] Failed to start: ' + err.message)
      }
    }).catch(err => {
      log('setToken failed: ' + (err?.message || err))
    })
    auth.fetchAllCredentials().then(() => {
      log('Credentials cached for session')
    }).catch(err => {
      log('Failed to cache credentials: ' + err.message)
    })
    // Send user info to tab bar
    if (tabManager?.tabBarView) {
      tabManager.tabBarView.webContents.send('user-updated', { name: userName || '' })
    }
  })

  // Synchronous version lookup for the renderer's preload bridge.
  // Uses sendSync because preload reads it once at script load time
  // (before any React render) and must be available without await.
  ipcMain.on('get-app-version', (e) => {
    e.returnValue = app.getVersion()
  })

  // Renderer refreshed its access token — sync to main so vault calls and
  // tour-notifier keep using a live token past the original 1hr expiry.
  // Does NOT restart tour-notifier or re-fetch credentials; that's only
  // for the initial login flow.
  ipcMain.on('portal-auth-token-refreshed', (e, token) => {
    if (!token) return
    auth.setToken(token).catch(err => {
      log('[Auth] Token refresh sync failed: ' + (err?.message || err))
    })
  })

  ipcMain.on('portal-auth-logout', () => {
    log('Portal auth: user logged out')
    auth.logout()
    // Stop tour notifications
    const tourNotifier = require('./tour-notifier')
    tourNotifier.stop()

    // Close all tabs except Portal
    tabManager.closeAllExceptPortal()

    // Clear all session cookies/storage so GHL etc. sessions don't persist
    const ses = require('electron').session.fromPartition('persist:wcs-portal')
    ses.clearStorageData().catch(() => {})
    ses.clearCache().catch(() => {})
    log('Session data cleared, all tabs closed')

    // Clear user from tab bar
    if (tabManager?.tabBarView) {
      tabManager.tabBarView.webContents.send('user-updated', { name: '' })
    }
  })

  // Tab bar sign-out button — tell the portal to trigger its own logout
  ipcMain.on('tabbar-signout', () => {
    const portalTab = tabManager.tabs.get(1)
    if (portalTab) {
      portalTab.view.webContents.send('trigger-signout')
    }
  })

  // Credential capture — native dialog prompt
  const SERVICE_NAMES = {
    abc: 'ABC Financial',
    ghl: 'Grow (GHL)',
    wheniwork: 'WhenIWork',
    paychex: 'Paychex',
  }

  ipcMain.on('credential-captured', async (e, { service, username, password }) => {
    if (!auth.isLoggedIn()) return

    const existing = auth.getCachedCredential(service)
    if (existing && existing.username === username && existing.password === password) return

    log('Credential captured for: ' + service)

    const serviceName = SERVICE_NAMES[service] || service
    const isUpdate = !!existing
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: [isUpdate ? 'Update' : 'Save', 'Not now'],
      defaultId: 0,
      title: isUpdate ? 'Update Login' : 'Save Login',
      message: isUpdate
        ? `Update login for ${serviceName}?`
        : `Save login for ${serviceName}?`,
      detail: isUpdate
        ? `Username: ${username}\nYour stored credentials will be updated.`
        : `Username: ${username}`,
    })

    if (response === 0) {
      try {
        await auth.storeCredential(service, username, password)
        log('Credential ' + (isUpdate ? 'updated' : 'saved') + ' for: ' + service)
      } catch (err) {
        log('Failed to save credential: ' + err.message)
      }
    }
  })

  // Tab IPC
  ipcMain.on('switch-tab', (e, id) => tabManager.switchTo(id))
  ipcMain.on('close-tab', (e, id) => tabManager.closeTab(id))
  ipcMain.on('reorder-tab', (e, dragId, dropId) => tabManager.reorderTab(dragId, dropId))
  ipcMain.on('tabs-ready', () => tabManager.notifyTabBar())

  ipcMain.on('open-in-tab', (e, url) => {
    if (tabManager.onNewWindow) tabManager.onNewWindow(url)
  })

  // Window controls
  ipcMain.on('window-refresh', () => {
    const active = tabManager.tabs.get(tabManager.activeTabId)
    if (active && !active.view.webContents.isDestroyed()) active.view.webContents.reload()
  })
  ipcMain.on('window-minimize', () => { if (!mainWindow.isDestroyed()) mainWindow.minimize() })
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isDestroyed()) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window-close', () => { if (!mainWindow.isDestroyed()) mainWindow.close() })

  // Notify tab bar when maximize state changes (for icon toggle)
  mainWindow.on('maximize', () => tabManager.tabBarView?.webContents.send('maximized-changed', true))
  mainWindow.on('unmaximize', () => tabManager.tabBarView?.webContents.send('maximized-changed', false))

  // ABC scraper IPC
  let latestMemberData = {}

  ipcMain.on('abc-member-data', (e, data) => { latestMemberData = data })

  ipcMain.on('abc-signup-detected', (e, data) => {
    latestMemberData = { ...latestMemberData, ...data }
    log('SIGNUP DETECTED - calling showOverlay')
    showOverlay(latestMemberData, mainWindow, tabManager)
    latestMemberData = {}
  })

  // Credential IPC — preload scripts request creds for auto-fill.
  // Logs to C:\WCS\app.log for diagnostics — silent failures here have
  // historically hidden auth-token / shared-credential issues.
  ipcMain.handle('get-credentials', async (e, service) => {
    log('[get-credentials] request service=' + service + ' loggedIn=' + auth.isLoggedIn())
    const cred = auth.getCachedCredential(service)
    if (cred) {
      log('[get-credentials] cache HIT for ' + service)
      return { username: cred.username, password: cred.password }
    }
    log('[get-credentials] cache MISS for ' + service + ' -> fetching')
    try {
      await auth.fetchCredentials(service)
      const fetched = auth.getCachedCredential(service)
      if (fetched) {
        log('[get-credentials] fetch resolved ' + service)
        return { username: fetched.username, password: fetched.password }
      }
      log('[get-credentials] fetch returned no entry for ' + service)
    } catch (err) {
      log('[get-credentials] fetch error for ' + service + ': ' + (err?.message || err))
    }
    return null
  })

  // Kiosk config IPC (admin only)
  ipcMain.handle('get-kiosk-config', () => readConfig())
  ipcMain.handle('set-kiosk-config', (e, config) => {
    writeConfig(config)
    // Reload portal tab with updated location/abc_url
    const portalTab = tabManager.tabs.get(1)
    if (portalTab) {
      const newLocation = config.location || getLocation()
      const newAbcUrl = config.abc_url || getAbcUrl()
      const portalUrl = `${PORTAL_URL}?location=${newLocation}` + (newAbcUrl ? `&abc_url=${encodeURIComponent(newAbcUrl)}` : '')
      portalTab.view.webContents.loadURL(portalUrl)
    }
    return { success: true }
  })

  // Map URLs to tab names
  const URL_TAB_NAMES = {
    'abcfinancial.com': 'ABC Financial',
    'app.westcoaststrength.com': 'Grow',
    'gohighlevel.com': 'Grow',
    'wheniwork.com': 'WhenIWork',
    'paychex.com': 'Paychex',
    'myapps.paychex.com': 'Paychex',
    'operandio.com': 'Operandio',
    'ourproshop.com': 'VistaPrint',
    'memberservices.westcoaststrength.com': 'Cancel Tool',
    'forms.clickup.com': 'Form',
    'reporting.strengthcoastwest.com': 'Tickets',
    'trainerize.com': 'Trainerize',
  }

  function getTabName(url) {
    try {
      const parsed = new URL(url)
      // Check for reporting hash
      if (parsed.hash && parsed.hash.startsWith('#reporting')) return 'Reporting'
      const hostname = parsed.hostname
      for (const [domain, name] of Object.entries(URL_TAB_NAMES)) {
        if (hostname.includes(domain) || hostname === domain) return name
      }
      // Fallback: use hostname without www/app prefix
      return hostname.replace(/^(www|app)\./, '').split('.')[0]
        .charAt(0).toUpperCase() + hostname.replace(/^(www|app)\./, '').split('.')[0].slice(1)
    } catch { return 'Tab' }
  }

  tabManager.onNewWindow = (url) => {
    const abcUrl = getAbcUrl()
    if (url.includes('abcfinancial.com') || url.includes('kiosk.html')) {
      const abcDirect = abcUrl || 'https://prod02.abcfinancial.com'
      tabManager.createTab(abcDirect, 'ABC Financial', {
        preload: path.join(__dirname, 'abc-scraper.js'),
      })
    } else if (url.includes('#reporting')) {
      // Reporting tab uses portal preload for auth bridge
      tabManager.createTab(url, 'Reporting', {
        preload: path.join(__dirname, 'portal-preload.js'),
      })
    } else if (url !== 'about:blank' && !url.startsWith('chrome')) {
      tabManager.createTab(url, getTabName(url), { preload: path.join(__dirname, 'credential-capture.js') })
    }
  }

  app.on('web-contents-created', (event, contents) => {
    log('NEW WEBCONTENT: ' + contents.getType() + ' ' + contents.getURL())
    contents.on('did-finish-load', () => {
      log('LOADED: ' + contents.getType() + ' ' + contents.getURL())
    })
  })

  mainWindow.on('resize', () => {
    tabManager.layoutViews()
    onOverlayResize()
  })

  const { globalShortcut } = require('electron')
  const openActiveDevTools = () => {
    const active = tabManager.tabs.get(tabManager.activeTabId)
    if (active) active.view.webContents.openDevTools()
  }
  globalShortcut.register('F12', openActiveDevTools)
  // macOS convention for opening DevTools.
  if (process.platform === 'darwin') {
    globalShortcut.register('CommandOrControl+Alt+I', openActiveDevTools)
  }

})


app.on('window-all-closed', () => {
  // Quit on close on both platforms — single-window app, no value in
  // keeping a windowless process around on macOS.
  app.quit()
})
