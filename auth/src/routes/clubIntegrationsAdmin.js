/**
 * /admin/club-integrations — per-club outbound webhook URLs.
 *
 * These are the URLs the prospects---documents service POSTs to when something
 * happens at a club: a VIP referral, a PT intake, a completed tour, and the two
 * halves of the kiosk waiver. They used to live in clubs-config.json, which made
 * repointing one a commit and a redeploy. Now they are rows in club_integrations
 * and this is the editor.
 *
 * Keyed by ABC club number, not locations(id) — see migration 075 for why.
 *
 * GET  /            every club, whether or not it has a row yet
 * PUT  /:clubNumber upsert one club's URLs
 */

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { NAME_TO_CLUB } = require('../config/clubMap')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// The editable columns, in the order the UI renders them. Adding an integration
// means a column in a migration and one entry here — but only for integrations
// nothing else owns. VIP referrals (vip_referral_config) and the portal's Tour
// Check-In (tour_location_config) each have their own screen already; putting
// them here too would mean two editors for one setting.
const WEBHOOK_FIELDS = [
  'kiosk_waiver_lead_webhook_url',
  'kiosk_waiver_completed_webhook_url',
  'pt_intake_webhook_url',
]

// Per-club values the waiver pipeline substitutes when a prospect's own answer
// is unusable. Edited on their own screen (Admin -> Club Info) rather than
// alongside the webhooks: they are club facts, not integration wiring, and
// keeping the two field sets disjoint means neither screen can clobber the
// other's values even though both write this table.
const FALLBACK_FIELDS = [
  'fallback_address1',
  'fallback_city',
  'fallback_state',
  'fallback_postal_code',
  'fallback_phone',
]

const EDITABLE_FIELDS = [...WEBHOOK_FIELDS, ...FALLBACK_FIELDS]

// ABC wants exactly two letters. Rejecting a bad one here is the whole point of
// the screen - a fallback that ABC also refuses is worse than none, because it
// looks like the problem is handled.
function invalidState(value) {
  if (!value) return null
  return /^[A-Za-z]{2}$/.test(String(value).trim())
    ? null
    : 'must be a two-letter state code, e.g. OR'
}

// ABC takes 10 digits. Anything else is stored as-is by the file path but would
// be dropped by formatPhoneNumber, so catch it while somebody is looking.
function invalidPhone(value) {
  if (!value) return null
  const digits = String(value).replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return national.length === 10 ? null : 'must be a 10-digit US phone number'
}

// Fallback club list, so the screen still renders every club before the seed
// has run. Mirrors clubMap.js, which is the canonical name -> club number map.
const FALLBACK_CLUBS = Object.entries(NAME_TO_CLUB).map(([slug, clubNumber]) => ({
  abc_club_number: clubNumber,
  location_slug: slug,
  display_name: slug.charAt(0).toUpperCase() + slug.slice(1),
}))

function emptyRow(club) {
  const row = { ...club, active: true, updated_at: null }
  for (const f of EDITABLE_FIELDS) row[f] = ''
  return row
}

// A URL a GHL inbound-webhook trigger would actually accept. Catching this here
// means a typo shows up as a red field instead of a webhook that silently never
// fires, which is invisible until someone notices no follow-up went out.
function invalidUrl(value) {
  if (!value) return null
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return 'must be a full URL starting with https://'
  }
  if (parsed.protocol !== 'https:') return 'must use https://'
  return null
}

// GET /admin/club-integrations
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('club_integrations')
      .select('*')
      .order('display_name')

    // Migration 075 may not be applied yet. Render the editor with empty rows
    // rather than an error page — it tells the admin what is missing far better
    // than a 500 does.
    if (error) {
      console.warn('[club-integrations] table unavailable, serving defaults:', error.message)
      return res.json({
        clubs: FALLBACK_CLUBS.map(emptyRow),
        warning: 'club_integrations table not found — apply migration 075.',
      })
    }

    const byClub = Object.fromEntries((data || []).map(r => [r.abc_club_number, r]))
    const clubs = FALLBACK_CLUBS.map(club => {
      const row = byClub[club.abc_club_number]
      if (!row) return emptyRow(club)
      const out = {
        abc_club_number: row.abc_club_number,
        location_slug: row.location_slug,
        display_name: row.display_name,
        active: row.active,
        updated_at: row.updated_at,
      }
      for (const f of EDITABLE_FIELDS) out[f] = row[f] || ''
      return out
    })

    res.json({ clubs })
  } catch (err) {
    console.error('[club-integrations] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load club integrations' })
  }
})

// PUT /admin/club-integrations/:clubNumber
router.put('/:clubNumber', async (req, res) => {
  const clubNumber = String(req.params.clubNumber || '').trim()
  const club = FALLBACK_CLUBS.find(c => c.abc_club_number === clubNumber)
  if (!club) return res.status(404).json({ error: `Unknown club number ${clubNumber}` })

  const body = req.body || {}

  const errors = {}
  for (const f of WEBHOOK_FIELDS) {
    if (!(f in body)) continue
    const problem = invalidUrl(String(body[f] || '').trim())
    if (problem) errors[f] = problem
  }
  if ('fallback_state' in body) {
    const problem = invalidState(String(body.fallback_state || '').trim())
    if (problem) errors.fallback_state = problem
  }
  if ('fallback_phone' in body) {
    const problem = invalidPhone(String(body.fallback_phone || '').trim())
    if (problem) errors.fallback_phone = problem
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Check the highlighted fields', fields: errors })
  }

  // display_name and location_slug are NOT NULL with no default, and Postgres
  // validates NOT NULL on the candidate insert row even for ON CONFLICT DO
  // UPDATE. Always carry them, or the first save for a club 500s.
  const patch = {
    abc_club_number: clubNumber,
    location_slug: club.location_slug,
    display_name: club.display_name,
    active: body.active !== false,
    updated_at: new Date().toISOString(),
    updated_by: req.staff?.id || null,
  }
  // Only the fields the caller actually sent. Club Info and Club Integrations
  // edit disjoint halves of this row, so a save from one must leave the other
  // untouched rather than blanking it.
  for (const f of EDITABLE_FIELDS) {
    if (f in body) {
      const value = String(body[f] || '').trim()
      patch[f] = f === 'fallback_state' ? (value.toUpperCase() || null) : (value || null)
    }
  }

  try {
    const { error } = await supabaseAdmin
      .from('club_integrations')
      .upsert(patch, { onConflict: 'abc_club_number' })
    if (error) {
      console.error('[club-integrations] save failed:', error.message)
      return res.status(500).json({ error: 'Failed to save' })
    }
    res.json({ message: 'Saved' })
  } catch (err) {
    console.error('[club-integrations] save failed:', err.message)
    res.status(500).json({ error: 'Failed to save' })
  }
})

module.exports = router
module.exports.WEBHOOK_FIELDS = WEBHOOK_FIELDS
module.exports.FALLBACK_FIELDS = FALLBACK_FIELDS
module.exports.invalidState = invalidState
module.exports.invalidPhone = invalidPhone
