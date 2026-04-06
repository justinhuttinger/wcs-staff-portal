const { BrowserView } = require('electron')
const { PORTAL_URL, getLocation } = require('./config')

let overlayView = null
let parentWindow = null

function showOverlay(memberData, mainWindow) {
  if (overlayView) {
    // Already showing — bring to front
    return
  }

  parentWindow = mainWindow

  const location = getLocation()
  const welcomeUrl = new URL(`${PORTAL_URL}/welcome.html`)
  if (memberData.firstName)   welcomeUrl.searchParams.set('firstName', memberData.firstName)
  if (memberData.lastName)    welcomeUrl.searchParams.set('lastName', memberData.lastName)
  if (memberData.email)       welcomeUrl.searchParams.set('email', memberData.email)
  if (memberData.phone)       welcomeUrl.searchParams.set('phone', memberData.phone)
  if (memberData.salesperson) welcomeUrl.searchParams.set('salesperson', memberData.salesperson)
  welcomeUrl.searchParams.set('location', location)

  overlayView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.addBrowserView(overlayView)
  layoutOverlay()
  overlayView.webContents.loadURL(welcomeUrl.toString())

  // Listen for close message from welcome.html
  overlayView.webContents.on('console-message', (e, level, msg) => {
    // welcome.html sends WCS_CLOSE_OVERLAY via postMessage, which we can't catch
    // So we also watch for a custom console message
    if (msg.includes('WCS_CLOSE_OVERLAY')) closeOverlay()
  })

  // Inject close-on-escape and backdrop click handler
  overlayView.webContents.on('dom-ready', () => {
    overlayView.webContents.executeJavaScript(`
      // Listen for close messages from welcome.html iframes
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'WCS_CLOSE_OVERLAY') {
          console.log('WCS_CLOSE_OVERLAY')
        }
      })
      // Escape key closes overlay
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') console.log('WCS_CLOSE_OVERLAY')
      })
    `).catch(() => {})
  })
}

function layoutOverlay() {
  if (!overlayView || !parentWindow) return
  const bounds = parentWindow.getContentBounds()
  // Full screen overlay — covers everything including tab bar
  overlayView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
}

function closeOverlay() {
  if (overlayView && parentWindow) {
    parentWindow.removeBrowserView(overlayView)
    overlayView.webContents.destroy()
    overlayView = null
  }
}

function onResize() {
  layoutOverlay()
}

module.exports = { showOverlay, closeOverlay, onResize }
