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

const DEFAULTS = { enabled: false, base_url: '', username: 'admin', handsets: [1, 2], cooldown_seconds: 60 }

// Pure settings cleanup, shared by the Admin save and every read.
function normalizeSettings(raw) {
  const p = { ...DEFAULTS, ...(raw || {}) }
  const handsets = [...new Set((Array.isArray(p.handsets) ? p.handsets : []).map(Number))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_HANDSETS).sort()
  const cooldown = Number(p.cooldown_seconds)
  return {
    enabled: !!p.enabled,
    base_url: String(p.base_url || '').trim().replace(/\/+$/, ''),
    username: String(p.username || 'admin').trim() || 'admin',
    handsets,
    cooldown_seconds: Number.isFinite(cooldown) && cooldown >= 0 ? Math.round(cooldown) : DEFAULTS.cooldown_seconds,
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

  async page(source, action, handsets) {
    // Start the cooldown before the base answers (a page takes a second or
    // two), and give it back if nothing rang.
    const before = this.lastPageAt
    if (source === 'button') this.lastPageAt = this.now()
    const results = await Promise.all(handsets.map((h) => this.client.pageHandset(h)))
    const result = overall(results)
    if (result === 'failed' && source === 'button') this.lastPageAt = before
    const event = { source, action, targets: handsets, results, result, ts: new Date(this.now()).toISOString() }
    this.onEvent(event)
    return event
  }

  // A press from the call button. Only a single press pages; a mashed button
  // pages once per cooldown.
  async handleButton(action) {
    const s = this.getSettings()
    if (!s.enabled || action !== 'single' || !s.handsets.length) return null
    if (this.lastPageAt && this.now() - this.lastPageAt < s.cooldown_seconds * 1000) {
      const event = { source: 'button', action, targets: s.handsets, results: [], result: 'suppressed', ts: new Date(this.now()).toISOString() }
      this.onEvent(event)
      return event
    }
    return this.page('button', action, s.handsets)
  }

  // Admin "Test page": no cooldown, and never starts one.
  testPage(handsets) {
    return this.page('test', 'single', handsets)
  }
}

// ---- Electron wiring (WCS ABC only; see main.js) ----

let pager = null
let client = null

function setup({ log, readConfig, writeConfig, playSound }) {
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
  pager = new Pager({
    getSettings,
    client,
    onEvent: (ev) => {
      log(`[pager] ${ev.source} ${ev.result} targets=${ev.targets.join(',')}` +
        ev.results.filter((r) => !r.ok).map((r) => ` hs${r.handset}: ${r.error}`).join(''))
      if (ev.source === 'button' && ev.result !== 'suppressed') playSound()
    },
  })

  ipcMain.handle('abc-admin:pager-get', () => ({ settings: getSettings(), hasPassword: !!readPassword() }))
  ipcMain.handle('abc-admin:pager-save', (e, input) => {
    const s = normalizeSettings(input)
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
    log('[pager] saved enabled=' + s.enabled + ' handsets=' + s.handsets.join(',') + ' cooldown=' + s.cooldown_seconds)
    return { success: true }
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

// Entry point for the call button (Zigbee worker, added separately).
function handleButton(action) {
  return pager ? pager.handleButton(action) : Promise.resolve(null)
}

module.exports = { Pager, normalizeSettings, setup, handleButton }
