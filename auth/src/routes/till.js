// auth/src/routes/till.js
// Till / cash drawer. Two audiences, so the gate is per route, not per router:
//
//   manager+  /reconciliation, /settings  — variance is sensitive; who is short
//                                           and by how much is a manager's business.
//   lead+     /movements                  — logging cash in or out of the drawer
//                                           is the job of whoever opens it.
//
// A lead can therefore record a $200 bank drop without being able to see
// anyone's over/short. Keep new routes explicit about which tier they want.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations, roleLevel, ROLE_HIERARCHY } = require('../middleware/role')
const { parseLocationSlugParam, SLUG_CLUB_MAP, intersectWithAllowed } = require('../utils/locationSlug')
const { reconcileDay, resolveFloatForDate } = require('../lib/tillReconcile')
const { aggregateCashByDay } = require('../lib/tillCashMovements')
const { validateMovement, netMovementsByDay } = require('../lib/tillMovements')

const CLUB_TO_SLUG = Object.fromEntries(Object.entries(SLUG_CLUB_MAP).map(([s, c]) => [c, s]))
const router = Router()
router.use(authenticate)

const isManagerPlus = (role) => roleLevel(role) >= ROLE_HIERARCHY.indexOf('manager')

// Today's Pacific calendar date (YYYY-MM-DD). A float edit takes effect this day.
function pacificToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// Convert a location name to a slug (same as payroll/checkinsReport).
function locSlugFromName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// Parse YYYY-MM-DD as a wide UTC window that safely covers any Pacific day in the
// range regardless of DST offset. We widen by one calendar day on each side; the
// aggregateCashByDay call buckets precisely by pacificDate, and the per-row date
// filter below trims any spill to exactly [from, to].
function utcWindow(fromStr, toStr) {
  // Shift start back 1 day and end forward 1 day to cover both UTC-8 and UTC-7.
  const fromDate = new Date(`${fromStr}T00:00:00-08:00`)
  fromDate.setUTCDate(fromDate.getUTCDate() - 1)
  const toDate = new Date(`${toStr}T23:59:59-07:00`)
  toDate.setUTCDate(toDate.getUTCDate() + 1)
  return { from: fromDate, to: toDate }
}

router.get('/reconciliation', requireRole('manager'), async (req, res) => {
  try {
    const parsed = parseLocationSlugParam(req.query.location_slug)
    if (parsed.invalid) return res.status(400).json({ error: `Unknown location: ${parsed.invalid}` })
    const from = String(req.query.from || '').slice(0, 10)
    const to = String(req.query.to || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' })

    // FIX 5: reject reversed ranges and cap to 366 days to prevent runaway queries.
    const spanDays = (new Date(to) - new Date(from)) / 86400000
    if (spanDays < 0)
      return res.status(400).json({ error: 'from must be on or before to.' })
    if (spanDays > 366)
      return res.status(400).json({ error: 'Date range too large (max 366 days).' })

    // FIX 1: manager-scoped location narrowing (mirrors payroll.js pattern).
    let slugs = parsed.slugs
    if (!canSeeAllLocations(req.staff.role)) {
      if (parsed.all)
        return res.status(403).json({ error: 'Specify a location_slug; you do not have access to all locations.' })
      const allowedIds = req.staff.report_location_ids || []
      let allowedSlugs = []
      if (allowedIds.length > 0) {
        const { data: allowedLocs } = await supabaseAdmin
          .from('locations').select('name').in('id', allowedIds)
        allowedSlugs = (allowedLocs || []).map(l => locSlugFromName(l.name))
      }
      const narrowed = intersectWithAllowed(parsed, allowedSlugs)
      if (narrowed.invalid)
        return res.status(403).json({ error: `Not authorized to view this location: ${narrowed.invalid}` })
      slugs = narrowed.slugs
    }

    const clubs = slugs.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
    const { from: fromUtc, to: toUtc } = utcWindow(from, to)

    // Settings (float + drop UPC sentinel) per club.
    const { data: settings } = await supabaseAdmin
      .from('till_settings').select('club_number, standard_float, drop_upc')
      .in('club_number', clubs)
    const settingByClub = new Map((settings || []).map(s => [s.club_number, s]))

    // Effective-dated float history per club — the float used for a given day is
    // the most recent one with effective_date <= that business date, so editing a
    // club's float only changes that day forward (past variances stay put).
    const { data: floatRows } = await supabaseAdmin
      .from('till_float_history').select('club_number, effective_date, standard_float')
      .in('club_number', clubs)
    const floatByClub = new Map()
    for (const f of floatRows || []) {
      if (!floatByClub.has(f.club_number)) floatByClub.set(f.club_number, [])
      floatByClub.get(f.club_number).push(f)
    }

    // Counts per club/day (open/close). Tolerate the table not existing yet.
    let counts = []
    try {
      const { data } = await supabaseAdmin
        .from('till_counts')
        .select('club_number, business_date, count_type, counted_amount, employee_name')
        .in('club_number', clubs).gte('business_date', from).lte('business_date', to)
      counts = data || []
    } catch { counts = [] }
    const countKey = (club, date, type) => `${club}|${date}|${type}`
    const countMap = new Map(counts.map(c => [countKey(c.club_number, c.business_date, c.count_type), c]))

    // Portal-recorded cash in/out (the Till tile). Voided rows are excluded by
    // netMovementsByDay, but they are fetched so the per-day itemization can
    // show them struck through if a caller ever wants that.
    let movements = []
    try {
      const { data } = await supabaseAdmin
        .from('till_cash_movements')
        .select('club_number, business_date, direction, reason, amount, note, created_by_name, voided_at')
        .in('club_number', clubs).gte('business_date', from).lte('business_date', to)
      movements = data || []
    } catch { movements = [] }
    const movementsByClub = new Map()
    for (const m of movements) {
      if (!movementsByClub.has(m.club_number)) movementsByClub.set(m.club_number, [])
      movementsByClub.get(m.club_number).push(m)
    }

    const rows = []
    for (const club of clubs) {
      const setting = settingByClub.get(club) || { standard_float: 100, drop_upc: 'XXXCASHDROPXXX' }
      const byDay = await aggregateCashByDay(supabaseAdmin, {
        clubNumber: club, fromUtc, toUtc, dropUpc: setting.drop_upc,
      })
      const clubMovements = movementsByClub.get(club) || []
      const moveByDay = netMovementsByDay(clubMovements)
      // Union of days that have cash activity OR a count submission OR a
      // portal cash movement — a day whose only event was a $200 bank drop
      // still belongs in the report.
      const days = new Set(byDay.keys())
      counts.filter(c => c.club_number === club).forEach(c => days.add(c.business_date))
      moveByDay.forEach((_v, date) => days.add(date))
      for (const date of [...days].sort()) {
        // FIX 2: trim days that fell outside the requested range due to the wide
        // UTC window (the window is intentionally wider than the range for DST safety).
        if (date < from || date > to) continue
        const cash = byDay.get(date) || { cashSales: 0, cashRefunds: 0, cashDrops: 0 }
        const move = moveByDay.get(date) || { manualOut: 0, manualIn: 0 }
        const open = countMap.get(countKey(club, date, 'open'))
        const close = countMap.get(countKey(club, date, 'close'))
        const rec = reconcileDay({
          standardFloat: resolveFloatForDate(floatByClub.get(club), date, setting.standard_float),
          openingCount: open ? Number(open.counted_amount) : null,
          closingCount: close ? Number(close.counted_amount) : null,
          cashSales: cash.cashSales, cashRefunds: cash.cashRefunds, cashDrops: cash.cashDrops,
          manualOut: move.manualOut, manualIn: move.manualIn,
        })
        rows.push({
          club_number: club, location_slug: CLUB_TO_SLUG[club], business_date: date,
          cashSales: Math.round(cash.cashSales * 100) / 100,
          cashRefunds: Math.round(cash.cashRefunds * 100) / 100,
          cashDrops: Math.round(cash.cashDrops * 100) / 100,
          manualOut: move.manualOut, manualIn: move.manualIn,
          // Itemized so the report can expand a day and show who pulled what.
          movements: clubMovements
            .filter(m => String(m.business_date).slice(0, 10) === date && !m.voided_at)
            .map(m => ({
              direction: m.direction, reason: m.reason, amount: Number(m.amount) || 0,
              note: m.note || null, by: m.created_by_name || null,
            })),
          ...rec,
          openBy: open?.employee_name || null, closeBy: close?.employee_name || null,
        })
      }
    }
    res.json({ rows })
  } catch (err) {
    console.error('[till] reconciliation failed:', err.message)
    res.status(500).json({ error: 'reconciliation failed' })
  }
})

// Location ids -> club numbers.
async function clubsForLocationIds(ids) {
  if (!ids || ids.length === 0) return []
  const { data } = await supabaseAdmin.from('locations').select('name').in('id', ids)
  return (data || []).map(l => SLUG_CLUB_MAP[locSlugFromName(l.name)]).filter(Boolean)
}

// The club numbers the caller may configure. All-location roles get every club;
// others are narrowed to their assigned locations (mirrors the reconciliation
// route's narrowing above).
async function allowedClubs(req) {
  if (canSeeAllLocations(req.staff.role)) return Object.values(SLUG_CLUB_MAP)
  return clubsForLocationIds(req.staff.report_location_ids || [])
}

// The club numbers whose DRAWER the caller may touch. Deliberately not
// allowedClubs: that one is scoped by report_location_ids, which an admin can
// switch off per person (can_view_reports) without meaning "cannot work a
// shift here". Logging cash follows where someone actually works.
async function allowedWorkClubs(req) {
  if (canSeeAllLocations(req.staff.role)) return Object.values(SLUG_CLUB_MAP)
  return clubsForLocationIds(req.staff.location_ids || [])
}

// GET /settings — per-club CURRENT standard float (and drop UPC), scoped to the
// caller. till_settings.standard_float mirrors the latest effective float, and
// effective_since is that float's effective date from the history table.
router.get('/settings', requireRole('manager'), async (req, res) => {
  try {
    const clubs = await allowedClubs(req)
    if (clubs.length === 0) return res.json({ settings: [] })
    const { data, error } = await supabaseAdmin
      .from('till_settings')
      .select('club_number, standard_float, drop_upc, active, updated_at')
      .in('club_number', clubs)
    if (error) throw error
    const byClub = new Map((data || []).map(s => [s.club_number, s]))

    // Latest effective_date per club (the date the current float took effect).
    const today = pacificToday()
    const { data: floatRows } = await supabaseAdmin
      .from('till_float_history').select('club_number, effective_date')
      .in('club_number', clubs).lte('effective_date', today)
    const effectiveSince = new Map()
    for (const f of floatRows || []) {
      const eff = String(f.effective_date).slice(0, 10)
      if (!effectiveSince.has(f.club_number) || eff > effectiveSince.get(f.club_number)) {
        effectiveSince.set(f.club_number, eff)
      }
    }

    // Emit a row for every in-scope club, defaulting unseeded ones to 100.
    const settings = clubs.map(club => {
      const s = byClub.get(club) || {}
      return {
        club_number: club,
        location_slug: CLUB_TO_SLUG[club] || null,
        standard_float: s.standard_float != null ? Number(s.standard_float) : 100,
        drop_upc: s.drop_upc || 'XXXCASHDROPXXX',
        updated_at: s.updated_at || null,
        effective_since: effectiveSince.get(club) || null,
      }
    }).sort((a, b) => (a.location_slug || '').localeCompare(b.location_slug || ''))
    res.json({ settings })
  } catch (err) {
    console.error('[till] settings list failed:', err.message)
    res.status(500).json({ error: 'settings list failed' })
  }
})

// PUT /settings — set one club's standard float, effective TODAY. Body:
// { location_slug, standard_float }. Writes a dated row into till_float_history
// (so past days keep their old float) and mirrors the current value onto
// till_settings. Manager+ (router gate); the editor UI lives in the admin panel.
router.put('/settings', requireRole('manager'), async (req, res) => {
  try {
    const parsed = parseLocationSlugParam(req.body.location_slug)
    if (parsed.invalid) return res.status(400).json({ error: `Unknown location: ${parsed.invalid}` })
    if (parsed.all || parsed.slugs.length !== 1) return res.status(400).json({ error: 'A single location_slug is required' })
    const club = SLUG_CLUB_MAP[parsed.slugs[0]]
    if (!club) return res.status(400).json({ error: `Unknown location: ${parsed.slugs[0]}` })
    if (!(await allowedClubs(req)).includes(club)) return res.status(403).json({ error: 'Not authorized for this location' })

    const raw = req.body.standard_float
    const float = typeof raw === 'number' ? raw : parseFloat(raw)
    if (!Number.isFinite(float) || float < 0) return res.status(400).json({ error: 'standard_float must be a non-negative number' })

    const nowIso = new Date().toISOString()
    const today = pacificToday()

    // The change takes effect today; a second edit the same day overwrites it.
    const { error: histErr } = await supabaseAdmin
      .from('till_float_history')
      .upsert({ club_number: club, effective_date: today, standard_float: float, updated_at: nowIso, updated_by: req.staff.id },
        { onConflict: 'club_number,effective_date' })
    if (histErr) throw histErr

    // Mirror the current float onto till_settings (display + fallback).
    const { data, error } = await supabaseAdmin
      .from('till_settings')
      .upsert({ club_number: club, standard_float: float, updated_at: nowIso }, { onConflict: 'club_number' })
      .select('club_number, standard_float, drop_upc, updated_at').single()
    if (error) throw error
    res.json({ setting: {
      club_number: data.club_number,
      location_slug: CLUB_TO_SLUG[data.club_number] || null,
      standard_float: Number(data.standard_float),
      drop_upc: data.drop_upc, updated_at: data.updated_at,
      effective_since: today,
    } })
  } catch (err) {
    console.error('[till] settings write failed:', err.message)
    res.status(500).json({ error: 'settings write failed' })
  }
})

// --- Cash movements (Till tile) --------------------------------------------
//
// Lead+. Recording that cash left or entered the drawer is part of running a
// shift, so it does not wait on a manager. Nothing here exposes variance.
//
// Rows are never deleted — a mistake is voided and stays on the record.

// Resolve a single location_slug from a request into a club number the caller
// is allowed to touch. Sends the response and returns null on any failure.
async function resolveOneClub(req, res, raw) {
  const parsed = parseLocationSlugParam(raw)
  if (parsed.invalid) { res.status(400).json({ error: `Unknown location: ${parsed.invalid}` }); return null }
  if (parsed.all || parsed.slugs.length !== 1) { res.status(400).json({ error: 'A single location_slug is required' }); return null }
  const club = SLUG_CLUB_MAP[parsed.slugs[0]]
  if (!club) { res.status(400).json({ error: `Unknown location: ${parsed.slugs[0]}` }); return null }
  if (!(await allowedWorkClubs(req)).includes(club)) { res.status(403).json({ error: 'Not authorized for this location' }); return null }
  return club
}

// A malformed id would otherwise reach Postgres and come back as a 500; a
// caller asking for a non-id deserves the 404 it means.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MOVEMENT_COLS = 'id, club_number, location_slug, business_date, direction, reason, amount, note, ' +
  'created_by, created_by_name, created_at, voided_at, voided_by_name, void_reason'

// GET /movements?location_slug=salem&from=&to=
// One club's movements over a date range (defaults to today). Voided rows are
// included and flagged, so the tile can show what was taken back and by whom.
router.get('/movements', requireRole('lead'), async (req, res) => {
  try {
    const club = await resolveOneClub(req, res, req.query.location_slug)
    if (!club) return
    const today = pacificToday()
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : today
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : today
    if (to < from) return res.status(400).json({ error: 'from must be on or before to.' })

    const { data, error } = await supabaseAdmin
      .from('till_cash_movements').select(MOVEMENT_COLS)
      .eq('club_number', club).gte('business_date', from).lte('business_date', to)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error
    res.json({ movements: (data || []).map(m => ({ ...m, amount: Number(m.amount) || 0 })) })
  } catch (err) {
    console.error('[till] movements list failed:', err.message)
    res.status(500).json({ error: 'movements list failed' })
  }
})

// POST /movements — log cash in or out.
// Body: { location_slug, direction: 'out'|'in', reason, amount, note?, business_date? }
router.post('/movements', requireRole('lead'), async (req, res) => {
  try {
    const club = await resolveOneClub(req, res, req.body.location_slug)
    if (!club) return
    const parsed = validateMovement(req.body, pacificToday())
    if (parsed.error) return res.status(400).json({ error: parsed.error })

    const { data, error } = await supabaseAdmin
      .from('till_cash_movements')
      .insert({
        club_number: club,
        location_slug: CLUB_TO_SLUG[club],
        ...parsed.value,
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || [req.staff.first_name, req.staff.last_name].filter(Boolean).join(' ') || req.staff.email || null,
      })
      .select(MOVEMENT_COLS).single()
    if (error) throw error
    res.status(201).json({ movement: { ...data, amount: Number(data.amount) || 0 } })
  } catch (err) {
    console.error('[till] movement create failed:', err.message)
    res.status(500).json({ error: 'movement create failed' })
  }
})

// POST /movements/:id/void — take an entry back out of the math.
// Manager+ may void anything at their clubs. A lead may void only their OWN
// entry, and only while it is still today's — enough to fix a typo without
// giving anyone the ability to quietly erase yesterday's cash trail.
router.post('/movements/:id/void', requireRole('lead'), async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id || ''))) return res.status(404).json({ error: 'Movement not found' })
    const { data: row, error: readErr } = await supabaseAdmin
      .from('till_cash_movements').select(MOVEMENT_COLS).eq('id', req.params.id).maybeSingle()
    if (readErr) throw readErr
    if (!row) return res.status(404).json({ error: 'Movement not found' })
    if (!(await allowedWorkClubs(req)).includes(row.club_number))
      return res.status(403).json({ error: 'Not authorized for this location' })
    if (row.voided_at) return res.status(409).json({ error: 'That entry is already voided' })

    if (!isManagerPlus(req.staff.role)) {
      const mine = row.created_by && String(row.created_by) === String(req.staff.id)
      const todays = String(row.business_date).slice(0, 10) === pacificToday()
      if (!mine || !todays)
        return res.status(403).json({ error: 'Only a manager can void this entry. Ask a manager to remove it.' })
    }

    const reason = typeof req.body.void_reason === 'string' ? req.body.void_reason.trim().slice(0, 500) : ''
    if (!reason) return res.status(400).json({ error: 'A reason is required to void an entry' })

    const { data, error } = await supabaseAdmin
      .from('till_cash_movements')
      .update({
        voided_at: new Date().toISOString(),
        voided_by: req.staff.id,
        voided_by_name: req.staff.display_name || [req.staff.first_name, req.staff.last_name].filter(Boolean).join(' ') || req.staff.email || null,
        void_reason: reason,
      })
      .eq('id', req.params.id)
      .is('voided_at', null)     // lost race with a concurrent void changes nothing
      .select(MOVEMENT_COLS).maybeSingle()
    if (error) throw error
    if (!data) return res.status(409).json({ error: 'That entry is already voided' })
    res.json({ movement: { ...data, amount: Number(data.amount) || 0 } })
  } catch (err) {
    console.error('[till] movement void failed:', err.message)
    res.status(500).json({ error: 'movement void failed' })
  }
})

module.exports = router
