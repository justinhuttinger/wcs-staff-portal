const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

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

    // Get all log entries for this run
    const { data: logEntries, error: logErr } = await supabaseAdmin
      .from('abc_sync_run_log')
      .select('*')
      .eq('run_id', targetRunId)
      .order('run_at', { ascending: true })

    if (logErr) throw logErr

    // Compute summary
    const firstEntry = logEntries[0]
    const isDryRun = firstEntry?.dry_run ?? true
    const runAt = firstEntry?.run_at

    // Per-club breakdown
    const clubs = {}
    for (const entry of logEntries) {
      const club = entry.club_number || 'unknown'
      if (!clubs[club]) {
        clubs[club] = {
          club_number: club,
          club_name: entry.club_name || club,
          matched: 0,
          unmatched: 0,
          tag_changes: 0,
          field_updates: 0,
          errors: 0,
        }
      }
      if (entry.action === 'no_match') clubs[club].unmatched++
      else {
        clubs[club].matched++
        if (entry.action === 'add_tag' || entry.action === 'remove_tag') clubs[club].tag_changes++
        if (entry.action === 'update_field') clubs[club].field_updates++
      }
      if (entry.error) clubs[club].errors++
    }

    // Get ABC member counts per club (using view to avoid 1000 row limit)
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

    // Merge ABC counts into club breakdown
    const clubSummaries = Object.values(clubs).map(c => ({
      ...c,
      abc_total: abcCounts[c.club_number]?.total || 0,
      abc_active: abcCounts[c.club_number]?.active || 0,
      abc_inactive: abcCounts[c.club_number]?.inactive || 0,
    }))

    // Totals
    const totals = {
      matched: logEntries.filter(e => e.action !== 'no_match').length,
      unmatched: logEntries.filter(e => e.action === 'no_match').length,
      tag_changes: logEntries.filter(e => e.action === 'add_tag' || e.action === 'remove_tag').length,
      field_updates: logEntries.filter(e => e.action === 'update_field').length,
      errors: logEntries.filter(e => e.error).length,
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
      .order('run_at', { ascending: true })

    if (club_number) query = query.eq('club_number', club_number)
    if (action) query = query.eq('action', action)
    if (search) {
      query = query.or(`ghl_contact_name.ilike.%${search}%,ghl_contact_email.ilike.%${search}%`)
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

module.exports = router
