const { BrowserWindow } = require('electron')
const { PORTAL_URL, getLocation } = require('./config')

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
