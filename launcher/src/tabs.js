const { BrowserView } = require('electron')
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
        contextIsolation: false,
        nodeIntegration: true,
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

    const isAbcScraper = preload && preload.includes('abc-scraper')
    const view = new BrowserView({
      webPreferences: {
        preload,
        contextIsolation: isAbcScraper ? false : true,
        nodeIntegration: false,
      },
    })

    view.webContents.loadURL(url)

    // Pipe console.log from renderer to main process (for debugging preload scripts)
    if (preload) {
      view.webContents.on('console-message', (e, level, msg) => {
        if (msg.includes('[WCS')) console.log(msg)
      })
    }

    // Update tab title from page
    view.webContents.on('page-title-updated', (e, newTitle) => {
      const tab = this.tabs.get(id)
      if (tab) {
        tab.title = newTitle.substring(0, 30)
        this.notifyTabBar()
      }
    })

    // Block all popups — ABC internal links should navigate in-place, not open new windows
    view.webContents.setWindowOpenHandler(({ url }) => {
      // Navigate the current tab to the URL instead of opening a popup
      if (url && url !== 'about:blank') {
        view.webContents.loadURL(url)
      }
      return { action: 'deny' }
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

  layoutViews() {
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
    if (!this.tabBarView) return
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
