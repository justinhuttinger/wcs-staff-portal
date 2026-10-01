// Portal Admin -> Check-in Celebrations (admin only).
//
//   GET /admin/checkin-celebrations/settings  current settings (or defaults)
//   PUT /admin/checkin-celebrations/settings  validate + save
//   GET /admin/checkin-celebrations/recent    latest celebration alerts posted
//
// Settings are JSON text in app_config `checkin_celebration_settings`, read
// nightly by ghl-sync's celebration job (checkinMilestonesJob.js). Validation
// and alert wording come from lib/celebrationSettings.js, a byte-identical
// copy of the module ghl-sync uses.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { LOCATIONS } = require('../config/ghlLocations')
const { CONFIG_KEY, parseSettings, validateSettings } = require('../lib/celebrationSettings')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const CLUB_NAME_MAP = Object.fromEntries(LOCATIONS.map(l => [l.clubCode, l.name]))

router.get('/settings', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config').select('value, updated_at').eq('key', CONFIG_KEY).maybeSingle()
    if (error) throw error
    res.json({ settings: parseSettings(data ? data.value : null), updated_at: data ? data.updated_at : null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/settings', async (req, res) => {
  try {
    const { settings, errors } = validateSettings(req.body && req.body.settings)
    if (errors.length) return res.status(400).json({ error: errors[0], errors })
    const updated_at = new Date().toISOString()
    const { error } = await supabaseAdmin
      .from('app_config')
      .upsert({ key: CONFIG_KEY, value: JSON.stringify(settings), updated_at }, { onConflict: 'key' })
    if (error) throw error
    res.json({ settings, updated_at })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/recent', async (req, res) => {
  try {
    const { data: alerts, error } = await supabaseAdmin
      .from('checkin_milestone_alerts')
      .select('club_number, member_id, milestone, visits, alert_text, posted_at')
      .order('posted_at', { ascending: false })
      .limit(100)
    if (error) throw error
    const ids = [...new Set((alerts || []).map(a => a.member_id))]
    const names = new Map()
    if (ids.length) {
      const { data: members, error: mErr } = await supabaseAdmin
        .from('abc_members').select('member_id, first_name, last_name').in('member_id', ids)
      if (mErr) throw mErr
      for (const m of members || []) names.set(m.member_id, `${m.first_name || ''} ${m.last_name || ''}`.trim())
    }
    res.json({
      recent: (alerts || []).map(a => ({
        posted_at: a.posted_at,
        club: CLUB_NAME_MAP[a.club_number] || a.club_number,
        member: names.get(a.member_id) || a.member_id,
        celebration: `${a.milestone}${a.milestone % 100 >= 11 && a.milestone % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[a.milestone % 10] || 'th'} visit`,
        alert_text: a.alert_text,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
