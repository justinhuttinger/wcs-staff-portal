// Club Setup + launch preview for the Ads Manager.
//
// Mounted under /meta-ads-manager/clubs, so it inherits that router's
// authenticate + requireRole('admin') gates — this edits settings for an ad
// account that spends real money and is deliberately not in the roles grid.
//
// Nothing here calls Meta. Reads and writes are the portal's own presets, and
// the preview is pure token rendering, so an admin can iterate on copy without
// spending a single API call against the rate limit.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { previewLaunch } = require('./adsClubLaunch')

const router = Router()

const PRESET_COLUMNS = ['campaign_id', 'page_id', 'instagram_id', 'link', 'lead_form_id', 'targeting', 'tokens']

// GET /meta-ads-manager/clubs — every club, with its preset if it has one.
// Clubs without a preset come back with empty fields rather than being absent,
// so the setup screen lists all of them and shows what is unconfigured.
router.get('/', async (req, res) => {
  try {
    const [{ data: locations, error: locErr }, { data: presets, error: presetErr }] = await Promise.all([
      supabaseAdmin.from('locations').select('id, name').order('name'),
      supabaseAdmin.from('meta_ad_club_presets').select('*'),
    ])
    if (locErr) throw locErr
    if (presetErr) throw presetErr

    const byLocation = new Map((presets || []).map(p => [p.location_id, p]))
    res.json({
      clubs: (locations || []).map(loc => {
        const preset = byLocation.get(loc.id) || {}
        return {
          location_id: loc.id,
          name: loc.name,
          campaign_id: preset.campaign_id || null,
          page_id: preset.page_id || null,
          instagram_id: preset.instagram_id || null,
          link: preset.link || null,
          lead_form_id: preset.lead_form_id || null,
          targeting: preset.targeting || {},
          tokens: preset.tokens || {},
          updated_at: preset.updated_at || null,
        }
      }),
    })
  } catch (err) {
    console.error('[Meta Ads Clubs] list failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /meta-ads-manager/clubs/:locationId — save one club's setup.
router.put('/:locationId', async (req, res) => {
  try {
    const row = { location_id: req.params.locationId, updated_at: new Date().toISOString(), updated_by: req.staff.id }
    for (const col of PRESET_COLUMNS) {
      if (req.body[col] === undefined) continue
      // Empty strings are a cleared field, not a value Meta should ever see.
      row[col] = req.body[col] === '' ? null : req.body[col]
    }
    if (row.targeting === null) row.targeting = {}
    if (row.tokens === null) row.tokens = {}

    const { data, error } = await supabaseAdmin
      .from('meta_ad_club_presets')
      .upsert(row, { onConflict: 'location_id' })
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('[Meta Ads Clubs] save failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /meta-ads-manager/clubs/preview — what each selected club would get.
// Costs nothing: no Meta call, no write. This is the screen an admin reads
// before committing a launch.
router.post('/preview', async (req, res) => {
  try {
    const { location_ids, adset, variants } = req.body || {}
    if (!Array.isArray(location_ids) || !location_ids.length) {
      return res.status(400).json({ error: 'Select at least one club' })
    }

    const [{ data: locations, error: locErr }, { data: presets, error: presetErr }] = await Promise.all([
      supabaseAdmin.from('locations').select('id, name').in('id', location_ids),
      supabaseAdmin.from('meta_ad_club_presets').select('*').in('location_id', location_ids),
    ])
    if (locErr) throw locErr
    if (presetErr) throw presetErr

    const byLocation = new Map((presets || []).map(p => [p.location_id, p]))
    const clubs = (locations || []).map(loc => ({
      location_id: loc.id,
      name: loc.name,
      ...(byLocation.get(loc.id) || {}),
    }))

    res.json(previewLaunch(clubs, { adset: adset || {}, variants: variants || [] }))
  } catch (err) {
    console.error('[Meta Ads Clubs] preview failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
