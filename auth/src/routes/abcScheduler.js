/**
 * /abc-scheduler — Experimental PT + Group X scheduler (admin only).
 *
 * Phase 1 (read-only): trainer-day view of ABC calendar events.
 * Phase 2 will add class booking (POST/DELETE Event) for category=Class.
 * Phases 3-4 are blocked on ABC API discovery (PT booking endpoint, attendance API).
 *
 * Reads from the existing `abc_calendar_events` table populated by ghl-sync's
 * ABC calendar sync. Session balance is fetched live from ABC because it
 * changes per booking and is small enough to skip caching.
 */

const { Router } = require('express')
const axios = require('axios')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_APP_ID = process.env.ABC_APP_ID
const ABC_APP_KEY = process.env.ABC_APP_KEY

function abcHeaders() {
  if (!ABC_APP_ID || !ABC_APP_KEY) throw new Error('ABC_APP_ID and ABC_APP_KEY must be set')
  return { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' }
}

// ---------------------------------------------------------------------------
// GET /abc-scheduler/events
//   ?club_number=30935 (required)
//   &start=YYYY-MM-DD  (required, inclusive)
//   &end=YYYY-MM-DD    (required, inclusive)
//   &category=Appointment|Class (optional, default Appointment)
//
// Returns events from abc_calendar_events for the day(s) and category.
// ---------------------------------------------------------------------------
router.get('/events', async (req, res) => {
  const { club_number, start, end } = req.query
  const category = req.query.category || 'Appointment'
  if (!club_number || !start || !end) {
    return res.status(400).json({ error: 'club_number, start, end are required' })
  }
  // event_timestamp is stored UTC; we filter by start-of-start-day-Pacific to
  // end-of-end-day-Pacific. Pacific is UTC-7 (PDT) or UTC-8 (PST). To avoid
  // a timezone library, just pad by ±1 day and let the client trim.
  const startISO = new Date(start + 'T00:00:00.000Z').toISOString()
  const endDate = new Date(end + 'T23:59:59.999Z')
  endDate.setUTCDate(endDate.getUTCDate() + 1) // +1 day padding
  const endISO = endDate.toISOString()

  try {
    const { data, error } = await supabaseAdmin
      .from('abc_calendar_events')
      .select('event_id, event_type_id, event_name, category, event_timestamp, event_timestamp_local, status, duration_minutes, employee_id, employee_first_name, employee_last_name, member_id, member_first_name, member_last_name, attended_status, training_level')
      .eq('club_number', String(club_number))
      .eq('category', category)
      .gte('event_timestamp', startISO)
      .lte('event_timestamp', endISO)
      .order('event_timestamp', { ascending: true })
      .limit(2000)
    if (error) throw new Error(error.message)
    res.json({ events: data || [] })
  } catch (err) {
    console.error('[abcScheduler] /events failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /abc-scheduler/employees?club_number=
// Returns the distinct list of (employee_id, employee_name) seen in recent
// calendar events for the club — used to render trainer columns.
// ---------------------------------------------------------------------------
router.get('/employees', async (req, res) => {
  const { club_number } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number is required' })

  try {
    // Last 90 days of events to derive a roster of active trainers
    const since = new Date()
    since.setDate(since.getDate() - 90)
    const { data, error } = await supabaseAdmin
      .from('abc_calendar_events')
      .select('employee_id, employee_first_name, employee_last_name')
      .eq('club_number', String(club_number))
      .eq('category', 'Appointment')
      .gte('event_timestamp', since.toISOString())
      .not('employee_id', 'is', null)
      .limit(5000)
    if (error) throw new Error(error.message)

    const byId = new Map()
    for (const r of (data || [])) {
      if (!byId.has(r.employee_id)) {
        byId.set(r.employee_id, {
          employee_id: r.employee_id,
          first_name: r.employee_first_name || '',
          last_name: r.employee_last_name || '',
          display_name: [r.employee_first_name, r.employee_last_name].filter(Boolean).join(' ') || 'Unknown',
        })
      }
    }
    const employees = [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name))
    res.json({ employees })
  } catch (err) {
    console.error('[abcScheduler] /employees failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /abc-scheduler/session-balance?club_number=&member_id=[&event_type_id=]
// Proxies ABC's GET Session Balance. eventTypeId is optional — without it,
// ABC returns the full service summary for the member.
// ---------------------------------------------------------------------------
router.get('/session-balance', async (req, res) => {
  const { club_number, member_id, event_type_id } = req.query
  if (!club_number || !member_id) {
    return res.status(400).json({ error: 'club_number and member_id are required' })
  }
  try {
    const url = `${ABC_BASE_URL}/${club_number}/members/${member_id}/services/purchasehistory`
    const params = {}
    if (event_type_id) params.eventTypeId = event_type_id
    const r = await axios.get(url, { headers: abcHeaders(), params, timeout: 20000 })
    res.json(r.data)
  } catch (err) {
    const status = err.response?.status || 500
    console.error('[abcScheduler] /session-balance failed:', status, err.response?.data || err.message)
    res.status(status).json({ error: err.response?.data || err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /abc-scheduler/members/search?club_number=&q=
// Searches the cached abc_members table by name/email/barcode prefix.
// ---------------------------------------------------------------------------
router.get('/members/search', async (req, res) => {
  const { club_number, q } = req.query
  if (!club_number || !q) return res.status(400).json({ error: 'club_number and q are required' })
  const term = String(q).trim()
  if (term.length < 2) return res.json({ members: [] })

  try {
    const pattern = '%' + term + '%'
    const { data, error } = await supabaseAdmin
      .from('abc_members')
      .select('member_id, first_name, last_name, email, barcode, agreement_number, membership_type, is_active')
      .eq('club_number', String(club_number))
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},barcode.ilike.${pattern}`)
      .eq('is_active', true)
      .limit(20)
    if (error) throw new Error(error.message)
    res.json({ members: data || [] })
  } catch (err) {
    console.error('[abcScheduler] /members/search failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
