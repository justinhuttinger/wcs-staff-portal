// Polled force-update checker.
//
// The launcher hits /config/launcher-version on a slow timer. If the
// returned min_version is greater than the running app version, we call
// app.relaunch() + app.exit(0) so that electron-updater applies whatever
// it's already downloaded (downloads happen automatically on launch).
//
// Pairs with the admin UI tile under Admin Panel > Technical that lets
// an admin push a min_launcher_version value matching the latest release.

const { app } = require('electron')
const { API_URL } = require('./config')

const POLL_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const FIRST_CHECK_DELAY_MS = 30 * 1000   // give the app a chance to boot

let timer = null
let log = () => {}

function setLogger(fn) { log = fn || (() => {}) }

// SemVer-ish "a >= b" comparison. Treats missing parts as 0.
function versionGte(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] || 0
    const bi = pb[i] || 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return true
}

async function fetchMinVersion() {
  try {
    const res = await fetch(API_URL + '/config/launcher-version', {
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && data.min_version ? String(data.min_version) : null
  } catch (err) {
    log('[version-check] fetch failed: ' + err.message)
    return null
  }
}

async function checkOnce() {
  const minVersion = await fetchMinVersion()
  if (!minVersion) return
  const current = app.getVersion()
  if (versionGte(current, minVersion)) {
    log('[version-check] OK current=' + current + ' min=' + minVersion)
    return
  }
  log('[version-check] FORCE RELAUNCH current=' + current + ' min=' + minVersion)
  // Give electron-updater a beat to finish any in-flight download, then
  // relaunch. quitAndInstall would be ideal but only works when an update
  // is already downloaded; relaunch + exit is the safe fallback because
  // autoInstallOnAppQuit applies the download on next quit anyway.
  setTimeout(() => {
    try { app.relaunch() } catch {}
    app.exit(0)
  }, 2000)
}

function start() {
  if (timer) return
  setTimeout(() => { checkOnce() }, FIRST_CHECK_DELAY_MS)
  timer = setInterval(checkOnce, POLL_INTERVAL_MS)
}

function stop() {
  if (timer) { clearInterval(timer); timer = null }
}

module.exports = { start, stop, setLogger, checkOnce, versionGte }
