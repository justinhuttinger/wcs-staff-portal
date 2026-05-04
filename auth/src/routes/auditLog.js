const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const audit = require('../services/auditLog')

const router = Router()
router.use(authenticate)

// POST /audit-log — record an event from portal / launcher.
// Returns 202 immediately; the actual insert is fire-and-forget so the
// caller never waits on the DB.
router.post('/', (req, res) => {
  const { event_type, target, metadata, hostname } = req.body
  if (!event_type) {
    return res.status(400).json({ error: 'event_type required' })
  }
  res.status(202).json({ ok: true })
  audit.record(req.staff.id, event_type, {
    target,
    metadata,
    hostname,
    ip: req.ip,
  }).catch(() => {})
})

// GET /audit-log — admin only.
// Query params: staff_id, event_type, start_date, end_date, limit (max 1000)
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const { staff_id, event_type, start_date, end_date } = req.query
    const lim = Math.min(parseInt(req.query.limit, 10) || 200, 1000)

    let query = supabaseAdmin
      .from('audit_log')
      .select('id, staff_id, event_type, target, metadata, hostname, ip, created_at')
      .order('created_at', { ascending: false })
      .limit(lim)

    if (staff_id) query = query.eq('staff_id', staff_id)
    if (event_type) query = query.eq('event_type', event_type)
    if (start_date) query = query.gte('created_at', start_date)
    if (end_date) query = query.lte('created_at', end_date)

    const { data, error } = await query
    if (error) throw error

    // Resolve staff display names in a second roundtrip — Supabase's join
    // syntax can be finicky and we don't want a single row to fail the
    // whole query.
    const ids = [...new Set((data || []).map(r => r.staff_id).filter(Boolean))]
    let staffMap = {}
    if (ids.length > 0) {
      const { data: staff } = await supabaseAdmin
        .from('staff')
        .select('id, display_name, email, role')
        .in('id', ids)
      for (const s of (staff || [])) staffMap[s.id] = s
    }

    const events = (data || []).map(r => ({
      ...r,
      staff: r.staff_id ? staffMap[r.staff_id] || null : null,
    }))

    res.json({ events })
  } catch (err) {
    console.error('[audit-log GET] failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /audit-log/stats — admin only. Quick counts for the activity dashboard.
router.get('/stats', requireRole('admin'), async (req, res) => {
  try {
    const since = req.query.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: events } = await supabaseAdmin
      .from('audit_log')
      .select('staff_id, event_type, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000)

    const byUser = {}
    const byEventType = {}
    let totalEvents = 0
    const activeStaffIds = new Set()
    for (const e of (events || [])) {
      totalEvents++
      if (e.staff_id) activeStaffIds.add(e.staff_id)
      byUser[e.staff_id] = (byUser[e.staff_id] || 0) + 1
      byEventType[e.event_type] = (byEventType[e.event_type] || 0) + 1
    }

    res.json({
      since,
      total_events: totalEvents,
      active_staff_count: activeStaffIds.size,
      by_event_type: byEventType,
      by_staff: byUser,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
