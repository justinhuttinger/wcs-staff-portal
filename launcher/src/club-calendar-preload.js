const { ipcRenderer, contextBridge } = require('electron')

// Club Calendar window (ui/club-calendar.html); see club-calendar.js.
contextBridge.exposeInMainWorld('clubCalendarIPC', {
  get: (opts) => ipcRenderer.invoke('club-calendar:get', opts || {}),
})
