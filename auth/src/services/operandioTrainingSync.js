// Operandio training sync.
//
// Mirrors the user roster and every training assignment into
// operandio_training_staff / operandio_training_assignments so the Training
// report can answer "is this club caught up" without making 133 API calls per
// page load. Modelled on operandioSync (compliance), deliberately: same env
// gate style, same upsert-in-chunks, same sync-state row.
//
// WHY IT SWEEPS EVERY USER. usersTrainingCourses takes a single user id and
// there is no bulk equivalent, so the only way to see the whole company is one
// request per person. At 133 staff that is a couple of minutes of polite
// sequential calls, which is why it runs hourly rather than every 15 minutes:
// training due dates move in days, not minutes.
//
// Rows are upsert-only, matching the compliance sync. An assignment deleted in
// Operandio keeps its last-seen row; see pruneMissing below for the one place
// that is not good enough.
//
// Opt in with OPERANDIO_TRAINING_SYNC_ENABLED=true (dark by default). Uses the
// same OPERANDIO_API_EMAIL / OPERANDIO_API_PASSWORD as the compliance sync.

const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const { ALL_SLUGS } = require('../utils/locationSlug')
const {
  fetchUsers, fetchTrainingCourses, fetchUserTrainingCourses, assignedAtFromId,
} = require('../lib/operandioApi')
const { assignmentStatus } = require('../lib/trainingStatus')

let running = false

/** Operandio location names to portal slugs, dropping anything we do not know. */
function slugsFor(user) {
  return (user.locations || [])
    .map(l => String(l.name || '').trim().toLowerCase())
    .filter(s => ALL_SLUGS.includes(s))
}

function staffRow(user, now) {
  return {
    user_id: user.id,
    full_name: user.fullName || null,
    email: user.email || null,
    user_status: user.status || null,
    location_slugs: slugsFor(user),
    group_names: (user.groups || []).map(g => g.name).filter(Boolean),
    synced_at: now,
  }
}

function assignmentRow(a, userId, now, nowMs) {
  const st = a.status || {}
  return {
    id: a.id,
    user_id: userId,
    course_id: a.course?.id || null,
    course_name: a.course?.name || null,
    course_type: a.course?.type || null,
    course_inactive: !!a.course?.inactive,
    // Not an API field. Decoded from the id; see lib/operandioApi.
    assigned_at: assignedAtFromId(a.id),
    due_at: a.dueAt || null,
    completed_at: st.completedAt || null,
    percent_complete: st.percentComplete ?? null,
    score_percent: st.score?.percent ?? null,
    status: assignmentStatus(a, nowMs),
    synced_at: now,
  }
}

async function upsertChunks(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(rows.slice(i, i + 200), { onConflict })
    if (error) throw new Error(`${table} upsert failed: ${error.message}`)
  }
}

/**
 * Drop assignment rows this run did not see.
 *
 * Unlike a compliance job, a training assignment genuinely gets withdrawn --
 * somebody assigns the wrong course and removes it -- and an upsert-only mirror
 * would keep showing that person as overdue forever. Safe because the sweep is
 * exhaustive by construction: it asks about EVERY user, so anything missing
 * really is gone rather than outside a window.
 *
 * The guard matters. If the sweep returned nothing at all -- an auth failure
 * mid-run, an empty user list -- deleting "everything not seen" would wipe the
 * table, so a run that saw no assignments deletes nothing.
 */
async function pruneMissing(seenIds) {
  if (seenIds.length === 0) return 0
  const { data, error } = await supabaseAdmin
    .from('operandio_training_assignments')
    .select('id')
  if (error) throw new Error(`prune read failed: ${error.message}`)
  const seen = new Set(seenIds)
  const stale = (data || []).map(r => r.id).filter(id => !seen.has(id))
  if (stale.length === 0) return 0
  for (let i = 0; i < stale.length; i += 200) {
    const { error: delErr } = await supabaseAdmin
      .from('operandio_training_assignments')
      .delete()
      .in('id', stale.slice(i, i + 200))
    if (delErr) throw new Error(`prune delete failed: ${delErr.message}`)
  }
  return stale.length
}

async function runSync() {
  if (running) return { skipped: 'already running' }
  running = true
  const startedAt = new Date().toISOString()
  try {
    const now = new Date().toISOString()
    const nowMs = Date.now()

    const courses = await fetchTrainingCourses()
    if (courses.length) {
      await upsertChunks('operandio_training_courses', courses.map(c => ({
        id: c.id,
        name: c.name || null,
        description: c.description || null,
        type: c.type || null,
        inactive: !!c.inactive,
        synced_at: now,
      })), 'id')
    }

    const users = await fetchUsers()
    if (users.length) {
      await upsertChunks('operandio_training_staff', users.map(u => staffRow(u, now)), 'user_id')
    }

    // One request per user. Sequential on purpose: this is a background job and
    // a burst of 133 parallel requests is a good way to get rate-limited off an
    // API we depend on for compliance too.
    const rows = []
    for (const u of users) {
      const assignments = await fetchUserTrainingCourses(u.id)
      for (const a of assignments) rows.push(assignmentRow(a, u.id, now, nowMs))
    }
    if (rows.length) {
      await upsertChunks('operandio_training_assignments', rows, 'id')
    }
    const pruned = await pruneMissing(rows.map(r => r.id))

    await supabaseAdmin.from('operandio_training_sync_state').upsert({
      id: 'singleton',
      last_run_at: startedAt,
      last_success_at: new Date().toISOString(),
      last_error: null,
      staff_synced: users.length,
      assignments_synced: rows.length,
    }, { onConflict: 'id' })

    return { staff: users.length, assignments: rows.length, courses: courses.length, pruned }
  } catch (err) {
    await supabaseAdmin.from('operandio_training_sync_state').upsert({
      id: 'singleton',
      last_run_at: startedAt,
      last_error: err.message,
    }, { onConflict: 'id' }).catch(() => {})
    throw err
  } finally {
    running = false
  }
}

function start() {
  if (process.env.OPERANDIO_TRAINING_SYNC_ENABLED !== 'true') {
    console.log('[OperandioTraining] disabled (set OPERANDIO_TRAINING_SYNC_ENABLED=true to enable)')
    return
  }
  const minutes = parseInt(process.env.OPERANDIO_TRAINING_SYNC_MINUTES || '60')
  cron.schedule(`*/${minutes} * * * *`, () => {
    runSync().then(
      r => console.log('[OperandioTraining] run:', JSON.stringify(r)),
      e => console.error('[OperandioTraining] run failed:', e.message),
    )
  })
  // Offset from the compliance sync's 20s prime so a fresh deploy does not run
  // both full sweeps against the same API at the same moment.
  setTimeout(() => {
    runSync().then(
      r => console.log('[OperandioTraining] initial run:', JSON.stringify(r)),
      e => console.error('[OperandioTraining] initial run failed:', e.message),
    )
  }, 90000).unref()
  console.log(`[OperandioTraining] scheduled every ${minutes}m`)
}

module.exports = { runSync, start, staffRow, assignmentRow, pruneMissing }
