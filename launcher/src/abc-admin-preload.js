const { ipcRenderer, contextBridge } = require('electron')

// WCS ABC Admin window (ui/abc-admin.html). Opened from the ABC Settings page
// Actions toolbar; see openAbcAdmin in main.js.
contextBridge.exposeInMainWorld('abcAdminIPC', {
  get: () => ipcRenderer.invoke('abc-admin:get'),
  save: (config) => ipcRenderer.invoke('abc-admin:save', config),
  testSound: (pct) => ipcRenderer.invoke('abc-admin:test-sound', pct),
  pagerGet: () => ipcRenderer.invoke('abc-admin:pager-get'),
  pagerSave: (settings) => ipcRenderer.invoke('abc-admin:pager-save', settings),
  pagerStatus: () => ipcRenderer.invoke('abc-admin:pager-status'),
  pagerTest: (handsets) => ipcRenderer.invoke('abc-admin:pager-test', handsets),
})
