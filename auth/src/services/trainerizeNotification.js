/**
 * Trainerize Push Notification automation via Playwright.
 * Logs in, navigates to Announcements, fills the push notification form,
 * takes a screenshot for validation (does NOT click Submit).
 */
const { chromium } = require('playwright')

// Map our location slugs to Trainerize location labels
const LOCATION_MAP = {
  salem: 'West Coast Strength - Salem',
  keizer: 'West Coast Strength - Keizer',
  eugene: 'West Coast Strength - Eugene',
  springfield: 'West Coast Strength - Springfield',
  clackamas: 'West Coast Strength - Clackamas',
  milwaukie: 'East Side Athletic Club - Milwaukie',
}

/**
 * Fill the Trainerize push notification form and take a screenshot.
 * Does NOT submit — returns screenshot buffer for validation.
 *
 * @param {Object} params
 * @param {string} params.title - Notification title (max 65 chars)
 * @param {string} params.message - Notification body (max 120 chars)
 * @param {string[]} params.locations - Array of location slugs (e.g. ['salem', 'keizer']) or ['all']
 * @param {string} params.sendTiming - 'now' or 'scheduled'
 * @param {string} [params.scheduledDate] - Date string (YYYY-MM-DD) if scheduled
 * @param {string} [params.scheduledTime] - Time string (HH:MM) if scheduled
 * @returns {Promise<Buffer>} Screenshot PNG buffer
 */
async function fillNotificationForm(params) {
  const { title, message, locations, sendTiming, scheduledDate, scheduledTime } = params

  const email = process.env.TRAINERIZE_EMAIL
  const password = process.env.TRAINERIZE_PASSWORD
  if (!email || !password) throw new Error('TRAINERIZE_EMAIL and TRAINERIZE_PASSWORD must be set')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  try {
    // 1. Login
    await page.goto('https://westcoaststrength.trainerize.com/app/login', { waitUntil: 'networkidle' })
    await page.fill('input[type="email"], input[name="email"], #email', email)
    await page.fill('input[type="password"], input[name="password"], #password', password)
    await page.click('button[type="submit"], input[type="submit"], .btn-login, button:has-text("Log In")')
    await page.waitForURL('**/app/**', { timeout: 30000 })
    await page.waitForTimeout(2000)

    // 2. Navigate to Announcements
    await page.click('text=Announcements')
    await page.waitForTimeout(2000)

    // 3. Make sure Push Notifications tab is selected
    const pushTab = page.locator('text=Push Notifications').first()
    if (await pushTab.isVisible()) await pushTab.click()
    await page.waitForTimeout(1000)

    // 4. Click NEW button
    await page.click('text=NEW')
    await page.waitForTimeout(2000)

    // 5. Fill Title
    const titleInput = page.locator('input').filter({ hasText: '' }).first()
    // Find the title field - it's the first input in the modal
    const modal = page.locator('.modal, [role="dialog"], .push-notification-form').first()
    const inputs = modal.isVisible() ? modal.locator('input[type="text"]') : page.locator('input[type="text"]')
    const titleField = inputs.first()
    await titleField.fill(title.slice(0, 65))
    await page.waitForTimeout(500)

    // 6. Set send timing
    if (sendTiming === 'now') {
      // Click the "When to send?" dropdown and select "Start sending immediately"
      const whenDropdown = page.locator('select, [class*="dropdown"]').filter({ hasText: /Schedule for|Start sending/ }).first()
      if (await whenDropdown.count() > 0) {
        await whenDropdown.selectOption({ label: 'Start sending immediately' })
      } else {
        // Try clicking the dropdown text and selecting
        await page.click('text=Schedule for')
        await page.waitForTimeout(500)
        await page.click('text=Start sending immediately')
      }
    } else if (sendTiming === 'scheduled' && scheduledDate) {
      // Leave as "Schedule for" (default) and fill date/time
      const dateInput = page.locator('input[type="date"], input[placeholder*="date"], input[placeholder*="Date"]').first()
      if (await dateInput.count() > 0) {
        await dateInput.fill(scheduledDate)
      }
      if (scheduledTime) {
        const timeInput = page.locator('input[type="time"], input[placeholder*="time"], input[placeholder*="Time"]').first()
        if (await timeInput.count() > 0) {
          await timeInput.fill(scheduledTime)
        }
      }
    }
    await page.waitForTimeout(500)

    // 7. Select locations
    // Click the locations field to open dropdown
    await page.click('text=Which locations to send to?')
    await page.waitForTimeout(1000)

    // Expand "All locations" tree
    const allLocsToggle = page.locator('text=All locations').first()
    if (await allLocsToggle.isVisible()) {
      // Click the arrow/triangle to expand
      const expandArrow = allLocsToggle.locator('..').locator('[class*="arrow"], [class*="toggle"], [class*="expand"]').first()
      if (await expandArrow.count() > 0) {
        await expandArrow.click()
      } else {
        await allLocsToggle.click()
      }
      await page.waitForTimeout(1000)
    }

    if (locations.includes('all')) {
      // Check "All locations" checkbox
      const allCheckbox = page.locator('text=All locations').first()
      await allCheckbox.click()
    } else {
      // Check individual locations
      for (const slug of locations) {
        const label = LOCATION_MAP[slug]
        if (!label) continue
        const locCheckbox = page.locator(`text=${label}`).first()
        if (await locCheckbox.isVisible()) {
          await locCheckbox.click()
          await page.waitForTimeout(300)
        }
      }
    }
    await page.waitForTimeout(500)

    // Click somewhere else to close the dropdown
    await page.click('text=Message')
    await page.waitForTimeout(500)

    // 8. Fill Message
    const messageField = page.locator('textarea').first()
    await messageField.fill(message.slice(0, 120))
    await page.waitForTimeout(500)

    // 9. Take screenshot of the filled form (do NOT submit)
    const screenshot = await page.screenshot({ fullPage: true, type: 'png' })

    return screenshot
  } finally {
    await browser.close()
  }
}

module.exports = { fillNotificationForm, LOCATION_MAP }
