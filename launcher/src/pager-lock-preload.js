const { ipcRenderer, contextBridge } = require('electron')

// Password prompt in front of the pager-only tray actions (ui/pager-lock.html).
contextBridge.exposeInMainWorld('pagerLockIPC', {
  action: () => ipcRenderer.invoke('pager-lock:action'),
  tryPassword: (password) => ipcRenderer.invoke('pager-lock:try', password),
})
