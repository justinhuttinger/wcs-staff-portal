/**
 * /admin/stl-business-hours — the staffed window Business-Hours Speed to Lead
 * clamps to, per club (stl_business_hours_config, ghl-sync migration 012).
 *
 * GET  /             every GHL location with its window (defaults if no row)
 * PUT  /:locationId  upsert one club's window_start, window_end, active_days
 *
 * The KPI report, the Business-Hours STL admin page and the nightly KPI
 * snapshot all read speed_to_lead_business(), which joins this table live — no
 * redeploy, and past leads are re-clamped to the new window when recomputed.
 */

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { parseWindow } = require('../lib/stlBusinessHours')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// Column defaults from migration 013, used for a club that has no row yet.
const DEFAULTS = {
  timezone: 'America/Los_Angeles', window_start: '11:00', window_end: '19:30',
  active_days: [0, 1, 2, 3, 4, 5, 6],
}

const hhmm = (t) => String(t || '').slice(0, 5)

router.get('/', async (req, res) => {
  try {
    const [{ data: locs, error: lErr }, { data: rows, error: cErr }] = await Promise.all([
      supabaseAdmin.from('ghl_locations').select('id, name').order('name'),
      supabaseAdmin.from('stl_business_hours_config').select('*'),
    ])
    if (lErr) throw new Error(lErr.message)
    if (cErr) throw new Error(cErr.message)
    const byId = new Map((rows || []).map(r => [r.location_id, r]))
    res.json({
      clubs: (locs || []).map(l => {
        const r = byId.get(l.id)
        return {
          location_id: l.id,
          name: l.name,
          timezone: r?.timezone || DEFAULTS.timezone,
          window_start: r ? hhmm(r.window_start) : DEFAULTS.window_start,
          window_end: r ? hhmm(r.window_end) : DEFAULTS.window_end,
          active_days: r?.active_days || DEFAULTS.active_days,
          configured: !!r,
          updated_at: r?.updated_at || null,
        }
      }),
    })
  } catch (err) {
    console.error('[admin/stl-business-hours] GET error:', err.message)
    res.status(500).json({ error: 'Failed to load business hours' })
  }
})

router.put('/:locationId', async (req, res) => {
  try {
    const locationId = String(req.params.locationId || '')
    const { value, error } = parseWindow(req.body)
    if (error) return res.status(400).json({ error })

    const { data: loc } = await supabaseAdmin
      .from('ghl_locations').select('id').eq('id', locationId).maybeSingle()
    if (!loc) return res.status(404).json({ error: 'Unknown location' })

    const { data, error: upErr } = await supabaseAdmin
      .from('stl_business_hours_config')
      .upsert({
        location_id: locationId,
        timezone: DEFAULTS.timezone,
        ...value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'location_id' })
      .select()
      .single()
    if (upErr) throw new Error(upErr.message)
    res.json({
      ...data,
      window_start: hhmm(data.window_start),
      window_end: hhmm(data.window_end),
    })
  } catch (err) {
    console.error('[admin/stl-business-hours] PUT error:', err.message)
    res.status(500).json({ error: 'Failed to save business hours' })
  }
})

module.exports = router
