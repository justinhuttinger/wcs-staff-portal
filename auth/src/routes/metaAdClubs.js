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
const { runLaunch } = require('./adsClubRun')

// Meta access arrives as deps from metaAdsManager rather than being imported:
// the helpers live there, and requiring them back would be circular. It also
// keeps every Meta call in this file injectable, which is what makes the
// launch testable without the network.
module.exports = function clubsRouter(deps = {}) {
const router = Router()

const PRESET_COLUMNS = ['campaign_id', 'page_id', 'instagram_id', 'link', 'lead_form_id', 'targeting', 'tokens']

// Clubs plus their presets, in the shape the preview and launch expect.
async function loadClubs(locationIds) {
  const locQuery = supabaseAdmin.from('locations').select('id, name').order('name')
  const presetQuery = supabaseAdmin.from('meta_ad_club_presets').select('*')
  const [{ data: locations, error: locErr }, { data: presets, error: presetErr }] = await Promise.all([
    locationIds ? locQuery.in('id', locationIds) : locQuery,
    locationIds ? presetQuery.in('location_id', locationIds) : presetQuery,
  ])
  if (locErr) throw locErr
  if (presetErr) throw presetErr

  const byLocation = new Map((presets || []).map(p => [p.location_id, p]))
  return (locations || []).map(loc => {
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
  })
}

// GET /meta-ads-manager/clubs — every club, with its preset if it has one.
// Clubs without a preset come back with empty fields rather than being absent,
// so the setup screen lists all of them and shows what is unconfigured.
router.get('/', async (req, res) => {
  try {
    res.json({ clubs: await loadClubs() })
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
    const clubs = await loadClubs(location_ids)
    res.json(previewLaunch(clubs, { adset: adset || {}, variants: variants || [] }))
  } catch (err) {
    console.error('[Meta Ads Clubs] preview failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /meta-ads-manager/clubs/launch — build the ad set and its ads in every
// selected club. Everything lands PAUSED.
//
// The same preview that the UI shows runs again here as a gate: a blocked club
// (missing Page, no geo, no destination, unfilled token) stops the whole launch
// BEFORE anything is written, because a half-launched promotion across seven
// clubs is far worse to clean up than a refused one.
router.post('/launch', async (req, res) => {
  try {
    const { location_ids, adset, variants, shared } = req.body || {}
    if (!Array.isArray(location_ids) || !location_ids.length) {
      return res.status(400).json({ error: 'Select at least one club' })
    }
    if (!Array.isArray(variants) || !variants.length) {
      return res.status(400).json({ error: 'At least one ad variant is required' })
    }

    const clubs = await loadClubs(location_ids)
    const template = { adset: adset || {}, variants }
    const preview = previewLaunch(clubs, template)
    if (!preview.ready) {
      return res.status(400).json({
        error: 'Some clubs are not ready to launch',
        blocked: preview.clubs.filter(c => !c.ready),
      })
    }

    const out = await runLaunch(clubs, template, shared || {}, {
      createAdset: deps.createAdset,
      createAd: deps.createAd,
      pressure: deps.pressure,
    })
    res.json(out)
  } catch (err) {
    console.error('[Meta Ads Clubs] launch failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

  return router
}
