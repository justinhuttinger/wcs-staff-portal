// auth/src/routes/coaching.js
// Coaching programs and templates: one Kahunas-style tree (program -> days ->
// items in Warm up / Workout / Cool down) for both the template library and
// client programs, plus the client's workout log for staff to read.
//
// Saving is a diff (lib/coachingPrograms.js planTreeDiff), never delete and
// re-insert, so editing a program keeps every logged set attached to its row.
//
// Gate: manager+ for now. Coaching PR 3 opens this to personal trainers with
// per-client scope; every handler goes through loadProgramForStaff /
// canEditProgram, so that scope check lives in one place.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, roleLevel } = require('../middleware/role')
const {
  normaliseTree, planTreeDiff, itemLabels, volumeByMuscle, mergeVolume, copyTree, UUID_RE,
} = require('../lib/coachingPrograms')
const { canSeeProgram, canEditProgram, copyFields, treeFromRows } = require('../lib/coachingAccess')
const { applyTreePlan } = require('../lib/coachingWrite')

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

const PROGRAMS = 'memberapp_programs'
const DAYS = 'memberapp_program_days'
const ITEMS = 'memberapp_program_items'
const EXERCISE_EMBED = 'exercise:memberapp_exercises(id, name, thumbnail_url, primary_muscle, secondary_muscles, equipment, has_video)'
const LIST_COLS = 'id, kind, name, overview, tags, goal, level, days_per_week, equipment, owner_staff_id, coach_staff_id, member_id, club_number, source_template_id, starts_on, ends_on, is_active, created_at, updated_at'

const actor = (req) => req.staff?.email || req.staff?.id || 'unknown'
const caller = (req) => ({
  staffId: req.staff?.id || null,
  isManager: roleLevel(req.staff?.role) >= roleLevel('manager'),
})
const fail = (res, status, message) => res.status(status).json({ error: message })
const now = () => new Date().toISOString()

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// The one place a program is fetched for a caller. PR 3 adds client scoping
// (coach = me / my club) inside canSeeProgram.
async function loadProgramForStaff(req, id) {
  if (!UUID_RE.test(String(id))) throw new HttpError(404, 'Program not found')
  const { data, error } = await supabaseAdmin.from(PROGRAMS).select(LIST_COLS).eq('id', id).maybeSingle()
  if (error) throw new HttpError(502, error.message)
  if (!canSeeProgram(data, caller(req))) throw new HttpError(404, 'Program not found')
  return data
}

async function loadEditable(req, id) {
  const program = await loadProgramForStaff(req, id)
  if (!canEditProgram(program, caller(req))) {
    throw new HttpError(403, program.owner_staff_id == null
      ? 'Only managers can change WCS library templates. Duplicate it to make your own.'
      : 'Only the trainer who made this template (or a manager) can change it.')
  }
  return program
}

async function loadRows(programId, withExercise) {
  const { data: days, error } = await supabaseAdmin
    .from(DAYS).select('id, position, name, instructions')
    .eq('program_id', programId).order('position', { ascending: true })
  if (error) throw new HttpError(502, error.message)
  const dayIds = (days || []).map(d => d.id)
  if (!dayIds.length) return { days: [], items: [] }
  const cols = 'id, day_id, section, position, superset_group, exercise_id, sets, reps, weight, rir, rest_seconds, notes'
  const { data: items, error: itemErr } = await supabaseAdmin
    .from(ITEMS).select(withExercise ? `${cols}, ${EXERCISE_EMBED}` : cols)
    .in('day_id', dayIds).order('position', { ascending: true })
  if (itemErr) throw new HttpError(502, itemErr.message)
  return { days: days || [], items: items || [] }
}

// The builder's view: days with labelled items, exercise summaries and
// volume per day plus the whole-program total.
async function loadFull(program) {
  const { days, items } = await loadRows(program.id, true)
  const library = new Map()
  for (const it of items) if (it.exercise) library.set(it.exercise_id, it.exercise)

  const outDays = days.map(d => {
    const list = items.filter(it => it.day_id === d.id)
    const labels = itemLabels(list)
    return {
      ...d,
      items: list.map((it, i) => {
        const { day_id, ...rest } = it
        return { ...rest, label: labels[i] }
      }),
      volume: volumeByMuscle(list, library),
    }
  })
  return { program, days: outDays, volume: mergeVolume(outDays.map(d => d.volume)) }
}

const writeTree = async (programId, plan) => {
  try {
    await applyTreePlan(supabaseAdmin, programId, plan)
  } catch (err) {
    throw new HttpError(502, err.message)
  }
}

// Insert a program row and its whole tree. A failure after the row exists
// removes it again, so nobody is left with half a program.
async function createWithTree(fields, tree) {
  const { data: program, error } = await supabaseAdmin
    .from(PROGRAMS).insert(fields).select(LIST_COLS).single()
  if (error) throw new HttpError(502, error.message)
  try {
    await writeTree(program.id, planTreeDiff({ days: [] }, tree))
  } catch (err) {
    await supabaseAdmin.from(PROGRAMS).delete().eq('id', program.id)
    throw new HttpError(502, err.message)
  }
  return program
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (err) {
    fail(res, err.status || 502, err.message)
  }
}

// GET /coaching/programs?kind=template|client&member_id=&club_number=&q=
router.get('/programs', handle(async (req, res) => {
  const kind = req.query.kind === 'client' ? 'client' : 'template'
  const { staffId } = caller(req)
  let query = supabaseAdmin.from(PROGRAMS).select(LIST_COLS).eq('kind', kind)

  if (kind === 'client') {
    const { member_id: memberId, club_number: clubNumber } = req.query
    if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')
    query = query.eq('member_id', String(memberId)).eq('club_number', String(clubNumber))
      .order('created_at', { ascending: false })
  } else {
    query = staffId && UUID_RE.test(staffId)
      ? query.or(`owner_staff_id.is.null,owner_staff_id.eq.${staffId}`)
      : query.is('owner_staff_id', null)
    query = query.order('name', { ascending: true })
  }

  const { data, error } = await query.limit(500)
  if (error) return fail(res, 502, error.message)
  let programs = data || []

  // One search box across name, overview, facets and tags.
  const needle = String(req.query.q || '').trim().toLowerCase()
  if (needle) {
    programs = programs.filter(p =>
      [p.name, p.overview, p.goal, p.level, p.equipment, ...(p.tags || [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(needle)))
  }

  const ids = programs.map(p => p.id)
  const dayCount = new Map()
  const using = new Map()
  if (ids.length) {
    const [{ data: dayRows }, { data: copies }] = await Promise.all([
      supabaseAdmin.from(DAYS).select('program_id').in('program_id', ids),
      kind === 'template'
        ? supabaseAdmin.from(PROGRAMS).select('source_template_id')
            .eq('kind', 'client').eq('is_active', true).in('source_template_id', ids)
        : Promise.resolve({ data: [] }),
    ])
    for (const d of dayRows || []) dayCount.set(d.program_id, (dayCount.get(d.program_id) || 0) + 1)
    for (const c of copies || []) using.set(c.source_template_id, (using.get(c.source_template_id) || 0) + 1)
  }

  res.json({
    programs: programs.map(p => ({ ...p, day_count: dayCount.get(p.id) || 0, clients_using: using.get(p.id) || 0 })),
  })
}))

// GET /coaching/programs/:id
router.get('/programs/:id', handle(async (req, res) => {
  const program = await loadProgramForStaff(req, req.params.id)
  res.json(await loadFull(program))
}))

// POST /coaching/programs   body = tree + kind (+ member_id, club_number, coach_staff_id)
router.post('/programs', handle(async (req, res) => {
  const body = req.body || {}
  const kind = body.kind
  if (!['template', 'client'].includes(kind)) return fail(res, 400, 'kind must be template or client')
  const { tree, error } = normaliseTree(body)
  if (error) return fail(res, 400, error)
  const me = caller(req)

  const fields = { ...tree.program, kind, created_by: actor(req) }
  if (kind === 'client') {
    if (!body.member_id || !body.club_number) return fail(res, 400, 'member_id and club_number are required')
    Object.assign(fields, {
      member_id: String(body.member_id),
      club_number: String(body.club_number),
      coach_staff_id: body.coach_staff_id || null,
    })
  } else {
    if (body.publish && !me.isManager) return fail(res, 403, 'Only managers can add to the WCS library.')
    Object.assign(fields, { owner_staff_id: body.publish ? null : me.staffId, starts_on: null, ends_on: null })
  }

  const program = await createWithTree(fields, tree)
  res.status(201).json(await loadFull(program))
}))

// PUT /coaching/programs/:id   body = tree with ids -> diff save
router.put('/programs/:id', handle(async (req, res) => {
  const program = await loadEditable(req, req.params.id)
  const body = req.body || {}
  const { tree, error } = normaliseTree(body)
  if (error) return fail(res, 400, error)

  const patch = { ...tree.program, updated_at: now() }
  // Dates only change when the payload says so; the builder is not the
  // scheduling screen.
  if (!('starts_on' in body)) delete patch.starts_on
  if (!('ends_on' in body)) delete patch.ends_on
  if (program.kind === 'template') { delete patch.starts_on; delete patch.ends_on }
  const startsOn = 'starts_on' in patch ? patch.starts_on : program.starts_on
  const endsOn = 'ends_on' in patch ? patch.ends_on : program.ends_on
  if (startsOn && endsOn && endsOn < startsOn) return fail(res, 400, 'The end date is before the start date')

  const { days, items } = await loadRows(program.id, false)
  const stored = { days: days.map(d => ({ id: d.id, items: items.filter(i => i.day_id === d.id) })) }

  const { data: updated, error: upErr } = await supabaseAdmin
    .from(PROGRAMS).update(patch).eq('id', program.id).select(LIST_COLS).single()
  if (upErr) return fail(res, 502, upErr.message)

  await writeTree(program.id, planTreeDiff(stored, tree))
  res.json(await loadFull(updated))
}))

// POST /coaching/programs/:id/copy   { kind, member_id?, club_number?, coach_staff_id?, starts_on?, name? }
router.post('/programs/:id/copy', handle(async (req, res) => {
  const source = await loadProgramForStaff(req, req.params.id)
  const { fields, error } = copyFields(source, req.body, caller(req).staffId)
  if (error) return fail(res, 400, error)

  const { days, items } = await loadRows(source.id, false)
  const tree = copyTree(treeFromRows(source, days, items))
  if (fields.kind === 'template' && source.kind === 'client' && !fields.days_per_week) {
    fields.days_per_week = Math.min(7, tree.days.length) || null
  }

  const program = await createWithTree({ ...fields, created_by: actor(req) }, tree)
  res.status(201).json(await loadFull(program))
}))

// POST /coaching/programs/:id/publish — a trainer's template joins the WCS library.
router.post('/programs/:id/publish', handle(async (req, res) => {
  const program = await loadProgramForStaff(req, req.params.id)
  if (!caller(req).isManager) return fail(res, 403, 'Only managers can publish to the WCS library.')
  if (program.kind !== 'template') return fail(res, 400, 'Only templates can be published.')
  const { data, error } = await supabaseAdmin
    .from(PROGRAMS).update({ owner_staff_id: null, updated_at: now() })
    .eq('id', program.id).select(LIST_COLS).single()
  if (error) return fail(res, 502, error.message)
  res.json({ program: data })
}))

// PATCH /coaching/programs/:id   { is_active?, starts_on?, ends_on?, name? }  archive / schedule
router.patch('/programs/:id', handle(async (req, res) => {
  const program = await loadEditable(req, req.params.id)
  const body = req.body || {}
  const patch = { updated_at: now() }
  const date = (v) => {
    if (v === null || v === '') return null
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'Dates must be YYYY-MM-DD')
    return v
  }
  if ('is_active' in body) patch.is_active = Boolean(body.is_active)
  if ('starts_on' in body) patch.starts_on = date(body.starts_on)
  if ('ends_on' in body) patch.ends_on = date(body.ends_on)
  if ('name' in body) {
    const name = body.name == null ? '' : String(body.name).trim().slice(0, 120)
    if (!name) return fail(res, 400, 'Give the program a name')
    patch.name = name
  }
  if (program.kind === 'template' && ('starts_on' in patch || 'ends_on' in patch)) {
    return fail(res, 400, 'Templates are not scheduled. Assign it to a client first.')
  }
  const startsOn = 'starts_on' in patch ? patch.starts_on : program.starts_on
  const endsOn = 'ends_on' in patch ? patch.ends_on : program.ends_on
  if (startsOn && endsOn && endsOn < startsOn) return fail(res, 400, 'The end date is before the start date')

  const { data, error } = await supabaseAdmin
    .from(PROGRAMS).update(patch).eq('id', program.id).select(LIST_COLS).single()
  if (error) return fail(res, 502, error.message)
  res.json({ program: data })
}))

// DELETE /coaching/programs/:id — templates only. Client programs are archived
// so their logged workouts keep a program to belong to. Copies already made
// from a deleted template stay (source_template_id goes null).
router.delete('/programs/:id', handle(async (req, res) => {
  const program = await loadEditable(req, req.params.id)
  if (program.kind !== 'template') return fail(res, 400, 'Client programs are archived, not deleted.')
  const { error } = await supabaseAdmin.from(PROGRAMS).delete().eq('id', program.id)
  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
}))

// GET /coaching/sessions?member_id=&club_number=&limit=30 — the client's log, set by set.
router.get('/sessions', handle(async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.query
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30))

  const { data: sessions, error } = await supabaseAdmin
    .from('memberapp_workout_sessions')
    .select('id, performed_on, started_at, completed_at, duration_seconds, notes, logged_by, program_id, day_id')
    .eq('member_id', String(memberId)).eq('club_number', String(clubNumber))
    .order('performed_on', { ascending: false })
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) return fail(res, 502, error.message)

  const list = sessions || []
  const ids = list.map(s => s.id)
  const dayIds = [...new Set(list.map(s => s.day_id).filter(Boolean))]
  const [{ data: logs, error: logErr }, { data: dayRows }] = await Promise.all([
    ids.length
      ? supabaseAdmin.from('memberapp_set_logs')
          .select('session_id, exercise_id, exercise_name, set_number, reps, weight, rir, note, program_item_id, extra_position, created_at')
          .in('session_id', ids)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    dayIds.length
      ? supabaseAdmin.from(DAYS).select('id, name').in('id', dayIds)
      : Promise.resolve({ data: [] }),
  ])
  if (logErr) return fail(res, 502, logErr.message)
  const dayName = new Map((dayRows || []).map(d => [d.id, d.name]))

  res.json({
    sessions: list.map(s => ({
      ...s,
      day_name: dayName.get(s.day_id) || null,
      sets: (logs || []).filter(l => l.session_id === s.id).map(({ session_id, created_at, ...set }) => set),
    })),
  })
}))

module.exports = router
