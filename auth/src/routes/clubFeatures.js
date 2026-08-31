/**
 * /club-features — which clubs have courts, a pool, and Group X. Admin only.
 *
 * One endpoint for all three rather than a facilities one and a Group X one:
 * they are rows in the same table answering the same question, and two routes
 * over one table is how the two drift.
 *
 * Switching a feature off takes a board off a wall, so this is a hard
 * requireRole('admin') rather than a tile gate.
 */
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { CLUBS, isKnownClubNumber } = require('../lib/groupXClubs')
const { FACILITIES } = require('../lib/facilities')
const clubFeatures = require('../lib/clubFeatures')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// Every togglable feature, in the order the admin grid should show them.
// Facilities come from their allowlist; Group X is the one that is not a
// facility but is configured the same way.
const FEATURES = [
  ...FACILITIES.map(f => ({ key: f.slug, label: f.label, kind: 'facility' })),
  { key: clubFeatures.GROUP_X, label: 'Group X', kind: 'classes' },
]

const FEATURE_KEYS = new Set(FEATURES.map(f => f.key))

router.get('/', async (req, res) => {
  try {
    const map = await clubFeatures.loadMap()
    res.json({
      features: FEATURES,
      clubs: CLUBS,
      // A flat row per pair, so the UI never has to work out a default.
      rows: CLUBS.flatMap(c => FEATURES.map(f => ({
        club_number: c.clubNumber,
        club_name: c.name,
        feature: f.key,
        feature_label: f.label,
        enabled: clubFeatures.enabledIn(map, c.clubNumber, f.key),
      }))),
    })
  } catch (err) {
    console.error('[clubFeatures] GET failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.put('/', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required' })
  }
  if (!FEATURE_KEYS.has(String(b.feature))) {
    return res.status(400).json({ error: 'unknown feature' })
  }
  if (typeof b.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false' })
  }
  try {
    // Whole row: a partial upsert fails NOT NULL columns even on an existing
    // row, which has broken writes in this codebase before.
    const { error } = await supabaseAdmin
      .from('club_features')
      .upsert({
        club_number: String(b.club_number),
        feature: String(b.feature),
        enabled: b.enabled,
        updated_by: req.user?.email || 'unknown',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'club_number,feature' })
    if (error) throw new Error(error.message)
    clubFeatures.invalidate()
    res.json({ ok: true })
  } catch (err) {
    console.error('[clubFeatures] PUT failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
