const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { PORTAL_URL, getAbcUrl, getLocation } = require('./config')
const TabManager = require('./tabs')
const { showOverlay } = require('./overlay')
const { createTray } = require('./tray')

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

  createTray(mainWindow)

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
  })

  tabManager = new TabManager(mainWindow, TAB_BAR_HEIGHT)
  tabManager.initTabBar()

  // Home tab (portal) — not closable
  tabManager.createTab(portalUrl, 'Portal', { closable: false })

  // Tab IPC
  ipcMain.on('switch-tab', (e, id) => tabManager.switchTo(id))
  ipcMain.on('close-tab', (e, id) => tabManager.closeTab(id))
  ipcMain.on('tabs-ready', () => tabManager.notifyTabBar())

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
    showOverlay(latestMemberData)
    latestMemberData = {}
  })

  // Route new windows into tabs
  tabManager.onNewWindow = (url) => {
    if (url.includes('abcfinancial.com')) {
      tabManager.createTab(url, 'ABC Financial', {
        preload: path.join(__dirname, 'abc-scraper.js'),
      })
    } else if (url.includes('kiosk.html')) {
      // Kiosk setup page — open as-is (it has its own ABC URL input)
      tabManager.createTab(url, 'ABC Kiosk')
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

  mainWindow.on('resize', () => tabManager.layoutViews())
})

app.on('window-all-closed', () => app.quit())
