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
    const portalSender = e.sender

    const progress = (msg) => {
      log('[Notification] ' + msg)
      try { portalSender.send('notification-progress', msg) } catch {}
    }

    progress('Starting automation...')

    const { session: ses } = require('electron')
    const automationWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        session: ses.fromPartition('persist:trainerize-automation'),
        nodeIntegration: false,
        contextIsolation: false,
        webSecurity: true,
      },
    })

    try {
      const page = automationWindow.webContents

      const run = async (code) => {
        try {
          return await page.executeJavaScript(
            `(function() { try { ${code} } catch(e) { return 'ERR: ' + e.message; } })()`
          )
        } catch (e) {
          log('[Notification] JS exec error: ' + e.message)
          return 'ERR: ' + e.message
        }
      }
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const waitFor = async (checkCode, label, timeout = 15000) => {
        const start = Date.now()
        while (Date.now() - start < timeout) {
          const result = await run(`return (${checkCode}) ? true : false`)
          if (result === true) return true
          await wait(500)
        }
        log('[Notification] waitFor timed out: ' + label)
        return false
      }

      // =====================================================================
      // 1. LOGIN
      // =====================================================================
      progress('Loading Trainerize login page...')
      await page.loadURL('https://westcoaststrength.trainerize.com/app/login')
      await waitFor(`document.querySelector('input')`, 'login inputs', 10000)
      await wait(1000)

      progress('Filling credentials...')
      await run(`
        var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        var inputs = document.querySelectorAll('input');
        var emailEl = null, passEl = null;
        for (var i = 0; i < inputs.length; i++) {
          var t = (inputs[i].type || '').toLowerCase();
          if (t === 'password') passEl = inputs[i];
          else if (!emailEl && (t === 'text' || t === 'email' || t === '')) emailEl = inputs[i];
        }
        if (emailEl) { emailEl.focus(); ns.call(emailEl, ${JSON.stringify(email)}); emailEl.dispatchEvent(new Event('input',{bubbles:true})); }
        if (passEl) { passEl.focus(); ns.call(passEl, ${JSON.stringify(password)}); passEl.dispatchEvent(new Event('input',{bubbles:true})); }
        return emailEl && passEl ? 'ok' : 'missing inputs';
      `)
      await wait(500)
      await run(`
        var btn = document.querySelector('button[type="submit"]');
        if (!btn) { var bs = document.querySelectorAll('button'); for (var i=0;i<bs.length;i++) { var t=bs[i].textContent.trim().toUpperCase(); if (t==='SIGN IN'||t==='LOG IN') { btn=bs[i]; break; }}}
        if (btn) btn.click();
      `)

      progress('Logging in...')
      const loggedIn = await waitFor(`!window.location.href.includes('/login')`, 'login redirect', 20000)
      if (!loggedIn) throw new Error('Login failed — still on login page')
      await wait(2000)

      // =====================================================================
      // 2. NAVIGATE TO ANNOUNCEMENTS & OPEN FORM
      // =====================================================================
      progress('Navigating to Announcements...')
      await page.loadURL('https://westcoaststrength.trainerize.com/app/announcements')
      await waitFor(`document.querySelector('[data-testid="pushNotification-grid-newButton"]')`, 'announcements page', 15000)
      await wait(1000)

      progress('Opening notification form...')
      await run(`
        var btn = document.querySelector('[data-testid="pushNotification-grid-newButton"]');
        if (btn) btn.click();
        return btn ? 'clicked' : 'not found';
      `)
      await waitFor(`document.querySelector('.ant-calendar-picker-input')`, 'form modal', 8000)
      await wait(1000)

      // =====================================================================
      // 3. FILL TITLE
      // =====================================================================
      progress('Filling title...')
      await run(`
        var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        var inputs = document.querySelectorAll('input.ant-input[type="text"]');
        var el = null;
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].offsetParent !== null && !inputs[i].classList.contains('ant-select-search__field') && !inputs[i].classList.contains('ant-calendar-picker-input') && !inputs[i].disabled) {
            el = inputs[i]; break;
          }
        }
        if (el) { el.focus(); ns.call(el, ${JSON.stringify(title.slice(0, 65))}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
        return el ? 'ok' : 'no input';
      `)
      await wait(500)

      // =====================================================================
      // 4. SEND TIMING
      // =====================================================================
      progress('Setting send timing: ' + sendTiming + '...')
      if (sendTiming === 'now') {
        // Click the timing dropdown (it says "Scheduled" by default)
        await run(`
          var selects = document.querySelectorAll('.ant-select-sm.ant-select');
          for (var i = 0; i < selects.length; i++) {
            if (selects[i].textContent.indexOf('Schedule') >= 0) { selects[i].click(); break; }
          }
        `)
        await wait(800)
        // Select "Start sending immediately"
        await run(`
          var items = document.querySelectorAll('.ant-select-dropdown-menu-item');
          for (var i = 0; i < items.length; i++) {
            if (items[i].textContent.indexOf('Start sending immediately') >= 0) { items[i].click(); return 'clicked'; }
          }
          var els = document.querySelectorAll('*');
          for (var i = 0; i < els.length; i++) {
            if (els[i].offsetParent !== null && els[i].textContent.trim() === 'Start sending immediately' && els[i].children.length === 0) {
              els[i].click(); return 'fallback';
            }
          }
          return 'not found';
        `)
        await wait(500)
      } else if (sendTiming === 'scheduled' && scheduledDate) {
        // Default is "Scheduled" so just fill date/time
        progress('Setting date: ' + scheduledDate + '...')

        // Date picker is readonly — must use the calendar popup
        await run(`var el = document.querySelector('.ant-calendar-picker-input'); if (el) el.click();`)
        await wait(1000)

        // Navigate calendar to correct month/year
        var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        var parts = scheduledDate.split('-').map(Number)
        var targetYear = parts[0], targetMonth = parts[1], targetDay = parts[2]

        await waitFor(`document.querySelector('.ant-calendar')`, 'calendar popup', 5000)
        for (var attempt = 0; attempt < 24; attempt++) {
          var calState = await run(`
            var m = document.querySelector('.ant-calendar-month-select');
            var y = document.querySelector('.ant-calendar-year-select');
            return JSON.stringify({ month: m ? m.textContent.trim() : '', year: y ? y.textContent.trim() : '' });
          `)
          try { calState = JSON.parse(calState) } catch { calState = { month: '', year: '' } }
          var curMonthIdx = MONTHS.indexOf(calState.month)
          var curYear = parseInt(calState.year, 10)
          if (curYear === targetYear && curMonthIdx + 1 === targetMonth) break
          var curTotal = curYear * 12 + curMonthIdx
          var targetTotal = targetYear * 12 + (targetMonth - 1)
          if (targetTotal > curTotal) {
            await run(`var b = document.querySelector('.ant-calendar-next-month-btn'); if (b) b.click();`)
          } else {
            await run(`var b = document.querySelector('.ant-calendar-prev-month-btn'); if (b) b.click();`)
          }
          await wait(300)
        }

        // Click the target day
        await run(`
          var cells = document.querySelectorAll('.ant-calendar-date');
          for (var i = 0; i < cells.length; i++) {
            var td = cells[i].closest('td');
            if (td && !td.classList.contains('ant-calendar-last-month-cell') && !td.classList.contains('ant-calendar-next-month-btn-day') && cells[i].textContent.trim() === '${targetDay}') {
              cells[i].click(); break;
            }
          }
        `)
        await wait(500)

        // Time picker
        if (scheduledTime) {
          progress('Setting time: ' + scheduledTime + '...')
          var timeParts = scheduledTime.split(':').map(Number)
          var tH = timeParts[0], tM = timeParts[1]

          // Wait for time picker to become enabled
          await waitFor(`!document.querySelector('.ant-time-picker-input')?.disabled`, 'time picker enabled', 5000)
          await wait(500)

          // Click time picker wrapper to open panel
          await run(`
            var wrapper = document.querySelector('.ant-time-picker');
            var input = document.querySelector('.ant-time-picker-input');
            if (input && input.disabled) input.removeAttribute('disabled');
            if (wrapper) wrapper.click();
            if (input) { input.focus(); input.click(); }
          `)
          await wait(2000)

          // Select hour, minute, AM/PM in the time panel columns
          await run(`
            var panel = document.querySelector('.ant-time-picker-panel-inner');
            if (panel) {
              var columns = panel.querySelectorAll('.ant-time-picker-panel-select');
              var h = ${tH}, m = ${tM};
              var is12h = columns.length >= 3;
              var targetH = h, ampm = 'AM';
              if (is12h) { ampm = h >= 12 ? 'PM' : 'AM'; targetH = h === 0 ? 12 : h > 12 ? h - 12 : h; }
              // Click hour
              var hItems = columns[0].querySelectorAll('li');
              for (var i = 0; i < hItems.length; i++) { if (parseInt(hItems[i].textContent.trim(), 10) === targetH) { hItems[i].click(); break; } }
              // Click minute
              var mItems = columns[1].querySelectorAll('li');
              for (var i = 0; i < mItems.length; i++) { if (parseInt(mItems[i].textContent.trim(), 10) === m) { mItems[i].click(); break; } }
              // Click AM/PM
              if (is12h && columns[2]) {
                var apItems = columns[2].querySelectorAll('li');
                for (var i = 0; i < apItems.length; i++) { if (apItems[i].textContent.trim().toUpperCase() === ampm) { apItems[i].click(); break; } }
              }
              return 'ok';
            }
            return 'no panel';
          `)
          await wait(500)
        }
      }

      // =====================================================================
      // 5. SELECT LOCATIONS (Ant TreeSelect with data-testid)
      // =====================================================================
      progress('Selecting locations...')
      await run(`
        var el = document.querySelector('[data-testid="announcements-locationTreeSelect"]');
        if (el) el.click();
      `)
      await wait(1500)

      if (locations.includes('all')) {
        // Click "All locations" checkbox directly
        await run(`
          var node = document.querySelector('[data-testid="announcements-locationTreeLeaf-allLocations"]');
          if (node) { var cb = node.querySelector('.ant-select-tree-checkbox'); if (cb) cb.click(); }
        `)
      } else {
        // Expand "All locations" to reveal individual locations
        await run(`
          var switcher = document.querySelector('[data-testid="announcements-locationTreeLeaf-allLocations"] .ant-select-tree-switcher');
          if (switcher) switcher.click();
        `)
        await wait(1500)

        // Select each location by title attribute on the content wrapper
        for (const slug of locations) {
          const label = TRAINERIZE_LOCATION_MAP[slug]
          if (!label) continue
          progress('Selecting: ' + label + '...')
          await run(`
            var span = document.querySelector('.ant-select-tree-node-content-wrapper[title="${label}"]');
            if (span) {
              var item = span.closest('[role="treeitem"]');
              if (item) { var cb = item.querySelector('.ant-select-tree-checkbox'); if (cb) cb.click(); }
            }
          `)
          await wait(400)
        }
      }
      await wait(500)

      // Close location dropdown — click the Title label to move focus
      await run(`
        var labels = document.querySelectorAll('label');
        for (var i = 0; i < labels.length; i++) {
          if (labels[i].textContent.trim() === 'Title') { labels[i].click(); break; }
        }
      `)
      await wait(1000)

      // =====================================================================
      // 6. SELECT CLIENTS ("All") — uses data-testid to avoid location tree collision
      // =====================================================================
      progress('Selecting client audience...')
      await run(`
        var el = document.querySelector('[data-testid="announcements-userTypesTreeSelect"]');
        if (el) el.click();
      `)
      await wait(1500)

      await run(`
        var allNode = document.querySelector('[data-testid="announcements-userTypesTreeLeaf-all"]');
        if (allNode) { var cb = allNode.querySelector('.ant-select-tree-checkbox'); if (cb) cb.click(); }
        return allNode ? 'checked' : 'not found';
      `)
      await wait(500)

      // Close clients dropdown
      await run(`
        var labels = document.querySelectorAll('label');
        for (var i = 0; i < labels.length; i++) {
          if (labels[i].textContent.trim() === 'Title') { labels[i].click(); break; }
        }
      `)
      await wait(500)

      // =====================================================================
      // 7. FILL MESSAGE
      // =====================================================================
      progress('Filling message...')
      await run(`
        var ns = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        var ta = document.querySelector('textarea.ant-input');
        if (ta) { ta.focus(); ns.call(ta, ${JSON.stringify(message.slice(0, 120))}); ta.dispatchEvent(new Event('input',{bubbles:true})); ta.dispatchEvent(new Event('change',{bubbles:true})); }
        return ta ? 'ok' : 'no textarea';
      `)
      await wait(1000)

      // =====================================================================
      // 8. SCREENSHOT
      // =====================================================================
      progress('Taking screenshot for review...')
      await run(`window.scrollTo(0, 0)`)
      await wait(500)
      const image = await page.capturePage()
      const screenshotBuffer = image.toPNG()
      const base64 = screenshotBuffer.toString('base64')

      progress('Done — screenshot captured.')
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
