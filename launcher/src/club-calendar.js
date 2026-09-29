// WCS ABC "See Calendar": a window with this PC's club's upcoming tours and
// Day Ones (auth routes/clubCalendar.js), no sign-in. The club comes from
// C:\WCS\config.json, so it follows whatever Admin set.
const path = require('path')
const { BrowserWindow, ipcMain } = require('electron')
const { API_URL, getLocation } = require('./config')
const { CLUB_NUMBERS } = require('./locations')

function clubNumber() {
  const loc = String(getLocation() || '').toLowerCase()
  const hit = Object.entries(CLUB_NUMBERS).find(([name]) => name.toLowerCase() === loc)
  return hit ? hit[1] : ''
}

let win = null

function setup(log = () => {}, mainWindow = null) {
  ipcMain.on('abc-open-calendar', () => {
    if (win && !win.isDestroyed()) { win.focus(); return }
    win = new BrowserWindow({
      width: 760,
      height: 820,
      title: 'Club Calendar',
      parent: mainWindow || undefined,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'club-calendar-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.loadFile(path.join(__dirname, '..', 'ui', 'club-calendar.html'))
    win.on('closed', () => { win = null })
    log('[club-calendar] opened')
  })

  ipcMain.handle('club-calendar:get', async (e, { start, days } = {}) => {
    const club = clubNumber()
    if (!club) return { error: 'This PC has no club set (Settings → Admin).' }
    try {
      const headers = {}
      if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY
      const qs = new URLSearchParams({ club, days: String(days || 7) })
      if (start) qs.set('start', start)
      const res = await fetch(`${API_URL}/club-calendar?${qs}`, { headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error || ('Could not load (' + res.status + ')') }
      return data
    } catch (err) {
      log('[club-calendar] failed: ' + (err && err.message))
      return { error: 'Could not reach the server' }
    }
  })
}

module.exports = { setup }
