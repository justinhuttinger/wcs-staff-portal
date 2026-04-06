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

    const view = new BrowserView({
      webPreferences: {
        preload,
        contextIsolation: preload ? false : true,
        nodeIntegration: false,
      },
    })

    view.webContents.loadURL(url)

    view.webContents.on('page-title-updated', (e, pageTitle) => {
      const tab = this.tabs.get(id)
      if (tab) {
        tab.title = pageTitle.substring(0, 30)
        this.notifyTabBar()
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
