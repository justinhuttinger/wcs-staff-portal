const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')
const LOG_FILE = 'C:\\WCS\\app.log'
function log(msg) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n') } catch {} }
log('=== APP STARTING ===')
const { PORTAL_URL, getAbcUrl, getLocation, readConfig, writeConfig } = require('./config')
const TabManager = require('./tabs')
const { showOverlay, closeOverlay, onResize: onOverlayResize } = require('./overlay')
const { createTray } = require('./tray')
const auth = require('./auth')

// --- Auto-updater setup ---
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.logger = { info: log, warn: log, error: log }

autoUpdater.on('checking-for-update', () => log('[Updater] Checking for updates...'))
autoUpdater.on('update-available', (info) => log('[Updater] Update available: v' + info.version))
autoUpdater.on('update-not-available', () => log('[Updater] App is up to date'))
autoUpdater.on('download-progress', (p) => log('[Updater] Downloading: ' + Math.round(p.percent) + '%'))
autoUpdater.on('error', (err) => log('[Updater] Error: ' + err.message))

autoUpdater.on('update-downloaded', (info) => {
  log('[Updater] Update downloaded: v' + info.version)
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: 'A new version of Portal (v' + info.version + ') has been downloaded.',
    detail: 'The app will restart to apply the update.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) {
      autoUpdater.quitAndInstall()
    }
  })
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

const TAB_BAR_HEIGHT = 52
let mainWindow = null
let tabManager = null

app.on('ready', () => {
  const { session } = require('electron')

  // Strip X-Frame-Options on both default and persistent sessions
  const stripFrameHeaders = (details, callback) => {
    const headers = { ...details.responseHeaders }
    delete headers['x-frame-options']
    delete headers['X-Frame-Options']
    callback({ responseHeaders: headers })
  }
  session.defaultSession.webRequest.onHeadersReceived(stripFrameHeaders)

  const { session: ses } = require('electron')
  const persistSes = ses.fromPartition('persist:wcs-portal')
  persistSes.webRequest.onHeadersReceived(stripFrameHeaders)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Portal',
    icon: require('path').join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
  })

  mainWindow.maximize()
  createTray(mainWindow)

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
  })

  tabManager = new TabManager(mainWindow, TAB_BAR_HEIGHT)
  tabManager.initTabBar()

  // Check for updates after launch (silent background check)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => log('[Updater] Check failed: ' + err.message))
  }, 5000)

  // Load portal tab immediately — portal handles its own login UI
  const location = getLocation()
  const abcUrl = getAbcUrl()
  const portalUrl = `${PORTAL_URL}?location=${location}` + (abcUrl ? `&abc_url=${encodeURIComponent(abcUrl)}` : '')

  tabManager.createTab(portalUrl, 'Portal', {
    closable: false,
    preload: path.join(__dirname, 'portal-preload.js'),
  })

  // Auth state bridge — portal notifies us when user logs in/out
  ipcMain.on('portal-auth-login', (e, token, userName) => {
    log('Portal auth: user logged in')
    auth.setToken(token)
    auth.fetchAllCredentials().then(() => {
      log('Credentials cached for session')
    }).catch(err => {
      log('Failed to cache credentials: ' + err.message)
    })
    // Send user info to tab bar
    if (tabManager?.tabBarView) {
      tabManager.tabBarView.webContents.send('user-updated', { name: userName || '' })
    }
  })

  ipcMain.on('portal-auth-logout', () => {
    log('Portal auth: user logged out')
    auth.logout()

    // Close all tabs except Portal
    tabManager.closeAllExceptPortal()

    // Clear all session cookies/storage so GHL etc. sessions don't persist
    const ses = require('electron').session.fromPartition('persist:wcs-portal')
    ses.clearStorageData().catch(() => {})
    ses.clearCache().catch(() => {})
    log('Session data cleared, all tabs closed')

    // Clear user from tab bar
    if (tabManager?.tabBarView) {
      tabManager.tabBarView.webContents.send('user-updated', { name: '' })
    }
  })

  // Tab bar sign-out button — tell the portal to trigger its own logout
  ipcMain.on('tabbar-signout', () => {
    const portalTab = tabManager.tabs.get(1)
    if (portalTab) {
      portalTab.view.webContents.send('trigger-signout')
    }
  })

  // Credential capture — native dialog prompt
  const SERVICE_NAMES = {
    abc: 'ABC Financial',
    ghl: 'Grow (GHL)',
    wheniwork: 'WhenIWork',
    paychex: 'Paychex',
  }

  ipcMain.on('credential-captured', async (e, { service, username, password }) => {
    if (!auth.isLoggedIn()) return

    const existing = auth.getCachedCredential(service)
    if (existing && existing.username === username && existing.password === password) return

    log('Credential captured for: ' + service)

    const serviceName = SERVICE_NAMES[service] || service
    const isUpdate = !!existing
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: [isUpdate ? 'Update' : 'Save', 'Not now'],
      defaultId: 0,
      title: isUpdate ? 'Update Login' : 'Save Login',
      message: isUpdate
        ? `Update login for ${serviceName}?`
        : `Save login for ${serviceName}?`,
      detail: isUpdate
        ? `Username: ${username}\nYour stored credentials will be updated.`
        : `Username: ${username}`,
    })

    if (response === 0) {
      try {
        await auth.storeCredential(service, username, password)
        log('Credential ' + (isUpdate ? 'updated' : 'saved') + ' for: ' + service)
      } catch (err) {
        log('Failed to save credential: ' + err.message)
      }
    }
  })

  // Tab IPC
  ipcMain.on('switch-tab', (e, id) => tabManager.switchTo(id))
  ipcMain.on('close-tab', (e, id) => tabManager.closeTab(id))
  ipcMain.on('tabs-ready', () => tabManager.notifyTabBar())

  ipcMain.on('open-in-tab', (e, url) => {
    if (tabManager.onNewWindow) tabManager.onNewWindow(url)
  })

  // Window controls
  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow.close())

  // ABC scraper IPC
  let latestMemberData = {}

  ipcMain.on('abc-member-data', (e, data) => { latestMemberData = data })

  ipcMain.on('abc-signup-detected', (e, data) => {
    latestMemberData = { ...latestMemberData, ...data }
    log('SIGNUP DETECTED - calling showOverlay')
    showOverlay(latestMemberData, mainWindow, tabManager)
    latestMemberData = {}
  })

  // Credential IPC — preload scripts request creds for auto-fill
  ipcMain.handle('get-credentials', async (e, service) => {
    const cred = auth.getCachedCredential(service)
    if (cred) return { username: cred.username, password: cred.password }
    try {
      await auth.fetchCredentials(service)
      const fetched = auth.getCachedCredential(service)
      if (fetched) return { username: fetched.username, password: fetched.password }
    } catch {}
    return null
  })

  // Kiosk config IPC (admin only)
  ipcMain.handle('get-kiosk-config', () => readConfig())
  ipcMain.handle('set-kiosk-config', (e, config) => {
    writeConfig(config)
    // Reload portal tab with updated location/abc_url
    const portalTab = tabManager.tabs.get(1)
    if (portalTab) {
      const newLocation = config.location || getLocation()
      const newAbcUrl = config.abc_url || getAbcUrl()
      const portalUrl = `${PORTAL_URL}?location=${newLocation}` + (newAbcUrl ? `&abc_url=${encodeURIComponent(newAbcUrl)}` : '')
      portalTab.view.webContents.loadURL(portalUrl)
    }
    return { success: true }
  })

  // Map URLs to tab names
  const URL_TAB_NAMES = {
    'abcfinancial.com': 'ABC Financial',
    'app.westcoaststrength.com': 'Grow',
    'gohighlevel.com': 'Grow',
    'wheniwork.com': 'WhenIWork',
    'paychex.com': 'Paychex',
    'myapps.paychex.com': 'Paychex',
    'operandio.com': 'Operandio',
    'ourproshop.com': 'VistaPrint',
    'memberservices.westcoaststrength.com': 'Cancel Tool',
    'forms.clickup.com': 'Form',
    'reporting.strengthcoastwest.com': 'Tickets',
  }

  function getTabName(url) {
    try {
      const parsed = new URL(url)
      // Check for reporting hash
      if (parsed.hash && parsed.hash.startsWith('#reporting')) return 'Reporting'
      const hostname = parsed.hostname
      for (const [domain, name] of Object.entries(URL_TAB_NAMES)) {
        if (hostname.includes(domain) || hostname === domain) return name
      }
      // Fallback: use hostname without www/app prefix
      return hostname.replace(/^(www|app)\./, '').split('.')[0]
        .charAt(0).toUpperCase() + hostname.replace(/^(www|app)\./, '').split('.')[0].slice(1)
    } catch { return 'Tab' }
  }

  tabManager.onNewWindow = (url) => {
    const abcUrl = getAbcUrl()
    if (url.includes('abcfinancial.com') || url.includes('kiosk.html')) {
      const abcDirect = abcUrl || 'https://prod02.abcfinancial.com'
      tabManager.createTab(abcDirect, 'ABC Financial', {
        preload: path.join(__dirname, 'abc-scraper.js'),
      })
    } else if (url.includes('#reporting')) {
      // Reporting tab uses portal preload for auth bridge
      tabManager.createTab(url, 'Reporting', {
        preload: path.join(__dirname, 'portal-preload.js'),
      })
    } else if (url !== 'about:blank' && !url.startsWith('chrome')) {
      tabManager.createTab(url, getTabName(url), { preload: path.join(__dirname, 'credential-capture.js') })
    }
  }

  app.on('web-contents-created', (event, contents) => {
    log('NEW WEBCONTENT: ' + contents.getType() + ' ' + contents.getURL())
    contents.on('did-finish-load', () => {
      log('LOADED: ' + contents.getType() + ' ' + contents.getURL())
    })
  })

  mainWindow.on('resize', () => {
    tabManager.layoutViews()
    onOverlayResize()
  })

  const { globalShortcut } = require('electron')
  globalShortcut.register('F12', () => {
    const active = tabManager.tabs.get(tabManager.activeTabId)
    if (active) active.view.webContents.openDevTools()
  })

  // ---------------------------------------------------------------------------
  // Trainerize Push Notification Automation
  // ---------------------------------------------------------------------------
  const TRAINERIZE_LOCATION_MAP = {
    salem: 'West Coast Strength - Salem',
    keizer: 'West Coast Strength - Keizer',
    eugene: 'West Coast Strength - Eugene',
    springfield: 'West Coast Strength - Springfield',
    clackamas: 'West Coast Strength - Clackamas',
    milwaukie: 'East Side Athletic Club - Milwaukie',
  }

  ipcMain.handle('run-notification', async (e, params) => {
    const { title, message, locations, sendTiming, scheduledDate, scheduledTime } = params
    const config = readConfig()
    const email = config.trainerize_email || 'justin@wcstrength.com'
    const password = config.trainerize_password || 'Jellybean31!'

    log('[Notification] Starting automation: ' + title)

    // Create a hidden BrowserWindow for the automation
    const { session: ses } = require('electron')
    const automationWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        session: ses.fromPartition('persist:trainerize-automation'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    try {
      const page = automationWindow.webContents

      // Helper to run JS in the page
      const run = (code) => page.executeJavaScript(code)
      const wait = (ms) => new Promise(r => setTimeout(r, ms))

      // 1. Login
      log('[Notification] Loading login page...')
      await page.loadURL('https://westcoaststrength.trainerize.com/app/login')
      await wait(3000)

      await run(`document.querySelector('input[type="email"], input[name="email"], #email').value = ${JSON.stringify(email)}`)
      await run(`document.querySelector('input[type="email"], input[name="email"], #email').dispatchEvent(new Event('input', {bubbles:true}))`)
      await run(`document.querySelector('input[type="password"], input[name="password"], #password').value = ${JSON.stringify(password)}`)
      await run(`document.querySelector('input[type="password"], input[name="password"], #password').dispatchEvent(new Event('input', {bubbles:true}))`)
      await wait(500)
      await run(`(document.querySelector('button[type="submit"]') || document.querySelector('.btn-login') || [...document.querySelectorAll('button')].find(b => b.textContent.includes('Log'))).click()`)
      log('[Notification] Logging in...')
      await wait(5000)

      // 2. Navigate to Announcements
      log('[Notification] Navigating to Announcements...')
      await run(`([...document.querySelectorAll('a, [role="menuitem"], li')].find(el => el.textContent.includes('Announcements'))).click()`)
      await wait(3000)

      // 3. Click Push Notifications tab if not already selected
      try {
        await run(`{
          const tab = [...document.querySelectorAll('a, button, [role="tab"]')].find(el => el.textContent.includes('Push'));
          if (tab) tab.click();
        }`)
        await wait(1000)
      } catch {}

      // 4. Click NEW
      log('[Notification] Clicking NEW...')
      await run(`([...document.querySelectorAll('button, a')].find(el => el.textContent.trim() === 'NEW' || el.textContent.trim() === 'New')).click()`)
      await wait(3000)

      // 5. Fill Title
      log('[Notification] Filling form...')
      await run(`{
        const inputs = document.querySelectorAll('input[type="text"]');
        const titleInput = inputs[0];
        if (titleInput) {
          titleInput.focus();
          titleInput.value = ${JSON.stringify(title.slice(0, 65))};
          titleInput.dispatchEvent(new Event('input', {bubbles:true}));
          titleInput.dispatchEvent(new Event('change', {bubbles:true}));
        }
      }`)
      await wait(500)

      // 6. Set send timing
      if (sendTiming === 'now') {
        log('[Notification] Setting "Start sending immediately"...')
        await run(`{
          const sel = document.querySelector('select');
          if (sel) {
            sel.value = 'now';
            sel.dispatchEvent(new Event('change', {bubbles:true}));
          } else {
            const dd = [...document.querySelectorAll('[class*="dropdown"], [class*="select"], [role="listbox"]')].find(el => el.textContent.includes('Schedule'));
            if (dd) dd.click();
          }
        }`)
        await wait(500)
        await run(`{
          const opt = [...document.querySelectorAll('option, li, [role="option"]')].find(el => el.textContent.includes('immediately'));
          if (opt) opt.click ? opt.click() : (opt.selected = true);
        }`)
        await wait(500)
      }

      // 7. Select locations
      log('[Notification] Selecting locations...')
      // Click the location field to open it
      await run(`{
        const field = [...document.querySelectorAll('label, span, div')].find(el => el.textContent.includes('Which locations'));
        if (field) {
          const input = field.closest('div')?.querySelector('input') || field.nextElementSibling?.querySelector('input') || field.nextElementSibling;
          if (input) input.click();
        }
      }`)
      await wait(1000)

      // Expand "All locations"
      await run(`{
        const allLoc = [...document.querySelectorAll('span, label, div')].find(el => el.textContent.trim() === 'All locations');
        if (allLoc) {
          const arrow = allLoc.previousElementSibling || allLoc.parentElement.querySelector('[class*="arrow"], [class*="toggle"], [class*="expand"], svg, i');
          if (arrow) arrow.click();
          else allLoc.click();
        }
      }`)
      await wait(1000)

      if (locations.includes('all')) {
        await run(`{
          const cb = [...document.querySelectorAll('input[type="checkbox"]')].find(cb => cb.closest('label, div')?.textContent.includes('All locations'));
          if (cb && !cb.checked) cb.click();
        }`)
      } else {
        for (const slug of locations) {
          const label = TRAINERIZE_LOCATION_MAP[slug]
          if (!label) continue
          await run(`{
            const cb = [...document.querySelectorAll('input[type="checkbox"]')].find(cb => cb.closest('label, div')?.textContent.includes(${JSON.stringify(label)}));
            if (cb && !cb.checked) cb.click();
          }`)
          await wait(300)
        }
      }
      await wait(500)

      // 8. Fill Message
      log('[Notification] Filling message...')
      await run(`{
        const ta = document.querySelector('textarea');
        if (ta) {
          ta.focus();
          ta.value = ${JSON.stringify(message.slice(0, 120))};
          ta.dispatchEvent(new Event('input', {bubbles:true}));
          ta.dispatchEvent(new Event('change', {bubbles:true}));
        }
      }`)
      await wait(1000)

      // 9. Take screenshot — do NOT click submit
      log('[Notification] Taking screenshot...')
      const image = await page.capturePage()
      const screenshotBuffer = image.toPNG()
      const base64 = screenshotBuffer.toString('base64')

      log('[Notification] Done! Screenshot captured.')
      return { success: true, screenshot: 'data:image/png;base64,' + base64 }
    } catch (err) {
      log('[Notification] Error: ' + err.message)
      return { success: false, error: err.message }
    } finally {
      automationWindow.close()
    }
  })

  ipcMain.handle('get-notification-locations', () => {
    return Object.entries(TRAINERIZE_LOCATION_MAP).map(([slug, label]) => ({ slug, label }))
  })
})

app.on('window-all-closed', (e) => {
  if (!mainWindow || mainWindow.isDestroyed()) app.quit()
})
