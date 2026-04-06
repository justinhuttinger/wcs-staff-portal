const { powerMonitor } = require('electron')
const { IDLE_TIMEOUT_MS, RELAUNCH_DELAY_MS } = require('./config')
const { killChrome, launchChrome } = require('./monitor')

let idleCheckInterval = null

function startIdleDetection() {
  if (idleCheckInterval) return

  const idleThresholdSec = Math.floor(IDLE_TIMEOUT_MS / 1000)

  idleCheckInterval = setInterval(() => {
    const idleTime = powerMonitor.getSystemIdleTime()
    if (idleTime >= idleThresholdSec) {
      console.log(`Idle for ${idleTime}s — resetting Chrome`)
      resetChrome()
    }
  }, 30000) // Check every 30 seconds
}

async function resetChrome() {
  await killChrome()
  setTimeout(() => launchChrome(), RELAUNCH_DELAY_MS)
}

function stopIdleDetection() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval)
    idleCheckInterval = null
  }
}

module.exports = { startIdleDetection, stopIdleDetection }
