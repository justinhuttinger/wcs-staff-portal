// ABC Financial member data scraper — runs as Electron preload script
// Has full DOM access (same-origin not an issue in Electron)

const { ipcRenderer } = require('electron')

// Login overlay for ABC
let overlayEl = null
function showABCOverlay() {
  if (overlayEl) return
  overlayEl = document.createElement('div')
  overlayEl.innerHTML = `
    <div style="position:fixed;inset:0;z-index:999999;background:#f4f5f7;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Inter',-apple-system,sans-serif;">
      <div style="position:relative;width:100px;height:100px;margin-bottom:24px;"><img src="https://wcs-staff-portal.onrender.com/wcs-logo.svg" style="width:80px;height:80px;position:absolute;top:10px;left:10px;border-radius:50%;" onerror="this.style.display='none'" /><div style="position:absolute;inset:0;border:3px solid #e2e4e8;border-top-color:#e53e3e;border-radius:50%;animation:wcs-spin 0.8s linear infinite;"></div></div>
      <p style="font-size:16px;font-weight:600;color:#1a1a2e;margin-bottom:8px;">Signing you in</p>
      <p style="font-size:13px;color:#8b90a5;">ABC Financial</p>
      <style>@keyframes wcs-spin{to{transform:rotate(360deg)}}</style>
    </div>`
  document.body.appendChild(overlayEl)
  setTimeout(() => { if (overlayEl) { overlayEl.remove(); overlayEl = null } }, 5000)
}

// Auto-fill ABC login form with vault credentials
let autoFilled = false
async function tryAutoFill() {
  if (autoFilled) return
  try {
    const creds = await ipcRenderer.invoke('get-credentials', 'abc')
    if (!creds) return

    // Look for any password field on the page (not just in forms)
    const passwordField = document.querySelector('input[type="password"]')
    if (!passwordField || !passwordField.offsetParent) return

    showABCOverlay()

    // Find username field nearby
    const container = passwordField.closest('form') || document.body
    const usernameField = container.querySelector('input[type="email"], input[type="text"], input[name*="user" i], input[name*="User"], input[name*="email" i], #Username, #username')
    if (!usernameField) return
    if (usernameField.value && passwordField.value) return

    // Use native input setter to bypass framework bindings (React/Angular)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

    usernameField.focus()
    nativeInputValueSetter.call(usernameField, creds.username)
    usernameField.dispatchEvent(new Event('input', { bubbles: true }))
    usernameField.dispatchEvent(new Event('change', { bubbles: true }))

    passwordField.focus()
    nativeInputValueSetter.call(passwordField, creds.password)
    passwordField.dispatchEvent(new Event('input', { bubbles: true }))
    passwordField.dispatchEvent(new Event('change', { bubbles: true }))
    autoFilled = true

    // Submit
    setTimeout(() => {
      const submitBtn = container.querySelector('button[type="submit"], input[type="submit"], button:not([type])')
      if (submitBtn) submitBtn.click()
      else if (container.tagName === 'FORM') container.submit()
    }, 100)

    console.log('[WCS Scraper] Auto-filled ABC login')
  } catch (err) {
    console.log('[WCS Scraper] Auto-fill skipped:', err.message)
  }
}

let memberData = {}

const fieldSelectors = {
  firstName:   ['#firstName', '[name="personalSection.firstName.value"]'],
  lastName:    ['#lastName',  '[name="personalSection.lastName.value"]'],
  email:       ['#email', '#emailAddress', '[name="personalSection.email.value"]', '[name="personalSection.emailAddress.value"]'],
  phone:       ['#cellNumber', '#homeNumber', '#homePhone', '#phone',
                '[name="personalSection.cellNumber.value"]',
                '[name="personalSection.homeNumber.value"]',
                '[name="personalSection.homePhone.value"]'],
  salesperson: ['#salesPersonIdInput', '[name="agreementSection.salesPersonName"]'],
}

function getDoc() {
  try {
    const mainFrame = document.querySelector('#main')
    if (mainFrame && mainFrame.contentDocument && mainFrame.contentDocument.body) {
      return mainFrame.contentDocument
    }
  } catch(e) {}
  return document
}

function scrapeAll() {
  const doc = getDoc()
  let changed = false
  Object.entries(fieldSelectors).forEach(([key, selectors]) => {
    for (const sel of selectors) {
      try {
        const el = doc.querySelector(sel)
        if (el && el.value && el.value.trim().length > 1) {
          const newVal = el.value.trim()
          const oldVal = memberData[key] || ''
          if (newVal.length >= oldVal.length && newVal !== oldVal) {
            memberData[key] = newVal
            changed = true
          }
          break
        }
      } catch(e) {}
    }
  })

  if (changed && Object.keys(memberData).length > 0) {
    ipcRenderer.send('abc-member-data', { ...memberData })
  }
}

// Watch #main iframe for confirmation page
function watchMainFrame() {
  const mainFrame = document.querySelector('#main')
  if (!mainFrame || mainFrame._wcsWatching) return
  mainFrame._wcsWatching = true
  mainFrame.addEventListener('load', () => {
    try {
      const url = mainFrame.contentDocument && mainFrame.contentDocument.location.href
      if (url && url.includes('StandAloneAgreementPdfCommand.pml')) {
        scrapeAll() // Final scrape
        ipcRenderer.send('abc-signup-detected', { ...memberData })
        memberData = {} // Reset for next signup
      }
    } catch(e) {}
  })
}

window.addEventListener('DOMContentLoaded', () => {
  tryAutoFill()
  console.log('[WCS Scraper] Loaded on:', window.location.href)

  setInterval(() => {
    scrapeAll()
    const doc = getDoc()
    if (doc !== document) {
      console.log('[WCS Scraper] Found #main iframe, scraping...')
    }
  }, 500)

  watchMainFrame()
  setInterval(watchMainFrame, 1000)

  // Log when member data is found
  setInterval(() => {
    if (Object.keys(memberData).length > 0) {
      console.log('[WCS Scraper] Member data:', JSON.stringify(memberData))
    }
  }, 3000)

  // Credential capture for ABC login form
  let captured = false
  function captureAbcLogin() {
    if (captured) return
    const passwordField = document.querySelector('input[type="password"]')
    if (!passwordField || !passwordField.offsetParent) return

    const container = passwordField.closest('form') || document.body
    if (container._wcsCapture) return
    container._wcsCapture = true

    function trySend() {
      const usernameField = container.querySelector('input[type="email"], input[type="text"], input[name*="user" i], input[name*="User"], input[name*="email" i]')
      const username = usernameField?.value?.trim()
      const password = passwordField?.value
      if (username && password && !captured) {
        captured = true
        console.log('[WCS Scraper] Captured ABC login credentials')
        ipcRenderer.send('credential-captured', { service: 'abc', username, password })
        setTimeout(() => { captured = false }, 5000)
      }
    }

    if (container.tagName === 'FORM') container.addEventListener('submit', trySend)
    const buttons = container.querySelectorAll('button, input[type="submit"], [role="button"]')
    buttons.forEach(btn => {
      if (btn._wcsCapture) return
      btn._wcsCapture = true
      btn.addEventListener('click', () => setTimeout(trySend, 100))
    })
    passwordField.addEventListener('keydown', (e) => { if (e.key === 'Enter') setTimeout(trySend, 100) })
  }

  // Retry auto-fill for SPA-rendered login pages
  tryAutoFill()
  setTimeout(tryAutoFill, 1000)
  setTimeout(tryAutoFill, 3000)

  captureAbcLogin()
  setInterval(captureAbcLogin, 2000)
})
