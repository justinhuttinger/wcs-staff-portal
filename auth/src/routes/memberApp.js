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
    .select('id, name, notes, is_active, created_at, updated_at')
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
        .select('id, day_id, position, name, sets, reps, weight, notes')
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
      url: '/',
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
