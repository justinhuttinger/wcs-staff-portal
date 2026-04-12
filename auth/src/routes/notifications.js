const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { fillNotificationForm, LOCATION_MAP } = require('../services/trainerizeNotification')

const router = Router()
router.use(authenticate)

// POST /notifications/push — manager+ only
// Fills the Trainerize push notification form and returns a screenshot for validation
router.post('/push', requireRole('manager'), async (req, res) => {
  const { title, message, locations, sendTiming, scheduledDate, scheduledTime } = req.body

  if (!title?.trim()) return res.status(400).json({ error: 'Title is required (max 65 characters)' })
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required (max 120 characters)' })
  if (!locations || !Array.isArray(locations) || locations.length === 0) {
    return res.status(400).json({ error: 'At least one location must be selected' })
  }
  if (sendTiming === 'scheduled' && !scheduledDate) {
    return res.status(400).json({ error: 'Date is required when scheduling' })
  }

  if (!process.env.TRAINERIZE_EMAIL || !process.env.TRAINERIZE_PASSWORD) {
    return res.status(501).json({ error: 'Trainerize credentials not configured' })
  }

  try {
    console.log(`[Notifications] Push notification requested by ${req.staff.display_name || req.staff.email}:`, {
      title: title.slice(0, 30) + '...',
      locations,
      sendTiming,
    })

    const screenshot = await fillNotificationForm({
      title: title.trim(),
      message: message.trim(),
      locations,
      sendTiming: sendTiming || 'now',
      scheduledDate,
      scheduledTime,
    })

    // Return screenshot as base64 for the frontend to display/download
    const base64 = screenshot.toString('base64')
    res.json({
      success: true,
      screenshot: 'data:image/png;base64,' + base64,
      message: 'Form filled successfully. Review the screenshot to verify before enabling auto-submit.',
    })
  } catch (err) {
    console.error('[Notifications] Push notification failed:', err.message)
    res.status(500).json({ error: 'Automation failed: ' + err.message })
  }
})

// GET /notifications/locations — returns available Trainerize locations
router.get('/locations', requireRole('manager'), (req, res) => {
  const locations = Object.entries(LOCATION_MAP).map(([slug, label]) => ({ slug, label }))
  res.json({ locations })
})

module.exports = router
