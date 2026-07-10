// auth/src/routes/till.js
// Till / cash reconciliation. Manager+ (cash variance is sensitive).
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')
const { parseLocationSlugParam, SLUG_CLUB_MAP, intersectWithAllowed } = require('../utils/locationSlug')
const { reconcileDay, resolveFloatForDate } = require('../lib/tillReconcile')
const { aggregateCashByDay } = require('../lib/tillCashMovements')

const CLUB_TO_SLUG = Object.fromEntries(Object.entries(SLUG_CLUB_MAP).map(([s, c]) => [c, s]))
const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

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

router.get('/reconciliation', async (req, res) => {
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

    const rows = []
    for (const club of clubs) {
      const setting = settingByClub.get(club) || { standard_float: 100, drop_upc: 'XXXCASHDROPXXX' }
      const byDay = await aggregateCashByDay(supabaseAdmin, {
        clubNumber: club, fromUtc, toUtc, dropUpc: setting.drop_upc,
      })
      // Union of days that have cash activity OR a count submission.
      const days = new Set(byDay.keys())
      counts.filter(c => c.club_number === club).forEach(c => days.add(c.business_date))
      for (const date of [...days].sort()) {
        // FIX 2: trim days that fell outside the requested range due to the wide
        // UTC window (the window is intentionally wider than the range for DST safety).
        if (date < from || date > to) continue
        const cash = byDay.get(date) || { cashSales: 0, cashRefunds: 0, cashDrops: 0 }
        const open = countMap.get(countKey(club, date, 'open'))
        const close = countMap.get(countKey(club, date, 'close'))
        const rec = reconcileDay({
          standardFloat: resolveFloatForDate(floatByClub.get(club), date, setting.standard_float),
          openingCount: open ? Number(open.counted_amount) : null,
          closingCount: close ? Number(close.counted_amount) : null,
          cashSales: cash.cashSales, cashRefunds: cash.cashRefunds, cashDrops: cash.cashDrops,
        })
        rows.push({
          club_number: club, location_slug: CLUB_TO_SLUG[club], business_date: date,
          cashSales: Math.round(cash.cashSales * 100) / 100,
          cashRefunds: Math.round(cash.cashRefunds * 100) / 100,
          cashDrops: Math.round(cash.cashDrops * 100) / 100,
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

// The club numbers the caller may configure. All-location roles get every club;
// others are narrowed to their assigned locations (mirrors the reconciliation
// route's narrowing above).
async function allowedClubs(req) {
  if (canSeeAllLocations(req.staff.role)) return Object.values(SLUG_CLUB_MAP)
  const allowedIds = req.staff.report_location_ids || []
  if (allowedIds.length === 0) return []
  const { data } = await supabaseAdmin.from('locations').select('name').in('id', allowedIds)
  const slugs = (data || []).map(l => locSlugFromName(l.name))
  return slugs.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
}

// GET /settings — per-club CURRENT standard float (and drop UPC), scoped to the
// caller. till_settings.standard_float mirrors the latest effective float, and
// effective_since is that float's effective date from the history table.
router.get('/settings', async (req, res) => {
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
router.put('/settings', async (req, res) => {
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

module.exports = router
