// Silent auto-updates. The app never shows an update dialog or UAC prompt.
//
// Two paths, picked at startup:
//
// 1. SYSTEM TASK (Windows per-machine install in Program Files, the kiosk
//    default): the app can't write Program Files, so installing from here
//    would raise a UAC prompt. Updates are installed by the SYSTEM scheduled
//    task "\WCS\WCS Portal Updater" (or "WCS ABC Updater"), registered by
//    Action1 / the installer from scripts/action1/install-portal.ps1. It runs
//    overnight and at boot. The app only CHECKS the feed (no download) and,
//    when a newer build exists, asks the task to run at the next quiet moment
//    via `schtasks /Run` (the task's ACL lets signed-in users start it). If
//    that isn't permitted, the overnight schedule still picks it up.
//
// 2. SELF-INSTALL (macOS, or a Windows install the user can write to): the
//    update downloads in the background and is applied with
//    quitAndInstall(isSilent=true, forceRunAfter=true) at a quiet moment, or
//    on any normal quit (autoInstallOnAppQuit).
//
// Quiet moment = the machine has been idle IDLE_MINUTES, or it's inside the
// overnight window.

const { app, powerMonitor } = require('electron')
const { autoUpdater } = require('electron-updater')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const IDLE_MINUTES = 15
const QUIET_START_HOUR = 1  // 01:00 local
const QUIET_END_HOUR = 5    // 05:00 local
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000   // re-check the feed every 4h
const INSTALL_POLL_MS = 5 * 60 * 1000       // look for a quiet moment every 5m

// Feed channel (last segment of the update URL) -> SYSTEM task prefix.
// Must match $Flavors in scripts/action1/install-portal.ps1.
const TASKS = { portal: 'WCS Portal', abc: 'WCS ABC' }

let log = () => {}
let pendingVersion = null
let installTimer = null

// fs.access(W_OK) on Windows only checks the read-only attribute, not ACLs,
// so actually try to create a file in the install directory.
function canWriteInstallDir() {
  if (process.platform !== 'win32') return true
  const dir = path.dirname(app.getPath('exe'))
  const probe = path.join(dir, `.wcs-write-test-${process.pid}`)
  try {
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function updaterTaskName() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const m = yml.match(/^url:\s*['"]?([^'"\r\n]+)/m)
    const channel = m && m[1].replace(/\/+$/, '').split('/').pop()
    if (TASKS[channel]) return `\\WCS\\${TASKS[channel]} Updater`
  } catch {}
  return null
}

function isQuietTime() {
  const hour = new Date().getHours()
  if (hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR) return true
  try {
    return powerMonitor.getSystemIdleTime() >= IDLE_MINUTES * 60
  } catch {
    return false
  }
}

function whenQuiet(install) {
  if (installTimer) return
  const tryInstall = () => {
    if (!pendingVersion || !isQuietTime()) return
    clearInterval(installTimer)
    installTimer = null
    install()
  }
  installTimer = setInterval(tryInstall, INSTALL_POLL_MS)
  tryInstall()
}

function runSystemTask(taskName) {
  log('[Updater] Quiet moment - starting ' + taskName + ' for v' + pendingVersion)
  execFile('schtasks.exe', ['/Run', '/TN', taskName], { windowsHide: true }, (err, stdout, stderr) => {
    if (err) log('[Updater] Could not start ' + taskName + ' (' + String(stderr || err.message).trim() + ') - it will run overnight')
  })
}

function start(logger) {
  log = logger || (() => {})
  const selfInstall = canWriteInstallDir()
  const taskName = selfInstall ? null : updaterTaskName()
  log('[Updater] Mode: ' + (selfInstall ? 'self-install (silent, idle/overnight)' : 'SYSTEM task ' + (taskName || '(unknown feed)')))

  autoUpdater.logger = { info: log, warn: log, error: log }
  // Per-machine: check only. Downloading here would be wasted (the task
  // downloads its own copy) and installing would prompt for UAC.
  autoUpdater.autoDownload = selfInstall
  autoUpdater.autoInstallOnAppQuit = selfInstall

  autoUpdater.on('checking-for-update', () => log('[Updater] Checking for updates...'))
  autoUpdater.on('update-not-available', () => log('[Updater] App is up to date'))
  autoUpdater.on('download-progress', (p) => log('[Updater] Downloading: ' + Math.round(p.percent) + '%'))
  autoUpdater.on('error', (err) => log('[Updater] Error: ' + (err && err.message)))
  autoUpdater.on('update-available', (info) => {
    log('[Updater] Update available: v' + info.version)
    if (selfInstall || !taskName) return
    pendingVersion = info.version
    whenQuiet(() => runSystemTask(taskName))
  })
  autoUpdater.on('update-downloaded', (info) => {
    log('[Updater] Update downloaded: v' + info.version + ' - will install at the next quiet moment')
    pendingVersion = info.version
    // isSilent=true runs the NSIS installer with /S; forceRunAfter=true
    // relaunches the app when it finishes.
    whenQuiet(() => {
      log('[Updater] Quiet moment - installing v' + pendingVersion + ' silently')
      autoUpdater.quitAndInstall(true, true)
    })
  })

  const check = () => autoUpdater.checkForUpdates().catch(err => log('[Updater] Check failed: ' + err.message))
  setTimeout(check, 5000)
  setInterval(check, CHECK_EVERY_MS)
}

module.exports = { start }
