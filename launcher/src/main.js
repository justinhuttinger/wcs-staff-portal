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
