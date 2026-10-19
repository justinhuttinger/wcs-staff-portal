// auth/src/routes/memberApp.js
// Admin for the member-facing app (wcs-member): who is a training client,
// habits, nutrition, the calendar, the coach<->member thread, and broadcast
// notifications. Programs, templates and workout logs moved to /coaching
// (routes/coaching.js) with the Coaching rebuild.
//
// Gate: manager+ for the member list, tiers, threads and broadcasts (a
// broadcast reaches every phone). The per-member routes (habits, nutrition,
// calendar, messages) also open to a trainer with the Coaching tile for their
// own clients (services/coachingScope.js requireClientAccess), which is how
// the Coaching tile's client profile reuses them.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { notifyMember } = require('../lib/memberAppPush')
const {
  HABIT_PRESETS, MAX_HABITS, ADHERENCE_DAYS, pacificDay, shiftDay, normaliseHabit,
} = require('../lib/habits')
const {
  normaliseMeal, normaliseTarget, targetOn, totalsFor, remainingFor,
} = require('../lib/nutrition')

const { requireClientAccess } = require('../services/coachingScope')

const router = Router()
router.use(authenticate)

const managerOnly = requireRole('manager')
const pairFrom = (src) => (src && src.member_id && src.club_number
  ? { member_id: String(src.member_id), club_number: String(src.club_number) }
  : null)
const fromQuery = requireClientAccess((req) => pairFrom(req.query))
const fromBody = requireClientAccess((req) => pairFrom(req.body))
const fromRow = (table) => requireClientAccess(async (req) => {
  const { data } = await supabaseAdmin.from(table).select('member_id, club_number').eq('id', req.params.id).maybeSingle()
  return pairFrom(data)
})

// auth sets req.staff; this used to read req.user and lost every created_by.
const actor = (req) => req.staff?.email || req.staff?.id || 'unknown'
const trim = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null)

function fail(res, status, message) {
  return res.status(status).json({ error: message })
}

// ---------------------------------------------------------------------------
// Members: search, tier, coach
// ---------------------------------------------------------------------------

// GET /member-app/members?q=jon
// Searches active ABC members by name or email, and folds in the tier row.
router.get('/members', managerOnly, async (req, res) => {
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
router.put('/members/:memberId/tier', managerOnly, async (req, res) => {
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
router.get('/coaches', managerOnly, async (req, res) => {
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
// Habits
//
// Daily tiles on the member's home screen. A coach can set one up for a member
// they are working with; the member can do the same for themselves in the app,
// and can change or remove either. assigned_by records who started it, which is
// all the member is shown ("Set by your coach").
// ---------------------------------------------------------------------------

// GET /member-app/habits?member_id=&club_number=
router.get('/habits', fromQuery, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.query
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { data, error } = await supabaseAdmin
    .from('memberapp_habits')
    .select('id, kind, label, target, unit, position, assigned_by, created_at')
    .eq('member_id', memberId)
    .eq('club_number', clubNumber)
    .eq('is_active', true)
    .order('position', { ascending: true })
  if (error) return fail(res, 502, error.message)

  const habits = data || []
  const today = pacificDay()
  const since = shiftDay(today, -ADHERENCE_DAYS)

  const { data: logs } = habits.length
    ? await supabaseAdmin
        .from('memberapp_habit_logs')
        .select('habit_id, performed_on')
        .in('habit_id', habits.map(h => h.id))
        .gte('performed_on', since)
    : { data: [] }

  res.json({
    today,
    presets: HABIT_PRESETS,
    habits: habits.map(h => {
      const days = (logs || []).filter(l => l.habit_id === h.id)
      return {
        ...h,
        done_today: days.some(l => l.performed_on === today),
        // How often they actually hit it, which is the part a coach acts on.
        days_hit: days.length,
        window_days: ADHERENCE_DAYS,
      }
    }),
  })
})

router.post('/habits', fromBody, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { value, error: bad } = normaliseHabit(req.body || {})
  if (bad) return fail(res, 400, bad)

  const { data: existing } = await supabaseAdmin
    .from('memberapp_habits')
    .select('id, kind')
    .eq('member_id', memberId)
    .eq('club_number', String(clubNumber))
    .eq('is_active', true)
  const current = existing || []

  if (current.length >= MAX_HABITS) {
    return fail(res, 400, `A member can track ${MAX_HABITS} habits at once`)
  }
  if (value.kind !== 'custom' && current.some(h => h.kind === value.kind)) {
    return fail(res, 400, `${value.label} is already on their list`)
  }

  const { data, error } = await supabaseAdmin
    .from('memberapp_habits')
    .insert({
      member_id: memberId,
      club_number: String(clubNumber),
      position: current.length,
      assigned_by: actor(req),
      ...value,
    })
    .select()
    .single()
  if (error) return fail(res, 502, error.message)
  res.status(201).json({ habit: data })
})

router.put('/habits/:id', fromRow('memberapp_habits'), async (req, res) => {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('memberapp_habits')
    .select('id, kind, label, target, unit')
    .eq('id', req.params.id)
    .maybeSingle()
  if (readErr) return fail(res, 502, readErr.message)
  if (!existing) return fail(res, 404, 'Habit not found')

  const { value, error: bad } = normaliseHabit(req.body || {}, existing)
  if (bad) return fail(res, 400, bad)

  const { error } = await supabaseAdmin
    .from('memberapp_habits')
    .update({ ...value, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

// Soft delete so the logs survive: a member who kept a habit for two months
// should not lose that record because the coach swapped it out.
router.delete('/habits/:id', fromRow('memberapp_habits'), async (req, res) => {
  const { error } = await supabaseAdmin
    .from('memberapp_habits')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Nutrition
//
// Not a habit: a habit answers "did you?" once a day, this answers "how much,
// so far, against what?" all day. Off by default; a coach or the member turns
// it on. Targets are append-only so a change does not rewrite what past days
// were measured against.
// ---------------------------------------------------------------------------

const AVERAGE_WINDOWS = [7, 30]

async function loadTargets(memberId, clubNumber) {
  const { data } = await supabaseAdmin
    .from('memberapp_nutrition_targets')
    .select('id, calories, protein_g, carbs_g, fat_g, effective_from, set_by, created_at')
    .eq('member_id', memberId)
    .eq('club_number', String(clubNumber))
    .order('effective_from', { ascending: false })
    .limit(50)
  return data || []
}

// GET /member-app/nutrition?member_id=&club_number=
router.get('/nutrition', fromQuery, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.query
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const today = pacificDay()
  const since = shiftDay(today, -Math.max(...AVERAGE_WINDOWS))

  const [{ data: member }, targets, { data: meals }] = await Promise.all([
    supabaseAdmin
      .from('memberapp_members')
      .select('nutrition_enabled')
      .eq('member_id', memberId).eq('club_number', String(clubNumber))
      .maybeSingle(),
    loadTargets(memberId, clubNumber),
    supabaseAdmin
      .from('memberapp_meals')
      .select('id, performed_on, slot, name, calories, protein_g, carbs_g, fat_g, logged_at, created_by')
      .eq('member_id', memberId).eq('club_number', String(clubNumber))
      .gte('performed_on', since)
      .order('performed_on', { ascending: false })
      .order('logged_at', { ascending: true })
      .limit(500),
  ])

  const rows = meals || []
  const byDay = new Map()
  for (const meal of rows) {
    if (!byDay.has(meal.performed_on)) byDay.set(meal.performed_on, [])
    byDay.get(meal.performed_on).push(meal)
  }

  // Averages are over days they actually logged. Counting untouched days as
  // zero would show a coach 900 calories for someone who logged twice.
  const averages = {}
  for (const window of AVERAGE_WINDOWS) {
    const from = shiftDay(today, -(window - 1))
    const days = [...byDay.entries()].filter(([day]) => day >= from)
    const sums = totalsFor(days.flatMap(([, list]) => list))
    averages[window] = {
      days_logged: days.length,
      calories: days.length ? Math.round(sums.calories / days.length) : null,
      protein_g: days.length ? Math.round(sums.protein_g / days.length) : null,
      carbs_g: days.length ? Math.round(sums.carbs_g / days.length) : null,
      fat_g: days.length ? Math.round(sums.fat_g / days.length) : null,
    }
  }

  const todayMeals = byDay.get(today) || []
  const target = targetOn(targets, today)
  const totals = totalsFor(todayMeals)

  res.json({
    enabled: Boolean(member?.nutrition_enabled),
    today,
    target,
    targets,
    totals,
    remaining: remainingFor(totals, target),
    meals: todayMeals,
    days: [...byDay.entries()].map(([day, list]) => ({
      day,
      totals: totalsFor(list),
      target: targetOn(targets, day),
      meals: list.length,
    })),
    averages,
  })
})

// PUT /member-app/nutrition/enabled
router.put('/nutrition/enabled', fromBody, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber, enabled } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { error } = await supabaseAdmin
    .from('memberapp_members')
    .upsert({
      member_id: memberId,
      club_number: String(clubNumber),
      nutrition_enabled: Boolean(enabled),
      updated_at: new Date().toISOString(),
      updated_by: actor(req),
    }, { onConflict: 'member_id,club_number' })
  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

// POST /member-app/nutrition/targets - a new row, never an edit of the old one
router.post('/nutrition/targets', fromBody, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { value, error: bad } = normaliseTarget(req.body || {})
  if (bad) return fail(res, 400, bad)

  const { data, error } = await supabaseAdmin
    .from('memberapp_nutrition_targets')
    .insert({
      member_id: memberId,
      club_number: String(clubNumber),
      effective_from: req.body?.effective_from || pacificDay(),
      set_by: actor(req),
      ...value,
    })
    .select()
    .single()
  if (error) return fail(res, 502, error.message)
  res.status(201).json({ target: data })
})

// GET /member-app/nutrition/day?member_id=&club_number=&date=
router.get('/nutrition/day', fromQuery, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber, date } = req.query
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')
  const day = date || pacificDay()

  const [targets, { data: meals, error }] = await Promise.all([
    loadTargets(memberId, clubNumber),
    supabaseAdmin
      .from('memberapp_meals')
      .select('id, performed_on, slot, name, calories, protein_g, carbs_g, fat_g, logged_at, created_by')
      .eq('member_id', memberId).eq('club_number', String(clubNumber))
      .eq('performed_on', day)
      .order('logged_at', { ascending: true }),
  ])
  if (error) return fail(res, 502, error.message)

  const target = targetOn(targets, day)
  const totals = totalsFor(meals || [])
  res.json({ day, target, totals, remaining: remainingFor(totals, target), meals: meals || [] })
})

// Staff-logged meals are marked as such: a member should be able to tell which
// numbers are theirs.
router.post('/nutrition/meals', fromBody, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const { value, error: bad } = normaliseMeal(req.body || {})
  if (bad) return fail(res, 400, bad)

  const { data, error } = await supabaseAdmin
    .from('memberapp_meals')
    .insert({
      member_id: memberId,
      club_number: String(clubNumber),
      performed_on: req.body?.performed_on || pacificDay(),
      created_by: actor(req),
      ...value,
    })
    .select()
    .single()
  if (error) return fail(res, 502, error.message)
  res.status(201).json({ meal: data })
})

router.put('/nutrition/meals/:id', fromRow('memberapp_meals'), async (req, res) => {
  const { value, error: bad } = normaliseMeal(req.body || {})
  if (bad) return fail(res, 400, bad)

  const { error } = await supabaseAdmin
    .from('memberapp_meals')
    .update({ ...value, updated_at: new Date().toISOString(), updated_by: actor(req) })
    .eq('id', req.params.id)
  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

router.delete('/nutrition/meals/:id', fromRow('memberapp_meals'), async (req, res) => {
  const { error } = await supabaseAdmin
    .from('memberapp_meals').delete().eq('id', req.params.id)
  if (error) return fail(res, 502, error.message)
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Member calendar
//
// One call behind both the desktop grid and the staff app, so a coach opening a
// member sees workouts, habits and food together rather than three screens.
//
// Habits are additive only: a day carries what was kept and nothing otherwise.
// The member app never counts them against a total and neither does this, so a
// coach is not handed a "2 of 5" to open a conversation with. Food is the
// opposite - once tracking is on, every logged day gets a verdict.
// ---------------------------------------------------------------------------

const CALENDAR_MAX_DAYS = 120

// GET /member-app/calendar?member_id=&club_number=&from=&to=
router.get('/calendar', fromQuery, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber } = req.query
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')

  const today = pacificDay()
  const to = req.query.to || today
  const asked = req.query.from || shiftDay(to, -27)
  const floor = shiftDay(to, -CALENDAR_MAX_DAYS)
  const from = asked < floor ? floor : asked

  const club = String(clubNumber)
  const scope = (q) => q.eq('member_id', memberId).eq('club_number', club)

  const [{ data: member }, { data: habits }, { data: targets }, { data: meals }, { data: sessions }] =
    await Promise.all([
      scope(supabaseAdmin.from('memberapp_members').select('nutrition_enabled')).maybeSingle(),
      scope(supabaseAdmin.from('memberapp_habits').select('id, label, kind')).eq('is_active', true),
      scope(supabaseAdmin
        .from('memberapp_nutrition_targets')
        .select('calories, protein_g, carbs_g, fat_g, effective_from'))
        .order('effective_from', { ascending: false })
        .limit(50),
      scope(supabaseAdmin
        .from('memberapp_meals')
        .select('performed_on, slot, name, calories, protein_g, carbs_g, fat_g'))
        .gte('performed_on', from).lte('performed_on', to)
        .order('logged_at', { ascending: true }),
      scope(supabaseAdmin
        .from('memberapp_workout_sessions')
        .select('id, performed_on, completed_at, day_id'))
        .gte('performed_on', from).lte('performed_on', to)
        .order('performed_on', { ascending: true }),
    ])

  const nutritionEnabled = Boolean(member?.nutrition_enabled)

  const habitIds = (habits || []).map(h => h.id)
  const { data: habitLogs } = habitIds.length
    ? await supabaseAdmin
        .from('memberapp_habit_logs')
        .select('habit_id, performed_on')
        .in('habit_id', habitIds)
        .gte('performed_on', from).lte('performed_on', to)
    : { data: [] }

  // Day names make a workout readable at a glance; without them every entry
  // on the grid just says "workout". Days are memberapp_program_days of the
  // Coaching program tree (migration 239).
  const dayIds = [...new Set((sessions || []).map(s => s.day_id).filter(Boolean))]
  const { data: dayRows } = dayIds.length
    ? await supabaseAdmin
        .from('memberapp_program_days')
        .select('id, name')
        .in('id', dayIds)
    : { data: [] }
  const dayName = new Map((dayRows || []).map(d => [d.id, d.name]))

  const days = {}
  const at = (key) => {
    if (!days[key]) days[key] = {}
    return days[key]
  }

  const labelOf = new Map((habits || []).map(h => [h.id, h.label]))
  for (const log of habitLogs || []) {
    const label = labelOf.get(log.habit_id)
    if (!label) continue
    const d = at(log.performed_on)
    d.habits = d.habits || []
    d.habits.push(label)
  }

  for (const session of sessions || []) {
    if (!session.completed_at) continue
    const d = at(session.performed_on)
    d.workouts = d.workouts || []
    d.workouts.push({ id: session.id, name: dayName.get(session.day_id) || 'Workout' })
  }

  if (nutritionEnabled) {
    const byDay = new Map()
    for (const meal of meals || []) {
      if (!byDay.has(meal.performed_on)) byDay.set(meal.performed_on, [])
      byDay.get(meal.performed_on).push(meal)
    }
    for (const [key, list] of byDay) {
      const totals = totalsFor(list)
      const target = targetOn(targets || [], key)
      at(key).food = {
        meals: list.map(m => ({
          name: m.name || (m.slot ? m.slot[0].toUpperCase() + m.slot.slice(1) : 'Meal'),
          calories: m.calories,
          protein_g: m.protein_g,
          carbs_g: m.carbs_g,
          fat_g: m.fat_g,
        })),
        totals,
        target,
        over: target?.calories == null ? null : totals.calories > Number(target.calories),
        difference: target?.calories == null
          ? null
          : Math.round(totals.calories - Number(target.calories)),
      }
    }
  }

  res.json({ from, to, today, nutritionEnabled, days })
})

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// GET /member-app/threads — everyone with a conversation, newest first
router.get('/threads', managerOnly, async (req, res) => {
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
router.get('/messages', fromQuery, async (req, res) => {
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
router.post('/messages', fromBody, async (req, res) => {
  const { member_id: memberId, club_number: clubNumber, body } = req.body || {}
  if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')
  const text = trim(body, 2000)
  if (!text) return fail(res, 400, 'Write a message first')

  const { data: message, error } = await supabaseAdmin
    .from('memberapp_messages')
    .insert({
      member_id: memberId, club_number: String(clubNumber),
      sender: 'coach', staff_id: req.staff?.id || null, body: text,
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

router.get('/broadcasts', managerOnly, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('memberapp_broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return fail(res, 502, error.message)
  res.json({ broadcasts: data || [] })
})

router.post('/broadcasts', managerOnly, async (req, res) => {
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
router.post('/broadcasts/:id/cancel', managerOnly, async (req, res) => {
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
