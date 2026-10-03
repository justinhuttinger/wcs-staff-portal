// WCS ABC check-in alert sounds.
//
// The ABC tab itself is muted (webContents.setAudioMuted, see tabs.js) so
// ABC's own check-in / error sounds never play. That also silences anything
// the ABC page plays, so the alert cues are played here instead, from a
// hidden window of our own. abc-scraper.js sends 'abc-alert-sound' with the
// level: 'red' = harsh BEEP BEEP BEEP, 'blue' = two-note chime,
// 'blue-double' = the chime twice, 'party' = a rising fanfare (twice) for a
// check-in milestone ("CELEBRATE 10TH VISIT!" alert).
const { BrowserWindow, ipcMain } = require('electron')
const volumeGuard = require('./volume-guard')

const PAGE = `<!doctype html><meta charset="utf-8"><script>
let ctx = null
function playCue(level) {
  ctx = ctx || new AudioContext()
  if (ctx.state === 'suspended') ctx.resume()
  const now = ctx.currentTime
  const red = level === 'red'
  // red: three square-wave beeps held at full volume; blue: a two-note chime
  // (blue-double: the chime twice, for missing photo / DOB / address).
  // Peaks are set for EQUAL perceived loudness: a square wave is far louder
  // than a decaying sine at the same gain (higher RMS plus harmonics in the
  // ear's most sensitive range), hence 0.22 vs 0.8.
  const chime = [[0, 660, 0.45, 'sine'], [0.2, 990, 0.7, 'sine']]
  const notes = red
    ? [[0, 1040, 0.22, 'square'], [0.32, 1040, 0.22, 'square'], [0.64, 1040, 0.22, 'square']]
    : level === 'blue-double' ? chime.concat(chime.map(([at, f, d, t]) => [at + 1.0, f, d, t])) : chime
  // party: a quick C-E-G-C arpeggio with a sparkle on top, played twice
  // (Justin, 2026-09-30). One fanfare ends at ~1.0s; the repeat starts at 1.15s.
  if (level === 'party') {
    const fanfare = [
      [0, 523, 0.16, 'triangle'], [0.11, 659, 0.16, 'triangle'], [0.22, 784, 0.16, 'triangle'], [0.33, 1047, 0.45, 'triangle'],
      [0.55, 1568, 0.12, 'sine'], [0.63, 2093, 0.12, 'sine'], [0.71, 2637, 0.3, 'sine']]
    notes.length = 0
    notes.push(...fanfare, ...fanfare.map(([at, f, d, t]) => [at + 1.15, f, d, t]))
  }
  const peak = red ? 0.22 : 0.8
  for (const [at, freq, dur, type] of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + at)
    gain.gain.exponentialRampToValueAtTime(peak, now + at + 0.01)
    if (red) gain.gain.setValueAtTime(peak, now + at + dur - 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + at)
    osc.stop(now + at + dur + 0.02)
  }
}
</script>`

let win = null
function ensureWindow() {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE))
  return win
}

let logFn = () => {}
function setup(log = () => {}, mainWindow = null) {
  // Create it up front so the first alert plays without a load delay. The
  // AudioContext is opened right away too, so this app's Volume Mixer channel
  // exists before the first alert and volume-guard can unmute it in time.
  const w = ensureWindow()
  w.webContents.once('did-finish-load', () => {
    w.webContents.executeJavaScript('ctx = ctx || new AudioContext(); ctx.state').catch(() => {})
  })
  // A hidden window would keep the app alive after the main window closes
  // (window-all-closed never fires), so it goes when the main window does.
  if (mainWindow) mainWindow.on('closed', () => { if (win && !win.isDestroyed()) win.destroy() })
  logFn = log
  ipcMain.on('abc-alert-sound', (e, level) => play(level))
  // Keep the PC audible between alerts too; stops with the main window.
  volumeGuard.start(log)
  if (mainWindow) mainWindow.on('closed', () => volumeGuard.stop())
}

// Also called directly from the main process (incoming-call banner).
// opts.keepVolume: the Admin "Test sound" has just set a trial level; don't
// put the saved one back before playing.
function play(level, opts = {}) {
  const lvl = ['red', 'blue', 'blue-double', 'party'].includes(level) ? level : 'blue'
  const w = ensureWindow()
  const run = () => w.webContents.executeJavaScript(`playCue(${JSON.stringify(lvl)})`).catch(err => logFn('[alert-sound] ' + err.message))
  // Unmute / raise to the floor first (volume-guard.js); it answers in
  // milliseconds and never holds the cue back more than a moment.
  const ready = opts.keepVolume ? Promise.resolve() : volumeGuard.ensure()
  ready.finally(() => {
    if (w.isDestroyed()) return
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', run)
    else run()
  })
}

module.exports = { setup, play }
