/**
 * Marketing Scoreboard: the daily leads / carts / joins table, one per
 * channel (meta, organic), laid out like the ad-agency sheet it replaces.
 *
 * Pure: the route gathers the counts (migration 221), Meta spend and GA4
 * sessions, and this shapes them into rows, totals, costs and month-end pace.
 * Kept free of I/O so the arithmetic is testable.
 */

const round2 = n => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100)
const per = (num, den) => (den > 0 ? round2(num / den) : null)

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// Every date of the month up to and including `through`.
function monthDays(month, through) {
  const n = daysInMonth(month)
  const out = []
  for (let d = 1; d <= n; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`
    if (day > through) break
    out.push(day)
  }
  return out
}

/**
 * Month-end projection at the current daily rate. A finished month projects
 * to itself.
 */
function paceFor(total, elapsed, monthLength) {
  if (!elapsed) return 0
  return Math.round((total / elapsed) * monthLength)
}

function goalBlock(pace, goal) {
  const g = goal || {}
  const out = {}
  for (const k of ['leads', 'carts', 'joins']) {
    const target = g[k] == null ? null : Number(g[k])
    out[k] = { pace: pace[k], goal: target, diff: target == null ? null : pace[k] - target }
  }
  return out
}

/**
 * @param {object} opts
 * @param {string} opts.month        'YYYY-MM'
 * @param {string} opts.today        'YYYY-MM-DD' (Pacific)
 * @param {Array}  opts.daily        [{ day, channel, leads, carts, joins }] from marketing_scoreboard_daily
 * @param {Map}    [opts.metaByDay]  day -> { spend, impressions, clicks }
 * @param {Map}    [opts.sessionsByDay] day -> organic website sessions (null when unavailable)
 * @param {object} [opts.goals]      { meta: {leads,carts,joins,target_cpl}, organic: {...} }
 */
function buildScoreboard({ month, today, daily, metaByDay = new Map(), sessionsByDay = null, goals = {} }) {
  const monthLength = daysInMonth(month)
  const lastDay = `${month}-${String(monthLength).padStart(2, '0')}`
  const through = today < lastDay ? today : lastDay
  const days = monthDays(month, through)
  const elapsed = days.length

  const counts = { meta: new Map(), organic: new Map() }
  for (const r of daily || []) {
    const day = String(r.day).slice(0, 10)
    if (!counts[r.channel]) continue
    counts[r.channel].set(day, {
      leads: Number(r.leads) || 0,
      carts: Number(r.carts) || 0,
      joins: Number(r.joins) || 0,
    })
  }
  const zero = { leads: 0, carts: 0, joins: 0 }

  // --- Meta ---------------------------------------------------------------
  let cumSpend = 0
  let cumLeads = 0
  const metaRows = days.map(day => {
    const c = counts.meta.get(day) || zero
    const m = metaByDay.get(day) || { spend: 0, impressions: 0, clicks: 0 }
    cumSpend += m.spend
    cumLeads += c.leads
    return {
      day,
      impressions: m.impressions,
      clicks: m.clicks,
      ...c,
      spend: round2(m.spend),
      cplDay: per(m.spend, c.leads),
      cplMtd: per(cumSpend, cumLeads),
    }
  })
  const metaTotals = sumRows(metaRows, ['impressions', 'clicks', 'leads', 'carts', 'joins', 'spend'])
  metaTotals.spend = round2(metaTotals.spend)
  const metaGoal = goals.meta || {}
  const cpl = per(metaTotals.spend, metaTotals.leads)
  const targetCpl = metaGoal.target_cpl == null ? null : Number(metaGoal.target_cpl)
  const meta = {
    rows: metaRows,
    totals: metaTotals,
    costs: {
      perLead: cpl,
      perCart: per(metaTotals.spend, metaTotals.carts),
      perJoin: per(metaTotals.spend, metaTotals.joins),
    },
    cplTarget: targetCpl == null ? null : {
      target: targetCpl,
      actual: cpl,
      over: cpl == null ? null : round2(cpl - targetCpl),
      overPct: cpl == null || !targetCpl ? null : Math.round(((cpl - targetCpl) / targetCpl) * 100),
    },
    goals: goalBlock(paceTotals(metaTotals, elapsed, monthLength), metaGoal),
  }

  // --- Organic ------------------------------------------------------------
  const organicRows = days.map(day => {
    const c = counts.organic.get(day) || zero
    const sessions = sessionsByDay ? (sessionsByDay.get(day) || 0) : null
    return { day, sessions, ...c, leadRate: sessions ? round2((c.leads / sessions) * 100) : null }
  })
  const organicTotals = sumRows(organicRows, ['leads', 'carts', 'joins'])
  organicTotals.sessions = sessionsByDay ? organicRows.reduce((s, r) => s + (r.sessions || 0), 0) : null
  const organic = {
    rows: organicRows,
    totals: organicTotals,
    rates: {
      leadRate: organicTotals.sessions ? round2((organicTotals.leads / organicTotals.sessions) * 100) : null,
      cartToJoin: organicTotals.carts ? round2((organicTotals.joins / organicTotals.carts) * 100) : null,
    },
    goals: goalBlock(paceTotals(organicTotals, elapsed, monthLength), goals.organic),
  }

  return { month, through, elapsedDays: elapsed, monthDays: monthLength, meta, organic }
}

function sumRows(rows, keys) {
  const out = {}
  for (const k of keys) out[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  return out
}

function paceTotals(totals, elapsed, monthLength) {
  return {
    leads: paceFor(totals.leads, elapsed, monthLength),
    carts: paceFor(totals.carts, elapsed, monthLength),
    joins: paceFor(totals.joins, elapsed, monthLength),
  }
}

/**
 * Which club a Meta campaign belongs to, from its name: every campaign is
 * named for its club ("Medford - Cold Website Leads", "Milwaukie Lead
 * Campaign"). Returns the club slug, or null for a campaign that names none.
 */
function clubForCampaign(name, clubs) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return null
  for (const c of clubs) {
    for (const label of [c.name, c.tradingName, c.slug]) {
      const l = String(label || '').trim().toLowerCase()
      if (l && (n === l || n.startsWith(l + ' ') || n.startsWith(l + '-'))) return c.slug
    }
  }
  return null
}

// GA4 channel groups that are paid. Everything else is organic website traffic.
function isPaidChannel(channel) {
  const c = String(channel || '').toLowerCase()
  return c.startsWith('paid') || c === 'display' || c === 'cross-network' || c === 'affiliates'
}

module.exports = { buildScoreboard, clubForCampaign, isPaidChannel, daysInMonth, paceFor }
