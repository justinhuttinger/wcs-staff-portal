// Preload script for the Portal tab
// Intercepts link clicks and bridges auth/config to main process via IPC
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

contextBridge.exposeInMainWorld('wcsElectron', {
  // Auth bridge — portal tells main process about auth state changes
  onLogin: (token, userName) => ipcRenderer.send('portal-auth-login', token, userName),
  onLogout: () => ipcRenderer.send('portal-auth-logout'),
  // Kiosk config
  getConfig: () => ipcRenderer.invoke('get-kiosk-config'),
  setConfig: (config) => ipcRenderer.invoke('set-kiosk-config', config),
  // Credential save prompt
  onSavePrompt: (callback) => {
    const { ipcRenderer: ipc } = require('electron')
    ipc.on('show-save-prompt', (e, data) => callback(data))
  },
  respondSavePrompt: (accepted) => ipcRenderer.send('save-credential-response', { accepted }),
  // Listen for sign-out command from tab bar
  onSignOut: (callback) => {
    ipcRenderer.on('trigger-signout', () => callback())
  },
  // Trainerize push notification automation
  runNotification: (params) => ipcRenderer.invoke('run-notification', params),
  getNotificationLocations: () => ipcRenderer.invoke('get-notification-locations'),
})
