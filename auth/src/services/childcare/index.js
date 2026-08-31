// auth/src/services/childcare/index.js
// Childcare headcount report: reads through to the rows operandioSync already
// writes. No collector, no denormalized table — the counts land in
// operandio_api_job_steps on their own, so a second copy would only add drift.
'use strict'

const { supabaseAdmin } = require('../supabase')
const { fetchBlockByProcessId } = require('./processes')
const { buildEntries } = require('./extract')
const { buildLedger, buildDayOfWeek, buildTrend, buildTotals } = require('./aggregate')

const EMPTY = { totals: null, ledger: [], day_of_week: [], trend: [], entries: 0, warnings: [] }

// Page past PostgREST's 1000-row cap, same approach as the compliance report.
async function fetchAllJobs(processIds, start, end, slugs) {
  const pageSize = 1000
  const out = []
  for (let from = 0; ; from += pageSize) {
    let q = supabaseAdmin
      .from('operandio_api_jobs')
      .select('id, location_slug, process_id, job_date, submitted, submitted_at, submitted_by')
      .in('process_id', processIds)
      .eq('submitted', true)
      .gte('job_date', start)
      .lte('job_date', end)
      .range(from, from + pageSize - 1)
    if (slugs) q = q.in('location_slug', slugs)
    const { data, error } = await q
    if (error) throw new Error(`childcare job query failed: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return out
}

// Step rows for a set of jobs, chunked to keep the URL under limits.
async function fetchSteps(jobIds) {
  const byJob = new Map()
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('operandio_api_job_steps')
      .select('job_id, name, response, response_type')
      .in('job_id', jobIds.slice(i, i + 200))
      .eq('response_type', 'number')
    if (error) throw new Error(`childcare step query failed: ${error.message}`)
    for (const s of data || []) {
      if (!byJob.has(s.job_id)) byJob.set(s.job_id, [])
      byJob.get(s.job_id).push(s)
    }
  }
  return byJob
}

// The whole report for a date range and (optional) club scope.
async function loadReport({ start, end, slugs = null }) {
  const blockByProcessId = await fetchBlockByProcessId()
  if (blockByProcessId.size === 0) {
    return { ...EMPTY, warnings: ['No childcare checklist processes found in Operandio.'] }
  }

  const jobs = await fetchAllJobs([...blockByProcessId.keys()], start, end, slugs)
  if (jobs.length === 0) return { ...EMPTY }

  const stepsByJob = await fetchSteps(jobs.map((j) => j.id))
  const entries = buildEntries(jobs, stepsByJob, blockByProcessId)

  const warnings = []
  // A submitted checklist that yielded no numbers means the questions were
  // removed or renamed. Say so rather than quietly reporting a smaller sample:
  // a silent gap here becomes a wrong staffing average.
  const missing = jobs.length - entries.reduce((a, e) => a + e.submissions, 0)
  if (missing > 0) {
    warnings.push(`${missing} submitted checklist${missing === 1 ? '' : 's'} had no headcount answers `
      + '(questions missing, renamed, or left blank).')
  }
  // A duplicated question is a live data fault, not a historical curiosity:
  // it is still on the checklist and will keep producing two answers until
  // somebody removes the copy in Operandio.
  const conflicted = entries.filter((e) => e.conflicts > 0).length
  if (conflicted > 0) {
    warnings.push(`${conflicted} checklist${conflicted === 1 ? '' : 's'} answered a headcount question `
      + 'more than once with different numbers. The question is duplicated in Operandio; the higher '
      + 'count is shown. Delete the copy to fix this at the source.')
  }

  if (entries.length === 0) return { ...EMPTY, warnings }

  return {
    totals: buildTotals(entries),
    ledger: buildLedger(entries),
    day_of_week: buildDayOfWeek(entries),
    trend: buildTrend(entries),
    entries: entries.length,
    warnings,
  }
}

module.exports = { loadReport, EMPTY }
