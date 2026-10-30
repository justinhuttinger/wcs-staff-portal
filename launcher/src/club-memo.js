// WCS ABC Club Home memo card: this PC's club's live memo (auth routes/clubMemo.js),
// no sign-in. abc-scraper.js draws it. Any failure returns no memo, so the card
// just doesn't show.
const { ipcMain } = require('electron')
const { API_URL, getLocation } = require('./config')
const { CLUB_NUMBERS } = require('./locations')

function clubNumber() {
  const loc = String(getLocation() || '').toLowerCase()
  const hit = Object.entries(CLUB_NUMBERS).find(([name]) => name.toLowerCase() === loc)
  return hit ? hit[1] : ''
}

function setup(log = () => {}) {
  ipcMain.handle('club-memo:get', async () => {
    const club = clubNumber()
    if (!club) return { memo: null }
    try {
      const headers = {}
      if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY
      const res = await fetch(`${API_URL}/club-memo?club=${encodeURIComponent(club)}`, { headers })
      if (!res.ok) return { memo: null }
      return await res.json()
    } catch (err) {
      log('[club-memo] failed: ' + (err && err.message))
      return { memo: null }
    }
  })
}

module.exports = { setup }
