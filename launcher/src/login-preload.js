const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wcsAuth', {
  login: (email, password) => ipcRenderer.invoke('auth-login', email, password),
  loginComplete: () => ipcRenderer.send('auth-login-complete'),
})
