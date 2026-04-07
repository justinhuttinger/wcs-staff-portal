// Preload script for the Portal tab
// Intercepts link clicks and sends them to main process via IPC
const { ipcRenderer, contextBridge } = require('electron')

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a')
    if (link && link.href && link.target === '_blank') {
      e.preventDefault()
      e.stopPropagation()
      ipcRenderer.send('open-in-tab', link.href)
    }
  }, true)
})

contextBridge.exposeInMainWorld('wcsConfig', {
  getConfig: () => ipcRenderer.invoke('get-kiosk-config'),
  setConfig: (config) => ipcRenderer.invoke('set-kiosk-config', config),
})
