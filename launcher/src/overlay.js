const { BrowserWindow } = require('electron')
const { PORTAL_URL, getLocation } = require('./config')

let overlayWindow = null

function showOverlay(memberData, mainWindow, tabManager) {
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

  // Child window of main — appears on top like a modal, can't go behind
  overlayWindow = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    width: 1100,
    height: 750,
    title: 'WCS — Next Steps',
    autoHideMenuBar: true,
    resizable: false,
    center: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  overlayWindow.loadURL(welcomeUrl.toString())

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  // Listen for close from welcome.html
  overlayWindow.webContents.on('console-message', (e, level, msg) => {
    if (msg.includes('WCS_CLOSE_OVERLAY')) closeOverlay()
  })

  overlayWindow.webContents.on('dom-ready', () => {
    overlayWindow.webContents.executeJavaScript(`
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'WCS_CLOSE_OVERLAY') console.log('WCS_CLOSE_OVERLAY')
      })
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') console.log('WCS_CLOSE_OVERLAY')
      })
    `).catch(() => {})
  })
}

function closeOverlay() {
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }
}

function onResize() {}

module.exports = { showOverlay, closeOverlay, onResize }
