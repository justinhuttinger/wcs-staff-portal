const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const GHL_SYNC_URL = process.env.GHL_SYNC_URL // e.g. https://wcs-ghl-sync.onrender.com
const SYNC_SECRET = process.env.SYNC_SECRET

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// GET /abc-sync/summary — latest run summary + per-club breakdown
router.get('/summary', async (req, res) => {
  try {
    const runId = req.query.run_id

    // Get the latest run_id if not specified
    let targetRunId = runId
    if (!targetRunId) {
      const { data: latest } = await supabaseAdmin
        .from('abc_sync_run_log')
        .select('run_id')
        .order('run_at', { ascending: false })
        .limit(1)
        .single()
      targetRunId = latest?.run_id
    }

    if (!targetRunId) {
      return res.json({ run_id: null, message: 'No sync runs found' })
    }

    // Get per-club summary from pre-aggregated view (avoids 1000 row limit)
    const { data: runSummary, error: sumErr } = await supabaseAdmin
      .from('abc_sync_run_summary')
      .select('*')
      .eq('run_id', targetRunId)

    if (sumErr) throw sumErr

    const isDryRun = runSummary[0]?.dry_run ?? true
    const runAt = runSummary[0]?.run_at

    // Get ABC member counts per club
    let abcCounts = {}
    const { data: countRows } = await supabaseAdmin
      .from('abc_member_counts')
      .select('*')

    if (countRows) {
      for (const row of countRows) {
        abcCounts[row.club_number] = {
          total: row.total || 0,
          active: row.active || 0,
          inactive: row.inactive || 0,
        }
      }
    }

    // Build club summaries
    const clubSummaries = (runSummary || []).map(r => ({
      club_number: r.club_number,
      club_name: r.club_name,
      matched: r.matched || 0,
      unmatched: r.unmatched || 0,
      tag_changes: r.tag_changes || 0,
      field_updates: r.field_updates || 0,
      errors: r.errors || 0,
      abc_total: abcCounts[r.club_number]?.total || 0,
      abc_active: abcCounts[r.club_number]?.active || 0,
      abc_inactive: abcCounts[r.club_number]?.inactive || 0,
    }))

    // Totals
    const totals = {
      matched: clubSummaries.reduce((s, c) => s + c.matched, 0),
      unmatched: clubSummaries.reduce((s, c) => s + c.unmatched, 0),
      tag_changes: clubSummaries.reduce((s, c) => s + c.tag_changes, 0),
      field_updates: clubSummaries.reduce((s, c) => s + c.field_updates, 0),
      errors: clubSummaries.reduce((s, c) => s + c.errors, 0),
      total_abc_members: Object.values(abcCounts).reduce((s, c) => s + c.total, 0),
    }

    res.json({
      run_id: targetRunId,
      run_at: runAt,
      dry_run: isDryRun,
      totals,
      clubs: clubSummaries,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-sync/runs — list of recent run IDs
router.get('/runs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20
    const { data, error } = await supabaseAdmin
      .from('abc_sync_run_log')
      .select('run_id, run_at, dry_run')
      .order('run_at', { ascending: false })
      .limit(1000)

    if (error) throw error

    // Deduplicate by run_id, keep first (most recent entry per run)
    const seen = new Map()
    for (const row of (data || [])) {
      if (!seen.has(row.run_id)) {
        seen.set(row.run_id, { run_id: row.run_id, run_at: row.run_at, dry_run: row.dry_run })
      }
    }

    res.json(Array.from(seen.values()).slice(0, limit))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-sync/changelog — filterable change log for a run
router.get('/changelog', async (req, res) => {
  try {
    const { run_id, club_number, action, search, page = 1, limit = 50 } = req.query
    if (!run_id) return res.status(400).json({ error: 'run_id required' })

    let query = supabaseAdmin
      .from('abc_sync_run_log')
      .select('*', { count: 'exact' })
      .eq('run_id', run_id)
      .neq('action', 'no_match')
      .order('run_at', { ascending: true })

    if (club_number) query = query.eq('club_number', club_number)
    if (action) query = query.eq('action', action)
    if (search) {
      // Sanitize search to prevent PostgREST filter injection
      const safe = search.replace(/[,.()"'\\]/g, '')
      if (safe) {
        query = query.or(`ghl_contact_name.ilike.%${safe}%,ghl_contact_email.ilike.%${safe}%`)
      }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit)
    query = query.range(offset, offset + parseInt(limit) - 1)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-sync/unmatched — unmatched ABC members for a run
router.get('/unmatched', async (req, res) => {
  try {
    const { run_id, club_number, page = 1, limit = 50 } = req.query
    if (!run_id) return res.status(400).json({ error: 'run_id required' })

    let query = supabaseAdmin
      .from('abc_sync_run_log')
      .select('*', { count: 'exact' })
      .eq('run_id', run_id)
      .eq('action', 'no_match')
      .order('run_at', { ascending: true })

    if (club_number) query = query.eq('club_number', club_number)

    const offset = (parseInt(page) - 1) * parseInt(limit)
    query = query.range(offset, offset + parseInt(limit) - 1)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-sync/membership-breakdown — membership type breakdown per club
router.get('/membership-breakdown', async (req, res) => {
  try {
    const { club_number } = req.query

    let query = supabaseAdmin
      .from('abc_membership_type_counts')
      .select('*')

    if (club_number) query = query.eq('club_number', club_number)

    const { data, error } = await query
    if (error) throw error

    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /abc-sync/trigger — manually trigger an ABC sync via ghl-sync service
router.post('/trigger', async (req, res) => {
  try {
    if (!GHL_SYNC_URL) {
      return res.status(500).json({ error: 'GHL_SYNC_URL not configured' })
    }

    const headers = { 'Content-Type': 'application/json' }
    if (SYNC_SECRET) headers['x-sync-secret'] = SYNC_SECRET

    const response = await fetch(`${GHL_SYNC_URL}/api/sync/abc`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error || 'Sync trigger failed' })
    }
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
