const { BrowserView, session, shell } = require('electron')
const path = require('path')
const { attachContextMenu } = require('./context-menu')
const { FREE_WINDOW, addWindowKeys } = require('./window-controls')

// ---- WCS ABC: new-window links open in their own window ----

// Blank / blob windows are ones ABC writes a report into itself; anything on
// an ABC host keeps the signed-in session. Other sites still go through
// onNewWindow (default browser).
function opensInAbcWindow(url) {
  if (!url || url === 'about:blank' || url.startsWith('blob:')) return true
  try {
    const host = new URL(url).hostname
    return /(^|\.)abcfinancial\.com$|(^|\.)abcfitness\.com$/i.test(host)
  } catch {
    return false
  }
}

// `allow` (rather than loading the URL ourselves) keeps form POSTs and
// window.opener working. No preload: abc-scraper must only run in the main
// ABC view, or the toolbar and check-in cues would double up.
const ABC_CHILD_WINDOW = {
  action: 'allow',
  overrideBrowserWindowOptions: {
    ...FREE_WINDOW,
    width: 1200,
    height: 860,
    center: true,
    webPreferences: {
      preload: undefined,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:wcs-portal',
    },
  },
}

function setupAbcChildWindow(win, userAgent) {
  win.setMenu(null)
  win.webContents.setUserAgent(userAgent)
  addWindowKeys(win)
  attachContextMenu(win.webContents)
  // Links inside a report: more ABC pages get another window, anything else
  // goes to the default browser.
  win.webContents.on('did-create-window', (child) => setupAbcChildWindow(child, userAgent))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (opensInAbcWindow(url)) return ABC_CHILD_WINDOW
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
}

class TabManager {
  constructor(parentWindow, tabBarHeight) {
    this.window = parentWindow
    this.tabBarHeight = tabBarHeight
    this.tabs = new Map()
    this.activeTabId = null
    this.nextId = 1
    this.tabBarView = null
    this.onNewWindow = null
    this.logger = null
  }

  setLogger(fn) { this.logger = fn }

  initTabBar() {
    this.tabBarView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '..', 'ui', 'tabbar-preload.js'),
      },
    })
    this.window.addBrowserView(this.tabBarView)
    this.tabBarView.webContents.loadFile(path.join(__dirname, '..', 'ui', 'tabbar.html'))
    this.layoutViews()
  }

  createTab(url, title, options = {}) {
    const id = this.nextId++
    const closable = options.closable !== false
    const preload = options.preload || undefined

    const isPortalPreload = preload && preload.includes('portal-preload')
    const isAbcPreload = preload && preload.includes('abc-scraper') && require('./app-mode').IS_ABC_ONLY
    const view = new BrowserView({
      webPreferences: {
        preload,
        contextIsolation: isPortalPreload ? true : false,
        nodeIntegration: false,
        partition: 'persist:wcs-portal',
      },
    })

    // Set Chrome user agent so sites like GHL don't block Electron. The major
    // version follows the bundled Chromium so it never looks out of date.
    const chromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`
    view.webContents.setUserAgent(chromeUA)
    // WCS ABC: mute ABC's own sounds (all of them: media, Web Audio, frames).
    // The check-in alert cues play from alert-sound.js instead.
    if (isAbcPreload) view.webContents.setAudioMuted(true)

    attachContextMenu(view.webContents)

    view.webContents.loadURL(url)

    // Pipe console.log from renderer to main process AND to C:\WCS\app.log
    // (for debugging preload scripts on machines without DevTools open).
    if (preload) {
      // Electron 35+ passes the text on the event (and warns about extra
      // listener arguments); Electron 33 passes it as the 3rd argument.
      view.webContents.on('console-message', (e, ...legacy) => {
        const msg = typeof legacy[1] === 'string' ? legacy[1] : String((e && e.message) || '')
        if (msg.includes('[WCS')) {
          console.log(msg)
          if (this.logger) this.logger(msg)
        }
      })
    }

    // Intercept OIDC authorize URLs and inject auth token for auto-SSO
    view.webContents.on('will-navigate', (e, url) => {
      if (url.includes('/oidc/authorize') && (url.includes('api.wcstrength.com') || url.includes('wcs-auth-api'))) {
        // Get token from main process auth module
        try {
          const auth = require('./auth')
          const token = auth.getToken()
          if (token && !url.includes('token=')) {
            e.preventDefault()
            const separator = url.includes('?') ? '&' : '?'
            view.webContents.loadURL(url + separator + 'token=' + token)
          }
        } catch {}
      }
    })

    // Keep original tab title — don't update from page title
    // Tab names are set when created (Portal, Grow, ABC, etc.)

    // Block all popups. Same-host links navigate in-place (preserves the
    // ABC kiosk's abc-scraper preload). Cross-host links go through
    // onNewWindow so they open in a new tab with the *right* preload —
    // otherwise an "Open MyCoke" link clicked from inside the ABC tab
    // ends up on my-coke.com still running abc-scraper, and credential
    // auto-fill never fires.
    const tabManager = this
    // WCS ABC has no tab bar, so ABC's own new-window links (reports, PDFs,
    // print previews) get a window of their own instead of replacing the one
    // ABC view, which left staff with no way back.
    if (isAbcPreload) {
      view.webContents.on('did-create-window', (win) => setupAbcChildWindow(win, chromeUA))
    }
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isAbcPreload && opensInAbcWindow(url)) return ABC_CHILD_WINDOW
      // The portal's report viewer (QA/Audit "View Report") opens a blank
      // window and writes styled HTML into it via window.open('', '_blank').
      // Denying about:blank made that button silently do nothing in the kiosk.
      // Allow it on the portal tab only, as a safe self-scripted child window.
      if (!url || url === 'about:blank') {
        if (isPortalPreload) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 1100,
              height: 800,
              autoHideMenuBar: true,
              webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                partition: 'persist:wcs-portal',
              },
            },
          }
        }
        return { action: 'deny' }
      }
      try {
        const next = new URL(url).hostname
        const cur = new URL(view.webContents.getURL()).hostname
        if (next && cur && next === cur) {
          view.webContents.loadURL(url)
          return { action: 'deny' }
        }
      } catch {}
      // Cross-host — let TabManager route it (correct preload per URL).
      if (tabManager.onNewWindow) tabManager.onNewWindow(url)
      return { action: 'deny' }
    })

    // Per-tab DevTools shortcuts. Hooked at the webContents level (not via
    // globalShortcut) so they survive OEM / kiosk software that grabs F12.
    // Bindings: F12 (toggle), Ctrl+Shift+I (toggle), Ctrl+Shift+J (open).
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const isF12 = input.key === 'F12'
      const isCtrlShiftI = input.control && input.shift && (input.key === 'I' || input.key === 'i')
      const isCtrlShiftJ = input.control && input.shift && (input.key === 'J' || input.key === 'j')
      if (isF12 || isCtrlShiftI) {
        event.preventDefault()
        if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools()
        else view.webContents.openDevTools({ mode: 'detach' })
      } else if (isCtrlShiftJ) {
        event.preventDefault()
        view.webContents.openDevTools({ mode: 'detach' })
      }
    })

    this.tabs.set(id, { view, title, closable, id })
    this.switchTo(id)
    return id
  }

  switchTo(id) {
    const tab = this.tabs.get(id)
    if (!tab) return

    if (this.activeTabId !== null) {
      const current = this.tabs.get(this.activeTabId)
      if (current) this.window.removeBrowserView(current.view)
    }

    this.activeTabId = id
    this.window.addBrowserView(tab.view)
    this.layoutViews()
    this.notifyTabBar()
  }

  closeTab(id) {
    const tab = this.tabs.get(id)
    if (!tab || !tab.closable) return

    try { this.window.removeBrowserView(tab.view) } catch {}
    // Electron 27+ removed webContents.destroy() in favor of close().
    // Guard against undefined webContents (the view may already have been
    // torn down, e.g. when an OAuth popup tab self-closes).
    try {
      const wc = tab.view && tab.view.webContents
      if (wc && !wc.isDestroyed()) {
        if (typeof wc.close === 'function') wc.close()
        else if (typeof wc.destroy === 'function') wc.destroy()
      }
    } catch {}
    this.tabs.delete(id)

    if (this.activeTabId === id) {
      const ids = [...this.tabs.keys()]
      if (ids.length > 0) this.switchTo(ids[ids.length - 1])
    }
    this.notifyTabBar()
  }

  reorderTab(dragId, dropId) {
    const dragTab = this.tabs.get(dragId)
    if (!dragTab || !dragTab.closable) return
    const entries = [...this.tabs.entries()]
    const dragIdx = entries.findIndex(([id]) => id === dragId)
    const dropIdx = entries.findIndex(([id]) => id === dropId)
    if (dragIdx === -1 || dropIdx === -1 || dragIdx === dropIdx) return

    const [dragEntry] = entries.splice(dragIdx, 1)
    const newDropIdx = entries.findIndex(([id]) => id === dropId)
    entries.splice(newDropIdx, 0, dragEntry)

    this.tabs = new Map(entries)
    this.notifyTabBar()
  }

  closeAllExceptPortal() {
    const idsToClose = [...this.tabs.entries()]
      .filter(([, tab]) => tab.closable)
      .map(([id]) => id)
    for (const id of idsToClose) {
      this.closeTab(id)
    }
  }

  layoutViews() {
    if (this.window.isDestroyed()) return
    const bounds = this.window.getContentBounds()
    const width = bounds.width
    const height = bounds.height

    if (this.tabBarView) {
      this.tabBarView.setBounds({ x: 0, y: 0, width, height: this.tabBarHeight })
    }

    const tab = this.tabs.get(this.activeTabId)
    if (tab) {
      tab.view.setBounds({ x: 0, y: this.tabBarHeight, width, height: height - this.tabBarHeight })
    }
  }

  notifyTabBar() {
    if (!this.tabBarView || this.tabBarView.webContents.isDestroyed()) return
    const tabData = [...this.tabs.values()].map(t => ({
      id: t.id,
      title: t.title,
      closable: t.closable,
      active: t.id === this.activeTabId,
    }))
    this.tabBarView.webContents.send('tabs-updated', tabData)
  }
}

module.exports = TabManager
