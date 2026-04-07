// Generic login form credential capture — runs as Electron preload
const { ipcRenderer } = require('electron')

const DOMAIN_SERVICE_MAP = {
  'abcfinancial.com': 'abc',
  'gohighlevel.com': 'ghl',
  'westcoaststrength.com': 'ghl',
  'wheniwork.com': 'wheniwork',
  'paychex.com': 'paychex',
  'myapps.paychex.com': 'paychex',
}

function getServiceName() {
  const hostname = window.location.hostname
  for (const [domain, service] of Object.entries(DOMAIN_SERVICE_MAP)) {
    if (hostname.includes(domain)) return service
  }
  return hostname.replace('www.', '').split('.')[0]
}

function findLoginForm() {
  const forms = document.querySelectorAll('form')
  for (const form of forms) {
    const passwordField = form.querySelector('input[type="password"]')
    if (passwordField) return { form, passwordField }
  }
  return null
}

function getUsernameField(form) {
  const selectors = [
    'input[type="email"]',
    'input[name*="user" i]',
    'input[name*="email" i]',
    'input[name*="login" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
    'input[type="text"]',
  ]
  for (const sel of selectors) {
    const el = form.querySelector(sel)
    if (el && el.type !== 'password' && el.type !== 'hidden') return el
  }
  return null
}

function attachCapture(form, passwordField) {
  if (form._wcsCapture) return
  form._wcsCapture = true

  form.addEventListener('submit', () => {
    const usernameField = getUsernameField(form)
    const username = usernameField?.value?.trim()
    const password = passwordField?.value

    if (username && password) {
      const service = getServiceName()
      console.log('[WCS CredCapture] Captured login for:', service)
      ipcRenderer.send('credential-captured', { service, username, password })
    }
  })

  const submitBtn = form.querySelector('input[type="submit"], button[type="submit"], button:not([type])')
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      setTimeout(() => {
        const usernameField = getUsernameField(form)
        const username = usernameField?.value?.trim()
        const password = passwordField?.value
        if (username && password) {
          const service = getServiceName()
          ipcRenderer.send('credential-captured', { service, username, password })
        }
      }, 50)
    })
  }
}

function scanForForms() {
  const result = findLoginForm()
  if (result) attachCapture(result.form, result.passwordField)
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('[WCS CredCapture] Loaded on:', window.location.href)
  scanForForms()
  const observer = new MutationObserver(() => scanForForms())
  observer.observe(document.body, { childList: true, subtree: true })
})
