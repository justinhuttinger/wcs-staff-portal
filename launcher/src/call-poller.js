// WCS ABC: incoming-call banner.
//
// GHL posts each inbound call to the API (routes/telephony.js), which looks the
// caller up and queues it per club. We ask for new calls every few seconds and
// hand each one to the ABC tab's preload (abc-scraper.js), which draws the
// banner. The desk PC can't receive the webhook itself (no public address), so
// polling is the delivery.
const { API_URL, getLocation } = require('./config')
const { CLUB_NUMBERS } = require('./locations')

const POLL_MS = 3000
let timer = null
let log = () => {}
let cursor = null // last call id seen; null until the first poll sets it

function clubNumber() {
  const loc = String(getLocation() || '').toLowerCase()
  const hit = Object.entries(CLUB_NUMBERS).find(([name]) => name.toLowerCase() === loc)
  return hit ? hit[1] : null
}

async function pollOnce(getAbcWebContents, playSound) {
  const club = clubNumber()
  if (!club) return
  try {
    const headers = {}
    if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY
    const url = `${API_URL}/telephony/pending?club=${encodeURIComponent(club)}&after=${cursor || 0}`
    const res = await fetch(url, { headers })
    if (!res.ok) { log('[calls] poll non-OK ' + res.status); return }
    const data = await res.json()
    // First poll after launch: start from "now" so a restart doesn't replay
    // calls from the last couple of minutes.
    if (cursor === null) { cursor = data.latestId || 0; return }
    const calls = Array.isArray(data.calls) ? data.calls : []
    if (!calls.length) {
      // API restarted (ids reset): follow it down so new calls aren't skipped.
      if ((data.latestId || 0) < cursor) cursor = data.latestId || 0
      return
    }
    cursor = Math.max(cursor, ...calls.map(c => c.id))
    const wc = getAbcWebContents()
    if (!wc || wc.isDestroyed()) return
    for (const call of calls) {
      log(`[calls] call #${call.id} matches=${(call.matches || []).length}`)
      wc.send('incoming-call', call)
    }
    playSound('blue')
  } catch (err) {
    log('[calls] poll failed: ' + (err && err.message))
  }
}

function start({ getAbcWebContents, playSound, logger } = {}) {
  if (timer) return
  log = logger || log
  const tick = () => pollOnce(getAbcWebContents, playSound || (() => {}))
  tick()
  timer = setInterval(tick, POLL_MS)
}

module.exports = { start }
