// auth/src/routes/memberApp.js
// Admin for the member-facing app (wcs-member): who is a training client, the
// programs their coach writes, the coach<->member thread, and broadcast
// notifications.
//
// Gate: manager+ throughout. Setting someone's tier or messaging a member as
// their coach is not a front-desk action, and a broadcast reaches every phone.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { notifyMember } = require('../lib/memberAppPush')

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

const actor = (req) => req.user?.email || req.user?.id || 'unknown'
const trim = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null)

function restSeconds(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(3600, Math.trunc(n))
}

function fail(res, status, message) {
  return res.status(status).json({ error: message })
}

// ---------------------------------------------------------------------------
// Members: search, tier, coach
// ---------------------------------------------------------------------------

// GET /member-app/members?q=jon
// Searches active ABC members by name or email, and folds in the tier row.
router.get('/members', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.json({ members: [] })

  const like = `%${q}%`
  const { data: members, error } = await supabaseAdmin
    .from('abc_members')
    .select('member_id, club_number, first_name, last_name, email, membership_type')
    .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
    .eq('is_active', true)
    .limit(25)

  if (error) return fail(res, 502, error.message)

  const ids = (members || []).map(m => m.member_id)
  const { data: tiers } = ids.length
    ? await supabaseAdmin
        .from('memberapp_members')
        .select('member_id, club_number, tier, coach_staff_id')
        .in('member_id', ids)
    : { data: [] }

  const tierBy = new Map((tiers || []).map(t => [`${t.member_id}|${t.club_number}`, t]))

  res.json({
    members: (members || []).map(m => {
      const t = tierBy.get(`${m.member_id}|${m.club_number}`)
      return {
        ...m,
        // No row means basic; the whole membership does not need seeding.
        tier: t?.tier || 'basic',
        coach_staff_id: t?.coach_staff_id || null,
      }
    }),
  })
})

// PUT /member-app/members/:memberId/tier   { club_number, tier, coach_staff_id }
router.put('/members/:memberId/tier', async (req, res) => {
  const { club_number: clubNumber, tier, coach_staff_id: coach } = req.body || {}
  if (!clubNumber) return fail(res, 400, 'club_number is required')
  if (!['basic', 'training'].includes(tier)) return fail(res, 400, 'tier must be basic or training')

  const { error } = await supabaseAdmin.from('memberapp_members').upsert({
    member_id: req.params.memberId,
    club_number: String(clubNumber),
    tier,
    coach_staff_id: coach || null,
    updated_at: new Date().toISOString(),
    updated_by: actor(req),
  }, { onConflict: 'member_id,club_number' })

  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

// GET /member-app/coaches — staff who can be assigned as a coach
router.get('/coaches', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('staff')
    .select('id, display_name, first_name, last_name, email')
    .eq('is_active', true)
    .order('first_name', { ascending: true })
  if (error) return fail(res, 502, error.message)
  res.json({
    coaches: (data || []).map(s => ({
      id: s.id,
      name: s.display_name || `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.email,
    })),
  })
})

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

// GET /member-app/programs?member_id=&club_number=
router.get('/programs', async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.query
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { data, error } = await supabaseAdmin
    .from('memberapp_programs')
    .select('id, name, notes, is_active, starts_on, template_id, created_at, updated_at')
    .eq('member_id', memberId)
    .eq('club_number', clubNumber)
    .order('created_at', { ascending: false })

  if (error) return fail(res, 502, error.message)
  res.json({ programs: data || [] })
})

// GET /member-app/programs/:id — the whole tree, days and exercises included
router.get('/programs/:id', async (req, res) => {
  const { data: program, error } = await supabaseAdmin
    .from('memberapp_programs')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle()
  if (error) return fail(res, 502, error.message)
  if (!program) return fail(res, 404, 'Program not found')

  const { data: days } = await supabaseAdmin
    .from('memberapp_program_days')
    .select('id, position, name')
    .eq('program_id', program.id)
    .order('position', { ascending: true })

  const dayIds = (days || []).map(d => d.id)
  const { data: exercises } = dayIds.length
    ? await supabaseAdmin
        .from('memberapp_program_exercises')
        .select('id, day_id, position, name, sets, reps, weight, notes, rest_seconds')
        .in('day_id', dayIds)
        .order('position', { ascending: true })
    : { data: [] }

  res.json({
    program,
    days: (days || []).map(d => ({
      ...d,
      exercises: (exercises || []).filter(e => e.day_id === d.id),
    })),
  })
})

// POST /member-app/programs — create with its days and exercises in one call
router.post('/programs', async (req, res) => {
  const { member_id: memberId, club_number: clubNumber, name, notes, coach_staff_id: coach, days } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')
  if (!trim(name, 120)) return fail(res, 400, 'Give the program a name')

  const { data: program, error } = await supabaseAdmin
    .from('memberapp_programs')
    .insert({
      member_id: memberId,
      club_number: String(clubNumber),
      name: trim(name, 120),
      notes: trim(notes),
      coach_staff_id: coach || null,
      starts_on: req.body?.starts_on || null,
      created_by: actor(req),
    })
    .select()
    .single()

  if (error) return fail(res, 502, error.message)

  const written = await writeDays(program.id, days)
  if (written.error) return fail(res, 502, written.error)
  res.status(201).json({ program })
})

// PUT /member-app/programs/:id — rename, re-note, and replace the day tree
router.put('/programs/:id', async (req, res) => {
  const { name, notes, is_active: isActive, coach_staff_id: coach, days } = req.body || {}

  const patch = { updated_at: new Date().toISOString() }
  if (name !== undefined) patch.name = trim(name, 120)
  if (notes !== undefined) patch.notes = trim(notes)
  if (isActive !== undefined) patch.is_active = Boolean(isActive)
  if (coach !== undefined) patch.coach_staff_id = coach || null
  if (req.body?.starts_on !== undefined) patch.starts_on = req.body.starts_on || null

  const { error } = await supabaseAdmin
    .from('memberapp_programs').update(patch).eq('id', req.params.id)
  if (error) return fail(res, 502, error.message)

  if (Array.isArray(days)) {
    // Replace rather than diff: days cascade to exercises, and a coach editing
    // a program is rewriting it, not patching individual rows.
    await supabaseAdmin.from('memberapp_program_days').delete().eq('program_id', req.params.id)
    const written = await writeDays(req.params.id, days)
    if (written.error) return fail(res, 502, written.error)
  }
  res.json({ ok: true })
})

router.delete('/programs/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('memberapp_programs').delete().eq('id', req.params.id)
  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

// Days and their exercises, positioned by array order so the coach's ordering
// is what the member sees.
async function writeDays(programId, days) {
  if (!Array.isArray(days) || days.length === 0) return {}

  const dayRows = days
    .filter(d => trim(d?.name, 80))
    .map((d, i) => ({ program_id: programId, position: i, name: trim(d.name, 80) }))
  if (dayRows.length === 0) return {}

  const { data: inserted, error } = await supabaseAdmin
    .from('memberapp_program_days').insert(dayRows).select('id, position')
  if (error) return { error: error.message }

  const byPosition = new Map((inserted || []).map(d => [d.position, d.id]))
  const exerciseRows = []
  days.forEach((day, i) => {
    const dayId = byPosition.get(i)
    if (!dayId) return
    for (const [j, ex] of (day.exercises || []).entries()) {
      if (!trim(ex?.name, 120)) continue
      exerciseRows.push({
        day_id: dayId,
        position: j,
        name: trim(ex.name, 120),
        sets: trim(ex.sets, 40),
        reps: trim(ex.reps, 40),
        weight: trim(ex.weight, 40),
        notes: trim(ex.notes, 400),
        // Clamped rather than trusted: the column has a check constraint and a
        // rejected insert would lose the whole program.
        rest_seconds: restSeconds(ex.rest_seconds),
      })
    }
  })

  if (exerciseRows.length > 0) {
    const { error: exError } = await supabaseAdmin
      .from('memberapp_program_exercises').insert(exerciseRows)
    if (exError) return { error: exError.message }
  }
  return {}
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// GET /member-app/templates?q=&goal=&level=
router.get('/templates', async (req, res) => {
  const q = String(req.query.q || '').trim()

  let query = supabaseAdmin
    .from('memberapp_program_templates')
    .select('id, name, goal, level, days_per_week, equipment, description, tags')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(200)

  if (req.query.goal) query = query.eq('goal', req.query.goal)
  if (req.query.level) query = query.eq('level', req.query.level)

  const { data, error } = await query
  if (error) return fail(res, 502, error.message)

  // Filtered here rather than in PostgREST so one search box can hit the name,
  // the description, the equipment and the tags at once.
  const needle = q.toLowerCase()
  const templates = !needle ? (data || []) : (data || []).filter(t =>
    [t.name, t.goal, t.level, t.equipment, t.description, ...(t.tags || [])]
      .filter(Boolean).some(v => String(v).toLowerCase().includes(needle))
  )

  res.json({
    templates,
    // Drives the filter dropdowns without a second round trip.
    goals: [...new Set((data || []).map(t => t.goal).filter(Boolean))].sort(),
    levels: [...new Set((data || []).map(t => t.level).filter(Boolean))].sort(),
  })
})

router.get('/templates/:id', async (req, res) => {
  const { data: template, error } = await supabaseAdmin
    .from('memberapp_program_templates').select('*').eq('id', req.params.id).maybeSingle()
  if (error) return fail(res, 502, error.message)
  if (!template) return fail(res, 404, 'Template not found')

  const { data: days } = await supabaseAdmin
    .from('memberapp_template_days')
    .select('id, position, name').eq('template_id', template.id)
    .order('position', { ascending: true })

  const dayIds = (days || []).map(d => d.id)
  const { data: exercises } = dayIds.length
    ? await supabaseAdmin
        .from('memberapp_template_exercises')
        .select('id, day_id, position, name, sets, reps, weight, rest_seconds, notes')
        .in('day_id', dayIds).order('position', { ascending: true })
    : { data: [] }

  res.json({
    template,
    days: (days || []).map(d => ({ ...d, exercises: (exercises || []).filter(e => e.day_id === d.id) })),
  })
})

// POST /member-app/templates/:id/assign
// Copies the template into a real program. starts_on null means now; a future
// date leaves the current program in place until that day arrives.
router.post('/templates/:id/assign', async (req, res) => {
  const { member_id: memberId, club_number: clubNumber, starts_on: startsOn, name } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { data: template } = await supabaseAdmin
    .from('memberapp_program_templates').select('*').eq('id', req.params.id).maybeSingle()
  if (!template) return fail(res, 404, 'Template not found')

  const { data: days } = await supabaseAdmin
    .from('memberapp_template_days')
    .select('id, position, name').eq('template_id', template.id)
    .order('position', { ascending: true })

  const dayIds = (days || []).map(d => d.id)
  const { data: exercises } = dayIds.length
    ? await supabaseAdmin
        .from('memberapp_template_exercises')
        .select('day_id, position, name, sets, reps, weight, rest_seconds, notes')
        .in('day_id', dayIds).order('position', { ascending: true })
    : { data: [] }

  // The template is COPIED, not referenced: editing a template later must not
  // rewrite a program somebody is already following.
  const built = (days || []).map(d => ({
    name: d.name,
    exercises: (exercises || []).filter(e => e.day_id === d.id).map(e => ({
      name: e.name, sets: e.sets, reps: e.reps, weight: e.weight,
      rest_seconds: e.rest_seconds, notes: e.notes,
    })),
  }))

  const { data: program, error } = await supabaseAdmin
    .from('memberapp_programs')
    .insert({
      member_id: memberId,
      club_number: String(clubNumber),
      name: trim(name, 120) || template.name,
      notes: template.description,
      template_id: template.id,
      starts_on: startsOn || null,
      created_by: actor(req),
    })
    .select().single()
  if (error) return fail(res, 502, error.message)

  const written = await writeDays(program.id, built)
  if (written.error) return fail(res, 502, written.error)

  res.status(201).json({ program })
})

// POST /member-app/programs/:id/save-as-template — keep something that worked
router.post('/programs/:id/save-as-template', async (req, res) => {
  const { name, goal, level, equipment, description, tags } = req.body || {}
  if (!trim(name, 120)) return fail(res, 400, 'Give the template a name')

  const { data: days } = await supabaseAdmin
    .from('memberapp_program_days')
    .select('id, position, name').eq('program_id', req.params.id)
    .order('position', { ascending: true })
  if (!days || days.length === 0) return fail(res, 400, 'That program has no days to save')

  const { data: exercises } = await supabaseAdmin
    .from('memberapp_program_exercises')
    .select('day_id, position, name, sets, reps, weight, rest_seconds, notes')
    .in('day_id', days.map(d => d.id)).order('position', { ascending: true })

  const { data: template, error } = await supabaseAdmin
    .from('memberapp_program_templates')
    .insert({
      name: trim(name, 120), goal: trim(goal, 60), level: trim(level, 40),
      equipment: trim(equipment, 60), description: trim(description, 500),
      days_per_week: days.length,
      tags: Array.isArray(tags) ? tags.slice(0, 12).map(t => String(t).slice(0, 40)) : [],
      created_by: actor(req),
    })
    .select().single()
  if (error) return fail(res, 502, error.message)

  const dayRows = days.map((d, i) => ({ template_id: template.id, position: i, name: d.name }))
  const { data: newDays, error: dayError } = await supabaseAdmin
    .from('memberapp_template_days').insert(dayRows).select('id, position')
  if (dayError) return fail(res, 502, dayError.message)

  const byPosition = new Map(newDays.map(d => [d.position, d.id]))
  const exRows = []
  days.forEach((d, i) => {
    for (const e of (exercises || []).filter(x => x.day_id === d.id)) {
      exRows.push({
        day_id: byPosition.get(i), position: e.position, name: e.name,
        sets: e.sets, reps: e.reps, weight: e.weight,
        rest_seconds: e.rest_seconds, notes: e.notes,
      })
    }
  })
  if (exRows.length) {
    const { error: exError } = await supabaseAdmin.from('memberapp_template_exercises').insert(exRows)
    if (exError) return fail(res, 502, exError.message)
  }

  res.status(201).json({ template })
})

// ---------------------------------------------------------------------------
// Workout log (read-only for staff)
// ---------------------------------------------------------------------------

router.get('/sessions', async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.query
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { data: sessions, error } = await supabaseAdmin
    .from('memberapp_workout_sessions')
    .select('id, performed_on, notes, started_at, completed_at, program_id, day_id')
    .eq('member_id', memberId)
    .eq('club_number', clubNumber)
    .order('performed_on', { ascending: false })
    .limit(60)
  if (error) return fail(res, 502, error.message)

  const ids = (sessions || []).map(s => s.id)
  const { data: logs } = ids.length
    ? await supabaseAdmin
        .from('memberapp_set_logs')
        .select('session_id, exercise_id, set_number, reps, weight, note')
        .in('session_id', ids)
        .order('set_number', { ascending: true })
    : { data: [] }

  res.json({
    sessions: (sessions || []).map(s => ({
      ...s, sets: (logs || []).filter(l => l.session_id === s.id),
    })),
  })
})

// ---------------------------------------------------------------------------
// Running a workout with a member
//
// A trainer on the floor logs on the member's behalf, so these write the same
// rows the member app writes. Sessions are keyed to the member, never to the
// staff account, so the member sees their own history either way.
// ---------------------------------------------------------------------------

router.post('/sessions', async (req, res) => {
  const { member_id: memberId, club_number: clubNumber, program_id: programId, day_id: dayId } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { data, error } = await supabaseAdmin
    .from('memberapp_workout_sessions')
    .insert({
      member_id: memberId,
      club_number: String(clubNumber),
      program_id: programId || null,
      day_id: dayId || null,
    })
    .select().single()

  if (error) return fail(res, 502, error.message)
  res.status(201).json({ session: data })
})

// The session, not the request, decides whose log this is.
async function sessionFor(id) {
  const { data } = await supabaseAdmin
    .from('memberapp_workout_sessions')
    .select('id, member_id, club_number')
    .eq('id', id)
    .maybeSingle()
  return data
}

router.post('/sessions/:id/sets', async (req, res) => {
  const session = await sessionFor(req.params.id)
  if (!session) return fail(res, 404, 'That workout does not exist.')

  const { exercise_id: exerciseId, set_number: setNumber, reps, weight, note } = req.body || {}
  const n = Number(setNumber)
  if (!exerciseId || !Number.isFinite(n) || n < 1) return fail(res, 400, 'Which set is this?')

  const toNumber = (v) => {
    if (v === '' || v === null || v === undefined) return null
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : null
  }

  // Re-entering a set overwrites it; the table has a unique
  // (session, exercise, set_number) for exactly this.
  const { error } = await supabaseAdmin
    .from('memberapp_set_logs')
    .upsert({
      session_id: req.params.id,
      exercise_id: exerciseId,
      set_number: Math.trunc(n),
      reps: toNumber(reps),
      weight: toNumber(weight),
      note: trim(note, 200),
    }, { onConflict: 'session_id,exercise_id,set_number' })

  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

router.post('/sessions/:id/finish', async (req, res) => {
  const session = await sessionFor(req.params.id)
  if (!session) return fail(res, 404, 'That workout does not exist.')

  const { error } = await supabaseAdmin
    .from('memberapp_workout_sessions')
    .update({ completed_at: new Date().toISOString(), notes: trim(req.body?.notes, 1000) })
    .eq('id', req.params.id)

  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// GET /member-app/threads — everyone with a conversation, newest first
router.get('/threads', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('memberapp_messages')
    .select('member_id, club_number, sender, body, created_at, read_at_coach')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return fail(res, 502, error.message)

  const threads = new Map()
  for (const m of data || []) {
    const key = `${m.member_id}|${m.club_number}`
    if (!threads.has(key)) {
      threads.set(key, {
        member_id: m.member_id, club_number: m.club_number,
        last_body: m.body, last_at: m.created_at, last_sender: m.sender, unread: 0,
      })
    }
    if (m.sender === 'member' && !m.read_at_coach) threads.get(key).unread += 1
  }

  const list = [...threads.values()]
  const ids = list.map(t => t.member_id)
  const { data: names } = ids.length
    ? await supabaseAdmin.from('abc_members')
        .select('member_id, club_number, first_name, last_name').in('member_id', ids)
    : { data: [] }
  const nameBy = new Map((names || []).map(n => [`${n.member_id}|${n.club_number}`, n]))

  res.json({
    threads: list.map(t => {
      const n = nameBy.get(`${t.member_id}|${t.club_number}`)
      return { ...t, name: n ? `${n.first_name || ''} ${n.last_name || ''}`.trim() : t.member_id }
    }),
  })
})

// GET /member-app/messages?member_id=&club_number=  — marks the thread read
router.get('/messages', async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.query
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { data, error } = await supabaseAdmin
    .from('memberapp_messages')
    .select('id, sender, staff_id, body, created_at, read_at_member')
    .eq('member_id', memberId)
    .eq('club_number', clubNumber)
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) return fail(res, 502, error.message)

  await supabaseAdmin
    .from('memberapp_messages')
    .update({ read_at_coach: new Date().toISOString() })
    .eq('member_id', memberId).eq('club_number', clubNumber)
    .eq('sender', 'member').is('read_at_coach', null)

  res.json({ messages: data || [] })
})

// POST /member-app/messages — coach replies; pushes to the member's phone
router.post('/messages', async (req, res) => {
  const { member_id: memberId, club_number: clubNumber, body } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')
  const text = trim(body, 2000)
  if (!text) return fail(res, 400, 'Write a message first')

  const { data: message, error } = await supabaseAdmin
    .from('memberapp_messages')
    .insert({
      member_id: memberId, club_number: String(clubNumber),
      sender: 'coach', staff_id: req.user?.id || null, body: text,
    })
    .select().single()
  if (error) return fail(res, 502, error.message)

  // Push is best-effort: the message is already saved and will show in the app
  // whether or not the phone can be reached.
  try {
    await notifyMember({
      memberId, clubNumber: String(clubNumber),
      title: 'Message from your coach',
      body: text.slice(0, 140),
      // Lands the member in the thread rather than on the home screen.
      url: '/?to=coach',
    })
  } catch (err) {
    console.error('[member-app] coach message push failed:', err.message)
  }

  res.status(201).json({ message })
})

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

router.get('/broadcasts', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('memberapp_broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return fail(res, 502, error.message)
  res.json({ broadcasts: data || [] })
})

router.post('/broadcasts', async (req, res) => {
  const {
    title, body, url, audience = 'all',
    club_number: clubNumber, tier, member_id: memberId, scheduled_for: scheduledFor,
  } = req.body || {}

  if (!trim(title, 120)) return fail(res, 400, 'Give the notification a title')
  if (!['all', 'club', 'tier', 'member'].includes(audience)) return fail(res, 400, 'Unknown audience')
  if (audience === 'club' && !clubNumber) return fail(res, 400, 'Pick a club')
  if (audience === 'tier' && !['basic', 'training'].includes(tier)) return fail(res, 400, 'Pick a tier')
  if (audience === 'member' && !memberId) return fail(res, 400, 'Pick a member')

  // A past time would sit "scheduled" until the next cron tick anyway, so an
  // empty value means now and anything in the past is treated the same.
  const when = scheduledFor ? new Date(scheduledFor) : null
  if (when && Number.isNaN(when.getTime())) return fail(res, 400, 'That schedule time is not valid')

  const { data, error } = await supabaseAdmin
    .from('memberapp_broadcasts')
    .insert({
      title: trim(title, 120),
      body: trim(body, 500),
      url: trim(url, 500),
      audience,
      club_number: audience === 'club' ? String(clubNumber) : null,
      tier: audience === 'tier' ? tier : null,
      member_id: audience === 'member' ? memberId : null,
      scheduled_for: when ? when.toISOString() : null,
      created_by: actor(req),
    })
    .select().single()

  if (error) return fail(res, 502, error.message)
  res.status(201).json({ broadcast: data })
})

// Only something still queued can be pulled back; a sent notification is gone.
router.post('/broadcasts/:id/cancel', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('memberapp_broadcasts')
    .update({ status: 'canceled' })
    .eq('id', req.params.id)
    .eq('status', 'scheduled')
    .select('id')
  if (error) return fail(res, 502, error.message)
  if ((data || []).length === 0) return fail(res, 409, 'That notification has already gone out.')
  res.json({ ok: true })
})

module.exports = router
