// WCS ABC check-in alert sounds.
//
// The ABC tab itself is muted (webContents.setAudioMuted, see tabs.js) so
// ABC's own check-in / error sounds never play. That also silences anything
// the ABC page plays, so the alert cues are played here instead, from a
// hidden window of our own. abc-scraper.js sends 'abc-alert-sound' with the
// level: 'red' = harsh BEEP BEEP BEEP, 'blue' = two-note chime,
// 'blue-double' = the chime twice.
const { BrowserWindow, ipcMain } = require('electron')

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

function setup(log = () => {}, mainWindow = null) {
  // Create it up front so the first alert plays without a load delay.
  ensureWindow()
  // A hidden window would keep the app alive after the main window closes
  // (window-all-closed never fires), so it goes when the main window does.
  if (mainWindow) mainWindow.on('closed', () => { if (win && !win.isDestroyed()) win.destroy() })
  ipcMain.on('abc-alert-sound', (e, level) => {
    const lvl = ['red', 'blue', 'blue-double'].includes(level) ? level : 'blue'
    const w = ensureWindow()
    const play = () => w.webContents.executeJavaScript(`playCue(${JSON.stringify(lvl)})`).catch(err => log('[alert-sound] ' + err.message))
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', play)
    else play()
  })
}

module.exports = { setup }
