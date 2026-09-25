const { BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// Pop-up windows for ABC toolbar actions (VIPs, Cancel Tool). One window per
// tool: clicking the action again reuses and refocuses it. An optional
// `prefill` object is handed to popup-prefill.js on request so external
// sites (which take no URL params) get their form fields filled in.
const popups = new Map()          // key -> BrowserWindow
const prefills = new Map()        // webContents.id -> prefill object

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

ipcMain.handle('popup-prefill', (e) => prefills.get(e.sender.id) || null)

function openToolPopup(key, url, title, mainWindow, prefill) {
  let win = popups.get(key)
  if (win && !win.isDestroyed()) {
    if (prefill) prefills.set(win.webContents.id, prefill)
    win.loadURL(url)
    win.show()
    win.focus()
    return win
  }

  win = new BrowserWindow({
    parent: mainWindow,
    width: 960,
    height: 860,
    title,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'popup-prefill.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:wcs-portal',
    },
  })
  win.webContents.setUserAgent(CHROME_UA)
  const id = win.webContents.id
  if (prefill) prefills.set(id, prefill)
  // Keep the given title instead of the page's <title>.
  win.on('page-title-updated', (e) => e.preventDefault())
  win.on('closed', () => {
    popups.delete(key)
    prefills.delete(id)
  })
  // Links that open new windows stay inside this popup.
  win.webContents.setWindowOpenHandler(({ url: next }) => {
    win.loadURL(next)
    return { action: 'deny' }
  })
  win.loadURL(url)
  popups.set(key, win)
  return win
}

module.exports = { openToolPopup }
