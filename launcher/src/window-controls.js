// Free-standing tool windows (VIPs, Cancel Tool, Insurance, Paychex, Book Day
// One / Book Tour from a button, Club Calendar): normal Windows windows that
// staff can drag, resize, minimise and maximise (Justin, 2026-09-29), plus
// F11 for true full screen. They are not children of the main window, since a
// child window can't be minimised on its own.

// BrowserWindow options every free-standing tool window shares.
const FREE_WINDOW = {
  resizable: true,
  movable: true,
  minimizable: true,
  maximizable: true,
  fullscreenable: true,
  autoHideMenuBar: true,
}

// F11 toggles full screen (there's no menu bar to offer it).
function addWindowKeys(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    }
  })
}

module.exports = { FREE_WINDOW, addWindowKeys }
