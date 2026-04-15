const { Notification } = require('electron')
const fs = require('fs')
const auth = require('./auth')

const LOG_FILE = 'C:\\WCS\\app.log'
function log(msg) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n') } catch {} }

const POLL_INTERVAL = 5 * 60 * 1000 // 5 minutes
const NOTIFY_BEFORE_MS = 15 * 60 * 1000 // 15 minutes

let pollTimer = null
let notifiedTourIds = new Set()
let isFirstPoll = true
let onClickCallback = null

function formatTime(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchTodayTours() {
  const staff = auth.getStaff()
  if (!staff?.locations?.length) return []

  // Use the kiosk config location, fall back to staff's primary
  const { getLocation } = require('./config')
  const configLocation = getLocation()
  const matchedLoc = staff.locations.find(l => l.name.toLowerCase() === configLocation.toLowerCase())
  const loc = matchedLoc || staff.locations.find(l => l.is_primary) || staff.locations[0]
  if (!loc) return []

  const today = todayDateStr()
  const { net } = require('electron')
  const { API_URL } = require('./config')

  log(`[Tour Notifier] Fetching tours for location: ${loc.name} (${loc.id}) date: ${today}`)

  return new Promise((resolve) => {
    const url = `${API_URL}/tours?location_id=${loc.id}&start_date=${today}&end_date=${today}`
    const req = net.request(url)
    req.setHeader('Authorization', 'Bearer ' + auth.getToken())
    req.setHeader('Accept', 'application/json')

    let data = ''
    req.on('response', (res) => {
      res.on('data', (chunk) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          log(`[Tour Notifier] API response keys: ${Object.keys(parsed).join(', ')}, tours: ${JSON.stringify(parsed.tours || parsed).substring(0, 200)}`)
          resolve(parsed.tours || parsed || [])
        } catch {
          resolve([])
        }
      })
    })
    req.on('error', () => resolve([]))
    req.end()
  })
}

function checkAndNotify(tours) {
  const now = Date.now()

  for (const tour of tours) {
    // Skip cancelled tours
    const status = (tour.status || '').toLowerCase()
    if (status === 'cancelled' || status === 'canceled') continue

    // Skip already notified
    if (notifiedTourIds.has(tour.id)) continue

    const tourTime = new Date(tour.startTime || tour.appointment_time || tour.start_time).getTime()
    if (isNaN(tourTime)) continue

    const msUntilTour = tourTime - now

    // First poll after login: notify for any tour within 15 min
    // Subsequent polls: notify for tours in the 10-15 min window
    const shouldNotify = isFirstPoll
      ? (msUntilTour > 0 && msUntilTour <= NOTIFY_BEFORE_MS)
      : (msUntilTour > 0 && msUntilTour <= NOTIFY_BEFORE_MS && msUntilTour > (NOTIFY_BEFORE_MS - POLL_INTERVAL))

    if (shouldNotify) {
      const name = tour.title || tour.contact_name || tour.name || 'Unknown'
      const timeStr = formatTime(tour.startTime || tour.appointment_time || tour.start_time)
      const minutesAway = Math.round(msUntilTour / 60000)

      const notification = new Notification({
        title: `Tour in ${minutesAway} minutes`,
        body: `${name} — ${timeStr}`,
        icon: undefined, // Uses app icon by default
        silent: false,
      })

      notification.on('click', () => {
        if (onClickCallback) onClickCallback()
      })

      notification.show()
      notifiedTourIds.add(tour.id)
      log(`[Tour Notifier] Notified: ${name} at ${timeStr} (${minutesAway} min away)`)
    }
  }

  isFirstPoll = false
}

async function poll() {
  if (!auth.isLoggedIn()) return

  try {
    const tours = await fetchTodayTours()
    log(`[Tour Notifier] Polled: ${tours.length} tours today`)
    if (tours.length > 0) {
      checkAndNotify(tours)
    }
  } catch (err) {
    log('[Tour Notifier] Poll error: ' + err.message)
  }
}

function start(onClick) {
  if (pollTimer) return // already running

  onClickCallback = onClick
  notifiedTourIds = new Set()
  isFirstPoll = true

  log('[Tour Notifier] Starting — polling every 5 min')

  // First poll immediately
  poll()

  // Then every 5 minutes
  pollTimer = setInterval(poll, POLL_INTERVAL)
}

function stop() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  notifiedTourIds = new Set()
  isFirstPoll = true
  onClickCallback = null
  log('[Tour Notifier] Stopped')
}

module.exports = { start, stop }
