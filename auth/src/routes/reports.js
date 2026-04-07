const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

// GET /reports/membership?start_date=2026-04-01&end_date=2026-04-07&location_id=xxx
router.get('/membership', async (req, res) => {
  const { start_date, end_date, location_id } = req.query
  const locId = location_id || req.staff.primary_location_id

  try {
    let query = supabaseAdmin
      .from('ghl_contacts')
      .select('first_name, last_name, email, member_sign_date, sale_team_member, membership_type, same_day_sale, origin')
      .not('member_sign_date', 'is', null)

    if (locId) query = query.eq('location_id', locId)
    if (start_date) query = query.gte('member_sign_date', start_date)
    if (end_date) query = query.lte('member_sign_date', end_date)

    const { data, error } = await query.order('member_sign_date', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed to fetch membership data' })

    // Group by sale_team_member
    const bySalesperson = {}
    for (const c of (data || [])) {
      const sp = c.sale_team_member || 'Unassigned'
      if (!bySalesperson[sp]) bySalesperson[sp] = []
      bySalesperson[sp].push(c)
    }

    res.json({
      total: (data || []).length,
      by_salesperson: bySalesperson,
      contacts: data || [],
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /reports/pt?start_date=...&end_date=...&location_id=xxx
router.get('/pt', async (req, res) => {
  const { start_date, end_date, location_id } = req.query
  const locId = location_id || req.staff.primary_location_id

  try {
    let query = supabaseAdmin
      .from('ghl_contacts')
      .select('first_name, last_name, email, day_one_booking_date, day_one_date, day_one_sale, day_one_trainer, day_one_booking_team_member, day_one_status, show_or_no_show, pt_sign_date, pt_sale_type, pt_value')

    if (locId) query = query.eq('location_id', locId)

    // Filter by day_one_booking_date range
    if (start_date) query = query.gte('day_one_booking_date', start_date)
    if (end_date) query = query.lte('day_one_booking_date', end_date)

    query = query.not('day_one_booking_date', 'is', null)

    const { data, error } = await query.order('day_one_booking_date', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed to fetch PT data' })

    const contacts = data || []

    // Calculate set/show/close
    const totalSet = contacts.length
    const showed = contacts.filter(c => c.show_or_no_show === 'Show' || c.day_one_status === 'Completed').length
    const closed = contacts.filter(c => c.day_one_sale === 'Sale').length

    // Group by booking team member
    const byBooker = {}
    for (const c of contacts) {
      const booker = c.day_one_booking_team_member || 'Unassigned'
      if (!byBooker[booker]) byBooker[booker] = { set: 0, show: 0, close: 0, contacts: [] }
      byBooker[booker].set++
      if (c.show_or_no_show === 'Show' || c.day_one_status === 'Completed') byBooker[booker].show++
      if (c.day_one_sale === 'Sale') byBooker[booker].close++
      byBooker[booker].contacts.push(c)
    }

    res.json({
      total_set: totalSet,
      total_showed: showed,
      total_closed: closed,
      show_rate: totalSet > 0 ? Math.round((showed / totalSet) * 100) : 0,
      close_rate: showed > 0 ? Math.round((closed / showed) * 100) : 0,
      by_booker: byBooker,
      contacts,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /reports/vip?start_date=...&end_date=...&location_id=xxx
router.get('/vip', async (req, res) => {
  const { start_date, end_date, location_id } = req.query
  const locId = location_id || req.staff.primary_location_id

  try {
    let query = supabaseAdmin
      .from('ghl_contacts')
      .select('first_name, last_name, email, vip_count, sale_team_member, member_sign_date')
      .gt('vip_count', 0)

    if (locId) query = query.eq('location_id', locId)
    if (start_date) query = query.gte('member_sign_date', start_date)
    if (end_date) query = query.lte('member_sign_date', end_date)

    const { data, error } = await query.order('vip_count', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed to fetch VIP data' })

    // Group by salesperson
    const bySalesperson = {}
    let totalVips = 0
    for (const c of (data || [])) {
      const sp = c.sale_team_member || 'Unassigned'
      if (!bySalesperson[sp]) bySalesperson[sp] = { count: 0, vips: 0, contacts: [] }
      bySalesperson[sp].count++
      bySalesperson[sp].vips += (c.vip_count || 0)
      totalVips += (c.vip_count || 0)
      bySalesperson[sp].contacts.push(c)
    }

    res.json({
      total_contacts: (data || []).length,
      total_vips: totalVips,
      by_salesperson: bySalesperson,
      contacts: data || [],
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /reports/pipelines?location_id=xxx
router.get('/pipelines', async (req, res) => {
  const locId = req.query.location_id || req.staff.primary_location_id

  try {
    let query = supabaseAdmin
      .from('ghl_opportunities')
      .select('pipeline_name, stage_name, status, contact_name, assigned_to, monetary_value, created_date')

    if (locId) query = query.eq('location_id', locId)

    const { data, error } = await query.order('created_date', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed to fetch pipeline data' })

    // Group by pipeline, then by stage
    const byPipeline = {}
    for (const opp of (data || [])) {
      const pipeName = opp.pipeline_name || 'Unknown'
      if (!byPipeline[pipeName]) byPipeline[pipeName] = { stages: {}, total: 0 }
      byPipeline[pipeName].total++

      const stageName = opp.stage_name || 'Unknown'
      if (!byPipeline[pipeName].stages[stageName]) byPipeline[pipeName].stages[stageName] = []
      byPipeline[pipeName].stages[stageName].push(opp)
    }

    res.json({
      total: (data || []).length,
      by_pipeline: byPipeline,
      opportunities: data || [],
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
