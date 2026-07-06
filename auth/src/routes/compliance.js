/**
 * /reports/compliance — Operandio API-sourced job compliance.
 *
 * Backed by operandio_api_jobs / operandio_api_job_steps (populated by
 * services/operandioSync from the Operandio GraphQL API), NOT the email-parse
 * tables. Statuses: pending | in_progress | on_time | late | missed.
 */

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess, requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { resolveScopedSlugs } = require('../services/locationScope')

const router = Router()
router.use(authenticate)

const STATUSES = ['pending', 'in_progress', 'on_time', 'late', 'missed']

function parseDates(req) {
  const start = String(req.query.start_date || '')
  const end = String(req.query.end_date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    const err = new Error('start_date and end_date (YYYY-MM-DD) are required')
    err.status = 400
    throw err
  }
  return { start, end }
}

// Fetch all job rows for a range/scope, paging past the 1000-row PostgREST cap.
async function fetchJobRows(scope, start, end, extraFilters = q => q) {
  const rows = []
  const page = 1000
  for (let from = 0; ; from += page) {
    let q = supabaseAdmin
      .from('operandio_api_jobs')
      .select('*')
      .gte('job_date', start)
      .lte('job_date', end)
      .order('job_date', { ascending: true })
      .order('due_at', { ascending: true })
      .range(from, from + page - 1)
    if (!scope.all) q = q.in('location_slug', scope.slugs)
    q = extraFilters(q)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < page) break
  }
  return rows
}

// GET /summary — totals + per-location + per-day rollups for the range.
router.get('/summary', requireReportAccess('manager', ['compliance']), async (req, res) => {
  try {
    const { start, end } = parseDates(req)
    const scope = await resolveScopedSlugs(req)
    const rows = await fetchJobRows(scope, start, end)

    const zero = () => Object.fromEntries(STATUSES.map(s => [s, 0]))
    const totals = zero()
    const byLocation = {}
    const byDay = {}
    for (const r of rows) {
      totals[r.compliance_status] = (totals[r.compliance_status] || 0) + 1
      byLocation[r.location_slug] = byLocation[r.location_slug] || zero()
      byLocation[r.location_slug][r.compliance_status]++
      byDay[r.job_date] = byDay[r.job_date] || zero()
      byDay[r.job_date][r.compliance_status]++
    }

    // On-time rate over jobs whose outcome is decided (done or past due).
    const decided = totals.on_time + totals.late + totals.missed
    const { data: syncState } = await supabaseAdmin
      .from('operandio_api_sync_state')
      .select('location_slug,last_success_at,last_error')

    res.json({
      totals,
      decided,
      on_time_rate: decided ? +(totals.on_time / decided * 100).toFixed(1) : null,
      by_location: byLocation,
      by_day: byDay,
      sync_state: syncState || [],
    })
  } catch (err) {
    console.error('[compliance/summary]', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /jobs — job instances, filterable by status / process name.
router.get('/jobs', requireReportAccess('manager', ['compliance']), async (req, res) => {
  try {
    const { start, end } = parseDates(req)
    const scope = await resolveScopedSlugs(req)
    const statusFilter = String(req.query.status || '')
      .split(',').map(s => s.trim()).filter(s => STATUSES.includes(s))
    const rows = await fetchJobRows(scope, start, end, q => {
      if (statusFilter.length) q = q.in('compliance_status', statusFilter)
      if (req.query.process) q = q.ilike('process_name', `%${String(req.query.process)}%`)
      return q
    })
    res.json({ jobs: rows })
  } catch (err) {
    console.error('[compliance/jobs]', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /jobs/:id/steps — per-step detail (who/when/response/notes) for a job.
router.get('/jobs/:id/steps', requireReportAccess('manager', ['compliance']), async (req, res) => {
  try {
    const scope = await resolveScopedSlugs(req)
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('operandio_api_jobs')
      .select('id,location_slug')
      .eq('id', req.params.id)
      .maybeSingle()
    if (jobErr) throw new Error(jobErr.message)
    if (!job || (!scope.all && !scope.slugs.includes(job.location_slug))) {
      return res.status(404).json({ error: 'Job not found' })
    }
    const { data, error } = await supabaseAdmin
      .from('operandio_api_job_steps')
      .select('*')
      .eq('job_id', req.params.id)
      .order('position', { ascending: true })
    if (error) throw new Error(error.message)
    res.json({ steps: data || [] })
  } catch (err) {
    console.error('[compliance/steps]', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /people — per-person rollup: step completions + jobs completed/late.
router.get('/people', requireReportAccess('manager', ['compliance']), async (req, res) => {
  try {
    const { start, end } = parseDates(req)
    const scope = await resolveScopedSlugs(req)
    const jobs = await fetchJobRows(scope, start, end)
    const jobById = new Map(jobs.map(j => [j.id, j]))

    // Step-level completions joined to the in-range jobs (chunk the id list).
    const people = {}
    const person = name => (people[name] = people[name] || {
      name, steps_completed: 0, jobs_completed: 0, late_jobs_completed: 0, locations: new Set(),
    })
    const ids = jobs.map(j => j.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabaseAdmin
        .from('operandio_api_job_steps')
        .select('job_id,completed_by')
        .in('job_id', ids.slice(i, i + 200))
        .not('completed_by', 'is', null)
      if (error) throw new Error(error.message)
      for (const s of data || []) {
        const p = person(s.completed_by)
        p.steps_completed++
        const job = jobById.get(s.job_id)
        if (job) p.locations.add(job.location_slug)
      }
    }
    for (const j of jobs) {
      if (!j.completed_by) continue
      const p = person(j.completed_by)
      p.jobs_completed++
      if (j.compliance_status === 'late') p.late_jobs_completed++
      p.locations.add(j.location_slug)
    }
    res.json({
      people: Object.values(people)
        .map(p => ({ ...p, locations: [...p.locations].sort() }))
        .sort((a, b) => b.steps_completed - a.steps_completed),
    })
  } catch (err) {
    console.error('[compliance/people]', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /sync — manual sync trigger (admin only).
router.post('/sync', requireRole('admin'), async (req, res) => {
  try {
    const { runSync } = require('../services/operandioSync')
    const result = await runSync()
    res.json({ ok: true, result })
  } catch (err) {
    console.error('[compliance/sync]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
