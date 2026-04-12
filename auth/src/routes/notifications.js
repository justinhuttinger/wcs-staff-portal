const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const LOCATION_MAP = {
  salem: 'West Coast Strength - Salem',
  keizer: 'West Coast Strength - Keizer',
  eugene: 'West Coast Strength - Eugene',
  springfield: 'West Coast Strength - Springfield',
  clackamas: 'West Coast Strength - Clackamas',
  milwaukie: 'East Side Athletic Club - Milwaukie',
}

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

  // This endpoint is a fallback — automation runs in Electron on the kiosk
  return res.status(501).json({
    error: 'Push notifications must be sent from the Portal desktop app (Electron). The browser automation runs locally on the kiosk.'
  })
})

// GET /notifications/locations — returns available Trainerize locations
router.get('/locations', requireRole('manager'), (req, res) => {
  const locations = Object.entries(LOCATION_MAP).map(([slug, label]) => ({ slug, label }))
  res.json({ locations })
})

module.exports = router
