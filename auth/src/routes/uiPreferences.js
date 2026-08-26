// auth/src/routes/uiPreferences.js
// Per-user portal UI preferences — appearance (theme, accent, density, layout)
// and the Press nav's pinned shortcuts.
//
// Any authenticated user, and only ever their OWN row: staff_id comes from the
// token, never from the body, so one person cannot write another's bar.
//
// The server does not interpret the payload. Validation of allowed themes and
// pin keys lives in the client (portal/src/lib/theme.js, lib/pinnedTabs.js),
// which already has to do it for the localStorage path — duplicating the
// allow-lists here would give us two places to update every time the theme
// gains an option, and they would drift. What IS enforced here is shape and
// size, so a bad client cannot store something unbounded.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')

const router = Router()
router.use(authenticate)

// Generous next to a few short strings, small enough that nobody can park a
// payload in the row.
const MAX_BYTES = 4096

// GET /ui-preferences — this user's saved prefs ({} if never saved).
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_ui_preferences').select('prefs')
      .eq('staff_id', req.staff.id).maybeSingle()
    if (error) throw error
    res.json({ prefs: data?.prefs || {} })
  } catch (err) {
    console.error('[ui-preferences] read failed:', err.message)
    res.status(500).json({ error: 'preferences read failed' })
  }
})

// PUT /ui-preferences { prefs } — replace this user's prefs.
//
// A whole-object replace, not a merge: the client holds the complete set and
// a partial upsert here would fight it. Note the row is written in full for
// the same reason a partial upsert cannot work against NOT NULL columns.
router.put('/', async (req, res) => {
  try {
    const prefs = req.body?.prefs
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
      return res.status(400).json({ error: 'prefs must be an object' })
    }
    if (Buffer.byteLength(JSON.stringify(prefs), 'utf8') > MAX_BYTES) {
      return res.status(413).json({ error: 'preferences too large' })
    }
    const { error } = await supabaseAdmin
      .from('user_ui_preferences')
      .upsert(
        { staff_id: req.staff.id, prefs, updated_at: new Date().toISOString() },
        { onConflict: 'staff_id' },
      )
    if (error) throw error
    res.json({ prefs })
  } catch (err) {
    console.error('[ui-preferences] write failed:', err.message)
    res.status(500).json({ error: 'preferences write failed' })
  }
})

module.exports = router
