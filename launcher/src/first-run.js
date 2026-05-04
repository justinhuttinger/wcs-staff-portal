// First-run kiosk-config picker for non-Windows installs.
//
// On Windows the NSIS installer (installer.nsh) shows a custom page that
// asks the installing admin to pick a location, then writes config.json with
// the chosen location and its ABC Financial URL. NSIS doesn't run on macOS
// or Linux, and pkg/dmg postinstall scripts can't show GUI, so we replicate
// that prompt inside the Electron app on first launch.
//
// Behavior matches installer.nsh:
//   - skipped if config.json already exists
//   - same dropdown of seven locations
//   - same ABC Financial URL per location
//   - writes the same JSON shape: { location, abc_url }
//   - cancel = abort launch (user must pick a location)

const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { CONFIG_FILE, WCS_DIR } = require('./config')

const LOCATION_ABC_URLS = {
  Salem:       'https://prod02.abcfinancial.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=9a84c8e908a74fc494d114a36a48c969&wizardFirstLoad=1',
  Keizer:      'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=cff423f895d340888d67812e4ee2409f&wizardFirstLoad=1',
  Eugene:      'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=e3eae001c08148038497e1379344f0e0&wizardFirstLoad=1',
  Springfield: 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=310aa987194d4e4295aff333c6e69df9&wizardFirstLoad=1',
  Clackamas:   'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=4bab4e83fd394d5d81970af7b88e4426&wizardFirstLoad=1',
  Milwaukie:   'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=da82fd71e8ac4edb989e11207a92ec8d&wizardFirstLoad=1',
  Medford:     'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=87c18f3a76c4400198c951d50d5d94a4&wizardFirstLoad=1',
}

function pickerHtml() {
  const options = Object.keys(LOCATION_ABC_URLS)
    .map(name => `<option value="${name}">${name}</option>`)
    .join('')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Configure Kiosk</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         margin: 0; padding: 28px; background: #1a1a2e; color: #fff; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p  { font-size: 13px; margin: 0 0 20px; opacity: 0.85; line-height: 1.4; }
  label { display: block; font-size: 12px; margin-bottom: 6px; opacity: 0.85; }
  select { width: 100%; padding: 8px 10px; font-size: 14px; border-radius: 6px;
           border: 1px solid #444; background: #fff; color: #111; }
  .row { display: flex; gap: 8px; margin-top: 24px; justify-content: flex-end; }
  button { padding: 8px 16px; font-size: 13px; border-radius: 6px; border: 0;
           cursor: pointer; }
  button.primary { background: #C8102E; color: #fff; }
  button.secondary { background: transparent; color: #fff; border: 1px solid #555; }
</style></head><body>
  <h1>Configure this Portal kiosk</h1>
  <p>Select the location for this kiosk. The ABC Financial URL will be configured
     automatically and saved to <code>config.json</code>.</p>
  <label for="loc">Location</label>
  <select id="loc">${options}</select>
  <div class="row">
    <button class="secondary" id="cancel">Cancel</button>
    <button class="primary"  id="save">Save</button>
  </div>
<script>
  const { ipcRenderer } = require('electron')
  document.getElementById('save').addEventListener('click', () => {
    ipcRenderer.send('first-run-result', { location: document.getElementById('loc').value })
  })
  document.getElementById('cancel').addEventListener('click', () => {
    ipcRenderer.send('first-run-result', null)
  })
</script>
</body></html>`
}

async function ensureKioskConfig() {
  // Preserve existing config on re-install / upgrade — same guard as installer.nsh.
  if (fs.existsSync(CONFIG_FILE)) return

  try { fs.mkdirSync(WCS_DIR, { recursive: true }) } catch {}

  const win = new BrowserWindow({
    width: 480,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Configure Kiosk',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pickerHtml()))

  const choice = await new Promise((resolve) => {
    let settled = false
    const handler = (_e, payload) => { settled = true; resolve(payload) }
    ipcMain.once('first-run-result', handler)
    win.on('closed', () => {
      if (!settled) resolve(null)
    })
  })

  if (!win.isDestroyed()) win.close()

  if (!choice || !choice.location || !LOCATION_ABC_URLS[choice.location]) {
    // Match installer.nsh behavior — refuse to launch without a valid pick.
    app.exit(0)
    return
  }

  const config = {
    location: choice.location,
    abc_url: LOCATION_ABC_URLS[choice.location],
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

module.exports = { ensureKioskConfig, LOCATION_ABC_URLS }
