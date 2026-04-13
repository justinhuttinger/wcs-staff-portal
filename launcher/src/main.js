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
      show: true, // DEBUG: visible so we can watch the automation
      webPreferences: {
        session: ses.fromPartition('persist:trainerize-automation'),
        nodeIntegration: false,
        contextIsolation: false,
        webSecurity: true,
      },
    })

    try {
      const page = automationWindow.webContents

      // Helper to run JS in the page with error handling
      const run = async (code) => {
        try {
          return await page.executeJavaScript(`(function() { try { ${code}; return 'ok'; } catch(e) { return 'ERR: ' + e.message; } })()`)
        } catch (e) {
          log('[Notification] JS exec error: ' + e.message)
          return 'ERR: ' + e.message
        }
      }
      const wait = (ms) => new Promise(r => setTimeout(r, ms))

      // 1. Login
      log('[Notification] Loading login page...')
      await page.loadURL('https://westcoaststrength.trainerize.com/app/login')
      await wait(4000)

      log('[Notification] v1.2.1 — Filling credentials with native setter...')

      // Use native input setter to bypass React's controlled inputs
      await run(`
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        var inputs = document.querySelectorAll('input');
        var emailEl = null;
        var passEl = null;
        for (var i = 0; i < inputs.length; i++) {
          var t = (inputs[i].type || '').toLowerCase();
          if (t === 'password') { passEl = inputs[i]; }
          else if (!emailEl && (t === 'text' || t === 'email' || t === '')) { emailEl = inputs[i]; }
        }
        if (emailEl) {
          emailEl.focus();
          nativeSetter.call(emailEl, ${JSON.stringify(email)});
          emailEl.dispatchEvent(new Event('input', {bubbles:true}));
          emailEl.dispatchEvent(new Event('change', {bubbles:true}));
        }
        if (passEl) {
          passEl.focus();
          nativeSetter.call(passEl, ${JSON.stringify(password)});
          passEl.dispatchEvent(new Event('input', {bubbles:true}));
          passEl.dispatchEvent(new Event('change', {bubbles:true}));
        }
      `)
      await wait(500)
      // Button says "SIGN IN"
      await run(`
        var btn = document.querySelector('button[type="submit"]');
        if (!btn) {
          var buttons = document.querySelectorAll('button');
          for (var i = 0; i < buttons.length; i++) {
            var txt = buttons[i].textContent.trim().toUpperCase();
            if (txt === 'SIGN IN' || txt === 'LOG IN' || txt === 'LOGIN') { btn = buttons[i]; break; }
          }
        }
        if (btn) btn.click();
      `)
      log('[Notification] Logging in...')

      // Wait for login and check if we navigated away from login page
      await wait(8000)
      var currentUrl = await run(`return window.location.href`)
      log('[Notification] Current URL after login: ' + currentUrl)

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
      log('[Notification] v1.2.2 — Filling title...')
      await run(`
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        var el = document.querySelector('input[type="text"]');
        if (el) { el.focus(); nativeSetter.call(el, ${JSON.stringify(title.slice(0, 65))}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
      `)
      await wait(500)

      // 6. Set send timing — this is a CUSTOM dropdown, not a <select>
      // Click the dropdown button that shows "Schedule for" to open it
      log('[Notification] Setting send timing: ' + sendTiming)
      if (sendTiming === 'now') {
        // Click the dropdown to open it, then select "Start sending immediately"
        await run(`
          var els = document.querySelectorAll('*');
          for (var i = 0; i < els.length; i++) {
            if (els[i].textContent.trim() === 'Schedule for' && els[i].children.length === 0) {
              els[i].closest('[class*="dropdown"], [class*="select"], button, div[tabindex]')?.click() || els[i].click();
              break;
            }
          }
        `)
        await wait(1000)
        await run(`
          var els = document.querySelectorAll('*');
          for (var i = 0; i < els.length; i++) {
            if (els[i].textContent.trim() === 'Start sending immediately' && els[i].children.length === 0) {
              els[i].click();
              break;
            }
          }
        `)
        await wait(500)
      } else if (sendTiming === 'scheduled' && scheduledDate) {
        // Leave "Schedule for" selected (default)
        // Date/time pickers are custom components — click them to focus, then type
        log('[Notification] Setting scheduled date: ' + scheduledDate + ' ' + (scheduledTime || ''))
        // Find and click the "Select date" text/input area
        await run(`
          var els = document.querySelectorAll('*');
          for (var i = 0; i < els.length; i++) {
            if (els[i].textContent.trim() === 'Select date' && els[i].children.length === 0) {
              els[i].click();
              break;
            }
          }
        `)
        await wait(1000)
        // Type the date using keyboard events
        for (const char of scheduledDate) {
          await page.sendInputEvent({ type: 'keyDown', keyCode: char })
          await page.sendInputEvent({ type: 'char', keyCode: char })
          await page.sendInputEvent({ type: 'keyUp', keyCode: char })
        }
        // Press Enter to confirm
        await page.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
        await page.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
        await wait(500)

        if (scheduledTime) {
          await run(`
            var els = document.querySelectorAll('*');
            for (var i = 0; i < els.length; i++) {
              if (els[i].textContent.trim() === 'Select time' && els[i].children.length === 0) {
                els[i].click();
                break;
              }
            }
          `)
          await wait(500)
          for (const char of scheduledTime) {
            await page.sendInputEvent({ type: 'keyDown', keyCode: char })
            await page.sendInputEvent({ type: 'char', keyCode: char })
            await page.sendInputEvent({ type: 'keyUp', keyCode: char })
          }
          await page.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
          await page.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
          await wait(500)
        }
      }

      // 7. Select locations
      // The location picker is a CUSTOM GRID (baseGridRow), NOT an Ant tree
      // Each location is a row with an ant-checkbox-input
      log('[Notification] v1.2.8 — Selecting locations...')

      // Click the locations input area to open the dropdown
      await run(`
        var els = document.querySelectorAll('*');
        for (var i = 0; i < els.length; i++) {
          if (els[i].textContent.trim() === 'Which locations to send to?' && els[i].children.length === 0) {
            var next = els[i].nextElementSibling;
            if (next) next.click();
            break;
          }
        }
      `)
      await wait(2000)

      // The location grid uses baseGridRow with checkbox inside each row
      // Click the row that contains each location name
      if (locations.includes('all')) {
        log('[Notification] Clicking All locations row...')
        await run(`
          var rows = document.querySelectorAll('[data-testid="grid-row"]');
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('All locations') >= 0) {
              var cb = rows[i].querySelector('.ant-checkbox-input, input[type="checkbox"]');
              if (cb) cb.click();
              else rows[i].click();
              break;
            }
          }
        `)
      } else {
        for (const slug of locations) {
          const label = TRAINERIZE_LOCATION_MAP[slug]
          if (!label) continue
          log('[Notification] Clicking: ' + label)
          await run(`
            var rows = document.querySelectorAll('[data-testid="grid-row"]');
            for (var i = 0; i < rows.length; i++) {
              if (rows[i].textContent.indexOf(${JSON.stringify(label)}) >= 0) {
                var cb = rows[i].querySelector('.ant-checkbox-input, input[type="checkbox"]');
                if (cb) cb.click();
                else rows[i].click();
                break;
              }
            }
          `)
          await wait(400)
        }
      }
      await wait(500)

      // Close location dropdown
      await run(`
        var h = document.querySelector('h1');
        if (h && h.textContent.indexOf('New Push') >= 0) h.click();
      `)
      await wait(1000)

      // 7.5. "Select the clients" — this uses an Ant tree (different from locations!)
      log('[Notification] Opening clients dropdown...')
      await run(`
        var els = document.querySelectorAll('*');
        for (var i = 0; i < els.length; i++) {
          var t = els[i].textContent.trim();
          if (t === 'Select the clients for whom this notification should appear' && els[i].children.length === 0) {
            var next = els[i].nextElementSibling;
            if (next) next.click();
            break;
          }
        }
      `)
      await wait(1500)

      // The clients dropdown IS an Ant tree — check "All"
      log('[Notification] Checking All clients...')
      await run(`
        // Find checkbox next to text "All" in the ant tree
        var nodes = document.querySelectorAll('.ant-select-tree-treenode, [data-testid*="userTypes"]');
        for (var i = 0; i < nodes.length; i++) {
          var title = nodes[i].querySelector('.ant-select-tree-title, [title="All"]');
          if (title && title.textContent.trim() === 'All') {
            var cb = nodes[i].querySelector('.ant-select-tree-checkbox');
            if (cb) cb.click();
            break;
          }
        }
        // Fallback: click any checkbox labeled "All"
        if (nodes.length === 0) {
          var cbs = document.querySelectorAll('.ant-checkbox-input, input[type="checkbox"]');
          for (var i = 0; i < cbs.length; i++) {
            var parent = cbs[i].closest('label, span, div');
            if (parent && parent.textContent.trim() === 'All') { cbs[i].click(); break; }
          }
        }
      `)
      await wait(500)

      // Close clients dropdown
      await run(`
        var h = document.querySelector('h1');
        if (h && h.textContent.indexOf('New Push') >= 0) h.click();
      `)
      await wait(500)

      // 8. Fill Message
      log('[Notification] Filling message...')
      await run(`
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        var ta = document.querySelector('textarea');
        if (ta) { ta.focus(); nativeSetter.call(ta, ${JSON.stringify(message.slice(0, 120))}); ta.dispatchEvent(new Event('input',{bubbles:true})); ta.dispatchEvent(new Event('change',{bubbles:true})); }
      `)
      await wait(1000)

      // 9. Scroll to top, then screenshot — do NOT click submit
      await run(`window.scrollTo(0, 0)`)
      await wait(500)
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
