// auth/src/services/meetingGoals/collect.js
// Turn synced MC/PT Weekly Meeting submissions into operandio_goal_entries rows.
'use strict'

const { supabaseAdmin } = require('../supabase')
const { entryFromJob } = require('./extract')
const { fetchProcessKinds } = require('./processes')

// Upsert an entry per submitted meeting job in the window. Idempotent: job_id
// is the primary key, so re-reading the same jobs every 15 minutes is a no-op,
// and a job edited after submission updates in place.
//
// Jobs are selected by process_id, never by process_name — see processes.js for
// why the stored name cannot be trusted after a rename.
//
// Returns the set of articles touched, as "KIND:slug" keys.
async function collect({ sinceDays = 30 } = {}) {
  const since = new Date(Date.now() - sinceDays * 86400000)
    .toISOString().slice(0, 10)

  const kindByProcessId = await fetchProcessKinds()
  if (kindByProcessId.size === 0) {
    console.warn('[MeetingGoals] no MC/PT Weekly Meeting processes found in Operandio')
    return { entries: 0, touched: [] }
  }

  const { data: jobs, error } = await supabaseAdmin
    .from('operandio_api_jobs')
    .select('id, location_slug, process_id, job_date, submitted, submitted_at, submitted_by')
    .in('process_id', [...kindByProcessId.keys()])
    .eq('submitted', true)
    .gte('job_date', since)
  if (error) throw new Error(`goal job query failed: ${error.message}`)
  if (!jobs || jobs.length === 0) return { entries: 0, touched: [] }

  const { data: steps, error: stepErr } = await supabaseAdmin
    .from('operandio_api_job_steps')
    .select('job_id, name, position, response')
    .in('job_id', jobs.map((j) => j.id))
  if (stepErr) throw new Error(`goal step query failed: ${stepErr.message}`)

  const byJob = new Map()
  for (const s of steps || []) {
    if (!byJob.has(s.job_id)) byJob.set(s.job_id, [])
    byJob.get(s.job_id).push(s)
  }

  const rows = []
  for (const job of jobs) {
    const entry = entryFromJob(job, byJob.get(job.id) || [], kindByProcessId.get(job.process_id))
    if (entry) rows.push(entry)
  }
  if (rows.length === 0) return { entries: 0, touched: [] }

  const { error: upErr } = await supabaseAdmin
    .from('operandio_goal_entries')
    .upsert(rows, { onConflict: 'job_id' })
  if (upErr) throw new Error(`goal entry upsert failed: ${upErr.message}`)

  const touched = [...new Set(rows.map((r) => `${r.kind}:${r.location_slug}`))]
  return { entries: rows.length, touched }
}

// Every article that has at least one entry, as { kind, location_slug }.
async function knownArticles() {
  const { data, error } = await supabaseAdmin
    .from('operandio_goal_entries')
    .select('kind, location_slug')
  if (error) throw new Error(`goal article scan failed: ${error.message}`)
  const seen = new Set()
  const out = []
  for (const r of data || []) {
    const key = `${r.kind}:${r.location_slug}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: r.kind, location_slug: r.location_slug })
  }
  return out
}

// Entries for one article, newest week first. Trimming to WEEKS_KEPT happens in
// the renderer so the trim rule lives with the format.
async function entriesFor(kind, slug) {
  const { data, error } = await supabaseAdmin
    .from('operandio_goal_entries')
    .select('week_start, submitted_by, action_plans')
    .eq('kind', kind)
    .eq('location_slug', slug)
    .order('week_start', { ascending: false })
    .limit(100)
  if (error) throw new Error(`goal entry fetch failed: ${error.message}`)
  return data || []
}

module.exports = { collect, knownArticles, entriesFor }
