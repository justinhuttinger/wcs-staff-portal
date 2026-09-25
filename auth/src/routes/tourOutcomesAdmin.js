const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { clearOutcomeRulesCache } = require('../lib/tourOutcomeRules')
const { validateOutcome, passModeOf } = require('../lib/tourOutcomeAdmin')

// Admin -> Tour Check-In -> Outcomes. Edits tour_outcomes, which the iPad app,
// the desktop queue, the kiosk and the tour reports all read, so a change here
// is live everywhere without a deploy.

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const COLS = 'outcome, label, is_sale, sort_order, default_pass_days, grants_pass, counts_as_tour, location_slugs'

async function clubSlugs() {
  const { data, error } = await supabaseAdmin.from('locations').select('name').order('name')
  if (error) throw new Error(error.message)
  return (data || []).map(l => ({ slug: l.name.trim().toLowerCase(), name: l.name }))
}

function shape(row) {
  return { ...row, pass_mode: passModeOf(row) }
}

// GET /admin/tour-outcomes -> every outcome, in order, plus the clubs to pick from
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tour_outcomes').select(COLS).order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    res.json({ outcomes: (data || []).map(shape), clubs: await clubSlugs() })
  } catch (err) {
    console.error('[tour-outcomes-admin] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load tour outcomes' })
  }
})

// POST /admin/tour-outcomes -> add one, at the end of the list
router.post('/', async (req, res) => {
  try {
    const slugs = (await clubSlugs()).map(c => c.slug)
    const { errors, row } = validateOutcome(req.body, slugs, true)
    if (errors.length) return res.status(400).json({ error: errors.join(' ') })

    // Compared here rather than with ilike, which would read _ and % as wildcards.
    const { data: all } = await supabaseAdmin.from('tour_outcomes').select('outcome')
    const existing = (all || []).find(r => r.outcome.toLowerCase() === row.outcome.toLowerCase())
    if (existing) return res.status(409).json({ error: `"${existing.outcome}" already exists.` })

    if (row.sort_order === undefined) {
      const { data: last } = await supabaseAdmin
        .from('tour_outcomes').select('sort_order')
        .order('sort_order', { ascending: false }).limit(1).maybeSingle()
      row.sort_order = ((last && last.sort_order) || 0) + 10
    }

    const { data, error } = await supabaseAdmin.from('tour_outcomes').insert(row).select(COLS).single()
    if (error) throw new Error(error.message)
    clearOutcomeRulesCache()
    res.json({ outcome: shape(data) })
  } catch (err) {
    console.error('[tour-outcomes-admin] create failed:', err.message)
    res.status(500).json({ error: 'Failed to add outcome' })
  }
})

// PUT /admin/tour-outcomes/reorder { outcomes: [name, ...] } -> sort_order by position
router.put('/reorder', async (req, res) => {
  try {
    const names = Array.isArray(req.body?.outcomes) ? req.body.outcomes : null
    if (!names || !names.length) return res.status(400).json({ error: 'outcomes list required' })
    for (let i = 0; i < names.length; i++) {
      const { error } = await supabaseAdmin
        .from('tour_outcomes').update({ sort_order: (i + 1) * 10 }).eq('outcome', String(names[i]))
      if (error) throw new Error(error.message)
    }
    clearOutcomeRulesCache()
    res.json({ ok: true })
  } catch (err) {
    console.error('[tour-outcomes-admin] reorder failed:', err.message)
    res.status(500).json({ error: 'Failed to reorder outcomes' })
  }
})

// PUT /admin/tour-outcomes/:outcome -> change clubs, pass length, tour/sale flags.
// The name itself is fixed: it is what past tours recorded.
router.put('/:outcome', async (req, res) => {
  try {
    const slugs = (await clubSlugs()).map(c => c.slug)
    const { errors, row } = validateOutcome(req.body, slugs, false)
    if (errors.length) return res.status(400).json({ error: errors.join(' ') })

    const { data, error } = await supabaseAdmin
      .from('tour_outcomes').update(row).eq('outcome', req.params.outcome)
      .select(COLS).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return res.status(404).json({ error: 'Outcome not found' })
    clearOutcomeRulesCache()
    res.json({ outcome: shape(data) })
  } catch (err) {
    console.error('[tour-outcomes-admin] update failed:', err.message)
    res.status(500).json({ error: 'Failed to save outcome' })
  }
})

// DELETE /admin/tour-outcomes/:outcome -> remove it from every club. Past tours
// keep the outcome text they were saved with.
router.delete('/:outcome', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tour_outcomes').delete().eq('outcome', req.params.outcome).select('outcome')
    if (error) throw new Error(error.message)
    if (!data || !data.length) return res.status(404).json({ error: 'Outcome not found' })
    clearOutcomeRulesCache()
    res.json({ ok: true })
  } catch (err) {
    console.error('[tour-outcomes-admin] delete failed:', err.message)
    res.status(500).json({ error: 'Failed to delete outcome' })
  }
})

module.exports = router
