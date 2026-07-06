// Operandio API compliance sync.
//
// Pulls job instances + per-step detail from the Operandio GraphQL API on a
// rolling window and mirrors them into operandio_api_jobs /
// operandio_api_job_steps. This is the reporting-grade source for the
// Compliance report — the email-parse pipeline (operandio_job_events etc.)
// is untouched and still drives till receipts.
//
// Opt-in via OPERANDIO_API_SYNC_ENABLED=true (dark by default). Requires
// OPERANDIO_API_EMAIL / OPERANDIO_API_PASSWORD.
//
// Rows are upsert-only: a job instance deleted inside Operandio keeps its
// last-seen row. If that ever inflates "missed" counts we can add a prune
// with a safety floor (same lesson as the GHL zombie-opportunity cleanup).

const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const { ALL_SLUGS } = require('../utils/locationSlug')
const { fetchLocations, fetchJobs, fetchJobStepDetail } = require('../lib/operandioApi')

const WINDOW_DAYS = parseInt(process.env.OPERANDIO_SYNC_WINDOW_DAYS || '7')

let running = false

// Pacific calendar day (YYYY-MM-DD) for a timestamp; Operandio schedules are
// org-local and all WCS clubs are America/Los_Angeles.
function pacificDay(iso) {
  if (!iso) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

// pending | in_progress | on_time | late | missed
function complianceStatus(job, now = Date.now()) {
  const due = job.dueAt ? new Date(job.dueAt).getTime() : null
  const st = job.status || {}
  if (st.completed) {
    const completedAt = st.completedAt ? new Date(st.completedAt).getTime() : null
    return due && completedAt && completedAt > due ? 'late' : 'on_time'
  }
  if (due && due < now) return 'missed'
  return (job.percentComplete || 0) > 0 ? 'in_progress' : 'pending'
}

function jobRow(job, slug, locationId, now) {
  const st = job.status || {}
  return {
    id: job.id,
    location_slug: slug,
    operandio_location_id: locationId,
    process_id: job.process?.id || null,
    process_name: job.processName || job.process?.name || null,
    display_name: job.displayName || null,
    schedule_name: job.scheduleName || null,
    adhoc: !!job.adhoc,
    has_submit: !!job.hasSubmit,
    has_scoring: !!job.hasScoring,
    percent_complete: job.percentComplete ?? null,
    available_from: job.availableFrom || null,
    due_at: job.dueAt || null,
    job_date: pacificDay(job.dueAt || job.availableFrom) || pacificDay(new Date().toISOString()),
    completed: !!st.completed,
    completed_at: st.completedAt || null,
    completed_by: st.completedBy?.fullName || null,
    submitted: !!st.submitted,
    submitted_at: st.submittedAt || null,
    submitted_by: st.submittedBy?.fullName || null,
    started_at: st.startedAt || null,
    ended_at: st.endedAt || null,
    failed: st.failed ?? null,
    score: st.score ?? null,
    possible_score: st.possibleScore ?? null,
    assigned_users: (job.users || []).map(u => u.fullName).filter(Boolean),
    assigned_groups: (job.groups || []).map(g => g.name).filter(Boolean),
    compliance_status: complianceStatus(job, now),
    synced_at: new Date(now).toISOString(),
  }
}

function stepRows(jobId, steps, now) {
  return (steps || []).map((s, i) => ({
    job_id: jobId,
    step_instance_id: s.id,
    step_id: s.step || null,
    position: i,
    name: s.name || null,
    response_type: s.responseType || null,
    response: s.response || null,
    skip: s.skip ?? null,
    completed_at: s.completedAt || null,
    completed_by: s.completedByFullName || null,
    score: s.score ?? null,
    possible_score: s.possibleScore ?? null,
    failed: s.failed ?? null,
    notes: (s.notes || []).map(n => ({
      text: n.text, author: n.author?.fullName || null, createdAt: n.createdAt,
    })),
    synced_at: new Date(now).toISOString(),
  }))
}

async function upsertChunks(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(rows.slice(i, i + 200), { onConflict })
    if (error) throw new Error(`${table} upsert failed: ${error.message}`)
  }
}

async function syncLocation(loc, slug, windowStart, windowEnd) {
  const now = Date.now()
  const jobs = await fetchJobs(loc.id, windowStart, windowEnd)

  if (jobs.length) {
    await upsertChunks('operandio_api_jobs', jobs.map(j => jobRow(j, slug, loc.id, now)), 'id')
  }

  // Step detail is fetched per process (that's the API's report granularity).
  const processIds = [...new Set(jobs.map(j => j.process?.id).filter(Boolean))]
  const knownJobIds = new Set(jobs.map(j => j.id))
  let steps = 0
  for (const processId of processIds) {
    const detail = await fetchJobStepDetail(processId, loc.id, windowStart, windowEnd)
    for (const dj of detail) {
      // reportJobDetail can return instances outside listAll's set (different
      // window semantics); only attach steps to jobs we have parent rows for.
      if (!knownJobIds.has(dj.id)) continue
      const rows = stepRows(dj.id, dj.steps, now)
      if (rows.length) {
        await upsertChunks('operandio_api_job_steps', rows, 'job_id,step_instance_id')
        steps += rows.length
      }
    }
  }
  return { jobs: jobs.length, steps }
}

async function runSync({ windowDays = WINDOW_DAYS } = {}) {
  if (running) return { skipped: 'already running' }
  running = true
  const startedAt = new Date().toISOString()
  const windowEnd = new Date()
  const windowStart = new Date(Date.now() - windowDays * 86400e3)
  const results = {}
  try {
    const locations = await fetchLocations()
    for (const loc of locations) {
      if (loc.inactive) continue
      const slug = String(loc.name || '').trim().toLowerCase()
      if (!ALL_SLUGS.includes(slug)) {
        console.warn(`[OperandioSync] unknown location "${loc.name}" — skipped`)
        continue
      }
      try {
        const r = await syncLocation(loc, slug, windowStart, windowEnd)
        results[slug] = r
        await supabaseAdmin.from('operandio_api_sync_state').upsert({
          location_slug: slug,
          operandio_location_id: loc.id,
          last_run_at: startedAt,
          last_success_at: new Date().toISOString(),
          last_error: null,
          jobs_synced: r.jobs,
          window_start: pacificDay(windowStart.toISOString()),
          window_end: pacificDay(windowEnd.toISOString()),
        }, { onConflict: 'location_slug' })
      } catch (err) {
        results[slug] = { error: err.message }
        console.error(`[OperandioSync] ${slug} failed:`, err.message)
        await supabaseAdmin.from('operandio_api_sync_state').upsert({
          location_slug: slug,
          operandio_location_id: loc.id,
          last_run_at: startedAt,
          last_error: err.message,
        }, { onConflict: 'location_slug' })
      }
    }
  } finally {
    running = false
  }
  return results
}

function start() {
  if (process.env.OPERANDIO_API_SYNC_ENABLED !== 'true') {
    console.log('[OperandioSync] disabled (set OPERANDIO_API_SYNC_ENABLED=true to enable)')
    return
  }
  const minutes = parseInt(process.env.OPERANDIO_SYNC_MINUTES || '15')
  cron.schedule(`*/${minutes} * * * *`, () => {
    runSync().then(
      r => console.log('[OperandioSync] run:', JSON.stringify(r)),
      e => console.error('[OperandioSync] run failed:', e.message),
    )
  })
  // Prime shortly after boot so a fresh deploy doesn't wait a full interval.
  setTimeout(() => {
    runSync().then(
      r => console.log('[OperandioSync] initial run:', JSON.stringify(r)),
      e => console.error('[OperandioSync] initial run failed:', e.message),
    )
  }, 20000).unref()
  console.log(`[OperandioSync] scheduled every ${minutes}m, window ${WINDOW_DAYS}d`)
}

module.exports = { runSync, start }
