// Every ~30s: report printers, fetch claimed jobs, silent-print each to the
// admin-selected printer, and ack results on the following poll.
const { BrowserWindow } = require('electron')
const { API_URL, getLocation } = require('./config')
const { getInstallId, getHostname } = require('./install-id')
const { listPrinters } = require('./printers')

const POLL_MS = 30 * 1000
let timer = null
let log = () => {}
let pendingAcks = []   // [{ id, status, error }]

function setLogger(fn) { log = fn || (() => {}) }

// Print one receipt URL to deviceName via an offscreen window. Resolves to ack.
function printJob(job, deviceName) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
    let done = false
    const finish = (status, error) => {
      if (done) return
      done = true
      try { if (!w.isDestroyed()) w.close() } catch {}
      resolve({ id: job.id, status, error })
    }
    const guard = setTimeout(() => finish('failed', 'load timeout'), 20000)
    w.webContents.once('did-finish-load', () => {
      clearTimeout(guard)
      w.webContents.print({ silent: true, deviceName, printBackground: true }, (ok, reason) => {
        finish(ok ? 'printed' : 'failed', ok ? null : reason)
      })
    })
    w.loadURL(job.receipt_url).catch(e => finish('failed', String(e && e.message)))
  })
}

async function pollOnce(getWindow) {
  try {
    const win = getWindow && getWindow()
    const printers = await listPrinters(win)
    const body = {
      install_id: getInstallId(), hostname: getHostname(), location: getLocation(),
      printers, acks: pendingAcks,
    }
    const headers = { 'Content-Type': 'application/json' }
    if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY
    const res = await fetch(API_URL + '/print/poll', { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) { log('[print] poll non-OK ' + res.status); return }
    pendingAcks = []   // server received them
    const data = await res.json()
    if (!data || !data.enabled || !data.selected_printer || !Array.isArray(data.jobs) || !data.jobs.length) return
    for (const job of data.jobs) {
      log('[print] printing job ' + job.id + ' -> ' + data.selected_printer)
      const ack = await printJob(job, data.selected_printer)
      pendingAcks.push(ack)
      log('[print] job ' + job.id + ' ' + ack.status + (ack.error ? ' (' + ack.error + ')' : ''))
    }
  } catch (err) {
    log('[print] poll failed: ' + (err && err.message))
  }
}

function start({ getWindow, logger } = {}) {
  setLogger(logger)
  if (timer) return
  setTimeout(() => pollOnce(getWindow), 25 * 1000)
  timer = setInterval(() => pollOnce(getWindow), POLL_MS)
}
function stop() { if (timer) { clearInterval(timer); timer = null } }

module.exports = { start, stop, pollOnce, setLogger }
