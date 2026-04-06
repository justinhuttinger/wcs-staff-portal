const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const LOG_FILE = 'C:\\WCS\\app.log'
function log(msg) { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n') }
log('=== APP STARTING ===')
const { PORTAL_URL, getAbcUrl, getLocation } = require('./config')
const TabManager = require('./tabs')
const { showOverlay, closeOverlay, onResize: onOverlayResize } = require('./overlay')
const { createTray } = require('./tray')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

const TAB_BAR_HEIGHT = 40
let mainWindow = null
let tabManager = null

app.on('ready', () => {
  const { session } = require('electron')

  // Strip X-Frame-Options from ABC Financial so it loads in iframes
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    delete headers['x-frame-options']
    delete headers['X-Frame-Options']
    callback({ responseHeaders: headers })
  })

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

  createTray(mainWindow)

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
  })

  tabManager = new TabManager(mainWindow, TAB_BAR_HEIGHT)
  tabManager.initTabBar()

  // Home tab (portal) — not closable, with preload for link interception
  tabManager.createTab(portalUrl, 'Portal', {
    closable: false,
    preload: path.join(__dirname, 'portal-preload.js'),
  })

  // Tab IPC
  ipcMain.on('switch-tab', (e, id) => tabManager.switchTo(id))
  ipcMain.on('close-tab', (e, id) => tabManager.closeTab(id))
  ipcMain.on('tabs-ready', () => tabManager.notifyTabBar())

  // Link click IPC from preload scripts
  ipcMain.on('open-in-tab', (e, url) => {
    if (tabManager.onNewWindow) tabManager.onNewWindow(url)
  })

  // Window control IPC
  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow.close())

  // ABC scraper IPC
  let latestMemberData = {}

  ipcMain.on('abc-member-data', (e, data) => {
    latestMemberData = data
  })

  ipcMain.on('abc-signup-detected', (e, data) => {
    latestMemberData = { ...latestMemberData, ...data }
    log('SIGNUP DETECTED - calling showOverlay')
    showOverlay(latestMemberData, mainWindow, tabManager)
    latestMemberData = {}
  })

  // Route new windows into tabs
  tabManager.onNewWindow = (url) => {
    if (url.includes('abcfinancial.com') || url.includes('kiosk.html')) {
      // Open ABC directly as a tab (not in an iframe — avoids X-Frame-Options)
      const abcDirect = abcUrl || 'https://prod02.abcfinancial.com'
      tabManager.createTab(abcDirect, 'ABC Financial', {
        preload: path.join(__dirname, 'abc-scraper.js'),
      })
    } else if (url.includes('gohighlevel.com') || url.includes('westcoaststrength.com/')) {
      tabManager.createTab(url, 'Grow')
    } else if (url.includes('wheniwork.com')) {
      tabManager.createTab(url, 'WhenIWork')
    } else if (url.includes('paychex.com')) {
      tabManager.createTab(url, 'Paychex')
    } else if (url !== 'about:blank' && !url.startsWith('chrome')) {
      tabManager.createTab(url, 'Loading...')
    }
  }

  // Log EVERY new window/webContents that gets created
  app.on('web-contents-created', (event, contents) => {
    log('NEW WEBCONTENT: ' + contents.getType() + ' ' + contents.getURL())
    contents.on('did-finish-load', () => {
      log('LOADED: ' + contents.getType() + ' ' + contents.getURL())
    })
  })

  app.on('browser-window-created', (event, win) => {
    log('NEW WINDOW: ' + win.getTitle())
    win.webContents.on('did-finish-load', () => {
      log('WINDOW LOADED: ' + win.webContents.getURL())
    })
  })

  mainWindow.on('resize', () => {
    tabManager.layoutViews()
    onOverlayResize()
  })

  // F12 opens DevTools on active tab
  const { globalShortcut } = require('electron')
  globalShortcut.register('F12', () => {
    const active = tabManager.tabs.get(tabManager.activeTabId)
    if (active) active.view.webContents.openDevTools()
  })
})

app.on('window-all-closed', (e) => {
  // Only quit if the main window is gone
  if (!mainWindow || mainWindow.isDestroyed()) app.quit()
})
