// Install heartbeat.
//
// On startup and every 15 min the launcher reports its install_id + current
// location/abc_url/version to the auth API. If an admin has set a "target"
// (a new location/abc_url) for this machine, the response carries it and we
// apply it via the supplied applyConfig callback (writes config.json + reloads
// the portal tab). Pairs with the Admin Panel > Kiosk Installs tile.
//
// Best-effort and defensive: any failure is logged and swallowed so a kiosk is
// never taken down by a heartbeat problem.

const { app } = require('electron')
const { API_URL, getLocation, getAbcUrl } = require('./config')
const { getInstallId, getHostname } = require('./install-id')

const POLL_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const FIRST_BEAT_DELAY_MS = 20 * 1000

let timer = null
let log = () => {}
let applyConfig = null

function setLogger(fn) { log = fn || (() => {}) }

async function beatOnce() {
  try {
    const body = {
      install_id: getInstallId(),
      hostname: getHostname(),
      location: getLocation(),
      abc_url: getAbcUrl(),
      app_version: app.getVersion(),
    }
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY

    const res = await fetch(API_URL + '/launcher/heartbeat', {
      method: 'POST', headers, body: JSON.stringify(body),
    })
    if (!res.ok) { log('[heartbeat] non-OK ' + res.status); return }
    const data = await res.json()

    if (data && data.target && data.target.location) {
      const t = data.target
      // Only apply when something actually differs from what we're running.
      if (t.location !== getLocation() || (t.abc_url && t.abc_url !== getAbcUrl())) {
        log('[heartbeat] applying target location=' + t.location)
        if (applyConfig) applyConfig({ location: t.location, abc_url: t.abc_url })
      }
    }
  } catch (err) {
    log('[heartbeat] failed: ' + (err?.message || err))
  }
}

function start(applyConfigFn) {
  applyConfig = applyConfigFn
  if (timer) return
  setTimeout(beatOnce, FIRST_BEAT_DELAY_MS)
  timer = setInterval(beatOnce, POLL_INTERVAL_MS)
}

function stop() {
  if (timer) { clearInterval(timer); timer = null }
}

module.exports = { start, stop, setLogger, beatOnce }
