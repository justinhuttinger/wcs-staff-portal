// WCS ABC pager-only: password in front of the tray's Call button settings
// and Quit, so whoever is near that PC can't change or stop the pager.
//
// The password is set from Action1 (scripts/action1/set-pager-pc.ps1), which
// stores only a PBKDF2-SHA256 hash in C:\WCS\config.json `pager_lock`:
// { salt, iterations, hash } (base64). No `pager_lock` = no password asked.
const crypto = require('crypto')
const path = require('path')

const MAX_TRIES = 5
const LOCKOUT_MS = 60 * 1000

// Pure check, shared with the tests.
function verify(lock, password) {
  if (!lock || !lock.salt || !lock.hash) return true
  const iterations = Number(lock.iterations) || 100000
  const expected = Buffer.from(String(lock.hash), 'base64')
  if (!expected.length) return false
  const actual = crypto.pbkdf2Sync(String(password || ''), Buffer.from(String(lock.salt), 'base64'), iterations, expected.length, 'sha256')
  return crypto.timingSafeEqual(actual, expected)
}

let fails = 0
let lockedUntil = 0
let promptWin = null

// Resolves true once the right password is typed (or none is set), false if
// the window is closed. `action` is shown in the prompt ("open settings").
function unlock({ readConfig, log, action }) {
  const { BrowserWindow, ipcMain } = require('electron')
  const lock = (readConfig() || {}).pager_lock
  if (!lock || !lock.hash) return Promise.resolve(true)
  if (promptWin && !promptWin.isDestroyed()) { promptWin.focus(); return Promise.resolve(false) }

  return new Promise((resolve) => {
    let done = false
    const win = promptWin = new BrowserWindow({
      width: 360,
      height: 210,
      title: 'WCS Call Button',
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'pager-lock-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    const onTry = (e, password) => {
      if (e.sender !== win.webContents) return { ok: false }
      const wait = lockedUntil - Date.now()
      if (wait > 0) return { ok: false, error: `Too many tries. Wait ${Math.ceil(wait / 1000)}s.` }
      if (verify(lock, password)) {
        fails = 0
        done = true
        log('[pager-lock] unlocked to ' + action)
        resolve(true)
        setImmediate(() => { if (!win.isDestroyed()) win.close() })
        return { ok: true }
      }
      fails += 1
      log('[pager-lock] wrong password (' + action + ')')
      if (fails >= MAX_TRIES) { fails = 0; lockedUntil = Date.now() + LOCKOUT_MS }
      return { ok: false, error: 'Wrong password' }
    }
    ipcMain.handle('pager-lock:try', onTry)
    ipcMain.handle('pager-lock:action', () => action)
    win.on('closed', () => {
      ipcMain.removeHandler('pager-lock:try')
      ipcMain.removeHandler('pager-lock:action')
      promptWin = null
      if (!done) resolve(false)
    })
    win.loadFile(path.join(__dirname, '..', 'ui', 'pager-lock.html'))
  })
}

module.exports = { verify, unlock }
