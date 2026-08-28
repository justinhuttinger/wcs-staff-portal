const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { supabaseAdmin } = require('../services/supabase')
const { validateTourCompletion, toRow } = require('../lib/tourCompletion')

// ---------------------------------------------------------------------------
// Tour completion ingest.
//
// The portal product that records tours posts here when one is finished. This
// owns the schema and the validation; the caller owns the interface. See
// docs/TOUR_COMPLETION_API.md for the contract handed to that team.
//
// A tour that was never checked in is still a tour: if no intake row matches,
// one is INSERTED rather than rejected. Refusing would push staff back to
// recording tours on paper, which is the outcome this whole exercise exists to
// end.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)

/** Allowed outcomes, read from the table so adding one is a row, not a deploy. */
async function allowedOutcomes() {
  const { data, error } = await supabaseAdmin
    .from('tour_outcomes')
    .select('outcome')
  if (error) throw new Error(error.message)
  return new Set((data || []).map(r => r.outcome))
}

router.get('/outcomes', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tour_outcomes')
      .select('outcome, label, is_sale, sort_order')
      .order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    res.json({ outcomes: data || [] })
  } catch (err) {
    console.error('[tours/outcomes] error:', err.message)
    res.status(500).json({ error: 'Failed to load tour outcomes' })
  }
})

router.post('/complete', async (req, res) => {
  try {
    const outcomes = await allowedOutcomes()
    const { ok, errors, value } = validateTourCompletion(req.body, outcomes)
    // Every problem at once: a caller fixing one field per round trip gives up.
    if (!ok) return res.status(400).json({ error: 'Invalid tour completion', details: errors })

    const row = toRow(value, { staffId: req.staff?.id || null })

    // Find the intake this completes, by explicit id first and then by contact.
    let existing = null
    if (value.tourIntakeId) {
      const { data, error } = await supabaseAdmin
        .from('tour_intakes').select('id').eq('id', value.tourIntakeId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return res.status(404).json({ error: 'No tour found for that tourIntakeId' })
      existing = data
    } else if (value.ghlContactId) {
      // The most recent OPEN intake for this contact. Matching a completed one
      // would overwrite an earlier tour with a later tour's outcome.
      const { data, error } = await supabaseAdmin
        .from('tour_intakes')
        .select('id')
        .eq('ghl_contact_id', value.ghlContactId)
        .neq('status', 'completed')
        .order('received_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(error.message)
      existing = (data || [])[0] || null
    }

    let saved
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('tour_intakes').update(row).eq('id', existing.id).select().single()
      if (error) throw new Error(error.message)
      saved = data
    } else {
      const { data, error } = await supabaseAdmin
        .from('tour_intakes')
        .insert({ ...row, received_at: value.completedAt })
        .select().single()
      if (error) throw new Error(error.message)
      saved = data
    }

    res.json({
      ok: true,
      tourId: saved.id,
      created: !existing,
      outcome: saved.outcome,
      clubNumber: saved.club_number,
      givenBy: saved.given_by_name || saved.given_by_employee_id,
    })
  } catch (err) {
    console.error('[tours/complete] error:', err.message)
    res.status(500).json({ error: 'Failed to record tour completion' })
  }
})

module.exports = router
