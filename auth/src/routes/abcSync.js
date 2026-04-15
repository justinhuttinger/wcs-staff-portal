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

    // Query run_log directly for this run instead of the expensive summary view
    const allLogs = []
    let logFrom = 0
    while (true) {
      const { data: logPage, error: logErr } = await supabaseAdmin
        .from('abc_sync_run_log')
        .select('club_number, club_name, dry_run, run_at, action, error')
        .eq('run_id', targetRunId)
        .range(logFrom, logFrom + 999)
      if (logErr) throw logErr
      if (!logPage || logPage.length === 0) break
      allLogs.push(...logPage)
      if (logPage.length < 1000) break
      logFrom += 1000
    }

    // Aggregate per club
    const clubMap = new Map()
    let isDryRun = true
    let runAt = null
    for (const row of allLogs) {
      isDryRun = row.dry_run
      if (!runAt || row.run_at < runAt) runAt = row.run_at
      if (!clubMap.has(row.club_number)) {
        clubMap.set(row.club_number, { club_number: row.club_number, club_name: row.club_name, matched: 0, unmatched: 0, tag_changes: 0, field_updates: 0, errors: 0 })
      }
      const club = clubMap.get(row.club_number)
      if (row.action === 'no_match') club.unmatched++
      else if (row.action === 'add_tag' || row.action === 'remove_tag') { club.matched++; club.tag_changes++ }
      else if (row.action === 'update_field') { club.matched++; club.field_updates++ }
      else if (row.action === 'create_contact') club.matched++
      if (row.error) club.errors++
    }

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
    const clubSummaries = Array.from(clubMap.values()).map(r => ({
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

// GET /abc-sync/runs — list of recent runs with aggregate stats
router.get('/runs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20

    // Try database function first (efficient aggregation)
    const { data, error } = await supabaseAdmin
      .rpc('get_abc_sync_runs', { run_limit: limit })

    if (!error && data) {
      return res.json(data)
    }

    // Fallback: get distinct run_ids then aggregate each
    console.warn('[ABC Sync] RPC failed, using fallback:', error?.message)
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const { data: runIds, error: runErr } = await supabaseAdmin
      .from('abc_sync_run_log')
      .select('run_id, run_at, dry_run')
      .gte('run_at', cutoff)
      .order('run_at', { ascending: false })
      .limit(1)

    if (runErr) throw runErr

    // Get unique run_ids from recent entries
    const seen = new Map()
    for (const r of (runIds || [])) {
      if (!seen.has(r.run_id)) seen.set(r.run_id, { run_id: r.run_id, run_at: r.run_at, dry_run: r.dry_run })
    }

    res.json(Array.from(seen.values()).slice(0, limit))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /abc-sync/changelog — filterable change log for a run
router.get('/changelog', async (req, res) => {
  try {
    const { run_id, club_number, action, errors_only, search, page = 1, limit = 50 } = req.query
    if (!run_id) return res.status(400).json({ error: 'run_id required' })

    let query = supabaseAdmin
      .from('abc_sync_run_log')
      .select('*', { count: 'exact' })
      .eq('run_id', run_id)
      .neq('action', 'no_match')
      .order('run_at', { ascending: true })

    if (club_number) query = query.eq('club_number', club_number)
    if (action) query = query.eq('action', action)
    if (errors_only === 'true') query = query.not('error', 'is', null)
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

// POST /abc-sync/stop — stop a running ABC sync
router.post('/stop', async (req, res) => {
  try {
    if (!GHL_SYNC_URL) {
      return res.status(500).json({ error: 'GHL_SYNC_URL not configured' })
    }

    const headers = { 'Content-Type': 'application/json' }
    if (SYNC_SECRET) headers['x-sync-secret'] = SYNC_SECRET

    const response = await fetch(`${GHL_SYNC_URL}/api/sync/abc/stop`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
    })

    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /abc-sync/stop-ghl — stop the GHL full/delta sync to unblock ABC sync
router.post('/stop-ghl', async (req, res) => {
  try {
    if (!GHL_SYNC_URL) {
      return res.status(500).json({ error: 'GHL_SYNC_URL not configured' })
    }

    const headers = { 'Content-Type': 'application/json' }
    if (SYNC_SECRET) headers['x-sync-secret'] = SYNC_SECRET

    const response = await fetch(`${GHL_SYNC_URL}/api/sync/stop`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
    })

    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
