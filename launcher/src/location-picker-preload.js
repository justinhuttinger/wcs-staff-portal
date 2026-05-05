const { ipcRenderer, contextBridge } = require('electron')

contextBridge.exposeInMainWorld('locationPickerIPC', {
  getLocations: () => ipcRenderer.invoke('location-picker:get-locations'),
  pickLocation: (name) => ipcRenderer.send('location-picker:pick', name),
})
