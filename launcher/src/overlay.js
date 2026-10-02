const { BrowserWindow } = require('electron')
const { FREE_WINDOW, addWindowKeys } = require('./window-controls')
const { PORTAL_URL, getLocation } = require('./config')

let overlayWindow = null

// options.mode = 'dayone' opens straight to the Day One booking widget;
// 'tour' opens the club's Gym Tour widget the same way (call banner)
// (member profile button) instead of the post-signup two-step flow.
function showOverlay(memberData, mainWindow, tabManager, options = {}) {
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
  if (options.mode) welcomeUrl.searchParams.set('mode', options.mode)

  // The automatic post-signup popup is a modal child of main (can't go behind,
  // so the Day One gets booked). Opened from a button (Book Day One / Book
  // Tour), it's a normal window staff can move, resize, minimise and maximise.
  const fromButton = !!options.mode
  const webPreferences = { nodeIntegration: false, contextIsolation: true }
  overlayWindow = fromButton
    ? new BrowserWindow({
      ...FREE_WINDOW,
      width: 1100,
      height: 750,
      title: options.mode === 'tour' ? 'Book Tour' : 'Book Day One',
      center: true,
      webPreferences,
    })
    : new BrowserWindow({
      parent: mainWindow,
      modal: true,
      width: 1100,
      height: 750,
      title: 'WCS — Next Steps',
      autoHideMenuBar: true,
      resizable: false,
      center: true,
      frame: false,
      webPreferences,
    })
  if (fromButton) {
    overlayWindow.on('page-title-updated', (e) => e.preventDefault())
    addWindowKeys(overlayWindow)
  }

  overlayWindow.loadURL(welcomeUrl.toString())

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  // Listen for close from welcome.html
  // Electron 35+ passes the text on the event (and warns about extra
  // listener arguments); Electron 33 passes it as the 3rd argument.
  overlayWindow.webContents.on('console-message', (e, ...legacy) => {
    const msg = typeof legacy[1] === 'string' ? legacy[1] : String((e && e.message) || '')
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
