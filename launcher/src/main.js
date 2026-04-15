const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')
const LOG_FILE = 'C:\\WCS\\app.log'
function log(msg) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n') } catch {} }
log('=== APP STARTING ===')
const { PORTAL_URL, getAbcUrl, getLocation, readConfig, writeConfig } = require('./config')
const TabManager = require('./tabs')
const { showOverlay, closeOverlay, onResize: onOverlayResize } = require('./overlay')
const { createTray } = require('./tray')
const auth = require('./auth')

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

app.on('ready', () => {
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

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Portal',
    icon: require('path').join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
  })

  mainWindow.maximize()
  createTray(mainWindow)

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
  })

  tabManager = new TabManager(mainWindow, TAB_BAR_HEIGHT)
  tabManager.initTabBar()

  // Check for updates after launch (silent background check)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => log('[Updater] Check failed: ' + err.message))
  }, 5000)

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
      // Staff profile loaded — start tour notifications
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
    }).catch(() => {})
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

  // Credential IPC — preload scripts request creds for auto-fill
  ipcMain.handle('get-credentials', async (e, service) => {
    const cred = auth.getCachedCredential(service)
    if (cred) return { username: cred.username, password: cred.password }
    try {
      await auth.fetchCredentials(service)
      const fetched = auth.getCachedCredential(service)
      if (fetched) return { username: fetched.username, password: fetched.password }
    } catch {}
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
  globalShortcut.register('F12', () => {
    const active = tabManager.tabs.get(tabManager.activeTabId)
    if (active) active.view.webContents.openDevTools()
  })

})


app.on('window-all-closed', (e) => {
  if (!mainWindow || mainWindow.isDestroyed()) app.quit()
})
