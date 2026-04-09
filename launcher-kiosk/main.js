const { app, BrowserWindow } = require('electron')
const path = require('path')

const PORTAL_URL = process.env.WCS_PORTAL_URL || 'https://wcs-staff-portal.onrender.com'
const KIOSK_KEY = '9ayf8dsa8cn439npc9sr8zpcnt3645twvc543'
const LOCATION = 'Keizer'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.on('ready', () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'D1 Tracker',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.maximize()

  const url = `${PORTAL_URL}?mode=dayone&key=${encodeURIComponent(KIOSK_KEY)}&location=${encodeURIComponent(LOCATION)}&start_date=2026-04-01`
  win.loadURL(url)

  // Override the portal's beforeunload handler so window can close
  win.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault()
  })

  // Auto-start on login
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
  })
})

app.on('window-all-closed', () => app.quit())
