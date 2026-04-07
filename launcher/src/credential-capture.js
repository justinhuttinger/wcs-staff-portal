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

// Loading overlay — shown during auto-fill login
let overlayEl = null
function showLoginOverlay(serviceName) {
  if (overlayEl) return
  overlayEl = document.createElement('div')
  overlayEl.id = 'wcs-login-overlay'
  overlayEl.innerHTML = `
    <div style="position:fixed;inset:0;z-index:999999;background:#f4f5f7;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Inter',-apple-system,sans-serif;">
      <div style="position:relative;width:100px;height:100px;margin-bottom:24px;"><img src="data:image/png;base64,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" style="width:80px;height:80px;position:absolute;top:10px;left:10px;border-radius:50%;" /><div style="position:absolute;inset:0;border:3px solid #e2e4e8;border-top-color:#e53e3e;border-radius:50%;animation:wcs-spin 0.8s linear infinite;"></div></div>
      <p style="font-size:16px;font-weight:600;color:#1a1a2e;margin-bottom:8px;">Signing you in</p>
      <p style="font-size:13px;color:#8b90a5;">${serviceName || 'Please wait...'}</p>
      
      <style>@keyframes wcs-spin{to{transform:rotate(360deg)}}</style>
    </div>
  `
  document.body.appendChild(overlayEl)
}

function hideLoginOverlay() {
  if (overlayEl) {
    overlayEl.remove()
    overlayEl = null
  }
}

// Auto-remove overlay on navigation, MFA screen, or timeout
let initialUrl = window.location.href
setInterval(() => {
  if (!overlayEl) return
  // Hide on URL change (login succeeded)
  if (window.location.href !== initialUrl) { hideLoginOverlay(); return }
  // Hide if MFA/2FA screen appears (no password field but has a code/OTP input)
  const mfaInput = document.querySelector('input[type="tel"], input[autocomplete="one-time-code"], input[name*="code" i], input[name*="otp" i], input[name*="mfa" i], input[name*="verification" i]')
  if (mfaInput && mfaInput.offsetParent) { hideLoginOverlay(); return }
  // Hide if the page has no login form at all (already logged in)
  const hasLoginFields = document.querySelector('input[type="password"], input[type="email"]')
  if (!hasLoginFields) { hideLoginOverlay(); return }
}, 500)
// Safety timeout — hide overlay after 5 seconds regardless
setTimeout(() => hideLoginOverlay(), 5000)

// Auto-fill saved credentials
let autoFillDone = false
async function tryAutoFill() {
  if (autoFillDone) return
  try {
    const service = getServiceName()
    const creds = await ipcRenderer.invoke('get-credentials', service)
    if (!creds) return

    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const passwordField = document.querySelector('input[type="password"]')

    // Only show overlay if we find actual login fields to fill
    const hasLoginFields = passwordField || findUsernameField(document.body)
    if (!hasLoginFields) return

    const SERVICE_LABELS = { abc: 'ABC Financial', ghl: 'Grow CRM', wheniwork: 'WhenIWork', paychex: 'Paychex', operandio: 'Operandio' }
    showLoginOverlay(SERVICE_LABELS[service] || service)

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

      // Auto-submit the username step — search broadly for any clickable button
      setTimeout(() => {
        const container = usernameField.closest('form') || document.body
        let submitBtn = container.querySelector('button[type="submit"], input[type="submit"]')
        if (!submitBtn) {
          // Look for buttons by text content (Continue, Next, Submit, Sign In, Log In)
          const allBtns = container.querySelectorAll('button, [role="button"], a.btn, a.button')
          for (const btn of allBtns) {
            const text = (btn.textContent || btn.value || '').trim().toLowerCase()
            if (['continue', 'next', 'submit', 'sign in', 'log in', 'login'].includes(text)) {
              submitBtn = btn
              break
            }
          }
        }
        if (!submitBtn) {
          // Last resort: find the first visible button
          const btns = container.querySelectorAll('button')
          for (const btn of btns) {
            if (btn.offsetParent) { submitBtn = btn; break }
          }
        }
        if (submitBtn) submitBtn.click()
      }, 300)
    }

    autoFillDone = true
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

// Auto-click SSO button on login pages (e.g. GHL)
function tryAutoClickSSO() {
  const buttons = document.querySelectorAll('button, a, [role="button"]')
  for (const btn of buttons) {
    const text = (btn.textContent || '').trim().toLowerCase()
    if (text.includes('sso') || text.includes('single sign') || text.includes('sign in with sso') || text.includes('login with sso')) {
      if (btn.offsetParent) {
        console.log('[WCS CredCapture] Auto-clicking SSO button:', text)
        setTimeout(() => btn.click(), 500)
        return true
      }
    }
  }
  return false
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('[WCS CredCapture] Loaded on:', window.location.href)

  // Check for SSO button first (e.g. GHL login page) — no overlay for SSO
  if (!tryAutoClickSSO()) {
    // No SSO button found, try regular auto-fill with overlay
    tryAutoFill()
  } else {
    autoFillDone = true // Don't try auto-fill after SSO click
  }

  // Scan for login forms to capture new credentials
  captureCredentials()
  const observer = new MutationObserver(() => {
    captureCredentials()
    if (!tryAutoClickSSO()) tryAutoFill()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // Fallback: periodic scan
  setInterval(captureCredentials, 2000)
  // Retry auto-fill for SPA-rendered forms
  setTimeout(tryAutoFill, 1000)
  setTimeout(tryAutoFill, 3000)
})
