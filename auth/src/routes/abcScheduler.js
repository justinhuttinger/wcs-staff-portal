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
const { parseAbcTs, padDate, toIsoDate } = require('../lib/abcTime')
const {
  EVENT_STATUSES, employeeDepartments, isPersonalTrainer,
  sumSessionSummaries, isAbcSuccess, extractEventId,
} = require('../lib/ptScheduler')

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

  const startISO = new Date(start + 'T00:00:00.000Z').toISOString()
  const endDate = new Date(end + 'T23:59:59.999Z')
  endDate.setUTCDate(endDate.getUTCDate() + 1)
  const endISO = endDate.toISOString()

  // Widen the ABC date range by ±1 day to absorb timezone differences — ABC
  // interprets eventDateRange in club-local Pacific while we pass UTC dates.
  const fmtAbcDate = (s) => s // 'yyyy-MM-dd' already
  const abcStart = padDate(start, -1)
  const abcEnd = padDate(end, 1)
  const COLS = 'event_id, event_type_id, event_name, category, event_timestamp, event_timestamp_local, status, duration_minutes, employee_id, employee_first_name, employee_last_name, member_id, member_first_name, member_last_name, attended_status, training_level'

  try {
    // Cache query — completed + canceled events (ghl-sync only syncs these).
    const cachedPromise = supabaseAdmin
      .from('abc_calendar_events')
      .select(COLS)
      .eq('club_number', String(club_number))
      .eq('category', category)
      .gte('event_timestamp', startISO)
      .lte('event_timestamp', endISO)
      .order('event_timestamp', { ascending: true })
      .limit(2000)

    // Live ABC fetch for events that aren't yet in our cache (ghl-sync only
    // pulls completed + canceled-charge). We don't know the exact status
    // strings ABC uses for future bookings, so we try several known/plausible
    // values plus a no-status catch-all. Each result is returned in
    // `sources.live.<statusKey>` so the UI can show whether ABC returned
    // anything at all.
    async function fetchLiveAbc(status) {
      try {
        const params = { eventDateRange: `${fmtAbcDate(abcStart)},${fmtAbcDate(abcEnd)}`, size: 500 }
        if (status) params.eventStatus = status
        const r = await axios.get(`${ABC_BASE_URL}/${club_number}/calendars/events`, {
          headers: abcHeaders(),
          params,
          timeout: 30000,
          validateStatus: () => true,
        })
        if (r.status >= 200 && r.status < 300) {
          return { events: r.data?.events || [], http: r.status }
        }
        console.warn(`[abcScheduler] live ABC ${status || '(none)'} returned ${r.status}`)
        return { events: [], http: r.status, error: r.data?.message || r.data?.error || null }
      } catch (err) {
        console.warn(`[abcScheduler] live ABC ${status || '(none)'} threw:`, err.message)
        return { events: [], http: 0, error: err.message }
      }
    }

    const LIVE_STATUSES = ['scheduled', 'incomplete', 'pending', 'open', '']
    const liveResults = await Promise.all([
      cachedPromise,
      ...LIVE_STATUSES.map(s => fetchLiveAbc(s)),
    ])
    const cachedRes = liveResults[0]
    const liveByStatus = {}
    LIVE_STATUSES.forEach((s, i) => {
      liveByStatus[s || 'noFilter'] = liveResults[i + 1]
    })

    if (cachedRes.error) throw new Error(cachedRes.error.message)
    const cached = cachedRes.data || []

    // Transform live ABC events to the same shape as our cached rows so the
    // frontend can render uniformly. Uses inline transform (subset of
    // ghl-sync's full transformEvent — we only need display fields).
    function liveToRow(evt) {
      const ts = parseAbcTs(evt.eventTimestamp)
      const member = (evt.members && evt.members[0]) || {}
      return {
        event_id: evt.eventId,
        event_type_id: evt.eventTypeId || null,
        event_name: evt.eventName || null,
        category: evt.category || null,
        event_timestamp: ts.utc,
        event_timestamp_local: ts.local,
        status: evt.status || null,
        duration_minutes: evt.duration ? parseInt(evt.duration, 10) : null,
        employee_id: evt.employeeId || null,
        employee_first_name: evt.employeeFirstName || null,
        employee_last_name: evt.employeeLastName || null,
        member_id: member.memberId || null,
        member_first_name: member.firstName || null,
        member_last_name: member.lastName || null,
        attended_status: member.attendedStatus || null,
        training_level: evt.eventTrainingLevel?.levelName || null,
      }
    }

    // Filter the live results to the week window (we widened ±1 day to catch
    // timezone edges, so trim back to what the UI requested) and dedupe across
    // the multiple status calls before merging with cache.
    const startMs = new Date(start + 'T00:00:00Z').getTime() - 24 * 3600 * 1000 // 1 day grace
    const endMs = new Date(end + 'T23:59:59Z').getTime() + 24 * 3600 * 1000
    const liveById = new Map()
    const liveCounts = {}
    for (const [key, result] of Object.entries(liveByStatus)) {
      const filtered = (result.events || []).filter(e => (e.category || 'Appointment') === category)
      liveCounts[key] = { http: result.http, raw: (result.events || []).length, kept: filtered.length, error: result.error || null }
      for (const e of filtered) {
        const row = liveToRow(e)
        const ts = row.event_timestamp ? new Date(row.event_timestamp).getTime() : null
        if (ts !== null && (ts < startMs || ts > endMs)) continue
        if (!liveById.has(row.event_id)) liveById.set(row.event_id, row)
      }
    }
    const live = [...liveById.values()]

    // Merge — cache wins if both sources have the same event_id (cache has
    // attended_status which live future events won't have).
    const byId = new Map()
    for (const e of live) byId.set(e.event_id, e)
    for (const e of cached) byId.set(e.event_id, e)
    const events = [...byId.values()].sort((a, b) =>
      String(a.event_timestamp || '').localeCompare(String(b.event_timestamp || ''))
    )
    res.json({
      events,
      sources: {
        cached: cached.length,
        liveTotal: live.length,
        live: liveCounts,
        abcDateRange: `${abcStart},${abcEnd}`,
      },
    })
  } catch (err) {
    console.error('[abcScheduler] /events failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /abc-scheduler/employees?club_number=
// Proxies ABC's GET /employees for the club to return the full roster of
// active staff. Previously this was derived from cached events, which
// missed trainers who hadn't been booked recently (Salem was only showing
// "Matthew Aslety" because nobody else had an Appointment in 90 days).
// Falls back to events-derived list if ABC's /employees endpoint fails.
// ---------------------------------------------------------------------------
const EMPLOYEE_EXCLUDED_NAMES = new Set([
  'easalytics bot', 'click2save bot', 'reporting bot',
  'abc support', 'test test', 'personal trainer',
])

router.get('/employees', async (req, res) => {
  const { club_number } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number is required' })

  // Primary: live ABC
  try {
    const r = await axios.get(`${ABC_BASE_URL}/${club_number}/employees`, {
      headers: abcHeaders(),
      timeout: 20000,
      validateStatus: () => true,
    })
    if (r.status >= 200 && r.status < 300) {
      const raw = r.data?.employees || []
      const employees = raw
        .filter(emp => (emp.employment?.employeeStatus || '').toLowerCase() === 'active')
        .map(emp => ({
          employee_id: emp.employeeId || emp.id,
          first_name: emp.personal?.firstName || '',
          last_name: emp.personal?.lastName || '',
          display_name: `${emp.personal?.firstName || ''} ${emp.personal?.lastName || ''}`.trim() || 'Unknown',
          email: emp.personal?.email || null,
          role: emp.employment?.role || null,
        }))
        .filter(e => e.employee_id && !EMPLOYEE_EXCLUDED_NAMES.has(e.display_name.toLowerCase()))
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
      return res.json({ employees, source: 'abc' })
    }
    console.warn(`[abcScheduler] /employees ABC returned ${r.status}, falling back to events`)
  } catch (err) {
    console.warn('[abcScheduler] /employees ABC fetch failed, falling back to events:', err.message)
  }

  // Fallback: events-derived (legacy behavior)
  try {
    const since = new Date()
    since.setDate(since.getDate() - 180) // wider window than before
    const { data, error } = await supabaseAdmin
      .from('abc_calendar_events')
      .select('employee_id, employee_first_name, employee_last_name')
      .eq('club_number', String(club_number))
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
    res.json({ employees, source: 'events-fallback' })
  } catch (err) {
    console.error('[abcScheduler] /employees fallback failed:', err.message)
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

// ---------------------------------------------------------------------------
// Phase 2-4 mutations — write access via ABC endpoints confirmed by ABC rep:
//   POST   /calendars/events                                  (book)
//   PUT    /calendars/events/{eventId}/members/{memberId}/attendance
//   DELETE /calendars/events/{eventId}                        (cancel)
//   DELETE /calendars/events/{eventId}/members/{memberId}     (drop member)
//
// These are thin admin-only proxies. Bodies are passed through unchanged so
// the frontend can iterate on the exact ABC payload shape without backend
// redeploys. ABC's response is returned verbatim.
// ---------------------------------------------------------------------------

// Resolve the training level for an event type from cached events, so the
// booking form never has to ask. ABC rejects a booking with API-CAL-EVT-0060
// when the type requires a level, and the level is a property of the type
// rather than a per-booking choice — whatever this type has always used is
// the right answer.
async function resolveLevelId(clubNumber, eventTypeId) {
  if (!eventTypeId) return null
  try {
    const { data, error } = await supabaseAdmin
      .from('abc_calendar_events')
      .select('raw')
      .eq('club_number', String(clubNumber))
      .eq('event_type_id', String(eventTypeId))
      .not('raw', 'is', null)
      .order('event_timestamp', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)
    const counts = new Map()
    for (const row of (data || [])) {
      const id = row.raw?.eventTrainingLevel?.levelId || row.raw?.eventTrainingLevel?.id
      if (id) counts.set(id, (counts.get(id) || 0) + 1)
    }
    let best = null, bestN = 0
    for (const [id, n] of counts) if (n > bestN) { best = id; bestN = n }
    return best
  } catch (err) {
    console.warn('[abcScheduler] resolveLevelId failed:', err.message)
    return null
  }
}

// POST /abc-scheduler/events
//   body: ABC POST /calendars/events payload (plus a top-level club_number
//   we strip before forwarding)
// Returns ABC's response body.
//
// v2: `allowUnfunded` is always forced true (staff book sessions before the
// package is paid for, and a booking blocked on funding is never what the
// club wants), and `levelId` is resolved server-side when the caller omits it.
router.post('/events', async (req, res) => {
  const { club_number, ...payload } = req.body || {}
  if (!club_number) return res.status(400).json({ error: 'club_number is required in body' })
  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'request body required (ABC event payload)' })
  }
  payload.allowUnfunded = true
  if (!payload.levelId) {
    const levelId = await resolveLevelId(club_number, payload.eventTypeId)
    if (levelId) payload.levelId = levelId
  }
  try {
    const url = `${ABC_BASE_URL}/${club_number}/calendars/events`
    const r = await axios.post(url, payload, {
      headers: { ...abcHeaders(), 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true,
    })
    if (r.status < 200 || r.status >= 300) {
      console.error('[abcScheduler] POST /events ABC error:', r.status, r.data)
    }
    res.status(r.status).json(r.data)
  } catch (err) {
    console.error('[abcScheduler] POST /events failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /abc-scheduler/events/:eventId/attendance
//   body: { club_number, member_id, attended_status }
//   attended_status: same string GET returns ("Attended", "Did Not Attend",
//   "Pending", etc — mirrored from abc_calendar_events.attended_status).
router.put('/events/:eventId/attendance', async (req, res) => {
  const { eventId } = req.params
  const { club_number, member_id, attended_status } = req.body || {}
  if (!club_number || !member_id || !attended_status) {
    return res.status(400).json({ error: 'club_number, member_id, attended_status are required' })
  }
  try {
    // ABC rep confirmed: drop "secured" from the documented path.
    const url = `${ABC_BASE_URL}/${club_number}/calendars/events/${encodeURIComponent(eventId)}/members/${encodeURIComponent(member_id)}/attendance`
    const r = await axios.put(url, { attendedStatus: attended_status }, {
      headers: { ...abcHeaders(), 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true,
    })
    if (r.status < 200 || r.status >= 300) {
      console.error('[abcScheduler] PUT attendance ABC error:', r.status, r.data)
    }
    res.status(r.status).json(r.data)
  } catch (err) {
    console.error('[abcScheduler] PUT attendance failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /abc-scheduler/events/:eventId?club_number=
// Cancels the entire event (all members).
router.delete('/events/:eventId', async (req, res) => {
  const { eventId } = req.params
  const { club_number } = req.query
  // Guard against `/events/:eventId/members/:memberId` falling through to this
  // handler — Express routes are ordered but be explicit anyway.
  if (req.params.memberId) {
    return res.status(400).json({ error: 'use /events/:eventId/members/:memberId for member removal' })
  }
  if (!club_number) return res.status(400).json({ error: 'club_number query param required' })
  try {
    const url = `${ABC_BASE_URL}/${club_number}/calendars/events/${encodeURIComponent(eventId)}`
    const r = await axios.delete(url, {
      headers: abcHeaders(),
      timeout: 30000,
      validateStatus: () => true,
    })
    if (r.status < 200 || r.status >= 300) {
      console.error('[abcScheduler] DELETE event ABC error:', r.status, r.data)
    }
    res.status(r.status).json(r.data || { ok: true })
  } catch (err) {
    console.error('[abcScheduler] DELETE event failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /abc-scheduler/events/:eventId/members/:memberId?club_number=
// Removes one member from an event without cancelling the event.
router.delete('/events/:eventId/members/:memberId', async (req, res) => {
  const { eventId, memberId } = req.params
  const { club_number } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number query param required' })
  try {
    const url = `${ABC_BASE_URL}/${club_number}/calendars/events/${encodeURIComponent(eventId)}/members/${encodeURIComponent(memberId)}`
    const r = await axios.delete(url, {
      headers: abcHeaders(),
      timeout: 30000,
      validateStatus: () => true,
    })
    if (r.status < 200 || r.status >= 300) {
      console.error('[abcScheduler] DELETE event member ABC error:', r.status, r.data)
    }
    res.status(r.status).json(r.data || { ok: true })
  } catch (err) {
    console.error('[abcScheduler] DELETE event member failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-scheduler/event-types?club_number=
// Supports PR C's booking modal: returns distinct (event_type_id, event_name,
// category) seen at this club in the last 180 days of cached calendar events.
// Pulled from the local cache, no ABC call.
router.get('/event-types', async (req, res) => {
  const { club_number } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number is required' })
  try {
    const since = new Date()
    since.setDate(since.getDate() - 180)
    const { data, error } = await supabaseAdmin
      .from('abc_calendar_events')
      .select('event_type_id, event_name, category, duration_minutes')
      .eq('club_number', String(club_number))
      .gte('event_timestamp', since.toISOString())
      .not('event_type_id', 'is', null)
      .limit(10000)
    if (error) throw new Error(error.message)

    // Dedupe by event_type_id; keep the most common duration per type as the
    // default. (Stored as the most-recently-seen duration for simplicity.)
    const byId = new Map()
    for (const r of (data || [])) {
      if (!byId.has(r.event_type_id)) {
        byId.set(r.event_type_id, {
          event_type_id: r.event_type_id,
          event_name: r.event_name || 'Unknown',
          category: r.category || 'Appointment',
          default_duration_minutes: r.duration_minutes || null,
          observed_count: 0,
        })
      }
      byId.get(r.event_type_id).observed_count += 1
    }
    const types = [...byId.values()]
      .sort((a, b) => b.observed_count - a.observed_count) // most common first
    res.json({ event_types: types })
  } catch (err) {
    console.error('[abcScheduler] /event-types failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-scheduler/training-levels?club_number=&event_type_id=
// Returns distinct training levels seen for this event type in our cached
// events. The raw ABC payload is stored in `abc_calendar_events.raw` —
// we mine `raw.eventTrainingLevel.{levelId, levelName}` from there.
//
// Booking via POST /calendars/events requires `eventTrainingLevelId` for
// event types that have one (ABC error API-CAL-EVT-0060). Surfacing the
// historically-used levels in a dropdown lets staff pick without guessing.
router.get('/training-levels', async (req, res) => {
  const { club_number, event_type_id } = req.query
  if (!club_number || !event_type_id) {
    return res.status(400).json({ error: 'club_number and event_type_id are required' })
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('abc_calendar_events')
      .select('raw, training_level')
      .eq('club_number', String(club_number))
      .eq('event_type_id', String(event_type_id))
      .not('raw', 'is', null)
      .limit(500)
    if (error) throw new Error(error.message)

    const byId = new Map()
    for (const row of (data || [])) {
      const tl = row.raw?.eventTrainingLevel
      const levelId = tl?.levelId || tl?.id
      if (!levelId) continue
      if (!byId.has(levelId)) {
        byId.set(levelId, {
          level_id: levelId,
          level_name: tl.levelName || row.training_level || levelId,
          observed_count: 0,
        })
      }
      byId.get(levelId).observed_count += 1
    }
    const levels = [...byId.values()].sort((a, b) => b.observed_count - a.observed_count)
    res.json({ training_levels: levels })
  } catch (err) {
    console.error('[abcScheduler] /training-levels failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-scheduler/event-types/:eventTypeId/raw-sample?club_number=
// Debug helper — returns the full `raw` JSON of the most recent cached
// event with this event_type_id. Used by the booking modal so an admin
// can SEE exactly what fields ABC includes in a GET response (training
// level shape, timestamp keys, etc) and copy a real ID into the form.
router.get('/event-types/:eventTypeId/raw-sample', async (req, res) => {
  const { eventTypeId } = req.params
  const { club_number } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number is required' })
  try {
    const { data, error } = await supabaseAdmin
      .from('abc_calendar_events')
      .select('event_id, event_timestamp, status, attended_status, raw')
      .eq('club_number', String(club_number))
      .eq('event_type_id', String(eventTypeId))
      .not('raw', 'is', null)
      .order('event_timestamp', { ascending: false })
      .limit(1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return res.json({ sample: null })
    res.json({ sample: data[0] })
  } catch (err) {
    console.error('[abcScheduler] raw-sample failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-scheduler/event-types/:eventTypeId/abc-detail?club_number=
// Live ABC discovery — tries a handful of likely ABC paths to fetch the
// event-type definition (which should expose its valid training levels).
// Returns the first 2xx response along with which path matched, plus the
// list of attempts for debugging. Cached `abc_calendar_events.raw` only
// surfaces what GET responses include, which may not include the levels
// list itself.
router.get('/event-types/:eventTypeId/abc-detail', async (req, res) => {
  const { eventTypeId } = req.params
  const { club_number } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number is required' })

  const candidatePaths = [
    `/${club_number}/calendars/eventtypes/${eventTypeId}`,
    `/${club_number}/calendars/eventtypes/${eventTypeId}/details`,
    `/${club_number}/clubs/eventtypes/${eventTypeId}`,
    `/${club_number}/calendars/eventtypes`,                          // list endpoint (filter client-side)
    `/${club_number}/clubs/eventtypes`,                              // alt list endpoint
    `/${club_number}/calendars/eventtypes/${eventTypeId}/levels`,    // dedicated levels path
    `/${club_number}/calendars/eventtypes/${eventTypeId}/traininglevels`,
  ]

  const attempts = []
  for (const path of candidatePaths) {
    try {
      const r = await axios.get(ABC_BASE_URL + path, {
        headers: abcHeaders(),
        timeout: 15000,
        validateStatus: () => true,
      })
      attempts.push({ path, status: r.status })
      if (r.status >= 200 && r.status < 300) {
        return res.json({ matched_path: path, attempts, body: r.data })
      }
    } catch (err) {
      attempts.push({ path, status: 'error', error: err.message })
    }
  }
  res.status(404).json({ error: 'No ABC eventtypes path returned 2xx', attempts })
})

// ---------------------------------------------------------------------------
// POST /abc-scheduler/events/:eventId/refresh-from-abc?club_number=
// After a successful booking, ABC's cache copy on our side is stale until the
// next ghl-sync run. This endpoint hits ABC for the single newly-created
// event by its eventDateRange day, finds it, and upserts to abc_calendar_events.
// Returns the upserted row.
// ---------------------------------------------------------------------------
function transformEvent(evt, clubNumber) {
  const ts = parseAbcTs(evt.eventTimestamp)
  const member = (evt.members && evt.members[0]) || {}
  return {
    club_number: clubNumber,
    event_id: evt.eventId,
    event_type_id: evt.eventTypeId || null,
    event_name: evt.eventName || null,
    category: evt.category || null,
    event_timestamp: ts.utc,
    event_timestamp_local: ts.local,
    status: evt.status || null,
    duration_minutes: evt.duration ? parseInt(evt.duration, 10) : null,
    employee_id: evt.employeeId || null,
    employee_first_name: evt.employeeFirstName || null,
    employee_last_name: evt.employeeLastName || null,
    location_id: evt.locationId || null,
    location_name: evt.locationName || null,
    training_level: evt.eventTrainingLevel?.levelName || null,
    earnings_code: evt.earningsCode || null,
    member_id: member.memberId || null,
    member_first_name: member.firstName || null,
    member_last_name: member.lastName || null,
    attended_status: member.attendedStatus || null,
    modified_timestamp_abc: parseAbcTs(evt.modifiedTimestamp).utc,
    fetched_at: new Date().toISOString(),
    raw: evt,
  }
}

router.post('/events/:eventId/refresh-from-abc', async (req, res) => {
  const { eventId } = req.params
  const { club_number, near_date } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number is required' })
  // ABC's GET /calendars/events doesn't accept a single-event filter; we
  // scan a wider date range (±7 days) and pick out our eventId. Wider range
  // accounts for timezone differences in how ABC interprets eventDateRange
  // (probably club-local Pacific, while we work in UTC).
  const center = near_date ? new Date(near_date + 'T00:00:00Z') : new Date()
  const start = new Date(center); start.setUTCDate(start.getUTCDate() - 7)
  const end = new Date(center); end.setUTCDate(end.getUTCDate() + 7)

  // Try multiple status filters. ABC's calendarEvents.js uses 'completed' +
  // 'canceled-charge' for sync but a brand-new booking is most likely
  // "scheduled". Empty/no-status filter as last resort.
  const statuses = ['scheduled', 'completed', 'incomplete', 'canceled-charge', '']
  const attempts = []
  try {
    let found = null
    for (const status of statuses) {
      const params = { eventDateRange: `${toIsoDate(start)},${toIsoDate(end)}`, size: 500 }
      if (status) params.eventStatus = status
      const r = await axios.get(`${ABC_BASE_URL}/${club_number}/calendars/events`, {
        headers: abcHeaders(),
        params,
        timeout: 30000,
        validateStatus: () => true,
      })
      const eventCount = (r.data?.events || []).length
      attempts.push({ status: status || '(none)', http: r.status, eventCount })
      if (r.status >= 200 && r.status < 300) {
        const hit = (r.data?.events || []).find(e => e.eventId === eventId)
        if (hit) { found = hit; break }
      }
    }
    if (!found) {
      return res.status(404).json({
        error: 'Event not found in ABC date-range scan',
        eventId,
        searched: { start: toIsoDate(start), end: toIsoDate(end), attempts },
      })
    }

    const row = transformEvent(found, String(club_number))
    const { error: upErr } = await supabaseAdmin.from('abc_calendar_events').upsert(row, { onConflict: 'club_number,event_id' })
    if (upErr) throw new Error(upErr.message)
    res.json({ ok: true, event: row, attempts })
  } catch (err) {
    console.error('[abcScheduler] refresh-from-abc failed:', err.message)
    res.status(500).json({ error: err.message, attempts })
  }
})


// ---------------------------------------------------------------------------
// Event status writes (v2)
//
// ABC exposes an UNDOCUMENTED PUT .../events/{eventId}/status that sets the
// event-level status. Discovered + verified live 2026-08-24 against Salem.
//
//   PUT /rest/{club}/calendars/events/{eventId}/status
//   body: { status, employeeId, skipSelfServiceValidation }
//
// Notes from the live discovery:
//   - `employeeId` is REQUIRED (API-CAL-EVT-0029 if omitted) and must be the
//     event's own trainer. It is what ABC attributes the completion to, so
//     commission lands on the right person.
//   - `skipSelfServiceValidation` is a server-side field ABC echoes back even
//     when you never send it (defaults false). While false, event types that
//     are not bookable online are rejected with API-CAL-EVT-0011 ("The event
//     must be available online") — that check exists because these endpoints
//     were built for member self-service. We send `true` because the
//     scheduler is a staff tool acting on internally-booked appointments.
//   - Nothing mutates unless the call fully succeeds; a failed validation
//     leaves the event untouched.
//   - This sets the EVENT status only. It does NOT set per-member attendance
//     (the member stays "Did Not Attend"), which is why the attendance route
//     above still exists.
// ---------------------------------------------------------------------------
router.put('/events/:eventId/status', async (req, res) => {
  const { eventId } = req.params
  const { club_number, status, employee_id } = req.body || {}
  if (!club_number || !status || !employee_id) {
    return res.status(400).json({ error: 'club_number, status, employee_id are required' })
  }
  if (!EVENT_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'status must be one of: ' + EVENT_STATUSES.join(', ') })
  }
  try {
    const url = `${ABC_BASE_URL}/${club_number}/calendars/events/${encodeURIComponent(eventId)}/status`
    const r = await axios.put(url, {
      status,
      employeeId: employee_id,
      skipSelfServiceValidation: true,
    }, {
      headers: { ...abcHeaders(), 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true,
    })
    // ABC returns HTTP 200 for business rejections too — the messageCode is
    // the real signal (API-CAL-EVT-0000 == success). Treat anything else as a
    // failure so the UI never shows a false confirmation.
    const code = r.data?.status?.messageCode
    const ok = isAbcSuccess(r.status, r.data)
    if (!ok) {
      console.error('[abcScheduler] PUT event status rejected:', r.status, code, r.data?.status?.message)
      return res.status(400).json({
        error: r.data?.status?.message || 'ABC rejected the status change',
        messageCode: code || null,
        abc: r.data,
      })
    }
    // Keep our cache honest immediately rather than waiting for ghl-sync.
    await supabaseAdmin
      .from('abc_calendar_events')
      .update({ status })
      .eq('club_number', String(club_number))
      .eq('event_id', eventId)
    res.json({ ok: true, status, abc: r.data })
  } catch (err) {
    console.error('[abcScheduler] PUT event status failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /abc-scheduler/trainers?club_number=
// Active employees whose ABC departments include "Personal Trainers".
// employment.departments.department is a string ARRAY, so a trainer who is
// also Front Desk / Management still qualifies.
// ---------------------------------------------------------------------------
router.get('/trainers', async (req, res) => {
  const { club_number } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number is required' })
  try {
    const r = await axios.get(`${ABC_BASE_URL}/${club_number}/employees`, {
      headers: abcHeaders(), timeout: 20000, validateStatus: () => true,
    })
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status).json({ error: 'ABC /employees failed', abc: r.data })
    }
    const trainers = (r.data?.employees || [])
      .filter(emp => (emp.employment?.employeeStatus || '').toLowerCase() === 'active')
      .filter(isPersonalTrainer)
      .map(emp => ({
        employee_id: emp.employeeId || emp.id,
        first_name: emp.personal?.firstName || '',
        last_name: emp.personal?.lastName || '',
        display_name: `${emp.personal?.firstName || ''} ${emp.personal?.lastName || ''}`.trim() || 'Unknown',
        departments: employeeDepartments(emp),
      }))
      .filter(e => e.employee_id && !EMPLOYEE_EXCLUDED_NAMES.has(e.display_name.toLowerCase()))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
    res.json({ trainers })
  } catch (err) {
    console.error('[abcScheduler] /trainers failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /abc-scheduler/trainers/:employeeId/clients?club_number=[&q=]
//
// The trainer -> client assignment lives on the recurring service, in ABC's
// `serviceEmployeeId` — the same link the PT Roster report uses, mirrored by
// ghl-sync into abc_recurring_pt_services.service_employee_id.
//
// That table alone is NOT enough: its sync deliberately keeps only ACTIVE,
// NON-PIF agreements (see ghl-sync/src/abc/recurringPtServices.js), so a
// paid-in-full client — the whole PIF 60 book of business — would be invisible
// and unbookable. We therefore union it with everyone this trainer has
// actually had a calendar event with in the last 180 days. Each client is
// labelled with where it came from so the UI can tell them apart.
// ---------------------------------------------------------------------------
const CLIENT_HISTORY_DAYS = 180

router.get('/trainers/:employeeId/clients', async (req, res) => {
  const { employeeId } = req.params
  const { club_number, q } = req.query
  if (!club_number) return res.status(400).json({ error: 'club_number is required' })
  try {
    const since = new Date()
    since.setDate(since.getDate() - CLIENT_HISTORY_DAYS)

    const [rosterRes, historyRes] = await Promise.all([
      supabaseAdmin
        .from('abc_recurring_pt_services')
        .select('member_id, member_name, service_item')
        .eq('club_number', String(club_number))
        .eq('service_employee_id', String(employeeId))
        .limit(2000),
      supabaseAdmin
        .from('abc_calendar_events')
        .select('member_id, member_first_name, member_last_name, event_name')
        .eq('club_number', String(club_number))
        .eq('employee_id', String(employeeId))
        .gte('event_timestamp', since.toISOString())
        .not('member_id', 'is', null)
        .limit(5000),
    ])
    if (rosterRes.error) throw new Error(rosterRes.error.message)

    // One row per member (a client can hold several recurring services).
    const byMember = new Map()
    const put = (memberId, name, service, source) => {
      if (!memberId) return
      if (!byMember.has(memberId)) {
        byMember.set(memberId, {
          member_id: memberId,
          member_name: name || '(no name)',
          services: [],
          source,
        })
      }
      const entry = byMember.get(memberId)
      // A roster match is the stronger claim — let it win the label.
      if (source === 'roster') entry.source = 'roster'
      if (service && !entry.services.includes(service)) entry.services.push(service)
      if (name && entry.member_name === '(no name)') entry.member_name = name
    }

    for (const row of (rosterRes.data || [])) {
      put(row.member_id, row.member_name, row.service_item, 'roster')
    }
    // History is best-effort — a failure here must not hide the roster.
    if (historyRes.error) {
      console.warn('[abcScheduler] client history lookup failed:', historyRes.error.message)
    } else {
      for (const row of (historyRes.data || [])) {
        const name = [row.member_first_name, row.member_last_name].filter(Boolean).join(' ')
        put(row.member_id, name, row.event_name, 'history')
      }
    }

    let clients = [...byMember.values()].sort((a, b) => {
      if (a.source !== b.source) return a.source === 'roster' ? -1 : 1
      return a.member_name.localeCompare(b.member_name)
    })
    const term = (q || '').trim().toLowerCase()
    if (term) clients = clients.filter(c => c.member_name.toLowerCase().includes(term))
    res.json({ clients })
  } catch (err) {
    console.error('[abcScheduler] /trainers/:id/clients failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /abc-scheduler/session-total?club_number=&member_id=
// Collapses ABC's purchasehistory (one summary per billing lot) into a single
// remaining-sessions number. `available` is ABC's remaining count; `scheduled`
// is booked-but-not-yet-used and is reported separately.
// ---------------------------------------------------------------------------
router.get('/session-total', async (req, res) => {
  const { club_number, member_id } = req.query
  if (!club_number || !member_id) {
    return res.status(400).json({ error: 'club_number and member_id are required' })
  }
  try {
    const url = `${ABC_BASE_URL}/${club_number}/members/${member_id}/services/purchasehistory`
    const r = await axios.get(url, { headers: abcHeaders(), timeout: 20000, validateStatus: () => true })
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status).json({ error: 'ABC purchasehistory failed' })
    }
    res.json(sumSessionSummaries(r.data))
  } catch (err) {
    console.error('[abcScheduler] /session-total failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /abc-scheduler/events/:eventId/move
//   body: { club_number, startTime, eventTypeId, employeeId, memberId, levelId? }
//
// ABC HAS NO RESCHEDULE ENDPOINT — probed 2026-08-24: PUT/PATCH on
// /calendars/events/{id} return 405 "resource not supported", and every
// plausible /reschedule | /time | /move | /starttime path 404s. So a
// drag-to-move is really "book the new slot, then cancel the old one".
//
// Ordering is deliberate: CREATE FIRST, then delete. If the delete fails we
// leave a duplicate (visible, easy to cancel by hand). Deleting first would
// risk destroying the booking with nothing to show for it.
// ---------------------------------------------------------------------------
router.post('/events/:eventId/move', async (req, res) => {
  const { eventId } = req.params
  const { club_number, startTime, eventTypeId, employeeId, memberId, levelId } = req.body || {}
  if (!club_number || !startTime || !eventTypeId || !employeeId || !memberId) {
    return res.status(400).json({ error: 'club_number, startTime, eventTypeId, employeeId, memberId are required' })
  }
  try {
    const createBody = { eventTypeId, employeeId, memberId, startTime, allowUnfunded: true }
    const resolvedLevel = levelId || await resolveLevelId(club_number, eventTypeId)
    if (resolvedLevel) createBody.levelId = resolvedLevel
    const created = await axios.post(`${ABC_BASE_URL}/${club_number}/calendars/events`, createBody, {
      headers: { ...abcHeaders(), 'Content-Type': 'application/json' },
      timeout: 30000, validateStatus: () => true,
    })
    const createdOk = isAbcSuccess(created.status, created.data)
    if (!createdOk) {
      return res.status(400).json({
        error: created.data?.status?.message || 'ABC rejected the new booking; original event left untouched',
        messageCode: created.data?.status?.messageCode || null,
        abc: created.data,
      })
    }
    const newEventId = extractEventId(created.data)

    const del = await axios.delete(`${ABC_BASE_URL}/${club_number}/calendars/events/${encodeURIComponent(eventId)}`, {
      headers: abcHeaders(), timeout: 30000, validateStatus: () => true,
    })
    const deletedOk = del.status >= 200 && del.status < 300
    if (deletedOk) {
      await supabaseAdmin.from('abc_calendar_events')
        .delete().eq('club_number', String(club_number)).eq('event_id', eventId)
    } else {
      console.error('[abcScheduler] move: new event created but old delete failed', del.status, del.data)
    }
    res.json({
      ok: true,
      new_event_id: newEventId,
      old_event_deleted: deletedOk,
      warning: deletedOk ? null : 'New event booked, but the original could not be cancelled — cancel it manually in DataTrak.',
    })
  } catch (err) {
    console.error('[abcScheduler] move failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
