// auth/src/lib/coachingClients.js
// Pure helpers behind the Coaching dashboard, client list and client profile:
// the week boundary, which program is live, client counts, the activity
// timeline and per-exercise progress. Dates are YYYY-MM-DD on the clubs'
// calendar (America/Los_Angeles); the routes pass `today` in.
const { shiftDate } = require('./coachingAccess')

const pairKey = (row) => `${row.member_id}|${row.club_number}`

/** Monday of the week `today` falls in. Weeks run Monday to Sunday. */
function weekStart(today) {
  const d = new Date(`${today}T12:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7 // Monday 0 ... Sunday 6
  return shiftDate(today, -back)
}

/** 'archived' | 'ended' | 'scheduled' | 'current' (same rules as the portal). */
function programPhase(p, today) {
  if (!p.is_active) return 'archived'
  if (p.ends_on && p.ends_on < today) return 'ended'
  if (p.starts_on && p.starts_on > today) return 'scheduled'
  return 'current'
}

const startKey = (p) => String(p.starts_on || p.created_at || '')

/** The program the member sees: the newest one that has started and not ended. */
function currentProgram(programs, today) {
  const live = (programs || []).filter(p => programPhase(p, today) === 'current')
  live.sort((a, b) => startKey(b).localeCompare(startKey(a)))
  return live[0] || null
}

function scheduledPrograms(programs, today) {
  return (programs || [])
    .filter(p => programPhase(p, today) === 'scheduled')
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
}

const completed = (sessions) => (sessions || []).filter(s => s && s.completed_at)

/** Clients' last completed workout date by pair key. */
function lastWorkoutBy(sessions) {
  const map = new Map()
  for (const s of completed(sessions)) {
    const k = pairKey(s)
    if (!map.has(k) || s.performed_on > map.get(k)) map.set(k, s.performed_on)
  }
  return map
}

/**
 * The client tiles: active, new in the last 7 days, trained this week (since
 * Monday), not trained in 7+ days, archived. Only active clients count toward
 * the training tiles.
 */
function clientCounts(clients, sessions, today) {
  const monday = weekStart(today)
  const sevenAgo = shiftDate(today, -6)
  const last = lastWorkoutBy(sessions)
  const active = (clients || []).filter(c => (c.status || 'active') === 'active')
  return {
    active: active.length,
    newLast7: active.filter(c => c.upgraded_at && String(c.upgraded_at).slice(0, 10) >= sevenAgo).length,
    trainedThisWeek: active.filter(c => (last.get(pairKey(c)) || '') >= monday).length,
    notTrained7: active.filter(c => (last.get(pairKey(c)) || '') < sevenAgo).length,
    archived: (clients || []).filter(c => c.status === 'archived').length,
  }
}

/** One client's row stats from their sessions and programs (any members' rows may be passed). */
function summarizeClient(client, { sessions, programs }, today) {
  const key = pairKey(client)
  const mine = completed(sessions).filter(s => pairKey(s) === key)
  const monday = weekStart(today)
  const myPrograms = (programs || []).filter(p => pairKey(p) === key)
  const cur = currentProgram(myPrograms, today)
  const next = scheduledPrograms(myPrograms, today)[0]
  return {
    last_workout_on: mine.reduce((best, s) => (s.performed_on > best ? s.performed_on : best), '') || null,
    workouts_this_week: mine.filter(s => s.performed_on >= monday).length,
    total_workouts: mine.length,
    current_program: cur ? { id: cur.id, name: cur.name } : null,
    next_program: next ? { id: next.id, name: next.name, starts_on: next.starts_on } : null,
  }
}

const clip = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * The profile's activity log, derived from rows (there is no log table):
 * program assigned (created) and updated (edited a minute or more later),
 * workouts completed, and messages. Newest first.
 */
function buildActivity({ programs = [], sessions = [], messages = [] } = {}, limit = 40) {
  const out = []
  for (const p of programs) {
    if (p.created_at) out.push({ at: p.created_at, kind: 'program_assigned', text: `Program assigned: ${p.name}`, program_id: p.id })
    if (p.updated_at && p.created_at && new Date(p.updated_at) - new Date(p.created_at) >= 60000) {
      out.push({ at: p.updated_at, kind: 'program_updated', text: `Program updated: ${p.name}`, program_id: p.id })
    }
  }
  for (const s of sessions) {
    if (!s.completed_at) continue
    const sets = s.set_count != null ? ` (${s.set_count} set${s.set_count === 1 ? '' : 's'})` : ''
    out.push({ at: s.completed_at, kind: 'workout_completed', text: `Completed ${s.day_name || 'a workout'}${sets}`, session_id: s.id })
  }
  for (const m of messages) {
    out.push({
      at: m.created_at,
      kind: 'message',
      text: `${m.sender === 'coach' ? 'Coach messaged' : 'Messaged'}: ${clip(m.body, 90)}`,
    })
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit)
}

const round1 = (n) => Math.round(n * 10) / 10

/** Estimated 1RM (Epley). One rep is the weight itself. */
function epley(weight, reps) {
  const w = Number(weight)
  const r = Number(reps)
  if (weight == null || reps == null || !Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r < 1) return null
  return r === 1 ? round1(w) : round1(w * (1 + r / 30))
}

/**
 * Per-day points for one exercise. rows: { performed_on, exercise_id, weight, reps }.
 * bestWeight / bestReps = the heaviest set (most reps on a tie); est1rm = the
 * best Epley of any set; volume = sum of weight x reps.
 */
function progressFor(rows, exerciseId) {
  const byDay = new Map()
  for (const r of rows || []) {
    if (r.exercise_id !== exerciseId) continue
    if (!byDay.has(r.performed_on)) byDay.set(r.performed_on, [])
    byDay.get(r.performed_on).push(r)
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, sets]) => {
      let best = null
      let est = null
      let volume = 0
      for (const s of sets) {
        const w = s.weight == null ? null : Number(s.weight)
        const r = s.reps == null ? null : Number(s.reps)
        if (w != null && (best == null || w > best.w || (w === best.w && (r || 0) > (best.r || 0)))) best = { w, r }
        const e = epley(w, r)
        if (e != null && (est == null || e > est)) est = e
        if (w != null && r != null) volume += w * r
      }
      return {
        performed_on: day,
        bestWeight: best ? best.w : null,
        bestReps: best ? best.r : null,
        est1rm: est,
        volume: round1(volume),
        sets: sets.length,
      }
    })
}

/** Exercises the client has logged, most trained first (for the picker). */
function loggedExercises(rows) {
  const map = new Map()
  for (const r of rows || []) {
    if (!r.exercise_id) continue
    if (!map.has(r.exercise_id)) map.set(r.exercise_id, { exercise_id: r.exercise_id, name: r.exercise_name, days: new Set() })
    map.get(r.exercise_id).days.add(r.performed_on)
  }
  return [...map.values()]
    .map(e => ({ exercise_id: e.exercise_id, name: e.name, days: e.days.size }))
    .sort((a, b) => b.days - a.days || String(a.name).localeCompare(String(b.name)))
}

/**
 * A member search term safe inside a PostgREST or() filter: commas and
 * parentheses split or group conditions, double quotes and backslashes quote
 * and escape values, and * / % are wildcards. Each becomes a space; runs of
 * spaces collapse.
 */
function searchTerm(q) {
  return String(q == null ? '' : q).replace(/[,()*%"\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Below manager, a member someone else already coaches (any status, archived
 * included) cannot be taken on; a manager has to reassign them.
 */
function coachConflict(existing, callerId, isManager) {
  if (isManager || !existing || !existing.coach_staff_id) return false
  return String(existing.coach_staff_id) !== String(callerId || '')
}

function latestAt(values) {
  const list = (values || []).filter(Boolean).map(String)
  if (!list.length) return null
  return list.reduce((a, b) => (new Date(b) > new Date(a) ? b : a))
}

module.exports = {
  pairKey, weekStart, programPhase, currentProgram, scheduledPrograms, clientCounts, summarizeClient, lastWorkoutBy,
  buildActivity, epley, progressFor, loggedExercises, latestAt, searchTerm, coachConflict,
}
