const { exec } = require('child_process')
const { CHROME_PATH, PORTAL_URL, MONITOR_INTERVAL_MS } = require('./config')

let monitoring = false

function isRunning(callback) {
  exec('tasklist /FI "IMAGENAME eq chrome.exe" /NH', (err, stdout) => {
    callback(!err && stdout.includes('chrome.exe'))
  })
}

function launchChrome() {
  exec(`"${CHROME_PATH}" --start-maximized "${PORTAL_URL}"`, (err) => {
    if (err) console.error('Failed to launch Chrome:', err.message)
  })
}

function killChrome() {
  return new Promise((resolve) => {
    exec('taskkill /IM chrome.exe /F', () => resolve())
  })
}

function startMonitor() {
  if (monitoring) return
  monitoring = true

  // Check immediately on start
  isRunning((running) => {
    if (!running) launchChrome()
  })

  setInterval(() => {
    isRunning((running) => {
      if (!running) launchChrome()
    })
  }, MONITOR_INTERVAL_MS)
}

function stopMonitor() {
  monitoring = false
}

module.exports = { startMonitor, stopMonitor, launchChrome, killChrome, isRunning }
