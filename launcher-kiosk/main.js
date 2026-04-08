const { app, BrowserWindow } = require('electron')

// Configure these for your deployment
const PORTAL_URL = process.env.WCS_PORTAL_URL || 'https://wcs-staff-portal.onrender.com'
const KIOSK_KEY = process.env.KIOSK_SECRET || 'CHANGE_ME'
const LOCATION = 'Keizer'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.on('ready', () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'WCS Day One Tracker',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.maximize()

  const url = `${PORTAL_URL}?mode=dayone&key=${encodeURIComponent(KIOSK_KEY)}&location=${encodeURIComponent(LOCATION)}`
  win.loadURL(url)

  // Auto-start on login
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
  })
})

app.on('window-all-closed', () => app.quit())
