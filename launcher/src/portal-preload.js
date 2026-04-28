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
  // Fires after renderer refreshes its access token; keeps main process in sync
  onTokenRefreshed: (token) => ipcRenderer.send('portal-auth-token-refreshed', token),
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
  // Listen for navigation commands (e.g., from tour notifications)
  onNavigate: (callback) => {
    ipcRenderer.on('navigate-to', (e, view) => callback(view))
  },
})
