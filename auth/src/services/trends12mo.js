// 12-Month Trends data gatherer.
//
// Orchestrates 13 RPC calls in parallel (12 monthly demographic snapshots +
// one for "today") plus member-flows + revenue-monthly + active-today, and
// returns one normalized object the Excel builder can render directly.
//
// Inputs:
//   { clubNumbers: string[] | null,   // null = all clubs
//     locationSlugs: string[] | null, // for revenue (column = location_slug)
//     endMonth: 'YYYY-MM' }
//
// Output shape — see end of file.

const { supabaseAdmin } = require('./supabase')
const { getSkipList } = require('../utils/membershipSkipList')
const { SLUG_CLUB_MAP } = require('../utils/locationSlug')

const CLUB_NAMES = {
  '30935': 'Salem',
  '31599': 'Keizer',
  '7655':  'Eugene',
  '31598': 'Springfield',
  '31600': 'Clackamas',
  '31601': 'Milwaukie',
  '32073': 'Medford',
}

// ---------------------------------------------------------------------------
// Build the list of YYYY-MM-01 dates for the trailing 12 months ending at
// endMonth (inclusive). E.g. endMonth='2026-05' → ['2025-06-01', ..., '2026-05-01'].
// Each is the FIRST day of the month; the corresponding month-end is computed
// when calling the historical snapshot RPC.
// ---------------------------------------------------------------------------
function buildMonthList(endMonth) {
  const [yearStr, monthStr] = endMonth.split('-')
  const endYear = parseInt(yearStr, 10)
  const endMon = parseInt(monthStr, 10) // 1-12
  const months = []
  for (let i = 11; i >= 0; i--) {
    let mon = endMon - i
    let year = endYear
    while (mon <= 0) { mon += 12; year -= 1 }
    months.push({
      key: `${year}-${String(mon).padStart(2, '0')}`,
      firstDay: `${year}-${String(mon).padStart(2, '0')}-01`,
    })
  }
  return months
}

function lastDayOfMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number)
  // Day 0 of next month = last day of this month
  const d = new Date(Date.UTC(y, m, 0))
  const yy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// ---------------------------------------------------------------------------
// Normalize a rollup RPC result (array of {bucket, key1, member_count,
// agreement_count}) into a structured per-snapshot object.
// ---------------------------------------------------------------------------
function normalizeSnapshot(rows) {
  const out = {
    total: { members: 0, agreements: 0 },
    by_age: {},
    by_gender: {},
    by_membership_type: {},
    by_club: {},
  }
  for (const r of rows || []) {
    if (r.bucket === 'total') {
      out.total = { members: r.member_count, agreements: r.agreement_count }
    } else if (r.bucket in out) {
      out[r.bucket][r.key1 || 'Unknown'] = {
        members: r.member_count,
        agreements: r.agreement_count,
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Main entrypoint.
// ---------------------------------------------------------------------------
async function gatherTrends12mo({ clubNumbers, locationSlugs, endMonth }) {
  const months = buildMonthList(endMonth)
  const startMonth = months[0].firstDay
  const endMonthFirstDay = months[months.length - 1].firstDay
  const todayIso = new Date().toISOString().slice(0, 10)

  const skipSet = await getSkipList()
  const skipTypes = [...skipSet] // already lowercased in getSkipList

  // Each rollup is computed at month-end so the snapshot reflects "who was
  // active by the close of that month".
  const snapshotDates = months.map(m => ({
    key: m.key,
    date: lastDayOfMonth(m.key),
  }))
  // Plus a "today" snapshot for the Active Roster sheet.
  snapshotDates.push({ key: 'today', date: todayIso })

  // Fire all rollup RPCs + flows + revenue in parallel.
  const rollupPromises = snapshotDates.map(s =>
    supabaseAdmin.rpc('members_active_on_rollup', {
      p_date: s.date,
      p_club_numbers: clubNumbers && clubNumbers.length ? clubNumbers : null,
      p_skip_types: skipTypes.length ? skipTypes : null,
    }).then(({ data, error }) => {
      if (error) throw new Error(`members_active_on_rollup(${s.date}) failed: ${error.message}`)
      return { key: s.key, date: s.date, snapshot: normalizeSnapshot(data) }
    })
  )

  const flowsPromise = supabaseAdmin.rpc('trends_12mo_member_flows', {
    p_start_month: startMonth,
    p_end_month: endMonthFirstDay,
    p_club_numbers: clubNumbers && clubNumbers.length ? clubNumbers : null,
    p_skip_types: skipTypes.length ? skipTypes : null,
  }).then(({ data, error }) => {
    if (error) throw new Error(`trends_12mo_member_flows failed: ${error.message}`)
    return data || []
  })

  const revenuePromise = supabaseAdmin.rpc('revenue_summary_monthly', {
    p_start_month: startMonth,
    p_end_month: endMonthFirstDay,
    p_location_filter: locationSlugs && locationSlugs.length ? locationSlugs : null,
  }).then(({ data, error }) => {
    if (error) throw new Error(`revenue_summary_monthly failed: ${error.message}`)
    return data || []
  })

  const [snapshotResults, flowsRows, revenueRows] = await Promise.all([
    Promise.all(rollupPromises),
    flowsPromise,
    revenuePromise,
  ])

  // ---- Demographics by month + active today ----
  const demographics = []
  let activeToday = null
  for (const r of snapshotResults) {
    if (r.key === 'today') {
      activeToday = { date: r.date, ...r.snapshot }
    } else {
      demographics.push({ month: r.key, as_of: r.date, ...r.snapshot })
    }
  }

  // ---- Member flows (added/dropped per month) ----
  const flowsByMonth = {}
  for (const row of flowsRows) {
    const monthKey = (row.month || '').slice(0, 7) // 'YYYY-MM-DD' → 'YYYY-MM'
    if (!flowsByMonth[monthKey]) {
      flowsByMonth[monthKey] = {
        added_members: 0, added_agreements: 0,
        dropped_members: 0, dropped_agreements: 0,
      }
    }
    if (row.bucket === 'added') {
      flowsByMonth[monthKey].added_members = Number(row.member_count) || 0
      flowsByMonth[monthKey].added_agreements = Number(row.agreement_count) || 0
    } else if (row.bucket === 'dropped') {
      flowsByMonth[monthKey].dropped_members = Number(row.member_count) || 0
      flowsByMonth[monthKey].dropped_agreements = Number(row.agreement_count) || 0
    }
  }
  // Pair flows with the month's end-of-month active total so we can show a
  // running active line.
  const memberFlows = months.map(m => {
    const f = flowsByMonth[m.key] || {
      added_members: 0, added_agreements: 0,
      dropped_members: 0, dropped_agreements: 0,
    }
    const demo = demographics.find(d => d.month === m.key)
    return {
      month: m.key,
      added_members: f.added_members,
      dropped_members: f.dropped_members,
      net_members: f.added_members - f.dropped_members,
      added_agreements: f.added_agreements,
      dropped_agreements: f.dropped_agreements,
      net_agreements: f.added_agreements - f.dropped_agreements,
      active_members_eom: demo ? demo.total.members : 0,
      active_agreements_eom: demo ? demo.total.agreements : 0,
    }
  })

  // ---- Revenue by month ----
  const revenueByMonth = {}
  for (const row of revenueRows) {
    const monthKey = (row.month || '').slice(0, 7)
    if (!revenueByMonth[monthKey]) {
      revenueByMonth[monthKey] = { total: 0, by_profit_center: {}, by_club: {} }
    }
    const amt = Number(row.total_amount) || 0
    if (row.bucket === 'total') {
      revenueByMonth[monthKey].total = amt
    } else if (row.bucket === 'by_profit_center') {
      revenueByMonth[monthKey].by_profit_center[row.key1 || 'Unknown'] = amt
    } else if (row.bucket === 'by_club') {
      revenueByMonth[monthKey].by_club[row.key1 || 'Unknown'] = amt
    }
  }
  const revenue = months.map(m => ({
    month: m.key,
    total: revenueByMonth[m.key]?.total || 0,
    by_profit_center: revenueByMonth[m.key]?.by_profit_center || {},
    by_club: revenueByMonth[m.key]?.by_club || {},
  }))

  // Translate club_number-keyed demographics into human names for display.
  // (We keep the original keys too in the raw output.)
  const labelClubs = (byClub) => {
    const out = {}
    for (const [k, v] of Object.entries(byClub || {})) {
      out[CLUB_NAMES[k] || k] = v
    }
    return out
  }
  for (const d of demographics) d.by_club_labeled = labelClubs(d.by_club)
  if (activeToday) activeToday.by_club_labeled = labelClubs(activeToday.by_club)

  return {
    meta: {
      generated_at: new Date().toISOString(),
      end_month: endMonth,
      start_month: months[0].key,
      months: months.map(m => m.key),
      club_numbers: clubNumbers,
      location_slugs: locationSlugs,
      skip_types: skipTypes,
    },
    member_flows: memberFlows,
    revenue,
    demographics,
    active_today: activeToday || { date: todayIso, total: { members: 0, agreements: 0 } },
  }
}

module.exports = {
  gatherTrends12mo,
  buildMonthList,    // exported for tests
  lastDayOfMonth,    // exported for tests
  normalizeSnapshot, // exported for tests
  CLUB_NAMES,
}
