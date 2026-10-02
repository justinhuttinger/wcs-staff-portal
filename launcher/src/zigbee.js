// Runs the call button receiver (zigbee-worker.js) in a utilityProcess and
// keeps it alive. Only the club's pager PC starts it (pager `enabled`).
const path = require('path')

const MAX_BACKOFF_MS = 60000

let child = null
let stopped = true
let failures = 0
let restartTimer = null
let opts = null
// What the Admin window shows.
const state = { receiver: 'off', port: null, error: null, ports: [], devices: [], pairingUntil: 0, pairingMessage: '' }

function post(msg) {
  if (child) child.postMessage(msg)
}

function spawn() {
  const { app, utilityProcess } = require('electron')
  clearTimeout(restartTimer)
  Object.assign(state, { receiver: 'starting', error: null })
  child = utilityProcess.fork(path.join(__dirname, 'zigbee-worker.js'), [], { serviceName: 'WCS call button receiver', stdio: 'ignore' })
  child.on('message', (m) => {
    if (m.type === 'status') {
      Object.assign(state, { receiver: m.receiver, port: m.port, error: m.error })
      if (m.receiver === 'ready') failures = 0
    } else if (m.type === 'ports') state.ports = m.ports
    else if (m.type === 'devices') state.devices = m.devices
    else if (m.type === 'pairing') {
      if (m.until !== undefined) state.pairingUntil = m.until
      if (m.message) state.pairingMessage = m.message
    } else if (m.type === 'button') opts.onButton(m)
    else if (m.type === 'log') opts.log('[zigbee] ' + m.msg)
  })
  child.on('exit', (code) => {
    child = null
    if (stopped) return
    failures++
    const wait = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (failures - 1))
    opts.log('[zigbee] worker exited code=' + code + ', restart in ' + wait + 'ms')
    Object.assign(state, {
      receiver: 'error', port: null, pairingUntil: 0,
      error: failures >= 3 ? 'Receiver keeps stopping. Unplug and replug it.' : 'Receiver stopped, restarting...',
    })
    restartTimer = setTimeout(spawn, wait)
  })
  child.postMessage({ cmd: 'start', dataDir: path.join(app.getPath('userData'), 'zigbee'), port: opts.getPort() })
}

// options: { log, getPort() -> 'auto' | 'COM5', onButton({ action, ieee, linkquality }) }
function start(options) {
  opts = options
  if (child) return
  stopped = false
  failures = 0
  spawn()
}

function stop() {
  stopped = true
  clearTimeout(restartTimer)
  if (child) child.kill()
  child = null
  Object.assign(state, { receiver: 'off', port: null, error: null, devices: [], pairingUntil: 0, pairingMessage: '' })
}

function restart() {
  if (!opts) return
  stop()
  start(opts)
}

function pair(seconds) {
  state.pairingMessage = seconds ? 'Waiting for the button...' : ''
  post({ cmd: 'pair', seconds })
}

module.exports = {
  start, stop, restart, pair,
  remove: (ieee) => post({ cmd: 'remove', ieee }),
  refreshPorts: () => post({ cmd: 'ports' }),
  getState: () => ({ ...state, running: !!child }),
}
