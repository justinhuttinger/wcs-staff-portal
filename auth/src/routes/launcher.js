// Desktop-launcher install registry + one-time location deep links.
//
//  - POST /launcher/heartbeat  (open) — every launcher checks in on startup and
//    every 15 min with its install_id + current location/abc_url/version. The
//    response carries a pending admin "target" (new location/abc_url) which the
//    launcher applies and reports back on its next beat.
//  - POST /launcher/redeem     (open, token = credential) — the wcsportal://
//    deep link hands a one-time token here; we return the location/abc_url to
//    apply and burn the token.
//  - GET/PATCH/DELETE /launcher/installs, POST/GET /launcher/links — admin only.
//
// heartbeat + redeem are intentionally unauthenticated: the launcher hits them
// before any user logs in. The data is low-sensitivity (which club a kiosk
// shows). An optional shared key (LAUNCHER_KEY env) gates heartbeat if set.

const crypto = require('crypto')
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : null)

// Resolve a club's ABC workstation URL from the locations table (case-insensitive).
async function abcUrlForLocation(location) {
  if (!location) return null
  const { data } = await supabaseAdmin
    .from('locations').select('abc_url').ilike('name', location).maybeSingle()
  return data?.abc_url || null
}

// --- Launcher-facing (open) -------------------------------------------------

// POST /heartbeat — upsert the install, hand back any pending target.
router.post('/heartbeat', async (req, res) => {
  try {
    const requiredKey = process.env.LAUNCHER_KEY
    if (requiredKey && req.get('x-launcher-key') !== requiredKey) {
      return res.status(401).json({ error: 'Bad launcher key' })
    }
    const installId = str(req.body.install_id, 100)
    if (!installId) return res.status(400).json({ error: 'install_id required' })

    const location = str(req.body.location, 100)
    const abcUrl = str(req.body.abc_url, 1000)

    const { data: existing } = await supabaseAdmin
      .from('launcher_installs').select('*').eq('install_id', installId).maybeSingle()

    // If the reported state already matches a pending target, the change took —
    // mark it applied and clear the target so it doesn't re-fire.
    let clearTarget = false
    if (existing?.target_location) {
      const locMatches = (existing.target_location || null) === (location || null)
      const abcMatches = !existing.target_abc_url || existing.target_abc_url === abcUrl
      if (locMatches && abcMatches) clearTarget = true
    }

    const row = {
      install_id: installId,
      hostname: str(req.body.hostname, 200),
      location,
      abc_url: abcUrl,
      app_version: str(req.body.app_version, 50),
      last_seen_at: new Date().toISOString(),
      ...(clearTarget ? { target_location: null, target_abc_url: null, applied_at: new Date().toISOString() } : {}),
    }
    if (!existing) row.first_seen_at = new Date().toISOString()

    const { data: saved, error } = await supabaseAdmin
      .from('launcher_installs')
      .upsert(row, { onConflict: 'install_id' })
      .select()
      .single()
    if (error) throw error

    // Pending target still set (and not just-applied) → tell the launcher.
    const target = (!clearTarget && saved.target_location)
      ? { location: saved.target_location, abc_url: saved.target_abc_url || await abcUrlForLocation(saved.target_location) }
      : null

    res.json({ ok: true, target })
  } catch (err) {
    console.error('[Launcher] heartbeat error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /redeem — burn a one-time link token, return what to apply.
router.post('/redeem', async (req, res) => {
  try {
    const token = str(req.body.token, 200)
    if (!token) return res.status(400).json({ error: 'token required' })
    const installId = str(req.body.install_id, 100)

    const { data: link } = await supabaseAdmin
      .from('launcher_location_links').select('*').eq('token', token).maybeSingle()
    if (!link) return res.status(404).json({ error: 'Link not found' })
    if (link.used_at) return res.status(410).json({ error: 'This link has already been used' })
    if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired' })
    if (link.install_id && installId && link.install_id !== installId) {
      return res.status(403).json({ error: 'This link is for a different machine' })
    }

    const abcUrl = link.abc_url || await abcUrlForLocation(link.location)

    await supabaseAdmin
      .from('launcher_location_links')
      .update({ used_at: new Date().toISOString(), used_by_install: installId })
      .eq('id', link.id)

    res.json({ location: link.location, abc_url: abcUrl })
  } catch (err) {
    console.error('[Launcher] redeem error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// --- Admin -------------------------------------------------------------------

router.use(authenticate)
router.use(requireRole('admin'))

// GET /installs — every known machine, newest check-in first.
router.get('/installs', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('launcher_installs').select('*').order('last_seen_at', { ascending: false }).limit(2000)
    if (error) throw error
    res.json({ installs: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /installs/:id — set (or clear) the pending target location + ABC URL.
// Pass { target_location: null } to cancel a pending change.
router.patch('/installs/:id', async (req, res) => {
  try {
    const patch = {}
    if ('nickname' in req.body) patch.nickname = str(req.body.nickname, 120)
    if ('target_location' in req.body) {
      const loc = str(req.body.target_location, 100)
      patch.target_location = loc
      // ABC URL follows the location unless explicitly provided.
      patch.target_abc_url = 'target_abc_url' in req.body
        ? str(req.body.target_abc_url, 1000)
        : (loc ? await abcUrlForLocation(loc) : null)
      patch.target_set_at = loc ? new Date().toISOString() : null
      patch.target_set_by = loc ? (req.staff.display_name || req.staff.email || null) : null
      patch.applied_at = null
    } else if ('target_abc_url' in req.body) {
      patch.target_abc_url = str(req.body.target_abc_url, 1000)
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' })

    const { data, error } = await supabaseAdmin
      .from('launcher_installs').update(patch).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Install not found' })
    res.json({ install: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /installs/:id — drop a stale/retired machine.
router.delete('/installs/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('launcher_installs').delete().eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Install not found' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /links — mint a one-time deep link. Body: { location, abc_url?,
// install_id?, expires_in_hours? }. Returns the wcsportal:// url to send.
router.post('/links', async (req, res) => {
  try {
    const location = str(req.body.location, 100)
    if (!location) return res.status(400).json({ error: 'location required' })
    const abcUrl = 'abc_url' in req.body ? str(req.body.abc_url, 1000) : await abcUrlForLocation(location)
    const hours = Math.min(Math.max(parseInt(req.body.expires_in_hours) || 72, 1), 720)
    const token = crypto.randomBytes(24).toString('base64url')

    const { data, error } = await supabaseAdmin
      .from('launcher_location_links')
      .insert({
        token,
        location,
        abc_url: abcUrl,
        install_id: str(req.body.install_id, 100),
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
        expires_at: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
      })
      .select()
      .single()
    if (error) throw error

    res.status(201).json({ link: { ...data, url: `wcsportal://set-location?token=${token}` } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /links — recent links with status.
router.get('/links', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('launcher_location_links')
      .select('*').order('created_at', { ascending: false }).limit(100)
    if (error) throw error
    const now = Date.now()
    res.json({
      links: (data || []).map(l => ({
        ...l,
        url: `wcsportal://set-location?token=${l.token}`,
        status: l.used_at ? 'used' : (new Date(l.expires_at).getTime() < now ? 'expired' : 'active'),
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
