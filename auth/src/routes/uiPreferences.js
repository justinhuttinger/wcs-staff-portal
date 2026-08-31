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
const { ID_RE } = require('./backgroundsHelpers')

const router = Router()
router.use(authenticate)

// Generous next to a few short strings, small enough that nobody can park a
// payload in the row.
const MAX_BYTES = 4096

const BACKGROUND_BUCKET = 'portal-backgrounds'

/**
 * A 1-hour signed URL for the user's chosen background, or null.
 *
 * An upload resolves under the user's own folder and a gallery pick under
 * shared/, so a user cannot name another person's folder here even if they
 * hand-edit their prefs blob: the prefix is derived from the token, and `kind`
 * only chooses between "mine" and "shared".
 *
 * A failure is not an error. A deleted image should paint no background, not
 * break the login.
 */
async function signBackground(staffId, background) {
  const kind = background?.kind
  const value = background?.value
  if ((kind !== 'upload' && kind !== 'gallery') || typeof value !== 'string' || !value) return null
  // This is NOT semantic validation of the preference (the module comment
  // above still holds: this route does not interpret prefs, and the
  // allow-lists stay client-side). It is path-safety: `value` comes straight
  // from the user's own prefs blob, PUT does not validate its shape, and it
  // is about to be concatenated into a storage key. Without this, a hand-
  // edited PUT like { kind: 'gallery', value: '../<other-id>/<uuid>.jpg' }
  // could point the signer outside shared/.
  if (!ID_RE.test(value)) return null
  const prefix = kind === 'gallery' ? 'shared' : staffId
  try {
    const { data } = await supabaseAdmin.storage.from(BACKGROUND_BUCKET)
      .createSignedUrl(`${prefix}/${value}`, 60 * 60)
    return data?.signedUrl || null
  } catch {
    return null
  }
}

// GET /ui-preferences — this user's saved prefs ({} if never saved).
//
// backgroundUrl rides along so the client does not need a second round trip
// before it can paint. The prefs blob stores a storage PATH; the bucket is
// private, so a signed URL is minted here on every read. A signed URL is
// deliberately not persisted anywhere: it expires, and a stale one in the
// client's localStorage mirror would 403 on the next load.
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_ui_preferences').select('prefs')
      .eq('staff_id', req.staff.id).maybeSingle()
    if (error) throw error
    const prefs = data?.prefs || {}
    res.json({ prefs, backgroundUrl: await signBackground(req.staff.id, prefs.background) })
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
