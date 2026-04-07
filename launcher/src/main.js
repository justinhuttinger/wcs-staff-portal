const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const LOG_FILE = 'C:\\WCS\\app.log'
function log(msg) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n') } catch {} }
log('=== APP STARTING ===')
const { PORTAL_URL, getAbcUrl, getLocation, readConfig, writeConfig } = require('./config')
const TabManager = require('./tabs')
const { showOverlay, closeOverlay, onResize: onOverlayResize } = require('./overlay')
const { createTray } = require('./tray')
const auth = require('./auth')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

const TAB_BAR_HEIGHT = 40
let mainWindow = null
let tabManager = null

app.on('ready', () => {
  const { session } = require('electron')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    delete headers['x-frame-options']
    delete headers['X-Frame-Options']
    callback({ responseHeaders: headers })
  })

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Portal',
    icon: require('path').join(__dirname, '..', 'assets', 'icon-256.png'),
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

  // Load portal tab immediately — portal handles its own login UI
  const location = getLocation()
  const abcUrl = getAbcUrl()
  const portalUrl = `${PORTAL_URL}?location=${location}` + (abcUrl ? `&abc_url=${encodeURIComponent(abcUrl)}` : '')

  tabManager.createTab(portalUrl, 'Portal', {
    closable: false,
    preload: path.join(__dirname, 'portal-preload.js'),
  })

  // Auth state bridge — portal notifies us when user logs in/out
  ipcMain.on('portal-auth-login', (e, token) => {
    log('Portal auth: user logged in')
    auth.setToken(token)
    auth.fetchAllCredentials().then(() => {
      log('Credentials cached for session')
    }).catch(err => {
      log('Failed to cache credentials: ' + err.message)
    })
  })

  ipcMain.on('portal-auth-logout', () => {
    log('Portal auth: user logged out')
    auth.logout()
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
  ipcMain.on('tabs-ready', () => tabManager.notifyTabBar())

  ipcMain.on('open-in-tab', (e, url) => {
    if (tabManager.onNewWindow) tabManager.onNewWindow(url)
  })

  // Window controls
  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow.close())

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
    return { success: true }
  })

  tabManager.onNewWindow = (url) => {
    const abcUrl = getAbcUrl()
    if (url.includes('abcfinancial.com') || url.includes('kiosk.html')) {
      const abcDirect = abcUrl || 'https://prod02.abcfinancial.com'
      tabManager.createTab(abcDirect, 'ABC Financial', {
        preload: path.join(__dirname, 'abc-scraper.js'),
      })
    } else if (url.includes('gohighlevel.com') || url.includes('westcoaststrength.com/')) {
      tabManager.createTab(url, 'Grow', { preload: path.join(__dirname, 'credential-capture.js') })
    } else if (url.includes('wheniwork.com')) {
      tabManager.createTab(url, 'WhenIWork', { preload: path.join(__dirname, 'credential-capture.js') })
    } else if (url.includes('paychex.com')) {
      tabManager.createTab(url, 'Paychex', { preload: path.join(__dirname, 'credential-capture.js') })
    } else if (url !== 'about:blank' && !url.startsWith('chrome')) {
      tabManager.createTab(url, 'Loading...', { preload: path.join(__dirname, 'credential-capture.js') })
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
