// WCS ABC call-button pager: a member presses the front desk button and the
// DP752 handsets ring. All paging runs on this PC; nothing here depends on
// the API being reachable.
//
// Settings live in C:\WCS\config.json under `pager` (WCS ABC Settings ->
// Admin). Only the one PC per club with `enabled: true` pages. The phone
// base password is kept separately, encrypted with safeStorage, and never
// leaves the main process.
const fs = require('fs')
const path = require('path')
const { DP752Client, MAX_HANDSETS } = require('./dp752-client')

const DEFAULTS = {
  enabled: false, base_url: '', username: 'admin', handsets: [1, 2], cooldown_seconds: 60,
  // Call button receiver: 'auto' finds the dongle by its USB id.
  zigbee_port: 'auto',
  // Names for paired buttons, by Zigbee address. Every button pages the same handsets.
  buttons: {},
}

// Pure settings cleanup, shared by the Admin save and every read.
function normalizeSettings(raw) {
  const p = { ...DEFAULTS, ...(raw || {}) }
  const handsets = [...new Set((Array.isArray(p.handsets) ? p.handsets : []).map(Number))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_HANDSETS).sort()
  const cooldown = Number(p.cooldown_seconds)
  const buttons = {}
  for (const [ieee, name] of Object.entries(p.buttons && typeof p.buttons === 'object' ? p.buttons : {})) {
    const text = String(name || '').trim().slice(0, 40)
    if (/^0x[0-9a-f]{16}$/i.test(ieee) && text) buttons[ieee.toLowerCase()] = text
  }
  return {
    enabled: !!p.enabled,
    base_url: String(p.base_url || '').trim().replace(/\/+$/, ''),
    username: String(p.username || 'admin').trim() || 'admin',
    handsets,
    cooldown_seconds: Number.isFinite(cooldown) && cooldown >= 0 ? Math.round(cooldown) : DEFAULTS.cooldown_seconds,
    zigbee_port: /^COM\d{1,3}$/i.test(String(p.zigbee_port)) ? String(p.zigbee_port).toUpperCase() : 'auto',
    buttons,
  }
}

function overall(results) {
  const ok = results.filter((r) => r.ok).length
  return ok === results.length ? 'ok' : ok ? 'partial' : 'failed'
}

class Pager {
  // deps: getSettings() -> normalized settings, client (pageHandset),
  // now() for tests, onEvent(event) for the staff cue / logging.
  constructor({ getSettings, client, now = Date.now, onEvent = () => {} }) {
    this.getSettings = getSettings
    this.client = client
    this.now = now
    this.onEvent = onEvent
    this.lastPageAt = 0
  }

  async page(source, action, handsets, button = null) {
    // Start the cooldown before the base answers (a page takes a second or
    // two), and give it back if nothing rang.
    const before = this.lastPageAt
    if (source === 'button') this.lastPageAt = this.now()
    const results = await Promise.all(handsets.map((h) => this.client.pageHandset(h)))
    const result = overall(results)
    if (result === 'failed' && source === 'button') this.lastPageAt = before
    const event = { source, action, targets: handsets, results, result, button, ts: new Date(this.now()).toISOString() }
    this.onEvent(event)
    return event
  }

  // A press from the call button. Only a single press pages; a mashed button
  // pages once per cooldown.
  // `button` ({ ieee, name, battery, linkquality }) only travels to the log.
  async handleButton(action, button = null) {
    const s = this.getSettings()
    if (!s.enabled || action !== 'single' || !s.handsets.length) return null
    if (this.lastPageAt && this.now() - this.lastPageAt < s.cooldown_seconds * 1000) {
      const event = { source: 'button', action, targets: s.handsets, results: [], result: 'suppressed', button, ts: new Date(this.now()).toISOString() }
      this.onEvent(event)
      return event
    }
    return this.page('button', action, s.handsets, button)
  }

  // Admin "Test page": no cooldown, and never starts one.
  testPage(handsets) {
    return this.page('test', 'single', handsets)
  }
}

// ---- Electron wiring (WCS ABC only; see main.js) ----

let pager = null
let client = null
const zigbee = require('./zigbee')

function setup({ log, readConfig, writeConfig, playSound, getClub }) {
  const { app, ipcMain, safeStorage } = require('electron')
  const credFile = path.join(app.getPath('userData'), 'pager-credential')

  const getSettings = () => normalizeSettings((readConfig() || {}).pager)
  const readPassword = () => {
    try { return safeStorage.decryptString(fs.readFileSync(credFile)) } catch { return '' }
  }
  const writePassword = (pw) => fs.writeFileSync(credFile, safeStorage.encryptString(pw))

  client = new DP752Client(() => {
    const s = getSettings()
    return { baseUrl: s.base_url, username: s.username, password: readPassword() }
  })
  // Page log: reported to the API after the fact, never in the paging path.
  const reportEvent = require('./page-reporter').setup({ log, getClub })
  pager = new Pager({
    getSettings,
    client,
    onEvent: (ev) => {
      reportEvent(ev)
      log(`[pager] ${ev.source} ${ev.result} targets=${ev.targets.join(',')}` +
        ev.results.filter((r) => !r.ok).map((r) => ` hs${r.handset}: ${r.error}`).join(''))
      if (ev.source === 'button' && ev.result !== 'suppressed') playSound()
    },
  })

  // The receiver runs only on the club's pager PC.
  const syncReceiver = (before) => {
    const s = getSettings()
    if (!s.enabled) return zigbee.stop()
    if (before && before.enabled && before.zigbee_port !== s.zigbee_port) return zigbee.restart()
    zigbee.start({
      log,
      getPort: () => getSettings().zigbee_port,
      onButton: (m) => {
        log('[pager] button ' + m.ieee + ' ' + m.action + ' lqi=' + m.linkquality)
        const dev = zigbee.getState().devices.find((d) => d.ieee === m.ieee) || {}
        pager.handleButton(m.action, {
          ieee: m.ieee, name: getSettings().buttons[String(m.ieee).toLowerCase()] || '',
          battery: dev.battery == null ? null : Math.round(dev.battery), linkquality: m.linkquality == null ? null : m.linkquality,
        })
      },
    })
  }
  syncReceiver()

  // Keep the phone base session warm on the pager PC, so a press doesn't
  // have to wait for a login (several seconds on this base).
  const keepWarm = () => {
    if (getSettings().enabled) client.handsetStatus().catch((err) => log('[pager] phone base check failed: ' + err.message))
  }
  keepWarm()
  setInterval(keepWarm, 4 * 60 * 1000).unref()
  app.on('before-quit', () => zigbee.stop())

  ipcMain.handle('abc-admin:pager-get', () => ({ settings: getSettings(), hasPassword: !!readPassword() }))
  ipcMain.handle('abc-admin:pager-save', (e, input) => {
    const before = getSettings()
    // Button names are edited separately (button-rename), not by this form.
    const s = normalizeSettings({ ...input, buttons: before.buttons })
    if (s.enabled) {
      let url
      try { url = new URL(s.base_url) } catch { url = null }
      if (!url || url.protocol !== 'https:') return { success: false, error: 'Phone base address must look like https://192.168.1.134' }
      if (!s.handsets.length) return { success: false, error: 'Pick at least one handset to page' }
    }
    const pw = String((input && input.password) || '')
    if (pw) {
      if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'This PC cannot store the password securely' }
      writePassword(pw)
      client.sid = null
    }
    writeConfig({ ...(readConfig() || {}), pager: s })
    log('[pager] saved enabled=' + s.enabled + ' handsets=' + s.handsets.join(',') + ' cooldown=' + s.cooldown_seconds + ' port=' + s.zigbee_port)
    syncReceiver(before)
    return { success: true }
  })

  // Call button receiver + paired buttons (polled by the Admin window).
  ipcMain.handle('abc-admin:button-state', () => {
    const names = getSettings().buttons
    const st = zigbee.getState()
    return { ...st, devices: st.devices.map((d) => ({ ...d, name: names[d.ieee.toLowerCase()] || '' })) }
  })
  ipcMain.handle('abc-admin:button-ports', () => { zigbee.refreshPorts(); return true })
  ipcMain.handle('abc-admin:button-pair', (e, seconds) => { zigbee.pair(seconds ? 120 : 0); return true })
  ipcMain.handle('abc-admin:button-remove', (e, ieee) => {
    zigbee.remove(String(ieee))
    const cfg = readConfig() || {}
    const s = getSettings()
    delete s.buttons[String(ieee).toLowerCase()]
    writeConfig({ ...cfg, pager: s })
    log('[pager] removed button ' + ieee)
    return true
  })
  ipcMain.handle('abc-admin:button-rename', (e, ieee, name) => {
    const s = getSettings()
    const next = normalizeSettings({ ...s, buttons: { ...s.buttons, [String(ieee).toLowerCase()]: name } })
    if (!String(name || '').trim()) delete next.buttons[String(ieee).toLowerCase()]
    writeConfig({ ...(readConfig() || {}), pager: next })
    return true
  })
  ipcMain.handle('abc-admin:pager-status', async () => {
    try { return { success: true, handsets: await client.handsetStatus() } } catch (err) { return { success: false, error: err.message } }
  })
  ipcMain.handle('abc-admin:pager-test', async (e, handsets) => {
    const list = normalizeSettings({ handsets }).handsets
    if (!list.length) return { success: false, error: 'Pick at least one handset to page' }
    return { success: true, event: await pager.testPage(list) }
  })
}

// Entry point for a button press (the receiver calls it; see syncReceiver).
function handleButton(action, button) {
  return pager ? pager.handleButton(action, button) : Promise.resolve(null)
}

module.exports = { Pager, normalizeSettings, setup, handleButton }
