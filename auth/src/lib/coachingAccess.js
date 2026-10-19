// auth/src/lib/coachingAccess.js
// Who may see and change a Coaching program, and what a copy of one becomes.
// Pure; routes/coaching.js loads the rows and passes the caller in as
// { staffId, isManager }.
//
// Client programs return true here: whether the member is the caller's client
// (trainer = coach, manager = club) is checked by routes/coaching.js
// loadProgramForStaff through services/coachingScope.js assertClientAccess.

const { UUID_RE, isoDate } = require('./coachingPrograms')

const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null)

/** Templates: the WCS library, my own, or any if I'm a manager. */
function canSeeProgram(program, { staffId, isManager } = {}) {
  if (!program) return false
  if (program.kind === 'template') {
    return program.owner_staff_id == null || program.owner_staff_id === staffId || Boolean(isManager)
  }
  return true
}

/** Only managers+ edit the WCS library; a private template by its owner or a manager. */
function canEditProgram(program, { staffId, isManager } = {}) {
  if (!program) return false
  if (program.kind === 'template') {
    if (program.owner_staff_id == null) return Boolean(isManager)
    return program.owner_staff_id === staffId || Boolean(isManager)
  }
  return true
}

const PROGRAM_FIELDS = ['name', 'overview', 'tags', 'goal', 'level', 'equipment', 'days_per_week']

/**
 * The program row for a deep copy of `source`.
 *   template -> client    assign (source_template_id = the template)
 *   client   -> template  save as template (mine, private)
 *   template -> template  duplicate (mine, private)
 *   client   -> client    duplicate a block (keeps its source template)
 */
/**
 * The coach on a client program (create or copy). Only a manager+ may name
 * one in the body; anyone else gets the client's coach, else themselves.
 */
function coachForClientProgram({ requested, clientCoach, staffId, isManager }) {
  const blank = (v) => v == null || v === ''
  if (isManager && !blank(requested)) return String(requested)
  return clientCoach || staffId || null
}

function copyFields(source, body, staffId) {
  const b = body || {}
  const kind = b.kind
  if (!['template', 'client'].includes(kind)) return { error: 'kind must be template or client' }

  const base = {}
  for (const k of PROGRAM_FIELDS) base[k] = source[k] ?? null
  if (!Array.isArray(base.tags)) base.tags = []

  const sameKindCopy = kind === source.kind && kind === 'template'
  const name = text(b.name, 120) || (sameKindCopy ? `${source.name} (copy)`.slice(0, 120) : source.name)

  if (kind === 'client') {
    const memberId = text(b.member_id, 64)
    const clubNumber = text(b.club_number, 16)
    if (!memberId || !clubNumber) return { error: 'member_id and club_number are required' }
    const blank = (v) => v == null || v === ''
    const startsOn = blank(b.starts_on) ? null : isoDate(b.starts_on)
    if (!blank(b.starts_on) && !startsOn) return { error: 'The start date must be a date (YYYY-MM-DD)' }
    const coach = blank(b.coach_staff_id) ? null : String(b.coach_staff_id)
    if (coach && !UUID_RE.test(coach)) return { error: 'coach_staff_id is not a staff id' }
    return {
      fields: {
        ...base,
        name,
        kind,
        member_id: memberId,
        club_number: clubNumber,
        coach_staff_id: coach,
        owner_staff_id: null,
        source_template_id: source.kind === 'template' ? source.id : (source.source_template_id || null),
        starts_on: startsOn,
        ends_on: null,
      },
    }
  }

  return {
    fields: {
      ...base,
      name,
      kind,
      member_id: null,
      club_number: null,
      coach_staff_id: null,
      owner_staff_id: staffId || null,
      source_template_id: null,
      starts_on: null,
      ends_on: null,
    },
  }
}

const ITEM_FIELDS = ['section', 'position', 'superset_group', 'exercise_id', 'sets', 'reps', 'weight', 'rir', 'rest_seconds', 'notes']

/** Stored rows -> the tree shape normaliseTree produces (ids kept). */
function treeFromRows(program, days, items) {
  const byDay = new Map()
  for (const it of items || []) {
    if (!byDay.has(it.day_id)) byDay.set(it.day_id, [])
    const row = { id: it.id }
    for (const k of ITEM_FIELDS) row[k] = it[k] ?? null
    byDay.get(it.day_id).push(row)
  }
  const tree = { program: {}, days: [] }
  for (const k of [...PROGRAM_FIELDS, 'starts_on', 'ends_on']) tree.program[k] = program?.[k] ?? null
  if (!Array.isArray(tree.program.tags)) tree.program.tags = []
  // Stable sorts, then positions renumbered 0..n-1: stored rows can share a
  // position, and a copy must keep the order the coach saw.
  tree.days = [...(days || [])]
    .sort((a, b) => a.position - b.position)
    .map((d, di) => ({
      id: d.id,
      position: di,
      name: d.name,
      instructions: d.instructions ?? null,
      items: (byDay.get(d.id) || [])
        .sort((a, b) => a.position - b.position)
        .map((it, ii) => ({ ...it, position: ii })),
    }))
  return tree
}

/** YYYY-MM-DD for `now` in America/Los_Angeles (the clubs' calendar). */
function pacificDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** A YYYY-MM-DD date moved by `days` calendar days. */
function shiftDate(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Assigning a program that starts today hands over from whatever the member is
 * on: every OTHER active client program that is live today (started or no
 * start, not ended) ends yesterday, so only the new one is live. One that only
 * started today cannot end before it began (the table checks ends_on >=
 * starts_on), so it is archived instead. Returns [{ id, patch }].
 */
function programsToReplace(programs, today, keepId) {
  const yesterday = shiftDate(today, -1)
  return (programs || [])
    .filter(p => p && p.id !== keepId && p.kind === 'client' && p.is_active)
    .filter(p => (!p.starts_on || p.starts_on <= today) && (!p.ends_on || p.ends_on >= today))
    .map(p => ({
      id: p.id,
      patch: p.starts_on && p.starts_on > yesterday ? { is_active: false } : { ends_on: yesterday },
    }))
}

module.exports = {
  canSeeProgram, canEditProgram, copyFields, treeFromRows, programsToReplace, pacificDate, shiftDate,
  coachForClientProgram,
}
