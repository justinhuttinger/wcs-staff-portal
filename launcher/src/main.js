const { app, Tray, Menu, dialog } = require('electron')
const path = require('path')
const { startMonitor } = require('./monitor')
const { startIdleDetection } = require('./idle')
const { launchChrome, killChrome } = require('./monitor')
const { RELAUNCH_DELAY_MS } = require('./config')

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let tray = null

app.on('ready', () => {
  // Hide dock icon (we're a tray-only app)
  if (app.dock) app.dock.hide()

  // Register Windows startup
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  })

  // Create system tray
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png')
  tray = new Tray(iconPath)
  tray.setToolTip('WCS Portal Launcher')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Restart Portal',
      click: async () => {
        await killChrome()
        setTimeout(() => launchChrome(), RELAUNCH_DELAY_MS)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Launcher (Admin)',
      click: () => {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Quit WCS Launcher',
          message: 'Are you sure you want to quit the WCS Portal Launcher?\n\nChrome will no longer auto-relaunch.',
          buttons: ['Cancel', 'Quit'],
          defaultId: 0
        })
        if (choice === 1) {
          app.quit()
        }
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // Start monitoring and idle detection
  startMonitor()
  startIdleDetection()

  console.log('WCS Portal Launcher started')
})

app.on('window-all-closed', (e) => {
  // Prevent app from quitting when no windows (we're tray-only)
  e.preventDefault()
})
