// Cross-platform path resolution for logs and config.
//
// Windows keeps C:\WCS\* unchanged so existing kiosk RMM deployments
// (Action1 wcs-kiosk.ps1) continue to work without migration. On macOS
// and Linux we use platform-standard user directories.

const path = require('path')
const fs = require('fs')
const os = require('os')

const APP_NAME = 'Portal'

function dataDir() {
  if (process.platform === 'win32') return 'C:\\WCS'
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME)
  return path.join(os.homedir(), '.config', APP_NAME.toLowerCase())
}

function logsDir() {
  if (process.platform === 'win32') return 'C:\\WCS'
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Logs', APP_NAME)
  return path.join(os.homedir(), '.config', APP_NAME.toLowerCase(), 'logs')
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
}

const LOG_FILE = path.join(logsDir(), 'app.log')
const CONFIG_FILE = path.join(dataDir(), 'config.json')
const ABC_URL_FILE = path.join(dataDir(), 'abc-url.txt')

ensureDir(logsDir())

function appendLog(msg) {
  try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n') } catch {}
}

module.exports = {
  APP_NAME,
  dataDir,
  logsDir,
  ensureDir,
  LOG_FILE,
  CONFIG_FILE,
  ABC_URL_FILE,
  appendLog,
}
