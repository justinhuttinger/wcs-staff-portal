// ABC Financial member data scraper — runs as Electron preload script
// Has full DOM access (same-origin not an issue in Electron)

const { ipcRenderer } = require('electron')

// Auto-fill ABC login form with vault credentials
async function tryAutoFill() {
  try {
    const creds = await ipcRenderer.invoke('get-credentials', 'abc')
    if (!creds) return

    // Look for ABC login form fields
    const usernameField = document.querySelector('#Username, #username, input[name="Username"], input[name="username"]')
    const passwordField = document.querySelector('#Password, #password, input[name="Password"], input[name="password"]')
    const submitBtn = document.querySelector('input[type="submit"], button[type="submit"]')

    if (usernameField && passwordField) {
      usernameField.value = creds.username
      usernameField.dispatchEvent(new Event('input', { bubbles: true }))
      passwordField.value = creds.password
      passwordField.dispatchEvent(new Event('input', { bubbles: true }))

      // Auto-submit after a brief delay
      if (submitBtn) {
        setTimeout(() => submitBtn.click(), 300)
      }

      console.log('[WCS Scraper] Auto-filled ABC login')
    }
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
})
