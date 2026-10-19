// auth/src/lib/coachingAccess.js
// Who may see and change a Coaching program, and what a copy of one becomes.
// Pure; routes/coaching.js loads the rows and passes the caller in as
// { staffId, isManager }.
//
// Coaching PR 3 opens /coaching to personal trainers. Client scoping (trainer
// sees only clients they coach, manager their club) belongs in canSeeProgram /
// canEditProgram's client branch, which is the one place every route asks.

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
    return {
      fields: {
        ...base,
        name,
        kind,
        member_id: memberId,
        club_number: clubNumber,
        coach_staff_id: b.coach_staff_id || null,
        owner_staff_id: null,
        source_template_id: source.kind === 'template' ? source.id : (source.source_template_id || null),
        starts_on: b.starts_on || null,
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
  tree.days = [...(days || [])]
    .sort((a, b) => a.position - b.position)
    .map(d => ({
      id: d.id,
      position: d.position,
      name: d.name,
      instructions: d.instructions ?? null,
      items: (byDay.get(d.id) || []).sort((a, b) => a.position - b.position),
    }))
  return tree
}

module.exports = { canSeeProgram, canEditProgram, copyFields, treeFromRows }
