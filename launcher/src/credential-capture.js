// Generic login form credential capture — runs as Electron preload
// Detects login forms (including SPA-style non-form logins), captures on submit
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

function findUsernameField(container) {
  const selectors = [
    'input[type="email"]',
    'input[name*="user" i]',
    'input[name*="email" i]',
    'input[name*="login" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="text"]',
  ]
  for (const sel of selectors) {
    const el = container.querySelector(sel)
    if (el && el.type !== 'password' && el.type !== 'hidden' && el.offsetParent !== null) return el
  }
  return null
}

let captured = false

function captureCredentials() {
  if (captured) return

  // Find password field anywhere on page (not just inside <form>)
  const passwordField = document.querySelector('input[type="password"]')
  if (!passwordField || !passwordField.offsetParent) return

  // Look for username field — search in same form, or in the whole page
  const form = passwordField.closest('form')
  const container = form || document.body
  const usernameField = findUsernameField(container)

  if (!usernameField) return

  console.log('[WCS CredCapture] Found login fields on:', window.location.href)

  function trySend() {
    const username = usernameField.value?.trim()
    const password = passwordField.value
    if (username && password && !captured) {
      captured = true
      const service = getServiceName()
      console.log('[WCS CredCapture] Captured login for:', service, username)
      ipcRenderer.send('credential-captured', { service, username, password })
      // Reset after a delay so re-login works
      setTimeout(() => { captured = false }, 5000)
    }
  }

  // Attach to form submit if inside a form
  if (form && !form._wcsCapture) {
    form._wcsCapture = true
    form.addEventListener('submit', () => trySend())
  }

  // Attach to ALL buttons and submit inputs near the password field
  const buttons = container.querySelectorAll('button, input[type="submit"], [role="button"]')
  buttons.forEach(btn => {
    if (btn._wcsCapture) return
    btn._wcsCapture = true
    btn.addEventListener('click', () => {
      // Small delay to let the form populate
      setTimeout(trySend, 100)
    })
  })

  // Also capture Enter key on password field
  if (!passwordField._wcsCapture) {
    passwordField._wcsCapture = true
    passwordField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        setTimeout(trySend, 100)
      }
    })
  }
}

// Auto-fill saved credentials
async function tryAutoFill() {
  try {
    const service = getServiceName()
    const creds = await ipcRenderer.invoke('get-credentials', service)
    if (!creds) return

    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const passwordField = document.querySelector('input[type="password"]')

    if (passwordField && passwordField.offsetParent) {
      // Standard login: both username + password visible
      const container = passwordField.closest('form') || document.body
      const usernameField = findUsernameField(container)
      if (!usernameField) return
      if (usernameField.value && passwordField.value) return

      nativeSet.call(usernameField, creds.username)
      usernameField.dispatchEvent(new Event('input', { bubbles: true }))
      usernameField.dispatchEvent(new Event('change', { bubbles: true }))
      nativeSet.call(passwordField, creds.password)
      passwordField.dispatchEvent(new Event('input', { bubbles: true }))
      passwordField.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      // Two-step login: username-only screen (e.g. Paychex)
      const usernameField = findUsernameField(document.body)
      if (!usernameField || !usernameField.offsetParent) return
      if (usernameField.value) return

      nativeSet.call(usernameField, creds.username)
      usernameField.dispatchEvent(new Event('input', { bubbles: true }))
      usernameField.dispatchEvent(new Event('change', { bubbles: true }))

      // Auto-submit the username step
      setTimeout(() => {
        const form = usernameField.closest('form')
        const submitBtn = (form || document.body).querySelector(
          'button[type="submit"], input[type="submit"], button:not([type])'
        )
        if (submitBtn) submitBtn.click()
        else if (form) form.submit()
      }, 300)
    }

    console.log('[WCS CredCapture] Auto-filled login for:', service)

    // Auto-click the login/submit button
    setTimeout(() => {
      const form = passwordField.closest('form')
      const submitBtn = (form || document.body).querySelector(
        'button[type="submit"], input[type="submit"], button:not([type])'
      )
      if (submitBtn) {
        captured = true // prevent re-capture of our own submit
        submitBtn.click()
        setTimeout(() => { captured = false }, 5000)
      } else if (form) {
        form.submit()
      }
    }, 500)
  } catch (err) {
    console.log('[WCS CredCapture] Auto-fill skipped:', err.message)
  }
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('[WCS CredCapture] Loaded on:', window.location.href)

  // Try auto-fill first
  tryAutoFill()

  // Scan for login forms to capture new credentials
  captureCredentials()
  const observer = new MutationObserver(() => {
    captureCredentials()
    tryAutoFill()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // Fallback: periodic scan
  setInterval(captureCredentials, 2000)
  // Retry auto-fill for SPA-rendered forms
  setTimeout(tryAutoFill, 1000)
  setTimeout(tryAutoFill, 3000)
})
