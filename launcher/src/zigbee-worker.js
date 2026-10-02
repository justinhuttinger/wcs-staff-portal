// Call button receiver. Runs in an Electron utilityProcess (see zigbee.js) so
// a serial or Zigbee crash can't take WCS ABC down; the main process restarts
// it. Talks to a SONOFF Zigbee Dongle-P (TI CC2652P, "zstack") and reports
// button presses.
//
// Parent -> worker:  { cmd: 'start', dataDir, port }   port: 'auto' or 'COM5'
//                    { cmd: 'pair', seconds }          0 stops pairing
//                    { cmd: 'remove', ieee }
//                    { cmd: 'ports' }
// Worker -> parent:  { type: 'status', receiver, port, error }
//                    { type: 'ports', ports }
//                    { type: 'devices', devices }
//                    { type: 'pairing', until, message }
//                    { type: 'button', action, ieee, linkquality }
//                    { type: 'log', msg }
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// CP2102N USB bridge on the SONOFF Dongle-P.
const DONGLE_VID = '10C4'
const DONGLE_PID = 'EA60'
const RETRY_MS = 30000
// Zigbee retries can deliver the same press twice.
const DEDUPE_MS = 1500

const send = (m) => process.parentPort.postMessage(m)
const log = (msg) => send({ type: 'log', msg })

let controller = null
let zhc = null
let dataDir = ''
let wantedPort = 'auto'
let retryTimer = null
const health = new Map()       // ieee -> { battery, voltage }
const lastAction = new Map()   // ieee -> { action, at }

async function listPorts() {
  const ports = await require('@serialport/bindings-cpp').autoDetect().list()
  return ports.map((p) => ({
    path: p.path,
    label: p.friendlyName || p.manufacturer || p.path,
    dongle: String(p.vendorId || '').toUpperCase() === DONGLE_VID && String(p.productId || '').toUpperCase() === DONGLE_PID,
  }))
}

// The network identity is generated once and kept: losing it means every
// button has to be paired again.
function networkOptions() {
  const file = path.join(dataDir, 'network.json')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  const net = {
    panID: crypto.randomInt(1, 0xfffe),
    extendedPanID: [...crypto.randomBytes(8)],
    networkKey: [...crypto.randomBytes(16)],
    channelList: [20],
  }
  fs.writeFileSync(file, JSON.stringify(net))
  return net
}

function loadHealth() {
  try {
    for (const [ieee, h] of Object.entries(JSON.parse(fs.readFileSync(path.join(dataDir, 'health.json'), 'utf8')))) health.set(ieee, h)
  } catch {}
}
function saveHealth() {
  try { fs.writeFileSync(path.join(dataDir, 'health.json'), JSON.stringify(Object.fromEntries(health))) } catch {}
}

function deviceList() {
  if (!controller) return []
  return controller.getDevices().filter((d) => d.type !== 'Coordinator').map((d) => {
    const h = health.get(d.ieeeAddr) || {}
    return {
      ieee: d.ieeeAddr,
      model: d.modelID || '',
      lastSeen: d.lastSeen || null,
      linkquality: d.linkquality == null ? null : d.linkquality,
      battery: h.battery == null ? null : h.battery,
      voltage: h.voltage == null ? null : h.voltage,
    }
  })
}
const sendDevices = () => send({ type: 'devices', devices: deviceList() })

function handlePayload(device, payload, linkquality) {
  if (!payload) return
  if (payload.battery != null || payload.voltage != null) {
    const h = health.get(device.ieeeAddr) || {}
    if (payload.battery != null) h.battery = payload.battery
    if (payload.voltage != null) h.voltage = payload.voltage
    health.set(device.ieeeAddr, h)
    saveHealth()
  }
  if (!payload.action) return
  const now = Date.now()
  const last = lastAction.get(device.ieeeAddr)
  if (last && last.action === payload.action && now - last.at < DEDUPE_MS) return
  lastAction.set(device.ieeeAddr, { action: payload.action, at: now })
  send({ type: 'button', action: payload.action, ieee: device.ieeeAddr, linkquality })
}

// Decoding lives in zigbee-decode.js; this only guards and refreshes the list.
let decode = null
async function onMessage(data) {
  try {
    await decode(data)
  } catch (err) {
    log('decode failed for ' + (data.device && data.device.ieeeAddr) + ': ' + err.message)
  }
  sendDevices()
}

function retryLater(receiver, error) {
  send({ type: 'status', receiver, port: null, error })
  clearTimeout(retryTimer)
  retryTimer = setTimeout(start, RETRY_MS)
}

async function start() {
  clearTimeout(retryTimer)
  let ports
  try { ports = await listPorts() } catch (err) { return retryLater('error', 'Could not list serial ports: ' + err.message) }
  send({ type: 'ports', ports })
  const port = wantedPort === 'auto'
    ? (ports.find((p) => p.dongle) || {}).path
    : (ports.find((p) => p.path === wantedPort) || {}).path
  if (!port) return retryLater('dongle_missing', null)

  send({ type: 'status', receiver: 'starting', port, error: null })
  try {
    // Loaded here, not at the top: the converters take a few seconds to load.
    const { Controller } = require('zigbee-herdsman')
    if (!zhc) zhc = require('zigbee-herdsman-converters')
    decode = require('./zigbee-decode').createDecoder(zhc, (device, payload, data) => handlePayload(device, payload, data.linkquality))
    controller = new Controller({
      network: networkOptions(),
      serialPort: { path: port, adapter: 'zstack' },
      databasePath: path.join(dataDir, 'database.db'),
      databaseBackupPath: path.join(dataDir, 'database.db.backup'),
      backupPath: path.join(dataDir, 'coordinator_backup.json'),
      adapter: { disableLED: false },
      acceptJoiningDeviceHandler: async () => true,
    })
    controller.on('message', onMessage)
    controller.on('deviceJoined', ({ device }) => send({ type: 'pairing', message: 'Button found (' + device.ieeeAddr + '). Keep tapping it...' }))
    controller.on('deviceInterview', ({ status, device }) => {
      const text = { started: 'Setting up the button, keep tapping it...', successful: 'Paired.', failed: 'Setup did not finish. Tap the button a few times, or pair again.' }[status]
      send({ type: 'pairing', message: text, paired: status === 'successful' ? device.ieeeAddr : undefined })
      sendDevices()
    })
    controller.on('deviceLeave', sendDevices)
    controller.on('lastSeenChanged', sendDevices)
    controller.on('permitJoinChanged', ({ permitted, time }) => send({ type: 'pairing', until: permitted && time ? Date.now() + time * 1000 : 0 }))
    // Dongle unplugged: exit so the main process restarts us into the retry loop.
    controller.on('adapterDisconnected', () => { log('dongle disconnected'); process.exit(1) })
    const result = await controller.start()
    log('receiver started on ' + port + ' (' + result + ')')
    send({ type: 'status', receiver: 'ready', port, error: null })
    sendDevices()
  } catch (err) {
    controller = null
    retryLater('error', err.message)
  }
}

process.parentPort.on('message', async ({ data: m }) => {
  try {
    if (m.cmd === 'start') {
      dataDir = m.dataDir
      wantedPort = m.port || 'auto'
      fs.mkdirSync(dataDir, { recursive: true })
      loadHealth()
      await start()
    } else if (m.cmd === 'ports') {
      send({ type: 'ports', ports: await listPorts() })
    } else if (m.cmd === 'pair') {
      if (!controller) return send({ type: 'pairing', until: 0, message: 'Receiver is not connected.' })
      await controller.permitJoin(Math.max(0, Math.min(254, Number(m.seconds) || 0)))
    } else if (m.cmd === 'remove') {
      const device = controller && controller.getDeviceByIeeeAddr(m.ieee)
      if (device) {
        // A sleeping button can't be told to leave; forget it either way.
        try { await device.removeFromNetwork() } catch { device.removeFromDatabase() }
        health.delete(m.ieee)
        saveHealth()
      }
      sendDevices()
    }
  } catch (err) {
    log(m.cmd + ' failed: ' + err.message)
  }
})
