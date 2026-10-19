// auth/src/routes/coachingClients.js
// The Coaching tile's client side (Kahunas's coach dashboard, client list and
// client profile): who my clients are, upgrading a member to a client,
// archiving, reassigning a coach, the profile header and activity log, client
// notes and per-exercise progress.
//
// Mounted inside routes/coaching.js, so authenticate + requireTile('coaching')
// already ran. Every member-keyed route goes through assertClientAccess or
// scopedClients (services/coachingScope.js): a trainer reaches only clients
// they coach, a manager their clubs, corporate/admin everyone.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { roleLevel } = require('../middleware/role')
const { resolveCoachScope, assertClientAccess, loadClientRow, MEMBER_COLS } = require('../services/coachingScope')
const { canAddAtClub, filterClients, isCoachScope } = require('../lib/coachingScope')
const { pacificDate, shiftDate } = require('../lib/coachingAccess')
const {
  pairKey, clientCounts, summarizeClient, buildActivity, progressFor, loggedExercises, latestAt,
  currentProgram, scheduledPrograms,
} = require('../lib/coachingClients')
const { roleBaseKeys, applyOverrides } = require('../services/permissions')
const { clubByNumber, clubBySlug } = require('../config/clubs')
const { slugify } = require('../services/locationScope')

const MEMBERS = 'memberapp_members'
const PROGRAMS = 'memberapp_programs'
const SESSIONS = 'memberapp_workout_sessions'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHUNK = 150

const actor = (req) => req.staff?.email || req.staff?.id || 'unknown'
const isManager = (req) => roleLevel(req.staff?.role) >= roleLevel('manager')
const now = () => new Date().toISOString()
const fullName = (m) => (m ? `${m.first_name || ''} ${m.last_name || ''}`.trim() : '')
const staffName = (s) => (s ? (s.display_name || `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.email) : null)
const clubName = (n) => clubByNumber(n)?.name || `Club ${n}`
// A client is someone a coach took on: training tier, or archived (archiving
// drops the tier to basic). A row that only holds a nutrition flag is not.
const isClient = (row) => row && (row.status === 'archived' || row.tier === 'training')

module.exports = function coachingClients({ handle, fail, HttpError, loadProgramForStaff, copyProgram, pushMember }) {
  const router = Router()

  // `.in()` over many ids, in chunks so the URL stays short.
  async function selectIn(table, cols, column, values, extend = (q) => q) {
    const out = []
    const list = [...new Set(values)].filter(v => v != null && v !== '')
    for (let i = 0; i < list.length; i += CHUNK) {
      const { data, error } = await extend(supabaseAdmin.from(table).select(cols).in(column, list.slice(i, i + CHUNK)))
      if (error) throw new HttpError(502, error.message)
      out.push(...(data || []))
    }
    return out
  }

  // Rows keyed (member_id, club_number) narrowed to the exact pairs in `keys`.
  const onlyPairs = (rows, keys) => rows.filter(r => keys.has(pairKey(r)))

  /** Every client in the caller's scope (both statuses). */
  async function scopedClients(req) {
    const scope = await resolveCoachScope(req)
    let query = supabaseAdmin.from(MEMBERS).select(MEMBER_COLS)
    if (isCoachScope(scope)) {
      if (!UUID_RE.test(scope.coachStaffId || '')) return { scope, clients: [] }
      query = query.eq('coach_staff_id', scope.coachStaffId)
    } else if (!scope.all) {
      if (!scope.clubNumbers.length) return { scope, clients: [] }
      query = query.in('club_number', scope.clubNumbers)
    }
    const { data, error } = await query.limit(5000)
    if (error) throw new HttpError(502, error.message)
    return { scope, clients: filterClients(scope, (data || []).filter(isClient)) }
  }

  async function namesFor(rows) {
    const found = await selectIn('abc_members', 'member_id, club_number, first_name, last_name, email', 'member_id', rows.map(r => r.member_id))
    return new Map(found.map(m => [pairKey(m), m]))
  }

  async function staffById(ids) {
    const rows = await selectIn('staff', 'id, display_name, first_name, last_name, email', 'id', ids.filter(id => UUID_RE.test(String(id))))
    return new Map(rows.map(s => [s.id, s]))
  }

  async function sessionsFor(clients, extend) {
    const keys = new Set(clients.map(pairKey))
    const rows = await selectIn(SESSIONS, 'id, member_id, club_number, performed_on, started_at, completed_at, notes, day_id, program_id',
      'member_id', clients.map(c => c.member_id), extend)
    return onlyPairs(rows, keys)
  }

  async function programsFor(clients) {
    const keys = new Set(clients.map(pairKey))
    const rows = await selectIn(PROGRAMS, 'id, name, member_id, club_number, starts_on, ends_on, is_active, created_at, updated_at',
      'member_id', clients.map(c => c.member_id), (q) => q.eq('kind', 'client'))
    return onlyPairs(rows, keys)
  }

  /**
   * Staff who can coach, for the "pick a coach" and reassign lists: active
   * staff holding the Coaching tile (role toggle or override), at `clubNumbers`
   * (null = every club).
   */
  async function listCoaches(clubNumbers) {
    const { data: staff, error } = await supabaseAdmin
      .from('staff').select('id, display_name, first_name, last_name, email, role, custom_tiles').eq('is_active', true)
    if (error) throw new HttpError(502, error.message)
    const [{ data: overrides }, { data: links }] = await Promise.all([
      supabaseAdmin.from('staff_permission_overrides').select('staff_id, perm_key, visible').eq('perm_key', 'coaching'),
      supabaseAdmin.from('staff_locations').select('staff_id, location:locations(name)'),
    ])
    const overrideBy = new Map()
    for (const o of overrides || []) overrideBy.set(o.staff_id, [o])
    const clubsBy = new Map()
    for (const l of links || []) {
      const n = clubBySlug(slugify(l.location?.name))?.clubNumber
      if (!n) continue
      if (!clubsBy.has(l.staff_id)) clubsBy.set(l.staff_id, new Set())
      clubsBy.get(l.staff_id).add(n)
    }
    const out = []
    for (const s of staff || []) {
      const keys = applyOverrides(await roleBaseKeys(s), overrideBy.get(s.id) || [])
      if (!keys.includes('coaching')) continue
      const clubs = [...(clubsBy.get(s.id) || [])]
      if (clubNumbers && !clubs.some(c => clubNumbers.includes(c))) continue
      out.push({ id: s.id, name: staffName(s), role: s.role, club_numbers: clubs })
    }
    return out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  }

  /** Is `coachId` someone this caller may hand a client at `clubNumber` to? */
  async function validCoach(req, scope, coachId, clubNumber) {
    if (!UUID_RE.test(String(coachId || ''))) return false
    if (coachId === req.staff?.id) return true
    const coaches = await listCoaches(scope.all ? null : [String(clubNumber)])
    return coaches.some(c => c.id === coachId)
  }

  // GET /coaching/coaches — who can coach, within my scope.
  router.get('/coaches', handle(async (req, res) => {
    const scope = await resolveCoachScope(req)
    if (isCoachScope(scope)) {
      const me = await staffById([req.staff.id])
      return res.json({ coaches: [{ id: req.staff.id, name: staffName(me.get(req.staff.id)) || req.staff.email }] })
    }
    if (!scope.all && !scope.clubNumbers.length) return res.json({ coaches: [] })
    res.json({ coaches: await listCoaches(scope.all ? null : scope.clubNumbers) })
  }))

  // GET /coaching/clients?status=active|archived&q=
  router.get('/clients', handle(async (req, res) => {
    const today = pacificDate()
    const { clients } = await scopedClients(req)
    const [sessions, programs, names, coaches] = await Promise.all([
      sessionsFor(clients, (q) => q.not('completed_at', 'is', null)),
      programsFor(clients),
      namesFor(clients),
      staffById(clients.map(c => c.coach_staff_id).filter(Boolean)),
    ])
    const counts = clientCounts(clients, sessions, today)
    const status = req.query.status === 'archived' ? 'archived' : 'active'
    const needle = String(req.query.q || '').trim().toLowerCase()

    const rows = clients
      .filter(c => (c.status || 'active') === status)
      .map(c => {
        const m = names.get(pairKey(c))
        const coach = coaches.get(c.coach_staff_id)
        return {
          member_id: c.member_id,
          club_number: c.club_number,
          first_name: m?.first_name || '',
          last_name: m?.last_name || '',
          name: fullName(m) || c.member_id,
          email: m?.email || null,
          club_name: clubName(c.club_number),
          coach: c.coach_staff_id ? { id: c.coach_staff_id, name: staffName(coach) } : null,
          status: c.status || 'active',
          tier: c.tier,
          upgraded_at: c.upgraded_at,
          archived_at: c.archived_at,
          ...summarizeClient(c, { sessions, programs }, today),
        }
      })
      .filter(r => !needle || [r.name, r.email, r.club_name, r.coach?.name, r.current_program?.name]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name))

    res.json({ clients: rows, counts, today })
  }))

  // GET /coaching/dashboard
  router.get('/dashboard', handle(async (req, res) => {
    const today = pacificDate()
    const { scope, clients } = await scopedClients(req)
    const active = clients.filter(c => (c.status || 'active') === 'active')
    const [sessions, programs, names] = await Promise.all([
      sessionsFor(clients, (q) => q.not('completed_at', 'is', null).gte('performed_on', shiftDate(today, -60))),
      programsFor(active),
      namesFor(clients),
    ])
    const who = (r) => ({
      member_id: r.member_id, club_number: r.club_number,
      name: fullName(names.get(pairKey(r))) || r.member_id, club_name: clubName(r.club_number),
    })

    // Latest completed workouts, with set counts and day names.
    const latest = [...sessions].sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 10)
    const [setRows, dayRows] = await Promise.all([
      selectIn('memberapp_set_logs', 'session_id', 'session_id', latest.map(s => s.id)),
      selectIn('memberapp_program_days', 'id, name', 'id', latest.map(s => s.day_id).filter(Boolean)),
    ])
    const setCount = new Map()
    for (const r of setRows) setCount.set(r.session_id, (setCount.get(r.session_id) || 0) + 1)
    const dayName = new Map(dayRows.map(d => [d.id, d.name]))

    // Members waiting on a reply. Managers and admins see every member who
    // wrote in at their clubs; a trainer sees their own clients.
    let msgQuery = supabaseAdmin.from('memberapp_messages')
      .select('member_id, club_number, body, created_at')
      .eq('sender', 'member').is('read_at_coach', null)
      .order('created_at', { ascending: false }).limit(300)
    let msgs = []
    if (isCoachScope(scope)) {
      const keys = new Set(clients.map(pairKey))
      msgs = clients.length ? onlyPairs(await selectIn('memberapp_messages', 'member_id, club_number, body, created_at', 'member_id',
        clients.map(c => c.member_id), (q) => q.eq('sender', 'member').is('read_at_coach', null).order('created_at', { ascending: false })), keys) : []
    } else if (scope.all || scope.clubNumbers.length) {
      if (!scope.all) msgQuery = msgQuery.in('club_number', scope.clubNumbers)
      const { data, error } = await msgQuery
      if (error) throw new HttpError(502, error.message)
      msgs = data || []
    }
    const unread = new Map()
    for (const m of msgs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
      const k = pairKey(m)
      if (!unread.has(k)) unread.set(k, { ...m, count: 0 })
      unread.get(k).count += 1
    }
    const unreadList = [...unread.values()].slice(0, 15)
    const extraNames = unreadList.filter(m => !names.has(pairKey(m)))
    if (extraNames.length) for (const [k, v] of await namesFor(extraNames)) names.set(k, v)

    const weekOut = shiftDate(today, 7)
    res.json({
      today,
      counts: clientCounts(clients, sessions, today),
      latestWorkouts: latest.map(s => ({
        session_id: s.id,
        member: who(s),
        day_name: dayName.get(s.day_id) || null,
        performed_on: s.performed_on,
        completed_at: s.completed_at,
        total_sets: setCount.get(s.id) || 0,
        note: s.notes || null,
      })),
      unreadMessages: unreadList.map(m => ({ member: who(m), last_body: m.body, at: m.created_at, count: m.count })),
      scheduledStarting: programs
        .filter(p => p.is_active && p.starts_on && p.starts_on >= today && p.starts_on <= weekOut)
        .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
        .map(p => ({ program_id: p.id, name: p.name, starts_on: p.starts_on, member: who(p) })),
      newestClients: active
        .filter(c => c.upgraded_at)
        .sort((a, b) => String(b.upgraded_at).localeCompare(String(a.upgraded_at)))
        .slice(0, 5)
        .map(c => ({ member: who(c), upgraded_at: c.upgraded_at })),
    })
  }))

  // GET /coaching/members/search?q= — active members I could take on.
  router.get('/members/search', handle(async (req, res) => {
    const q = String(req.query.q || '').trim()
    const scope = await resolveCoachScope(req)
    if (!scope.all && !scope.clubNumbers.length) return res.json({ members: [], no_clubs: true })
    if (q.length < 2) return res.json({ members: [] })

    // Commas and parentheses would break the PostgREST or() filter.
    const like = `%${q.replace(/[,()*%]/g, ' ').trim()}%`
    let query = supabaseAdmin.from('abc_members')
      .select('member_id, club_number, first_name, last_name, email, membership_type, since_date')
      .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
      .eq('is_active', true)
    if (!scope.all) query = query.in('club_number', scope.clubNumbers)
    const { data, error } = await query.limit(25)
    if (error) throw new HttpError(502, error.message)

    const members = data || []
    const rows = await selectIn(MEMBERS, MEMBER_COLS, 'member_id', members.map(m => m.member_id))
    const rowBy = new Map(rows.map(r => [pairKey(r), r]))
    const coaches = await staffById(rows.map(r => r.coach_staff_id).filter(Boolean))
    res.json({
      members: members.map(m => {
        const r = rowBy.get(pairKey(m))
        return {
          ...m,
          name: fullName(m),
          club_name: clubName(m.club_number),
          tier: r?.tier || 'basic',
          status: r ? (r.status || 'active') : null,
          is_client: isClient(r),
          coach: r?.coach_staff_id ? { id: r.coach_staff_id, name: staffName(coaches.get(r.coach_staff_id)) } : null,
        }
      }),
    })
  }))

  // POST /coaching/clients { member_id, club_number, coach_staff_id?, template_id?, starts_on? }
  // Upgrade a member to a training client (or reactivate one), coach = me
  // unless a manager picks someone, and optionally assign a template.
  router.post('/clients', handle(async (req, res) => {
    const body = req.body || {}
    const memberId = String(body.member_id || '').trim()
    const clubNumber = String(body.club_number || '').trim()
    if (!memberId || !clubNumber) return fail(res, 400, 'member_id and club_number are required')
    const scope = await resolveCoachScope(req)

    const existing = await loadClientRow(memberId, clubNumber)
    const mineAlready = existing && existing.coach_staff_id === req.staff?.id
    if (!canAddAtClub(scope, clubNumber) && !mineAlready) return fail(res, 404, 'Member not found at your clubs')

    const { data: member, error: memberErr } = await supabaseAdmin.from('abc_members')
      .select('member_id, club_number, first_name, last_name, is_active')
      .eq('member_id', memberId).eq('club_number', clubNumber).maybeSingle()
    if (memberErr) return fail(res, 502, memberErr.message)
    if (!member || !member.is_active) return fail(res, 404, 'That member is not active at this club')

    const activeClient = existing && isClient(existing) && existing.status !== 'archived'
    // A manager re-adding someone keeps their current coach unless they pick one.
    let coach = isManager(req) && activeClient && existing.coach_staff_id ? existing.coach_staff_id : (req.staff?.id || null)
    if (body.coach_staff_id && body.coach_staff_id !== coach) {
      if (!isManager(req)) return fail(res, 403, 'Only managers can pick another coach.')
      if (!(await validCoach(req, scope, body.coach_staff_id, clubNumber))) return fail(res, 400, 'Pick a coach who works at this club.')
      coach = body.coach_staff_id
    }
    if (activeClient && existing.coach_staff_id && existing.coach_staff_id !== coach && !isManager(req)) {
      const other = await staffById([existing.coach_staff_id])
      return fail(res, 409, `${fullName(member)} is already coached by ${staffName(other.get(existing.coach_staff_id)) || 'another trainer'}. Ask a manager to reassign them.`)
    }

    let template = null
    if (body.template_id) {
      template = await loadProgramForStaff(req, body.template_id)
      if (template.kind !== 'template') return fail(res, 400, 'Pick a template to start them on')
    }

    const stamp = now()
    const { error } = await supabaseAdmin.from(MEMBERS).upsert({
      member_id: memberId,
      club_number: clubNumber,
      tier: 'training',
      status: 'active',
      archived_at: null,
      coach_staff_id: coach,
      upgraded_at: activeClient && existing.upgraded_at ? existing.upgraded_at : stamp,
      upgraded_by: activeClient && existing.upgraded_by ? existing.upgraded_by : actor(req),
      updated_at: stamp,
      updated_by: actor(req),
    }, { onConflict: 'member_id,club_number' })
    if (error) return fail(res, 502, error.message)

    let program = null
    let warning = null
    if (template) {
      try {
        const copy = await copyProgram(req, template, {
          kind: 'client', member_id: memberId, club_number: clubNumber, coach_staff_id: coach,
          starts_on: body.starts_on || null, notify: false,
        })
        program = copy.program
        warning = copy.warning || null
      } catch (err) {
        warning = `They are your client now, but the template was not assigned: ${err.message}`
      }
    }
    await pushMember(memberId, clubNumber, 'Training is on',
      program && !program.starts_on
        ? 'Your coach has set up your training program. Open the app to see it.'
        : 'Your coach has added you as a training client. Open the app to say hi.')

    res.status(201).json({ client: { member_id: memberId, club_number: clubNumber, name: fullName(member) }, program, warning })
  }))

  // PATCH /coaching/clients/:memberId { club_number, status?, coach_staff_id? }
  router.patch('/clients/:memberId', handle(async (req, res) => {
    const body = req.body || {}
    const { scope, client } = await assertClientAccess(req, req.params.memberId, body.club_number)
    if (!client || !isClient(client)) return fail(res, 404, 'Client not found')
    const patch = { updated_at: now(), updated_by: actor(req) }

    if ('status' in body) {
      if (body.status === 'archived') {
        // Programs and logs stay; the member loses the Training tab.
        Object.assign(patch, { status: 'archived', tier: 'basic', archived_at: now() })
      } else if (body.status === 'active') {
        Object.assign(patch, { status: 'active', tier: 'training', archived_at: null })
      } else {
        return fail(res, 400, 'status must be active or archived')
      }
    }
    if ('coach_staff_id' in body) {
      if (!isManager(req)) return fail(res, 403, 'Only managers can reassign a client.')
      if (!(await validCoach(req, scope, body.coach_staff_id, client.club_number))) {
        return fail(res, 400, 'Pick a coach who works at this club.')
      }
      patch.coach_staff_id = body.coach_staff_id
    }

    const { data, error } = await supabaseAdmin.from(MEMBERS).update(patch)
      .eq('member_id', client.member_id).eq('club_number', client.club_number)
      .select(MEMBER_COLS).single()
    if (error) return fail(res, 502, error.message)
    res.json({ client: data })
  }))

  // POST /coaching/clients/reassign { from_staff_id, to_staff_id } — managers move
  // all of one coach's clients (at their clubs) to another.
  router.post('/clients/reassign', handle(async (req, res) => {
    if (!isManager(req)) return fail(res, 403, 'Only managers can reassign clients.')
    const { from_staff_id: from, to_staff_id: to } = req.body || {}
    if (!UUID_RE.test(String(from || '')) || !UUID_RE.test(String(to || ''))) return fail(res, 400, 'Pick both coaches')
    if (from === to) return fail(res, 400, 'Pick two different coaches')
    const scope = await resolveCoachScope(req)
    if (!scope.all && !scope.clubNumbers.length) return fail(res, 403, 'You have no clubs assigned.')

    const coaches = await listCoaches(scope.all ? null : scope.clubNumbers)
    if (!coaches.some(c => c.id === to)) return fail(res, 400, 'Pick a coach who works at your clubs.')

    let query = supabaseAdmin.from(MEMBERS)
      .update({ coach_staff_id: to, updated_at: now(), updated_by: actor(req) })
      .eq('coach_staff_id', from)
    if (!scope.all) query = query.in('club_number', scope.clubNumbers)
    const { data, error } = await query.select('member_id')
    if (error) return fail(res, 502, error.message)
    res.json({ moved: (data || []).length })
  }))

  // GET /coaching/clients/:memberId?club_number= — the profile.
  router.get('/clients/:memberId', handle(async (req, res) => {
    const memberId = req.params.memberId
    const clubNumber = req.query.club_number
    const { client } = await assertClientAccess(req, memberId, clubNumber)
    const club = String(clubNumber)
    const pair = (q) => q.eq('member_id', String(memberId)).eq('club_number', club)
    const today = pacificDate()

    const [member, programsR, sessionsR, messagesR, noteR, loginR, pushR, mealR] = await Promise.all([
      pair(supabaseAdmin.from('abc_members')
        .select('member_id, club_number, first_name, last_name, email, primary_phone, since_date, membership_type, is_active')).maybeSingle(),
      pair(supabaseAdmin.from(PROGRAMS).select('id, name, starts_on, ends_on, is_active, created_at, updated_at, member_id, club_number').eq('kind', 'client')),
      pair(supabaseAdmin.from(SESSIONS).select('id, performed_on, started_at, completed_at, notes, day_id, member_id, club_number'))
        .order('performed_on', { ascending: false }).limit(200),
      pair(supabaseAdmin.from('memberapp_messages').select('sender, body, created_at'))
        .order('created_at', { ascending: false }).limit(20),
      pair(supabaseAdmin.from('memberapp_client_notes').select('body, updated_by, updated_at')).maybeSingle(),
      pair(supabaseAdmin.from('memberapp_login_codes').select('consumed_at')).not('consumed_at', 'is', null)
        .order('consumed_at', { ascending: false }).limit(1),
      pair(supabaseAdmin.from('memberapp_push_subscriptions').select('last_seen_at'))
        .order('last_seen_at', { ascending: false }).limit(1),
      pair(supabaseAdmin.from('memberapp_meals').select('logged_at')).is('created_by', null)
        .order('logged_at', { ascending: false }).limit(1),
    ])
    for (const r of [member, programsR, sessionsR, messagesR]) if (r.error) throw new HttpError(502, r.error.message)

    const programs = programsR.data || []
    const sessions = sessionsR.data || []
    const messages = messagesR.data || []
    const done = sessions.filter(s => s.completed_at)

    const recent = done.slice(0, 30)
    const [setRows, dayRows, coachMap] = await Promise.all([
      selectIn('memberapp_set_logs', 'session_id', 'session_id', recent.map(s => s.id)),
      selectIn('memberapp_program_days', 'id, name', 'id', recent.map(s => s.day_id).filter(Boolean)),
      staffById([client?.coach_staff_id].filter(Boolean)),
    ])
    const setCount = new Map()
    for (const r of setRows) setCount.set(r.session_id, (setCount.get(r.session_id) || 0) + 1)
    const dayName = new Map(dayRows.map(d => [d.id, d.name]))

    const summary = summarizeClient({ member_id: String(memberId), club_number: club }, { sessions, programs }, today)
    const cur = currentProgram(programs, today)
    const m = member.data

    res.json({
      today,
      client: {
        member_id: String(memberId),
        club_number: club,
        name: fullName(m) || String(memberId),
        first_name: m?.first_name || '',
        last_name: m?.last_name || '',
        email: m?.email || null,
        phone: m?.primary_phone || null,
        member_since: m?.since_date || null,
        membership_type: m?.membership_type || null,
        member_active: m ? Boolean(m.is_active) : null,
        club_name: clubName(club),
        coach: client?.coach_staff_id ? { id: client.coach_staff_id, name: staffName(coachMap.get(client.coach_staff_id)) } : null,
        status: client ? (isClient(client) ? (client.status || 'active') : 'not_client') : 'not_client',
        tier: client?.tier || 'basic',
        upgraded_at: client?.upgraded_at || null,
        archived_at: client?.archived_at || null,
        last_active_in_app: latestAt([
          loginR.data?.[0]?.consumed_at, pushR.data?.[0]?.last_seen_at, mealR.data?.[0]?.logged_at,
          sessions[0]?.started_at, ...sessions.slice(0, 5).map(s => s.completed_at),
          messages.find(x => x.sender === 'member')?.created_at,
        ]),
        current_program: cur ? { id: cur.id, name: cur.name, starts_on: cur.starts_on } : null,
        scheduled_programs: scheduledPrograms(programs, today).map(p => ({ id: p.id, name: p.name, starts_on: p.starts_on })),
        workouts_this_week: summary.workouts_this_week,
        total_workouts: done.length,
        last_workout_on: summary.last_workout_on,
      },
      activity: buildActivity({
        programs,
        sessions: recent.map(s => ({ ...s, day_name: dayName.get(s.day_id), set_count: setCount.get(s.id) || 0 })),
        messages,
      }),
      notes: noteR.data || null,
    })
  }))

  // PUT /coaching/clients/:memberId/notes { club_number, body } — trainer-only notes.
  router.put('/clients/:memberId/notes', handle(async (req, res) => {
    const body = req.body || {}
    await assertClientAccess(req, req.params.memberId, body.club_number)
    const text = body.body == null ? null : String(body.body).slice(0, 10000)
    const row = {
      member_id: String(req.params.memberId),
      club_number: String(body.club_number),
      body: text,
      updated_by: actor(req),
      updated_at: now(),
    }
    const { data, error } = await supabaseAdmin.from('memberapp_client_notes')
      .upsert(row, { onConflict: 'member_id,club_number' }).select('body, updated_by, updated_at').single()
    if (error) return fail(res, 502, error.message)
    res.json({ notes: data })
  }))

  // GET /coaching/clients/:memberId/progress?club_number=&exercise_id=
  router.get('/clients/:memberId/progress', handle(async (req, res) => {
    const memberId = String(req.params.memberId)
    const club = String(req.query.club_number || '')
    await assertClientAccess(req, memberId, club)
    const { data: sessions, error } = await supabaseAdmin.from(SESSIONS)
      .select('id, performed_on').eq('member_id', memberId).eq('club_number', club)
      .order('performed_on', { ascending: false }).limit(400)
    if (error) return fail(res, 502, error.message)
    const dayOf = new Map((sessions || []).map(s => [s.id, s.performed_on]))
    const sets = await selectIn('memberapp_set_logs', 'session_id, exercise_id, exercise_name, reps, weight', 'session_id', [...dayOf.keys()])
    const rows = sets.map(s => ({ ...s, performed_on: dayOf.get(s.session_id) }))
    const exercises = loggedExercises(rows)
    const asked = String(req.query.exercise_id || '')
    const exerciseId = exercises.some(e => e.exercise_id === asked) ? asked : (exercises[0]?.exercise_id || null)
    res.json({ exercises, exercise_id: exerciseId, points: exerciseId ? progressFor(rows, exerciseId) : [] })
  }))

  return router
}
