const { BrowserView, session } = require('electron')
const path = require('path')

class TabManager {
  constructor(parentWindow, tabBarHeight) {
    this.window = parentWindow
    this.tabBarHeight = tabBarHeight
    this.tabs = new Map()
    this.activeTabId = null
    this.nextId = 1
    this.tabBarView = null
    this.onNewWindow = null
  }

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
    const view = new BrowserView({
      webPreferences: {
        preload,
        contextIsolation: isPortalPreload ? true : false,
        nodeIntegration: false,
        partition: 'persist:wcs-portal',
      },
    })

    // Set Chrome user agent so sites like GHL don't block Electron
    const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    view.webContents.setUserAgent(chromeUA)

    view.webContents.loadURL(url)

    // Pipe console.log from renderer to main process (for debugging preload scripts)
    if (preload) {
      view.webContents.on('console-message', (e, level, msg) => {
        if (msg.includes('[WCS')) console.log(msg)
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

    // Block all popups — ABC internal links should navigate in-place, not open new windows
    view.webContents.setWindowOpenHandler(({ url }) => {
      // Navigate the current tab to the URL instead of opening a popup
      if (url && url !== 'about:blank') {
        view.webContents.loadURL(url)
      }
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

    this.window.removeBrowserView(tab.view)
    tab.view.webContents.destroy()
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
