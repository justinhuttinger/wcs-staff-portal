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
      <img src="https://wcs-staff-portal.onrender.com/wcs-logo.svg" style="width:80px;height:80px;margin-bottom:24px;" onerror="this.style.display='none'" />
      <p style="font-size:16px;font-weight:600;color:#1a1a2e;margin-bottom:8px;">Signing you in</p>
      <p style="font-size:13px;color:#8b90a5;">${serviceName || 'Please wait...'}</p>
      <div style="margin-top:24px;width:40px;height:40px;border:3px solid #e2e4e8;border-top-color:#e53e3e;border-radius:50%;animation:wcs-spin 0.8s linear infinite;"></div>
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

    const SERVICE_LABELS = { abc: 'ABC Financial', ghl: 'Grow CRM', wheniwork: 'WhenIWork', paychex: 'Paychex', operandio: 'Operandio' }
    showLoginOverlay(SERVICE_LABELS[service] || service)

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
