const { Tray, Menu, dialog, app, nativeImage } = require('electron')
const path = require('path')

let tray = null

// `iconFile` (under assets/) lets the WCS ABC flavor use its own tray icon.
// `opts` (WCS ABC pager-only, which has no main window): tooltip, and what
// the first menu item / a click opens, and onQuit to replace the Quit
// confirmation.
function createTray(mainWindow, iconFile = 'tray-icon.png', opts = {}) {
  const show = opts.onShow || (() => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } })
  const iconPath = path.join(__dirname, '..', 'assets', iconFile)
  // On macOS, mark the image as a template so the menu bar inverts it
  // automatically for light/dark mode. Windows ignores the flag.
  const trayImage = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') trayImage.setTemplateImage(true)
  tray = new Tray(trayImage)
  tray.setToolTip(opts.tooltip || 'WCS App')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: opts.showLabel || 'Show WCS App',
      click: show,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: opts.onQuit || (() => {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Quit WCS App',
          message: 'Are you sure you want to quit?',
          buttons: ['Cancel', 'Quit'],
          defaultId: 0,
        })
        if (choice === 1) app.quit()
      }),
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', show)

  return tray
}

module.exports = { createTray }
