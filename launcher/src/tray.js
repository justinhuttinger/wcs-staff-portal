const { Tray, Menu, dialog, app, nativeImage } = require('electron')
const path = require('path')

let tray = null

function createTray(mainWindow) {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png')
  // On macOS, mark the image as a template so the menu bar inverts it
  // automatically for light/dark mode. Windows ignores the flag.
  const trayImage = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') trayImage.setTemplateImage(true)
  tray = new Tray(trayImage)
  tray.setToolTip('WCS App')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show WCS App',
      click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Quit WCS App',
          message: 'Are you sure you want to quit?',
          buttons: ['Cancel', 'Quit'],
          defaultId: 0,
        })
        if (choice === 1) app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } })

  return tray
}

module.exports = { createTray }
