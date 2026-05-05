const { Tray, Menu, dialog, app, nativeImage } = require('electron')
const path = require('path')
const { LOCATIONS } = require('./locations')
const { readConfig, writeConfig } = require('./config')

let tray = null

function buildLocationSubmenu(onChange) {
  const current = (readConfig() || {}).location
  return LOCATIONS.map((loc) => ({
    label: loc.name,
    type: 'radio',
    checked: loc.name === current,
    click: () => {
      const cfg = { location: loc.name, abc_url: loc.abc_url }
      writeConfig(cfg)
      if (onChange) onChange(cfg)
    },
  }))
}

function createTray(mainWindow, options = {}) {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png')
  // On macOS, mark the image as a template so the menu bar inverts it
  // automatically for light/dark mode. Windows ignores the flag.
  const trayImage = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') trayImage.setTemplateImage(true)
  tray = new Tray(trayImage)
  tray.setToolTip('WCS App')

  const refreshMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show WCS App',
        click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } },
      },
      {
        label: 'Change Location',
        submenu: buildLocationSubmenu((cfg) => {
          if (options.onLocationChange) options.onLocationChange(cfg)
          refreshMenu()
        }),
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
  }

  refreshMenu()
  tray.on('click', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } })

  return tray
}

module.exports = { createTray }
