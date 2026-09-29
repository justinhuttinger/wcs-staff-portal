// WCS ABC: full text of staff-typed ABC member alerts for the check-in cue.
// abc-scraper.js asks (IPC 'abc-member-alerts') when a new check-in shows an
// alert that isn't a known system alert; the API reads the member's alerts
// from ABC (auth routes/memberAlerts.js) and returns only the staff-typed ones.
const { ipcMain } = require('electron')
const { API_URL, getLocation } = require('./config')
const { CLUB_NUMBERS } = require('./locations')

function clubNumber() {
  const loc = String(getLocation() || '').toLowerCase()
  const hit = Object.entries(CLUB_NUMBERS).find(([name]) => name.toLowerCase() === loc)
  return hit ? hit[1] : ''
}

function launcherHeaders(extra = {}) {
  const headers = { ...extra }
  if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY
  return headers
}

function setup(log = () => {}) {
  // Purple alert acknowledged (initials typed): record it server-side.
  ipcMain.handle('abc-member-alert-ack', async (e, ack) => {
    try {
      const res = await fetch(`${API_URL}/member-alerts/ack`, {
        method: 'POST',
        headers: launcherHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...(ack || {}), club: clubNumber() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: data.error || ('Save failed (' + res.status + ')') }
      log('[member-alerts] purple ack saved member=' + (ack && ack.memberId) + ' by=' + (ack && ack.initials))
      return { ok: true }
    } catch (err) {
      log('[member-alerts] purple ack failed: ' + (err && err.message))
      return { ok: false, error: 'Could not reach the server' }
    }
  })

  ipcMain.handle('abc-member-alerts', async (e, memberId) => {
    const id = String(memberId || '').toLowerCase()
    if (!/^[0-9a-f]{32}$/.test(id)) return { alerts: [] }
    try {
      const headers = {}
      if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY
      const res = await fetch(`${API_URL}/member-alerts/${id}?club=${encodeURIComponent(clubNumber())}`, { headers })
      if (!res.ok) { log('[member-alerts] non-OK ' + res.status); return { alerts: [] } }
      return await res.json()
    } catch (err) {
      log('[member-alerts] failed: ' + (err && err.message))
      return { alerts: [] }
    }
  })
}

module.exports = { setup }
