const { ipcRenderer, contextBridge } = require('electron')

contextBridge.exposeInMainWorld('tabbarIPC', {
  platform: process.platform,
  send: (channel, ...args) => {
    const allowed = ['switch-tab', 'close-tab', 'reorder-tab', 'window-refresh', 'window-minimize', 'window-maximize', 'window-close', 'tabbar-signout', 'tabs-ready']
    if (allowed.includes(channel)) ipcRenderer.send(channel, ...args)
  },
  on: (channel, callback) => {
    const allowed = ['tabs-updated', 'user-updated', 'maximized-changed']
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args))
    }
  },
})
